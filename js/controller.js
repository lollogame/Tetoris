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
    this.stateSendIntervalMs = STATE_SEND_INTERVAL;
    this.networkRttMs = null;

    // Input gating
    this.acceptInput = false;
    this.zenPaused = false;

    // Guards for stale async flows (countdown / delayed round starts)
    this._roundFlowToken = 0;
    this._roundFlowTimers = new Set();
    this._resultOverlayTimer = null;
    this._roundStatsTimer = null;

    // Join connect waiter (bounded retries)
    this._joinAttemptToken = 0;
    this._joinWaitTimer = null;
    this.joinPeerOpenTimeoutMs = 5000;
    this.joinPeerOpenPollMs = 60;
    this.joinPeerOpenRetryBudget = 3;

    // UI
    this.cacheUI();
    this.setupUI();
    this.setupInput();
    this.setupSettingsModal();
    this.setupMenu();
    this.initLocalPersistence();


    this.applyModeUI();
    this.updateScoreboard();
    this.showMenu(true);

    this._beforeUnloadHandler = (event) => {
      if (!this.shouldConfirmLeaveMatch()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', this._beforeUnloadHandler);
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
    this.networkStatus = document.getElementById('networkStatus');

    this.scoreboard = document.getElementById('scoreboard');

    // Countdown overlay
    this.countdownOverlay = document.getElementById('countdownOverlay');

    // Result / KO overlay
    this.resultOverlay = document.getElementById('resultOverlay');
    this.resultText = document.getElementById('resultText');
    this.resultSub = document.getElementById('resultSub');
    this.roundStatsPanel = document.getElementById('roundStatsPanel');
    this.roundStatsTitle = document.getElementById('roundStatsTitle');
    this.combatFeed1 = document.getElementById('combatFeed1');
    this.combatFeed2 = document.getElementById('combatFeed2');
    this.boardWrap1 = document.getElementById('boardWrap1');
    this.boardWrap2 = document.getElementById('boardWrap2');

    // Containers
    const players = document.querySelectorAll('.player-container');
    this.localContainer = players[0] || null;
    this.opponentContainer = players[1] || null;

    this.connPanel = document.querySelector('.connection-panel');
  }

  /* =========================
     Small UI helpers
  ========================= */
  setLobbyControlsEnabled(enabled) {
    const on = !!enabled;
    if (this.createBtn) this.createBtn.disabled = !on;
    if (this.joinBtn) this.joinBtn.disabled = !on;
    if (this.opponentPeerIdInput) this.opponentPeerIdInput.disabled = !on;
  }

  setMatchConfigLocked(locked) {
    const on = !!locked;
    const mf = document.getElementById('matchFormat');
    const cd = document.getElementById('countdownSeconds');
    if (mf) mf.disabled = on;
    if (cd) cd.disabled = on;
  }

  _setRoundFlowTimeout(callback, delayMs) {
    const safeDelay = Math.max(0, Number(delayMs) || 0);
    const id = window.setTimeout(() => {
      this._roundFlowTimers.delete(id);
      callback();
    }, safeDelay);
    this._roundFlowTimers.add(id);
    return id;
  }

  _clearRoundFlowTimeouts() {
    for (const id of this._roundFlowTimers) {
      window.clearTimeout(id);
    }
    this._roundFlowTimers.clear();
  }

  _invalidateRoundFlow() {
    this._roundFlowToken += 1;
    this._clearRoundFlowTimeouts();
    return this._roundFlowToken;
  }

  _clearJoinWaitTimer() {
    if (this._joinWaitTimer == null) return;
    window.clearTimeout(this._joinWaitTimer);
    this._joinWaitTimer = null;
  }

  _cancelJoinConnectLoop() {
    this._joinAttemptToken += 1;
    this._clearJoinWaitTimer();
  }

  _scheduleJoinPeerWait(callback, delayMs) {
    this._clearJoinWaitTimer();
    const safeDelay = Math.max(0, Number(delayMs) || 0);
    this._joinWaitTimer = window.setTimeout(() => {
      this._joinWaitTimer = null;
      callback();
    }, safeDelay);
  }

  _isMenuVisible() {
    return !!(this.elMenu && !this.elMenu.classList.contains('hidden'));
  }

  _isSettingsVisible() {
    return !!(this.settingsModal && !this.settingsModal.classList.contains('hidden'));
  }

  _updateZenPauseState() {
    if (this.mode !== 'zen' || !this.gameRunning) {
      this.zenPaused = false;
      return;
    }

    const shouldPause = this._isMenuVisible() || this._isSettingsVisible();
    if (shouldPause) {
      if (!this.zenPaused) this.setStatus(`Zen paused - Score: ${this.zenScore}`);
      this.zenPaused = true;
      this.acceptInput = false;
      this.lastTime = 0;
      return;
    }

    if (this.zenPaused) {
      this.zenPaused = false;
      this.acceptInput = true;
      this.lastTime = 0;
      this.setStatus(`Zen mode - Score: ${this.zenScore}`);
    }
  }

  _computeAdaptiveStateSendInterval(rttMs) {
    const safe = this._clampInt(rttMs, 0, 5000, 0);
    if (safe <= 0) return STATE_SEND_INTERVAL;
    if (safe < 120) return STATE_SEND_INTERVAL;
    if (safe < 220) return 65;
    if (safe < 350) return 80;
    return 100;
  }

  _setNetworkRtt(rttMs) {
    const safe = this._clampInt(rttMs, 1, 5000, 0);
    if (safe <= 0) return;
    this.networkRttMs = safe;
    this.stateSendIntervalMs = this._computeAdaptiveStateSendInterval(safe);
    this.updateNetworkStatus();
  }

  handlePeerDisconnected() {
    this._invalidateRoundFlow();
    this._cancelJoinConnectLoop();
    this.acceptInput = false;
    this.zenPaused = false;
    this.stopLoop();
    this.stateSendIntervalMs = STATE_SEND_INTERVAL;
    this.networkRttMs = null;

    this.gameState1 = null;
    this.gameState2 = null;
    this.phase = 'waiting';
    this.roundId = null;

    this.hideResultOverlay();
    this.hideRoundStatsPanel();
    this.clearCombatFeed();
    if (this.gameArea) this.gameArea.classList.add('hidden');
    if (this.restartBtn) this.restartBtn.classList.add('hidden');

    this.setLobbyControlsEnabled(true);
    this.setMatchConfigLocked(false);
    this.setStatus('Opponent disconnected. Create or join a new match.');
    this.updateScoreboard();
    this.updateNetworkStatus();
  }

  setStatus(text) {
    if (this.gameStatus) this.gameStatus.textContent = text;
  }

  updateNetworkStatus() {
    if (!this.networkStatus) return;

    if (this.mode !== 'pvp_1v1') {
      this.networkStatus.classList.add('hidden');
      this.networkStatus.textContent = '';
      return;
    }

    const connected = NetworkManager.getInstance().isConnected();
    const waiting = (this.phase === 'waiting' || this.phase === 'countdown' || this.phase === 'playing');

    if (!connected) {
      if (!waiting) {
        this.networkStatus.classList.add('hidden');
        this.networkStatus.textContent = '';
        return;
      }
      this.networkStatus.classList.remove('hidden');
      this.networkStatus.textContent = 'Network: waiting for connection...';
      return;
    }

    const rttText = Number.isFinite(this.networkRttMs) ? `${this.networkRttMs}ms` : '--';
    const syncText = `${this.stateSendIntervalMs}ms`;
    this.networkStatus.classList.remove('hidden');
    this.networkStatus.textContent = `Network: RTT ${rttText} | Sync ${syncText}`;
  }

  shouldConfirmLeaveMatch() {
    if (this.mode !== 'pvp_1v1') return false;
    const nm = NetworkManager.getInstance();
    const connected = nm.isConnected();
    if (connected) return true;

    const inRoundOrOver =
      this.phase === 'countdown' ||
      this.phase === 'playing' ||
      this.phase === 'roundOver' ||
      this.phase === 'matchOver';
    if (inRoundOrOver) return true;

    if (this.phase === 'waiting') {
      const hasPeerSession = !!(nm.peer && !nm.peer.destroyed);
      return hasPeerSession || (Number(this.match.round) || 0) > 0;
    }

    return false;
  }

  clearCombatFeed() {
    const clearOne = (el) => {
      if (!el) return;
      while (el.firstChild) el.removeChild(el.firstChild);
    };
    clearOne(this.combatFeed1);
    clearOne(this.combatFeed2);
  }

  pushCombatText(playerId, text, kind = 'neutral') {
    const feed = (playerId === 2) ? this.combatFeed2 : this.combatFeed1;
    if (!feed || !text) return;

    const row = document.createElement('div');
    row.className = `combat-text ${kind}`;
    row.textContent = String(text);
    feed.appendChild(row);

    while (feed.children.length > 8) {
      feed.removeChild(feed.firstElementChild);
    }

    const removeAfter = 1300;
    window.setTimeout(() => {
      if (row.parentNode === feed) feed.removeChild(row);
    }, removeAfter);
  }

  triggerScreenShake(playerId, intensity = 'light') {
    const settings = GameSettings.getInstance();
    if (!settings.screenShake) return;

    const wrap = (playerId === 2) ? this.boardWrap2 : this.boardWrap1;
    if (!wrap) return;

    const cls = intensity === 'heavy' ? 'shake-heavy' : 'shake-light';
    wrap.classList.remove('shake-light', 'shake-heavy');
    void wrap.offsetWidth; // restart animation
    wrap.classList.add(cls);
    window.setTimeout(() => wrap.classList.remove(cls), 220);
  }

  handleCombatEvent(playerId, event) {
    if (!event || typeof event !== 'object') return;

    switch (event.type) {
      case 'clear': {
        if (event.isSpin && event.linesCleared > 0) this.pushCombatText(playerId, 'T-SPIN', 'spin');
        if (event.b2bBonus) this.pushCombatText(playerId, 'B2B', 'b2b');
        if ((Number(event.combo) || 0) >= 2) this.pushCombatText(playerId, `COMBO x${event.combo}`, 'combo');
        if (event.isAllClear) this.pushCombatText(playerId, 'ALL CLEAR', 'allclear');
        if ((Number(event.attackSent) || 0) > 0) this.pushCombatText(playerId, `+${event.attackSent}`, 'attack');

        if ((Number(event.linesCleared) || 0) >= 2 || (Number(event.attackSent) || 0) > 0) {
          this.triggerScreenShake(playerId, 'light');
        }
        break;
      }

      case 'incomingGarbage': {
        const lines = Number(event.lines) || 0;
        if (lines > 0) this.pushCombatText(playerId, `IN +${lines}`, 'incoming');
        this.triggerScreenShake(playerId, 'light');
        break;
      }

      case 'garbageApplied': {
        const lines = Number(event.lines) || 0;
        if (lines > 0) this.pushCombatText(playerId, `GARBAGE +${lines}`, 'incoming');
        this.triggerScreenShake(playerId, 'heavy');
        break;
      }

      default:
        break;
    }
  }

  hideRoundStatsPanel() {
    window.clearTimeout(this._roundStatsTimer);
    this._roundStatsTimer = null;
    if (this.roundStatsPanel) this.roundStatsPanel.classList.add('hidden');
  }

  _readRoundStats(gameState) {
    if (!gameState) {
      return { pps: 0, apm: 0, vs: 0, misdrops: 0, finesse: 0 };
    }

    const startTime = Number(gameState.gameStartTime) || Date.now();
    const elapsedSec = Math.max(0.001, (Date.now() - startTime) / 1000);
    const piecesPlaced = Math.max(0, Number(gameState.piecesPlaced) || 0);
    const attacksSent = Math.max(0, Number(gameState.attacksSent) || 0);
    const pps = piecesPlaced / elapsedSec;
    const apm = (attacksSent * 60) / elapsedSec;
    const vs = apm + (pps * 45);

    return {
      pps,
      apm,
      vs,
      misdrops: Math.max(0, Number(gameState.misdrops) || 0),
      finesse: Math.max(0, Number(gameState.finesseErrors) || 0),
    };
  }

  showRoundStatsPanel(title = 'ROUND STATS', { persistent = false, durationMs = 6500 } = {}) {
    if (!this.roundStatsPanel) return;

    const localStats = this._readRoundStats(this.gameState1);
    const oppStats = (this.mode === 'pvp_1v1') ? this._readRoundStats(this.gameState2) : null;

    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };

    if (this.roundStatsTitle) this.roundStatsTitle.textContent = String(title);

    setText('rsYouPps', localStats.pps.toFixed(2));
    setText('rsYouApm', localStats.apm.toFixed(2));
    setText('rsYouVs', localStats.vs.toFixed(2));
    setText('rsYouMisdrops', String(localStats.misdrops));
    setText('rsYouFinesse', String(localStats.finesse));

    setText('rsOppPps', oppStats ? oppStats.pps.toFixed(2) : '--');
    setText('rsOppApm', oppStats ? oppStats.apm.toFixed(2) : '--');
    setText('rsOppVs', oppStats ? oppStats.vs.toFixed(2) : '--');
    setText('rsOppMisdrops', oppStats ? String(oppStats.misdrops) : '--');
    setText('rsOppFinesse', oppStats ? String(oppStats.finesse) : '--');

    this.roundStatsPanel.classList.remove('hidden');

    window.clearTimeout(this._roundStatsTimer);
    this._roundStatsTimer = null;
    if (!persistent) {
      this._roundStatsTimer = window.setTimeout(() => this.hideRoundStatsPanel(), Math.max(1200, Number(durationMs) || 6500));
    }
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
      this.hideResultOverlay();
      this.hideRoundStatsPanel();
    } else {
      this.elMenu.classList.add('hidden');
      // restore input only if actually in a playable state
      if (this.mode === 'zen') {
        this.acceptInput = this.gameRunning && !this._isSettingsVisible();
      } else {
        this.acceptInput = (this.phase === 'playing');
      }
    }

    this._updateZenPauseState();
  }

  openSettings() {
    if (!this.settingsModal) return;
    this.settingsModal.classList.remove('hidden');
    this._updateZenPauseState();
  }

  closeSettings() {
    if (!this.settingsModal) return;
    this.settingsModal.classList.add('hidden');
    this._updateZenPauseState();
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

    if (this.mode === 'pvp_1v1' && mode !== 'pvp_1v1' && this.shouldConfirmLeaveMatch()) {
      const ok = window.confirm('Leave the current 1v1 match? Current match progress will be lost.');
      if (!ok) return;
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
    if (this.mode !== 'pvp_1v1') this.hideRoundStatsPanel();

    // Set status message
    if (this.mode === 'zen') {
      this.setStatus('Zen mode: press Play in the Menu to start.');
    } else if (this.mode === 'pvp_1v1') {
      this.setStatus('1v1 mode: host or join, then play the match.');
    }

    // Hide game area until a mode actually starts
    if (this.gameArea) {
      const shouldShow = (this.mode === 'zen') ? this.gameRunning : (this.phase !== 'idle');
      this.gameArea.classList.toggle('hidden', !shouldShow);
    }

    this._updateZenPauseState();
    this.updateNetworkStatus();
  }

  stopLoop() {
    this.gameRunning = false;
    this.zenPaused = false;
    if (this.animationFrameId != null) cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = null;
  }

  resetForNewMode() {
    this._invalidateRoundFlow();
    this._cancelJoinConnectLoop();
    this.stopLoop();
    this.gameState1 = null;
    this.gameState2 = null;
    this.lastTime = 0;
    this.lastStateSendTime = 0;
    this.stateSendIntervalMs = STATE_SEND_INTERVAL;
    this.networkRttMs = null;

    // PvP state reset (but keep match settings)
    this.phase = 'idle';
    this.roundId = null;
    this.acceptInput = false;
    this.zenPaused = false;

    this.hideResultOverlay();
    this.hideRoundStatsPanel();
    this.clearCombatFeed();

    // UI
    if (this.gameArea) this.gameArea.classList.add('hidden');
    if (this.restartBtn) this.restartBtn.classList.add('hidden');
    this.setLobbyControlsEnabled(true);
    this.setMatchConfigLocked(false);

    // Clear local attack hook
    const nm = NetworkManager.getInstance();
    if (nm && typeof nm.setLocalAttackHandler === 'function') nm.setLocalAttackHandler(null);

    this.updateScoreboard();
    this.updateNetworkStatus();
  }

  startSelectedMode() {
    this.resetForNewMode();
    this.hideResultOverlay();

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
    this._invalidateRoundFlow();
    this._cancelJoinConnectLoop();
    this.zenScore = 0;
    this.isHost = false;
    this.phase = 'playing';
    this.acceptInput = true;
    this.zenPaused = false;
    this.roundId = null;

    this.hideResultOverlay();
    this.hideRoundStatsPanel();
    this.clearCombatFeed();

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

    try {
      this.gameState1 = new GameState('gameCanvas1', 'holdCanvas1', 'queueCanvas1', 1, seed);
      this.gameState1.setRoundId(null);
      this.gameState1.setCombatEventHandler((event) => this.handleCombatEvent(1, event));

      const startTime = Date.now();
      this.gameState1.setGameStartTime(startTime);

      InputManager.getInstance().reset();

      const ok = this.gameState1.spawnPiece();
      if (!ok) {
        this.handleGameOver();
        return;
      }

      this.gameState1.draw();
    } catch (err) {
      console.error('Zen failed to start:', err);
      this.setStatus(`Zen failed to start: ${err?.message || err}`);
      ChatManager.addMessage('Zen failed to start. Check console for details.', 'System');
      this.gameRunning = false;
      this.acceptInput = false;
      return;
    }

    this.setStatus(`Zen mode — Score: ${this.zenScore}`);
    ChatManager.addMessage('Zen started. Good luck!', 'System');

    this.gameRunning = true;
    this.lastTime = 0;
    this.lastStateSendTime = 0;
    this.stateSendIntervalMs = STATE_SEND_INTERVAL;
    this.animationFrameId = requestAnimationFrame(this.gameLoop.bind(this));

    this.applyModeUI();
    this._updateZenPauseState();
    this.updateNetworkStatus();
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
   Local persistence (settings + keybinds + match defaults)
========================= */
static STORAGE_KEYS = {
  match: 'tetoris_matchcfg_v1'
};

initLocalPersistence() {
  // 1) Settings + keybind persistence are handled by their own modules (settings.js / input.js),
  // but we trigger their DOM wiring here after UI exists.
  if (typeof GameSettings !== 'undefined' && typeof GameSettings.getInstance === 'function') {
    const gs = GameSettings.getInstance();
    if (typeof gs.applyToUI === 'function') gs.applyToUI();
    if (typeof gs.initPersistence === 'function') gs.initPersistence();
  }
  if (typeof InputManager !== 'undefined' && typeof InputManager.getInstance === 'function') {
    const im = InputManager.getInstance();
    if (typeof im.initPersistence === 'function') im.initPersistence();
  }

  // 2) Match defaults persistence (host-side convenience)
  this.loadMatchDefaultsFromStorage();
  this.wireMatchDefaultsAutoSave();
}

loadMatchDefaultsFromStorage() {
  try {
    const raw = localStorage.getItem(GameController.STORAGE_KEYS.match);
    if (!raw) return;

    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return;

    const targetWins = Number.isFinite(Number(data.targetWins)) ? Math.max(0, parseInt(data.targetWins, 10)) : undefined;
    const countdownSeconds = Number.isFinite(Number(data.countdownSeconds))
      ? Math.max(2, Math.min(5, parseInt(data.countdownSeconds, 10)))
      : undefined;

    const cfg = {};
    if (typeof targetWins === 'number') cfg.targetWins = targetWins;
    if (typeof countdownSeconds === 'number') cfg.countdownSeconds = countdownSeconds;

    if (Object.keys(cfg).length > 0) this.applyMatchConfig(cfg, false);
  } catch (err) {
    console.warn('Failed to load match defaults', err);
  }
}

saveMatchDefaultsToStorage() {
  try {
    const cfg = this.readMatchConfigFromUI();
    localStorage.setItem(GameController.STORAGE_KEYS.match, JSON.stringify(cfg));
  } catch (err) {
    console.warn('Failed to save match defaults', err);
  }
}

wireMatchDefaultsAutoSave() {
  const mf = document.getElementById('matchFormat');
  const cd = document.getElementById('countdownSeconds');
  if (mf) mf.addEventListener('change', () => this.saveMatchDefaultsToStorage());
  if (cd) cd.addEventListener('change', () => this.saveMatchDefaultsToStorage());
}


  /* =========================
     Main UI (PvP + Chat)
  ========================= */
  setupUI() {
    // Copy peer ID
    const fallbackCopyText = (text) => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (_) {
        ok = false;
      }
      document.body.removeChild(ta);
      return ok;
    };

    window.copyPeerId = async () => {
      const id = this.peerIdDisplay ? this.peerIdDisplay.textContent : '';
      if (!id) return;

      let copied = false;
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(id);
          copied = true;
        }
      } catch (_) {
        copied = false;
      }

      if (!copied) copied = fallbackCopyText(id);

      if (copied) ChatManager.addMessage('Copied to clipboard!');
      else ChatManager.addMessage('Unable to copy automatically. Select the ID and copy manually.', 'System');
    };

    // Host
    if (this.createBtn) {
      this.createBtn.addEventListener('click', () => {
        if (this.mode !== 'pvp_1v1') return;

        this._cancelJoinConnectLoop();
        this._invalidateRoundFlow();

        this.isHost = true;
        this.phase = 'waiting';
        this.acceptInput = false;

        NetworkManager.getInstance().initialize(this.handleNetworkMessage.bind(this), { useRoomCode: true, roomCodeLength: 6, role: 'host' });
        this.setStatus('Waiting for opponent to join...');
        this.updateNetworkStatus();

        this.setLobbyControlsEnabled(false);

        this.applyMatchConfig(this.readMatchConfigFromUI(), false);
        this.updateScoreboard();
        this.updateNetworkStatus();
      });
    }

    // Join
    if (this.joinBtn) {
      this.joinBtn.addEventListener('click', () => {
        if (this.mode !== 'pvp_1v1') return;

        const opponentId = (this.opponentPeerIdInput ? this.opponentPeerIdInput.value : '').trim();
        const normalizedId = (/^[A-Za-z0-9]{4,12}$/.test(opponentId)) ? opponentId.toUpperCase() : opponentId;
        if (!opponentId) {
          ChatManager.addMessage('Please enter a room code (or Peer ID)');
          return;
        }

        this.isHost = false;
        this.phase = 'waiting';
        this.acceptInput = false;

        this.applyMatchConfig(this.readMatchConfigFromUI(), true);
        this.setLobbyControlsEnabled(false);

        this._cancelJoinConnectLoop();
        this._invalidateRoundFlow();
        const joinToken = this._joinAttemptToken;

        const nm = NetworkManager.getInstance();
        const startJoinAttempt = (attemptNo) => {
          if (joinToken !== this._joinAttemptToken) return;

          nm.initialize(this.handleNetworkMessage.bind(this), { useRoomCode: true, roomCodeLength: 6, role: 'client' });
          this.setStatus(`Preparing local peer... (${attemptNo}/${this.joinPeerOpenRetryBudget})`);
          const startedAt = performance.now();

          const waitForPeerOpen = () => {
            if (joinToken !== this._joinAttemptToken) return;
            if (this.mode !== 'pvp_1v1' || this.phase === 'idle') return;

            if (nm.peer && nm.peer.open) {
              this._clearJoinWaitTimer();
              nm.connect(normalizedId);
              return;
            }

            const elapsedMs = performance.now() - startedAt;
            if (elapsedMs >= this.joinPeerOpenTimeoutMs) {
              if (attemptNo >= this.joinPeerOpenRetryBudget) {
                this.setLobbyControlsEnabled(true);
                this.setMatchConfigLocked(false);
                this.acceptInput = false;
                this.phase = 'waiting';
                this.setStatus('Join failed: local peer setup timed out.');
                ChatManager.addMessage('Join failed: timeout while preparing local connection.', 'System');
                return;
              }
              startJoinAttempt(attemptNo + 1);
              return;
            }

            this._scheduleJoinPeerWait(waitForPeerOpen, this.joinPeerOpenPollMs);
          };

          waitForPeerOpen();
        };

        startJoinAttempt(1);

        this.updateScoreboard();
        this.updateNetworkStatus();
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
            roundId: this.roundId,
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

    const isTypingContext = (target) => {
      if (!target) return false;
      // Contenteditable or inside contenteditable
      if (target.isContentEditable) return true;
      const ce = target.closest ? target.closest('[contenteditable="true"]') : null;
      if (ce) return true;

      const tag = (target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;

      // If the event target is inside an input wrapper (rare but happens with icons inside inputs)
      const insideFormControl = target.closest
        ? target.closest('input, textarea, select')
        : null;
      return !!insideFormControl;
    };

    const tryGlobalShortcut = (code, bindings) => {
      if (this._isMenuVisible() || this._isSettingsVisible()) return false;
      if (bindings && Object.values(bindings).includes(code)) return false;

      if (code === 'KeyR') {
        if (this.mode === 'zen') {
          this.startZen();
          return true;
        }
        const canRematch =
          this.mode === 'pvp_1v1' &&
          (this.phase === 'waiting' || this.phase === 'roundOver' || this.phase === 'matchOver');
        if (canRematch && this.restartBtn && !this.restartBtn.classList.contains('hidden')) {
          this.restartBtn.click();
          return true;
        }
      }

      if (code === 'KeyN' || code === 'Enter') {
        if (this.mode === 'pvp_1v1' && (this.phase === 'roundOver' || this.phase === 'matchOver')) {
          if (this.restartBtn && !this.restartBtn.classList.contains('hidden')) {
            this.restartBtn.click();
            return true;
          }
        }
      }

      return false;
    };


    document.addEventListener('keydown', (e) => {
      if (input.isCapturing()) return;

      // Don't hijack keyboard input when typing in chat / join fields / settings.
      if (isTypingContext(e.target)) return;

      const b = input.getBindings();
      const code = e.code;

      if (tryGlobalShortcut(code, b)) {
        e.preventDefault();
        return;
      }

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
      if (this.gameState1 && code === b.softDrop) this.gameState1.setSoftDropActive(false);
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
      roundId: this.roundId,
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

  showCountdown(seconds, subtitle = 'Get ready...', flowToken = this._roundFlowToken) {
    const overlay = this.countdownOverlay;
    const textEl = document.getElementById('countdownText');
    const subEl = document.getElementById('countdownSub');

    if (!overlay || !textEl || !subEl) return Promise.resolve(false);

    this.hideResultOverlay();

    overlay.classList.remove('hidden');
    subEl.textContent = subtitle;

    this.acceptInput = false;
    this.phase = 'countdown';
    this.updateScoreboard();

    return new Promise((resolve) => {
      let settled = false;
      const isFlowValid = () => (
        flowToken === this._roundFlowToken &&
        this.mode === 'pvp_1v1' &&
        this.phase === 'countdown'
      );
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        overlay.classList.add('hidden');
        resolve(ok);
      };

      let t = Math.max(1, Number(seconds) || 3);
      textEl.textContent = String(t);

      const tick = () => {
        if (!isFlowValid()) {
          finish(false);
          return;
        }

        t -= 1;
        if (t > 0) {
          textEl.textContent = String(t);
          this._setRoundFlowTimeout(tick, 900);
        } else {
          textEl.textContent = 'GO!';
          subEl.textContent = 'Fight!';
          this._setRoundFlowTimeout(() => {
            if (!isFlowValid()) {
              finish(false);
              return;
            }
            finish(true);
          }, 550);
        }
      };

      this._setRoundFlowTimeout(tick, 900);
    });
  }

  /* =========================
     Result / KO overlay
  ========================= */
  hideResultOverlay() {
    window.clearTimeout(this._resultOverlayTimer);
    this._resultOverlayTimer = null;
    if (this.resultOverlay) this.resultOverlay.classList.add('hidden');
  }

  showResultOverlay(title, subtitle = '', { persistent = false, durationMs = 1300 } = {}) {
    if (!this.resultOverlay || !this.resultText || !this.resultSub) return;

    this.resultText.textContent = String(title ?? '');
    this.resultSub.textContent = String(subtitle ?? '');
    this.resultOverlay.classList.remove('hidden');

    if (persistent) return;

    window.clearTimeout(this._resultOverlayTimer);
    this._resultOverlayTimer = window.setTimeout(() => {
      this.hideResultOverlay();
    }, Math.max(200, Number(durationMs) || 1300));
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
    this._cancelJoinConnectLoop();
    const flowToken = this._invalidateRoundFlow();

    this.roundId = roundId || this.roundId || `${Date.now()}-local`;

    this.phase = 'countdown';
    this.acceptInput = false;

    this.hideResultOverlay();
    this.hideRoundStatsPanel();
    this.clearCombatFeed();

    if (this.gameArea) this.gameArea.classList.remove('hidden');
    if (this.restartBtn) this.restartBtn.classList.remove('hidden');

    this.match.round = Math.max(1, Number(roundNumber) || (this.match.round + 1) || 1);
    this.updateScoreboard();

    GameSettings.getInstance().update();

    try {
      this.gameState1 = new GameState('gameCanvas1', 'holdCanvas1', 'queueCanvas1', 1, seed);
      this.gameState2 = new GameState('gameCanvas2', 'holdCanvas2', 'queueCanvas2', 2, seed);
      this.gameState1.setRoundId(this.roundId);
      this.gameState2.setRoundId(this.roundId);
      this.gameState1.setCombatEventHandler((event) => this.handleCombatEvent(1, event));
      this.gameState2.setCombatEventHandler((event) => this.handleCombatEvent(2, event));

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
    } catch (err) {
      console.error('PvP round failed to start:', err);
      this.setStatus(`Round failed to start: ${err?.message || err}`);
      ChatManager.addMessage('Round failed to start. Check console for details.', 'System');
      this.acceptInput = false;
      this.phase = 'waiting';
      this.updateScoreboard();
      return;
    }

    this.sendInitStateSnapshot();

    this.setStatus(`Round ${this.match.round} starting…`);
    ChatManager.addMessage(`Round ${this.match.round} is starting!`, 'System');

    if (!this.gameRunning) {
      this.gameRunning = true;
      this.animationFrameId = requestAnimationFrame(this.gameLoop.bind(this));
    }

    const didCountdown = await this.showCountdown(this.match.countdownSeconds, `Round ${this.match.round}`, flowToken);
    if (!didCountdown) return;
    if (flowToken !== this._roundFlowToken) return;
    if (this.mode !== 'pvp_1v1' || this.phase !== 'countdown') return;

    this.phase = 'playing';
    this.acceptInput = true;
    this.setStatus('Game in progress!');
    this.updateScoreboard();
    this.updateNetworkStatus();
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

  _clampInt(value, min, max, fallback = min) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    const i = Math.trunc(n);
    return Math.max(min, Math.min(max, i));
  }

  _normalizeRoundId(value) {
    if (typeof value !== 'string') return null;
    const cleaned = value.trim();
    if (!cleaned) return null;
    return cleaned.slice(0, 128);
  }

  _isStaleRoundPacket(roundId) {
    return !!(roundId && this.roundId && roundId !== this.roundId);
  }

  _sanitizeIncomingMessage(rawMsg) {
    if (!rawMsg || typeof rawMsg !== 'object') return null;
    const type = (typeof rawMsg.type === 'string') ? rawMsg.type : '';
    if (!type) return null;

    switch (type) {
      case 'chat': {
        const message = (typeof rawMsg.message === 'string') ? rawMsg.message.trim() : '';
        if (!message) return null;
        return { type, message: message.slice(0, 300) };
      }

      case 'attack': {
        const lines = this._clampInt(rawMsg.lines, 0, 10, 0);
        if (lines <= 0) return null;
        return { type, lines, roundId: this._normalizeRoundId(rawMsg.roundId) };
      }

      case 'peerConnected':
      case 'joinedLobby':
      case 'peerDisconnected':
        return { type };

      case 'networkError': {
        const message = (typeof rawMsg.message === 'string') ? rawMsg.message.trim() : '';
        return { type, message: (message || 'unknown').slice(0, 300) };
      }

      case 'netRtt': {
        const rttMs = this._clampInt(rawMsg.rttMs, 1, 5000, 0);
        if (rttMs <= 0) return null;
        return { type, rttMs };
      }

      case 'matchConfig': {
        return {
          type,
          targetWins: this._clampInt(rawMsg.targetWins, 0, 99, 3),
          countdownSeconds: this._clampInt(rawMsg.countdownSeconds, 2, 5, 3),
          roundId: this._normalizeRoundId(rawMsg.roundId),
        };
      }

      case 'scoreUpdate': {
        return {
          type,
          hostScore: this._clampInt(rawMsg.hostScore, 0, 999, 0),
          clientScore: this._clampInt(rawMsg.clientScore, 0, 999, 0),
          round: this._clampInt(rawMsg.round, 0, 999, 0),
          roundId: this._normalizeRoundId(rawMsg.roundId),
        };
      }

      case 'matchReset': {
        return {
          type,
          targetWins: this._clampInt(rawMsg.targetWins, 0, 99, this.match.targetWins),
          countdownSeconds: this._clampInt(rawMsg.countdownSeconds, 2, 5, this.match.countdownSeconds),
          roundId: this._normalizeRoundId(rawMsg.roundId),
        };
      }

      case 'startRound': {
        const roundId = this._normalizeRoundId(rawMsg.roundId);
        if (!roundId) return null;
        return {
          type,
          seed: this._clampInt(rawMsg.seed, 0, 1000000000, Math.floor(Math.random() * 1e9)),
          round: this._clampInt(rawMsg.round, 1, 999, (this.match.round || 0) + 1),
          roundId,
        };
      }

      case 'gameOver': {
        const roundId = this._normalizeRoundId(rawMsg.roundId);
        if (!roundId) return null;
        return { type, roundId };
      }

      case 'matchOver': {
        const roundId = this._normalizeRoundId(rawMsg.roundId);
        if (!roundId) return null;
        if (rawMsg.winner !== 'HOST' && rawMsg.winner !== 'CLIENT') return null;
        return { type, winner: rawMsg.winner, roundId };
      }

      case 'gameState': {
        const roundId = this._normalizeRoundId(rawMsg.roundId);
        if (!roundId) return null;
        if (!rawMsg.state || typeof rawMsg.state !== 'object') return null;
        return {
          type,
          roundId,
          init: rawMsg.init === true,
          state: rawMsg.state,
        };
      }

      default:
        return null;
    }
  }

  /* =========================
     Network handler (PvP)
  ========================= */
  handleNetworkMessage(rawMsg) {
    const msg = this._sanitizeIncomingMessage(rawMsg);
    if (!msg) return;

    if (msg.type === 'chat') {
      ChatManager.addMessage(msg.message, 'Opponent');
      return;
    }

    if (msg.type === 'netRtt') {
      this._setNetworkRtt(msg.rttMs);
      return;
    }

    if (this.mode !== 'pvp_1v1') return;

    switch (msg.type) {
      case 'attack':
        if (this._isStaleRoundPacket(msg.roundId)) break;
        if (this.gameState1) this.gameState1.receiveAttack(msg.lines);
        this.pushCombatText(2, `+${msg.lines}`, 'attack');
        this.triggerScreenShake(2, 'light');
        break;

      case 'peerConnected': {
        this._cancelJoinConnectLoop();
        if (!this.isHost) break;

        const cfg = this.readMatchConfigFromUI();
        this.applyMatchConfig(cfg, false);

        NetworkManager.getInstance().send({
          type: 'matchConfig',
          targetWins: cfg.targetWins,
          countdownSeconds: cfg.countdownSeconds,
          roundId: this.roundId,
        });

        this.resetMatchScores();
        this.hostSetScoresAndBroadcast();

        this.setStatus('Opponent connected! Starting match…');
        this.updateNetworkStatus();
        this.startNextRoundAsHost(true);
        break;
      }

      case 'joinedLobby':
        this._cancelJoinConnectLoop();
        this.setStatus('Connected! Waiting for host…');
        this.updateNetworkStatus();
        break;

      case 'peerDisconnected':
        ChatManager.addMessage('Opponent disconnected. Match stopped.', 'System');
        this.handlePeerDisconnected();
        break;

      case 'networkError':
        this._invalidateRoundFlow();
        this._cancelJoinConnectLoop();
        this.setLobbyControlsEnabled(true);
        this.setMatchConfigLocked(false);
        this.acceptInput = false;
        this.phase = 'waiting';
        this.stateSendIntervalMs = STATE_SEND_INTERVAL;
        this.networkRttMs = null;
        this.hideRoundStatsPanel();
        this.clearCombatFeed();
        this.setStatus(`Network error: ${msg.message || 'unknown'}`);
        this.updateNetworkStatus();
        break;

      case 'matchConfig': {
        if (this._isStaleRoundPacket(msg.roundId)) break;
        const cfg = {
          targetWins: msg.targetWins,
          countdownSeconds: msg.countdownSeconds,
        };
        this.applyMatchConfig(cfg, true);
        this.phase = 'waiting';
        this.updateScoreboard();
        this.setStatus('Match configured. Waiting for round start…');
        this.updateNetworkStatus();
        break;
      }

      case 'scoreUpdate': {
        if (this._isStaleRoundPacket(msg.roundId)) break;
        this.match.hostScore = msg.hostScore;
        this.match.clientScore = msg.clientScore;
        this.match.round = msg.round;
        this.updateScoreboard();
        this.updateNetworkStatus();
        break;
      }

      case 'matchReset': {
        if (this._isStaleRoundPacket(msg.roundId)) break;
        this._invalidateRoundFlow();
        const cfg = {
          targetWins: msg.targetWins,
          countdownSeconds: msg.countdownSeconds,
        };
        this.applyMatchConfig(cfg, !this.isHost);
        this.resetMatchScores();
        this.updateScoreboard();
        this.updateNetworkStatus();

        this.hideResultOverlay();
        this.hideRoundStatsPanel();
        this.clearCombatFeed();

        if (this.isHost) {
          this.hostSetScoresAndBroadcast();
          this.startNextRoundAsHost(true);
        } else {
          this.setStatus('Match reset. Waiting for host…');
        }
        break;
      }

      case 'startRound': {
        if (this.phase === 'playing' || this.phase === 'countdown') break;
        if (msg.round < this.match.round) break;

        this.roundId = msg.roundId;
        this.startRound(msg.seed, msg.round, msg.roundId);
        this.updateNetworkStatus();
        break;
      }

      case 'gameOver': {
        if (this._isStaleRoundPacket(msg.roundId)) break;
        this._invalidateRoundFlow();
        this.acceptInput = false;
        this.phase = 'roundOver';

        ChatManager.addMessage('Opponent topped out! You win the round! 🎉', 'System');
        this.setStatus('Round win!');
        this.showResultOverlay('ROUND WON', 'Opponent topped out!', { durationMs: 1400 });
        this.showRoundStatsPanel('ROUND STATS', { durationMs: 7000 });

        if (this.isHost) {
          this.match.hostScore += 1;
          this.hostSetScoresAndBroadcast();
          this.updateScoreboard();

          if (this.isMatchOver()) {
            const winner = this.getMatchWinnerLabelForLocal();
            NetworkManager.getInstance().send({ type: 'matchOver', winner: 'HOST', roundId: this.roundId });
            this.phase = 'matchOver';
            this.setStatus(`MATCH OVER — ${winner} WINS!`);
            ChatManager.addMessage(`MATCH OVER — ${winner} WINS!`, 'System');
            this.showResultOverlay('MATCH OVER', `${winner} wins!`, { persistent: true });
            this.showRoundStatsPanel('MATCH STATS', { persistent: true });
            this.updateNetworkStatus();
          } else {
            this.setStatus('Next round starting…');
            this._setRoundFlowTimeout(() => this.startNextRoundAsHost(false), 1400);
          }
        } else {
          this.setStatus('Round win! Waiting for next round…');
          this.updateNetworkStatus();
        }
        break;
      }

      case 'matchOver': {
        if (this._isStaleRoundPacket(msg.roundId)) break;
        this._invalidateRoundFlow();
        this.acceptInput = false;
        this.phase = 'matchOver';
        this.updateScoreboard();

        const winner = msg.winner === 'HOST'
          ? (this.isHost ? 'YOU' : 'OPPONENT')
          : (this.isHost ? 'OPPONENT' : 'YOU');

        this.setStatus(`MATCH OVER — ${winner} WINS!`);
        ChatManager.addMessage(`MATCH OVER — ${winner} WINS!`, 'System');
        this.showResultOverlay('MATCH OVER', `${winner} wins!`, { persistent: true });
        this.showRoundStatsPanel('MATCH STATS', { persistent: true });
        this.updateNetworkStatus();
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
      this.showResultOverlay('GAME OVER', `Final score: ${this.zenScore}`, { persistent: true });
      this.showRoundStatsPanel('ZEN STATS', { persistent: true });
      this.updateNetworkStatus();
      return;
    }

    // PvP round loss
    this._invalidateRoundFlow();
    this.phase = 'roundOver';
    this.setStatus('You lost the round.');
    ChatManager.addMessage('You topped out! Round lost.', 'System');

    this.showResultOverlay('ROUND LOST', 'You topped out!', { durationMs: 1400 });
    this.showRoundStatsPanel('ROUND STATS', { durationMs: 7000 });

    NetworkManager.getInstance().send({ type: 'gameOver', roundId: this.roundId });

    if (this.isHost) {
      this.match.clientScore += 1;
      this.hostSetScoresAndBroadcast();
      this.updateScoreboard();

      if (this.isMatchOver()) {
        const winner = this.getMatchWinnerLabelForLocal();
        NetworkManager.getInstance().send({ type: 'matchOver', winner: 'CLIENT', roundId: this.roundId });
        this.phase = 'matchOver';
        this.setStatus(`MATCH OVER — ${winner} WINS!`);
        ChatManager.addMessage(`MATCH OVER — ${winner} WINS!`, 'System');
        this.showResultOverlay('MATCH OVER', `${winner} wins!`, { persistent: true });
        this.showRoundStatsPanel('MATCH STATS', { persistent: true });
        this.updateNetworkStatus();
      } else {
        this.setStatus('Next round starting…');
        this._setRoundFlowTimeout(() => this.startNextRoundAsHost(false), 1400);
      }
    } else {
      this.setStatus('Round lost. Waiting for next round…');
      this.updateNetworkStatus();
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
          if (this.zenPaused) {
            this.lastTime = 0;
            this.gameState1.draw();
          } else {
            if (this.acceptInput) {
              input.processMovement(deltaTime, (dx) => this.gameState1.move(dx));
            }

            const ok = this.gameState1.update(deltaTime);
            if (!ok) {
              this.handleGameOver();
              return;
            }

            this.gameState1.draw();
          }
        } else {
          // PvP: only update during playing
          if (this.phase === 'playing') {
            if (this.acceptInput) {
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
            (timestamp - this.lastStateSendTime) > this.stateSendIntervalMs
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


