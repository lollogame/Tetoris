'use strict';

class GameController {
  constructor() {
    this.gameState1 = null;
    this.gameState2 = null;

    // Match / round flow
    this.isHost = false;
    this.phase = 'idle'; // idle | waiting | countdown | playing | roundOver | matchOver
    this.match = {
      targetWins: 3,        // 0 means infinite
      countdownSeconds: 3,
      hostScore: 0,
      clientScore: 0,
      round: 0,
    };

    // Loop timing
    this.gameRunning = false; // "loop active"
    this.lastTime = 0;
    this.lastStateSendTime = 0;
    this.animationFrameId = null;

    // Input gating
    this.acceptInput = false;

    this.setupUI();
    this.setupInput();
    this.setupSettingsModal();

    // Start with menu/settings buttons available, game hidden
    this.updateScoreboard();
  }

  /* =========================
     UI helpers
  ========================= */
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

    // Show scoreboard once match is in any meaningful state
    const shouldShow = (this.phase !== 'idle');
    this.showScoreboard(shouldShow);
  }

  /* =========================
     Countdown Overlay
  ========================= */
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

  /* =========================
     Settings modal
  ========================= */
  setupSettingsModal() {
    const openBtn = document.getElementById('openSettingsBtn');
    const closeBtn = document.getElementById('closeSettingsBtn');
    const modal = document.getElementById('settingsModal');

    if (openBtn && modal) openBtn.addEventListener('click', () => modal.classList.remove('hidden'));
    if (closeBtn && modal) closeBtn.addEventListener('click', () => modal.classList.add('hidden'));

    // Close modal when clicking outside content
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

    // Host decides; joiner gets locked
    if (lockUI) {
      if (mf) mf.disabled = true;
      if (cd) cd.disabled = true;
    } else {
      if (mf) mf.disabled = false;
      if (cd) cd.disabled = false;
    }

    this.updateScoreboard();
  }

  /* =========================
     Core UI wiring
  ========================= */
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

      // Host controls match settings (unlock)
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

      // Joiners will be locked when host sends config
      this.applyMatchConfig(this.readMatchConfigFromUI(), true);

      NetworkManager.getInstance().initialize(this.handleNetworkMessage.bind(this));
      setTimeout(() => NetworkManager.getInstance().connect(opponentId), 300);
    });

    document.getElementById('restartBtn').addEventListener('click', () => {
      // For now: allow both. Later: make host-only.
      // Treat restart as "reset match to 0-0 and start round 1"
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

  /* =========================
     Input (locked during countdown/roundOver/matchOver)
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

      // Still prevent arrow scrolling for bound codes even when locked
      if (Object.values(b).includes(code)) e.preventDefault();

      if (!this.acceptInput || !this.gameState1) {
        // Still track held codes so IRS/etc works once round begins
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
      if (!ok) { this.handleGameOver(); }
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
  const ok = this.gameState1.holdCurrentPiece();
  if (!ok) this.handleGameOver();
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

  showRoundOverlay(title, sub) {
  const ov = document.getElementById('roundOverlay');
  document.getElementById('roundOverlayTitle').textContent = title;
  document.getElementById('roundOverlaySub').textContent = sub || '';
  ov.classList.remove('hidden');
}

hideRoundOverlay() {
  document.getElementById('roundOverlay').classList.add('hidden');
}

sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async runCountdown(seconds = 3) {
  for (let t = seconds; t >= 1; t--) {
    this.showRoundOverlay(String(t), 'Get ready...');
    await this.sleep(700);
  }
  this.showRoundOverlay('GO!', '');
  await this.sleep(450);
  this.hideRoundOverlay();
}

  resetBoardsForNewRound(seed) {
  // Fresh states so loser doesn't keep old board
  this.gameState1 = new GameState('gameCanvas1','holdCanvas1','queueCanvas1',1,seed);
  this.gameState2 = new GameState('gameCanvas2','holdCanvas2','queueCanvas2',2,seed);

  const startTime = Date.now();
  this.gameState1.setGameStartTime(startTime);
  this.gameState2.setGameStartTime(startTime);

  InputManager.getInstance().reset();

  // Spawn both; if fail, something is extremely wrong, but handle safely
  const ok1 = this.gameState1.spawnPiece();
  const ok2 = this.gameState2.spawnPiece();

  // Force redraw immediately
  this.gameState1.draw();
  this.gameState2.draw();

  return ok1 && ok2;
}


  /* =========================
     Match helpers
  ========================= */
  resetMatchScores() {
    this.match.hostScore = 0;
    this.match.clientScore = 0;
    this.match.round = 0;
    this.updateScoreboard();
  }

  hostSetScoresAndBroadcast() {
    // Send host/client absolute scores so receiver can map correctly
    NetworkManager.getInstance().send({
      type: 'scoreUpdate',
      hostScore: this.match.hostScore,
      clientScore: this.match.clientScore,
      round: this.match.round,
    });
  }

  isMatchOver() {
    const t = this.match.targetWins;
    if (!t || t <= 0) return false; // infinite
    return (this.match.hostScore >= t) || (this.match.clientScore >= t);
  }

  getMatchWinnerLabelForLocal() {
    const t = this.match.targetWins;
    if (!t || t <= 0) return null;
    const hostWon = this.match.hostScore >= t;
    const localWon = this.isHost ? hostWon : !hostWon;
    return localWon ? 'YOU' : 'OPPONENT';
  }

  /* =========================
     Round start / loop
  ========================= */
  async startRound(seed, roundNumber) {
    this.phase = 'countdown';
    this.acceptInput = false;

    document.getElementById('gameArea').classList.remove('hidden');
    document.getElementById('restartBtn').classList.remove('hidden');

    // Update match round
    this.match.round = Math.max(1, Number(roundNumber) || (this.match.round + 1) || 1);
    this.updateScoreboard();

    // Apply settings at round start
    GameSettings.getInstance().update();

    // Create game states fresh each round (clean + simple)
    this.gameState1 = new GameState('gameCanvas1', 'holdCanvas1', 'queueCanvas1', 1, seed);
    this.gameState2 = new GameState('gameCanvas2', 'holdCanvas2', 'queueCanvas2', 2, seed);

    const startTime = Date.now();
    this.gameState1.setGameStartTime(startTime);
    this.gameState2.setGameStartTime(startTime);

    // Clear stuck inputs
    InputManager.getInstance().reset();

    // Spawn initial pieces so boards look ready during countdown
    this.gameState1.spawnPiece();
    this.gameState2.spawnPiece();

    // After spawnPiece() calls, before countdown:
if (NetworkManager.getInstance().isConnected()) {
  NetworkManager.getInstance().send({
    type: 'gameState',
    round: this.match.round,
    state: this.gameState1.getState(),
    init: true
  });
}


    this.setStatus(`Round ${this.match.round} starting…`);
    ChatManager.addMessage(`Round ${this.match.round} is starting!`, 'System');

    // Ensure loop is running
    if (!this.gameRunning) {
      this.gameRunning = true;
      this.lastTime = 0;
      this.lastStateSendTime = 0;
      this.gameLoop();
    }

    // Countdown lock
    await this.showCountdown(this.match.countdownSeconds, `Round ${this.match.round}`);

    // Start playing
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

    // Broadcast start
    NetworkManager.getInstance().send({
      type: 'startRound',
      seed,
      round: nextRound,
    });

    // Start locally
    this.startRound(seed, nextRound);
  }

  /* =========================
     Network message handling
  ========================= */
  handleNetworkMessage(msg) {
    switch (msg.type) {
      case 'chat':
        ChatManager.addMessage(msg.message, 'Opponent');
        break;

      case 'attack':
        if (this.gameState1) this.gameState1.receiveAttack(msg.lines);
        break;

      // Host: peer connected → send config + start round 1
      case 'peerConnected': {
        if (!this.isHost) break;

        // Read settings from UI and broadcast
        const cfg = this.readMatchConfigFromUI();
        this.applyMatchConfig(cfg, false);

        NetworkManager.getInstance().send({
          type: 'matchConfig',
          targetWins: cfg.targetWins,
          countdownSeconds: cfg.countdownSeconds,
        });

        // Reset scores at new connection
        this.resetMatchScores();
        this.hostSetScoresAndBroadcast();

        this.setStatus('Opponent connected! Starting match…');
        this.startNextRoundAsHost(true);
        break;
      }

      // Joiner has connected; nothing to do, wait for host config / round start
      case 'joinedLobby':
        this.setStatus('Connected! Waiting for host…');
        break;

      // Joiner receives host config
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
        // Everyone receives absolute host/client scores
        if (typeof msg.hostScore === 'number') this.match.hostScore = msg.hostScore;
        if (typeof msg.clientScore === 'number') this.match.clientScore = msg.clientScore;
        if (typeof msg.round === 'number') this.match.round = msg.round;
        this.updateScoreboard();
        break;
      }

      case 'matchReset': {
        // Host or peer requested reset; host is authoritative, but keep it simple:
        const cfg = {
          targetWins: Number(msg.targetWins) || this.match.targetWins,
          countdownSeconds: Number(msg.countdownSeconds) || this.match.countdownSeconds,
        };
        this.applyMatchConfig(cfg, !this.isHost);
        this.resetMatchScores();
        this.updateScoreboard();
        this.setStatus('Match reset.');
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
        this.startRound(seed, round);
        break;
      }

      // Opponent lost the round, so we won
      case 'gameOver': {
        this.acceptInput = false;
        this.phase = 'roundOver';

        ChatManager.addMessage('Opponent topped out! You win the round! 🎉', 'System');
        this.setStatus('Round win!');

        if (this.isHost) {
          // Host awards point to host-side player if host is local winner
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
          // Client just waits for host to start next round
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

  // Only accept board updates while we're actually in-round
  // (prevents stale packets from overwriting freshly reset boards)
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
     Local game over (we lost)
  ========================= */
  handleGameOver() {
    this.acceptInput = false;
    this.phase = 'roundOver';
    this.setStatus('You lost the round.');
    ChatManager.addMessage('You topped out! Round lost.', 'System');

    // Tell opponent we lost
    NetworkManager.getInstance().send({ type: 'gameOver' });

    // Host assigns point to client side when host loses
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
  gameLoop(timestamp = 0) {
    if (!this.gameRunning) return;

    const deltaTime = (this.lastTime === 0) ? 0 : (timestamp - this.lastTime);
    this.lastTime = timestamp;

    if (this.gameState1) {
      const input = InputManager.getInstance();

      // Only process movement + update during active play
      if (this.phase === 'playing' && this.acceptInput) {
        if (!this.gameState1.softDropActive) {
          input.processMovement(deltaTime, (dx) => this.gameState1.move(dx));
        }

        const ok = this.gameState1.update(deltaTime);
        if (!ok) { this.handleGameOver(); return; }

        if (NetworkManager.getInstance().isConnected() && (timestamp - this.lastStateSendTime) > STATE_SEND_INTERVAL) {
          NetworkManager.getInstance().send({
  type: 'gameState',
  round: this.match.round,
  state: this.gameState1.getState()
});

          this.lastStateSendTime = timestamp;
        }
      }

      // Always draw (even during countdown / roundOver)
      this.gameState1.draw();
    }

    if (this.gameState2) this.gameState2.draw();

    this.animationFrameId = requestAnimationFrame(this.gameLoop.bind(this));
  }
}
