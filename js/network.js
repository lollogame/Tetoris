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
  }

  static getInstance() {
    if (!NetworkManager.instance) NetworkManager.instance = new NetworkManager();
    return NetworkManager.instance;
  }

  initialize(onMessage) {
    this.onMessageCallback = onMessage;

    this.peer = new Peer({
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      },
    });

    this.peer.on('open', (id) => {
      this.myPeerId = id;
      document.getElementById('peerIdDisplay').textContent = id;
      document.getElementById('myPeerId').classList.remove('hidden');
      ChatManager.addMessage(`Your Peer ID: ${id}`);
      ChatManager.addMessage('Share this ID with your opponent to let them join!');
    });

    // HOST receives incoming connection
    this.peer.on('connection', (connection) => {
      this.conn = connection;

      // IMPORTANT: wait for open before notifying controller
      this.conn.on('open', () => {
        this.setupConnection();

        ChatManager.addMessage('Opponent connected!');
        document.getElementById('gameStatus').textContent = 'Connected! Preparing match...';

        // Now it's safe to send matchConfig / startRound immediately
        if (this.onMessageCallback) this.onMessageCallback({ type: 'peerConnected' });
      });

      this.conn.on('error', (err) => {
        ChatManager.addMessage(`Connection error: ${err}`);
      });
    });

    this.peer.on('error', (err) => {
      console.error('PeerJS error:', err);
      ChatManager.addMessage(`Connection error: ${err.type}`);
    });
  }

  // JOINER connects to host
  connect(peerId) {
    setTimeout(() => {
      this.conn = this.peer.connect(peerId);

      this.conn.on('open', () => {
        this.setupConnection();
        ChatManager.addMessage('Connected to opponent!');
        document.getElementById('gameStatus').textContent =
          'Connected! Waiting for host to start...';
        document.getElementById('joinGameBtn').disabled = true;

        if (this.onMessageCallback) this.onMessageCallback({ type: 'joinedLobby' });
      });

      this.conn.on('error', (err) => {
        ChatManager.addMessage(`Failed to connect: ${err}`);
      });
    }, 200);
  }

  setupConnection() {
    if (!this.conn) return;

    this.conn.on('data', (data) => {
      if (this.onMessageCallback) this.onMessageCallback(data);
    });

    this.conn.on('close', () => {
      ChatManager.addMessage('Opponent disconnected');
      document.getElementById('gameStatus').textContent = 'Opponent disconnected';
    });
  }

  send(msg) {
    if (this.conn && this.conn.open) this.conn.send(msg);
  }

  sendAttack(lines) {
    const safe = Math.max(0, Math.min(10, Number(lines) || 0));

    // Always allow local hook (even if not connected)
    if (typeof this.localAttackHandler === 'function' && safe > 0) {
      try { this.localAttackHandler(safe); } catch (e) { console.error('localAttackHandler error:', e); }
    }

    // Only send over network if connected
    if (this.conn && this.conn.open && safe > 0) {
      this.conn.send({ type: 'attack', lines: safe });
    }
  }

  setLocalAttackHandler(fn) {
    this.localAttackHandler = (typeof fn === 'function') ? fn : null;
  }

  isConnected() {
    return this.conn && this.conn.open;
  }
}
