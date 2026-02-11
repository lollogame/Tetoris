'use strict';

/* =========================================================
   Network
========================================================= */
class NetworkManager {
  static instance=null;

  constructor(){
    this.peer=null;
    this.conn=null;
    this.myPeerId=null;
    this.onMessageCallback=null;

    // For Zen/local modes:
    this.localAttackHandler = null;
  }

  static getInstance(){
    if(!NetworkManager.instance) NetworkManager.instance=new NetworkManager();
    return NetworkManager.instance;
  }

  setLocalAttackHandler(fn){
    this.localAttackHandler = (typeof fn === 'function') ? fn : null;
  }

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

    // Host receives incoming connection
    this.peer.on('connection',(connection)=>{
      this.conn=connection;
      this.setupConnection();

      // Local-only status event for UI:
      if(this.onMessageCallback) this.onMessageCallback({type:'peerConnected', role:'host'});

      ChatManager.addMessage('Opponent connected!');
      document.getElementById('gameStatus').textContent='Opponent connected. Host can press Start.';
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

        if(this.onMessageCallback) this.onMessageCallback({type:'peerConnected', role:'client'});

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
      if(this.onMessageCallback) this.onMessageCallback({type:'peerDisconnected'});
    });
  }

  send(msg){
    if(this.conn && this.conn.open) this.conn.send(msg);
  }

  sendAttack(lines){
    const safe = Math.min(Math.max(0, Number(lines)||0), 10);

    if(this.conn && this.conn.open){
      this.send({type:'attack', lines:safe});
      return;
    }

    // Zen/local: convert attack into score via handler
    if(this.localAttackHandler && safe > 0){
      this.localAttackHandler(safe);
    }
  }

  isConnected(){ return this.conn && this.conn.open; }
}
