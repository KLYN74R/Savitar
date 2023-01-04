/**
 * 
 *                          ███████╗ █████╗ ██╗   ██╗██╗████████╗ █████╗ ██████╗ 
 *                          ██╔════╝██╔══██╗██║   ██║██║╚══██╔══╝██╔══██╗██╔══██╗
 *                          ███████╗███████║██║   ██║██║   ██║   ███████║██████╔╝
 *                          ╚════██║██╔══██║╚██╗ ██╔╝██║   ██║   ██╔══██║██╔══██╗
 *                          ███████║██║  ██║ ╚████╔╝ ██║   ██║   ██║  ██║██║  ██║
 *                          ╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝
 *                                                    
 *                                               29.12.2022
 * 
 * 
 * */


//__________________________________________ TABLE OF IMPORTS __________________________________________

import UWS from 'uWebSockets.js'
import {hash} from 'blake3-wasm'
import fetch from 'node-fetch'
import bls from './bls.js'
import level from 'level'
import fs from 'fs'

//___________________________________________ CONSTANTS POOL ___________________________________________


// Here will be saved all the progress(proofs,heights,state etc.)

const STORAGE = level('STORAGE')

const CONFIGS = JSON.parse(fs.readFileSync('./configs.json'))

// It's mutable var
let CURRENT_CHECKPOINT = {}




// Functions pool

const BLAKE3 = v => hash(v).toString('hex')

const GEN_HASH = block => BLAKE3( block.creator + block.time + JSON.stringify(block.events) + CONFIGS.SYMBIOTE_ID + block.index + block.prevHash)

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

const COLORS = {
    C:'\x1b[0m',
    T:`\u001b[38;5;23m`, // for time view
    F:'\x1b[31;1m', // red(error,no collapse,problems with sequence,etc.)
    S:'\x1b[32;1m', // green(new block, exported something, something important, etc.)
    W:'\u001b[38;5;3m', // yellow(non critical warnings)
    I:'\x1b[36;1m', // cyan(default messages useful to grasp the events)
    CB:'\u001b[38;5;200m',// ControllerBlock
    CD:`\u001b[38;5;50m`,//Canary died
    GTS:`\u001b[38;5;m`,//Generation Thread Stop
    CON:`\u001b[38;5;168m`//CONFIGS
}

const LOG=(msg,msgColor)=>{

    console.log(COLORS.T,`[${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}]\u001b[38;5;99m(pid:${process.pid})`,COLORS[msgColor],msg,COLORS.C)

}



//____________________________________________ ART OUTPUT ______________________________________________


let art = fs.readFileSync('./art.txt').toString()

    .replaceAll('█','\u001b[38;5;154m█\u001b[0m')

    .replaceAll('@','\u001b[38;5;57m_,\u001b[0m')

    .replaceAll('|','\u001b[38;5;57m|\u001b[0m')

    .replaceAll('^','\u001b[38;5;57m._\u001b[0m')

    .replace('~~~','\u001b[38;5;63mhttps://github.com/KLYN74R/Savitar\u001b[0m')



console.log(art,'\n\n')




//_ GET THE LATEST CHECKPOINT AND START TO FIND SUPER_FINALIZATIONS_PROOFS BASED ON SUBCHAINS_METADATA _


let latestCheckpointOrError = await fetch(CONFIGS.NODE+'/get_quorum_thread_checkpoint').then(r=>r.json()).catch(error=>error)


if(latestCheckpointOrError.QUORUM){

    LOG(`Latest checkpoint found => ${latestCheckpointOrError.HEADER.ID} ### ${latestCheckpointOrError.HEADER.PAYLOAD_HASH}`,'CD')

    CURRENT_CHECKPOINT = latestCheckpointOrError

    console.log(CURRENT_CHECKPOINT)

}else LOG(`Can't get the latest checkpoint => \u001b[0m${latestCheckpointOrError}`,'CD')



let TESTNET_NODES=[

    {
        url:'http://localhost:7331',
        pubKey:"7GPupbq1vtKUgaqVeHiDbEJcxS7sSjwPnbht4eRaDBAEJv8ZKHNCSu2Am3CuWnHjta",
        startFrom:0,
        query:-1
    
    },
    {
        url:'http://localhost:7332',
        pubKey:"75XPnpDxrAtyjcwXaATfDhkYTGBoHuonDU1tfqFc6JcNPf5sgtcsvBRXaXZGuJ8USG",
        startFrom:0,
        query:-1
    
    },
    {
        url:'http://localhost:7333',
        pubKey:"61TXxKDrBtb7bjpBym8zS9xRDoUQU6sW9aLvvqN9Bp9LVFiSxhRPd9Dwy3N3621RQ8",
        startFrom:0,
        query:-1
    
    }

]


let GET_SUPER_FINALIZATION_PROOFS=async node=>{

    let blockID = node.pubKey+':'+node.startFrom

    await fetch(`${node.url}/block/${blockID}`).then(r=>r.json()).then(async block=>{

        let blockHash = GEN_HASH(block)

        // Based on blockID and hash - get the SUPER_FINALIZATION_PROOFS

        let sfp = await fetch(`${node.url}/get_super_finalization/${blockID+blockHash}`).then(r=>r.json()).catch(_=>false)

        if(sfp){

            LOG(`Received SFP for block \u001b[38;5;50m${blockID} \u001b[38;5;219m(hash:${blockHash})`,'S')

            node.startFrom++

        }

    }).catch(_=>{})


    // An endless process
    setTimeout(()=>GET_SUPER_FINALIZATION_PROOFS(node),0)


}



GET_SUPER_FINALIZATION_PROOFS(TESTNET_NODES[0])
GET_SUPER_FINALIZATION_PROOFS(TESTNET_NODES[1])
GET_SUPER_FINALIZATION_PROOFS(TESTNET_NODES[2])




//______________________________ API SECTION ______________________________




UWS.App()


.get('/health',response=>response.end("Not on my shift"))

.get('/super_finalization_proof/:blockID',(response,request)=>{

    // .writeHeader('Access-Control-Allow-Origin','*')
    // .writeHeader('Cache-Control',`max-age=${CONFIG.SYMBIOTE.TTL.GET_QUORUM_THREAD_CHECKPOINT}`)
    // .onAborted(()=>response.aborted=true)


})

// To check the status of some tx
.get('/tx_status/:sighash',(response,request)=>{

    

})


.listen(CONFIGS.SERVER_CONFIGS.INTERFACE,CONFIGS.SERVER_CONFIGS.PORT,_=>{

    LOG(`API server started on ${CONFIGS.SERVER_CONFIGS.INTERFACE}:${CONFIGS.SERVER_CONFIGS.PORT}`,'CON')

})