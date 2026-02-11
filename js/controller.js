'use strict';

/* =========================================================
   Game Controller
   - Main Menu with modes: Zen / 1v1 / Battle Royale (placeholder)
   - Settings modal (keybinds + match config)
   - PvP match logic: rounds, scoreboard, countdown, state sync
========================================================= */
class GameController {
  constructor() {
    // Game states
    this.gameState1 = null; // local player
    this.gameState2 = null; // remote player view (PvP)

    // Modes
    this.mode = 'zen'; // 'zen' | 'pvp_1v1' | 'battle_royale'
    this.zenScore = 0;

    // PvP match state
    this.isHost = false;
    this.phase = 'idle'; // idle | waiting | countdown | playing | roundOver | matchOver
    this.match = {
      targetWins: 3,
      countdownSeconds: 3,
      hostScore: 0,
      clientScore: 0,
      round: 0,
    };
    this.roundId = null;

    // Loop
    this.gameRunning = false;
    this.lastTime = 0;
    this.lastStateSendTime = 0;
    this.animationFrameId = null;

    // Input gating
    this.acceptInput = false;

    // UI
    this.cacheUI();
    this.setupUI();
    this.setupInput();
    this.setupSettingsModal();
    this.setupMenu();

    this.applyModeUI();
    this.updateScoreboard();
    this.showMenu(true);
  }

  /* =========================
     Cache UI
  ========================= */
  cacheUI() {
    // Topbar
    this.btnOpenMenu = document.getElementById('openMenuBtn');
    this.btnOpenSettings = document.getElementById('openSettingsBtn');

    // Main menu overlay
    this.elMenu = document.getElementById('mainMenu');
    this.btnMenuPlay = document.getElementById('menuPlayBtn');
    this.btnMenuSettings = document.getElementById('menuSettingsBtn');
    this.btnMenuClose = document.getElementById('menuCloseBtn');
    this.modeCards = Array.from(document.querySelectorAll('.mode-card'));

    // Settings modal
    this.settingsModal = document.getElementById('settingsModal');
    this.btnCloseSettings = document.getElementById('closeSettingsBtn');

    // PvP UI
    this.createBtn = document.getElementById('createGameBtn');
    this.joinBtn = document.getElementById('joinGameBtn');
    this.restartBtn = document.getElementById('restartBtn');
    this.opponentPeerIdInput = document.getElementById('opponentPeerId');

    this.peerBox = document.getElementById('myPeerId');
    this.peerIdDisplay = document.getElementById('peerIdDisplay');

    this.gameArea = document.getElementById('gameArea');
    this.gameStatus = document.getElementById('gameStatus');

    this.scoreboard = document.getElementById('scoreboard');

    // Countdown overlay
    this.countdownOverlay = document.getElementById('countdownOverlay');

    // Containers
    const players = document.querySelectorAll('.player-container');
    this.localContainer = players[0] || null;
    this.opponentContainer = players[1] || null;

    this.connPanel = document.querySelector('.connection-panel');
  }

  /* =========================
     Small UI helpers
  ========================= */
  setStatus(text) {
    if (this.gameStatus) this.gameStatus.textContent = text;
  }

  showScoreboard(show) {
    if (!this.scoreboard) return;
    this.scoreboard.classList.toggle('hidden', !show);
  }

  formatLabelFromTarget(targetWins) {
    if (!targetWins || targetWins <= 0) return '∞';
    return `FT${targetWins}`;
  }

  getLocalScore() {
    return this.isHost ? this.match.hostScore : this.match.clientScore;
  }

  getOppScore() {
    return this.isHost ? this.match.clientScore : this.match.hostScore;
  }

  updateScoreboard() {
    // Scoreboard is PvP-only
    if (this.mode !== 'pvp_1v1') {
      this.showScoreboard(false);
      return;
    }

    const formatPill = document.getElementById('matchFormatPill');
    const roundPill = document.getElementById('matchRoundPill');
    const scorePill = document.getElementById('matchScorePill');

    const fmt = this.formatLabelFromTarget(this.match.targetWins);
    if (formatPill) formatPill.innerHTML = `FORMAT: <strong>${fmt}</strong>`;
    if (roundPill) roundPill.innerHTML = `ROUND: <strong>${Math.max(1, this.match.round)}</strong>`;
    if (scorePill) scorePill.innerHTML = `YOU <strong>${this.getLocalScore()}</strong> — <strong>${this.getOppScore()}</strong> OPP`;

    this.showScoreboard(this.phase !== 'idle');
  }

  showMenu(show) {
    if (!this.elMenu) return;

    if (show) {
      this.elMenu.classList.remove('hidden');
      this.acceptInput = false;
    } else {
      this.elMenu.classList.add('hidden');
      // restore input only if actually in a playable state
      if (this.mode === 'zen') {
        this.acceptInput = this.gameRunning;
      } else {
        this.acceptInput = (this.phase === 'playing');
      }
    }
  }

  openSettings() {
    if (!this.settingsModal) return;
    this.settingsModal.classList.remove('hidden');
  }

  closeSettings() {
    if (!this.settingsModal) return;
    this.settingsModal.classList.add('hidden');
  }

  /* =========================
     Menu + Modes
  ========================= */
  setupMenu() {
    if (this.btnOpenMenu) this.btnOpenMenu.addEventListener('click', () => this.showMenu(true));

    // Menu buttons
    if (this.btnMenuPlay) {
      this.btnMenuPlay.addEventListener('click', () => {
        this.showMenu(false);
        this.startSelectedMode();
      });
    }

    if (this.btnMenuSettings) {
      this.btnMenuSettings.addEventListener('click', () => this.openSettings());
    }

    if (this.btnMenuClose) {
      this.btnMenuClose.addEventListener('click', () => this.showMenu(false));
    }

    // Click outside menu card closes
    if (this.elMenu) {
      this.elMenu.addEventListener('click', (e) => {
        if (e.target === this.elMenu) this.showMenu(false);
      });
    }

    // Mode cards
    this.modeCards.forEach((card) => {
      if (card.classList.contains('disabled')) return;
      card.addEventListener('click', () => {
        const m = card.dataset.mode;
        if (!m) return;
        this.setMode(m);
      });
    });

    // Default selection visuals
    this.setMode(this.mode);
  }

  setMode(mode) {
    if (mode === 'battle_royale') {
      ChatManager.addMessage('Battle Royale is not implemented yet.', 'System');
      return;
    }

    this.mode = mode;

    // Visual selection
    this.modeCards.forEach((c) => c.classList.remove('selected'));
    const selected = this.modeCards.find((c) => c.dataset.mode === mode);
    if (selected) selected.classList.add('selected');

    this.applyModeUI();
  }

  applyModeUI() {
    // Opponent UI hidden in zen
    if (this.opponentContainer) {
      this.opponentContainer.classList.toggle('hidden', this.mode === 'zen');
    }

    // Connection panel + peer id only in PvP
    if (this.connPanel) {
      this.connPanel.classList.toggle('hidden', this.mode !== 'pvp_1v1');
    }

    if (this.peerBox) {
      this.peerBox.classList.toggle('hidden', this.mode !== 'pvp_1v1');
    }

    // Scoreboard only PvP
    this.updateScoreboard();

    // Set status message
    if (this.mode === 'zen') {
      this.setStatus('Zen mode: press Play in the Menu to start.');
    } else if (this.mode === 'pvp_1v1') {
      this.setStatus('1v1 mode: host or join, then play the match.');
    }

    // Hide game area until a mode actually starts
    if (this.gameArea) {
      const shouldShow = (this.mode === 'zen') ? this.gameRunning : (this.phase !== 'idle' && this.phase !== 'waiting');
      this.gameArea.classList.toggle('hidden', !shouldShow);
    }
  }

  stopLoop() {
    this.gameRunning = false;
    if (this.animationFrameId != null) cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = null;
  }

  resetForNewMode() {
    this.stopLoop();
    this.gameState1 = null;
    this.gameState2 = null;
    this.lastTime = 0;
    this.lastStateSendTime = 0;

    // PvP state reset (but keep match settings)
    this.phase = 'idle';
    this.roundId = null;
    this.acceptInput = false;

    // UI
    if (this.gameArea) this.gameArea.classList.add('hidden');
    if (this.restartBtn) this.restartBtn.classList.add('hidden');

    // Clear local attack hook
    const nm = NetworkManager.getInstance();
    if (nm && typeof nm.setLocalAttackHandler === 'function') nm.setLocalAttackHandler(null);

    this.updateScoreboard();
  }

  startSelectedMode() {
    this.resetForNewMode();

    // Always refresh settings
    GameSettings.getInstance().update();
    this.closeSettings();

    if (this.mode === 'zen') {
      this.startZen();
    } else if (this.mode === 'pvp_1v1') {
      // PvP doesn't auto-start; you host/join
      this.phase = 'waiting';
      this.isHost = false;
      this.acceptInput = false;
      this.updateScoreboard();
      this.applyModeUI();
      this.setStatus('1v1: Create or Join. Host starts automatically when opponent connects.');
    }
  }

  startZen() {
    this.zenScore = 0;
    this.isHost = false;
    this.phase = 'playing';
    this.acceptInput = true;

    // Optional local score hook: +100 per garbage line worth of attack
    const nm = NetworkManager.getInstance();
    if (nm && typeof nm.setLocalAttackHandler === 'function') {
      nm.setLocalAttackHandler((attack) => {
        const safe = Math.max(0, Number(attack) || 0);
        this.zenScore += safe * 100;
        this.setStatus(`Zen mode — Score: ${this.zenScore}`);
      });
    }

    const seed = Math.floor(Math.random() * 1e9);

    if (this.gameArea) this.gameArea.classList.remove('hidden');

    this.gameState1 = new GameState('gameCanvas1', 'holdCanvas1', 'queueCanvas1', 1, seed);

    const startTime = Date.now();
    this.gameState1.setGameStartTime(startTime);

    InputManager.getInstance().reset();

    const ok = this.gameState1.spawnPiece();
    if (!ok) {
      this.handleGameOver();
      return;
    }

    this.gameState1.draw();

    this.setStatus(`Zen mode — Score: ${this.zenScore}`);
    ChatManager.addMessage('Zen started. Good luck!', 'System');

    this.gameRunning = true;
    this.lastTime = 0;
    this.lastStateSendTime = 0;
    this.animationFrameId = requestAnimationFrame(this.gameLoop.bind(this));

    this.applyModeUI();
  }

  /* =========================
     Settings modal
  ========================= */
  setupSettingsModal() {
    if (this.btnOpenSettings && this.settingsModal) {
      this.btnOpenSettings.addEventListener('click', () => this.openSettings());
    }
    if (this.btnCloseSettings && this.settingsModal) {
      this.btnCloseSettings.addEventListener('click', () => this.closeSettings());
    }

    if (this.settingsModal) {
      this.settingsModal.addEventListener('click', (e) => {
        if (e.target === this.settingsModal) this.closeSettings();
      });
    }
  }

  readMatchConfigFromUI() {
    const mf = document.getElementById('matchFormat');
    const cd = document.getElementById('countdownSeconds');

    const targetWins = Math.max(0, parseInt(mf ? mf.value : '3', 10) || 3);
    const countdownSeconds = Math.max(2, Math.min(5, parseInt(cd ? cd.value : '3', 10) || 3));

    return { targetWins, countdownSeconds };
  }

  applyMatchConfig(cfg, lockUI = false) {
    if (typeof cfg.targetWins === 'number') this.match.targetWins = cfg.targetWins;
    if (typeof cfg.countdownSeconds === 'number') this.match.countdownSeconds = cfg.countdownSeconds;

    const mf = document.getElementById('matchFormat');
    const cd = document.getElementById('countdownSeconds');

    if (mf) mf.value = String(this.match.targetWins);
    if (cd) cd.value = String(this.match.countdownSeconds);

    if (mf) mf.disabled = !!lockUI;
    if (cd) cd.disabled = !!lockUI;

    this.updateScoreboard();
  }

  /* =========================
     Main UI (PvP + Chat)
  ========================= */
  setupUI() {
    // Copy peer ID
    window.copyPeerId = () => {
      const id = this.peerIdDisplay ? this.peerIdDisplay.textContent : '';
      if (!id) return;
      navigator.clipboard.writeText(id).then(() => ChatManager.addMessage('Peer ID copied to clipboard!'));
    };

    // Host
    if (this.createBtn) {
      this.createBtn.addEventListener('click', () => {
        if (this.mode !== 'pvp_1v1') return;

        this.isHost = true;
        this.phase = 'waiting';
        this.acceptInput = false;

        NetworkManager.getInstance().initialize(this.handleNetworkMessage.bind(this));
        this.setStatus('Waiting for opponent to join...');

        this.createBtn.disabled = true;

        this.applyMatchConfig(this.readMatchConfigFromUI(), false);
        this.updateScoreboard();
      });
    }

    // Join
    if (this.joinBtn) {
      this.joinBtn.addEventListener('click', () => {
        if (this.mode !== 'pvp_1v1') return;

        const opponentId = (this.opponentPeerIdInput ? this.opponentPeerIdInput.value : '').trim();
        if (!opponentId) {
          ChatManager.addMessage('Please enter an opponent Peer ID');
          return;
        }

        this.isHost = false;
        this.phase = 'waiting';
        this.acceptInput = false;

        this.applyMatchConfig(this.readMatchConfigFromUI(), true);

        NetworkManager.getInstance().initialize(this.handleNetworkMessage.bind(this));
        setTimeout(() => NetworkManager.getInstance().connect(opponentId), 300);

        this.updateScoreboard();
      });
    }

    // Restart
    if (this.restartBtn) {
      this.restartBtn.addEventListener('click', () => {
        if (this.mode !== 'pvp_1v1') return;

        this.resetMatchScores();

        if (NetworkManager.getInstance().isConnected()) {
          NetworkManager.getInstance().send({
            type: 'matchReset',
            targetWins: this.match.targetWins,
            countdownSeconds: this.match.countdownSeconds,
          });
        }

        if (this.isHost) {
          this.startNextRoundAsHost(true);
        } else {
          this.setStatus('Requested match reset. Waiting for host...');
        }
      });
    }

    // Chat
    const sendBtn = document.getElementById('sendChatBtn');
    const chatInput = document.getElementById('chatInput');

    if (sendBtn && chatInput) {
      sendBtn.addEventListener('click', () => {
        const msg = chatInput.value.trim();
        if (!msg) return;

        if (this.mode === 'pvp_1v1' && NetworkManager.getInstance().isConnected()) {
          NetworkManager.getInstance().send({ type: 'chat', message: msg });
        }

        ChatManager.addMessage(msg, 'You');
        chatInput.value = '';
      });

      chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendBtn.click();
      });
    }

    ChatManager.addMessage('Welcome to Tetris Online Battle!');
    ChatManager.addMessage('Open the Menu to pick a mode and press Play.');
  }

  /* =========================
     Input
  ========================= */
  setupInput() {
    const input = InputManager.getInstance();
    input.setupKeyBindings();

    input.onMoveImmediate = (dx) => {
      if (this.gameState1 && this.acceptInput) this.gameState1.move(dx);
    };

    document.addEventListener('keydown', (e) => {
      if (input.isCapturing()) return;

      const b = input.getBindings();
      const code = e.code;

      if (Object.values(b).includes(code)) e.preventDefault();

      if (!this.acceptInput || !this.gameState1) {
        input.handleKeyDown(code);
        return;
      }

      const alreadyHeld = !!input.getHeldCodes()[code];
      input.handleKeyDown(code);

      const isRepeatBlocked =
        (code === b.hold || code === b.hardDrop || code === b.rotateCW || code === b.rotateCCW || code === b.rotate180);

      if (alreadyHeld && isRepeatBlocked) return;

      if (code === b.softDrop) {
        this.gameState1.setSoftDropActive(true);
        return;
      }

      if (code === b.hardDrop) {
        const ok = this.gameState1.hardDropAndSpawn();
        if (!ok) this.handleGameOver();
        input.resetMovementOnSpawn();
        return;
      }

      if (code === b.rotateCW) {
        const ok = this.gameState1.rotate('cw');
        if (!ok) this.gameState1.bufferRotation('cw');
        else this.gameState1.rotateBuffer = null;
        return;
      }

      if (code === b.rotateCCW) {
        const ok = this.gameState1.rotate('ccw');
        if (!ok) this.gameState1.bufferRotation('ccw');
        else this.gameState1.rotateBuffer = null;
        return;
      }

      if (code === b.rotate180) {
        const ok = this.gameState1.rotate('180');
        if (!ok) this.gameState1.bufferRotation('180');
        else this.gameState1.rotateBuffer = null;
        return;
      }

      if (code === b.hold) {
        this.gameState1.holdCurrentPiece();
        return;
      }
    });

    document.addEventListener('keyup', (e) => {
      if (input.isCapturing()) return;

      const code = e.code;
      input.handleKeyUp(code);

      const b = input.getBindings();
      if (this.gameState1 && this.acceptInput && code === b.softDrop) this.gameState1.setSoftDropActive(false);
    });
  }

  /* =========================
     PvP match helpers
  ========================= */
  resetMatchScores() {
    this.match.hostScore = 0;
    this.match.clientScore = 0;
    this.match.round = 0;
    this.updateScoreboard();
  }

  hostSetScoresAndBroadcast() {
    NetworkManager.getInstance().send({
      type: 'scoreUpdate',
      hostScore: this.match.hostScore,
      clientScore: this.match.clientScore,
      round: this.match.round,
    });
  }

  isMatchOver() {
    const t = this.match.targetWins;
    if (!t || t <= 0) return false;
    return (this.match.hostScore >= t) || (this.match.clientScore >= t);
  }

  getMatchWinnerLabelForLocal() {
    const t = this.match.targetWins;
    if (!t || t <= 0) return null;
    const hostWon = this.match.hostScore >= t;
    const localWon = this.isHost ? hostWon : !hostWon;
    return localWon ? 'YOU' : 'OPPONENT';
  }

  showCountdown(seconds, subtitle = 'Get ready…') {
    const overlay = this.countdownOverlay;
    const textEl = document.getElementById('countdownText');
    const subEl = document.getElementById('countdownSub');

    if (!overlay || !textEl || !subEl) return Promise.resolve();

    overlay.classList.remove('hidden');
    subEl.textContent = subtitle;

    this.acceptInput = false;
    this.phase = 'countdown';
    this.updateScoreboard();

    return new Promise((resolve) => {
      let t = Math.max(1, Number(seconds) || 3);
      textEl.textContent = String(t);

      const tick = () => {
        t -= 1;
        if (t > 0) {
          textEl.textContent = String(t);
          setTimeout(tick, 900);
        } else {
          textEl.textContent = 'GO!';
          subEl.textContent = 'Fight!';
          setTimeout(() => {
            overlay.classList.add('hidden');
            resolve();
          }, 550);
        }
      };

      setTimeout(tick, 900);
    });
  }

  sendInitStateSnapshot() {
    if (!NetworkManager.getInstance().isConnected()) return;
    if (!this.gameState1) return;
    if (!this.roundId) return;

    NetworkManager.getInstance().send({
      type: 'gameState',
      roundId: this.roundId,
      init: true,
      state: this.gameState1.getState(),
    });
  }

  async startRound(seed, roundNumber, roundId) {
    if (this.mode !== 'pvp_1v1') return;

    this.roundId = roundId || this.roundId || `${Date.now()}-local`;

    this.phase = 'countdown';
    this.acceptInput = false;

    if (this.gameArea) this.gameArea.classList.remove('hidden');
    if (this.restartBtn) this.restartBtn.classList.remove('hidden');

    this.match.round = Math.max(1, Number(roundNumber) || (this.match.round + 1) || 1);
    this.updateScoreboard();

    GameSettings.getInstance().update();

    this.gameState1 = new GameState('gameCanvas1', 'holdCanvas1', 'queueCanvas1', 1, seed);
    this.gameState2 = new GameState('gameCanvas2', 'holdCanvas2', 'queueCanvas2', 2, seed);

    const startTime = Date.now();
    this.gameState1.setGameStartTime(startTime);
    this.gameState2.setGameStartTime(startTime);

    // Reset loop timing
    this.lastTime = 0;
    this.lastStateSendTime = 0;

    // Clear stuck inputs
    InputManager.getInstance().reset();

    const ok1 = this.gameState1.spawnPiece();
    this.gameState2.spawnPiece();
    if (!ok1) {
      this.handleGameOver();
      return;
    }

    this.gameState1.draw();
    this.gameState2.draw();

    this.sendInitStateSnapshot();

    this.setStatus(`Round ${this.match.round} starting…`);
    ChatManager.addMessage(`Round ${this.match.round} is starting!`, 'System');

    if (!this.gameRunning) {
      this.gameRunning = true;
      this.animationFrameId = requestAnimationFrame(this.gameLoop.bind(this));
    }

    await this.showCountdown(this.match.countdownSeconds, `Round ${this.match.round}`);

    this.phase = 'playing';
    this.acceptInput = true;
    this.setStatus('Game in progress!');
    this.updateScoreboard();
  }

  startNextRoundAsHost(resetRoundCounter = false) {
    if (!this.isHost) return;
    if (!NetworkManager.getInstance().isConnected()) return;

    if (resetRoundCounter) this.match.round = 0;

    const seed = Math.floor(Math.random() * 1e9);
    const nextRound = (this.match.round || 0) + 1;

    const roundId = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    this.roundId = roundId;

    NetworkManager.getInstance().send({
      type: 'startRound',
      seed,
      round: nextRound,
      roundId,
    });

    this.startRound(seed, nextRound, roundId);
  }

  /* =========================
     Network handler (PvP)
  ========================= */
  handleNetworkMessage(msg) {
    if (msg.type === 'chat') {
      ChatManager.addMessage(msg.message, 'Opponent');
      return;
    }

    if (this.mode !== 'pvp_1v1') return;

    switch (msg.type) {
      case 'attack':
        if (this.gameState1) this.gameState1.receiveAttack(msg.lines);
        break;

      case 'peerConnected': {
        if (!this.isHost) break;

        const cfg = this.readMatchConfigFromUI();
        this.applyMatchConfig(cfg, false);

        NetworkManager.getInstance().send({
          type: 'matchConfig',
          targetWins: cfg.targetWins,
          countdownSeconds: cfg.countdownSeconds,
        });

        this.resetMatchScores();
        this.hostSetScoresAndBroadcast();

        this.setStatus('Opponent connected! Starting match…');
        this.startNextRoundAsHost(true);
        break;
      }

      case 'joinedLobby':
        this.setStatus('Connected! Waiting for host…');
        break;

      case 'matchConfig': {
        const cfg = {
          targetWins: Number(msg.targetWins) || 0,
          countdownSeconds: Number(msg.countdownSeconds) || 3,
        };
        this.applyMatchConfig(cfg, true);
        this.phase = 'waiting';
        this.updateScoreboard();
        this.setStatus('Match configured. Waiting for round start…');
        break;
      }

      case 'scoreUpdate': {
        if (typeof msg.hostScore === 'number') this.match.hostScore = msg.hostScore;
        if (typeof msg.clientScore === 'number') this.match.clientScore = msg.clientScore;
        if (typeof msg.round === 'number') this.match.round = msg.round;
        this.updateScoreboard();
        break;
      }

      case 'matchReset': {
        const cfg = {
          targetWins: Number(msg.targetWins) || this.match.targetWins,
          countdownSeconds: Number(msg.countdownSeconds) || this.match.countdownSeconds,
        };
        this.applyMatchConfig(cfg, !this.isHost);
        this.resetMatchScores();
        this.updateScoreboard();

        if (this.isHost) {
          this.hostSetScoresAndBroadcast();
          this.startNextRoundAsHost(true);
        } else {
          this.setStatus('Match reset. Waiting for host…');
        }
        break;
      }

      case 'startRound': {
        const seed = Number(msg.seed) || Math.floor(Math.random() * 1e9);
        const round = Number(msg.round) || ((this.match.round || 0) + 1);

        const roundId = msg.roundId || `${Date.now()}-recv`;
        this.roundId = roundId;

        this.startRound(seed, round, roundId);
        break;
      }

      case 'gameOver': {
        this.acceptInput = false;
        this.phase = 'roundOver';

        ChatManager.addMessage('Opponent topped out! You win the round! 🎉', 'System');
        this.setStatus('Round win!');

        if (this.isHost) {
          this.match.hostScore += 1;
          this.hostSetScoresAndBroadcast();
          this.updateScoreboard();

          if (this.isMatchOver()) {
            const winner = this.getMatchWinnerLabelForLocal();
            NetworkManager.getInstance().send({ type: 'matchOver', winner: 'HOST' });
            this.phase = 'matchOver';
            this.setStatus(`MATCH OVER — ${winner} WINS!`);
            ChatManager.addMessage(`MATCH OVER — ${winner} WINS!`, 'System');
          } else {
            this.setStatus('Next round starting…');
            setTimeout(() => this.startNextRoundAsHost(false), 1400);
          }
        } else {
          this.setStatus('Round win! Waiting for next round…');
        }
        break;
      }

      case 'matchOver': {
        this.acceptInput = false;
        this.phase = 'matchOver';
        this.updateScoreboard();

        const winner = msg.winner === 'HOST'
          ? (this.isHost ? 'YOU' : 'OPPONENT')
          : (this.isHost ? 'OPPONENT' : 'YOU');

        this.setStatus(`MATCH OVER — ${winner} WINS!`);
        ChatManager.addMessage(`MATCH OVER — ${winner} WINS!`, 'System');
        break;
      }

      case 'gameState': {
        if (!this.gameState2 || !msg.state) break;
        if (!msg.roundId || msg.roundId !== this.roundId) break;

        if (msg.init === true) {
          this.gameState2.setState(msg.state);
          break;
        }

        if (this.phase === 'playing' || this.phase === 'countdown') {
          this.gameState2.setState(msg.state);
        }
        break;
      }

      default:
        break;
    }
  }

  /* =========================
     Game over
  ========================= */
  handleGameOver() {
    this.acceptInput = false;

    if (this.mode === 'zen') {
      this.gameRunning = false;
      this.setStatus(`Zen over — Final score: ${this.zenScore}`);
      ChatManager.addMessage('Zen ended (top out). Open Menu to play again.', 'System');
      return;
    }

    // PvP round loss
    this.phase = 'roundOver';
    this.setStatus('You lost the round.');
    ChatManager.addMessage('You topped out! Round lost.', 'System');

    NetworkManager.getInstance().send({ type: 'gameOver' });

    if (this.isHost) {
      this.match.clientScore += 1;
      this.hostSetScoresAndBroadcast();
      this.updateScoreboard();

      if (this.isMatchOver()) {
        const winner = this.getMatchWinnerLabelForLocal();
        NetworkManager.getInstance().send({ type: 'matchOver', winner: 'CLIENT' });
        this.phase = 'matchOver';
        this.setStatus(`MATCH OVER — ${winner} WINS!`);
        ChatManager.addMessage(`MATCH OVER — ${winner} WINS!`, 'System');
      } else {
        this.setStatus('Next round starting…');
        setTimeout(() => this.startNextRoundAsHost(false), 1400);
      }
    } else {
      this.setStatus('Round lost. Waiting for next round…');
    }
  }

  /* =========================
     Main loop
  ========================= */
  gameLoop(timestamp) {
    if (!this.gameRunning) return;

    if (!Number.isFinite(timestamp)) timestamp = performance.now();

    let deltaTime = 0;
    if (Number.isFinite(this.lastTime) && this.lastTime > 0) {
      deltaTime = timestamp - this.lastTime;
      if (!Number.isFinite(deltaTime) || deltaTime < 0 || deltaTime > 1000) deltaTime = 0;
    }
    this.lastTime = timestamp;

    try {
      if (this.gameState1) {
        const input = InputManager.getInstance();

        if (this.mode === 'zen') {
          // Zen: always update
          if (this.acceptInput && !this.gameState1.softDropActive) {
            input.processMovement(deltaTime, (dx) => this.gameState1.move(dx));
          }

          const ok = this.gameState1.update(deltaTime);
          if (!ok) {
            this.handleGameOver();
            return;
          }

          this.gameState1.draw();
        } else {
          // PvP: only update during playing
          if (this.phase === 'playing') {
            if (this.acceptInput && !this.gameState1.softDropActive) {
              input.processMovement(deltaTime, (dx) => this.gameState1.move(dx));
            }

            const ok = this.gameState1.update(deltaTime);
            if (!ok) {
              this.handleGameOver();
            }
          }

          // Send state (during countdown + playing)
          const inRound = (this.phase === 'playing' || this.phase === 'countdown');
          if (
            inRound &&
            this.roundId &&
            NetworkManager.getInstance().isConnected() &&
            (timestamp - this.lastStateSendTime) > STATE_SEND_INTERVAL
          ) {
            NetworkManager.getInstance().send({
              type: 'gameState',
              roundId: this.roundId,
              state: this.gameState1.getState(),
            });
            this.lastStateSendTime = timestamp;
          }

          this.gameState1.draw();
        }
      }

      if (this.gameState2 && this.mode === 'pvp_1v1') this.gameState2.draw();
    } catch (err) {
      console.error('gameLoop error:', err);
    }

    this.animationFrameId = requestAnimationFrame(this.gameLoop.bind(this));
  }
}
