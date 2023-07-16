import {OPEN_WSS_CONNECTION_AND_START_ALL_PROCEDURES} from './wssClient.js'
import {LOG,REASSIGNMENTS_MONITORING,USE_TEMPORARY_DB} from './functionality.js'
import fetch from 'node-fetch'
import bls from './bls.js'
import level from 'level'
import fs from 'fs'




//___________________________________________ CONSTANTS POOL ___________________________________________




global.TEMP_CACHE_PER_CHECKPOINT = new Map() // checkpointFullID => {CHECKPOINT,DATABASE,POOLS_METADATA,...}

global.CURRENT_CHECKPOINT_FULL_ID = '' // PAYLOAD_HASH+"#"+INDEX


global.__dirname = await import('path').then(async mod=>
  
    mod.dirname(
      
      (await import('url')).fileURLToPath(import.meta.url)
      
    )

)


let CHECK_IF_THE_SAME_DAY=(timestamp1,timestamp2)=>{

    let date1 = new Date(timestamp1),
        
        date2 = new Date(timestamp2)
    
    return date1.getFullYear() === date2.getFullYear() && date1.getMonth() === date2.getMonth() && date1.getDate() === date2.getDate()

}

let GET_GMT_TIMESTAMP=()=>{

    var currentTime = new Date();
    
    //The offset is in minutes -- convert it to ms
    //See https://stackoverflow.com/questions/9756120/how-do-i-get-a-utc-timestamp-in-javascript
    return currentTime.getTime() + currentTime.getTimezoneOffset() * 60000;
}





let PREPARE_POOL_METADATA = async() => {

    let tempObject = global.TEMP_CACHE_PER_CHECKPOINT.get(global.CURRENT_CHECKPOINT_FULL_ID)

    let poolsPubKeys = Object.keys(tempObject.CHECKPOINT.payload.poolsMetadata)

    let poolsMetadata = tempObject.POOLS_METADATA // BLS pubkey of pool => {index,hash,isReserve,currentAuthority(?),aggregatedFinalizationProof,url}


    for(let poolPubKey of poolsPubKeys){

        let myMetadataForPoolForThisCheckpoint = await USE_TEMPORARY_DB('get',tempObject.DATABASE,poolPubKey).catch(_=>false)

        let metadataFromCheckpoint = tempObject.CHECKPOINT.payload.poolsMetadata[poolPubKey]

        if(myMetadataForPoolForThisCheckpoint){

            poolsMetadata.set(poolPubKey,myMetadataForPoolForThisCheckpoint)

        }else{

            // Otherwise - assign the data from checkpoint

            // Only prime pools have this property

            if(!metadataFromCheckpoint.isReserve) metadataFromCheckpoint.currentAuthority = -1

            poolsMetadata.set(poolPubKey,metadataFromCheckpoint)

        }

    }

    LOG(`Pools metadata was built`,'INFO')

}



export let GET_WSS_ADDRESS_AND_OPEN_CONNECTION = async (poolPubKey,noChecks) => {

    let poolOriginSubchain = await fetch(`${global.configs.node}/state/X/${poolPubKey}(POOL)_POINTER`).then(r=>r.json()).catch(_=>false)

    if(poolOriginSubchain){

        let possiblePoolData = await fetch(`${global.configs.node}/state/${poolOriginSubchain}/${poolPubKey}(POOL)_STORAGE_POOL`).then(r=>r.json()).catch(_=>false)

        if(possiblePoolData?.wssPoolURL){
            
            OPEN_WSS_CONNECTION_AND_START_ALL_PROCEDURES(poolPubKey,possiblePoolData.wssPoolURL,noChecks)
            
        }else{
            
            LOG(`Can't get the WSS address for pool \u001b[38;5;154m ${poolPubKey}`,'FAIL')

            setTimeout(()=>GET_WSS_ADDRESS_AND_OPEN_CONNECTION(poolPubKey,noChecks),2000)

        }


    } else {

        LOG(`Can't get pointer for pool \u001b[38;5;154m ${poolPubKey}`,'FAIL')

        setTimeout(()=>GET_WSS_ADDRESS_AND_OPEN_CONNECTION(poolPubKey,noChecks),2000)

    }

}




export const CHECKPOINT_TRACKER = async() => {

    let stillNoCheckpointOrNextDay = global.CURRENT_CHECKPOINT_FULL_ID === '' || !CHECK_IF_THE_SAME_DAY(global.TEMP_CACHE_PER_CHECKPOINT.get(global.CURRENT_CHECKPOINT_FULL_ID).CHECKPOINT.TIMESTAMP,GET_GMT_TIMESTAMP())


    if(stillNoCheckpointOrNextDay){

        let latestCheckpointOrError = await fetch(global.configs.node+'/quorum_thread_checkpoint').then(r=>r.json()).catch(error=>error)

        let nextCheckpointFullID = latestCheckpointOrError?.header?.payloadHash + '#' + latestCheckpointOrError?.header?.id


        if(latestCheckpointOrError.completed && nextCheckpointFullID !== global.CURRENT_CHECKPOINT_FULL_ID){

            let tempDatabase = level('TEMP/'+nextCheckpointFullID,{valueEncoding:'json'})

            let tempObject = {

                CHECKPOINT:latestCheckpointOrError,

                POOLS_METADATA:new Map(), // poolPubKey => {index,hash,isReserve,currentAuthority(?),aggregatedFinalizationProof,url}

                WSS_CONNECTIONS:new Map(), // pubKey => WSS connection object

                CACHE:new Map(),
        
                COMMITMENTS:new Map(), // the first level of "proofs". Commitments is just signatures by some validator from current quorum that validator accept some block X by ValidatorY with hash H
        
                FINALIZATION_PROOFS:new Map(), // aggregated proofs which proof that some validator has 2/3N+1 commitments for block PubX:Y with hash H. Key is blockID and value is FINALIZATION_PROOF object        
                        
                DATABASE:tempDatabase
        
            }

            // Set to cache
            global.TEMP_CACHE_PER_CHECKPOINT.set(nextCheckpointFullID,tempObject)


            //________________Close old DB and delete old temporary object________________

            let currentTempObject = global.TEMP_CACHE_PER_CHECKPOINT.get(global.CURRENT_CHECKPOINT_FULL_ID)

            if(currentTempObject){

                tempObject.CACHE = currentTempObject.CACHE || new Map()//create new cache based on previous one

                //Close wss connections
                tempObject.WSS_CONNECTIONS.forEach(connection=>connection.close())

                await currentTempObject.DATABASE.close()
            
                fs.rm(`.TEMP/${global.CURRENT_CHECKPOINT_FULL_ID}`,{recursive:true},()=>{})

            }

            // Get the new rootpub
            tempObject.CACHE.set('ROOTPUB',bls.aggregatePublicKeys(tempObject.CHECKPOINT.quorum))

            // Clear old cache
            global.TEMP_CACHE_PER_CHECKPOINT.delete(global.CURRENT_CHECKPOINT_FULL_ID)

            //Change the pointer for next checkpoint
            global.CURRENT_CHECKPOINT_FULL_ID = nextCheckpointFullID

            LOG(`\u001b[38;5;154mLatest checkpoint found => \u001b[38;5;93m${latestCheckpointOrError.header.id} ### ${latestCheckpointOrError.header.payloadHash}\u001b[0m`,'SUCCESS')

            await PREPARE_POOL_METADATA()

            // After that - we can start grab commitements and so on with current(latest) version of symbiote state

            let onlyPrimePools = Object.keys(latestCheckpointOrError.payload.poolsMetadata).filter(
                
                poolPubKey => !latestCheckpointOrError.payload.poolsMetadata[poolPubKey].isReserve
                
            )

            // Connect to quorum + subchains authorities only - no sense to open connection to other subjects

            let openConnectionWith = new Set(latestCheckpointOrError.quorum.concat(onlyPrimePools))
            
            openConnectionWith.forEach(poolPubKey=>

                GET_WSS_ADDRESS_AND_OPEN_CONNECTION(poolPubKey)

            )

            // Also, start to monitor reassignments
            REASSIGNMENTS_MONITORING()

        }else LOG(`Can't get the latest checkpoint. Going to wait for a few and repeat`,'FAIL')

    }

    // Repeat each N seconds
    setTimeout(CHECKPOINT_TRACKER,global.configs.checkpointTrackerTimeout)


}