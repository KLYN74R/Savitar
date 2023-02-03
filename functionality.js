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


const BLAKE3=v=>hash(v).toString('hex')


const GET_BLOCK_HASH = block => BLAKE3( block.creator + block.time + JSON.stringify(block.events) + CONFIGS.SYMBIOTE_ID + block.index + block.prevHash)


const GET_VERIFIED_BLOCK = async (subchain,blockIndex,currentCheckpointTempObject) => {

    let blockID = subchain+':'+blockIndex

    let subchainMetadata = currentCheckpointTempObject.SUBCHAINS_METADATA.get(subchain)

    //________________________________ 0. Get the block from pool authority by given URL ________________________________

    let possibleBlock = await fetch(subchainMetadata.URL+`/block/`+blockID).then(r=>r.json()).catch(_=>false)


    let overviewIsOk = 
    
        possibleBlock
        && 
        typeof possibleBlock.events === 'object' && typeof possibleBlock.prevHash === 'string' && typeof possibleBlock.sig === 'string' 
        &&
        possibleBlock.index === blockIndex && possibleBlock.creator === subchain
        &&
        possibleBlock.prevHash === subchainMetadata.HASH
        &&
        await BLS_VERIFY(GET_BLOCK_HASH(possibleBlock),subchain,possibleBlock.sig)


    if(overviewIsOk) {

        // Store to temporary db

        await USE_TEMPORARY_DB('put',currentCheckpointTempObject.DATABASE,'BLOCK:'+blockID,possibleBlock).catch(_=>{})


        return possibleBlock

    } 

}




const GET_MAJORITY = currentCheckpointTempObject => {

    let quorumNumber = currentCheckpointTempObject.CHECKPOINT.QUORUM.length

    let majority = Math.floor(quorumNumber*(2/3))+1


    //Check if majority is not bigger than number of validators. It's possible when there is a small number of validators

    return majority > quorumNumber ? quorumNumber : majority

}


const GET_QUORUM_URLS = currentCheckpointTempObject => {

    if(currentCheckpointTempObject.CACHE.has('VALIDATORS_URLS')) return currentCheckpointTempObject.CACHE.get('VALIDATORS_URLS') // [{pubKey0,url0},{pubKey1,url1},....{pubKeyN,urlN}]
    
    else {

        let futureValidatorsUrls = []

        for(let [pubKey,subchainMetadata] of currentCheckpointTempObject.SUBCHAINS_METADATA){

            futureValidatorsUrls.push({pubKey,url:subchainMetadata.URL})

        }

        // Add to cache
        currentCheckpointTempObject.CACHE.set('VALIDATORS_URLS',futureValidatorsUrls)

        return futureValidatorsUrls

    }

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


let COMMITMENTS_ARRAY_ACCEPT=async(poolID,commitmentsArray)=>{
    
}


let FINALIZATION_PROOFS_ARRAY_ACCEPT=(poolID,finalizationsProofsArray)=>{
    
}


export let WSS_HANDLERS=new Map()


WSS_HANDLERS.set('BLOCKS_ACCEPT',BLOCKS_ACCEPT)
WSS_HANDLERS.set('COMMITMENTS_ARRAY_ACCEPT',COMMITMENTS_ARRAY_ACCEPT)
WSS_HANDLERS.set('FINALIZATION_PROOFS_ARRAY_ACCEPT',FINALIZATION_PROOFS_ARRAY_ACCEPT)







/*

__________________________________________________________________Main functionality is hidden here__________________________________________________________________



Hence we start working from COMPLETED checkpoint X where SUBCHAINS_METADATA is

{
    "SUBCHAIN_1":{INDEX,HASH,IS_STOPPED},
    "SUBCHAIN_2":{INDEX,HASH,IS_STOPPED},
    
    ...
    
    "SUBCHAIN_N":{INDEX,HASH,IS_STOPPED}

}, we have the following functions


[+] Function to start grabbing commitment for block X with hash H for subchain S among current quorum
[+] Function to start grabbing finalization proofs for block X with hash H for subchain S among current quorum
[+] Function to make queries for node time-by-time to update the valid checkpoint
[+] Function to check AFK nodes and find SKIP_STAGE_3 proofs to skip subchain on this checkpoint


*/


//___________________________________________ EXTERNAL FUNCTIONALITY ___________________________________________



let RUN_FINALIZATION_PROOFS_GRABBING = async (currentCheckpointID,currentCheckpointTempObject,subchain,nextBlockIndex,afkValidators) => {


    let blockID = subchain+':'+nextBlockIndex

    let block = await USE_TEMPORARY_DB('get',currentCheckpointTempObject.DATABASE,'BLOCK:'+blockID)
    
        .catch(
        
            _ => GET_VERIFIED_BLOCK(subchain,nextBlockIndex,currentCheckpointTempObject)
        
        )


    if(!block) return


    let blockHash = GET_BLOCK_HASH(block)

    let {COMMITMENTS,FINALIZATION_PROOFS,DATABASE} = currentCheckpointTempObject


    //Create the mapping to get the FINALIZATION_PROOFs from the quorum members. Inner mapping contains voterValidatorPubKey => his FINALIZATION_PROOF   
    
    FINALIZATION_PROOFS.set(blockID,new Map())


    let finalizationProofsMapping = FINALIZATION_PROOFS.get(blockID),

        aggregatedCommitments = COMMITMENTS.get(blockID), //voterValidatorPubKey => his commitment 


        optionsToSend = {method:'POST',body:JSON.stringify(aggregatedCommitments)},

        quorumMembers = GET_QUORUM_URLS(currentCheckpointTempObject),

        majority = GET_MAJORITY(currentCheckpointTempObject),

        promises = []



    if(finalizationProofsMapping.size<majority){

        //Descriptor is {url,pubKey}
        for(let descriptor of quorumMembers){

            // No sense to get the commitment if we already have
            if(finalizationProofsMapping.has(descriptor.pubKey)) continue
    

            let promise = fetch(descriptor.url+'/finalization',optionsToSend).then(r=>r.text()).then(async possibleFinalizationProof=>{
    
                let finalProofIsOk = await bls.singleVerify(blockID+blockHash+'FINALIZATION'+currentCheckpointID,descriptor.pubKey,possibleFinalizationProof).catch(_=>false)
    
                if(finalProofIsOk) finalizationProofsMapping.set(descriptor.pubKey,possibleFinalizationProof)
    
            })

            // To make sharing async
            promises.push(promise)

        }
    
        await Promise.all(promises)

    }




    //_______________________ It means that we now have enough FINALIZATION_PROOFs for appropriate block. Now we can start to generate SUPER_FINALIZATION_PROOF _______________________


    if(finalizationProofsMapping.size>=majority){

        // In this case , aggregate FINALIZATION_PROOFs to get the SUPER_FINALIZATION_PROOF and share over the network
        // Also, increase the counter of SYMBIOTE_META.STATIC_STUFF_CACHE.get('BLOCK_SENDER_HANDLER') to move to the next block and udpate the hash
    
        let signers = [...finalizationProofsMapping.keys()]

        let signatures = [...finalizationProofsMapping.values()]

        let afkValidators = currentCheckpointTempObject.CHECKPOINT.QUORUM.filter(pubKey=>!signers.includes(pubKey))


        /*
        
        Aggregated version of FINALIZATION_PROOFs (it's SUPER_FINALIZATION_PROOF)
        
        {
        
            blockID:"7cBETvyWGSvnaVbc7ZhSfRPYXmsTzZzYmraKEgxQMng8UPEEexpvVSgTuo8iza73oP:1337",

            blockHash:"0123456701234567012345670123456701234567012345670123456701234567",
        
            aggregatedPub:"7cBETvyWGSvnaVbc7ZhSfRPYXmsTzZzYmraKEgxQMng8UPEEexpvVSgTuo8iza73oP",

            aggregatedSigna:"kffamjvjEg4CMP8VsxTSfC/Gs3T/MgV1xHSbP5YXJI5eCINasivnw07f/lHmWdJjC4qsSrdxr+J8cItbWgbbqNaM+3W4HROq2ojiAhsNw6yCmSBXl73Yhgb44vl5Q8qD",

            afkValidators:[]

        }
    

        */

        let superFinalizationProof = {

            blockID,
            
            blockHash,
            
            aggregatedPub:bls.aggregatePublicKeys(signers),
            
            aggregatedSignature:bls.aggregateSignatures(signatures),
            
            afkValidators

        }

        // //Share here
        // BROADCAST_TO_QUORUM(currentCheckpointTempObject,'/super_finalization',superFinalizationProof)


        // Store locally
        await USE_TEMPORARY_DB('put',DATABASE,'SFP:'+blockID,superFinalizationProof).catch(_=>false)

        // Repeat procedure for the next block and store the progress

        let subchainMetadata = currentCheckpointTempObject.SUBCHAINS_METADATA.get(subchain)


        subchainMetadata.INDEX = nextBlockIndex

        subchainMetadata.HASH = blockHash

        subchainMetadata.SUPER_FINALIZATION_PROOF = superFinalizationProof


        LOG(`Received SFP for block \u001b[38;5;50m${blockID} \u001b[38;5;219m(hash:${blockHash})`,'S')

        // To keep progress
        await USE_TEMPORARY_DB('put',DATABASE,subchain,subchainMetadata).catch(_=>false)

    }

}


let TRY_TO_GET_SFP=async(nextBlockIndex,blockHash,subchain,currentCheckpointID,currentCheckpointTempObject)=>{

    let subchainMetadata = currentCheckpointTempObject.SUBCHAINS_METADATA.get(subchain)

    let blockID = subchain+':'+nextBlockIndex

    let itsProbablySuperFinalizationProof = await fetch(`${subchainMetadata.URL}/get_super_finalization/${blockID}`).then(r=>r.json()).catch(_=>false)



    
    if(itsProbablySuperFinalizationProof){

       let  generalAndTypeCheck =   itsProbablySuperFinalizationProof
                                    &&
                                    typeof itsProbablySuperFinalizationProof.aggregatedPub === 'string'
                                    &&
                                    typeof itsProbablySuperFinalizationProof.aggregatedSignature === 'string'
                                    &&
                                    typeof itsProbablySuperFinalizationProof.blockID === 'string'
                                    &&
                                    typeof itsProbablySuperFinalizationProof.blockHash === 'string'
                                    &&
                                    Array.isArray(itsProbablySuperFinalizationProof.afkValidators)


        if(generalAndTypeCheck){

            //Verify it before return

            let aggregatedSignatureIsOk = await bls.singleVerify(blockID+blockHash+'FINALIZATION'+currentCheckpointID,itsProbablySuperFinalizationProof.aggregatedPub,itsProbablySuperFinalizationProof.aggregatedSignature).catch(_=>false),

                rootQuorumKeyIsEqualToProposed = currentCheckpointTempObject.CACHE.get('ROOTPUB') === bls.aggregatePublicKeys([itsProbablySuperFinalizationProof.aggregatedPub,...itsProbablySuperFinalizationProof.afkValidators]),

                quorumSize = currentCheckpointTempObject.CHECKPOINT.QUORUM.length,

                majority = GET_MAJORITY(currentCheckpointTempObject)


            let majorityVotedForThis = quorumSize-itsProbablySuperFinalizationProof.afkValidators.length >= majority


            if(aggregatedSignatureIsOk && rootQuorumKeyIsEqualToProposed && majorityVotedForThis){

                await USE_TEMPORARY_DB('put',currentCheckpointTempObject.DATABASE,'SFP:'+blockID,itsProbablySuperFinalizationProof).catch(_=>false)

                // Repeat procedure for the next block and store the progress
        
                subchainMetadata.INDEX = nextBlockIndex
        
                subchainMetadata.HASH = blockHash
        
                subchainMetadata.SUPER_FINALIZATION_PROOF = itsProbablySuperFinalizationProof
                
                // To keep progress
                await USE_TEMPORARY_DB('put',currentCheckpointTempObject.DATABASE,subchain,subchainMetadata).catch(_=>false)

                LOG(`\u001b[38;5;129m[ϟ](via instant) \x1b[32;1mReceived SFP for block \u001b[38;5;50m${blockID} \u001b[38;5;219m(hash:${blockHash})`,'S')

                return true

            }
    
        }
        
    }

}



let RUN_BATCH_COMMITMENTS_GRABBING = async (currentCheckpointID,currentCheckpointTempObject,subchain,nextBlockIndex) => {


    let blocksArray=[]

    let futureFp=[]

    let blockAndHash = new Map()

    let commitmentsMapping = currentCheckpointTempObject.COMMITMENTS


    for(let i=0,limit=20;i<limit;i++){

        let blockID = subchain+':'+(nextBlockIndex+i)

        let block = await USE_TEMPORARY_DB('get',currentCheckpointTempObject.DATABASE,'BLOCK:'+blockID)
    
        .catch(
            
            _ => GET_VERIFIED_BLOCK(subchain,nextBlockIndex+i,currentCheckpointTempObject)
            
        )


        if(!block) return

        let blockHash = GET_BLOCK_HASH(block)

        blockAndHash.set(blockID,blockHash)

        let sfpStatus = await TRY_TO_GET_SFP(nextBlockIndex,blockHash,subchain,currentCheckpointID,currentCheckpointTempObject)

        if(sfpStatus) continue

        else{

            blocksArray.push(block)

            if(!commitmentsMapping.has(blockID)){

                commitmentsMapping.set(blockID,new Map()) // inner mapping contains voterValidatorPubKey => his commitment 
            
            }

        }

    }


    let optionsToSend = {method:'POST',body:JSON.stringify(blocksArray)},
        
        majority = GET_MAJORITY(currentCheckpointTempObject),

        quorumMembers = GET_QUORUM_URLS(currentCheckpointTempObject),

        promises=[]


    
    // for(let i=0,limit=10;i<limit;i++){

    //     let blockID = subchain+':'+(nextBlockIndex+i)
    
    //     let commitmentsForCurrentBlock = commitmentsMapping.get(blockID)
        
    // }    


        //Descriptor is {pubKey,url}
        for(let descriptor of quorumMembers){

    
            /*
            
            0. Share the block via POST /block and get the commitment as the answer
       
            1. After getting 2/3N+1 commitments, aggregate it and call POST /finalization to send the aggregated commitment to the quorum members and get the 
    
            2. Get the 2/3N+1 FINALIZATION_PROOFs, aggregate and call POST /super_finalization to share the SUPER_FINALIZATION_PROOFS over the symbiote
    
            */

    
            let promise = fetch(descriptor.url+'/many_blocks',optionsToSend).then(r=>r.json()).then(async possibleCommitments=>{

                Object.keys(possibleCommitments).forEach(blockID=>{

                    commitmentsMapping.get(blockID).set(descriptor.pubKey,possibleCommitments[blockID])

                    if(commitmentsMapping.get(blockID).size>=majority){

                        let commitmentsForCurrentBlock=commitmentsMapping.get(blockID)

                        let signers = [...commitmentsForCurrentBlock.keys()]

                        let signatures = [...commitmentsForCurrentBlock.values()]
                
                        let afkValidators = currentCheckpointTempObject.CHECKPOINT.QUORUM.filter(pubKey=>!signers.includes(pubKey))
                
                        let aggregatedCommitments = {

                            blockID,
                            
                            blockHash:blockAndHash.get(blockID),
                            
                            aggregatedPub:bls.aggregatePublicKeys(signers),
                            
                            aggregatedSignature:bls.aggregateSignatures(signatures),
                            
                            afkValidators
                
                        }
                
                        //Set the aggregated version of commitments to start to grab FINALIZATION_PROOFS
                        commitmentsMapping.set(blockID,aggregatedCommitments)
                
                        futureFp.push(aggregatedCommitments)

                        if(!currentCheckpointTempObject.FINALIZATION_PROOFS.has(blockID)){

                            currentCheckpointTempObject.FINALIZATION_PROOFS.set(blockID,new Map())

                        }

                        

                    }

                })
                
                // let commitmentIsOk = await bls.singleVerify(blockID+blockHash+currentCheckpointID,descriptor.pubKey,possibleCommitments).catch(_=>false)
                
                // if(commitmentIsOk) commitmentsForCurrentBlock.set(descriptor.pubKey,possibleCommitments)
    
            }).catch(_=>false)
    
            // To make sharing async
            promises.push(promise)
    
        }
    
        await Promise.all(promises)


        for(let descriptor of quorumMembers){

            fetch(descriptor.url+'/many_finalization',{method:'POST',body:JSON.stringify(futureFp)}).then(r=>r.json()).then(async data=>{


                for(let i=0;i<futureFp.length;i++){

                    let signatureIsOk = await bls.singleVerify(futureFp[i].blockID+futureFp[i].blockHash+'FINALIZATION'+currentCheckpointID,descriptor.pubKey,data[i]).catch(_=>console.log(_))    
    
                    if(signatureIsOk){

                        if(!currentCheckpointTempObject.FINALIZATION_PROOFS.has(futureFp[i].blockID)){

                            currentCheckpointTempObject.FINALIZATION_PROOFS.set(futureFp[i].blockID,new Map())

                        }

                        currentCheckpointTempObject.FINALIZATION_PROOFS.get(futureFp[i].blockID).set(descriptor.pubKey,data[i])


                        if(currentCheckpointTempObject.FINALIZATION_PROOFS.get(futureFp[i].blockID).size>=majority){


                            LOG(`################ RECEIVED SFP FOR => ${futureFp[i].blockID}`,'CD')

                            let subchainMetadata = currentCheckpointTempObject.SUBCHAINS_METADATA.get(subchain)


                            subchainMetadata.INDEX = +(futureFp[i].blockID.split(':')[1])

                            subchainMetadata.HASH = futureFp[i].blockHash


                        }


                    }
    
                }

            }).catch(e=>console.log('Errr ',e))

        }

}




let RUN_COMMITMENTS_GRABBING = async (currentCheckpointID,currentCheckpointTempObject,subchain,nextBlockIndex) => {

    let blockID = subchain+':'+nextBlockIndex

    let block = await USE_TEMPORARY_DB('get',currentCheckpointTempObject.DATABASE,'BLOCK:'+blockID)
    
        .catch(
            
            _ => GET_VERIFIED_BLOCK(subchain,nextBlockIndex,currentCheckpointTempObject)
            
        )


    if(!block) return

    let blockHash = GET_BLOCK_HASH(block)


    let sfpStatus = await TRY_TO_GET_SFP(nextBlockIndex,blockHash,subchain,currentCheckpointID,currentCheckpointTempObject)

    if(sfpStatus) return


    let optionsToSend = {method:'POST',body:JSON.stringify(block)},

        commitmentsMapping = currentCheckpointTempObject.COMMITMENTS,
        
        majority = GET_MAJORITY(currentCheckpointTempObject),

        quorumMembers = GET_QUORUM_URLS(currentCheckpointTempObject),

        promises=[],

        commitmentsForCurrentBlock


    if(!commitmentsMapping.has(blockID)){

        commitmentsMapping.set(blockID,new Map()) // inner mapping contains voterValidatorPubKey => his commitment 

        commitmentsForCurrentBlock = commitmentsMapping.get(blockID)

    }else commitmentsForCurrentBlock = commitmentsMapping.get(blockID)


    if(commitmentsForCurrentBlock.size<majority){

        //Descriptor is {pubKey,url}
        for(let descriptor of quorumMembers){

            // No sense to get the commitment if we already have
    
            if(commitmentsForCurrentBlock.has(descriptor.pubKey)) continue
    
            /*
            
            0. Share the block via POST /block and get the commitment as the answer
       
            1. After getting 2/3N+1 commitments, aggregate it and call POST /finalization to send the aggregated commitment to the quorum members and get the 
    
            2. Get the 2/3N+1 FINALIZATION_PROOFs, aggregate and call POST /super_finalization to share the SUPER_FINALIZATION_PROOFS over the symbiote
    
            */

    
            let promise = fetch(descriptor.url+'/block',optionsToSend).then(r=>r.text()).then(async possibleCommitment=>{
    
                let commitmentIsOk = await bls.singleVerify(blockID+blockHash+currentCheckpointID,descriptor.pubKey,possibleCommitment).catch(_=>false)
                
                if(commitmentIsOk) commitmentsForCurrentBlock.set(descriptor.pubKey,possibleCommitment)
    
            }).catch(_=>false)
    
            // To make sharing async
            promises.push(promise)
    
        }
    
        await Promise.all(promises)
        

    }


    //_______________________ It means that we now have enough commitments for appropriate block. Now we can start to generate FINALIZATION_PROOF _______________________

    // On this step we should go through the quorum members and share FINALIZATION_PROOF to get the SUPER_FINALIZATION_PROOFS(and this way - finalize the block)

    if(commitmentsForCurrentBlock.size >= majority){

        let signers = [...commitmentsForCurrentBlock.keys()]

        let signatures = [...commitmentsForCurrentBlock.values()]

        let afkValidators = currentCheckpointTempObject.CHECKPOINT.QUORUM.filter(pubKey=>!signers.includes(pubKey))


        /*
        
        Aggregated version of commitments

        {
        
            blockID:"7cBETvyWGSvnaVbc7ZhSfRPYXmsTzZzYmraKEgxQMng8UPEEexpvVSgTuo8iza73oP:1337",

            blockHash:"0123456701234567012345670123456701234567012345670123456701234567",
        
            aggregatedPub:"7cBETvyWGSvnaVbc7ZhSfRPYXmsTzZzYmraKEgxQMng8UPEEexpvVSgTuo8iza73oP",

            aggregatedSigna:"kffamjvjEg4CMP8VsxTSfC/Gs3T/MgV1xHSbP5YXJI5eCINasivnw07f/lHmWdJjC4qsSrdxr+J8cItbWgbbqNaM+3W4HROq2ojiAhsNw6yCmSBXl73Yhgb44vl5Q8qD",

            afkValidators:[]

        }
    

        */

        let aggregatedCommitments = {

            blockID,
            
            blockHash,
            
            aggregatedPub:bls.aggregatePublicKeys(signers),
            
            aggregatedSignature:bls.aggregateSignatures(signatures),
            
            afkValidators

        }

        //Set the aggregated version of commitments to start to grab FINALIZATION_PROOFS
        commitmentsMapping.set(blockID,aggregatedCommitments)
    
        await RUN_FINALIZATION_PROOFS_GRABBING(currentCheckpointID,currentCheckpointTempObject,subchain,nextBlockIndex,afkValidators)

    }

}




/*

Run a single async thread for each of subchain where we should__________________________

0) Get the next block and verify it
1) Start to grab the commitments for this block
2) Once we get 2/3N+1 of commitments - aggregate it and start to grab the finalization proofs
3) Once we get 2/3N+1 of finalization proofs - aggregate to get the SUPER_FINALIZATION_PROOFS and share among validators & endpoints in configs


*/
let SEND_BLOCKS_AND_GRAB_COMMITMENTS = async subchainID => {

    
    let currentCheckpointID = CURRENT_CHECKPOINT_ID

    let currentCheckpointTempObject = TEMP_CACHE_PER_CHECKPOINT.get(currentCheckpointID)

    // This branch might be executed in moment when me change the checkpoint. So, to avoid interrupts - check if reference is ok and if no - repeat function execution after 100 ms
    if(!currentCheckpointTempObject){

        setTimeout(()=>SEND_BLOCKS_AND_GRAB_COMMITMENTS(subchainID).catch(_=>false),100)

        return

    }

    let handlerForSubchain = currentCheckpointTempObject.SUBCHAINS_METADATA.get(subchainID) // => {INDEX,HASH,SUPER_FINALIZATION_PROOF(?),URL(?)}

    if(!handlerForSubchain.URL){

        let poolURL = await FIND_URL_FOR_POOL_AND_OPEN_WSS_CONNECTION(subchainID)

        if(poolURL){

            handlerForSubchain.URL = poolURL

        }else {

            // Repeat later if URL was/wasn't found
            setTimeout(()=>SEND_BLOCKS_AND_GRAB_COMMITMENTS(subchainID).catch(_=>false),2000)

            return

        }

    }


    let {FINALIZATION_PROOFS} = currentCheckpointTempObject

    let nextIndex = handlerForSubchain.INDEX+1

    let blockID = subchainID+':'+nextIndex


    if(FINALIZATION_PROOFS.has(blockID)){

        //This option means that we already started to share aggregated 2/3N+1 commitments and grab 2/3+1 FINALIZATION_PROOFS
        
        await RUN_FINALIZATION_PROOFS_GRABBING(currentCheckpointID,currentCheckpointTempObject,subchainID,nextIndex)

    }else{

        // This option means that we already started to share block and going to find 2/3N+1 commitments
        // Once we get it - aggregate it and start finalization proofs grabbing(previous option) 

        await RUN_COMMITMENTS_GRABBING(currentCheckpointID,currentCheckpointTempObject,subchainID,nextIndex)

    }

    setTimeout(()=>SEND_BLOCKS_AND_GRAB_COMMITMENTS(subchainID).catch(_=>false),0)

}




let SEND_BATCH_BLOCKS_AND_GRAB_COMMITMENTS = async subchainID => {

    
    let currentCheckpointID = CURRENT_CHECKPOINT_ID

    let currentCheckpointTempObject = TEMP_CACHE_PER_CHECKPOINT.get(currentCheckpointID)

    // This branch might be executed in moment when me change the checkpoint. So, to avoid interrupts - check if reference is ok and if no - repeat function execution after 100 ms
    if(!currentCheckpointTempObject){

        setTimeout(()=>SEND_BATCH_BLOCKS_AND_GRAB_COMMITMENTS(subchainID).catch(_=>false),100)

        return

    }

    let handlerForSubchain = currentCheckpointTempObject.SUBCHAINS_METADATA.get(subchainID) // => {INDEX,HASH,SUPER_FINALIZATION_PROOF(?),URL(?)}

    if(!handlerForSubchain.URL){

        let poolURL = await FIND_URL_FOR_POOL_AND_OPEN_WSS_CONNECTION(subchainID)

        if(poolURL){

            handlerForSubchain.URL = poolURL

        }else {

            // Repeat later if URL was/wasn't found
            setTimeout(()=>SEND_BLOCKS_AND_GRAB_COMMITMENTS(subchainID).catch(_=>false),2000)

            return

        }

    }


    let {FINALIZATION_PROOFS} = currentCheckpointTempObject

    let nextIndex = handlerForSubchain.INDEX+1

    let blockID = subchainID+':'+nextIndex


    if(FINALIZATION_PROOFS.has(blockID)){

        //This option means that we already started to share aggregated 2/3N+1 commitments and grab 2/3+1 FINALIZATION_PROOFS
        
        await RUN_FINALIZATION_PROOFS_GRABBING(currentCheckpointID,currentCheckpointTempObject,subchainID,nextIndex)

    }else{

        // This option means that we already started to share block and going to find 2/3N+1 commitments
        // Once we get it - aggregate it and start finalization proofs grabbing(previous option) 

        await RUN_COMMITMENTS_GRABBING(currentCheckpointID,currentCheckpointTempObject,subchainID,nextIndex)

    }

    setTimeout(()=>SEND_BLOCKS_AND_GRAB_COMMITMENTS(subchainID).catch(_=>false),0)

}



let SKIP_STAGE_3_MONITORING = async subchainID => {


    let currentCheckpointID = CURRENT_CHECKPOINT_ID

    let currentCheckpointTempObject = TEMP_CACHE_PER_CHECKPOINT.get(currentCheckpointID)

    // This branch might be executed in moment when me change the checkpoint. So, to avoid interrupts - check if reference is ok and if no - repeat function execution after 100 ms
    if(!currentCheckpointTempObject){

        setTimeout(()=>SKIP_STAGE_3_MONITORING(subchainID).catch(_=>false),100)

        return

    }


    let itsProbablySkipStage3 = await fetch(`${CONFIGS.NODE}/skip_procedure_stage_3/${subchainID}`).then(r=>r.json()).catch(_=>false)


    /*
        
        The structure must be like this
        
        {subchain,index,hash,aggregatedPub,aggregatedSignature,afkValidators}

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
        Array.isArray(itsProbablySkipStage3.afkValidators)



    if(overviewIsOk){

        // Check the signature

        let {INDEX,HASH} = currentCheckpointTempObject.SUBCHAINS_METADATA.get(subchainID) // => {INDEX,HASH,SUPER_FINALIZATION_PROOF(?),URL(?)}

        let data =`SKIP_STAGE_3:${subchainID}:${INDEX}:${HASH}:${currentCheckpointID}`

        let aggregatedSignatureIsOk = await bls.singleVerify(data,itsProbablySkipStage3.aggregatedPub,itsProbablySkipStage3.aggregatedSignature).catch(_=>false)

        let rootQuorumKeyIsEqualToProposed = currentCheckpointTempObject.CACHE.get('ROOTPUB') === bls.aggregatePublicKeys([itsProbablySkipStage3.aggregatedPub,...itsProbablySkipStage3.afkValidators])

        let quorumSize = currentCheckpointTempObject.CHECKPOINT.QUORUM.length

        let majority = GET_MAJORITY(currentCheckpointTempObject)

        let majorityVotedForThis = quorumSize-itsProbablySkipStage3.afkValidators.length >= majority


        if(aggregatedSignatureIsOk && rootQuorumKeyIsEqualToProposed && majorityVotedForThis){

            let result = await USE_TEMPORARY_DB('put',currentCheckpointTempObject.DATABASE,'SKIP_STAGE_3:'+subchainID,itsProbablySkipStage3).catch(_=>false)

            if(result!==false){

                LOG(`Seems that subchain \u001b[38;5;50m${subchainID}\u001b[38;5;196m was stopped on \u001b[38;5;50m${INDEX}\u001b[38;5;196m block \u001b[38;5;219m(hash:${HASH})`,'F')

                return

            }
        
        }

    }


    // Repeat the same procedure
    setTimeout(()=>SKIP_STAGE_3_MONITORING(subchainID).catch(_=>false),7000)

}



export let START_BLOCK_GRABBING_PROCESS=async subchain=>{

    let tempObject = TEMP_CACHE_PER_CHECKPOINT.get(CURRENT_CHECKPOINT_ID)

    if(!tempObject){

        setTimeout(()=>START_BLOCK_GRABBING_PROCESS(subchain).catch(_=>false),100)

        return

    }

    let subchainMetadata = tempObject.SUBCHAINS_METADATA.get(subchain) // BLS pubkey of pool => {INDEX,HASH,SUPER_FINALIZATION_PROOF,URL}

    let blockID

    if(tempObject.CACHE.has('BLOCK_POINTER:'+subchain)){

        blockID = subchain+':'+tempObject.CACHE.get('BLOCK_POINTER:'+subchain)

    }else {

        // Try to get pointer from storage

        let pointer = await USE_TEMPORARY_DB('get',tempObject.DATABASE,'BLOCK_POINTER:'+subchain).catch(_=>false)

        if(pointer){

            blockID = subchain+':'+pointer

            tempObject.CACHE.set('BLOCK_POINTER:'+subchain,pointer)

        }else{

            let indexToFind = subchainMetadata.INDEX+1

            blockID = subchain+':'+indexToFind

            tempObject.CACHE.set('BLOCK_POINTER:'+subchain,indexToFind)

        }
        
    }
    
    
    let appropriateConnection = tempObject.WSS_CONNECTIONS.get(subchain)


    let data = {

        route:'get_block',
        payload:blockID
    
    }

    appropriateConnection.sendUTF(JSON.stringify(data))


}