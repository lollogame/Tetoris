'use strict';

/* =========================================================
   Network
========================================================= */
class NetworkManager {
  static instance=null;
  constructor(){ this.peer=null; this.conn=null; this.myPeerId=null; this.onMessageCallback=null; }
  static getInstance(){ if(!NetworkManager.instance) NetworkManager.instance=new NetworkManager(); return NetworkManager.instance; }

  initialize(onMessage){
    this.onMessageCallback=onMessage;

    this.peer=new Peer({
      config:{
        iceServers:[
          {urls:'stun:stun.l.google.com:19302'},
          {urls:'stun:stun1.l.google.com:19302'}
        ]
      }
    });

    this.peer.on('open',(id)=>{
      this.myPeerId=id;
      document.getElementById('peerIdDisplay').textContent=id;
      document.getElementById('myPeerId').classList.remove('hidden');
      ChatManager.addMessage(`Your Peer ID: ${id}`);
      ChatManager.addMessage('Share this ID with your opponent to let them join!');
    });

    this.peer.on('connection',(connection)=>{
      this.conn=connection;
      this.setupConnection();
      ChatManager.addMessage('Opponent connected!');
      document.getElementById('gameStatus').textContent='Connected! Starting game...';

      const seed=Math.floor(Math.random()*1000000000);
      ChatManager.addMessage(`Generated game seed: ${seed}`, 'System');

      setTimeout(()=>{
        this.send({type:'start',seed});
        if(this.onMessageCallback) this.onMessageCallback({type:'start',seed});
      }, 300);
    });

    this.peer.on('error',(err)=>{
      console.error('PeerJS error:', err);
      ChatManager.addMessage(`Connection error: ${err.type}`);
    });
  }

  connect(peerId){
    setTimeout(()=>{
      this.conn=this.peer.connect(peerId);

      this.conn.on('open',()=>{
        this.setupConnection();
        ChatManager.addMessage('Connected to opponent!');
        document.getElementById('gameStatus').textContent='Connected! Waiting for host to start...';
        document.getElementById('joinGameBtn').disabled=true;
      });

      this.conn.on('error',(err)=>{
        ChatManager.addMessage(`Failed to connect: ${err}`);
      });
    }, 200);
  }

  setupConnection(){
    this.conn.on('data',(data)=>{
      if(this.onMessageCallback) this.onMessageCallback(data);
    });

    this.conn.on('close',()=>{
      ChatManager.addMessage('Opponent disconnected');
      document.getElementById('gameStatus').textContent='Opponent disconnected';
    });
  }

  send(msg){ if(this.conn && this.conn.open) this.conn.send(msg); }
  sendAttack(lines){ this.send({type:'attack', lines:Math.min(lines,10)}); }
  isConnected(){ return this.conn && this.conn.open; }
}
