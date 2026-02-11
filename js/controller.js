'use strict';

/* =========================================================
   Game Controller
========================================================= */
class GameController {
  constructor(){
    this.gameState1=null;
    this.gameState2=null;
    this.gameRunning=false;
    this.gameSeed=null;
    this.lastTime=0;
    this.lastStateSendTime=0;
    this.animationFrameId=null;

    this.setupUI();
    this.setupInput();
  }

  setupUI(){
    window.copyPeerId=()=>{
      const id=document.getElementById('peerIdDisplay').textContent;
      navigator.clipboard.writeText(id).then(()=>ChatManager.addMessage('Peer ID copied to clipboard!'));
    };

    document.getElementById('createGameBtn').addEventListener('click',()=>{
      NetworkManager.getInstance().initialize(this.handleNetworkMessage.bind(this));
      document.getElementById('gameStatus').textContent='Waiting for opponent to join...';
      document.getElementById('createGameBtn').disabled=true;
    });

    document.getElementById('joinGameBtn').addEventListener('click',()=>{
      const opponentId=document.getElementById('opponentPeerId').value.trim();
      if(!opponentId){ ChatManager.addMessage('Please enter an opponent Peer ID'); return; }

      NetworkManager.getInstance().initialize(this.handleNetworkMessage.bind(this));
      setTimeout(()=>NetworkManager.getInstance().connect(opponentId), 300);
    });

    document.getElementById('restartBtn').addEventListener('click',()=>{
      this.gameSeed=Math.floor(Math.random()*1000000000);
      ChatManager.addMessage(`New game seed: ${this.gameSeed}`,'System');
      NetworkManager.getInstance().send({type:'restart', seed:this.gameSeed});
      this.restartGame();
    });

    document.getElementById('sendChatBtn').addEventListener('click',()=>{
      const el=document.getElementById('chatInput');
      const msg=el.value.trim();
      if(msg && NetworkManager.getInstance().isConnected()){
        NetworkManager.getInstance().send({type:'chat', message:msg});
        ChatManager.addMessage(msg,'You');
        el.value='';
      }
    });

    document.getElementById('chatInput').addEventListener('keypress',(e)=>{
      if(e.key==='Enter') document.getElementById('sendChatBtn').click();
    });

    ChatManager.addMessage('Welcome to Tetris Online Battle!');
    ChatManager.addMessage('Click "Create Game" to host or enter a Peer ID to join.');
  }

  setupInput(){
    const input=InputManager.getInstance();
    input.setupKeyBindings();

    input.onMoveImmediate=(dx)=>{
      if(this.gameState1) this.gameState1.move(dx);
    };

    document.addEventListener('keydown',(e)=>{
      if(input.isCapturing()) return;
      if(!this.gameRunning || !this.gameState1) return;

      const b=input.getBindings();
      const code=e.code;

      const alreadyHeld=!!input.getHeldCodes()[code];
      input.handleKeyDown(code);

      if(Object.values(b).includes(code)) e.preventDefault();

      const isRepeatBlocked =
        (code===b.hold || code===b.hardDrop || code===b.rotateCW || code===b.rotateCCW || code===b.rotate180);

      if(alreadyHeld && isRepeatBlocked) return;

      if(code===b.softDrop){
        this.gameState1.setSoftDropActive(true);
        return;
      }

      if(code===b.hardDrop){
        this.gameState1.hardDrop();
        this.gameState1.spawnPiece();
        input.resetMovementOnSpawn();
        return;
      }

      if(code===b.rotateCW){
        const ok=this.gameState1.rotate('cw');
        if(!ok) this.gameState1.bufferRotation('cw');
        else this.gameState1.rotateBuffer=null;
        return;
      }

      if(code===b.rotateCCW){
        const ok=this.gameState1.rotate('ccw');
        if(!ok) this.gameState1.bufferRotation('ccw');
        else this.gameState1.rotateBuffer=null;
        return;
      }

      if(code===b.rotate180){
        const ok=this.gameState1.rotate('180');
        if(!ok) this.gameState1.bufferRotation('180');
        else this.gameState1.rotateBuffer=null;
        return;
      }

      if(code===b.hold){
        this.gameState1.holdCurrentPiece();
        return;
      }
    });

    document.addEventListener('keyup',(e)=>{
      if(input.isCapturing()) return;

      const code=e.code;
      input.handleKeyUp(code);

      if(!this.gameRunning || !this.gameState1) return;

      const b=input.getBindings();
      if(code===b.softDrop) this.gameState1.setSoftDropActive(false);
    });
  }

  handleNetworkMessage(msg){
    if(msg.type==='chat'){
      ChatManager.addMessage(msg.message,'Opponent');
    } else if(msg.type==='attack'){
      if(this.gameState1) this.gameState1.receiveAttack(msg.lines);
    } else if(msg.type==='start'){
      if(msg.seed){
        this.gameSeed=msg.seed;
        ChatManager.addMessage(`Received game seed: ${this.gameSeed}`,'System');
      }
      this.startGame();
    } else if(msg.type==='gameState'){
      if(this.gameState2 && msg.state) this.gameState2.setState(msg.state);
    } else if(msg.type==='restart'){
      if(msg.seed) this.gameSeed=msg.seed;
      this.restartGame();
    } else if(msg.type==='gameOver'){
      this.gameRunning=false;
      ChatManager.addMessage('Opponent lost! You win! 🎉','System');
      document.getElementById('gameStatus').textContent='You Win! 🏆';
    }
  }

  startGame(){
    this.gameRunning=true;
    document.getElementById('gameArea').classList.remove('hidden');
    document.getElementById('restartBtn').classList.remove('hidden');
    document.getElementById('gameStatus').textContent='Game in progress!';

    if(!this.gameSeed){
      this.gameSeed=Math.floor(Math.random()*1000000000);
      ChatManager.addMessage(`Generated game seed: ${this.gameSeed}`,'System');
    }

    GameSettings.getInstance().update();

    this.gameState1=new GameState('gameCanvas1','holdCanvas1','queueCanvas1',1,this.gameSeed);
    this.gameState2=new GameState('gameCanvas2','holdCanvas2','queueCanvas2',2,this.gameSeed);

    const startTime=Date.now();
    this.gameState1.setGameStartTime(startTime);
    this.gameState2.setGameStartTime(startTime);

    InputManager.getInstance().reset();

    this.gameState1.spawnPiece();
    this.gameState2.spawnPiece();

    ChatManager.addMessage('Game started! Good luck!');

    this.lastTime=0;
    this.lastStateSendTime=0;
    this.gameLoop();
  }

  restartGame(){
    this.gameRunning=false;
    if(this.animationFrameId!==null) cancelAnimationFrame(this.animationFrameId);

    setTimeout(()=>{
      this.startGame();
      ChatManager.addMessage('Game restarted!','System');
    }, 300);
  }

  handleGameOver(){
    ChatManager.addMessage('You lost! Click Restart to play again.','System');
    document.getElementById('gameStatus').textContent='Game Over! You lost.';
    this.gameRunning=false;
    NetworkManager.getInstance().send({type:'gameOver'});
  }

  gameLoop(timestamp=0){
    if(!this.gameRunning) return;

    const deltaTime = (this.lastTime===0) ? 0 : (timestamp-this.lastTime);
    this.lastTime=timestamp;

    if(this.gameState1){
      const input=InputManager.getInstance();

      if(!this.gameState1.softDropActive){
        input.processMovement(deltaTime,(dx)=>this.gameState1.move(dx));
      }

      const ok=this.gameState1.update(deltaTime);
      if(!ok){ this.handleGameOver(); return; }

      this.gameState1.draw();

      if(NetworkManager.getInstance().isConnected() && (timestamp-this.lastStateSendTime)>STATE_SEND_INTERVAL){
        NetworkManager.getInstance().send({type:'gameState', state:this.gameState1.getState()});
        this.lastStateSendTime=timestamp;
      }
    }

    if(this.gameState2) this.gameState2.draw();

    this.animationFrameId=requestAnimationFrame(this.gameLoop.bind(this));
  }
}
