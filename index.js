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
import fs from 'fs'


//___________________________________________ CONSTANTS POOL ___________________________________________


global.CONFIGS = JSON.parse(fs.readFileSync('./configs.json'))


//____________________________________________ ART OUTPUT ______________________________________________


let art = fs.readFileSync('./art.txt').toString()

    .replaceAll('█','\u001b[38;5;154m█\u001b[0m')

    .replaceAll('@','\u001b[38;5;57m_,\u001b[0m')

    .replaceAll('|','\u001b[38;5;57m|\u001b[0m')

    .replaceAll('^','\u001b[38;5;57m._\u001b[0m')

    .replace('~~~','\u001b[38;5;63mhttps://github.com/KLYN74R/Savitar\u001b[0m')



console.log(art,'\n\n')



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