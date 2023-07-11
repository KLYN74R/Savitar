import {OPEN_WSS_CONNECTION_AND_START_ALL_PROCEDURES} from './wssClient.js'
import {LOG,REASSIGNMENTS_MONITORING,USE_TEMPORARY_DB} from './functionality.js'
import fetch from 'node-fetch'
import bls from './bls.js'
import level from 'level'
import fs from 'fs'




//___________________________________________ CONSTANTS POOL ___________________________________________




global.TEMP_CACHE_PER_CHECKPOINT = new Map() // checkpointFullID => {CHECKPOINT,DATABASE,POOLS_METADATA,...}

global.CURRENT_CHECKPOINT_ID = '' // PAYLOAD_HASH+"#"+INDEX


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





let PREPARE_HANDLERS = async() => {

    let tempObject = TEMP_CACHE_PER_CHECKPOINT.get(CURRENT_CHECKPOINT_ID)

    let poolsPubKeys = Object.keys(tempObject.CHECKPOINT.payload.poolsMetadata)

    let subchainsMetadata = tempObject.POOLS_METADATA // BLS pubkey of pool => {index,hash,aggregatedFinalizationProof,url}


    for(let poolPubKey of poolsPubKeys){

        let myMetadataForSubchainForThisCheckpoint = await USE_TEMPORARY_DB('get',tempObject.DATABASE,poolPubKey).catch(_=>false)

        let metadataFromCheckpoint = tempObject.CHECKPOINT.payload.poolsMetadata[poolPubKey]

        if(myMetadataForSubchainForThisCheckpoint && myMetadataForSubchainForThisCheckpoint.index > metadataFromCheckpoint.index){

            subchainsMetadata.set(poolPubKey,myMetadataForSubchainForThisCheckpoint)

        }else{

            // Otherwise - assign the data from checkpoint

            subchainsMetadata.set(poolPubKey,metadataFromCheckpoint)

        }

    }

    LOG(`Pools metadata was built`,'CD')

}



let PREPARATION_TO_WORK = async poolPubKey => {

    let poolOriginSubchain = await fetch(`${global.configs.node}/state/X/${poolPubKey}(POOL)_POINTER`).then(r=>r.json()).catch(_=>false)

    if(poolOriginSubchain){

        let possiblePoolData = await fetch(`${global.configs.node}/state/${poolOriginSubchain}/${poolPubKey}(POOL)_STORAGE_POOL`).then(r=>r.json()).catch(_=>console.log(_))

        if(possiblePoolData.wssPoolURL){
            
            OPEN_WSS_CONNECTION_AND_START_ALL_PROCEDURES(poolPubKey,possiblePoolData.wssPoolURL)
            
        }else setTimeout(()=>PREPARATION_TO_WORK(poolPubKey),2000)


    } else setTimeout(()=>PREPARATION_TO_WORK(poolPubKey),2000)

}




export const CHECKPOINT_TRACKER = async() => {

    let stillNoCheckpointOrNextDay = CURRENT_CHECKPOINT_ID === '' || !CHECK_IF_THE_SAME_DAY(TEMP_CACHE_PER_CHECKPOINT.get(CURRENT_CHECKPOINT_ID).CHECKPOINT.TIMESTAMP,GET_GMT_TIMESTAMP())


    if(stillNoCheckpointOrNextDay){

        let latestCheckpointOrError = await fetch(global.configs.node+'/quorum_thread_checkpoint').then(r=>r.json()).catch(error=>error)

        let nextCheckpointFullID = latestCheckpointOrError?.header?.payloadHash + '#' + latestCheckpointOrError?.header?.id

        if(latestCheckpointOrError.completed && nextCheckpointFullID !== CURRENT_CHECKPOINT_ID){

            let tempDatabase = level('TEMP/'+nextCheckpointFullID,{valueEncoding:'json'})

            let tempObject = {

                CHECKPOINT:latestCheckpointOrError,

                POOLS_METADATA:new Map(),

                WSS_CONNECTIONS:new Map(), // pubKey => WSS connection object

                CACHE:new Map(),
        
                COMMITMENTS:new Map(), // the first level of "proofs". Commitments is just signatures by some validator from current quorum that validator accept some block X by ValidatorY with hash H
        
                FINALIZATION_PROOFS:new Map(), // aggregated proofs which proof that some validator has 2/3N+1 commitments for block PubX:Y with hash H. Key is blockID and value is FINALIZATION_PROOF object        
        
                HEALTH_MONITORING:new Map(), //used to perform SKIP procedure when we need it and to track changes on subchains. PoolPubKey => {lastSeen,index,hash,aggregatedFinalizationProof:{aggregatedPub,aggregatedSignature,afkVoters}}
                
                DATABASE:tempDatabase
        
            }

            // Set to cache
            TEMP_CACHE_PER_CHECKPOINT.set(nextCheckpointFullID,tempObject)

            //________________Close old DB and delete old temporary object________________

            let currentTempObject = TEMP_CACHE_PER_CHECKPOINT.get(CURRENT_CHECKPOINT_ID)

            if(currentTempObject){

                tempObject.CACHE = currentTempObject.CACHE || new Map()//create new cache based on previous one

                //Close wss connections
                tempObject.WSS_CONNECTIONS.forEach(connection=>connection.close())

                await currentTempObject.DATABASE.close()
            
                fs.rm(`.TEMP/${CURRENT_CHECKPOINT_ID}`,{recursive:true},()=>{})

            }

            // Get the new rootpub
            tempObject.CACHE.set('ROOTPUB',bls.aggregatePublicKeys(tempObject.CHECKPOINT.quorum))

            // Clear old cache
            TEMP_CACHE_PER_CHECKPOINT.delete(CURRENT_CHECKPOINT_ID)

            //Change the pointer for next checkpoint
            CURRENT_CHECKPOINT_ID = nextCheckpointFullID

            LOG(`\u001b[38;5;154mLatest checkpoint found => \u001b[38;5;93m${latestCheckpointOrError.header.id} ### ${latestCheckpointOrError.header.payloadHash}\u001b[0m`,'S')

            await PREPARE_HANDLERS()

            // After that - we can start grab commitements and so on with current(latest) version of symbiote state
            
            Object.keys(latestCheckpointOrError.payload.poolsMetadata).forEach(poolPubKey=>

                PREPARATION_TO_WORK(poolPubKey)

            )

            // Also, start to monitor reassignments
            //REASSIGNMENTS_MONITORING()

        }else LOG(`Can't get the latest checkpoint. Going to wait for a few and repeat`,'F')

    }

    // Repeat each N seconds
    setTimeout(CHECKPOINT_TRACKER,global.configs.checkpointTrackerTimeout)


}