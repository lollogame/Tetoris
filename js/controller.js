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

    // Menu / modes
    this.mode = 'zen';     // 'zen' | 'pvp_1v1' | 'pvp_lobby'
    this.isHost = false;
    this.zenScore = 0;

    this.cacheUI();
    this.setupUI();
    this.setupInput();
    this.applyModeUI();
    this.showMenu(true);
  }

  cacheUI(){
    this.elMenu = document.getElementById('mainMenu');
    this.elSettingsModal = document.getElementById('settingsModal');

    this.btnOpenMenu = document.getElementById('openMenuBtn');
    this.btnOpenSettings = document.getElementById('openSettingsBtn');
    this.btnCloseSettings = document.getElementById('closeSettingsBtn');

    this.btnMenuPlay = document.getElementById('menuPlayBtn');
    this.btnMenuSettings = document.getElementById('menuSettingsBtn');
    this.btnMenuClose = document.getElementById('menuCloseBtn');

    this.btnCreate = document.getElementById('createGameBtn');
    this.btnJoin = document.getElementById('joinGameBtn');
    this.btnHostStart = document.getElementById('hostStartBtn');
    this.btnRestart = document.getElementById('restartBtn');

    this.gameArea = document.getElementById('gameArea');
    this.gameStatus = document.getElementById('gameStatus');
    this.peerBox = document.getElementById('myPeerId');

    this.opponentContainer = document.querySelectorAll('.player-container')[1]; // second player container
  }

  /* =========================
     Menu / Modal helpers
  ========================= */
  showMenu(show){
    if(!this.elMenu) return;
    if(show) this.elMenu.classList.remove('hidden');
    else this.elMenu.classList.add('hidden');
  }

  openSettings(){
    if(!this.elSettingsModal) return;
    this.elSettingsModal.classList.remove('hidden');
  }

  closeSettings(){
    if(!this.elSettingsModal) return;
    this.elSettingsModal.classList.add('hidden');
  }

  setMode(mode){
    if(mode === 'pvp_lobby') return; // placeholder disabled

    this.mode = mode;
    this.isHost = false;

    // card selection visuals
    document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('selected'));
    const card = document.querySelector(`.mode-card[data-mode="${mode}"]`);
    if(card) card.classList.add('selected');

    this.applyModeUI();
  }

  applyModeUI(){
    // Hide/show opponent container for zen
    if(this.opponentContainer){
      if(this.mode === 'zen') this.opponentContainer.classList.add('hidden');
      else this.opponentContainer.classList.remove('hidden');
    }

    // Connection panel only relevant for PvP 1v1
    const connPanel = document.querySelector('.connection-panel');
    if(connPanel){
      if(this.mode === 'pvp_1v1') connPanel.classList.remove('hidden');
      else connPanel.classList.add('hidden');
    }

    // Peer ID box only needed in PvP
    if(this.peerBox){
      if(this.mode === 'pvp_1v1') this.peerBox.classList.remove('hidden');
      else this.peerBox.classList.add('hidden');
    }

    // Host buttons default hidden until needed
    this.btnHostStart.classList.add('hidden');
    this.btnRestart.classList.add('hidden');

    // Status text
    if(this.mode === 'zen'){
      this.gameStatus.textContent = 'Zen mode: press Play in the menu to start.';
    } else if(this.mode === 'pvp_1v1'){
      this.gameStatus.textContent = 'PvP 1v1: host or join. Host presses Start once connected.';
    } else {
      this.gameStatus.textContent = 'Mode not available yet.';
    }
  }

  stopGameLoop(){
    this.gameRunning=false;
    if(this.animationFrameId!==null) cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId=null;
  }

  resetGameStateVisuals(){
    // Hide game area until started
    this.gameArea.classList.add('hidden');
  }

  /* =========================
     Setup UI
  ========================= */
  setupUI(){
    // Top bar
    this.btnOpenMenu.addEventListener('click', () => this.showMenu(true));
    this.btnOpenSettings.addEventListener('click', () => this.openSettings());
    this.btnCloseSettings.addEventListener('click', () => this.closeSettings());

    // Click outside modal to close
    this.elSettingsModal.addEventListener('click', (e)=>{
      if(e.target === this.elSettingsModal) this.closeSettings();
    });

    // Menu buttons
    this.btnMenuPlay.addEventListener('click', ()=>{
      this.showMenu(false);
      this.startSelectedMode();
    });

    this.btnMenuSettings.addEventListener('click', ()=>{
      this.openSettings();
    });

    this.btnMenuClose.addEventListener('click', ()=>{
      this.showMenu(false);
    });

    // Mode cards
    document.querySelectorAll('.mode-card').forEach(card=>{
      if(card.classList.contains('disabled')) return;
      card.addEventListener('click', ()=>{
        this.setMode(card.dataset.mode);
      });
    });

    // Copy peer id
    window.copyPeerId=()=>{
      const id=document.getElementById('peerIdDisplay').textContent;
      navigator.clipboard.writeText(id).then(()=>ChatManager.addMessage('Peer ID copied to clipboard!'));
    };

    // PvP: host
    this.btnCreate.addEventListener('click',()=>{
      if(this.mode !== 'pvp_1v1') return;

      this.isHost = true;

      NetworkManager.getInstance().initialize(this.handleNetworkMessage.bind(this));
      this.gameStatus.textContent='Waiting for opponent to join...';
      this.btnCreate.disabled=true;
      this.btnJoin.disabled=false;

      // Host start stays hidden until opponent connects
      this.btnHostStart.classList.add('hidden');
      this.btnRestart.classList.add('hidden');
    });

    // PvP: join
    this.btnJoin.addEventListener('click',()=>{
      if(this.mode !== 'pvp_1v1') return;

      const opponentId=document.getElementById('opponentPeerId').value.trim();
      if(!opponentId){ ChatManager.addMessage('Please enter an opponent Peer ID'); return; }

      this.isHost = false;

      NetworkManager.getInstance().initialize(this.handleNetworkMessage.bind(this));
      setTimeout(()=>NetworkManager.getInstance().connect(opponentId), 300);

      this.btnCreate.disabled=false;
      this.btnHostStart.classList.add('hidden');
      this.btnRestart.classList.add('hidden');
    });

    // Host start
    this.btnHostStart.addEventListener('click',()=>{
      if(!this.isHost) return;
      if(this.mode !== 'pvp_1v1') return;
      if(!NetworkManager.getInstance().isConnected()){
        ChatManager.addMessage('No opponent connected yet.', 'System');
        return;
      }

      this.gameSeed = Math.floor(Math.random()*1000000000);
      ChatManager.addMessage(`Generated game seed: ${this.gameSeed}`, 'System');

      NetworkManager.getInstance().send({type:'start', seed:this.gameSeed});
      this.handleNetworkMessage({type:'start', seed:this.gameSeed});
    });

    // Restart (host only in PvP)
    this.btnRestart.addEventListener('click',()=>{
      if(this.mode !== 'pvp_1v1') return;
      if(!this.isHost) {
        ChatManager.addMessage('Only the host can restart.', 'System');
        return;
      }

      this.gameSeed=Math.floor(Math.random()*1000000000);
      ChatManager.addMessage(`New game seed: ${this.gameSeed}`,'System');
      NetworkManager.getInstance().send({type:'restart', seed:this.gameSeed});
      this.restartGame();
    });

    // Chat
    document.getElementById('sendChatBtn').addEventListener('click',()=>{
      const el=document.getElementById('chatInput');
      const msg=el.value.trim();
      if(!msg) return;

      if(this.mode === 'pvp_1v1' && NetworkManager.getInstance().isConnected()){
        NetworkManager.getInstance().send({type:'chat', message:msg});
      }
      ChatManager.addMessage(msg,'You');
      el.value='';
    });

    document.getElementById('chatInput').addEventListener('keypress',(e)=>{
      if(e.key==='Enter') document.getElementById('sendChatBtn').click();
    });

    ChatManager.addMessage('Welcome to Tetris Online Battle!');
    ChatManager.addMessage('Open the Menu to pick a mode and press Play.');
  }

  /* =========================
     Input
  ========================= */
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

  /* =========================
     Mode start
  ========================= */
  startSelectedMode(){
    this.stopGameLoop();
    this.resetGameStateVisuals();

    // Settings should be applied fresh
    GameSettings.getInstance().update();
    this.closeSettings();

    if(this.mode === 'zen'){
      this.startZen();
    } else if(this.mode === 'pvp_1v1'){
      this.startPvpUIOnly();
    } else {
      ChatManager.addMessage('That mode is not available yet.', 'System');
      this.showMenu(true);
    }
  }

  startZen(){
    this.isHost = false;
    this.zenScore = 0;

    // Zen: route attacks into score
    NetworkManager.getInstance().setLocalAttackHandler((attack)=>{
      // Simple scoring: 100 per attack line (tweak later)
      this.zenScore += attack * 100;
      this.gameStatus.textContent = `Zen mode — Score: ${this.zenScore}`;
    });

    // Hide PvP UI things
    this.btnHostStart.classList.add('hidden');
    this.btnRestart.classList.add('hidden');

    // Start game immediately with a seed
    this.gameSeed = Math.floor(Math.random()*1000000000);
    ChatManager.addMessage(`Zen seed: ${this.gameSeed}`, 'System');
    this.startGameLocalOnly();
  }

  startPvpUIOnly(){
    // In PvP we do NOT auto-start. You host/join then host presses Start.
    NetworkManager.getInstance().setLocalAttackHandler(null);

    this.gameArea.classList.add('hidden');
    this.btnRestart.classList.add('hidden');
    this.btnHostStart.classList.add('hidden');

    this.gameStatus.textContent = 'PvP 1v1: Create or Join. Host presses Start once connected.';
  }

  startGameLocalOnly(){
    this.gameRunning=true;
    this.gameArea.classList.remove('hidden');

    // In Zen: no restart host-only logic, but keep restart hidden for now
    this.btnRestart.classList.add('hidden');
    this.btnHostStart.classList.add('hidden');

    this.gameStatus.textContent = `Zen mode — Score: ${this.zenScore}`;

    this.gameState1=new GameState('gameCanvas1','holdCanvas1','queueCanvas1',1,this.gameSeed);
    // opponent state exists but hidden; keep it for rendering safety
    this.gameState2=new GameState('gameCanvas2','holdCanvas2','queueCanvas2',2,this.gameSeed);

    const startTime=Date.now();
    this.gameState1.setGameStartTime(startTime);
    this.gameState2.setGameStartTime(startTime);

    InputManager.getInstance().reset();

    this.gameState1.spawnPiece();
    this.gameState2.spawnPiece();

    ChatManager.addMessage('Zen started. Good luck!');
    this.lastTime=0;
    this.lastStateSendTime=0;
    this.gameLoop();
  }

  /* =========================
     Network messages
  ========================= */
  handleNetworkMessage(msg){
    if(msg.type==='chat'){
      ChatManager.addMessage(msg.message,'Opponent');
      return;
    }

    if(msg.type==='peerConnected'){
      // Show host Start only if host
      if(this.isHost && this.mode === 'pvp_1v1'){
        this.btnHostStart.classList.remove('hidden');
        this.gameStatus.textContent = 'Opponent connected. Press Start (Host).';
      }
      return;
    }

    if(msg.type==='peerDisconnected'){
      if(this.mode === 'pvp_1v1'){
        this.btnHostStart.classList.add('hidden');
        this.btnRestart.classList.add('hidden');
      }
      return;
    }

    if(msg.type==='attack'){
      if(this.gameState1) this.gameState1.receiveAttack(msg.lines);
      return;
    }

    if(msg.type==='start'){
      if(this.mode !== 'pvp_1v1') return;

      if(msg.seed){
        this.gameSeed=msg.seed;
        ChatManager.addMessage(`Game seed: ${this.gameSeed}`,'System');
      }

      this.startGamePvp();
      return;
    }

    if(msg.type==='gameState'){
      if(this.gameState2 && msg.state) this.gameState2.setState(msg.state);
      return;
    }

    if(msg.type==='restart'){
      if(msg.seed) this.gameSeed=msg.seed;
      this.restartGame();
      return;
    }

    if(msg.type==='gameOver'){
      this.gameRunning=false;
      ChatManager.addMessage('Opponent lost! You win! 🎉','System');
      this.gameStatus.textContent='You Win! 🏆';
      return;
    }
  }

  startGamePvp(){
    this.gameRunning=true;
    this.gameArea.classList.remove('hidden');

    // Host can restart, client cannot
    if(this.isHost) this.btnRestart.classList.remove('hidden');
    else this.btnRestart.classList.add('hidden');

    this.btnHostStart.classList.add('hidden');
    this.gameStatus.textContent='Game in progress!';

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

    ChatManager.addMessage('PvP started! Good luck!');
    this.lastTime=0;
    this.lastStateSendTime=0;
    this.gameLoop();
  }

  restartGame(){
    this.stopGameLoop();

    setTimeout(()=>{
      if(this.mode === 'pvp_1v1') this.startGamePvp();
      else if(this.mode === 'zen') this.startGameLocalOnly();

      ChatManager.addMessage('Game restarted!','System');
    }, 250);
  }

  handleGameOver(){
    ChatManager.addMessage('You lost!','System');
    this.gameStatus.textContent='Game Over! You lost.';
    this.gameRunning=false;

    if(this.mode === 'pvp_1v1'){
      NetworkManager.getInstance().send({type:'gameOver'});
    }
  }

  /* =========================
     Loop
  ========================= */
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

      if(this.mode === 'pvp_1v1' && NetworkManager.getInstance().isConnected()){
        if((timestamp-this.lastStateSendTime)>STATE_SEND_INTERVAL){
          NetworkManager.getInstance().send({type:'gameState', state:this.gameState1.getState()});
          this.lastStateSendTime=timestamp;
        }
      }
    }

    if(this.gameState2) this.gameState2.draw();

    this.animationFrameId=requestAnimationFrame(this.gameLoop.bind(this));
  }
}
