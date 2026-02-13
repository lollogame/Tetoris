'use strict';

/* =========================================================
   Bot Controller (heuristic, configurable)
========================================================= */
class TetrisBot {
  constructor(gameState, config = {}) {
    this.gameState = gameState;
    this.elapsedMs = 0;
    this.nextActionDelayMs = 0;
    this.configure(config);
    this._scheduleNextAction(true);
  }

  configure(config = {}) {
    const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
    this.pps = Math.max(0.4, Math.min(6, num(config.pps, 1.6)));
    this.aggression = Math.max(0, Math.min(100, num(config.aggression, 65)));
    this.mistakeChance = Math.max(0, Math.min(100, num(config.mistakeChance, 8))) / 100;
    this.thinkJitterMs = Math.max(0, Math.min(400, num(config.thinkJitterMs, 85)));
  }

  update(deltaTimeMs) {
    if (!this.gameState || !this.gameState.currentPiece) return true;
    this.elapsedMs += Math.max(0, Number(deltaTimeMs) || 0);

    if (this.elapsedMs < this.nextActionDelayMs) return true;
    this.elapsedMs = 0;

    const plan = this._choosePlacement();
    const ok = this._executePlacement(plan);
    this._scheduleNextAction(false);
    return ok;
  }

  _scheduleNextAction(isFirst) {
    const base = 1000 / Math.max(0.1, this.pps);
    const jitter = this.thinkJitterMs > 0
      ? ((Math.random() * 2 - 1) * this.thinkJitterMs)
      : 0;
    const startup = isFirst ? 120 : 0;
    this.nextActionDelayMs = Math.max(30, base + jitter + startup);
  }

  _shapeFor(piece, rot) {
    return SHAPES[piece].shape[rot % 4];
  }

  _canPlace(board, piece, rot, x, y) {
    const shape = this._shapeFor(piece, rot);
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
  }

  _dropY(board, piece, rot, x) {
    let y = SPAWN_ROW;
    if (!this._canPlace(board, piece, rot, x, y)) return null;
    while (this._canPlace(board, piece, rot, x, y + 1)) y++;
    return y;
  }

  _cloneBoard(board) {
    return board.map((row) => row.slice());
  }

  _simulatePlacement(board, piece, rot, x, y) {
    const sim = this._cloneBoard(board);
    const shape = this._shapeFor(piece, rot);
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
  }

  _analyzeBoard(board) {
    const heights = Array(COLS).fill(0);
    let holes = 0;

    for (let c = 0; c < COLS; c++) {
      let seenBlock = false;
      for (let r = 0; r < ROWS; r++) {
        const filled = board[r][c] !== 0;
        if (filled && !seenBlock) {
          heights[c] = ROWS - r;
          seenBlock = true;
        } else if (!filled && seenBlock) {
          holes++;
        }
      }
    }

    let bumpiness = 0;
    for (let c = 0; c < COLS - 1; c++) {
      bumpiness += Math.abs(heights[c] - heights[c + 1]);
    }

    const aggregateHeight = heights.reduce((a, b) => a + b, 0);
    return { aggregateHeight, holes, bumpiness };
  }

  _scorePlacement(linesCleared, analysis) {
    const aggr = this.aggression / 100;
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
  }

  _choosePlacement() {
    const gs = this.gameState;
    if (!gs || !gs.currentPiece) return null;

    const piece = gs.currentPiece;
    const board = gs.board;
    const candidates = [];

    for (let rot = 0; rot < 4; rot++) {
      const shape = this._shapeFor(piece, rot);
      const width = shape[0].length;
      const minX = -2;
      const maxX = COLS - width + 2;

      for (let x = minX; x <= maxX; x++) {
        const y = this._dropY(board, piece, rot, x);
        if (y == null) continue;

        const sim = this._simulatePlacement(board, piece, rot, x, y);
        if (!sim) continue;

        const analysis = this._analyzeBoard(sim.board);
        const score = this._scorePlacement(sim.linesCleared, analysis);
        candidates.push({ x, y, rot, score });
      }
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score - a.score);

    if (Math.random() < this.mistakeChance) {
      const pool = candidates.slice(0, Math.min(6, candidates.length));
      return pool[Math.floor(Math.random() * pool.length)];
    }

    return candidates[0];
  }

  _executePlacement(plan) {
    const gs = this.gameState;
    if (!gs || !gs.currentPiece) return true;

    if (!plan) {
      return gs.hardDropAndSpawn();
    }

    gs.currentRotation = plan.rot;
    gs.currentX = plan.x;
    gs.currentY = plan.y;

    const locked = gs.lockPiece();
    if (!locked) {
      return gs.hardDropAndSpawn();
    }
    return gs.spawnPiece();
  }
}

if (typeof globalThis !== 'undefined') {
  globalThis.TetrisBot = TetrisBot;
}
