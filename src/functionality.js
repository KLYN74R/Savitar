import { GET_WSS_ADDRESS_AND_OPEN_CONNECTION } from './background.js'
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
 * @param {('T'|'F'|'S'|'CD')} msgColor 
 */
export const LOG=(msg,msgColor)=>{

    console.log(COLORS.TIME_VIEW,`[${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}]\u001b[38;5;99m(pid:${process.pid})`,COLORS[msgColor],msg,COLORS.CLEAR)

}

export let PATH_RESOLVE=path=>__dirname+'/'+path




//_________________________________________ INNER FUNCTIONS __________________________________________


const COLORS = {

    CLEAR:'\x1b[0m',
    TIME_VIEW:`\u001b[38;5;23m`,
    FAIL:'\u001b[38;5;196m', // red(error,no collapse,problems with sequence,etc.)
    SUCCESS:'\x1b[32;1m', // green(new block, exported something, something important, etc.)
    INFO:`\u001b[38;5;50m`,// Canary died

}


const BLAKE3 = v => hash(v).toString('hex')


const GET_BLOCK_HASH = block => BLAKE3( block.creator + block.time + JSON.stringify(block.transactions) + global.configs.symbioteID + block.checkpoint + block.index + block.prevHash)


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


let BLOCKS_ACCEPT = async (poolID,blocksArrayOrError) => {

    let tempObject = global.TEMP_CACHE_PER_CHECKPOINT.get(global.CURRENT_CHECKPOINT_FULL_ID)

    if(!tempObject) return



    if(blocksArrayOrError.reason){

        let nextIndex = tempObject.CACHE.get('BLOCK_POINTER:'+poolID)

        let nextData = {

            route:'get_block',
            
            payload:poolID+':'+nextIndex
    
        }
    
    
        let appropriateConnection = tempObject.WSS_CONNECTIONS.get(poolID)
    
        setTimeout(()=>appropriateConnection.sendUTF(JSON.stringify(nextData)),3000)

        return

    }else if(Array.isArray(blocksArrayOrError)){

        let dbPromises = []

        let nextIndex

        for(let block of blocksArrayOrError){

            let blockID = poolID+":"+block.index

            LOG(`Received block \u001b[38;5;50m${blockID}`,'SUCCESS')

            dbPromises.push(USE_TEMPORARY_DB('put',tempObject.DATABASE,'BLOCK:'+blockID,block).catch(_=>false))        
        
            nextIndex = tempObject.CACHE.get('BLOCK_POINTER:'+poolID)+1
        
            tempObject.CACHE.set('BLOCK_POINTER:'+poolID,nextIndex)
        
        
        }


        await Promise.all(dbPromises)

        await USE_TEMPORARY_DB('put',tempObject.DATABASE,'BLOCK_POINTER:'+poolID,nextIndex).catch(_=>{})


        // Find next block
        
        let nextBlockID = poolID+':'+nextIndex
        
        let nextData = {
        
            route:'get_block',
            payload:nextBlockID
        
        }

        let appropriateConnection = tempObject.WSS_CONNECTIONS.get(poolID)
        
        appropriateConnection.sendUTF(JSON.stringify(nextData))

    }

}


let COMMITMENT_ACCEPT=async(_poolID,commitmentWithBlockID)=>{

    // commitmentWithBlockID => {blockID:commitment,blockID,commitment} and FROM property to know the pubkey of sender(member of quorum)

    let tempObject = global.TEMP_CACHE_PER_CHECKPOINT.get(global.CURRENT_CHECKPOINT_FULL_ID)

    if(!tempObject) return

    let senderPubKey = commitmentWithBlockID.from

    delete commitmentWithBlockID.from

    let blockIDs = Object.keys(commitmentWithBlockID)


    for(let blockID of blockIDs){

        let blockHash = tempObject.CACHE.get(blockID+'_HASH') || GET_BLOCK_HASH(await USE_TEMPORARY_DB('get',tempObject.DATABASE,'BLOCK:'+blockID).catch(_=>false))

        let commitmentIsOk = await bls.singleVerify(blockID+blockHash+global.CURRENT_CHECKPOINT_FULL_ID,senderPubKey,commitmentWithBlockID[blockID]).catch(_=>false)

        if(commitmentIsOk) {

            let commitmentsForCurrentBlock = tempObject.COMMITMENTS.get(blockID)

            if(commitmentsForCurrentBlock && !commitmentsForCurrentBlock.blockID) commitmentsForCurrentBlock.set(senderPubKey,commitmentWithBlockID[blockID])

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

    let tempObject = global.TEMP_CACHE_PER_CHECKPOINT.get(global.CURRENT_CHECKPOINT_FULL_ID)

    if(!tempObject) return


    let senderPubkey = objectWithFinalizationProofs.from


    if(!objectWithFinalizationProofs.finalizationProofs) return


    for(let finalizationProofForBlock of objectWithFinalizationProofs.finalizationProofs){

        let [blockID,finalizationProofAsSignature] = Object.entries(finalizationProofForBlock)[0]

        let blockHash = tempObject.CACHE.get(blockID+'_HASH') || GET_BLOCK_HASH(await USE_TEMPORARY_DB('get',tempObject.DATABASE,'BLOCK:'+blockID).catch(_=>false))

        let finalProofIsOk = await bls.singleVerify(blockID+blockHash+'FINALIZATION'+global.CURRENT_CHECKPOINT_FULL_ID,senderPubkey,finalizationProofAsSignature).catch(_=>false)
    

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


[+] Function to start grabbing commitments for range of blocks for subchain S among current quorum
[+] Function to start grabbing finalization proofs for latest block in range for subchain S among current quorum
[+] Function to make queries for node time-by-time to update the valid checkpoint
[+] Function to check AFK subchain authorities


*/


//___________________________________________ EXTERNAL FUNCTIONALITY ___________________________________________



let RUN_FINALIZATION_PROOFS_GRABBING = async (_currentCheckpointID,currentCheckpointTempObject,poolPubKey,finishRangeIndex) => {


    let blockID = poolPubKey+':'+finishRangeIndex

    let block = await USE_TEMPORARY_DB('get',currentCheckpointTempObject.DATABASE,'BLOCK:'+blockID).catch(_ => false)

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


        for(let [quorumMemberPoolPubKey,wssConnection] of currentCheckpointTempObject.WSS_CONNECTIONS){

            // No sense to get the finalizationProof if we already have
            // Also, no sense to ask the pool not from quorum
            if(finalizationProofsMapping.has(quorumMemberPoolPubKey) || !currentCheckpointTempObject.CHECKPOINT.quorum.includes(quorumMemberPoolPubKey)) continue

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
        
        currentCheckpointTempObject.CACHE.delete('CURRENT_SESSION_INDEX:'+poolPubKey)


        LOG(`Received AFP for block \u001b[38;5;50m${blockID} \u001b[38;5;219m(hash:${hashOfLatestBlockInRange})`,'SUCCESS')

        // To keep progress
        await USE_TEMPORARY_DB('put',DATABASE,poolPubKey,poolMetadata).catch(_=>false)

        setImmediate(()=>START_PROOFS_GRABBING(poolPubKey).catch(_=>false))


        currentCheckpointTempObject.WSS_CONNECTIONS.get('7GPupbq1vtKUgaqVeHiDbEJcxS7sSjwPnbht4eRaDBAEJv8ZKHNCSu2Am3CuWnHjta').sendUTF(JSON.stringify({

            route:'accept_afp',
            payload:aggregatedFinalizationProof

        }))

        return

    }
    
    setTimeout(()=>START_PROOFS_GRABBING(poolPubKey).catch(_=>false),1000)

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


        for(let [quorumMemberPoolPubKey,wssConnection] of currentCheckpointTempObject.WSS_CONNECTIONS){

            // No sense to get the commitment if we already have from this quorum member
            // Also, no sense to get commitment from pool that is not in quorum
            if(commitmentsForBlockRange.has(quorumMemberPoolPubKey) || !currentCheckpointTempObject.CHECKPOINT.quorum.includes(quorumMemberPoolPubKey)) continue
        
            /*
                
                TODO: Fix description
    
                0. Share the blocks via POST /block and get the commitment as the answer
        
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

        await RUN_FINALIZATION_PROOFS_GRABBING(currentCheckpointID,currentCheckpointTempObject,poolPubKey,finishRangeIndex)



    }else setTimeout(()=>START_PROOFS_GRABBING(poolPubKey).catch(_=>false),2000)

}




/*

Run a single async thread for each of subchain where we should__________________________

0) Get the next block and verify it
1) Start to grab the commitments for this block
2) Once we get 2/3N+1 of commitments - aggregate it and start to grab the finalization proofs
3) Once we get 2/3N+1 of finalization proofs - aggregate to get the AGGREGATED_FINALIZATION_PROOFS and share among validators & endpoints in configs


*/
export let START_PROOFS_GRABBING = async poolPubKey => {

    
    let currentCheckpointID = global.CURRENT_CHECKPOINT_FULL_ID

    let currentCheckpointTempObject = global.TEMP_CACHE_PER_CHECKPOINT.get(currentCheckpointID)



    // This branch might be executed in moment when me change the checkpoint. So, to avoid interrupts - check if reference is ok and if no - repeat function execution after 100 ms
    if(!currentCheckpointTempObject){

        setTimeout(()=>START_PROOFS_GRABBING(poolPubKey).catch(_=>false),100)

        return

    }


    if(!currentCheckpointTempObject.CACHE.has('BLOCK_POINTER:'+poolPubKey)){

        setTimeout(()=>START_PROOFS_GRABBING(poolPubKey).catch(_=>false),100)

        return

    }


    let handlerForPool = currentCheckpointTempObject.POOLS_METADATA.get(poolPubKey) // => {index,hash,isReserve,currentAuthority(?),aggregatedFinalizationProof,url}

    let {FINALIZATION_PROOFS} = currentCheckpointTempObject

    let startRangeIndex = handlerForPool.index

    let finishRangeIndex
    
    if(currentCheckpointTempObject.CACHE.has('CURRENT_SESSION_INDEX:'+poolPubKey)) finishRangeIndex = currentCheckpointTempObject.CACHE.get('CURRENT_SESSION_INDEX:'+poolPubKey)

    else {

        let nextIndexToAsk = currentCheckpointTempObject.CACHE.get('BLOCK_POINTER:'+poolPubKey)

        finishRangeIndex = nextIndexToAsk !== 0 ? nextIndexToAsk-1 : 0

        currentCheckpointTempObject.CACHE.set('CURRENT_SESSION_INDEX:'+poolPubKey,finishRangeIndex)

    }

    
    let maxBlockID = poolPubKey+':'+finishRangeIndex


    if(FINALIZATION_PROOFS.has(maxBlockID)){

        //This option means that we already started to share aggregated 2/3N+1 commitments and grab 2/3+1 FINALIZATION_PROOFS
        
        RUN_FINALIZATION_PROOFS_GRABBING(currentCheckpointID,currentCheckpointTempObject,poolPubKey,finishRangeIndex)

    }else{

        // This option means that we already started to share block and going to find 2/3N+1 commitments
        // Once we get it - aggregate it and start finalization proofs grabbing(previous option) 

        RUN_COMMITMENTS_GRABBING(currentCheckpointID,currentCheckpointTempObject,poolPubKey,startRangeIndex,finishRangeIndex)


    }

}




export let REASSIGNMENTS_MONITORING = async() => {


    let currentCheckpointID = global.CURRENT_CHECKPOINT_FULL_ID

    let currentCheckpointTempObject = global.TEMP_CACHE_PER_CHECKPOINT.get(currentCheckpointID)

    // This branch might be executed in moment when me change the checkpoint. So, to avoid interrupts - check if reference is ok and if no - repeat function execution after 100 ms
    if(!currentCheckpointTempObject){

        setTimeout(()=>REASSIGNMENTS_MONITORING().catch(_=>false),100)

        return

    }

    //In checkpoint we should already have reassignment chains

    let reassignmentChainsInCheckpoint = currentCheckpointTempObject.CHECKPOINT.reassignmentChains // primePoolPubKey => [reservePool0,reservePool1,...,reservePool2]

    let responseForTempReassignment = await fetch(`${global.configs.node}/get_data_for_temp_reassign`).then(r=>r.json()).catch(_=>false)


/*
        
    The response from each of quorum member has the following structure:

        [0] - {err:'Some error text'} - ignore, do nothing

        [1] - Object with this structure

            {

                primePool0:{currentReservePoolIndex,firstBlockByCurrentAuthority,afpForFirstBlockByCurrentAuthority},

                primePool1:{currentReservePoolIndex,firstBlockByCurrentAuthority,afpForFirstBlockByCurrentAuthority},

                ...

                primePoolN:{currentReservePoolIndex,firstBlockByCurrentAuthority,afpForFirstBlockByCurrentAuthority}

            }


    -----------------------------------------------[Decomposition]-----------------------------------------------


        [0] currentReservePoolIndex - index of current authority for subchain X. To get the pubkey of subchain authority - take the QUORUM_THREAD.CHECKPOINT.REASSIGNMENT_CHAINS[<primePool>][currentReservePoolIndex]

        [1] firstBlockByCurrentAuthority - default block structure with ASP for all the previous pools in a row

        [2] afpForFirstBlockByCurrentAuthority - default AFP structure -> 


            {
        
                blockID:<string>,
                blockHash:<string>,
                aggregatedSignature:<string>, // blockID+hash+'FINALIZATION'+QT.CHECKPOINT.HEADER.PAYLOAD_HASH+"#"+QT.CHECKPOINT.HEADER.ID
                aggregatedPub:<string>,
                afkVoters:[<string>,...]
        
            }


    -----------------------------------------------[What to do next?]-----------------------------------------------
    
    In case <currentReservePoolIndex> is not equal -1 - it's signal that reassignment was occured and we should stop grab blocks created by skipped pool
    We should set new authority for subchain and grab blocks by new pool

*/


    if(responseForTempReassignment){

        for(let [primePoolPubKey,reassignMetadata] of Object.entries(responseForTempReassignment)){

            if(typeof primePoolPubKey === 'string' && typeof reassignMetadata === 'object' && typeof reassignMetadata.currentReservePoolIndex === 'number'){

                let localHandler = currentCheckpointTempObject.POOLS_METADATA.get(primePoolPubKey) // BLS pubkey of pool => {index,hash,isReserve,currentAuthority(?),aggregatedFinalizationProof,url}

                if(localHandler.currentAuthority < reassignMetadata.currentReservePoolIndex){

                    let skippedPool = localHandler.currentAuthority === -1 ? primePoolPubKey : reassignmentChainsInCheckpoint[primePoolPubKey][localHandler.currentAuthority]

                    currentCheckpointTempObject.CACHE.set('SKIP:'+skippedPool) // this is the mark that we should stop to grab blocks by this pool and stop asking for commitments & finalization proofs

                    // If skipped pool is not in current quorum - we can close connection

                    if(!currentCheckpointTempObject.CHECKPOINT.quorum.includes(skippedPool)){

                        let connection = currentCheckpointTempObject.WSS_CONNECTIONS.get(skippedPool)
                        
                        connection.close()

                    }

                    // Now, connect to the new pool if we still don't have WSS connection and start to grab blocks & commitments & finalization proofs

                    let newPoolPubKey = reassignmentChainsInCheckpoint[primePoolPubKey][reassignMetadata.currentReservePoolIndex]


                    if(currentCheckpointTempObject.WSS_CONNECTIONS.has(newPoolPubKey)){

                        // Just start the functions

                        START_BLOCK_GRABBING_PROCESS(newPoolPubKey)

                        START_PROOFS_GRABBING(newPoolPubKey)


                    }else{

                        // Open connection and only after that - start to grab blocks & proofs

                        GET_WSS_ADDRESS_AND_OPEN_CONNECTION(newPoolPubKey,true)

                    }

                }

            }

        }

    }


    // Repeat the same procedure
    setTimeout(()=>REASSIGNMENTS_MONITORING().catch(_=>false),15000)

}



export let START_BLOCK_GRABBING_PROCESS=async poolPubKey=>{

    let tempObject = global.TEMP_CACHE_PER_CHECKPOINT.get(global.CURRENT_CHECKPOINT_FULL_ID)

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