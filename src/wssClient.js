import {START_BLOCK_GRABBING_PROCESS,START_PROOFS_GRABBING,WSS_HANDLERS,LOG,PATH_RESOLVE} from './functionality.js'

import {SocksProxyAgent} from 'socks-proxy-agent'

import WS from 'websocket'

import fs from 'fs'




/**
 * 
 * @param {*} poolID 
 * @param {*} wssURL 
 * @param {*} primePoolsArray 
 * @param {Array.<string>} quorum 
 */
export let OPEN_WSS_CONNECTION_AND_START_ALL_PROCEDURES=async(poolID,wssURL,noChecks)=>{

    let WebSocketClient = WS.client
    
    let client = new WebSocketClient({
        
        tlsOptions:{
        
            // With TLS
            ca:fs.readFileSync(PATH_RESOLVE('certificates/2022.crt')),

            // agent:new SocksProxyAgent('socks5h://127.0.0.1:5666')
        
        }
    
    })
    
    
    // Connect to remote WSS server
    client.connect(wssURL,'echo-protocol')
    

    client.on('connect',connection => {

        // Add connection to temporary cache
    
        let currentTempObject = global.TEMP_CACHE_PER_CHECKPOINT.get(global.CURRENT_CHECKPOINT_FULL_ID)
        
        // Handler on incoming messages
        connection.on('message',message=>{

            if(message.type === 'utf8'){

                let data = JSON.parse(message.utf8Data)

                if(WSS_HANDLERS.has(data.type)){
    
                    WSS_HANDLERS.get(data.type)(poolID,data.payload)
        
                }    

            }
                  
        })
        
    
        connection.on('close',(code,description) =>
        
            LOG(`Closed connection with ${connection.remoteAddress} => ${code}      |       ${description}`,'FAIL')
        
        )
    
        connection.on('error',error=>

            LOG(`Error occured with ${connection.remoteAddress} => ${error}`,'FAIL')

        )


        // After all - set connection to gloabally available mapping
    
        currentTempObject.WSS_CONNECTIONS.set(poolID,connection)

        //____________________________ START ALL THE PROCEDURES ____________________________

        let itsPrimePoolAndMarkedAsPreffered = !currentTempObject.POOLS_METADATA.get(poolID).isReserve && (global.configs.prefferedSubchains === '*' || global.configs.prefferedSubchains.includes(poolID))

        if(itsPrimePoolAndMarkedAsPreffered || noChecks){

            START_PROOFS_GRABBING(poolID)

            START_BLOCK_GRABBING_PROCESS(poolID)

        }
        
    })


    client.on('connectFailed',error=>{

        LOG(`Failed to connect to \u001b[38;5;154m${wssURL} \u001b[38;5;50m=> \u001b[38;5;196m${error}`,'INFO')

        // Repeat to connect after a while

        // setTimeout(()=>OPEN_WSS_CONNECTION_AND_START_ALL_PROCEDURES(poolID,wssURL),3000)

    })


}