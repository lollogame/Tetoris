'use strict';

/* =========================================================
   Bot Controller (heuristic + lookahead + opener profiles)
========================================================= */
class TetrisBot {
  constructor(gameState, config = {}) {
    this.gameState = gameState;
    this.elapsedMs = 0;
    this.nextActionDelayMs = 0;
    this.preferredWell = (Math.random() < 0.5) ? 9 : 0;

    this.style = 'tempo';
    this.searchDepth = 2;
    this.beamWidth = 10;
    this.lookaheadTop = 18;
    this.lookaheadDecay = 0.66;
    this.attackBias = 1;
    this.survivalBias = 1;
    this.openerPlan = 'balanced';
    this.openingWindow = 12;

    this.configure(config);
    this._scheduleNextAction(true);
  }

  configure(config = {}) {
    const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

    this.pps = Math.max(0.4, Math.min(7, num(config.pps, 1.6)));
    this.aggression = Math.max(0, Math.min(100, num(config.aggression, 65)));
    this.mistakeChance = Math.max(0, Math.min(100, num(config.mistakeChance, 8))) / 100;
    this.thinkJitterMs = Math.max(0, Math.min(450, num(config.thinkJitterMs, 85)));

    const requestedStyle = String(config.style || '').trim().toLowerCase();
    if (requestedStyle === 'downstack' || requestedStyle === 'tempo' || requestedStyle === 'spike') {
      this.style = requestedStyle;
    } else if (this.aggression >= 74) {
      this.style = 'spike';
    } else if (this.aggression <= 34) {
      this.style = 'downstack';
    } else {
      this.style = 'tempo';
    }

    if (this.style === 'downstack') {
      this.searchDepth = 3;
      this.beamWidth = 8;
      this.lookaheadTop = 16;
      this.lookaheadDecay = 0.7;
      this.attackBias = 0.9;
      this.survivalBias = 1.25;
      this.openerPlan = 'safe_stack';
      this.openingWindow = 10;
    } else if (this.style === 'spike') {
      this.searchDepth = 3;
      this.beamWidth = 14;
      this.lookaheadTop = 24;
      this.lookaheadDecay = 0.62;
      this.attackBias = 1.45;
      this.survivalBias = 0.92;
      this.openerPlan = 'tetris_spike';
      this.openingWindow = 14;
    } else {
      this.searchDepth = 3;
      this.beamWidth = 10;
      this.lookaheadTop = 20;
      this.lookaheadDecay = 0.67;
      this.attackBias = 1.16;
      this.survivalBias = 1.05;
      this.openerPlan = 'tspin_pressure';
      this.openingWindow = 12;
    }
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
    const startup = isFirst ? 110 : 0;
    this.nextActionDelayMs = Math.max(18, base + jitter + startup);
  }

  _shapeFor(piece, rot) {
    const def = SHAPES[piece];
    if (!def || !def.shape) return null;
    return def.shape[rot % 4];
  }

  _cloneBoard(board) {
    return board.map((row) => row.slice());
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
    if (piece !== 'T' || linesCleared <= 0) return false;

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
      return { attack: 0, postB2B: 0, postCombo: -1, b2bBonus: false };
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

    const isB2BMove = (linesCleared === 4) || isSpin;
    const chainActive = Number(preB2B) > 0;
    let postB2B = 0;
    let b2bBonus = false;
    if (isB2BMove) {
      postB2B = chainActive ? (Number(preB2B) + 1) : 1;
      if (chainActive) {
        attack += 1;
        b2bBonus = true;
      }
    }

    const postCombo = (Number(preCombo) || 0) + 1;
    if (postCombo >= 4) attack += 1;

    return { attack, postB2B, postCombo, b2bBonus };
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
    return { heights, aggregateHeight, maxHeight, holes, coveredHoles, bumpiness };
  }

  _countSimpleTSlots(board) {
    let count = 0;
    for (let r = 1; r < ROWS - 1; r++) {
      for (let c = 1; c < COLS - 1; c++) {
        if (board[r][c] !== 0) continue;
        const left = board[r][c - 1] !== 0;
        const right = board[r][c + 1] !== 0;
        const below = board[r + 1][c] !== 0;
        if (!left || !right || !below) continue;

        let diag = 0;
        if (board[r - 1][c - 1] !== 0) diag++;
        if (board[r - 1][c + 1] !== 0) diag++;
        if (board[r + 1][c - 1] !== 0) diag++;
        if (board[r + 1][c + 1] !== 0) diag++;
        if (diag >= 2) count++;
      }
    }
    return Math.min(6, count);
  }

  _openerBonus(candidate, analysis, context) {
    const placed = Math.max(0, Number(context.piecesPlacedBefore) || 0);
    if (placed >= this.openingWindow) return 0;

    let bonus = 0;
    const well = this.preferredWell;
    const wellHeight = analysis.heights[well] || 0;
    let sumOther = 0;
    for (let c = 0; c < COLS; c++) {
      if (c === well) continue;
      sumOther += analysis.heights[c];
    }
    const avgOther = sumOther / Math.max(1, COLS - 1);

    if (this.openerPlan === 'tetris_spike') {
      bonus += (avgOther - wellHeight) * 2.8;
      if (candidate.linesCleared === 4) bonus += 58;
      if (candidate.attack >= 4) bonus += 18;
      if (candidate.isTSpin) bonus += 8;
    } else if (this.openerPlan === 'tspin_pressure') {
      const tSlots = this._countSimpleTSlots(candidate.boardAfter);
      bonus += tSlots * 5;
      if (candidate.isTSpin) bonus += 42;
      if (candidate.attack >= 2) bonus += 10;
      bonus += (avgOther - wellHeight) * 1.2;
    } else {
      bonus += (candidate.linesCleared >= 2) ? 10 : 0;
      bonus -= analysis.holes * 1.5;
      bonus += (avgOther - wellHeight) * 1.3;
    }

    return bonus;
  }

  _scorePlacement(candidate, analysis, context) {
    const aggr = this.aggression / 100;
    const pendingGarbage = Math.max(0, Number(context.pendingGarbage) || 0);
    const danger = Math.max(0, (analysis.maxHeight - 11) / 8) + (pendingGarbage / 10);

    const attackWeight = (20 + (aggr * 28) + (danger * 10)) * this.attackBias;
    const clearWeight = 3 + (aggr * 5);
    const tspinWeight = (12 + (aggr * 18)) * this.attackBias;
    const b2bWeight = 4 + (aggr * 8);
    const comboWeight = 2 + (aggr * 4);
    const allClearWeight = 90;

    const holePenalty = (10 - (aggr * 2) + (danger * 4)) * this.survivalBias;
    const coveredHolePenalty = (1.1 + (danger * 0.25)) * this.survivalBias;
    const heightPenalty = (0.35 + ((1 - aggr) * 0.16) + (danger * 0.2)) * this.survivalBias;
    const bumpPenalty = (0.24 + (danger * 0.12)) * this.survivalBias;
    const maxHeightPenalty = (0.9 + (danger * 0.85)) * this.survivalBias;

    let score = 0;
    score += (candidate.attack * attackWeight);
    score += (candidate.linesCleared * clearWeight);
    if (candidate.isTSpin) score += tspinWeight;
    if (candidate.b2bBonus) score += b2bWeight;
    if (candidate.postCombo > 0) score += Math.min(6, candidate.postCombo) * comboWeight;
    if (candidate.isAllClear) score += allClearWeight;

    score -= (analysis.holes * holePenalty);
    score -= (analysis.coveredHoles * coveredHolePenalty);
    score -= (analysis.aggregateHeight * heightPenalty);
    score -= (analysis.bumpiness * bumpPenalty);
    score -= (analysis.maxHeight * maxHeightPenalty);

    if (pendingGarbage > 0 && candidate.linesCleared === 0) score -= 24;
    if (analysis.maxHeight >= 18) score -= 140;

    score += this._openerBonus(candidate, analysis, context);
    return score;
  }

  _generateCandidates(board, piece, options = {}) {
    if (!piece || !SHAPES[piece]) return [];

    const preCombo = Number.isFinite(Number(options.preCombo)) ? Number(options.preCombo) : -1;
    const preB2B = Number.isFinite(Number(options.preB2B)) ? Number(options.preB2B) : 0;
    const pendingGarbage = Math.max(0, Number(options.pendingGarbage) || 0);
    const piecesPlacedBefore = Math.max(0, Number(options.piecesPlacedBefore) || 0);
    const useHold = options.useHold === true;
    const holdHadPiece = options.holdHadPiece === true;

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

        const candidate = {
          piece,
          useHold,
          holdHadPiece,
          x,
          y,
          rot,
          linesCleared: cleared.linesCleared,
          attack: attackInfo.attack,
          b2bBonus: attackInfo.b2bBonus,
          postCombo: attackInfo.postCombo,
          postB2B: attackInfo.postB2B,
          isTSpin,
          isAllClear,
          lastActionWasRotation: (piece === 'T') && (rot !== 0 || isTSpin),
          boardAfter: cleared.board,
        };

        const analysis = this._analyzeBoard(cleared.board);
        const baseScore = this._scorePlacement(candidate, analysis, {
          pendingGarbage,
          piecesPlacedBefore,
        });

        candidate.baseScore = baseScore;
        candidate.totalScore = baseScore + (candidate.attack * (8 + this.aggression * 0.08));
        out.push(candidate);
      }
    }

    out.sort((a, b) => b.baseScore - a.baseScore);
    return out;
  }

  _deriveFutureAfterFirstMove(useHold, holdHadPiece, queue) {
    const q = Array.isArray(queue) ? queue : [];
    if (useHold && !holdHadPiece) {
      return {
        nextActive: q[1] || null,
        nextQueue: q.slice(2),
      };
    }
    return {
      nextActive: q[0] || null,
      nextQueue: q.slice(1),
    };
  }

  _searchNoHold(board, activePiece, queue, depth, context) {
    if (depth <= 0 || !activePiece || !SHAPES[activePiece]) return 0;

    const candidates = this._generateCandidates(board, activePiece, {
      useHold: false,
      preCombo: context.preCombo,
      preB2B: context.preB2B,
      pendingGarbage: context.pendingGarbage,
      piecesPlacedBefore: context.piecesPlacedBefore,
    });
    if (candidates.length === 0) return -240;

    const limit = Math.min(this.beamWidth, candidates.length);
    let best = -Infinity;
    for (let i = 0; i < limit; i++) {
      const cand = candidates[i];
      let score = cand.totalScore;

      if (depth > 1) {
        const nextActive = (queue && queue.length > 0) ? queue[0] : null;
        const nextQueue = (queue && queue.length > 0) ? queue.slice(1) : [];
        const nextPending = Math.max(0, context.pendingGarbage - cand.attack);
        const continuation = this._searchNoHold(
          cand.boardAfter,
          nextActive,
          nextQueue,
          depth - 1,
          {
            preCombo: cand.postCombo,
            preB2B: cand.postB2B,
            pendingGarbage: nextPending,
            piecesPlacedBefore: (context.piecesPlacedBefore + 1),
          }
        );
        score += continuation * this.lookaheadDecay;
      }

      if (score > best) best = score;
    }
    return best;
  }

  _choosePlacement() {
    const gs = this.gameState;
    if (!gs || !gs.currentPiece) return null;

    const queue = Array.isArray(gs.queue) ? gs.queue : [];
    const pendingGarbage = (typeof gs.getPendingGarbageTotal === 'function')
      ? Math.max(0, Number(gs.getPendingGarbageTotal()) || 0)
      : 0;
    const preCombo = Number.isFinite(Number(gs.comboCounter)) ? Number(gs.comboCounter) : -1;
    const preB2B = Number.isFinite(Number(gs.b2bCounter)) ? Number(gs.b2bCounter) : 0;
    const piecesPlacedBefore = Math.max(0, Number(gs.piecesPlaced) || 0);

    const candidates = [];
    candidates.push(
      ...this._generateCandidates(gs.board, gs.currentPiece, {
        useHold: false,
        holdHadPiece: gs.holdPiece != null,
        preCombo,
        preB2B,
        pendingGarbage,
        piecesPlacedBefore,
      })
    );

    if (gs.canHold) {
      const holdPieceCandidate = (gs.holdPiece != null) ? gs.holdPiece : (queue[0] || null);
      if (holdPieceCandidate) {
        candidates.push(
          ...this._generateCandidates(gs.board, holdPieceCandidate, {
            useHold: true,
            holdHadPiece: gs.holdPiece != null,
            preCombo,
            preB2B,
            pendingGarbage,
            piecesPlacedBefore,
          })
        );
      }
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.baseScore - a.baseScore);

    const evalCount = Math.min(this.lookaheadTop, candidates.length);
    for (let i = 0; i < evalCount; i++) {
      const cand = candidates[i];
      const future = this._deriveFutureAfterFirstMove(cand.useHold, cand.holdHadPiece, queue);

      const nextPending = Math.max(0, pendingGarbage - cand.attack);
      const continuation = this._searchNoHold(
        cand.boardAfter,
        future.nextActive,
        future.nextQueue,
        Math.max(1, this.searchDepth - 1),
        {
          preCombo: cand.postCombo,
          preB2B: cand.postB2B,
          pendingGarbage: nextPending,
          piecesPlacedBefore: piecesPlacedBefore + 1,
        }
      );
      cand.totalScore = cand.totalScore + (continuation * this.lookaheadDecay);
    }

    for (let i = evalCount; i < candidates.length; i++) {
      candidates[i].totalScore = candidates[i].baseScore;
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
    if (!plan) return gs.hardDropAndSpawn();

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
    if (!locked) return gs.hardDropAndSpawn();
    return gs.spawnPiece();
  }
}

if (typeof globalThis !== 'undefined') {
  globalThis.TetrisBot = TetrisBot;
}
