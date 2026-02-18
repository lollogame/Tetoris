'use strict';

/* =========================================================
   Bot Controller (heuristic, configurable)
========================================================= */
class TetrisBot {
  constructor(gameState, config = {}) {
    this.gameState = gameState;
    this.elapsedMs = 0;
    this.nextActionDelayMs = 0;
    this.lookaheadTop = 28;
    this.configure(config);
    this._scheduleNextAction(true);
  }

  configure(config = {}) {
    const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
    this.pps = Math.max(0.4, Math.min(6, num(config.pps, 2.4)));
    this.aggression = Math.max(0, Math.min(100, num(config.aggression, 74)));
    this.mistakeChance = Math.max(0, Math.min(100, num(config.mistakeChance, 2))) / 100;
    this.thinkJitterMs = Math.max(0, Math.min(400, num(config.thinkJitterMs, 35)));
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
    const danger = this._getCurrentDanger();
    const pressureBoost = 1 + Math.min(1.15, danger * 0.55);
    const effectivePps = Math.max(0.1, this.pps * pressureBoost);
    const base = 1000 / effectivePps;
    const jitterScale = Math.max(0.2, 1 - Math.min(0.75, danger * 0.35));
    const jitter = this.thinkJitterMs > 0
      ? ((Math.random() * 2 - 1) * this.thinkJitterMs * jitterScale)
      : 0;
    const startup = isFirst ? 90 : 0;
    this.nextActionDelayMs = Math.max(22, base + jitter + startup);
  }

  _getCurrentDanger() {
    const gs = this.gameState;
    if (!gs || !Array.isArray(gs.board)) return 0;

    const analysis = this._analyzeBoard(gs.board);
    const pendingGarbage = (typeof gs.getPendingGarbageTotal === 'function')
      ? Math.max(0, Number(gs.getPendingGarbageTotal()) || 0)
      : 0;

    return this._dangerLevel(analysis, pendingGarbage);
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

  _countRowTransitions(board) {
    let transitions = 0;
    for (let r = 0; r < ROWS; r++) {
      let prevFilled = 1; // left wall
      for (let c = 0; c < COLS; c++) {
        const curFilled = board[r][c] ? 1 : 0;
        if (curFilled !== prevFilled) transitions++;
        prevFilled = curFilled;
      }
      if (prevFilled === 0) transitions++; // right wall
    }
    return transitions;
  }

  _countColumnTransitions(board) {
    let transitions = 0;
    for (let c = 0; c < COLS; c++) {
      let prevFilled = 1; // top boundary
      for (let r = 0; r < ROWS; r++) {
        const curFilled = board[r][c] ? 1 : 0;
        if (curFilled !== prevFilled) transitions++;
        prevFilled = curFilled;
      }
      if (prevFilled === 0) transitions++; // floor
    }
    return transitions;
  }

  _countWells(board) {
    let wellCells = 0;
    let deepestWell = 0;

    for (let c = 0; c < COLS; c++) {
      let depth = 0;
      for (let r = 0; r < ROWS; r++) {
        if (board[r][c]) {
          depth = 0;
          continue;
        }
        const leftFilled = (c === 0) || !!board[r][c - 1];
        const rightFilled = (c === COLS - 1) || !!board[r][c + 1];
        if (leftFilled && rightFilled) {
          depth++;
          wellCells += depth;
          if (depth > deepestWell) deepestWell = depth;
        } else {
          depth = 0;
        }
      }
    }

    return { wellCells, deepestWell };
  }

  _dangerLevel(analysis, pendingGarbage = 0) {
    const fromHeight = Math.max(0, analysis.maxHeight - 9) / 10;
    const fromHoles = Math.max(0, analysis.holes - 1) / 6;
    const fromGarbage = Math.max(0, Number(pendingGarbage) || 0) / 12;
    return Math.max(0, Math.min(2.5, fromHeight + fromHoles + fromGarbage));
  }

  _analyzeBoard(board) {
    const heights = Array(COLS).fill(0);
    let holes = 0;
    let holeDepth = 0;

    for (let c = 0; c < COLS; c++) {
      let seenBlock = false;
      let blocksAbove = 0;
      for (let r = 0; r < ROWS; r++) {
        const filled = board[r][c] !== 0;
        if (filled && !seenBlock) {
          heights[c] = ROWS - r;
          seenBlock = true;
          blocksAbove = 1;
        } else if (filled) {
          blocksAbove++;
        } else if (seenBlock) {
          holes++;
          holeDepth += blocksAbove;
        }
      }
    }

    let bumpiness = 0;
    for (let c = 0; c < COLS - 1; c++) {
      bumpiness += Math.abs(heights[c] - heights[c + 1]);
    }

    const aggregateHeight = heights.reduce((a, b) => a + b, 0);
    const maxHeight = Math.max(...heights);
    const rowTransitions = this._countRowTransitions(board);
    const columnTransitions = this._countColumnTransitions(board);
    const { wellCells, deepestWell } = this._countWells(board);

    return {
      aggregateHeight,
      holes,
      holeDepth,
      bumpiness,
      maxHeight,
      rowTransitions,
      columnTransitions,
      wellCells,
      deepestWell,
    };
  }

  _scorePlacement(sim, analysis, attackInfo, context) {
    const aggr = this.aggression / 100;
    const pendingGarbage = Math.max(0, Number(context.pendingGarbage) || 0);
    const pendingAfterGarbage = Math.max(0, Number(context.pendingAfterGarbage) || 0);
    const danger = this._dangerLevel(analysis, pendingAfterGarbage);

    const attackWeight = 30 + (aggr * 62) + (danger * 18);
    const clearWeight = 3 + (aggr * 5);
    const tspinWeight = 18 + (aggr * 24) + (danger * 8);
    const b2bWeight = 8 + (aggr * 12);
    const comboWeight = 2 + (aggr * 5);
    const allClearWeight = 120;

    const holePenalty = 12 - (aggr * 4) + (danger * 9);
    const holeDepthPenalty = 1.9 + (danger * 1.5);
    const heightPenalty = 0.42 + ((1 - aggr) * 0.25) + (danger * 0.38);
    const bumpPenalty = 0.30 + ((1 - aggr) * 0.18) + (danger * 0.22);
    const maxHeightPenalty = 1.2 + (danger * 1.45);
    const rowTransitionPenalty = 0.45 + (danger * 0.22);
    const colTransitionPenalty = 0.22 + (danger * 0.18);
    const wellPenalty = danger > 0.9
      ? (0.9 + danger * 0.5)
      : (0.25 + ((1 - aggr) * 0.10));

    let score = 0;
    score += (attackInfo.attack * attackWeight);
    score += (sim.linesCleared * clearWeight);
    if (sim.isTSpin) score += tspinWeight;
    if (attackInfo.b2bBonus) score += b2bWeight;
    if (attackInfo.postCombo > 0) score += Math.min(7, attackInfo.postCombo) * comboWeight;
    if (sim.isAllClear) score += allClearWeight;
    if (analysis.deepestWell >= 3 && danger < 0.75) {
      score += analysis.deepestWell * (1.8 + (aggr * 2.4));
    }
    if (pendingGarbage > pendingAfterGarbage) {
      score += (pendingGarbage - pendingAfterGarbage) * (10 + (danger * 12));
    }

    score -= (analysis.holes * holePenalty);
    score -= (analysis.holeDepth * holeDepthPenalty);
    score -= (analysis.aggregateHeight * heightPenalty);
    score -= (analysis.bumpiness * bumpPenalty);
    score -= (analysis.maxHeight * maxHeightPenalty);
    score -= (analysis.rowTransitions * rowTransitionPenalty);
    score -= (analysis.columnTransitions * colTransitionPenalty);
    score -= (analysis.wellCells * wellPenalty);

    if (pendingAfterGarbage > 0 && sim.linesCleared === 0) score -= 24 + (pendingAfterGarbage * 1.5);
    if (danger > 1.0 && sim.linesCleared > 0) score += sim.linesCleared * (8 + (danger * 9));
    if (danger > 1.25 && sim.linesCleared === 0) score -= 18 + (danger * 14);
    if (danger > 1.4 && analysis.maxHeight >= 16) score -= 90;
    if (danger > 1.7 && analysis.maxHeight >= 17) score -= 150;
    if (analysis.maxHeight >= 18) score -= 260;
    if (analysis.maxHeight >= 19) score -= 420;

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
        const pendingAfterGarbage = Math.max(0, pendingGarbage - attackInfo.attack);
        const dangerAfter = this._dangerLevel(analysis, pendingAfterGarbage);
        const score = this._scorePlacement(
          { linesCleared: cleared.linesCleared, isTSpin, isAllClear },
          analysis,
          attackInfo,
          { pendingGarbage, pendingAfterGarbage }
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
          dangerAfter,
          postCombo: attackInfo.postCombo,
          postB2B: attackInfo.postB2B,
          lastActionWasRotation: (piece === 'T') && (isTSpin || rot !== 0),
          pendingAfterGarbage,
          boardAfter: cleared.board,
        });
      }
    }

    out.sort((a, b) => b.score - a.score);
    return out;
  }

  _getQueueOffsetAfterFirstMove(useHold, currentHoldPiece) {
    if (!useHold) return 1;
    return currentHoldPiece ? 1 : 2;
  }

  _getPieceAfterFirstMove(useHold, currentHoldPiece, queue, depth = 1) {
    if (!Array.isArray(queue) || queue.length === 0) return null;
    const offset = this._getQueueOffsetAfterFirstMove(useHold, currentHoldPiece);
    const safeDepth = Math.max(1, Math.trunc(Number(depth) || 1));
    const idx = offset + safeDepth - 2;
    return queue[idx] || null;
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
    const boardNow = this._analyzeBoard(board);
    const immediateDanger = this._dangerLevel(boardNow, pendingGarbage);

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
    const lookaheadWeight = (0.60 + (aggr * 0.22)) - Math.min(0.12, immediateDanger * 0.06);
    const deepLookaheadWeight = 0.24 + (aggr * 0.12);
    const topEvalCount = Math.min(this.lookaheadTop, candidates.length);
    const deepEvalCount = Math.min(10, topEvalCount);

    for (let i = 0; i < topEvalCount; i++) {
      const cand = candidates[i];
      let total = cand.score;

      const nextPiece = this._getPieceAfterFirstMove(cand.useHold, gs.holdPiece, queue, 1);
      if (nextPiece && SHAPES[nextPiece]) {
        const nextPending = Math.max(0, cand.pendingAfterGarbage ?? (pendingGarbage - cand.attack));
        const nextCandidates = this._generateCandidates(cand.boardAfter, nextPiece, {
          useHold: false,
          preCombo: cand.postCombo,
          preB2B: cand.postB2B,
          pendingGarbage: nextPending,
        });
        if (nextCandidates.length > 0) {
          const bestNext = nextCandidates[0];
          total += bestNext.score * lookaheadWeight;
          total += bestNext.attack * (10 + (aggr * 14));

          if (i < deepEvalCount) {
            const thirdPiece = this._getPieceAfterFirstMove(cand.useHold, gs.holdPiece, queue, 2);
            if (thirdPiece && SHAPES[thirdPiece]) {
              const branchCount = Math.min(4, nextCandidates.length);
              let bestThirdScore = -Infinity;
              for (let j = 0; j < branchCount; j++) {
                const branch = nextCandidates[j];
                const thirdPending = Math.max(0, (branch.pendingAfterGarbage ?? (nextPending - branch.attack)));
                const thirdCandidates = this._generateCandidates(branch.boardAfter, thirdPiece, {
                  useHold: false,
                  preCombo: branch.postCombo,
                  preB2B: branch.postB2B,
                  pendingGarbage: thirdPending,
                });
                if (thirdCandidates.length === 0) continue;
                const bestThird = thirdCandidates[0];
                const thirdScore = bestThird.score + (bestThird.attack * (7 + (aggr * 9)));
                if (thirdScore > bestThirdScore) bestThirdScore = thirdScore;
              }
              if (Number.isFinite(bestThirdScore)) {
                total += bestThirdScore * deepLookaheadWeight;
              }
            }
          }
        }
      }

      total += cand.attack * (14 + (aggr * 16));
      if (cand.linesCleared === 0 && cand.attack === 0 && cand.dangerAfter > immediateDanger + 0.3) {
        total -= 12;
      }
      cand.totalScore = total;
    }

    for (let i = topEvalCount; i < candidates.length; i++) {
      candidates[i].totalScore = candidates[i].score;
    }

    candidates.sort((a, b) => b.totalScore - a.totalScore);

    const pressure = Math.max(immediateDanger, candidates[0]?.dangerAfter || 0);
    let effectiveMistakeChance = this.mistakeChance * (1 - (aggr * 0.75));
    effectiveMistakeChance *= (1 - Math.min(0.85, pressure * 0.55));
    effectiveMistakeChance = Math.max(0, Math.min(0.20, effectiveMistakeChance));

    if (Math.random() < effectiveMistakeChance) {
      const poolSize = pressure > 0.8 ? 2 : 3;
      const pool = candidates.slice(0, Math.min(poolSize, candidates.length));
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
