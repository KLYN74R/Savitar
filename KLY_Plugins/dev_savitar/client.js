//https://github.com/theturtle32/WebSocket-Node

import WS from 'websocket'
import fs from 'fs'




let WebSocketClient = WS.client;

let client = new WebSocketClient({
    
    tlsOptions:{
    
        // With TLS
        ca:fs.readFileSync('../certificates/2022.crt'),
    
    }

});


// Подключаемся к нужному ресурсу
client.connect('wss://localhost:9999/','echo-protocol');


let block = {
    
    creator: '61TXxKDrBtb7bjpBym8zS9xRDoUQU6sW9aLvvqN9Bp9LVFiSxhRPd9Dwy3N3621RQ8',
    time: 1675356581345,
    events: [],
    index: 2,
    prevHash: '8667f6894776bf085bf59fc59b025b086c4bb848827ae75fae6e428b9412b44f',
    sig: 'jdo19QXNAb5oWKOdYjh5qcLJkowiPk+XM0xl3S19u4ZOmlPQF8mszmNyA4bemCleB5DTdiOtxpDAryzqUTna19O9pRR+VydUua6WlMDd0mcWgAxvr913ddq9fFD+gtxB'
  
}


let blocksArray=[]


for(let i=0;i<10;i++){

    blocksArray.push(block)

}

let sendData=JSON.stringify({

    route:"many_blocks",
    payload:blocksArray

})


// Вешаем на него обработчик события подключения к серверу
client.on('connect', handler);

client.on('connectFailed',console.log)

function handler(connection) {
    
    connection.on('message', function (message) {
      
        // делаем что-нибудь с пришедшим сообщением
      console.log('Client received ',message);
    
    })
    
    // посылаем сообщение серверу
    let inc=0

    setInterval(()=>{

        connection.sendUTF(sendData);

    },100)


    connection.on('close',a=>console.log('CLOSED'))

    connection.on('error',console.log)
      
}