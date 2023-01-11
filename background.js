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


//__________________________________________ TABLE OF IMPORTS __________________________________________


import {hash} from 'blake3-wasm'
import fetch from 'node-fetch'
import bls from './bls.js'
import level from 'level'
import fs from 'fs'


//___________________________________________ CONSTANTS POOL ___________________________________________


global.TEMP_CACHE_PER_CHECKPOINT = new Map() // checkpointFullID => {CHECKPOINT,DATABASE,SUBCHAINS_METADATA,...}

global.CURRENT_CHECKPOINT_ID = '' // PAYLOAD_HASH+INDEX




const COLORS = {
    C:'\x1b[0m',
    T:`\u001b[38;5;23m`, // for time view
    F:'\x1b[31;1m', // red(error,no collapse,problems with sequence,etc.)
    S:'\x1b[32;1m', // green(new block, exported something, something important, etc.)
    W:'\u001b[38;5;3m', // yellow(non critical warnings)
    I:'\x1b[36;1m', // cyan(default messages useful to grasp the events)
    CB:'\u001b[38;5;200m',// ControllerBlock
    CD:`\u001b[38;5;50m`,// Canary died
    GTS:`\u001b[38;5;m`,// Generation Thread Stop
    CON:`\u001b[38;5;168m`// CONFIGS
}

const BLS_VERIFY = async(data,pubKey,signa) => bls.singleVerify(data,pubKey,signa)

const CHECK_IF_THE_SAME_DAY=(timestamp1,timestamp2)=>{

    let date1 = new Date(timestamp1),
        
        date2 = new Date(timestamp2)
    
    return date1.getFullYear() === date2.getFullYear() && date1.getMonth() === date2.getMonth() && date1.getDate() === date2.getDate()

}

const GET_GMT_TIMESTAMP=()=>{

    var currentTime = new Date();
    
    //The offset is in minutes -- convert it to ms
    //See https://stackoverflow.com/questions/9756120/how-do-i-get-a-utc-timestamp-in-javascript
    return currentTime.getTime() + currentTime.getTimezoneOffset() * 60000;
}

const FIND_URL_FOR_POOL = async poolID => {

    // Get the URL from pool's storage
    let possiblePoolData = await fetch(CONFIGS.NODE+'/account/'+poolID+'(POOL)_STORAGE_POOL').then(r=>r.json()).catch(_=>false)

    if(possiblePoolData.poolURL) return possiblePoolData.poolURL

}




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

        await USE_TEMPORARY_DB('put',currentCheckpointTempObject.DATABASE,'BLOCK:'+blockID,possibleBlock).catch(_=>false)

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


const BROADCAST_TO_QUORUM=(currentCheckpointTempObject,route,data)=>{


    let quorumMembers = GET_QUORUM_URLS(currentCheckpointTempObject)

    let optionsToSend = {

        method:'POST',
        body:JSON.stringify(data)

    }

    for(let {url} of quorumMembers){

        fetch(url+route,optionsToSend).catch(_=>{})

    }

}




//___________________________________________ EXTERNAL FUNCTIONALITY ___________________________________________




export const LOG=(msg,msgColor)=>{

    console.log(COLORS.T,`[${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}]\u001b[38;5;99m(pid:${process.pid})`,COLORS[msgColor],msg,COLORS.C)

}




let RUN_FINALIZATION_PROOFS_GRABBING = async (currentCheckpointID,currentCheckpointTempObject,subchain,nextBlockIndex) => {


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
    
            let promise = fetch(descriptor.url+'/finalization',optionsToSend).then(r=>r.text()).then(_=>
                
                fetch(descriptor.url+'/finalization',optionsToSend).then(r=>r.text()).then(async possibleFinalizationProof=>{
    
                    let finalProofIsOk = await bls.singleVerify(blockID+blockHash+'FINALIZATION'+currentCheckpointID,descriptor.pubKey,possibleFinalizationProof).catch(_=>false)
        
                    if(finalProofIsOk) finalizationProofsMapping.set(descriptor.pubKey,possibleFinalizationProof)
        
                })
                
            ).catch(_=>false)

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
        await USE_TEMPORARY_DB('put',DATABASE,'SFP:'+blockID+blockHash,superFinalizationProof).catch(_=>false)

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

    let itsProbablySuperFinalizationProof = await fetch(`${subchainMetadata.URL}/get_super_finalization/${blockID+blockHash}`).then(r=>r.json()).catch(_=>false)



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

                await USE_TEMPORARY_DB('put',currentCheckpointTempObject.DATABASE,'SFP:'+blockID+blockHash,itsProbablySuperFinalizationProof).catch(_=>false)

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
    
        await RUN_FINALIZATION_PROOFS_GRABBING(currentCheckpointID,currentCheckpointTempObject,subchain,nextBlockIndex)

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

        setTimeout(()=>SEND_BLOCKS_AND_GRAB_COMMITMENTS(subchainID),100)

        return

    }

    let handlerForSubchain = currentCheckpointTempObject.SUBCHAINS_METADATA.get(subchainID) // => {INDEX,HASH,SUPER_FINALIZATION_PROOF(?),URL(?)}

    if(!handlerForSubchain.URL){

        let poolURL = await FIND_URL_FOR_POOL(subchainID)

        if(poolURL){

            handlerForSubchain.URL = poolURL

        }else {

            // Repeat later if URL was/wasn't found
            setTimeout(()=>SEND_BLOCKS_AND_GRAB_COMMITMENTS(subchainID),2000)

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

    setTimeout(()=>SEND_BLOCKS_AND_GRAB_COMMITMENTS(subchainID),0)

}




export let USE_TEMPORARY_DB=async(operationType,dbReference,key,value)=>{


    if(operationType === 'get'){

        let value = await dbReference.get(key)

        return value

    }
    else if(operationType === 'put') await dbReference.put(key,value)

    else await dbReference.del(key)

}




let START_BLOCK_GRABBING_PROCESS=async subchain=>{

    let tempObject = TEMP_CACHE_PER_CHECKPOINT.get(CURRENT_CHECKPOINT_ID)

    if(!tempObject){

        setTimeout(()=>START_BLOCK_GRABBING_PROCESS(subchain),100)

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

            blockID = subchain+':'+subchainMetadata.INDEX

            tempObject.CACHE.set('BLOCK_POINTER:'+subchain,subchainMetadata.INDEX)

        }
        
    }
    

    await fetch(`${subchainMetadata.URL}/block/${blockID}`).then(r=>r.json()).then(async block=>{

        LOG(`Received block \u001b[38;5;50m${blockID}`,'S')

        await USE_TEMPORARY_DB('put',tempObject.DATABASE,'BLOCK:'+blockID,block).catch(_=>{})

        
        let nextIndex = tempObject.CACHE.get('BLOCK_POINTER:'+subchain)+1

        tempObject.CACHE.set('BLOCK_POINTER:'+subchain,nextIndex)

        await USE_TEMPORARY_DB('put',tempObject.DATABASE,'BLOCK_POINTER:'+subchain,nextIndex).catch(_=>{})

    }).catch(_=>{})

    // An endless process
    setTimeout(()=>START_BLOCK_GRABBING_PROCESS(subchain),0)


}


let PREPARE_HANDLERS = async () => {

    let tempObject = TEMP_CACHE_PER_CHECKPOINT.get(CURRENT_CHECKPOINT_ID)

    let subchains = Object.keys(tempObject.CHECKPOINT.PAYLOAD.SUBCHAINS_METADATA)

    let subchainsMetadata = tempObject.SUBCHAINS_METADATA // BLS pubkey of pool => {INDEX,HASH,SUPER_FINALIZATION_PROOF,URL}


    for(let subchain of subchains){

        let myMetadataForSubchainForThisCheckpoint = await USE_TEMPORARY_DB('get',tempObject.DATABASE,subchain).catch(_=>false)

        let metadataFromCheckpoint = tempObject.CHECKPOINT.PAYLOAD.SUBCHAINS_METADATA[subchain]

        if(myMetadataForSubchainForThisCheckpoint && myMetadataForSubchainForThisCheckpoint.INDEX > metadataFromCheckpoint.INDEX){

            subchainsMetadata.set(subchain,myMetadataForSubchainForThisCheckpoint)

        }else{

            // Otherwise - assign the data from checkpoint

            subchainsMetadata.set(subchain,metadataFromCheckpoint)

        }

    }

    LOG(`\u001b[38;5;196mSubchains metadata is ready`,'S')

}




export const CHECKPOINT_TRACKER = async () => {

    let stillNoCheckpointOrNextDay = CURRENT_CHECKPOINT_ID === '' || !CHECK_IF_THE_SAME_DAY(TEMP_CACHE_PER_CHECKPOINT.get(CURRENT_CHECKPOINT_ID).CHECKPOINT.TIMESTAMP,GET_GMT_TIMESTAMP())


    if(stillNoCheckpointOrNextDay){

        let latestCheckpointOrError = await fetch(CONFIGS.NODE+'/get_quorum_thread_checkpoint').then(r=>r.json()).catch(error=>error)

        if(latestCheckpointOrError.COMPLETED){

            let nextCheckpointFullID = latestCheckpointOrError.HEADER.PAYLOAD_HASH + latestCheckpointOrError.HEADER.ID

            let tempDatabase = level('TEMP/'+nextCheckpointFullID,{valueEncoding:'json'})

            let tempObject = {

                CHECKPOINT:latestCheckpointOrError,

                SUBCHAINS_METADATA:new Map(),

                CACHE:new Map(),
        
                COMMITMENTS:new Map(), // the first level of "proofs". Commitments is just signatures by some validator from current quorum that validator accept some block X by ValidatorY with hash H
        
                FINALIZATION_PROOFS:new Map(), // aggregated proofs which proof that some validator has 2/3N+1 commitments for block PubX:Y with hash H. Key is blockID and value is FINALIZATION_PROOF object        
        
                HEALTH_MONITORING:new Map(), //used to perform SKIP procedure when we need it and to track changes on subchains. SubchainID => {LAST_SEEN,HEIGHT,HASH,SUPER_FINALIZATION_PROOF:{aggregatedPub,aggregatedSig,afkValidators}}
                
                DATABASE:tempDatabase
        
            }

            // Set to cache
            TEMP_CACHE_PER_CHECKPOINT.set(nextCheckpointFullID,tempObject)

            //________________Close old DB and delete old temporary object________________

            let currentTempObject = TEMP_CACHE_PER_CHECKPOINT.get(CURRENT_CHECKPOINT_ID)

            if(currentTempObject){

                tempObject.CACHE = currentTempObject.CACHE || new Map()//create new cache based on previous one

                tempObject.CACHE.delete('VALIDATORS_URLS') //this value will be new
        
                await currentTempObject.DATABASE.close()

                fs.rm(`.TEMP/${CURRENT_CHECKPOINT_ID}`,{recursive:true},()=>{})

            }

            // Get the new rootpub
            tempObject.CACHE.set('ROOTPUB',bls.aggregatePublicKeys(tempObject.CHECKPOINT.QUORUM))

            //Change the pointer for next checkpoint
            CURRENT_CHECKPOINT_ID = nextCheckpointFullID

            LOG(`\u001b[38;5;154mLatest checkpoint found => \u001b[38;5;93m${latestCheckpointOrError.HEADER.ID} ### ${latestCheckpointOrError.HEADER.PAYLOAD_HASH}\u001b[0m`,'S')

            await PREPARE_HANDLERS()

            // After that - we can start grab commitements and so on with current(latest) version of symbiote state
            
            Object.keys(latestCheckpointOrError.PAYLOAD.SUBCHAINS_METADATA).forEach(subchain=>{

                SEND_BLOCKS_AND_GRAB_COMMITMENTS(subchain)

                START_BLOCK_GRABBING_PROCESS(subchain)

            })

        }else {

            LOG(`Can't get the latest checkpoint => \u001b[0m${latestCheckpointOrError}`,'CD')

            LOG(`Going to wait for a few and repeat`,'I')

        }

    }

    // Repeat each N seconds
    setTimeout(CHECKPOINT_TRACKER,CONFIGS.CHECKPOINT_TRACKER_TIMEOUT)


}