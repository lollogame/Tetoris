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
    this.mode = 'zen'; // 'zen' | 'pvp_1v1' | 'battle_royale' | 'bot_practice'
    this.zenScore = 0;
    this.botController = null;
    this.botSummary = { wins: 0, losses: 0 };

    // Battle Royale runtime
    this.br = this._createBattleRoyaleState();

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
    this.startBrBtn = document.getElementById('startBrBtn');
    this.restartBtn = document.getElementById('restartBtn');
    this.opponentPeerIdInput = document.getElementById('opponentPeerId');

    this.peerBox = document.getElementById('myPeerId');
    this.peerIdDisplay = document.getElementById('peerIdDisplay');

    this.gameArea = document.getElementById('gameArea');
    this.gameStatus = document.getElementById('gameStatus');
    this.networkStatus = document.getElementById('networkStatus');

    this.scoreboard = document.getElementById('scoreboard');
    this.brLobbyPanel = document.getElementById('brLobbyPanel');
    this.brLobbyRoom = document.getElementById('brLobbyRoom');
    this.brLobbyPlayers = document.getElementById('brLobbyPlayers');
    this.brLobbyAlive = document.getElementById('brLobbyAlive');
    this.brLobbyList = document.getElementById('brLobbyList');

    // Countdown overlay
    this.countdownOverlay = document.getElementById('countdownOverlay');

    // Result / KO overlay
    this.resultOverlay = document.getElementById('resultOverlay');
    this.resultText = document.getElementById('resultText');
    this.resultSub = document.getElementById('resultSub');
    this.resultCloseBtn = document.getElementById('resultCloseBtn');
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

  _createBattleRoyaleState() {
    return {
      active: false,
      role: null,          // 'host' | 'client'
      peer: null,
      hostConn: null,      // client -> host
      hostConns: new Map(),// host -> clients
      roomCode: '',
      localId: '',
      hostId: '',
      maxPlayers: 4,
      started: false,
      roundSeed: 0,
      roundId: null,
      roundStartMs: 0,
      players: new Map(),  // id -> { id, alive, attackMode, attacksSent, lastAttackerId }
      remoteStates: new Map(),
      focusId: null,
      stateSendIntervalMs: 70,
    };
  }

  _closeConnSafe(conn) {
    if (!conn) return;
    try { conn.close(); } catch (_) {}
  }

  _closePeerSafe(peer) {
    if (!peer) return;
    try {
      if (!peer.destroyed) peer.destroy();
    } catch (_) {}
  }

  stopBattleRoyaleNetwork() {
    if (!this.br) this.br = this._createBattleRoyaleState();

    this._closeConnSafe(this.br.hostConn);
    this.br.hostConn = null;
    for (const conn of this.br.hostConns.values()) this._closeConnSafe(conn);
    this.br.hostConns.clear();

    this._closePeerSafe(this.br.peer);
    this.br.peer = null;

    this.br.active = false;
    this.br.role = null;
    this.br.roomCode = '';
    this.br.localId = '';
    this.br.hostId = '';
    this.br.started = false;
    this.br.roundSeed = 0;
    this.br.roundId = null;
    this.br.roundStartMs = 0;
    this.br.players.clear();
    this.br.remoteStates.clear();
    this.br.focusId = null;

    this._setPeerIdDisplay('');
    this.updateBrLobbyPanel();
  }

  readBattleRoyaleConfigFromUI() {
    const maxEl = document.getElementById('brMaxPlayers');
    const modeEl = document.getElementById('brAttackMode');
    const maxPlayers = this._clampInt(maxEl ? maxEl.value : 4, 3, 8, 4);
    const modeRaw = modeEl ? String(modeEl.value || '').trim() : 'random';
    const attackMode = ['random', 'highest_apm', 'retaliate'].includes(modeRaw) ? modeRaw : 'random';
    return { maxPlayers, attackMode };
  }

  readBotConfigFromSettings() {
    const s = GameSettings.getInstance();
    const toNum = (value, fallback) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    return {
      pps: toNum(s.botPps, 1.6),
      aggression: toNum(s.botAggression, 65),
      mistakeChance: toNum(s.botMistakeChance, 8),
      thinkJitterMs: toNum(s.botThinkJitterMs, 85),
    };
  }

  updateBrLobbyPanel() {
    if (!this.brLobbyPanel) return;

    if (this.mode !== 'battle_royale') {
      this.brLobbyPanel.classList.add('hidden');
      return;
    }

    const players = Array.from(this.br.players.values());
    const maxPlayers = this.br.maxPlayers || 4;
    const alive = players.filter((p) => p.alive).length;
    const roomText = this.br.roomCode || '-';

    if (this.brLobbyRoom) this.brLobbyRoom.innerHTML = `Room: <strong>${roomText}</strong>`;
    if (this.brLobbyPlayers) this.brLobbyPlayers.innerHTML = `Players: <strong>${players.length}/${maxPlayers}</strong>`;
    if (this.brLobbyAlive) {
      const aliveText = this.br.started ? `${alive}/${players.length}` : '-';
      this.brLobbyAlive.innerHTML = `Alive: <strong>${aliveText}</strong>`;
    }

    if (this.brLobbyList) {
      if (players.length === 0) {
        this.brLobbyList.textContent = '-';
      } else {
        const list = players.map((p) => {
          const self = (p.id === this.br.localId) ? ' (you)' : '';
          const state = p.alive ? 'alive' : 'out';
          return `${p.id}${self} [${state}]`;
        });
        this.brLobbyList.textContent = list.join(' | ');
      }
    }

    this.brLobbyPanel.classList.remove('hidden');
  }

  /* =========================
     Small UI helpers
  ========================= */
  setLobbyControlsEnabled(enabled) {
    const on = !!enabled;
    if (this.createBtn) this.createBtn.disabled = !on;
    if (this.joinBtn) this.joinBtn.disabled = !on;
    if (this.opponentPeerIdInput) this.opponentPeerIdInput.disabled = !on;
    if (this.startBrBtn && this.mode !== 'battle_royale') this.startBrBtn.classList.add('hidden');
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

    if (this.mode !== 'pvp_1v1' && this.mode !== 'battle_royale') {
      this.networkStatus.classList.add('hidden');
      this.networkStatus.textContent = '';
      return;
    }

    if (this.mode === 'battle_royale') {
      const hostConnected = !!(this.br.role === 'host' && this.br.peer && this.br.peer.open);
      const clientConnected = !!(this.br.role === 'client' && this.br.hostConn && this.br.hostConn.open);
      const connected = hostConnected || clientConnected;
      const waiting = (this.phase === 'waiting' || this.phase === 'countdown' || this.phase === 'playing' || this.phase === 'roundOver');

      if (!connected) {
        if (!waiting) {
          this.networkStatus.classList.add('hidden');
          this.networkStatus.textContent = '';
          return;
        }
        this.networkStatus.classList.remove('hidden');
        this.networkStatus.textContent = 'Network: waiting for BR lobby connection...';
        return;
      }

      const syncText = `${this.br.stateSendIntervalMs}ms`;
      this.networkStatus.classList.remove('hidden');
      this.networkStatus.textContent = `Network: BR connected | Sync ${syncText}`;
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
    if (this.mode === 'bot_practice') {
      return this.phase === 'playing' || this.phase === 'roundOver';
    }

    if (this.mode === 'battle_royale') {
      const hostConnected = !!(this.br.role === 'host' && this.br.peer && this.br.peer.open);
      const clientConnected = !!(this.br.role === 'client' && this.br.hostConn && this.br.hostConn.open);
      if (hostConnected || clientConnected) return true;
      return this.phase === 'countdown' || this.phase === 'playing' || this.phase === 'roundOver' || this.phase === 'matchOver';
    }

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
      return { pps: 0, apm: 0, vs: 0, finesse: 0 };
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
      finesse: Math.max(0, Number(gameState.finesseErrors) || 0),
    };
  }

  showRoundStatsPanel(title = 'ROUND STATS', { persistent = false, durationMs = 6500 } = {}) {
    if (!this.roundStatsPanel) return;

    const localStats = this._readRoundStats(this.gameState1);
    const showOppStats = (this.mode === 'pvp_1v1' || this.mode === 'bot_practice' || this.mode === 'battle_royale');
    const oppStats = showOppStats ? this._readRoundStats(this.gameState2) : null;

    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };

    if (this.roundStatsTitle) this.roundStatsTitle.textContent = String(title);

    setText('rsYouPps', localStats.pps.toFixed(2));
    setText('rsYouApm', localStats.apm.toFixed(2));
    setText('rsYouVs', localStats.vs.toFixed(2));
    setText('rsYouFinesse', String(localStats.finesse));

    setText('rsOppPps', oppStats ? oppStats.pps.toFixed(2) : '--');
    setText('rsOppApm', oppStats ? oppStats.apm.toFixed(2) : '--');
    setText('rsOppVs', oppStats ? oppStats.vs.toFixed(2) : '--');
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
    const leavingCurrentMode = (this.mode !== mode);
    const wasConfirmMode =
      this.mode === 'pvp_1v1' ||
      this.mode === 'battle_royale' ||
      this.mode === 'bot_practice';
    if (leavingCurrentMode && wasConfirmMode && this.shouldConfirmLeaveMatch()) {
      const label = this.mode === 'pvp_1v1'
        ? '1v1 match'
        : (this.mode === 'battle_royale' ? 'Battle Royale session' : 'bot practice run');
      const ok = window.confirm(`Leave the current ${label}? Current progress will be lost.`);
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

    // Connection panel + peer id in online modes
    const onlineMode = (this.mode === 'pvp_1v1' || this.mode === 'battle_royale');
    if (this.connPanel) {
      this.connPanel.classList.toggle('hidden', !onlineMode);
    }

    if (this.peerBox) {
      this.peerBox.classList.toggle('hidden', !onlineMode);
    }

    if (this.startBrBtn) {
      const showStart = this.mode === 'battle_royale' && this.br.role === 'host' && !this.br.started;
      this.startBrBtn.classList.toggle('hidden', !showStart);
    }

    // Scoreboard only PvP
    this.updateScoreboard();
    if (this.mode !== 'pvp_1v1') this.hideRoundStatsPanel();
    this.updateBrLobbyPanel();

    // Set status message
    if (this.mode === 'zen') {
      this.setStatus('Zen mode: press Play in the Menu to start.');
    } else if (this.mode === 'pvp_1v1') {
      this.setStatus('1v1 mode: host or join, then play the match.');
    } else if (this.mode === 'battle_royale') {
      this.setStatus('Battle Royale: create or join a room, then wait for host start.');
    } else if (this.mode === 'bot_practice') {
      this.setStatus('Bot practice: press Play to start a training run.');
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
    this.stopBattleRoyaleNetwork();
    this.botController = null;
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
    } else if (this.mode === 'battle_royale') {
      this.phase = 'waiting';
      this.acceptInput = false;
      this.br = this._createBattleRoyaleState();
      this.updateBrLobbyPanel();
      this.applyModeUI();
      this.setStatus('Battle Royale: Create room or Join room. Host starts when ready.');
    } else if (this.mode === 'bot_practice') {
      this.startBotPractice();
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
    const seed = Math.floor(Math.random() * 1e9);

    if (this.gameArea) this.gameArea.classList.remove('hidden');

    try {
      this.gameState1 = new GameState('gameCanvas1', 'holdCanvas1', 'queueCanvas1', 1, seed);
      this.gameState1.setRoundId(null);
      this.gameState1.setCombatEventHandler((event) => this.handleCombatEvent(1, event));
      this.gameState1.setAttackHandler((attack) => {
        const safe = Math.max(0, Number(attack) || 0);
        this.zenScore += safe * 100;
        this.setStatus(`Zen mode - Score: ${this.zenScore}`);
      });

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

    this.setStatus(`Zen mode - Score: ${this.zenScore}`);
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

    const closeResultUI = (event) => {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      this.dismissResultUI();
    };

    if (this.resultCloseBtn) {
      this.resultCloseBtn.addEventListener('click', closeResultUI);
      this.resultCloseBtn.addEventListener('pointerup', closeResultUI);
      this.resultCloseBtn.addEventListener('touchend', closeResultUI, { passive: false });
    }
    if (this.resultOverlay) {
      this.resultOverlay.addEventListener('click', (e) => {
        if (e.target === this.resultOverlay) this.dismissResultUI();
      });
    }

    if (typeof window !== 'undefined') {
      window.closeResultOverlay = () => this.dismissResultUI();
    }

    // Host
    if (this.createBtn) {
      this.createBtn.addEventListener('click', () => {
        if (this.mode === 'battle_royale') {
          this.startBattleRoyaleHost();
          return;
        }

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
        if (this.mode === 'battle_royale') {
          const roomCode = (this.opponentPeerIdInput ? this.opponentPeerIdInput.value : '').trim();
          if (!roomCode) {
            ChatManager.addMessage('Please enter a room code');
            return;
          }
          this.joinBattleRoyaleRoom(roomCode);
          return;
        }

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

    if (this.startBrBtn) {
      this.startBrBtn.addEventListener('click', () => {
        if (this.mode !== 'battle_royale') return;
        this.startBattleRoyaleMatchAsHost();
      });
    }

    // Restart
    if (this.restartBtn) {
      this.restartBtn.addEventListener('click', () => {
        if (this.mode === 'bot_practice') {
          this.startBotPractice();
          return;
        }

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
        } else if (this.mode === 'battle_royale') {
          this.sendBattleRoyaleChat(msg);
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

  _buildPeerOptions() {
    return {
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      },
    };
  }

  _normalizeBrAttackMode(value) {
    const raw = String(value || '').trim();
    if (raw === 'highest_apm' || raw === 'retaliate' || raw === 'random') return raw;
    return 'random';
  }

  _sanitizeBrMessageText(value) {
    const text = (typeof value === 'string') ? value.trim() : '';
    if (!text) return '';
    return text.slice(0, 300);
  }

  _setPeerIdDisplay(peerId) {
    if (this.peerIdDisplay) this.peerIdDisplay.textContent = peerId || '';
    if (this.peerBox) this.peerBox.classList.toggle('hidden', !peerId);
  }

  _makeBrPlayer(id, attackMode = 'random') {
    return {
      id: String(id || ''),
      alive: true,
      attackMode: this._normalizeBrAttackMode(attackMode),
      attacksSent: 0,
      apm: 0,
      pps: 0,
      lastAttackerId: null,
    };
  }

  _serializeBrPlayers() {
    const out = [];
    for (const p of this.br.players.values()) {
      out.push({
        id: p.id,
        alive: !!p.alive,
        attackMode: this._normalizeBrAttackMode(p.attackMode),
        attacksSent: Math.max(0, Number(p.attacksSent) || 0),
        apm: Math.max(0, Number(p.apm) || 0),
        pps: Math.max(0, Number(p.pps) || 0),
        lastAttackerId: (typeof p.lastAttackerId === 'string' && p.lastAttackerId) ? p.lastAttackerId : null,
      });
    }
    return out;
  }

  _applyBrPlayersSnapshot(players) {
    if (!Array.isArray(players)) return;
    const nextPlayers = new Map();
    for (const raw of players) {
      if (!raw || typeof raw !== 'object') continue;
      const id = (typeof raw.id === 'string') ? raw.id.trim() : '';
      if (!id) continue;
      const p = this._makeBrPlayer(id, raw.attackMode);
      p.alive = raw.alive !== false;
      p.attacksSent = Math.max(0, Number(raw.attacksSent) || 0);
      p.apm = Math.max(0, Number(raw.apm) || 0);
      p.pps = Math.max(0, Number(raw.pps) || 0);
      p.lastAttackerId = (typeof raw.lastAttackerId === 'string' && raw.lastAttackerId) ? raw.lastAttackerId : null;
      nextPlayers.set(id, p);
    }
    this.br.players = nextPlayers;
  }

  _pickBrFocus(preferredId = null) {
    const remoteIds = Array.from(this.br.players.keys()).filter((id) => id !== this.br.localId);
    if (remoteIds.length === 0) {
      this.br.focusId = null;
      return null;
    }

    if (preferredId && remoteIds.includes(preferredId)) {
      this.br.focusId = preferredId;
      return preferredId;
    }

    if (this.br.focusId && remoteIds.includes(this.br.focusId)) {
      return this.br.focusId;
    }

    const aliveRemote = remoteIds.find((id) => !!this.br.players.get(id)?.alive);
    this.br.focusId = aliveRemote || remoteIds[0];
    return this.br.focusId;
  }

  _refreshBrFocusBoard(preferredId = null) {
    if (this.mode !== 'battle_royale' || !this.gameState2) return;
    const focusId = this._pickBrFocus(preferredId);
    if (!focusId) return;
    const state = this.br.remoteStates.get(focusId);
    if (!state) return;
    this.gameState2.setState(state);
  }

  _brBroadcast(message, exceptPlayerId = null) {
    if (this.br.role !== 'host') return;
    for (const [playerId, conn] of this.br.hostConns.entries()) {
      if (!conn || !conn.open) continue;
      if (exceptPlayerId && playerId === exceptPlayerId) continue;
      try { conn.send(message); } catch (_) {}
    }
  }

  _brBroadcastLobby() {
    if (this.br.role !== 'host') return;
    const payload = {
      type: 'brLobby',
      roomCode: this.br.roomCode,
      maxPlayers: this.br.maxPlayers,
      started: !!this.br.started,
      roundId: this.br.roundId,
      players: this._serializeBrPlayers(),
    };
    this._brBroadcast(payload);
    this.updateBrLobbyPanel();
    if (this.startBrBtn) {
      const showStart = this.mode === 'battle_royale' && this.br.role === 'host' && !this.br.started;
      this.startBrBtn.classList.toggle('hidden', !showStart);
    }
    this.updateNetworkStatus();
  }

  _updateBrPerfFromState(playerId, state) {
    if (!state || typeof state !== 'object') return;
    const player = this.br.players.get(playerId);
    if (!player) return;
    const startMs = Number(this.br.roundStartMs) || Date.now();
    const elapsedSec = Math.max(0.001, (Date.now() - startMs) / 1000);
    const attacksSent = Math.max(0, Number(state.attacksSent) || 0);
    const piecesPlaced = Math.max(0, Number(state.piecesPlaced) || 0);
    player.attacksSent = attacksSent;
    player.apm = (attacksSent * 60) / elapsedSec;
    player.pps = piecesPlaced / elapsedSec;
  }

  _pickBrAttackTarget(attackerId) {
    const attacker = this.br.players.get(attackerId);
    if (!attacker) return null;

    const candidates = Array.from(this.br.players.values()).filter((p) => p.alive && p.id !== attackerId);
    if (candidates.length === 0) return null;

    const mode = this._normalizeBrAttackMode(attacker.attackMode);
    if (mode === 'retaliate' && attacker.lastAttackerId) {
      const retaliateTarget = candidates.find((p) => p.id === attacker.lastAttackerId);
      if (retaliateTarget) return retaliateTarget.id;
    }

    if (mode === 'highest_apm') {
      let best = candidates[0];
      for (const c of candidates) {
        if ((Number(c.apm) || 0) > (Number(best.apm) || 0)) best = c;
      }
      return best.id;
    }

    return candidates[Math.floor(Math.random() * candidates.length)].id;
  }

  _routeBrAttack(attackerId, lines) {
    if (this.br.role !== 'host') return;
    if (!this.br.started || !this.br.roundId) return;

    const safeLines = this._clampInt(lines, 0, 10, 0);
    if (safeLines <= 0) return;

    const attacker = this.br.players.get(attackerId);
    if (!attacker || !attacker.alive) return;

    const targetId = this._pickBrAttackTarget(attackerId);
    if (!targetId) return;

    attacker.attacksSent = Math.max(0, Number(attacker.attacksSent) || 0) + safeLines;

    const target = this.br.players.get(targetId);
    if (!target || !target.alive) return;
    target.lastAttackerId = attackerId;

    if (targetId === this.br.localId) {
      if (this.gameState1 && (this.phase === 'playing' || this.phase === 'roundOver')) {
        this.gameState1.receiveAttack(safeLines);
      }
      return;
    }

    const conn = this.br.hostConns.get(targetId);
    if (!conn || !conn.open) return;

    try {
      conn.send({
        type: 'brAttackIncoming',
        fromId: attackerId,
        lines: safeLines,
        roundId: this.br.roundId,
      });
    } catch (_) {}
  }

  _markBrPlayerEliminated(playerId) {
    const player = this.br.players.get(playerId);
    if (!player || !player.alive) return;

    player.alive = false;
    if (playerId === this.br.localId) {
      this.acceptInput = false;
      if (this.phase === 'playing') this.phase = 'roundOver';
    }

    this.br.remoteStates.delete(playerId);
    if (this.br.focusId === playerId) this._pickBrFocus();
    this.updateBrLobbyPanel();
    this._refreshBrFocusBoard();

    if (this.br.role === 'host') {
      this._brBroadcastLobby();
      this._checkBrWinCondition();
    }
  }

  _checkBrWinCondition() {
    if (this.br.role !== 'host' || !this.br.started) return;
    const alivePlayers = Array.from(this.br.players.values()).filter((p) => p.alive);
    if (alivePlayers.length > 1) return;
    const winnerId = alivePlayers[0] ? alivePlayers[0].id : null;
    this._finishBrMatch(winnerId, this.br.roundId);
  }

  _finishBrMatch(winnerId, roundId) {
    if (this.mode !== 'battle_royale') return;
    if (roundId && this.br.roundId && roundId !== this.br.roundId) return;

    this._invalidateRoundFlow();
    this.stopLoop();
    this.br.started = false;
    this.acceptInput = false;
    this.phase = 'matchOver';

    const localWon = !!(winnerId && winnerId === this.br.localId);
    const title = localWon ? 'VICTORY' : 'MATCH OVER';
    const subtitle = winnerId
      ? (localWon ? 'You won the Battle Royale.' : `${winnerId} won the Battle Royale.`)
      : 'No winner.';

    this.setStatus(localWon ? 'Battle Royale complete: you won.' : 'Battle Royale complete.');
    this.showResultOverlay(title, subtitle, { persistent: true });
    this.showRoundStatsPanel('BATTLE ROYALE STATS', { persistent: true });

    if (this.br.role === 'host') {
      this._brBroadcast({
        type: 'brMatchOver',
        winnerId: winnerId || null,
        roundId: this.br.roundId,
      });
      this._brBroadcastLobby();
    } else {
      this.updateBrLobbyPanel();
      this.updateNetworkStatus();
    }
  }

  async startBattleRoyaleRound(seed, roundId, startedAt = Date.now()) {
    if (this.mode !== 'battle_royale') return;
    const flowToken = this._invalidateRoundFlow();

    this.br.started = true;
    this.br.roundSeed = this._clampInt(seed, 0, 1000000000, Math.floor(Math.random() * 1e9));
    this.br.roundId = roundId || `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    this.br.roundStartMs = Math.max(0, Number(startedAt) || Date.now());
    this.roundId = this.br.roundId;

    this.phase = 'countdown';
    this.acceptInput = false;
    this.hideResultOverlay();
    this.hideRoundStatsPanel();
    this.clearCombatFeed();

    if (this.gameArea) this.gameArea.classList.remove('hidden');
    if (this.restartBtn) this.restartBtn.classList.add('hidden');

    GameSettings.getInstance().update();

    try {
      this.gameState1 = new GameState('gameCanvas1', 'holdCanvas1', 'queueCanvas1', 1, this.br.roundSeed);
      this.gameState2 = new GameState('gameCanvas2', 'holdCanvas2', 'queueCanvas2', 2, this.br.roundSeed);
      this.gameState1.setRoundId(this.br.roundId);
      this.gameState2.setRoundId(this.br.roundId);
      this.gameState1.setCombatEventHandler((event) => this.handleCombatEvent(1, event));
      this.gameState2.setCombatEventHandler((event) => this.handleCombatEvent(2, event));

      this.gameState1.setAttackHandler((attack, emittedRoundId) => {
        const safe = Math.max(0, Math.min(10, Number(attack) || 0));
        if (safe <= 0) return;
        if (this.br.role === 'host') {
          this._routeBrAttack(this.br.localId, safe);
        } else if (this.br.hostConn && this.br.hostConn.open) {
          try {
            this.br.hostConn.send({
              type: 'brAttack',
              lines: safe,
              roundId: emittedRoundId || this.br.roundId,
            });
          } catch (_) {}
        }
      });

      this.gameState1.setGameStartTime(this.br.roundStartMs);
      this.gameState2.setGameStartTime(this.br.roundStartMs);

      InputManager.getInstance().reset();

      const okLocal = this.gameState1.spawnPiece();
      this.gameState2.spawnPiece();
      if (!okLocal) {
        this.handleGameOver();
        return;
      }

      this.lastTime = 0;
      this.lastStateSendTime = 0;
      this.gameState1.draw();
      this.gameState2.draw();
    } catch (err) {
      console.error('BR round failed to start:', err);
      this.setStatus(`BR round failed to start: ${err?.message || err}`);
      this.phase = 'waiting';
      this.acceptInput = false;
      return;
    }

    this._pickBrFocus();
    this._refreshBrFocusBoard();

    if (!this.gameRunning) {
      this.gameRunning = true;
      this.animationFrameId = requestAnimationFrame(this.gameLoop.bind(this));
    }

    const didCountdown = await this.showCountdown(3, 'Battle Royale', flowToken);
    if (!didCountdown) return;
    if (flowToken !== this._roundFlowToken) return;
    if (this.mode !== 'battle_royale' || this.phase !== 'countdown') return;

    this.phase = 'playing';
    const localPlayer = this.br.players.get(this.br.localId);
    this.acceptInput = !!(localPlayer ? localPlayer.alive : true);
    this.setStatus(this.acceptInput ? 'Battle Royale in progress.' : 'You are out. Spectating.');
    this.updateBrLobbyPanel();
    this.updateNetworkStatus();
  }

  startBattleRoyaleMatchAsHost() {
    if (this.mode !== 'battle_royale') return;
    if (this.br.role !== 'host') return;
    if (!this.br.peer || !this.br.peer.open) {
      this.setStatus('Cannot start BR: host peer is not ready.');
      return;
    }
    if (this.br.started) return;

    const cfg = this.readBattleRoyaleConfigFromUI();
    this.br.maxPlayers = cfg.maxPlayers;

    const playersCount = this.br.players.size;
    if (playersCount < 2) {
      this.setStatus('Need at least 2 players to start Battle Royale.');
      return;
    }

    const localPlayer = this.br.players.get(this.br.localId) || this._makeBrPlayer(this.br.localId, cfg.attackMode);
    localPlayer.attackMode = this._normalizeBrAttackMode(cfg.attackMode);
    this.br.players.set(this.br.localId, localPlayer);

    for (const p of this.br.players.values()) {
      p.alive = true;
      p.attacksSent = 0;
      p.apm = 0;
      p.pps = 0;
      p.lastAttackerId = null;
    }

    this.br.remoteStates.clear();
    const seed = Math.floor(Math.random() * 1e9);
    const roundId = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    const startedAt = Date.now();
    this.br.started = true;
    this.br.roundSeed = seed;
    this.br.roundId = roundId;
    this.br.roundStartMs = startedAt;

    this._brBroadcast({
      type: 'brStart',
      seed,
      roundId,
      startedAt,
    });
    this._brBroadcastLobby();
    this.startBattleRoyaleRound(seed, roundId, startedAt);
  }

  startBattleRoyaleHost() {
    if (this.mode !== 'battle_royale') return;

    this.stopBattleRoyaleNetwork();
    this._invalidateRoundFlow();
    this._cancelJoinConnectLoop();

    const cfg = this.readBattleRoyaleConfigFromUI();
    this.br = this._createBattleRoyaleState();
    this.br.active = true;
    this.br.role = 'host';
    this.br.maxPlayers = cfg.maxPlayers;

    this.phase = 'waiting';
    this.acceptInput = false;
    this.setLobbyControlsEnabled(false);

    const roomCode = NetworkManager.getInstance().generateRoomCode(6);
    const peer = new Peer(roomCode, this._buildPeerOptions());
    this.br.peer = peer;

    this.setStatus('Creating Battle Royale room...');
    this.updateNetworkStatus();

    peer.on('open', (id) => {
      this.br.localId = id;
      this.br.hostId = id;
      this.br.roomCode = id;
      this._setPeerIdDisplay(id);

      const localPlayer = this._makeBrPlayer(id, cfg.attackMode);
      this.br.players.set(id, localPlayer);
      this.updateBrLobbyPanel();
      this.applyModeUI();

      ChatManager.addMessage(`BR room code ready: ${id}`, 'System');
      ChatManager.addMessage('Share the room code with players.', 'System');
      this.setStatus('BR room ready. Waiting for players...');
      this.updateNetworkStatus();
    });

    peer.on('connection', (conn) => this._attachBrHostConnection(conn));

    peer.on('error', (err) => {
      console.error('BR host peer error:', err);
      this.setStatus(`BR host error: ${err?.message || err?.type || 'unknown'}`);
      ChatManager.addMessage(`BR host error: ${err?.message || err?.type || 'unknown'}`, 'System');
      this.stopBattleRoyaleNetwork();
      this.setLobbyControlsEnabled(true);
      this.updateNetworkStatus();
    });
  }

  _attachBrHostConnection(conn) {
    if (!conn) return;
    const peerId = String(conn.peer || '').trim();

    conn.on('data', (msg) => this._handleBrHostMessage(conn, msg));
    conn.on('close', () => this._handleBrClientDisconnected(peerId));
    conn.on('error', (err) => {
      console.error('BR client connection error:', err);
      this._handleBrClientDisconnected(peerId);
    });
  }

  _handleBrHostMessage(conn, rawMsg) {
    if (this.mode !== 'battle_royale' || this.br.role !== 'host') return;
    if (!rawMsg || typeof rawMsg !== 'object') return;

    const type = (typeof rawMsg.type === 'string') ? rawMsg.type : '';
    const peerId = String(conn?.peer || '').trim();
    if (!peerId) return;

    switch (type) {
      case 'brJoin': {
        if (this.br.started) {
          try { conn.send({ type: 'brJoinDenied', reason: 'match_started' }); } catch (_) {}
          this._closeConnSafe(conn);
          return;
        }
        if (this.br.players.size >= this.br.maxPlayers) {
          try { conn.send({ type: 'brJoinDenied', reason: 'lobby_full' }); } catch (_) {}
          this._closeConnSafe(conn);
          return;
        }

        const attackMode = this._normalizeBrAttackMode(rawMsg.attackMode);
        this.br.hostConns.set(peerId, conn);
        this.br.players.set(peerId, this._makeBrPlayer(peerId, attackMode));

        try {
          conn.send({
            type: 'brWelcome',
            hostId: this.br.hostId,
            localId: peerId,
            roomCode: this.br.roomCode,
            maxPlayers: this.br.maxPlayers,
            started: this.br.started,
            roundId: this.br.roundId,
            players: this._serializeBrPlayers(),
          });
        } catch (_) {}

        ChatManager.addMessage(`${peerId} joined BR lobby`, 'System');
        this._brBroadcastLobby();
        this.updateNetworkStatus();
        break;
      }

      case 'brChat': {
        const message = this._sanitizeBrMessageText(rawMsg.message);
        if (!message) break;
        ChatManager.addMessage(message, peerId);
        this._brBroadcast({ type: 'brChat', fromId: peerId, message }, peerId);
        break;
      }

      case 'brState': {
        if (!this.br.started || !this.br.roundId) break;
        const msgRoundId = (typeof rawMsg.roundId === 'string') ? rawMsg.roundId : '';
        if (msgRoundId !== this.br.roundId) break;
        if (!rawMsg.state || typeof rawMsg.state !== 'object') break;

        this.br.remoteStates.set(peerId, rawMsg.state);
        this._updateBrPerfFromState(peerId, rawMsg.state);
        this._refreshBrFocusBoard();

        this._brBroadcast({
          type: 'brState',
          playerId: peerId,
          roundId: this.br.roundId,
          state: rawMsg.state,
        }, peerId);
        break;
      }

      case 'brAttack': {
        if (!this.br.started || !this.br.roundId) break;
        const msgRoundId = (typeof rawMsg.roundId === 'string') ? rawMsg.roundId : '';
        if (msgRoundId !== this.br.roundId) break;
        this._routeBrAttack(peerId, rawMsg.lines);
        break;
      }

      case 'brEliminated': {
        if (!this.br.started || !this.br.roundId) break;
        const msgRoundId = (typeof rawMsg.roundId === 'string') ? rawMsg.roundId : '';
        if (msgRoundId !== this.br.roundId) break;
        this._markBrPlayerEliminated(peerId);
        break;
      }

      default:
        break;
    }
  }

  _handleBrClientDisconnected(playerId) {
    if (!playerId || this.br.role !== 'host') return;

    this.br.hostConns.delete(playerId);
    const removed = this.br.players.delete(playerId);
    this.br.remoteStates.delete(playerId);
    if (this.br.focusId === playerId) this._pickBrFocus();

    if (removed) {
      ChatManager.addMessage(`${playerId} left BR lobby`, 'System');
      this._brBroadcastLobby();
      if (this.br.started) this._checkBrWinCondition();
    }

    this.updateBrLobbyPanel();
    this._refreshBrFocusBoard();
    this.updateNetworkStatus();
  }

  joinBattleRoyaleRoom(roomCodeRaw) {
    if (this.mode !== 'battle_royale') return;

    const roomCode = String(roomCodeRaw || '').trim().toUpperCase();
    if (!roomCode) {
      this.setStatus('Please enter a BR room code.');
      return;
    }

    this.stopBattleRoyaleNetwork();
    this._invalidateRoundFlow();
    this._cancelJoinConnectLoop();

    this.br = this._createBattleRoyaleState();
    this.br.active = true;
    this.br.role = 'client';
    this.br.hostId = roomCode;
    this.br.roomCode = roomCode;
    this.phase = 'waiting';
    this.acceptInput = false;
    this.setLobbyControlsEnabled(false);

    const peer = new Peer(this._buildPeerOptions());
    this.br.peer = peer;
    this.setStatus('Connecting to BR room...');
    this.updateBrLobbyPanel();
    this.updateNetworkStatus();

    peer.on('open', (id) => {
      this.br.localId = id;
      this._setPeerIdDisplay(id);

      const conn = peer.connect(roomCode);
      this.br.hostConn = conn;
      this._attachBrClientConnection(conn);
    });

    peer.on('error', (err) => {
      console.error('BR join peer error:', err);
      this.setStatus(`BR join error: ${err?.message || err?.type || 'unknown'}`);
      ChatManager.addMessage(`BR join error: ${err?.message || err?.type || 'unknown'}`, 'System');
      this.stopBattleRoyaleNetwork();
      this.setLobbyControlsEnabled(true);
      this.updateNetworkStatus();
    });
  }

  _attachBrClientConnection(conn) {
    if (!conn) return;

    conn.on('open', () => {
      const cfg = this.readBattleRoyaleConfigFromUI();
      try {
        conn.send({
          type: 'brJoin',
          attackMode: this._normalizeBrAttackMode(cfg.attackMode),
        });
      } catch (_) {}
      this.setStatus('Connected to BR host. Waiting for lobby sync...');
      this.updateNetworkStatus();
    });

    conn.on('data', (msg) => this._handleBrClientMessage(msg));

    conn.on('close', () => {
      ChatManager.addMessage('Host disconnected. BR lobby closed.', 'System');
      this.setStatus('Host disconnected. BR session closed.');
      this.acceptInput = false;
      this.phase = 'waiting';
      this.stopLoop();
      this.stopBattleRoyaleNetwork();
      this.setLobbyControlsEnabled(true);
      if (this.gameArea) this.gameArea.classList.add('hidden');
      this.updateNetworkStatus();
    });

    conn.on('error', (err) => {
      console.error('BR host connection error:', err);
      ChatManager.addMessage(`BR connection error: ${err?.message || err?.type || 'unknown'}`, 'System');
      this.setStatus(`BR connection error: ${err?.message || err?.type || 'unknown'}`);
      this.stopBattleRoyaleNetwork();
      this.setLobbyControlsEnabled(true);
      this.updateNetworkStatus();
    });
  }

  _handleBrClientMessage(rawMsg) {
    if (this.mode !== 'battle_royale' || this.br.role !== 'client') return;
    if (!rawMsg || typeof rawMsg !== 'object') return;

    const type = (typeof rawMsg.type === 'string') ? rawMsg.type : '';
    switch (type) {
      case 'brJoinDenied': {
        const reason = String(rawMsg.reason || 'rejected');
        const text = reason === 'lobby_full'
          ? 'Join failed: BR lobby is full.'
          : (reason === 'match_started' ? 'Join failed: BR match already started.' : 'Join failed.');
        this.setStatus(text);
        ChatManager.addMessage(text, 'System');
        this.stopBattleRoyaleNetwork();
        this.setLobbyControlsEnabled(true);
        break;
      }

      case 'brWelcome': {
        this.br.hostId = (typeof rawMsg.hostId === 'string') ? rawMsg.hostId : this.br.hostId;
        this.br.roomCode = (typeof rawMsg.roomCode === 'string') ? rawMsg.roomCode : this.br.roomCode;
        this.br.maxPlayers = this._clampInt(rawMsg.maxPlayers, 3, 8, this.br.maxPlayers);
        this.br.started = rawMsg.started === true;
        this.br.roundId = (typeof rawMsg.roundId === 'string') ? rawMsg.roundId : null;
        this._applyBrPlayersSnapshot(rawMsg.players);
        if (!this.br.players.has(this.br.localId)) {
          const cfg = this.readBattleRoyaleConfigFromUI();
          this.br.players.set(this.br.localId, this._makeBrPlayer(this.br.localId, cfg.attackMode));
        }
        this.updateBrLobbyPanel();
        this.applyModeUI();
        this.setStatus('Joined BR lobby. Waiting for host start.');
        this.updateNetworkStatus();
        break;
      }

      case 'brLobby': {
        this.br.roomCode = (typeof rawMsg.roomCode === 'string') ? rawMsg.roomCode : this.br.roomCode;
        this.br.maxPlayers = this._clampInt(rawMsg.maxPlayers, 3, 8, this.br.maxPlayers);
        this.br.started = rawMsg.started === true;
        this.br.roundId = (typeof rawMsg.roundId === 'string') ? rawMsg.roundId : this.br.roundId;
        this._applyBrPlayersSnapshot(rawMsg.players);

        const localPlayer = this.br.players.get(this.br.localId);
        if (this.phase === 'playing' && localPlayer && !localPlayer.alive) {
          this.acceptInput = false;
          this.phase = 'roundOver';
          this.setStatus('You are out. Spectating until match end.');
        }

        this.updateBrLobbyPanel();
        this._refreshBrFocusBoard();
        this.updateNetworkStatus();
        break;
      }

      case 'brChat': {
        const text = this._sanitizeBrMessageText(rawMsg.message);
        if (!text) break;
        const fromId = (typeof rawMsg.fromId === 'string') ? rawMsg.fromId : 'Player';
        if (fromId !== this.br.localId) ChatManager.addMessage(text, fromId);
        break;
      }

      case 'brStart': {
        const seed = this._clampInt(rawMsg.seed, 0, 1000000000, Math.floor(Math.random() * 1e9));
        const roundId = (typeof rawMsg.roundId === 'string' && rawMsg.roundId.trim())
          ? rawMsg.roundId.trim()
          : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
        const startedAt = Math.max(0, Number(rawMsg.startedAt) || Date.now());
        this.startBattleRoyaleRound(seed, roundId, startedAt);
        break;
      }

      case 'brState': {
        if (!this.br.roundId) break;
        if (rawMsg.roundId !== this.br.roundId) break;
        const playerId = (typeof rawMsg.playerId === 'string') ? rawMsg.playerId : '';
        if (!playerId || playerId === this.br.localId) break;
        if (!rawMsg.state || typeof rawMsg.state !== 'object') break;
        this.br.remoteStates.set(playerId, rawMsg.state);
        this._updateBrPerfFromState(playerId, rawMsg.state);
        this._refreshBrFocusBoard();
        break;
      }

      case 'brAttackIncoming': {
        if (!this.br.roundId) break;
        if (rawMsg.roundId !== this.br.roundId) break;
        const lines = this._clampInt(rawMsg.lines, 0, 10, 0);
        if (lines <= 0) break;
        if (this.gameState1) this.gameState1.receiveAttack(lines);

        const fromId = (typeof rawMsg.fromId === 'string') ? rawMsg.fromId : null;
        if (fromId) {
          const localPlayer = this.br.players.get(this.br.localId);
          if (localPlayer) localPlayer.lastAttackerId = fromId;
        }
        break;
      }

      case 'brMatchOver': {
        const winnerId = (typeof rawMsg.winnerId === 'string' && rawMsg.winnerId) ? rawMsg.winnerId : null;
        const roundId = (typeof rawMsg.roundId === 'string' && rawMsg.roundId) ? rawMsg.roundId : this.br.roundId;
        this._finishBrMatch(winnerId, roundId);
        break;
      }

      default:
        break;
    }
  }

  sendBattleRoyaleChat(message) {
    if (this.mode !== 'battle_royale' || !this.br.active) return false;
    const text = this._sanitizeBrMessageText(message);
    if (!text) return false;

    if (this.br.role === 'host') {
      this._brBroadcast({ type: 'brChat', fromId: this.br.localId, message: text });
      return true;
    }

    if (this.br.role === 'client' && this.br.hostConn && this.br.hostConn.open) {
      try {
        this.br.hostConn.send({ type: 'brChat', message: text });
        return true;
      } catch (_) {
        return false;
      }
    }

    return false;
  }

  _handleBrLocalTopOut() {
    if (this.mode !== 'battle_royale') return;
    const localPlayer = this.br.players.get(this.br.localId);
    if (localPlayer && !localPlayer.alive) return;

    this.acceptInput = false;
    this.phase = 'roundOver';
    this.showResultOverlay('OUT', 'You are eliminated. Spectating...', { durationMs: 1800 });
    this.setStatus('You are out. Spectating until match end.');

    if (this.br.role === 'host') {
      this._markBrPlayerEliminated(this.br.localId);
    } else {
      if (localPlayer) localPlayer.alive = false;
      this.updateBrLobbyPanel();
      if (this.br.hostConn && this.br.hostConn.open) {
        try {
          this.br.hostConn.send({ type: 'brEliminated', roundId: this.br.roundId });
        } catch (_) {}
      }
    }
  }

  _buildFallbackBotController(gameState, config = {}) {
    const toNum = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
    const clamp = (v, min, max, d) => Math.max(min, Math.min(max, toNum(v, d)));

    let pps = 1.6;
    let aggression = 65;
    let mistakeChance = 0.08;
    let thinkJitterMs = 85;

    let elapsedMs = 0;
    let nextActionDelayMs = 0;

    const configure = (cfg = {}) => {
      pps = clamp(cfg.pps, 0.4, 6, 1.6);
      aggression = clamp(cfg.aggression, 0, 100, 65);
      mistakeChance = clamp(cfg.mistakeChance, 0, 100, 8) / 100;
      thinkJitterMs = clamp(cfg.thinkJitterMs, 0, 400, 85);
    };

    const scheduleNextAction = (isFirst) => {
      const base = 1000 / Math.max(0.1, pps);
      const jitter = thinkJitterMs > 0 ? ((Math.random() * 2 - 1) * thinkJitterMs) : 0;
      const startup = isFirst ? 120 : 0;
      nextActionDelayMs = Math.max(30, base + jitter + startup);
    };

    const shapeFor = (piece, rot) => SHAPES[piece].shape[rot % 4];
    const cloneBoard = (board) => board.map((row) => row.slice());

    const canPlace = (board, piece, rot, x, y) => {
      const shape = shapeFor(piece, rot);
      for (let r = 0; r < shape.length; r++) {
        for (let c = 0; c < shape[r].length; c++) {
          if (!shape[r][c]) continue;
          const nx = x + c;
          const ny = y + r;
          if (nx < 0 || nx >= COLS || ny >= ROWS) return false;
          if (ny >= 0 && board[ny][nx]) return false;
        }
      }
      return true;
    };

    const dropY = (board, piece, rot, x) => {
      let y = SPAWN_ROW;
      if (!canPlace(board, piece, rot, x, y)) return null;
      while (canPlace(board, piece, rot, x, y + 1)) y++;
      return y;
    };

    const simulatePlacement = (board, piece, rot, x, y) => {
      const sim = cloneBoard(board);
      const shape = shapeFor(piece, rot);
      for (let r = 0; r < shape.length; r++) {
        for (let c = 0; c < shape[r].length; c++) {
          if (!shape[r][c]) continue;
          const nx = x + c;
          const ny = y + r;
          if (ny < 0 || nx < 0 || nx >= COLS || ny >= ROWS) return null;
          sim[ny][nx] = piece;
        }
      }

      let linesCleared = 0;
      for (let row = ROWS - 1; row >= 0; row--) {
        if (sim[row].every((cell) => cell !== 0)) {
          sim.splice(row, 1);
          sim.unshift(Array(COLS).fill(0));
          linesCleared++;
          row++;
        }
      }
      return { board: sim, linesCleared };
    };

    const analyzeBoard = (board) => {
      const heights = Array(COLS).fill(0);
      let holes = 0;

      for (let c = 0; c < COLS; c++) {
        let seen = false;
        for (let r = 0; r < ROWS; r++) {
          const filled = board[r][c] !== 0;
          if (filled && !seen) {
            heights[c] = ROWS - r;
            seen = true;
          } else if (!filled && seen) {
            holes++;
          }
        }
      }

      let bumpiness = 0;
      for (let c = 0; c < COLS - 1; c++) bumpiness += Math.abs(heights[c] - heights[c + 1]);
      const aggregateHeight = heights.reduce((a, b) => a + b, 0);
      return { aggregateHeight, holes, bumpiness };
    };

    const scorePlacement = (linesCleared, analysis) => {
      const aggr = aggression / 100;
      const lineWeight = 9 + aggr * 7;
      const holePenalty = 7.5 - aggr * 2;
      const heightPenalty = 0.42 - aggr * 0.13;
      const bumpPenalty = 0.22 + (1 - aggr) * 0.06;
      return (
        (linesCleared * lineWeight) -
        (analysis.holes * holePenalty) -
        (analysis.aggregateHeight * heightPenalty) -
        (analysis.bumpiness * bumpPenalty)
      );
    };

    const choosePlacement = () => {
      if (!gameState || !gameState.currentPiece) return null;
      const piece = gameState.currentPiece;
      const board = gameState.board;
      const candidates = [];

      for (let rot = 0; rot < 4; rot++) {
        const shape = shapeFor(piece, rot);
        const width = shape[0].length;
        const minX = -2;
        const maxX = COLS - width + 2;

        for (let x = minX; x <= maxX; x++) {
          const y = dropY(board, piece, rot, x);
          if (y == null) continue;
          const sim = simulatePlacement(board, piece, rot, x, y);
          if (!sim) continue;
          const analysis = analyzeBoard(sim.board);
          const score = scorePlacement(sim.linesCleared, analysis);
          candidates.push({ x, y, rot, score });
        }
      }

      if (candidates.length === 0) return null;
      candidates.sort((a, b) => b.score - a.score);
      if (Math.random() < mistakeChance) {
        const pool = candidates.slice(0, Math.min(6, candidates.length));
        return pool[Math.floor(Math.random() * pool.length)];
      }
      return candidates[0];
    };

    const executePlacement = (plan) => {
      if (!gameState || !gameState.currentPiece) return true;
      if (!plan) return gameState.hardDropAndSpawn();

      gameState.currentRotation = plan.rot;
      gameState.currentX = plan.x;
      gameState.currentY = plan.y;

      const locked = gameState.lockPiece();
      if (!locked) return gameState.hardDropAndSpawn();
      return gameState.spawnPiece();
    };

    configure(config);
    scheduleNextAction(true);

    return {
      configure,
      update: (deltaTimeMs) => {
        if (!gameState || !gameState.currentPiece) return true;
        elapsedMs += Math.max(0, Number(deltaTimeMs) || 0);
        if (elapsedMs < nextActionDelayMs) return true;
        elapsedMs = 0;
        const plan = choosePlacement();
        const ok = executePlacement(plan);
        scheduleNextAction(false);
        return ok;
      },
    };
  }

  startBotPractice() {
    if (this.mode !== 'bot_practice') return;

    this._invalidateRoundFlow();
    this._cancelJoinConnectLoop();

    this.phase = 'playing';
    this.roundId = `bot-${Date.now()}`;
    this.acceptInput = true;
    this.hideResultOverlay();
    this.hideRoundStatsPanel();
    this.clearCombatFeed();

    if (this.gameArea) this.gameArea.classList.remove('hidden');
    if (this.restartBtn) this.restartBtn.classList.remove('hidden');

    GameSettings.getInstance().update();
    const botCfg = this.readBotConfigFromSettings();
    const seedLocal = Math.floor(Math.random() * 1e9);
    const seedBot = Math.floor(Math.random() * 1e9);

    try {
      this.gameState1 = new GameState('gameCanvas1', 'holdCanvas1', 'queueCanvas1', 1, seedLocal);
      this.gameState2 = new GameState('gameCanvas2', 'holdCanvas2', 'queueCanvas2', 2, seedBot);
      this.gameState1.setRoundId(this.roundId);
      this.gameState2.setRoundId(this.roundId);
      this.gameState1.setCombatEventHandler((event) => this.handleCombatEvent(1, event));
      this.gameState2.setCombatEventHandler((event) => this.handleCombatEvent(2, event));

      this.gameState1.setAttackHandler((attack) => {
        const safe = Math.max(0, Math.min(10, Number(attack) || 0));
        if (safe > 0 && this.gameState2) this.gameState2.receiveAttack(safe);
      });
      this.gameState2.setAttackHandler((attack) => {
        const safe = Math.max(0, Math.min(10, Number(attack) || 0));
        if (safe > 0 && this.gameState1) this.gameState1.receiveAttack(safe);
      });

      const startTime = Date.now();
      this.gameState1.setGameStartTime(startTime);
      this.gameState2.setGameStartTime(startTime);

      InputManager.getInstance().reset();

      const okLocal = this.gameState1.spawnPiece();
      const okBot = this.gameState2.spawnPiece();
      if (!okLocal || !okBot) {
        this._finishBotPractice(false, 'Round failed to start.');
        return;
      }

      const BotCtor = (typeof globalThis !== 'undefined' && typeof globalThis.TetrisBot === 'function')
        ? globalThis.TetrisBot
        : (typeof TetrisBot === 'function' ? TetrisBot : null);

      if (BotCtor) {
        this.botController = new BotCtor(this.gameState2, botCfg);
      } else {
        this.botController = this._buildFallbackBotController(this.gameState2, botCfg);
        ChatManager.addMessage('Bot script missing; using built-in fallback bot.', 'System');
        this.setStatus('Bot script missing; using fallback bot.');
      }

      this.lastTime = 0;
      this.lastStateSendTime = 0;
      this.gameState1.draw();
      this.gameState2.draw();
    } catch (err) {
      console.error('Bot practice failed to start:', err);
      this.setStatus(`Bot practice failed: ${err?.message || err}`);
      this.acceptInput = false;
      this.phase = 'idle';
      return;
    }

    this.setStatus('Bot practice in progress.');
    ChatManager.addMessage('Bot practice started.', 'System');

    if (!this.gameRunning) {
      this.gameRunning = true;
      this.animationFrameId = requestAnimationFrame(this.gameLoop.bind(this));
    }

    this.applyModeUI();
    this.updateNetworkStatus();
  }

  _finishBotPractice(localWon, reason = '') {
    if (this.mode !== 'bot_practice') return;
    if (this.phase === 'matchOver') return;

    this.acceptInput = false;
    this.phase = 'matchOver';
    this.stopLoop();

    if (localWon) this.botSummary.wins += 1;
    else this.botSummary.losses += 1;

    const title = localWon ? 'VICTORY' : 'DEFEAT';
    const subtitle = reason || (localWon ? 'Bot topped out.' : 'You topped out.');
    this.setStatus(localWon ? 'Bot practice: win.' : 'Bot practice: loss.');
    this.showResultOverlay(title, subtitle, { persistent: true });
    this.showRoundStatsPanel('BOT PRACTICE STATS', { persistent: true });
    if (this.restartBtn) this.restartBtn.classList.remove('hidden');
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

      if (code === 'Escape') {
        const resultVisible = this.resultOverlay && !this.resultOverlay.classList.contains('hidden');
        const statsVisible = this.roundStatsPanel && !this.roundStatsPanel.classList.contains('hidden');
        if (resultVisible || statsVisible) {
          this.dismissResultUI();
          return true;
        }
      }

      if (code === 'KeyR') {
        if (this.mode === 'zen') {
          this.startZen();
          return true;
        }
        if (this.mode === 'bot_practice') {
          const canRestart = this.phase === 'playing' || this.phase === 'roundOver' || this.phase === 'matchOver';
          if (canRestart) {
            this.startBotPractice();
            return true;
          }
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
        if (this.mode === 'bot_practice' && (this.phase === 'roundOver' || this.phase === 'matchOver')) {
          this.startBotPractice();
          return true;
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
        (this.mode === 'pvp_1v1' || this.mode === 'battle_royale' || this.mode === 'bot_practice') &&
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

  dismissResultUI() {
    this.hideResultOverlay();
    this.hideRoundStatsPanel();
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

    if (this.mode === 'bot_practice') {
      this._finishBotPractice(false, 'You topped out.');
      return;
    }

    if (this.mode === 'battle_royale') {
      this._handleBrLocalTopOut();
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
      const input = InputManager.getInstance();

      if (this.mode === 'zen') {
        if (this.gameState1) {
          if (this.zenPaused) {
            this.lastTime = 0;
            this.gameState1.draw();
          } else {
            if (this.acceptInput) input.processMovement(deltaTime, (dx) => this.gameState1.move(dx));
            const ok = this.gameState1.update(deltaTime);
            if (!ok) {
              this.handleGameOver();
              return;
            }
            this.gameState1.draw();
          }
        }
      } else if (this.mode === 'pvp_1v1') {
        if (this.gameState1 && this.phase === 'playing') {
          if (this.acceptInput) input.processMovement(deltaTime, (dx) => this.gameState1.move(dx));
          const ok = this.gameState1.update(deltaTime);
          if (!ok) {
            this.handleGameOver();
            return;
          }
        }

        const inRound = (this.phase === 'playing' || this.phase === 'countdown');
        if (
          this.gameState1 &&
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

        if (this.gameState1) this.gameState1.draw();
        if (this.gameState2) this.gameState2.draw();
      } else if (this.mode === 'bot_practice') {
        if (this.phase === 'playing') {
          if (this.gameState1 && this.acceptInput) input.processMovement(deltaTime, (dx) => this.gameState1.move(dx));

          if (this.gameState1) {
            const okLocal = this.gameState1.update(deltaTime);
            if (!okLocal) {
              this.handleGameOver();
              return;
            }
          }

          if (this.botController) {
            const okBot = this.botController.update(deltaTime);
            if (!okBot) {
              this._finishBotPractice(true, 'Bot topped out.');
              return;
            }
          }
        }

        if (this.gameState1) this.gameState1.draw();
        if (this.gameState2) this.gameState2.draw();
      } else if (this.mode === 'battle_royale') {
        const localPlayer = this.br.players.get(this.br.localId);
        const localAlive = localPlayer ? !!localPlayer.alive : true;

        if (this.phase === 'playing' && this.gameState1 && localAlive) {
          if (this.acceptInput) input.processMovement(deltaTime, (dx) => this.gameState1.move(dx));
          const okLocal = this.gameState1.update(deltaTime);
          if (!okLocal) {
            this.handleGameOver();
            return;
          }
        }

        if (this.gameState1) this.gameState1.draw();
        this._refreshBrFocusBoard();
        if (this.gameState2) this.gameState2.draw();

        const shouldSendState = (
          this.gameState1 &&
          this.br.started &&
          this.br.roundId &&
          (this.phase === 'playing' || this.phase === 'countdown' || this.phase === 'roundOver')
        );
        if (shouldSendState && (timestamp - this.lastStateSendTime) > this.br.stateSendIntervalMs) {
          const state = this.gameState1.getState();
          this._updateBrPerfFromState(this.br.localId, state);

          if (this.br.role === 'host') {
            this.br.remoteStates.set(this.br.localId, state);
            this._brBroadcast({
              type: 'brState',
              playerId: this.br.localId,
              roundId: this.br.roundId,
              state,
            });
          } else if (this.br.role === 'client' && this.br.hostConn && this.br.hostConn.open) {
            try {
              this.br.hostConn.send({
                type: 'brState',
                roundId: this.br.roundId,
                state,
              });
            } catch (_) {}
          }

          this.lastStateSendTime = timestamp;
        }
      }
    } catch (err) {
      console.error('gameLoop error:', err);
    }

    this.animationFrameId = requestAnimationFrame(this.gameLoop.bind(this));
  }
}




