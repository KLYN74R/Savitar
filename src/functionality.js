import {hash} from 'blake3-wasm'
import fetch from 'node-fetch'
import bls from './bls.js'





export let USE_TEMPORARY_DB=async(operationType,dbReference,key,value)=>{


    if(operationType === 'get'){

        let value = await dbReference.get(key).catch(_=>false)

        return value

    }
    else if(operationType === 'put') await dbReference.put(key,value).catch(_=>false)

    else await dbReference.del(key).catch(_=>false)

}




/**
 * 
 * @param {*} msg 
 * @param {('T'|'F'|'S'|'CB'|'CD')} msgColor 
 */
export const LOG=(msg,msgColor)=>{

    console.log(COLORS.T,`[${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}]\u001b[38;5;99m(pid:${process.pid})`,COLORS[msgColor],msg,COLORS.C)

}

export let PATH_RESOLVE=path=>__dirname+'/'+path




//_________________________________________ INNER FUNCTIONS __________________________________________


const COLORS = {

    C:'\x1b[0m',
    T:`\u001b[38;5;23m`, // for time view
    F:'\u001b[38;5;196m', // red(error,no collapse,problems with sequence,etc.)
    S:'\x1b[32;1m', // green(new block, exported something, something important, etc.)
    CB:'\u001b[38;5;200m',// ControllerBlock
    CD:`\u001b[38;5;50m`,// Canary died

}

const BLS_VERIFY = async(data,pubKey,signa) => bls.singleVerify(data,pubKey,signa)


const BLAKE3 = v => hash(v,{length:64}).toString('hex')


const GET_BLOCK_HASH = block => BLAKE3( block.creator + block.time + JSON.stringify(block.transactions) + global.configs.symbioteID + block.checkpoint + block.index + block.prevHash)


const GET_VERIFIED_BLOCK = async (poolPubKey,blockIndex,currentCheckpointTempObject) => {

    let blockID = poolPubKey+':'+blockIndex

    let poolMetadata = currentCheckpointTempObject.POOLS_METADATA.get(poolPubKey)

    //________________________________ 0. Get the block from pool authority by given URL ________________________________

    let possibleBlock = await fetch(poolMetadata.url+`/block/`+blockID).then(r=>r.json()).catch(_=>false)


    let overviewIsOk = 
    
        possibleBlock
        && 
        typeof possibleBlock.transactions === 'object' && typeof possibleBlock.prevHash === 'string' && typeof possibleBlock.sig === 'string' 
        &&
        possibleBlock.index === blockIndex && possibleBlock.creator === poolPubKey
        &&
        possibleBlock.prevHash === poolMetadata.hash
        &&
        await BLS_VERIFY(GET_BLOCK_HASH(possibleBlock),poolPubKey,possibleBlock.sig)


    if(overviewIsOk) {

        // Store to temporary db

        await USE_TEMPORARY_DB('put',currentCheckpointTempObject.DATABASE,'BLOCK:'+blockID,possibleBlock).catch(_=>{})


        return possibleBlock

    } 

}




const GET_MAJORITY = currentCheckpointTempObject => {

    let quorumNumber = currentCheckpointTempObject.CHECKPOINT.quorum.length

    let majority = Math.floor(quorumNumber*(2/3))+1


    //Check if majority is not bigger than number of validators. It's possible when there is a small number of validators

    return majority > quorumNumber ? quorumNumber : majority

}




/*

_________________________________________ WEBSOCKET HANDLERS _________________________________________

[+] Blocks
[+] Finalization Proofs


*/


let BLOCKS_ACCEPT = async (poolID,blockOrError) => {


    let tempObject = TEMP_CACHE_PER_CHECKPOINT.get(CURRENT_CHECKPOINT_ID)

    if(!tempObject) return



    if(blockOrError.reason){

        let nextIndex = tempObject.CACHE.get('BLOCK_POINTER:'+poolID)

        let nextData = {

            route:'get_block',
            
            payload:poolID+':'+nextIndex
    
        }
    
    
        let appropriateConnection = tempObject.WSS_CONNECTIONS.get(poolID)
    
        setTimeout(()=>appropriateConnection.sendUTF(JSON.stringify(nextData)),3000)

        return

    }

    let blockID = poolID+":"+blockOrError.index

    LOG(`Received block \u001b[38;5;50m${blockID}`,'S')
    
    await USE_TEMPORARY_DB('put',tempObject.DATABASE,'BLOCK:'+blockID,blockOrError).catch(_=>{})


    let nextIndex = tempObject.CACHE.get('BLOCK_POINTER:'+poolID)+1

    tempObject.CACHE.set('BLOCK_POINTER:'+poolID,nextIndex)

    await USE_TEMPORARY_DB('put',tempObject.DATABASE,'BLOCK_POINTER:'+poolID,nextIndex).catch(_=>{})


    //Find next block

    let nextBlockID = poolID+':'+nextIndex

    let nextData = {

        route:'get_block',
        payload:nextBlockID

    }

    let appropriateConnection = tempObject.WSS_CONNECTIONS.get(blockOrError.creator)

    appropriateConnection.sendUTF(JSON.stringify(nextData))

}


let COMMITMENT_ACCEPT=async(_poolID,commitmentWithBlockID)=>{

    // commitmentWithBlockID => {blockID:commitment,blockID,commitment} and FROM property to know the pubkey of sender(member of quorum)

    let tempObject = TEMP_CACHE_PER_CHECKPOINT.get(CURRENT_CHECKPOINT_ID)

    if(!tempObject) return

    let senderPubKey = commitmentWithBlockID.from

    delete commitmentWithBlockID.from

    let blockIDs = Object.keys(commitmentWithBlockID)


    for(let blockID of blockIDs){

        let blockHash = tempObject.CACHE.get(blockID+'_HASH') || GET_BLOCK_HASH(await USE_TEMPORARY_DB('get',tempObject.DATABASE,'BLOCK:'+blockID).catch(_=>false))

        let commitmentIsOk = await bls.singleVerify(blockID+blockHash+CURRENT_CHECKPOINT_ID,senderPubKey,commitmentWithBlockID[blockID]).catch(_=>false)

        if(commitmentIsOk) {

            let commitmentsForCurrentBlock = tempObject.COMMITMENTS.get(blockID)

            if(!commitmentsForCurrentBlock.blockID) commitmentsForCurrentBlock.set(senderPubKey,commitmentWithBlockID[blockID])

        }
    
    }
    
}


let FINALIZATION_PROOF_ACCEPT=async(_poolID,objectWithFinalizationProofs)=>{

    /*
    
    <objectWithFinalizationProofs> is:
    
    {

        from,

        finalizationProofs:{
     
            blockID:fp_signature
     
        }

    }
    
    */

    let tempObject = TEMP_CACHE_PER_CHECKPOINT.get(CURRENT_CHECKPOINT_ID)

    if(!tempObject) return


    let senderPubkey = objectWithFinalizationProofs.from


    if(!objectWithFinalizationProofs.finalizationProofs) return


    for(let finalizationProofForBlock of objectWithFinalizationProofs.finalizationProofs){

        let [blockID,finalizationProofAsSignature] = Object.entries(finalizationProofForBlock)[0]

        let blockHash = tempObject.CACHE.get(blockID+'_HASH') || GET_BLOCK_HASH(await USE_TEMPORARY_DB('get',tempObject.DATABASE,'BLOCK:'+blockID).catch(_=>false))

        let finalProofIsOk = await bls.singleVerify(blockID+blockHash+'FINALIZATION'+CURRENT_CHECKPOINT_ID,senderPubkey,finalizationProofAsSignature).catch(_=>false)
    

        if(finalProofIsOk){

            let finalizationProofsMapping = tempObject.FINALIZATION_PROOFS.get(blockID)

            if(finalizationProofsMapping) finalizationProofsMapping.set(senderPubkey,finalizationProofAsSignature)

        }
    
    }

}


export let WSS_HANDLERS=new Map()


WSS_HANDLERS.set('BLOCKS_ACCEPT',BLOCKS_ACCEPT)
WSS_HANDLERS.set('COMMITMENT_ACCEPT',COMMITMENT_ACCEPT)
WSS_HANDLERS.set('FINALIZATION_PROOF_ACCEPT',FINALIZATION_PROOF_ACCEPT)







/*

__________________________________________________________________Main functionality is hidden here__________________________________________________________________



Hence we start working from COMPLETED checkpoint X where <poolsMetadata> is

{
    "poolPubKey_1":{index,hash,isReserve},
    "poolPubKey_2":{index,hash,isReserve},
    
    ...
    
    "poolPubKey_N":{index,hash,isReserve}

}, we have the following functions


[+] Function to start grabbing commitment for block X with hash H for subchain S among current quorum
[+] Function to start grabbing finalization proofs for block X with hash H for subchain S among current quorum
[+] Function to make queries for node time-by-time to update the valid checkpoint
[+] Function to check AFK nodes and find SKIP_STAGE_3 proofs to skip subchain on this checkpoint


*/


//___________________________________________ EXTERNAL FUNCTIONALITY ___________________________________________



let RUN_FINALIZATION_PROOFS_GRABBING = async (_currentCheckpointID,currentCheckpointTempObject,poolPubKey,startRangeIndex,finishRangeIndex) => {


    let blockID = poolPubKey+':'+finishRangeIndex

    let block = await USE_TEMPORARY_DB('get',currentCheckpointTempObject.DATABASE,'BLOCK:'+blockID)
    
        .catch(
        
            _ => GET_VERIFIED_BLOCK(poolPubKey,finishRangeIndex,currentCheckpointTempObject)
        
        )

    if(!block){

        setTimeout(()=>START_PROOFS_GRABBING(poolPubKey).catch(_=>false),1000)

        return

    }


    let hashOfLatestBlockInRange = GET_BLOCK_HASH(block)

    let {COMMITMENTS,FINALIZATION_PROOFS,DATABASE} = currentCheckpointTempObject


    //Create the mapping to get the FINALIZATION_PROOFs from the quorum members. Inner mapping contains voterValidatorPubKey => his FINALIZATION_PROOF   
    
    if(!FINALIZATION_PROOFS.has(blockID)) FINALIZATION_PROOFS.set(blockID,new Map())



    let finalizationProofsMapping = FINALIZATION_PROOFS.get(blockID),

        aggregatedCommitmentsForFinalBlockInRange = COMMITMENTS.get(blockID), // voterValidatorPubKey => his commitment 

        majority = GET_MAJORITY(currentCheckpointTempObject)




    if(finalizationProofsMapping.size<majority){


        let dataToSendViaWebsocketConnection = JSON.stringify({

            route:'get_finalization_proof_for_range',
            payload:[aggregatedCommitmentsForFinalBlockInRange]

        })


        for(let [pubKey,wssConnection] of currentCheckpointTempObject.WSS_CONNECTIONS){

            // No sense to get the commitment if we already have
    
            if(finalizationProofsMapping.has(pubKey)) continue

            wssConnection.sendUTF(dataToSendViaWebsocketConnection)
    
        }        


    }




    //_______________________ It means that we now have enough FINALIZATION_PROOFs for appropriate block. Now we can start to generate AGGREGATED_FINALIZATION_PROOF _______________________




    if(finalizationProofsMapping.size>=majority){

        // In this case , aggregate FINALIZATION_PROOFs to get the AGGREGATED_FINALIZATION_PROOF and share over the network
        // Also, increase the counter of SYMBIOTE_META.STATIC_STUFF_CACHE.get('BLOCK_SENDER_HANDLER') to move to the next block and udpate the hash
    
        let signers = [...finalizationProofsMapping.keys()]

        let signatures = [...finalizationProofsMapping.values()]

        let afkVoters = currentCheckpointTempObject.CHECKPOINT.quorum.filter(pubKey=>!signers.includes(pubKey))


        /*
        
        Aggregated version of FINALIZATION_PROOFs (it's AGGREGATED_FINALIZATION_PROOF)
        
        {
        
            blockID:"7cBETvyWGSvnaVbc7ZhSfRPYXmsTzZzYmraKEgxQMng8UPEEexpvVSgTuo8iza73oP:1337",

            blockHash:"0123456701234567012345670123456701234567012345670123456701234567",
        
            aggregatedPub:"7cBETvyWGSvnaVbc7ZhSfRPYXmsTzZzYmraKEgxQMng8UPEEexpvVSgTuo8iza73oP",

            aggregatedSignature:"kffamjvjEg4CMP8VsxTSfC/Gs3T/MgV1xHSbP5YXJI5eCINasivnw07f/lHmWdJjC4qsSrdxr+J8cItbWgbbqNaM+3W4HROq2ojiAhsNw6yCmSBXl73Yhgb44vl5Q8qD",

            afkVoters:[]

        }
    

        */

        let aggregatedFinalizationProof = {

            blockID,
            
            blockHash: hashOfLatestBlockInRange,
            
            aggregatedPub:bls.aggregatePublicKeys(signers),
            
            aggregatedSignature:bls.aggregateSignatures(signatures),
            
            afkVoters

        }

        // //Share here
        // BROADCAST_TO_QUORUM(currentCheckpointTempObject,'/super_finalization',aggregatedFinalizationProof)


        // Store locally
        await USE_TEMPORARY_DB('put',DATABASE,'AFP:'+blockID,aggregatedFinalizationProof).catch(_=>false)

        // Repeat procedure for the next block and store the progress

        let poolMetadata = currentCheckpointTempObject.POOLS_METADATA.get(poolPubKey)


        poolMetadata.index = finishRangeIndex

        poolMetadata.hash = hashOfLatestBlockInRange

        poolMetadata.aggregatedFinalizationProof = aggregatedFinalizationProof


        COMMITMENTS.delete(blockID)
        FINALIZATION_PROOFS.delete(blockID)
        
        currentCheckpointTempObject.CACHE.delete(blockID+'_HASH')
        currentCheckpointTempObject.CACHE.delete('CURRENT:'+poolPubKey)


        LOG(`Received AFP for block \u001b[38;5;50m${blockID} \u001b[38;5;219m(hash:${hashOfLatestBlockInRange})`,'S')

        // To keep progress
        await USE_TEMPORARY_DB('put',DATABASE,poolPubKey,poolMetadata).catch(_=>false)


    }
    
    setTimeout(()=>START_PROOFS_GRABBING(poolPubKey).catch(_=>false),1000)

}




let TRY_TO_GET_AFP=async(nextBlockIndex,blockHash,poolPubKey,currentCheckpointID,currentCheckpointTempObject)=>{

    let poolMetadata = currentCheckpointTempObject.POOLS_METADATA.get(poolPubKey)

    let blockID = poolPubKey+':'+nextBlockIndex

    let itsProbablyAggregatedFinalizationProof = await fetch(`${poolMetadata.url}/aggregated_finalization_proof/${blockID}`).then(r=>r.json()).catch(_=>false)



    
    if(itsProbablyAggregatedFinalizationProof){

       let  generalAndTypeCheck =   itsProbablyAggregatedFinalizationProof
                                    &&
                                    typeof itsProbablyAggregatedFinalizationProof.aggregatedPub === 'string'
                                    &&
                                    typeof itsProbablyAggregatedFinalizationProof.aggregatedSignature === 'string'
                                    &&
                                    typeof itsProbablyAggregatedFinalizationProof.blockID === 'string'
                                    &&
                                    typeof itsProbablyAggregatedFinalizationProof.blockHash === 'string'
                                    &&
                                    Array.isArray(itsProbablyAggregatedFinalizationProof.afkVoters)


        if(generalAndTypeCheck){

            //Verify it before return

            let aggregatedSignatureIsOk = await bls.singleVerify(blockID+blockHash+'FINALIZATION'+currentCheckpointID,itsProbablyAggregatedFinalizationProof.aggregatedPub,itsProbablyAggregatedFinalizationProof.aggregatedSignature).catch(_=>false),

                rootQuorumKeyIsEqualToProposed = currentCheckpointTempObject.CACHE.get('ROOTPUB') === bls.aggregatePublicKeys([itsProbablyAggregatedFinalizationProof.aggregatedPub,...itsProbablyAggregatedFinalizationProof.afkVoters]),

                quorumSize = currentCheckpointTempObject.CHECKPOINT.quorum.length,

                majority = GET_MAJORITY(currentCheckpointTempObject)


            let majorityVotedForThis = quorumSize-itsProbablyAggregatedFinalizationProof.afkVoters.length >= majority


            if(aggregatedSignatureIsOk && rootQuorumKeyIsEqualToProposed && majorityVotedForThis){

                await USE_TEMPORARY_DB('put',currentCheckpointTempObject.DATABASE,'AFP:'+blockID,itsProbablyAggregatedFinalizationProof).catch(_=>false)

                // Repeat procedure for the next block and store the progress
        
                poolMetadata.index = nextBlockIndex
        
                poolMetadata.hash = blockHash
        
                poolMetadata.aggregatedFinalizationProof = itsProbablyAggregatedFinalizationProof
                
                // To keep progress
                await USE_TEMPORARY_DB('put',currentCheckpointTempObject.DATABASE,poolPubKey,poolMetadata).catch(_=>false)

                LOG(`\u001b[38;5;129m[ϟ](via instant) \x1b[32;1mReceived AFP for block \u001b[38;5;50m${blockID} \u001b[38;5;219m(hash:${blockHash})`,'S')

                return true

            }
    
        }
        
    }

}




let RUN_COMMITMENTS_GRABBING = async (currentCheckpointID,currentCheckpointTempObject,poolPubKey,startRangeIndex,finishRangeIndex) => {


    let finishBlockID = poolPubKey+':'+finishRangeIndex

    let blocksToSend = []

    let blockHash

    for(let index = startRangeIndex ; index<=finishRangeIndex ; index++){

        let block = await USE_TEMPORARY_DB('get',currentCheckpointTempObject.DATABASE,'BLOCK:'+(poolPubKey+':'+index))

        if(block) blocksToSend.push(block)

    }

    if(blocksToSend.length!==0){

        blockHash = GET_BLOCK_HASH(blocksToSend[blocksToSend.length-1])

        currentCheckpointTempObject.CACHE.set(finishBlockID+'_HASH',blockHash)

    }

    // if(!block){

    //     setTimeout(()=>SEND_BLOCKS_AND_GRAB_COMMITMENTS(poolPubKey).catch(_=>false),1000)

    //     return
    // }

    // let blockHash = GET_BLOCK_HASH(block)

    // currentCheckpointTempObject.CACHE.set(finishBlockID+'_HASH',blockHash)

    // let afpStatus = await TRY_TO_GET_AFP(nextBlockIndex,blockHash,subchain,currentCheckpointID,currentCheckpointTempObject)

    // if(afpStatus) return


    let commitmentsMapping = currentCheckpointTempObject.COMMITMENTS,
        
        majority = GET_MAJORITY(currentCheckpointTempObject),

        commitmentsForBlockRange


    if(!commitmentsMapping.has(finishBlockID)){

        commitmentsMapping.set(finishBlockID,new Map()) // inner mapping contains voterValidatorPubKey => his commitment 

        commitmentsForBlockRange = commitmentsMapping.get(finishBlockID)

    }else commitmentsForBlockRange = commitmentsMapping.get(finishBlockID)


    
    if(commitmentsForBlockRange.size < majority){

        let dataToSendViaWebsocketConnection = JSON.stringify({

            route:'get_commitment_for_block_range',
            payload:blocksToSend

        })


        for(let [pubKey,wssConnection] of currentCheckpointTempObject.WSS_CONNECTIONS){

            // No sense to get the commitment if we already have

            if(commitmentsForBlockRange.has(pubKey)) continue
    
            /*
            
            0. Share the block via POST /block and get the commitment as the answer
       
            1. After getting 2/3N+1 commitments, aggregate it and call POST /finalization to send the aggregated commitment to the quorum members and get the 
    
            2. Get the 2/3N+1 FINALIZATION_PROOFs, aggregate and call POST /super_finalization to share the AGGREGATED_FINALIZATION_PROOFS over the symbiote
    
            */

            wssConnection.sendUTF(dataToSendViaWebsocketConnection)
    
        }        

    }


    //_______________________ It means that we now have enough commitments for appropriate block. Now we can start to generate FINALIZATION_PROOF _______________________

    // On this step we should go through the quorum members and share FINALIZATION_PROOF to get the AGGREGATED_FINALIZATION_PROOFS(and this way - finalize the block)


    if(commitmentsForBlockRange.size >= majority){

        let signers = [...commitmentsForBlockRange.keys()]

        let signatures = [...commitmentsForBlockRange.values()]

        let afkVoters = currentCheckpointTempObject.CHECKPOINT.quorum.filter(pubKey=>!signers.includes(pubKey))


        /*
        
        Aggregated version of commitments

        {
        
            blockID:"7cBETvyWGSvnaVbc7ZhSfRPYXmsTzZzYmraKEgxQMng8UPEEexpvVSgTuo8iza73oP:1337",

            blockHash:"0123456701234567012345670123456701234567012345670123456701234567",
        
            aggregatedPub:"7cBETvyWGSvnaVbc7ZhSfRPYXmsTzZzYmraKEgxQMng8UPEEexpvVSgTuo8iza73oP",

            aggregatedSignature:"kffamjvjEg4CMP8VsxTSfC/Gs3T/MgV1xHSbP5YXJI5eCINasivnw07f/lHmWdJjC4qsSrdxr+J8cItbWgbbqNaM+3W4HROq2ojiAhsNw6yCmSBXl73Yhgb44vl5Q8qD",

            afkVoters:[]

        }
    

        */

        let aggregatedCommitments = {

            blockID:finishBlockID,
            
            blockHash,
            
            aggregatedPub:bls.aggregatePublicKeys(signers),
            
            aggregatedSignature:bls.aggregateSignatures(signatures),
            
            afkVoters

        }

        //Set the aggregated version of commitments to start to grab FINALIZATION_PROOFS
        commitmentsMapping.set(finishBlockID,aggregatedCommitments)

        let poolMetadata = currentCheckpointTempObject.POOLS_METADATA.get(poolPubKey)


        await RUN_FINALIZATION_PROOFS_GRABBING(currentCheckpointID,currentCheckpointTempObject,poolPubKey,startRangeIndex,finishRangeIndex)



    }else setTimeout(()=>START_PROOFS_GRABBING(poolPubKey).catch(_=>false),1000)

}




/*

Run a single async thread for each of subchain where we should__________________________

0) Get the next block and verify it
1) Start to grab the commitments for this block
2) Once we get 2/3N+1 of commitments - aggregate it and start to grab the finalization proofs
3) Once we get 2/3N+1 of finalization proofs - aggregate to get the AGGREGATED_FINALIZATION_PROOFS and share among validators & endpoints in configs


*/
export let START_PROOFS_GRABBING = async poolPubKey => {

    
    let currentCheckpointID = CURRENT_CHECKPOINT_ID

    let currentCheckpointTempObject = TEMP_CACHE_PER_CHECKPOINT.get(currentCheckpointID)



    // This branch might be executed in moment when me change the checkpoint. So, to avoid interrupts - check if reference is ok and if no - repeat function execution after 100 ms
    if(!currentCheckpointTempObject){

        setTimeout(()=>START_PROOFS_GRABBING(poolPubKey).catch(_=>false),100)

        return

    }


    if(!currentCheckpointTempObject.CACHE.has('BLOCK_POINTER:'+poolPubKey)){

        setTimeout(()=>START_PROOFS_GRABBING(poolPubKey).catch(_=>false),100)

        return

    }


    let handlerForSubchain = currentCheckpointTempObject.POOLS_METADATA.get(poolPubKey) // => {index,hash,aggregatedFinalizationProof(?),url(?)}

    let {FINALIZATION_PROOFS} = currentCheckpointTempObject

    let startRangeIndex = handlerForSubchain.index

    let finishRangeIndex
    
    if(currentCheckpointTempObject.CACHE.has('CURRENT:'+poolPubKey)) finishRangeIndex = currentCheckpointTempObject.CACHE.get('CURRENT:'+poolPubKey)

    else {

        let nextIndexToAsk = currentCheckpointTempObject.CACHE.get('BLOCK_POINTER:'+poolPubKey)

        finishRangeIndex = nextIndexToAsk !==0 ? nextIndexToAsk-1 : 0

        currentCheckpointTempObject.CACHE.set('CURRENT:'+poolPubKey,finishRangeIndex)

    }

    
    let maxBlockID = poolPubKey+':'+finishRangeIndex

    
    if(FINALIZATION_PROOFS.has(maxBlockID)){

        //This option means that we already started to share aggregated 2/3N+1 commitments and grab 2/3+1 FINALIZATION_PROOFS
        
        RUN_FINALIZATION_PROOFS_GRABBING(currentCheckpointID,currentCheckpointTempObject,poolPubKey,startRangeIndex,finishRangeIndex)

    }else{

        // This option means that we already started to share block and going to find 2/3N+1 commitments
        // Once we get it - aggregate it and start finalization proofs grabbing(previous option) 

        RUN_COMMITMENTS_GRABBING(currentCheckpointID,currentCheckpointTempObject,poolPubKey,startRangeIndex,finishRangeIndex)

    }

}




export let SKIP_STAGE_3_MONITORING = async poolPubKey => {


    let currentCheckpointID = CURRENT_CHECKPOINT_ID

    let currentCheckpointTempObject = TEMP_CACHE_PER_CHECKPOINT.get(currentCheckpointID)

    // This branch might be executed in moment when me change the checkpoint. So, to avoid interrupts - check if reference is ok and if no - repeat function execution after 100 ms
    if(!currentCheckpointTempObject){

        setTimeout(()=>SKIP_STAGE_3_MONITORING(poolPubKey).catch(_=>false),100)

        return

    }


    let itsProbablySkipStage3 = await fetch(`${global.configs.node}/skip_procedure_stage_3/${poolPubKey}`).then(r=>r.json()).catch(_=>false)


    /*
        
        The structure must be like this
        
        {subchain,index,hash,aggregatedPub,aggregatedSignature,afkVoters}

    */

    let overviewIsOk = 
    
        typeof itsProbablySkipStage3.subchain === 'string'
        &&
        typeof itsProbablySkipStage3.index === 'number'
        &&
        typeof itsProbablySkipStage3.hash === 'string'
        &&
        typeof itsProbablySkipStage3.aggregatedPub === 'string'
        &&
        typeof itsProbablySkipStage3.aggregatedSignature === 'string'
        &&
        Array.isArray(itsProbablySkipStage3.afkVoters)



    if(overviewIsOk){

        // Check the signature

        let {index,hash} = currentCheckpointTempObject.POOLS_METADATA.get(poolPubKey) // => {index,hash,aggregatedFinalizationProof(?),url(?)}

        let data =`SKIP_STAGE_3:${poolPubKey}:${index}:${hash}:${currentCheckpointID}`

        let aggregatedSignatureIsOk = await bls.singleVerify(data,itsProbablySkipStage3.aggregatedPub,itsProbablySkipStage3.aggregatedSignature).catch(_=>false)

        let rootQuorumKeyIsEqualToProposed = currentCheckpointTempObject.CACHE.get('ROOTPUB') === bls.aggregatePublicKeys([itsProbablySkipStage3.aggregatedPub,...itsProbablySkipStage3.afkVoters])

        let quorumSize = currentCheckpointTempObject.CHECKPOINT.quorum.length

        let majority = GET_MAJORITY(currentCheckpointTempObject)

        let majorityVotedForThis = quorumSize-itsProbablySkipStage3.afkVoters.length >= majority


        if(aggregatedSignatureIsOk && rootQuorumKeyIsEqualToProposed && majorityVotedForThis){

            let result = await USE_TEMPORARY_DB('put',currentCheckpointTempObject.DATABASE,'SKIP_STAGE_3:'+poolPubKey,itsProbablySkipStage3).catch(_=>false)

            if(result!==false){

                LOG(`Seems that subchain \u001b[38;5;50m${poolPubKey}\u001b[38;5;196m was stopped on \u001b[38;5;50m${index}\u001b[38;5;196m block \u001b[38;5;219m(hash:${hash})`,'F')

                return

            }
        
        }

    }


    // Repeat the same procedure
    setTimeout(()=>SKIP_STAGE_3_MONITORING(poolPubKey).catch(_=>false),7000)

}



export let START_BLOCK_GRABBING_PROCESS=async poolPubKey=>{

    let tempObject = TEMP_CACHE_PER_CHECKPOINT.get(CURRENT_CHECKPOINT_ID)

    if(!tempObject){

        setTimeout(()=>START_BLOCK_GRABBING_PROCESS(poolPubKey).catch(_=>false),100)

        return

    }

    let poolMetadata = tempObject.POOLS_METADATA.get(poolPubKey) // BLS pubkey of pool => {index,hash,aggregatedFinalizationProof,url}

    let blockID

    if(tempObject.CACHE.has('BLOCK_POINTER:'+poolPubKey)){

        blockID = poolPubKey+':'+tempObject.CACHE.get('BLOCK_POINTER:'+poolPubKey)

    }else {

        // Try to get pointer from storage

        let pointer = await USE_TEMPORARY_DB('get',tempObject.DATABASE,'BLOCK_POINTER:'+poolPubKey).catch(_=>false)

        if(pointer){

            blockID = poolPubKey+':'+pointer

            tempObject.CACHE.set('BLOCK_POINTER:'+poolPubKey,pointer)

        }else{

            let indexToFind = poolMetadata.index+1

            blockID = poolPubKey+':'+indexToFind

            tempObject.CACHE.set('BLOCK_POINTER:'+poolPubKey,indexToFind)

        }
        
    }
    
    
    let appropriateConnection = tempObject.WSS_CONNECTIONS.get(poolPubKey)


    let data = {

        route:'get_block',
        payload:blockID
    
    }

    appropriateConnection.sendUTF(JSON.stringify(data))


}