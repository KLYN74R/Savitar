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


import {CHECKPOINT_TRACKER,LOG} from './background.js'
import UWS from 'uWebSockets.js'
import {hash} from 'blake3-wasm'
import fetch from 'node-fetch'
import level from 'level'
import fs from 'fs'


//___________________________________________ CONSTANTS POOL ___________________________________________


// Here will be saved all the progress(proofs,heights,state etc.)

global.STORAGE = level('STORAGE')

global.CONFIGS = JSON.parse(fs.readFileSync('./configs.json'))



// Functions pool

const BLAKE3 = v => hash(v).toString('hex')

const GEN_HASH = block => BLAKE3( block.creator + block.time + JSON.stringify(block.events) + CONFIGS.SYMBIOTE_ID + block.index + block.prevHash)



//____________________________________________ ART OUTPUT ______________________________________________


let art = fs.readFileSync('./art.txt').toString()

    .replaceAll('█','\u001b[38;5;154m█\u001b[0m')

    .replaceAll('@','\u001b[38;5;57m_,\u001b[0m')

    .replaceAll('|','\u001b[38;5;57m|\u001b[0m')

    .replaceAll('^','\u001b[38;5;57m._\u001b[0m')

    .replace('~~~','\u001b[38;5;63mhttps://github.com/KLYN74R/Savitar\u001b[0m')



console.log(art,'\n\n')


//_ GET THE LATEST CHECKPOINT AND START TO FIND SUPER_FINALIZATIONS_PROOFS BASED ON SUBCHAINS_METADATA _


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



// GET_SUPER_FINALIZATION_PROOFS(TESTNET_NODES[0])
// GET_SUPER_FINALIZATION_PROOFS(TESTNET_NODES[1])
// GET_SUPER_FINALIZATION_PROOFS(TESTNET_NODES[2])


CHECKPOINT_TRACKER()



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