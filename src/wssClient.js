import {
    
    WSS_HANDLERS,LOG,PATH_RESOLVE,
    
    START_BLOCK_GRABBING_PROCESS,SKIP_STAGE_3_MONITORING,SEND_BLOCKS_AND_GRAB_COMMITMENTS

} from './functionality.js'


import WS from 'websocket'
import fs from 'fs'


import {SocksProxyAgent} from 'socks-proxy-agent'



export let OPEN_WSS_CONNECTION_AND_START_ALL_PROCEDURES=async(poolID,wssURL)=>{

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
    
        let currentTempObject = TEMP_CACHE_PER_CHECKPOINT.get(CURRENT_CHECKPOINT_ID)
        
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
        
            LOG(`Closed connection with ${connection.remoteAddress} => ${code}      |       ${description}`,'F')
        
        )
    
        connection.on('error',error=>

            LOG(`Error occured with ${connection.remoteAddress} => ${error}`,'F')

        )


        // After all - set connection to gloabally available mapping
    
        currentTempObject.WSS_CONNECTIONS.set(poolID,connection)

        //____________________________ START ALL THE PROCEDURES ____________________________

        //SEND_BLOCKS_AND_GRAB_COMMITMENTS(poolID)

        START_BLOCK_GRABBING_PROCESS(poolID)

        //SKIP_STAGE_3_MONITORING(poolID)
          
        
    })


    client.on('connectFailed',error=>{

        LOG(`Failed to connect to ${wssURL} => ${error}`,'CD')

    })


}