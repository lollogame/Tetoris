'use strict';


/* =========================================================
   Tiny SFX (WebAudio, no external files)
   - Plays only after a user gesture (browser policy). We lazily init.
========================================================= */
class SFX {
  static ctx = null;
  static master = null;
  static BASE_GAIN = 0.12;
  static masterVolume = 1;
  static sfxVolume = 1;
  static musicVolume = 0.7;

  static applyMasterGain() {
    if (!SFX.master) return;
    const gain = SFX.BASE_GAIN * SFX.masterVolume * SFX.sfxVolume;
    SFX.master.gain.value = Math.max(0, Math.min(1, gain));
  }

  static setVolumes(masterPct = 100, sfxPct = 100, musicPct = 70) {
    const toUnit = (pct, fallback) => {
      const n = Number(pct);
      if (!Number.isFinite(n)) return fallback;
      return Math.max(0, Math.min(1, n / 100));
    };

    SFX.masterVolume = toUnit(masterPct, 1);
    SFX.sfxVolume = toUnit(sfxPct, 1);
    SFX.musicVolume = toUnit(musicPct, 0.7);
    SFX.applyMasterGain();
  }

  static ensure() {
    try {
      if (SFX.ctx) return true;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      SFX.ctx = new Ctx();
      SFX.master = SFX.ctx.createGain();
      SFX.applyMasterGain();
      SFX.master.connect(SFX.ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  static beep(freq = 440, durMs = 40, type = 'square', gain = 0.6) {
    if (!SFX.ensure()) return;
    const ctx = SFX.ctx;

    // If still suspended, resume on first interaction attempt
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;

    const t0 = ctx.currentTime;
    const dur = Math.max(0.01, durMs / 1000);

    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    o.connect(g);
    g.connect(SFX.master);

    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  static noise(durMs = 60, gain = 0.25) {
    if (!SFX.ensure()) return;
    const ctx = SFX.ctx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const dur = Math.max(0.01, durMs / 1000);
    const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1);

    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    src.buffer = buffer;

    const t0 = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(g);
    g.connect(SFX.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  static play(name, arg = 0) {
    // Keep these short/subtle; you can tune later.
    switch (name) {
      case 'rotate':    return SFX.beep(620, 22, 'square', 0.25);
      case 'hold':      return SFX.beep(520, 35, 'triangle', 0.25);
      case 'harddrop':  return SFX.beep(220, 45, 'square', 0.35);
      case 'lock':      return SFX.beep(180, 28, 'square', 0.22);
      case 'line': {
        // arg = lines cleared
        const n = Math.max(1, Math.min(4, Number(arg) || 1));
        const freq = [0, 520, 600, 700, 840][n];
        return SFX.beep(freq, 70, 'triangle', 0.30);
      }
      case 'garbage_in':    return SFX.noise(50, 0.18);
      case 'garbage_apply': return SFX.noise(70, 0.22);
      default: return;
    }
  }
}

/* =========================================================
   Game State
========================================================= */
class GameState {
  constructor(canvasId, holdCanvasId, queueCanvasId, playerId, seed) {
    this.playerId = playerId;
    this.rng = new SeededRandom(seed);
    this.gameStartTime = Date.now();

    this.board = Array(ROWS).fill(null).map(() => Array(COLS).fill(0));
    this.currentPiece = null;
    this.currentX = 0;
    this.currentY = SPAWN_ROW;
    this.currentRotation = 0;

    this.holdPiece = null;
    this.canHold = true;

    this.bag = [];
    this.queue = [];
    this.initQueue();

    this.gravity = 1000;
    this.lastGravityTime = 0;

    this.lockDelay = 500;
    this.lockDelayTimer = 0;
    this.isTouchingGround = false;
    this.maxLockResets = 15;
    this.lockResetCount = 0;

    this.dcdTimer = 0;

    this.piecesPlaced = 0;
    this.attacksSent = 0;
    this.linesClearedTotal = 0;
    this.finesseErrors = 0;
    this.pieceInputCount = 0;
    this.b2bCounter = 0;
    this.comboCounter = -1;
    this.lastClearWasB2B = false;

    this.lastActionWasRotation = false;

    this.rotateBuffer = null;

    this.spawnGrace = false;
    this.spawnGraceUsed = false;

    this.softDropActive = false;

    this.pendingGarbage = [];
    this.garbageHole = this.rng.nextInt(COLS);
    this.garbageVel = 0; // -1, 0, +1 momentum
    this.roundId = null;
    this.onCombatEvent = null;
    this.onAttackSend = null;

    const canvas = document.getElementById(canvasId);
    const holdCanvas = document.getElementById(holdCanvasId);
    const queueCanvas = document.getElementById(queueCanvasId);
    this.renderer = new TetrisRenderer(canvas, holdCanvas, queueCanvas);
  }

  initQueue() {
    for (let i = 0; i < 6; i++) this.queue.push(this.getNextPiece());
  }

  getNextPiece() {
    if (this.bag.length === 0) {
      this.bag = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = this.rng.nextInt(i + 1);
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
    }
    return this.bag.pop();
  }

  resetPieceState(piece) {
    this.currentPiece = piece;
    this.currentRotation = 0;
    this.currentX = SPAWN_COLUMNS[piece];
    this.currentY = SPAWN_ROW;

    this.lockDelayTimer = 0;
    this.lockResetCount = 0;
    this.isTouchingGround = false;

    this.lastGravityTime = 0;
    this.lastActionWasRotation = false;

    this.spawnGrace = true;
    this.spawnGraceUsed = false;

    this.pieceSpawnTime = performance.now();
    this.pieceInputCount = 0;
  }

  spawnPiece() {
  const pieceType = this.queue.shift();
  this.queue.push(this.getNextPiece());
  this.resetPieceState(pieceType);
  this.canHold = true;

  // If the spawn position itself is invalid, top-out
  if (!this.isValidPosition(this.currentX, this.currentY, this.currentRotation)) {
    return false;
  }

  // Apply IRS / buffered rotation immediately, and re-arm movement
  this.afterSpawnInput();
  return true;
}


  bufferRotation(dir) { this.rotateBuffer = { dir, time: performance.now() }; }

  consumeRotationBuffer() {
    if (!this.rotateBuffer) return false;
    const age = performance.now() - this.rotateBuffer.time;
    if (age > ROTATION_BUFFER_MS) { this.rotateBuffer = null; return false; }
    const ok = this.rotate(this.rotateBuffer.dir);
    if (ok) this.rotateBuffer = null;
    return ok;
  }

  applyInitialRotation(allowBufferedPress = false) {
    if (!this.currentPiece) return false;

    const input = InputManager.getInstance();
    const held = input.getHeldCodes();
    const b = input.getBindings();
    const now = performance.now();

    const wasPressedRecently = (code) => {
      if (!allowBufferedPress) return false;
      const t = input.getLastPressedAt(code);
      return (t >= (this.pieceSpawnTime ?? 0)) && ((now - t) <= HOLD_IRS_BUFFER_MS);
    };

    if (held[b.rotate180] || wasPressedRecently(b.rotate180)) return this.rotate('180');
    if (held[b.rotateCW]  || wasPressedRecently(b.rotateCW))  return this.rotate('cw');
    if (held[b.rotateCCW] || wasPressedRecently(b.rotateCCW)) return this.rotate('ccw');
    return false;
  }

  afterSpawnInput() {
    if (this.playerId !== 1) return;

    const didIRS = this.applyInitialRotation(true);
    if (!didIRS) this.consumeRotationBuffer();
    else this.rotateBuffer = null;

    InputManager.getInstance().resetMovementOnSpawn();
  }

  isValidPosition(x, y, rot) {
    if (!this.currentPiece) return false;
    const shape = SHAPES[this.currentPiece].shape[rot];
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        const nx = x + c, ny = y + r;
        if (nx < 0 || nx >= COLS || ny >= ROWS) return false;
        if (ny >= 0 && this.board[ny][nx]) return false;
      }
    }
    return true;
  }

  rotate(direction) {
    if (!this.currentPiece) return false;

    const lockDelayExpired = this.isTouchingGround &&
      (this.lockDelayTimer >= this.lockDelay || this.lockResetCount >= this.maxLockResets);

    if ((!this.spawnGrace || this.spawnGraceUsed) && lockDelayExpired) return false;

    const oldR = this.currentRotation;
    let newR = oldR;
    if (direction === 'cw') newR = (oldR + 1) % 4;
    else if (direction === 'ccw') newR = (oldR + 3) % 4;
    else newR = (oldR + 2) % 4;

    const kickTable = this.currentPiece === 'I' ? KICK_TABLE.I :
      this.currentPiece === 'O' ? KICK_TABLE.O : KICK_TABLE.JLSTZ;

    const kickKey = `${ROTATION_STATES[oldR]}->${ROTATION_STATES[newR]}`;
    const kicks = kickTable[kickKey] || [[0, 0]];

    for (const [dx, dy] of kicks) {
      if (this.isValidPosition(this.currentX + dx, this.currentY - dy, newR)) {
        this.currentX += dx;
        this.currentY -= dy;
        this.currentRotation = newR;
        this.lastActionWasRotation = true;
        this.pieceInputCount += 1;

        if (this.spawnGrace) this.spawnGraceUsed = true;

        if (this.isTouchingGround && this.lockResetCount < this.maxLockResets) {
          this.lockDelayTimer = 0;
          this.lockResetCount++;
        }
        SFX.play('rotate');
        return true;
      }
    }
    return false;
  }

  move(dx) {
    if (this.isValidPosition(this.currentX + dx, this.currentY, this.currentRotation)) {
      this.currentX += dx;
      this.lastActionWasRotation = false;
      this.pieceInputCount += 1;

      if (this.isTouchingGround && this.lockResetCount < this.maxLockResets) {
        this.lockDelayTimer = 0;
        this.lockResetCount++;
      }
      return true;
    }
    return false;
  }

  setSoftDropActive(active) { this.softDropActive = active; }

  hardDrop() {
    return this.hardDropAndSpawn();
  }

  performHardDropLock() {
    if (!this.currentPiece) return false;
    while (this.isValidPosition(this.currentX, this.currentY + 1, this.currentRotation)) {
      this.currentY++;
    }
    this.pieceInputCount += 1;

    const locked = this.lockPiece();
    if (!locked) return false;

    SFX.play('harddrop');
    return true;
  }

  hardDropAndSpawn() {
    const dropped = this.performHardDropLock();
    if (!dropped) return false;

    // Spawn next; if blocked, game over
    return this.spawnPiece();
  }



  lockPiece() {
    if (!this.currentPiece) return false;

    const pieceType = this.currentPiece;
    const pieceX = this.currentX;
    const pieceY = this.currentY;
    const pieceRotation = this.currentRotation;

    const shape = SHAPES[this.currentPiece].shape[this.currentRotation];
    const toPlace = [];
    let lockedAbove = false;

    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;

        const by = this.currentY + r;
        const bx = this.currentX + c;

        if (by < 0) { lockedAbove = true; continue; }
        if (this.board[by][bx]) return false;

        toPlace.push([bx, by]);
      }
    }

    if (lockedAbove) return false;

    for (const [bx, by] of toPlace) {
      this.board[by][bx] = this.currentPiece;
    }

    SFX.play('lock');

    if (this.playerId === 1) {
      InputManager.getInstance().consumeRotationInputs();
    }

    this.piecesPlaced++;
    this.dcdTimer = GameSettings.getInstance().dcd;
    const extraInputs = Math.max(0, this.pieceInputCount - 6);
    if (extraInputs > 0) this.finesseErrors += extraInputs;

    this.lockDelayTimer = 0;
    this.lockResetCount = 0;
    this.isTouchingGround = false;

    this.rotateBuffer = null;

    const isSpin = this.checkSpin(pieceType, pieceX, pieceY, pieceRotation);
    this.clearLines(pieceType, isSpin);
    return true;
  }

  checkSpin(pieceType, x, y, rotation) {
    if (pieceType === 'T' && this.lastActionWasRotation) {
      return this.checkTSpin(x, y);
    }
    return false;
  }

  checkTSpin(x, y) {
    const corners = [[x, y], [x + 2, y], [x, y + 2], [x + 2, y + 2]];
    let filled = 0;
    for (const [cx, cy] of corners) {
      if (cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS || this.board[cy][cx]) filled++;
    }
    return filled >= 3;
  }

  calculateAttack(lines, isSpin, isAllClear, pieceType) {
    if (isAllClear) return (lines === 4) ? 10 : 8;

    if (pieceType === 'T' && isSpin) {
      const spinAttack = [0, 2, 4, 6];
      return spinAttack[lines] || 0;
    }

    if (isSpin) return lines;

    const attackTable = [0, 0, 1, 2, 4];
    return attackTable[lines] || 0;
  }

  handleGarbageCanceling(attack) {
    if (this.pendingGarbage.length === 0) return attack;

    const totalPending = this.pendingGarbage.reduce((sum, g) => sum + g.lines, 0);

    if (attack >= totalPending) {
      attack -= totalPending;
      this.pendingGarbage = [];
      SFX.play('garbage_apply');

    ChatManager.addMessage(`Canceled ${totalPending} garbage lines!`, 'System');
    } else {
      let remaining = attack;
      this.pendingGarbage = this.pendingGarbage.filter(g => {
        if (remaining >= g.lines) {
          remaining -= g.lines;
          return false;
        } else if (remaining > 0) {
          g.lines -= remaining;
          remaining = 0;
          return true;
        }
        return true;
      });
      ChatManager.addMessage(`Canceled ${attack} garbage lines!`, 'System');
      attack = 0;
    }

    return attack;
  }

  getNextGarbageHole(strength = 1) {
    const JUMP_CHANCE = 0.01;
    const TURN_CHANCE = 0.20;
    const STOP_CHANCE = 0.08;
    const DOUBLE_STEP_CHANCE = 0.25;

    const strengthBonus = Math.min(0.25, 0.03 * Math.max(0, strength - 1));

    if (this.rng.next() < (JUMP_CHANCE + strengthBonus * 0.25)) {
      this.garbageHole = this.rng.nextInt(COLS);
      this.garbageVel = 0;
      return this.garbageHole;
    }

    if (this.garbageVel === 0) {
      this.garbageVel = (this.rng.next() < 0.5) ? -1 : 1;
    } else {
      if (this.rng.next() < (STOP_CHANCE * (1 - strengthBonus))) {
        this.garbageVel = 0;
      } else if (this.rng.next() < (TURN_CHANCE * (1 + strengthBonus))) {
        this.garbageVel *= -1;
      }
    }

    if (this.garbageVel === 0) {
      this.garbageVel = (this.rng.next() < 0.5) ? -1 : 1;
    }

    let step = this.garbageVel;
    if (this.rng.next() < (DOUBLE_STEP_CHANCE + strengthBonus)) step *= 2;

    let next = this.garbageHole + step;

    if (next < 0) {
      next = 0;
      this.garbageVel = 1;
    } else if (next >= COLS) {
      next = COLS - 1;
      this.garbageVel = -1;
    }

    this.garbageHole = next;
    return this.garbageHole;
  }

  getPendingGarbageTotal() {
    return this.pendingGarbage.reduce((sum, g) => sum + (Number(g.lines) || 0), 0);
  }

  getPendingGarbagePreview(limit = 5) {
    const safeLimit = Math.max(1, Number(limit) || 5);
    return this.pendingGarbage
      .slice(0, safeLimit)
      .map((g) => Math.max(0, Number(g.lines) || 0))
      .filter((n) => n > 0);
  }

  emitCombatEvent(type, payload = {}) {
    if (typeof this.onCombatEvent !== 'function') return;
    this.onCombatEvent({ type, playerId: this.playerId, ...payload });
  }

  clearLines(lastPiece, isSpin) {
    const clearedRows = [];
    for (let row = 0; row < ROWS; row++) {
      if (this.board[row].every(cell => cell !== 0)) clearedRows.push(row);
    }

    const linesCleared = clearedRows.length;
    if (linesCleared > 0) {
      this.linesClearedTotal += linesCleared;
      SFX.play('line', linesCleared);
      for (let i = clearedRows.length - 1; i >= 0; i--) {
        this.board.splice(clearedRows[i], 1);
      }
      for (let i = 0; i < linesCleared; i++) {
        this.board.unshift(Array(COLS).fill(0));
      }

      const isAllClear = this.board.every(r => r.every(cell => cell === 0));
      let attack = this.calculateAttack(linesCleared, isSpin, isAllClear, lastPiece);

      const isB2BMove = (linesCleared === 4) || isSpin;
      let b2bBonus = false;
      if (isB2BMove) {
        if (this.lastClearWasB2B) {
          this.b2bCounter++;
          attack += 1;
          b2bBonus = true;
        } else {
          this.b2bCounter = 1;
        }
        this.lastClearWasB2B = true;
      } else {
        this.b2bCounter = 0;
        this.lastClearWasB2B = false;
      }

      this.comboCounter++;
      if (this.comboCounter >= 4) attack += 1;

      const attackBeforeCancel = attack;
      attack = this.handleGarbageCanceling(attack);
      const canceled = Math.max(0, attackBeforeCancel - attack);

      this.attacksSent += attack;
      if (attack > 0) {
        if (typeof this.onAttackSend === 'function') {
          this.onAttackSend(attack, this.roundId);
        } else {
          NetworkManager.getInstance().sendAttack(attack, this.roundId);
        }
      }
      this.emitCombatEvent('clear', {
        linesCleared,
        attackSent: attack,
        canceled,
        combo: Math.max(0, this.comboCounter),
        b2bBonus,
        isSpin: !!isSpin,
        piece: lastPiece,
        isAllClear: !!isAllClear,
      });
    } else {
      this.comboCounter = -1;
      if (this.pendingGarbage.length > 0) this.applyGarbage();
    }

    this.updateStats();
  }

  receiveAttack(lines) {
    const safe = Math.max(0, Math.min(10, Number(lines) || 0));
    if (safe === 0) return;

    const hole = this.getNextGarbageHole(safe);
    this.pendingGarbage.push({ lines: safe, hole });
    SFX.play('garbage_in');
    this.emitCombatEvent('incomingGarbage', {
      lines: safe,
      totalPending: this.getPendingGarbageTotal(),
    });
    this.updateStats();
  }

  applyGarbage() {
    if (this.pendingGarbage.length === 0) return;

    let remainingCap = GARBAGE_APPLY_CAP;
    let appliedTotal = 0;

    while (this.pendingGarbage.length > 0 && remainingCap > 0) {
      const g = this.pendingGarbage[0];
      const take = Math.min(g.lines, remainingCap);
      appliedTotal += take;

      for (let i = 0; i < take && i < ROWS; i++) this.board.shift();

      const hole = g.hole;
      for (let i = 0; i < take; i++) {
        const line = Array(COLS).fill('G');
        line[hole] = 0;
        this.board.push(line);
      }

      g.lines -= take;
      remainingCap -= take;

      if (g.lines <= 0) this.pendingGarbage.shift();
    }

    ChatManager.addMessage(
      `Applied garbage (cap ${GARBAGE_APPLY_CAP}). Pending: ${this.pendingGarbage.reduce((s,x)=>s+x.lines,0)}`,
      'System'
    );

    if (appliedTotal > 0) {
      this.emitCombatEvent('garbageApplied', {
        lines: appliedTotal,
        totalPending: this.getPendingGarbageTotal(),
      });
    }
  }

  holdCurrentPiece() {
    if (!this.canHold || !this.currentPiece) return false;

    if (this.holdPiece === null) {
      this.holdPiece = this.currentPiece;
const ok = this.spawnPiece();
if (!ok) return false;

    } else {
      const temp = this.holdPiece;
      this.holdPiece = this.currentPiece;
      this.resetPieceState(temp);
if (!this.isValidPosition(this.currentX, this.currentY, this.currentRotation)) return false;
this.afterSpawnInput();

    }

    this.canHold = false;
    SFX.play('hold');
    return true;
  }

  update(deltaTime) {
    if (!this.currentPiece) return true;

    this.consumeRotationBuffer();

    if (this.dcdTimer > 0) this.dcdTimer -= deltaTime;

    const wasTouching = this.isTouchingGround;
    this.isTouchingGround = !this.isValidPosition(
      this.currentX,
      this.currentY + 1,
      this.currentRotation
    );

    if (this.isTouchingGround && !wasTouching) {
      this.lockDelayTimer = 0;
      this.lastGravityTime = 0;
    }

    this.lastGravityTime += deltaTime;

    if (this.isTouchingGround) {
      this.lockDelayTimer += deltaTime;

      if (this.lockDelayTimer >= this.lockDelay || this.lockResetCount >= this.maxLockResets) {
        const ok = this.lockPiece();
        if (!ok) return false;

        const spawned = this.spawnPiece();
if (!spawned) return false; // TOP OUT
this.lastGravityTime = 0;

      }
    } else {
      const settings = GameSettings.getInstance();
      let fallInterval = this.gravity;

      if (this.softDropActive) {
        if (settings.sdf === 'inf') {
          while (this.isValidPosition(this.currentX, this.currentY + 1, this.currentRotation)) {
            this.currentY++;
          }
          this.lastGravityTime = 0;
        } else {
          const sdfNum = Number(settings.sdf);
          const safeSdf = Number.isFinite(sdfNum) ? Math.max(1, sdfNum) : 1;
          fallInterval = this.gravity / safeSdf;
        }
      }

      if (!Number.isFinite(fallInterval) || fallInterval <= 0) {
        console.warn('Bad fallInterval; forcing default', { fallInterval, sdf: settings.sdf });
        fallInterval = this.gravity;
      }

      if (this.lastGravityTime >= fallInterval) {
        while (this.lastGravityTime >= fallInterval) {
          if (this.isValidPosition(this.currentX, this.currentY + 1, this.currentRotation)) {
            this.currentY++;
          } else {
            break;
          }
          this.lastGravityTime -= fallInterval;
        }
      }
    }

    if (this.spawnGrace) this.spawnGrace = false;
    return true;
  }

  updateStats() {
    const elapsed = (Date.now() - this.gameStartTime) / 1000;
    const pps = this.piecesPlaced / Math.max(0.001, elapsed);
    const apm = (this.attacksSent / Math.max(0.001, elapsed)) * 60;
    const pending = this.getPendingGarbageTotal();

    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };

    setText(`pps${this.playerId}`, pps.toFixed(2));
    setText(`apm${this.playerId}`, apm.toFixed(2));
    setText(`b2b${this.playerId}`, this.b2bCounter.toString());
    setText(`combo${this.playerId}`, Math.max(0, this.comboCounter).toString());
    setText(`incoming${this.playerId}`, String(pending));

    const meter = document.getElementById(`incomingMeterFill${this.playerId}`);
    if (meter) {
      const pct = Math.max(0, Math.min(100, (pending / 20) * 100));
      meter.style.width = `${pct}%`;
    }

    const queue = document.getElementById(`incomingQueue${this.playerId}`);
    if (queue) {
      const preview = this.getPendingGarbagePreview(6);
      const suffix = this.pendingGarbage.length > preview.length ? ' +...' : '';
      queue.textContent = preview.length > 0 ? `Queue: ${preview.join('+')}${suffix}` : 'Queue: -';
    }
  }

  draw() {
    this.renderer.drawBoard(this.board);

    if (this.currentPiece) {
      let ghostY = this.currentY;
      while (this.isValidPosition(this.currentX, ghostY + 1, this.currentRotation)) ghostY++;
      this.renderer.drawGhostPiece(this.currentPiece, this.currentX, ghostY, this.currentRotation);
      this.renderer.drawPiece(this.currentPiece, this.currentX, this.currentY, this.currentRotation, 1);
    }

    this.renderer.drawHold(this.holdPiece);
    this.renderer.drawQueue(this.queue);
  }

  getState() {
    return {
      board: this.board.map(row => [...row]),
      currentPiece: this.currentPiece,
      currentX: this.currentX,
      currentY: this.currentY,
      currentRotation: this.currentRotation,
      holdPiece: this.holdPiece,
      queue: [...this.queue],
      piecesPlaced: this.piecesPlaced,
      attacksSent: this.attacksSent,
      linesClearedTotal: this.linesClearedTotal,
      finesseErrors: this.finesseErrors,
      b2bCounter: this.b2bCounter,
      comboCounter: this.comboCounter,
      pendingGarbage: this.pendingGarbage.map((g) => ({
        lines: Math.max(0, Math.min(10, Number(g.lines) || 0)),
        hole: Math.max(0, Math.min(COLS - 1, Number(g.hole) || 0)),
      })),
    };
  }

  setState(state) {
    this.board = state.board.map(row => [...row]);
    this.currentPiece = state.currentPiece;
    this.currentX = state.currentX;
    this.currentY = state.currentY;
    this.currentRotation = state.currentRotation;
    this.holdPiece = state.holdPiece;
    this.queue = [...state.queue];
    this.piecesPlaced = state.piecesPlaced;
    this.attacksSent = state.attacksSent;
    this.linesClearedTotal = Math.max(0, Number(state.linesClearedTotal) || 0);
    this.finesseErrors = Math.max(0, Number(state.finesseErrors) || 0);
    this.b2bCounter = state.b2bCounter;
    this.comboCounter = state.comboCounter;
    if (Array.isArray(state.pendingGarbage)) {
      this.pendingGarbage = state.pendingGarbage
        .map((g) => ({
          lines: Math.max(0, Math.min(10, Number(g?.lines) || 0)),
          hole: Math.max(0, Math.min(COLS - 1, Number(g?.hole) || 0)),
        }))
        .filter((g) => g.lines > 0);
    } else {
      this.pendingGarbage = [];
    }

    this.updateStats();
  }

  setGameStartTime(t) { this.gameStartTime = t; }

  setRoundId(roundId) {
    const cleaned = (typeof roundId === 'string') ? roundId.trim() : '';
    this.roundId = cleaned || null;
  }

  setCombatEventHandler(handler) {
    this.onCombatEvent = (typeof handler === 'function') ? handler : null;
  }

  setAttackHandler(handler) {
    this.onAttackSend = (typeof handler === 'function') ? handler : null;
  }
}
