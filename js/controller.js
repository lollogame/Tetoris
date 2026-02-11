'use strict';

class GameController {
  constructor() {
    this.gameState1 = null; // local player
    this.gameState2 = null; // remote player view

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

    this.gameRunning = false;
    this.lastTime = 0;
    this.lastStateSendTime = 0;
    this.animationFrameId = null;

    this.acceptInput = false;

    this.setupUI();
    this.setupInput();
    this.setupSettingsModal();

    this.updateScoreboard();
  }

  setStatus(text) {
    document.getElementById('gameStatus').textContent = text;
  }

  showScoreboard(show) {
    const el = document.getElementById('scoreboard');
    if (!el) return;
    el.classList.toggle('hidden', !show);
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
    const formatPill = document.getElementById('matchFormatPill');
    const roundPill = document.getElementById('matchRoundPill');
    const scorePill = document.getElementById('matchScorePill');

    const fmt = this.formatLabelFromTarget(this.match.targetWins);
    if (formatPill) formatPill.innerHTML = `FORMAT: <strong>${fmt}</strong>`;
    if (roundPill) roundPill.innerHTML = `ROUND: <strong>${Math.max(1, this.match.round)}</strong>`;
    if (scorePill) scorePill.innerHTML = `YOU <strong>${this.getLocalScore()}</strong> — <strong>${this.getOppScore()}</strong> OPP`;

    this.showScoreboard(this.phase !== 'idle');
  }

  showCountdown(seconds, subtitle = 'Get ready…') {
    const overlay = document.getElementById('countdownOverlay');
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

  setupSettingsModal() {
    const openBtn = document.getElementById('openSettingsBtn');
    const closeBtn = document.getElementById('closeSettingsBtn');
    const modal = document.getElementById('settingsModal');

    if (openBtn && modal) openBtn.addEventListener('click', () => modal.classList.remove('hidden'));
    if (closeBtn && modal) closeBtn.addEventListener('click', () => modal.classList.add('hidden'));

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.add('hidden');
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

  setupUI() {
    window.copyPeerId = () => {
      const id = document.getElementById('peerIdDisplay').textContent;
      navigator.clipboard.writeText(id).then(() => ChatManager.addMessage('Peer ID copied to clipboard!'));
    };

    document.getElementById('createGameBtn').addEventListener('click', () => {
      this.isHost = true;
      this.phase = 'waiting';
      this.acceptInput = false;
      this.updateScoreboard();

      NetworkManager.getInstance().initialize(this.handleNetworkMessage.bind(this));
      this.setStatus('Waiting for opponent to join...');
      document.getElementById('createGameBtn').disabled = true;

      this.applyMatchConfig(this.readMatchConfigFromUI(), false);
    });

    document.getElementById('joinGameBtn').addEventListener('click', () => {
      const opponentId = document.getElementById('opponentPeerId').value.trim();
      if (!opponentId) {
        ChatManager.addMessage('Please enter an opponent Peer ID');
        return;
      }

      this.isHost = false;
      this.phase = 'waiting';
      this.acceptInput = false;
      this.updateScoreboard();

      this.applyMatchConfig(this.readMatchConfigFromUI(), true);

      NetworkManager.getInstance().initialize(this.handleNetworkMessage.bind(this));
      setTimeout(() => NetworkManager.getInstance().connect(opponentId), 300);
    });

    document.getElementById('restartBtn').addEventListener('click', () => {
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

    document.getElementById('sendChatBtn').addEventListener('click', () => {
      const el = document.getElementById('chatInput');
      const msg = el.value.trim();
      if (msg && NetworkManager.getInstance().isConnected()) {
        NetworkManager.getInstance().send({ type: 'chat', message: msg });
        ChatManager.addMessage(msg, 'You');
        el.value = '';
      }
    });

    document.getElementById('chatInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') document.getElementById('sendChatBtn').click();
    });

    ChatManager.addMessage('Welcome to Tetris Online Battle!');
    ChatManager.addMessage('Create a game to host, or enter a Peer ID to join.');
  }

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

      if (code === b.softDrop) { this.gameState1.setSoftDropActive(true); return; }

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
    this.roundId = roundId || this.roundId || `${Date.now()}-local`;

    this.phase = 'countdown';
    this.acceptInput = false;

    document.getElementById('gameArea').classList.remove('hidden');
    document.getElementById('restartBtn').classList.remove('hidden');

    this.match.round = Math.max(1, Number(roundNumber) || (this.match.round + 1) || 1);
    this.updateScoreboard();

    GameSettings.getInstance().update();

    this.gameState1 = new GameState('gameCanvas1', 'holdCanvas1', 'queueCanvas1', 1, seed);
    this.gameState2 = new GameState('gameCanvas2', 'holdCanvas2', 'queueCanvas2', 2, seed);

    const startTime = Date.now();
    this.gameState1.setGameStartTime(startTime);
    this.gameState2.setGameStartTime(startTime);

    // ✅ IMPORTANT: do NOT poison timing; reset lastTime before (re)starting loop
    this.lastTime = 0;
    this.lastStateSendTime = 0;

    // Clear stuck inputs (fine)
    InputManager.getInstance().reset();

    const ok1 = this.gameState1.spawnPiece();
    this.gameState2.spawnPiece();
    if (!ok1) { this.handleGameOver(); return; }

    this.gameState1.draw();
    this.gameState2.draw();

    this.sendInitStateSnapshot();

    this.setStatus(`Round ${this.match.round} starting…`);
    ChatManager.addMessage(`Round ${this.match.round} is starting!`, 'System');

    // ✅ CRITICAL FIX: never call gameLoop() directly
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

    const seed = Math.floor(Math.random() * 1000000000);
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

  handleNetworkMessage(msg) {
    switch (msg.type) {
      case 'chat':
        ChatManager.addMessage(msg.message, 'Opponent');
        break;

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
        const seed = Number(msg.seed) || Math.floor(Math.random() * 1000000000);
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

  handleGameOver() {
    this.acceptInput = false;
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

  gameLoop(timestamp) {
    if (!this.gameRunning) return;

    // ✅ Robust timestamp handling
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

        if (this.phase === 'playing') {
          if (this.acceptInput && !this.gameState1.softDropActive) {
            input.processMovement(deltaTime, (dx) => this.gameState1.move(dx));
          }

          const ok = this.gameState1.update(deltaTime);
          if (!ok) { this.handleGameOver(); return; }
        }

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
            state: this.gameState1.getState()
          });
          this.lastStateSendTime = timestamp;
        }

        this.gameState1.draw();
      }

      if (this.gameState2) this.gameState2.draw();
    } catch (err) {
      console.error('gameLoop error:', err);
    }

    this.animationFrameId = requestAnimationFrame(this.gameLoop.bind(this));
  }
}
