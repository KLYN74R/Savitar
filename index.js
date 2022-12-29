/**
 * 
 *           ███████╗ █████╗ ██╗   ██╗██╗████████╗ █████╗ ██████╗ 
 *           ██╔════╝██╔══██╗██║   ██║██║╚══██╔══╝██╔══██╗██╔══██╗
 *           ███████╗███████║██║   ██║██║   ██║   ███████║██████╔╝
 *           ╚════██║██╔══██║╚██╗ ██╔╝██║   ██║   ██╔══██║██╔══██╗
 *           ███████║██║  ██║ ╚████╔╝ ██║   ██║   ██║  ██║██║  ██║
 *           ╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝
 *                                                    
 *                              29.12.2022
 * 
 * 
 */

// import UWS from 'uWebSockets.js'
import {hash} from 'blake3-wasm'
import fetch from 'node-fetch'
import bls from './bls.js'
import fs from 'fs'


console.log(fs.readFileSync('./art.txt').toString(),'\n\n')


const CONFIGS = JSON.parse(fs.readFileSync('./configs.json'))

const TESTNET_NODES=[

    {
        url:'http://localhost:6666',
        pubKey:"7GPupbq1vtKUgaqVeHiDbEJcxS7sSjwPnbht4eRaDBAEJv8ZKHNCSu2Am3CuWnHjta",
        startFrom:1700
    
    },
    {
        url:'http://localhost:6665',
        pubKey:"75XPnpDxrAtyjcwXaATfDhkYTGBoHuonDU1tfqFc6JcNPf5sgtcsvBRXaXZGuJ8USG",
        startFrom:1400
    
    },
    // {
    //     url:'http://localhost:6664',
    //     pubKey:"61TXxKDrBtb7bjpBym8zS9xRDoUQU6sW9aLvvqN9Bp9LVFiSxhRPd9Dwy3N3621RQ8",
    //     startFrom:1700
    
    // }

]

const BLAKE3 = v => hash(v).toString('hex')

const GEN_HASH = block => BLAKE3( block.creator + block.time + JSON.stringify(block.events) + CONFIGS.SYMBIOTE_ID + block.index + block.prevHash)

const BLS_VERIFY = async(data,pubKey,signa) => bls.singleVerify(data,pubKey,signa)




let NO_MORE_BLOCKS={
    "7GPupbq1vtKUgaqVeHiDbEJcxS7sSjwPnbht4eRaDBAEJv8ZKHNCSu2Am3CuWnHjta":false,
    "75XPnpDxrAtyjcwXaATfDhkYTGBoHuonDU1tfqFc6JcNPf5sgtcsvBRXaXZGuJ8USG":false,
    "61TXxKDrBtb7bjpBym8zS9xRDoUQU6sW9aLvvqN9Bp9LVFiSxhRPd9Dwy3N3621RQ8":false
}

let GET_SUPER_FINALIZATION_PROOFS=async()=>{

    for(let node of TESTNET_NODES){

        // Not to request twice
        if(node.current===node.startFrom) {

            continue

        }else node.current=node.startFrom


        let blockID = node.pubKey+':'+node.startFrom

        fetch(`${node.url}/block/${blockID}`).then(r=>r.json()).then(async block=>{

            let blockHash = GEN_HASH(block)

            // Based on blockID and hash - get the SUPER_FINALIZATION_PROOFS

            let sfp = await fetch(`${node.url}/get_super_finalization/${blockID+blockHash}`).then(r=>r.json()).catch(_=>false)

            if(sfp){

                console.log(`Received SFP for block ${blockID} => ${JSON.stringify(sfp)}`)

                node.startFrom++

            }else node.startFrom-- //step back

        }).catch(_=>{

            NO_MORE_BLOCKS[node.pubKey]=true

        })

    }

    // An endless process
    setTimeout(GET_SUPER_FINALIZATION_PROOFS,0)

    if(Object.values(NO_MORE_BLOCKS).every(Boolean)){

        process.exit(1)

    }

}


GET_SUPER_FINALIZATION_PROOFS()


setInterval(()=>{

    console.log(`\n\u001b[38;5;50m[STATS]\x1b[0m NO_MORE_BLOCKS = ${Object.values(NO_MORE_BLOCKS)}\n`)

},2000)

// let RUN_FINALIZATION_PROOFS_GRABBING = async (qtPayload,blockID) => {

//     let block = await SYMBIOTE_META.BLOCKS.get(blockID).catch(_=>false)

//     let blockHash = Block.genHash(block)

//     let {COMMITMENTS,FINALIZATION_PROOFS,DATABASE} = SYMBIOTE_META.TEMP.get(qtPayload)

//     //Create the mapping to get the FINALIZATION_PROOFs from the quorum members. Inner mapping contains voterValidatorPubKey => his FINALIZATION_PROOF   
    
//     FINALIZATION_PROOFS.set(blockID,new Map())

//     let finalizationProofsMapping = FINALIZATION_PROOFS.get(blockID)

//     let aggregatedCommitments = COMMITMENTS.get(blockID) //voterValidatorPubKey => his commitment 


//     let optionsToSend = {method:'POST',body:JSON.stringify(aggregatedCommitments)},

//         quorumMembers = await GET_VALIDATORS_URLS(true),

//         majority = GET_MAJORITY('QUORUM_THREAD'),

//         promises=[]


//     if(finalizationProofsMapping.size<majority){

//         //Descriptor is {url,pubKey}
//         for(let descriptor of quorumMembers){

//             // No sense to get the commitment if we already have
//             if(finalizationProofsMapping.has(descriptor.pubKey)) continue
    
    
//             let promise = fetch(descriptor.url+'/finalization',optionsToSend).then(r=>r.text()).then(async possibleFinalizationProof=>{
    
//                 let finalProofIsOk = await bls.singleVerify(blockID+blockHash+'FINALIZATION'+qtPayload,descriptor.pubKey,possibleFinalizationProof).catch(_=>false)
    
//                 if(finalProofIsOk) finalizationProofsMapping.set(descriptor.pubKey,possibleFinalizationProof)
    
//             }).catch(_=>false)
    

//             // To make sharing async
//             promises.push(promise)
    
//         }
    
//         await Promise.all(promises)

//     }




//     //_______________________ It means that we now have enough FINALIZATION_PROOFs for appropriate block. Now we can start to generate SUPER_FINALIZATION_PROOF _______________________


//     if(finalizationProofsMapping.size>=majority){

//         // In this case , aggregate FINALIZATION_PROOFs to get the SUPER_FINALIZATION_PROOF and share over the network
//         // Also, increase the counter of SYMBIOTE_META.STATIC_STUFF_CACHE.get('BLOCK_SENDER_HANDLER') to move to the next block and udpate the hash
    
//         let signers = [...finalizationProofsMapping.keys()]

//         let signatures = [...finalizationProofsMapping.values()]

//         let afkValidators = SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.QUORUM.filter(pubKey=>!signers.includes(pubKey))


//         /*
        
//         Aggregated version of FINALIZATION_PROOFs (it's SUPER_FINALIZATION_PROOF)
        
//         {
        
//             blockID:"7cBETvyWGSvnaVbc7ZhSfRPYXmsTzZzYmraKEgxQMng8UPEEexpvVSgTuo8iza73oP:1337",

//             blockHash:"0123456701234567012345670123456701234567012345670123456701234567",
        
//             aggregatedPub:"7cBETvyWGSvnaVbc7ZhSfRPYXmsTzZzYmraKEgxQMng8UPEEexpvVSgTuo8iza73oP",

//             aggregatedSigna:"kffamjvjEg4CMP8VsxTSfC/Gs3T/MgV1xHSbP5YXJI5eCINasivnw07f/lHmWdJjC4qsSrdxr+J8cItbWgbbqNaM+3W4HROq2ojiAhsNw6yCmSBXl73Yhgb44vl5Q8qD",

//             afkValidators:[]

//         }
    

//         */

//         let superFinalizationProof = {

//             blockID,
            
//             blockHash,
            
//             aggregatedPub:bls.aggregatePublicKeys(signers),
            
//             aggregatedSignature:bls.aggregateSignatures(signatures),
            
//             afkValidators

//         }

//         //Share here
//         BROADCAST('/super_finalization',superFinalizationProof)

//         await DATABASE.put('SFP:'+blockID+blockHash,superFinalizationProof)

//         // Repeat procedure for the next block and store the progress

//         let appropriateDescriptor = SYMBIOTE_META.STATIC_STUFF_CACHE.get('BLOCK_SENDER_HANDLER')

//         await DATABASE.put('BLOCK_SENDER_HANDLER',appropriateDescriptor)

//         appropriateDescriptor.height++

//     }

// }


// let RUN_COMMITMENTS_GRABBING = async (qtPayload,blockID) => {


//     let block = await SYMBIOTE_META.BLOCKS.get(blockID).catch(_=>false)

//     // Check for this block after a while
//     if(!block) return


//     let blockHash = Block.genHash(block)



//     let optionsToSend = {method:'POST',body:JSON.stringify(block)},

//         commitmentsMapping = SYMBIOTE_META.TEMP.get(qtPayload).COMMITMENTS,
        
//         majority = GET_MAJORITY('QUORUM_THREAD'),

//         quorumMembers = await GET_VALIDATORS_URLS(true),

//         promises=[],

//         commitmentsForCurrentBlock


//     if(!commitmentsMapping.has(blockID)){

//         commitmentsMapping.set(blockID,new Map()) // inner mapping contains voterValidatorPubKey => his commitment 

//         commitmentsForCurrentBlock = commitmentsMapping.get(blockID)

//     }else commitmentsForCurrentBlock = commitmentsMapping.get(blockID)



//     if(commitmentsForCurrentBlock.size<majority){

//         //Descriptor is {url,pubKey}
//         for(let descriptor of quorumMembers){

//             // No sense to get the commitment if we already have
    
//             if(commitmentsForCurrentBlock.has(descriptor.pubKey)) continue
    
//             /*
            
//             0. Share the block via POST /block and get the commitment as the answer
       
//             1. After getting 2/3N+1 commitments, aggregate it and call POST /finalization to send the aggregated commitment to the quorum members and get the 
    
//             2. Get the 2/3N+1 FINALIZATION_PROOFs, aggregate and call POST /super_finalization to share the SUPER_FINALIZATION_PROOFS over the symbiote
    
//             */
    
//             let promise = fetch(descriptor.url+'/block',optionsToSend).then(r=>r.text()).then(async possibleCommitment=>{
    
//                 let commitmentIsOk = await bls.singleVerify(blockID+blockHash+qtPayload,descriptor.pubKey,possibleCommitment).catch(_=>false)
    
//                 if(commitmentIsOk) commitmentsForCurrentBlock.set(descriptor.pubKey,possibleCommitment)
    
//             }).catch(_=>false)
    
//             // To make sharing async
//             promises.push(promise)
    
//         }
    
//         await Promise.all(promises)

//     }


//     //_______________________ It means that we now have enough commitments for appropriate block. Now we can start to generate FINALIZATION_PROOF _______________________

//     // On this step we should go through the quorum members and share FINALIZATION_PROOF to get the SUPER_FINALIZATION_PROOFS(and this way - finalize the block)

//     if(commitmentsForCurrentBlock.size>=majority){

//         let signers = [...commitmentsForCurrentBlock.keys()]

//         let signatures = [...commitmentsForCurrentBlock.values()]

//         let afkValidators = SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.QUORUM.filter(pubKey=>!signers.includes(pubKey))


//         /*
        
//         Aggregated version of commitments

//         {
        
//             blockID:"7cBETvyWGSvnaVbc7ZhSfRPYXmsTzZzYmraKEgxQMng8UPEEexpvVSgTuo8iza73oP:1337",

//             blockHash:"0123456701234567012345670123456701234567012345670123456701234567",
        
//             aggregatedPub:"7cBETvyWGSvnaVbc7ZhSfRPYXmsTzZzYmraKEgxQMng8UPEEexpvVSgTuo8iza73oP",

//             aggregatedSigna:"kffamjvjEg4CMP8VsxTSfC/Gs3T/MgV1xHSbP5YXJI5eCINasivnw07f/lHmWdJjC4qsSrdxr+J8cItbWgbbqNaM+3W4HROq2ojiAhsNw6yCmSBXl73Yhgb44vl5Q8qD",

//             afkValidators:[]

//         }
    

//         */

//         let aggregatedCommitments = {

//             blockID,
            
//             blockHash,
            
//             aggregatedPub:bls.aggregatePublicKeys(signers),
            
//             aggregatedSignature:bls.aggregateSignatures(signatures),
            
//             afkValidators

//         }

//         //Set the aggregated version of commitments to start to grab FINALIZATION_PROOFS
//         commitmentsMapping.set(blockID,aggregatedCommitments)
    
//         await RUN_FINALIZATION_PROOFS_GRABBING(qtPayload,blockID)

//     }

// }




// let SEND_BLOCKS_AND_GRAB_COMMITMENTS = async () => {



//     // If we don't generate the blocks - skip this function
//     if(!SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.PAYLOAD.SUBCHAINS_METADATA[CONFIG.SYMBIOTE.PUB]){

//         setTimeout(SEND_BLOCKS_AND_GRAB_COMMITMENTS,3000)

//         return

//     }

//     // Descriptor has the following structure - {checkpointID,height}
//     let appropriateDescriptor = SYMBIOTE_META.STATIC_STUFF_CACHE.get('BLOCK_SENDER_HANDLER')

//     let qtPayload = SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.HEADER.PAYLOAD_HASH + SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.HEADER.ID

//     let {FINALIZATION_PROOFS,DATABASE} = SYMBIOTE_META.TEMP.get(qtPayload)

//     if(!appropriateDescriptor || appropriateDescriptor.checkpointID !== SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.HEADER.ID){

//         //If we still works on the old checkpoint - continue
//         //Otherwise,update the latest height/hash and send them to the new QUORUM
//         appropriateDescriptor = await DATABASE.get('BLOCK_SENDER_HANDLER').catch(_=>false)

//         if(!appropriateDescriptor){

//             let myLatestFinalizedHeight = SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.PAYLOAD.SUBCHAINS_METADATA[CONFIG.SYMBIOTE.PUB].INDEX+1

//             appropriateDescriptor = {
    
//                 checkpointID:SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.HEADER.ID,
    
//                 height:myLatestFinalizedHeight
    
//             }
    
//         }
        
//         // And store new descriptor(till it will be old)
//         SYMBIOTE_META.STATIC_STUFF_CACHE.set('BLOCK_SENDER_HANDLER',appropriateDescriptor)

//     }


//     let blockID = CONFIG.SYMBIOTE.PUB+':'+appropriateDescriptor.height


//     if(FINALIZATION_PROOFS.has(blockID)){

//         //This option means that we already started to share aggregated 2/3N+1 commitments and grab 2/3+1 FINALIZATION_PROOFS
//         await RUN_FINALIZATION_PROOFS_GRABBING(qtPayload,blockID)

//     }else{

//         // This option means that we already started to share block and going to find 2/3N+1 commitments
//         // Once we get it - aggregate it and start finalization proofs grabbing(previous option) 
        
//         await RUN_COMMITMENTS_GRABBING(qtPayload,blockID)

//     }

//     setTimeout(SEND_BLOCKS_AND_GRAB_COMMITMENTS,0)

// }