'use strict';

class NetworkManager {
  static instance = null;

  constructor() {
    this.peer = null;
    this.conn = null;
    this.myPeerId = null;
    this.onMessageCallback = null;

    // Optional local hook (e.g., Zen scoring)
    this.localAttackHandler = null;

    // Optional: used only for UI wording
    this.role = 'host'; // 'host' | 'client'

    // Internal: retry if preferred ID is already taken
    this._initAttempt = 0;
    this._initOpts = null;

    // Lightweight RTT probe (ping/pong)
    this.pingIntervalMs = 2500;
    this.pingTimeoutMs = 10000;
    this._pingTimer = null;
    this._nextPingId = 1;
    this._pendingPings = new Map();
  }

  static getInstance() {
    if (!NetworkManager.instance) NetworkManager.instance = new NetworkManager();
    return NetworkManager.instance;
  }

  // Short, easy-to-type room code (no 0/O/1/I)
  generateRoomCode(len = 6) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < len; i++) {
      out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return out;
  }

  initialize(onMessage, opts = {}) {
    this.onMessageCallback = onMessage;

    // room-code options (host can pass these)
    this._initOpts = { ...opts };
    this.role = (opts.role === 'client') ? 'client' : 'host';
    this._initAttempt = 0;

    const createPeer = () => {
      // tear down previous peer cleanly
      try { if (this.conn && this.conn.open) this.conn.close(); } catch (_) {}
      this.conn = null;
      this.stopPingLoop();

      try {
        if (this.peer && !this.peer.destroyed) this.peer.destroy();
      } catch (_) {}
      this.peer = null;
      this.myPeerId = null;

      const wantRoomCode = !!this._initOpts.useRoomCode;
      const codeLen = Math.max(4, Math.min(12, Number(this._initOpts.roomCodeLength) || 6));

      let desiredId = (typeof this._initOpts.preferredId === 'string') ? this._initOpts.preferredId.trim() : '';

      // host: generate a short room code unless one was provided
      if (!desiredId && wantRoomCode) {
        desiredId = this.generateRoomCode(codeLen);
        this._initOpts.preferredId = desiredId;
      }

      // retry: if taken, generate a new one
      if (this._initAttempt > 0 && wantRoomCode) {
        desiredId = this.generateRoomCode(codeLen);
        this._initOpts.preferredId = desiredId;
      }

      const peerOptions = {
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
          ],
        },
      };

      // If desiredId exists => use it as PeerJS ID (this is the alias)
      this.peer = desiredId ? new Peer(desiredId, peerOptions) : new Peer(peerOptions);

      this.peer.on('open', (id) => {
        this.myPeerId = id;

        const peerIdEl = document.getElementById('peerIdDisplay');
        if (peerIdEl) peerIdEl.textContent = id;

        const peerBox = document.getElementById('myPeerId');
        if (peerBox) peerBox.classList.remove('hidden');

        if (typeof ChatManager !== 'undefined') {
          if (this.role === 'host' && wantRoomCode) {
            ChatManager.addMessage(`Room code ready: ${id}`, 'System');
            ChatManager.addMessage('Share the room code with your opponent so they can join.', 'System');
          } else {
            ChatManager.addMessage(`Your Peer ID: ${id}`, 'System');
          }
        }

        console.log('Peer opened with ID:', id);
      });

      this.peer.on('connection', (conn) => {
        if (this.conn && this.conn.open) {
          try { this.conn.close(); } catch (_) {}
        }

        this.conn = conn;
        this.setupConnectionHandlers();

        conn.on('open', () => {
          this.startPingLoop();
          if (typeof ChatManager !== 'undefined') {
            ChatManager.addMessage('Opponent connected!', 'System');
          }
          // Now it is safe to send data, so we tell the controller to start
          this.handleInternalMessage({ type: 'peerConnected' });
        });
        // --- END FIX ---
      });

      this.peer.on('error', (err) => {
        console.error('Peer error:', err);

        // If our short room code is taken, retry a few times automatically
        if (err && err.type === 'unavailable-id' && wantRoomCode && this._initAttempt < 5) {
          this._initAttempt += 1;
          if (typeof ChatManager !== 'undefined') {
            ChatManager.addMessage('Room code already in use - generating a new one...', 'System');
          }
          createPeer();
          return;
        }

        if (typeof ChatManager !== 'undefined') {
          ChatManager.addMessage(`Network error: ${err?.type || err?.message || 'unknown'}`, 'System');
        }
        this.handleInternalMessage({
          type: 'networkError',
          message: err?.message || err?.type || 'unknown',
        });
      });
    };

    createPeer();
  }

  connect(peerId) {
    if (!this.peer) {
      ChatManager.addMessage('Peer not initialized yet.', 'System');
      return;
    }

    const cleanId = String(peerId || '').trim();
    if (!cleanId) return;

    this.role = 'client';

    this.conn = this.peer.connect(cleanId);

    this.conn.on('open', () => {
      this.setupConnectionHandlers();
      ChatManager.addMessage('Connected to host!', 'System');

      const joinBtn = document.getElementById('joinGameBtn');
      if (joinBtn) joinBtn.disabled = true;

      this.handleInternalMessage({ type: 'joinedLobby' });
    });

    this.conn.on('error', (err) => {
      this.stopPingLoop();
      console.error('Connection error:', err);
      ChatManager.addMessage(`Connection error: ${err?.message || err?.type || 'unknown'}`, 'System');
      this.handleInternalMessage({
        type: 'networkError',
        message: err?.message || err?.type || 'unknown',
      });
    });
  }

  setupConnectionHandlers() {
    if (!this.conn) return;

    this.startPingLoop();

    this.conn.on('data', (data) => {
      if (data?.type === 'netPing') {
        const pingId = Number(data.id);
        if (Number.isFinite(pingId) && pingId > 0) {
          this.send({ type: 'netPong', id: pingId });
        }
        return;
      }

      if (data?.type === 'netPong') {
        const pongId = Number(data.id);
        if (!Number.isFinite(pongId) || pongId <= 0) return;
        const sentAt = this._pendingPings.get(pongId);
        if (!Number.isFinite(sentAt)) return;
        this._pendingPings.delete(pongId);
        const rttMs = Math.max(1, Math.round(performance.now() - sentAt));
        this.handleInternalMessage({ type: 'netRtt', rttMs });
        return;
      }

      // Local-only hook (Zen etc)
      if (data?.type === 'attack' && typeof this.localAttackHandler === 'function') {
        this.localAttackHandler(data.lines);
        return;
      }

      if (this.onMessageCallback) this.onMessageCallback(data);
    });

    this.conn.on('close', () => {
      this.stopPingLoop();
      console.log('Connection closed');
      ChatManager.addMessage('Opponent disconnected.', 'System');
      this.handleInternalMessage({ type: 'peerDisconnected' });

      const joinBtn = document.getElementById('joinGameBtn');
      if (joinBtn) joinBtn.disabled = false;
    });
  }

  handleInternalMessage(msg) {
    if (this.onMessageCallback) this.onMessageCallback(msg);
  }

  isConnected() {
    return this.conn && this.conn.open;
  }

  send(message) {
    if (this.conn && this.conn.open) {
      this.conn.send(message);
    }
  }

  startPingLoop() {
    this.stopPingLoop();
    if (!this.conn || !this.conn.open) return;

    const tick = () => {
      if (!this.conn || !this.conn.open) return;

      const now = performance.now();
      for (const [id, sentAt] of this._pendingPings) {
        if ((now - sentAt) > this.pingTimeoutMs) this._pendingPings.delete(id);
      }

      const pingId = this._nextPingId++;
      if (this._nextPingId > 1000000000) this._nextPingId = 1;
      this._pendingPings.set(pingId, now);
      this.send({ type: 'netPing', id: pingId });

      this._pingTimer = window.setTimeout(tick, this.pingIntervalMs);
    };

    this._pingTimer = window.setTimeout(tick, this.pingIntervalMs);
  }

  stopPingLoop() {
    if (this._pingTimer != null) {
      window.clearTimeout(this._pingTimer);
      this._pingTimer = null;
    }
    this._pendingPings.clear();
  }

  sendAttack(lines, roundId = null) {
    // clamp
    const safe = Math.max(0, Math.min(10, Number(lines) || 0));
    if (safe === 0) return;

    // if local hook exists, don't network it
    if (typeof this.localAttackHandler === 'function') {
      this.localAttackHandler(safe);
      return;
    }

    const payload = { type: 'attack', lines: safe };
    if (typeof roundId === 'string' && roundId.trim()) {
      payload.roundId = roundId.trim();
    }
    this.send(payload);
  }

  setLocalAttackHandler(handler) {
    this.localAttackHandler = (typeof handler === 'function') ? handler : null;
  }
}

