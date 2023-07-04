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


import {LOG,USE_TEMPORARY_DB} from './functionality.js'
import {CHECKPOINT_TRACKER} from './background.js'
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

.get('/aggregated_finalization_proof/:BLOCK_ID',async(response,request)=>{

    response.onAborted(()=>response.aborted=true).writeHeader('Access-Control-Allow-Origin','*')


    if(CONFIGS.SERVER_TRIGGERS.AGGREGATED_FINALIZATION_PROOF){

        if(CURRENT_CHECKPOINT_ID===''){

            !response.aborted && response.end(JSON.stringify({error:'Checkpoint is not ready'}))

            return
        }

        let tempObject = TEMP_CACHE_PER_CHECKPOINT.get(CURRENT_CHECKPOINT_ID)

        if(!tempObject){
            
            !response.aborted && response.end(JSON.stringify({error:'Checkpoint is not ready'}))
    
            return
    
        }

        let aggregatedFinalizationProof = await USE_TEMPORARY_DB('get',tempObject.DATABASE,'AFP:'+request.getParameter(0)).catch(_=>false)

        if(aggregatedFinalizationProof){

            !response.aborted && response.end(JSON.stringify(aggregatedFinalizationProof))

        }else !response.aborted && response.end(JSON.stringify({error:'No AFP for a given block'}))

    }else !response.aborted && response.end(JSON.stringify({error:'Route is off'}))


})

.get('/skip_procedure_stage_3/:SUBCHAIN',async (response,request) => {

    response.onAborted(()=>response.aborted=true).writeHeader('Access-Control-Allow-Origin','*')

    if(CONFIGS.SERVER_TRIGGERS.GET_SKIP_STAGE_3){

        let subchain = request.getParameter(0)

        let tempObject = TEMP_CACHE_PER_CHECKPOINT.get(CURRENT_CHECKPOINT_ID)
    
        if(CURRENT_CHECKPOINT_ID==='' || !tempObject){

            !response.aborted && response.end(JSON.stringify({error:'Checkpoint is not ready'}))
            
            return
        }
    

        let skipStage3Proof = await USE_TEMPORARY_DB('get',tempObject.DATABASE,'SKIP_STAGE_3:'+subchain).catch(_=>false)
    
    
        if(skipStage3Proof) !response.aborted && response.end(JSON.stringify(skipStage3Proof))
    
        else !response.aborted && response.end(JSON.stringify({error:'No SKIP_STAGE_3 for given subchain'}))
    
    
    } else !response.aborted && response.end(JSON.stringify({error:'Route is off'}))
    
})


.listen(CONFIGS.SERVER_CONFIGS.INTERFACE,CONFIGS.SERVER_CONFIGS.PORT,_=>{

    LOG(`API server started on \u001b[38;5;196m${CONFIGS.SERVER_CONFIGS.INTERFACE}:${CONFIGS.SERVER_CONFIGS.PORT}`,'CD')

})