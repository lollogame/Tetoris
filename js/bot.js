'use strict';

/* =========================================================
   Bot Controller (heuristic, configurable)
========================================================= */
class TetrisBot {
  constructor(gameState, config = {}) {
    this.gameState = gameState;
    this.elapsedMs = 0;
    this.nextActionDelayMs = 0;
    this.lookaheadTop = 18;
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
    const def = SHAPES[piece];
    if (!def || !def.shape) return null;
    return def.shape[rot % 4];
  }

  _canPlace(board, piece, rot, x, y) {
    const shape = this._shapeFor(piece, rot);
    if (!shape) return false;
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

  _placePiece(board, piece, rot, x, y) {
    const sim = this._cloneBoard(board);
    const shape = this._shapeFor(piece, rot);
    if (!shape) return null;
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        const nx = x + c;
        const ny = y + r;
        if (ny < 0 || nx < 0 || nx >= COLS || ny >= ROWS) return null;
        sim[ny][nx] = piece;
      }
    }
    return sim;
  }

  _clearFullLines(board) {
    const sim = this._cloneBoard(board);
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

  _isAllClear(board) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (board[r][c] !== 0) return false;
      }
    }
    return true;
  }

  _isTSpin(preClearBoard, piece, x, y, linesCleared) {
    if (piece !== 'T') return false;
    if (linesCleared <= 0) return false;

    const corners = [
      [x, y],
      [x + 2, y],
      [x, y + 2],
      [x + 2, y + 2],
    ];

    let filled = 0;
    for (const [cx, cy] of corners) {
      if (cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS) {
        filled++;
      } else if (preClearBoard[cy][cx] !== 0) {
        filled++;
      }
    }
    return filled >= 3;
  }

  _estimateAttack(piece, linesCleared, isSpin, isAllClear, preB2B, preCombo) {
    if (linesCleared <= 0) {
      return {
        attack: 0,
        postB2B: 0,
        postCombo: -1,
        b2bBonus: false,
      };
    }

    let attack = 0;
    if (isAllClear) {
      attack = (linesCleared === 4) ? 10 : 8;
    } else if (piece === 'T' && isSpin) {
      attack = [0, 2, 4, 6][linesCleared] || 0;
    } else if (isSpin) {
      attack = linesCleared;
    } else {
      attack = [0, 0, 1, 2, 4][linesCleared] || 0;
    }

    const b2bChainActive = Number(preB2B) > 0;
    const isB2BMove = (linesCleared === 4) || isSpin;
    let postB2B = 0;
    let b2bBonus = false;
    if (isB2BMove) {
      postB2B = b2bChainActive ? (Number(preB2B) + 1) : 1;
      if (b2bChainActive) {
        attack += 1;
        b2bBonus = true;
      }
    }

    const postCombo = (Number(preCombo) || 0) + 1;
    if (postCombo >= 4) attack += 1;

    return {
      attack,
      postB2B,
      postCombo,
      b2bBonus,
    };
  }

  _analyzeBoard(board) {
    const heights = Array(COLS).fill(0);
    let holes = 0;
    let coveredHoles = 0;

    for (let c = 0; c < COLS; c++) {
      let seenBlock = false;
      for (let r = 0; r < ROWS; r++) {
        const filled = board[r][c] !== 0;
        if (filled && !seenBlock) {
          heights[c] = ROWS - r;
          seenBlock = true;
        } else if (!filled && seenBlock) {
          holes++;
        } else if (filled && seenBlock) {
          coveredHoles++;
        }
      }
    }

    let bumpiness = 0;
    for (let c = 0; c < COLS - 1; c++) {
      bumpiness += Math.abs(heights[c] - heights[c + 1]);
    }

    const aggregateHeight = heights.reduce((a, b) => a + b, 0);
    const maxHeight = Math.max(...heights);
    return {
      aggregateHeight,
      holes,
      coveredHoles,
      bumpiness,
      maxHeight,
    };
  }

  _scorePlacement(sim, analysis, attackInfo, context) {
    const aggr = this.aggression / 100;
    const pendingGarbage = Math.max(0, Number(context.pendingGarbage) || 0);
    const danger = Math.max(0, (analysis.maxHeight - 11) / 8) + (pendingGarbage / 10);

    const attackWeight = 22 + (aggr * 30) + (danger * 9);
    const clearWeight = 3 + (aggr * 5);
    const tspinWeight = 12 + (aggr * 16);
    const b2bWeight = 4 + (aggr * 8);
    const comboWeight = 2 + (aggr * 4);
    const allClearWeight = 90;

    const holePenalty = 10 - (aggr * 2) + (danger * 4);
    const coveredHolePenalty = 1.1 + (danger * 0.2);
    const heightPenalty = 0.35 + ((1 - aggr) * 0.16) + (danger * 0.22);
    const bumpPenalty = 0.24 + (danger * 0.12);
    const maxHeightPenalty = 0.9 + (danger * 0.85);

    let score = 0;
    score += (attackInfo.attack * attackWeight);
    score += (sim.linesCleared * clearWeight);
    if (sim.isTSpin) score += tspinWeight;
    if (attackInfo.b2bBonus) score += b2bWeight;
    if (attackInfo.postCombo > 0) score += Math.min(6, attackInfo.postCombo) * comboWeight;
    if (sim.isAllClear) score += allClearWeight;

    score -= (analysis.holes * holePenalty);
    score -= (analysis.coveredHoles * coveredHolePenalty);
    score -= (analysis.aggregateHeight * heightPenalty);
    score -= (analysis.bumpiness * bumpPenalty);
    score -= (analysis.maxHeight * maxHeightPenalty);

    if (pendingGarbage > 0 && sim.linesCleared === 0) score -= 18;
    if (analysis.maxHeight >= 18) score -= 120;

    return score;
  }

  _generateCandidates(board, piece, options = {}) {
    if (!piece || !SHAPES[piece]) return [];

    const preCombo = Number.isFinite(Number(options.preCombo)) ? Number(options.preCombo) : -1;
    const preB2B = Number.isFinite(Number(options.preB2B)) ? Number(options.preB2B) : 0;
    const pendingGarbage = Math.max(0, Number(options.pendingGarbage) || 0);
    const useHold = options.useHold === true;

    const out = [];
    for (let rot = 0; rot < 4; rot++) {
      const shape = this._shapeFor(piece, rot);
      if (!shape) continue;

      const width = shape[0].length;
      const minX = -2;
      const maxX = COLS - width + 2;

      for (let x = minX; x <= maxX; x++) {
        const y = this._dropY(board, piece, rot, x);
        if (y == null) continue;

        const preClearBoard = this._placePiece(board, piece, rot, x, y);
        if (!preClearBoard) continue;

        const cleared = this._clearFullLines(preClearBoard);
        const isAllClear = this._isAllClear(cleared.board);
        const isTSpin = this._isTSpin(preClearBoard, piece, x, y, cleared.linesCleared);
        const attackInfo = this._estimateAttack(piece, cleared.linesCleared, isTSpin, isAllClear, preB2B, preCombo);
        const analysis = this._analyzeBoard(cleared.board);
        const score = this._scorePlacement(
          { linesCleared: cleared.linesCleared, isTSpin, isAllClear },
          analysis,
          attackInfo,
          { pendingGarbage }
        );

        out.push({
          piece,
          useHold,
          x,
          y,
          rot,
          score,
          totalScore: score,
          attack: attackInfo.attack,
          linesCleared: cleared.linesCleared,
          isTSpin,
          isAllClear,
          postCombo: attackInfo.postCombo,
          postB2B: attackInfo.postB2B,
          lastActionWasRotation: (piece === 'T') && (isTSpin || rot !== 0),
          boardAfter: cleared.board,
        });
      }
    }

    out.sort((a, b) => b.score - a.score);
    return out;
  }

  _getNextPieceAfterFirstMove(useHold, currentHoldPiece, queue) {
    if (!Array.isArray(queue) || queue.length === 0) return null;
    if (!useHold) return queue[0] || null;
    if (currentHoldPiece) return queue[0] || null;
    return queue[1] || queue[0] || null;
  }

  _choosePlacement() {
    const gs = this.gameState;
    if (!gs || !gs.currentPiece) return null;

    const board = gs.board;
    const queue = Array.isArray(gs.queue) ? gs.queue : [];
    const preCombo = Number.isFinite(Number(gs.comboCounter)) ? Number(gs.comboCounter) : -1;
    const preB2B = Number.isFinite(Number(gs.b2bCounter)) ? Number(gs.b2bCounter) : 0;
    const pendingGarbage = (typeof gs.getPendingGarbageTotal === 'function')
      ? Math.max(0, Number(gs.getPendingGarbageTotal()) || 0)
      : 0;

    const candidates = [];
    candidates.push(
      ...this._generateCandidates(board, gs.currentPiece, {
        useHold: false,
        preCombo,
        preB2B,
        pendingGarbage,
      })
    );

    if (gs.canHold) {
      const holdPieceCandidate = gs.holdPiece || (queue[0] || null);
      if (holdPieceCandidate) {
        candidates.push(
          ...this._generateCandidates(board, holdPieceCandidate, {
            useHold: true,
            preCombo,
            preB2B,
            pendingGarbage,
          })
        );
      }
    }

    if (candidates.length === 0) return null;

    const aggr = this.aggression / 100;
    const lookaheadWeight = 0.52 + (aggr * 0.22);
    const topEvalCount = Math.min(this.lookaheadTop, candidates.length);
    for (let i = 0; i < topEvalCount; i++) {
      const cand = candidates[i];
      let total = cand.score;

      const nextPiece = this._getNextPieceAfterFirstMove(cand.useHold, gs.holdPiece, queue);
      if (nextPiece && SHAPES[nextPiece]) {
        const nextPending = Math.max(0, pendingGarbage - cand.attack);
        const nextCandidates = this._generateCandidates(cand.boardAfter, nextPiece, {
          useHold: false,
          preCombo: cand.postCombo,
          preB2B: cand.postB2B,
          pendingGarbage: nextPending,
        });
        if (nextCandidates.length > 0) {
          total += nextCandidates[0].score * lookaheadWeight;
          total += nextCandidates[0].attack * (6 + (aggr * 8));
        }
      }

      total += cand.attack * (10 + (aggr * 12));
      cand.totalScore = total;
    }

    for (let i = topEvalCount; i < candidates.length; i++) {
      candidates[i].totalScore = candidates[i].score;
    }

    candidates.sort((a, b) => b.totalScore - a.totalScore);

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

    if (plan.useHold) {
      const held = gs.holdCurrentPiece();
      if (!held) return gs.hardDropAndSpawn();
      if (!gs.currentPiece) return false;
    }

    if (plan.piece && gs.currentPiece !== plan.piece) {
      return gs.hardDropAndSpawn();
    }

    if (!gs.isValidPosition(plan.x, plan.y, plan.rot)) {
      return gs.hardDropAndSpawn();
    }

    const didRotate = (plan.rot !== gs.currentRotation);
    gs.lastActionWasRotation = (gs.currentPiece === 'T') && (didRotate || !!plan.lastActionWasRotation);
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
