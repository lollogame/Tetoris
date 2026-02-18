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
    this.recentMoveTypes = [];
    this.lastStrategy = 'b2b_mix';
    this.configure(config);
    this._scheduleNextAction(true);
  }

  configure(config = {}) {
    const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
    this.pps = Math.max(0.4, Math.min(6, num(config.pps, 2.4)));
    this.aggression = Math.max(0, Math.min(100, num(config.aggression, 74)));
    this.mistakeChance = Math.max(0, Math.min(100, num(config.mistakeChance, 0))) / 100;
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

  _getLockYs(board, piece, rot, x) {
    const ys = [];
    for (let y = SPAWN_ROW; y < ROWS; y++) {
      if (!this._canPlace(board, piece, rot, x, y)) continue;
      if (this._canPlace(board, piece, rot, x, y + 1)) continue;
      ys.push(y);
    }
    return ys;
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

  _countCavities(board) {
    let cavities = 0;
    for (let r = 1; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (board[r][c]) continue;
        if (!board[r - 1][c]) continue;
        const leftBlocked = (c === 0) || !!board[r][c - 1];
        const rightBlocked = (c === COLS - 1) || !!board[r][c + 1];
        if (leftBlocked && rightBlocked) cavities++;
      }
    }
    return cavities;
  }

  _countColumnHoles(board, col) {
    let holes = 0;
    let seenBlock = false;
    for (let r = 0; r < ROWS; r++) {
      if (board[r][col]) {
        seenBlock = true;
      } else if (seenBlock) {
        holes++;
      }
    }
    return holes;
  }

  _countTSlotOpportunities(board) {
    let slots = 0;
    for (let y = 0; y <= ROWS - 3; y++) {
      for (let x = 0; x <= COLS - 3; x++) {
        if (board[y + 1][x + 1]) continue;

        let corners = 0;
        if (board[y][x]) corners++;
        if (board[y][x + 2]) corners++;
        if (board[y + 2][x]) corners++;
        if (board[y + 2][x + 2]) corners++;
        if (corners < 3) continue;

        const roof = board[y][x + 1] !== 0;
        const support = board[y + 2][x + 1] !== 0;
        const sideEntry = (board[y + 1][x] === 0) || (board[y + 1][x + 2] === 0);
        if (roof && support && sideEntry) slots++;
      }
    }
    return slots;
  }

  _evaluateEdgeWell(board, heights) {
    const leftDepth = Math.max(0, (heights[1] || 0) - (heights[0] || 0));
    const rightDepth = Math.max(0, (heights[COLS - 2] || 0) - (heights[COLS - 1] || 0));
    const edgeWellCol = (rightDepth >= leftDepth) ? (COLS - 1) : 0;
    const edgeWellDepth = Math.max(leftDepth, rightDepth);
    const edgeWellHoles = this._countColumnHoles(board, edgeWellCol);

    let centerWellPenalty = 0;
    for (let c = 1; c < COLS - 1; c++) {
      const sideMin = Math.min(heights[c - 1], heights[c + 1]);
      const localDepth = Math.max(0, sideMin - heights[c]);
      if (localDepth >= 2) centerWellPenalty += localDepth;
    }

    return {
      edgeWellCol,
      edgeWellDepth,
      edgeWellHoles,
      centerWellPenalty,
      leftEdgeWellDepth: leftDepth,
      rightEdgeWellDepth: rightDepth,
    };
  }

  _countNearFullRows(board, minFilled = 8) {
    const target = Math.max(1, Math.min(COLS, Number(minFilled) || 8));
    let near = 0;
    for (let r = 0; r < ROWS; r++) {
      const row = Array.isArray(board?.[r]) ? board[r] : null;
      if (!row) continue;
      let filled = 0;
      for (let c = 0; c < COLS; c++) {
        if (row[c]) filled++;
      }
      if (filled >= target && filled < COLS) near++;
    }
    return near;
  }

  _chooseStrategy(analysis, gameState, queue, pendingGarbage, immediateDanger) {
    const gs = gameState || {};
    const piecesPlaced = Math.max(0, Number(gs.piecesPlaced) || 0);
    const combo = Number.isFinite(Number(gs.comboCounter)) ? Number(gs.comboCounter) : -1;
    const b2b = Number.isFinite(Number(gs.b2bCounter)) ? Number(gs.b2bCounter) : 0;
    const next = Array.isArray(queue) ? queue.slice(0, 5) : [];
    const iSoon = next.includes('I');
    const tSoon = next.includes('T');
    const nearFullRows = this._countNearFullRows(gs.board || [], 8);

    let strategy = 'b2b_mix';
    if (immediateDanger > 1.35 || pendingGarbage >= 5 || analysis.holes >= 4) {
      strategy = 'combo_downstack';
    } else if (combo >= 1 && (nearFullRows >= 2 || analysis.holes > 0 || pendingGarbage > 0)) {
      strategy = 'combo_downstack';
    } else if (piecesPlaced <= 12) {
      strategy = 'opener_mix';
    } else if (analysis.tSlotOpportunities > 0 && (tSoon || gs.currentPiece === 'T')) {
      strategy = 'tspin_convert';
    } else if (analysis.tSlotOpportunities === 0 && (tSoon || gs.currentPiece === 'T' || !iSoon)) {
      strategy = 'tspin_build';
    } else {
      strategy = 'b2b_mix';
    }

    if (
      this.lastStrategy &&
      immediateDanger < 1.15 &&
      this.lastStrategy.startsWith('tspin') &&
      strategy === 'b2b_mix' &&
      analysis.holes <= 2
    ) {
      strategy = this.lastStrategy;
    }

    if (analysis.edgeWellDepth >= 6 && analysis.tSlotOpportunities === 0 && !iSoon && immediateDanger < 1.2) {
      strategy = 'tspin_build';
    }

    return {
      strategy,
      piecesPlaced,
      nearFullRows,
      combo,
      b2b,
      iSoon,
      tSoon,
    };
  }

  _applyRecentPatternBias(candidates, strategyContext, immediateDanger) {
    if (!Array.isArray(candidates) || candidates.length === 0) return;

    const recent = this.recentMoveTypes.slice(-8);
    if (recent.length < 4) return;

    const tetrisCount = recent.filter((x) => x === 'tetris').length;
    const tspinCount = recent.filter((x) => x === 'tspin').length;
    const dryCount = recent.filter((x) => x === 'none').length;
    const scope = Math.min(30, candidates.length);

    if (tetrisCount >= 4 && immediateDanger < 1.3) {
      for (let i = 0; i < scope; i++) {
        const cand = candidates[i];
        if (cand.linesCleared === 4) cand.totalScore -= 28;
        if (cand.isTSpin) cand.totalScore += 40;
        if (cand.tSlotDelta > 0) cand.totalScore += 18;
      }
    }

    if (tspinCount === 0 && immediateDanger < 1.3) {
      for (let i = 0; i < scope; i++) {
        const cand = candidates[i];
        if (cand.isTSpin) cand.totalScore += 34;
        if (cand.tSlotDelta > 0) cand.totalScore += 14;
      }
    }

    if (dryCount >= 4 && strategyContext?.strategy !== 'combo_downstack') {
      for (let i = 0; i < scope; i++) {
        const cand = candidates[i];
        if (cand.attack > 0) cand.totalScore += 24;
        if (cand.linesCleared === 0) cand.totalScore -= 18;
      }
    }
  }

  _recordMoveOutcome(plan) {
    let type = 'none';
    if (plan && plan.isTSpin) type = 'tspin';
    else if (plan && plan.linesCleared === 4) type = 'tetris';
    else if (plan && plan.linesCleared === 3) type = 'triple';
    else if (plan && plan.linesCleared === 2) type = 'double';
    else if (plan && plan.linesCleared === 1) type = 'single';

    this.recentMoveTypes.push(type);
    if (this.recentMoveTypes.length > 16) this.recentMoveTypes.shift();
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
    const cavities = this._countCavities(board);
    const tSlotOpportunities = this._countTSlotOpportunities(board);
    const wellProfile = this._evaluateEdgeWell(board, heights);

    return {
      heights,
      aggregateHeight,
      holes,
      holeDepth,
      bumpiness,
      maxHeight,
      rowTransitions,
      columnTransitions,
      wellCells,
      deepestWell,
      cavities,
      tSlotOpportunities,
      edgeWellCol: wellProfile.edgeWellCol,
      edgeWellDepth: wellProfile.edgeWellDepth,
      edgeWellHoles: wellProfile.edgeWellHoles,
      centerWellPenalty: wellProfile.centerWellPenalty,
      leftEdgeWellDepth: wellProfile.leftEdgeWellDepth,
      rightEdgeWellDepth: wellProfile.rightEdgeWellDepth,
    };
  }

  _scorePlacement(sim, analysis, attackInfo, context) {
    const aggr = this.aggression / 100;
    const pendingGarbage = Math.max(0, Number(context.pendingGarbage) || 0);
    const pendingAfterGarbage = Math.max(0, Number(context.pendingAfterGarbage) || 0);
    const preB2B = Number.isFinite(Number(context.preB2B)) ? Number(context.preB2B) : 0;
    const preCombo = Number.isFinite(Number(context.preCombo)) ? Number(context.preCombo) : -1;
    const strategy = (typeof context.strategy === 'string' && context.strategy) ? context.strategy : 'b2b_mix';
    const piecesPlaced = Math.max(0, Number(context.piecesPlaced) || 0);
    const nearFullRows = Math.max(0, Number(context.nearFullRows) || 0);
    const piece = context.piece;
    const before = context.beforeAnalysis || null;
    const danger = this._dangerLevel(analysis, pendingAfterGarbage);
    const isB2BMove = (sim.linesCleared === 4) || sim.isTSpin;
    const comboDepth = Math.max(0, preCombo + 1);

    const holesDelta = before ? (analysis.holes - before.holes) : 0;
    const holeDepthDelta = before ? (analysis.holeDepth - before.holeDepth) : 0;
    const cavitiesDelta = before ? (analysis.cavities - before.cavities) : 0;
    const tSlotDelta = before ? (analysis.tSlotOpportunities - before.tSlotOpportunities) : 0;
    const edgeWellDelta = before ? (analysis.edgeWellDepth - before.edgeWellDepth) : 0;

    const attackWeight = 30 + (aggr * 62) + (danger * 18);
    const clearWeight = 2 + (aggr * 3);
    const tspinWeight = 38 + (aggr * 34) + (danger * 11);
    const b2bWeight = 14 + (aggr * 16);
    const comboWeight = 2 + (aggr * 5);
    const allClearWeight = 132;
    const tetrisWeight = 60 + (aggr * 34) + (Math.max(0, 1.2 - danger) * 14);
    const tSpinLineWeight = 34 + (aggr * 30) + (danger * 10);
    const b2bPreserveWeight = 20 + (aggr * 18);
    const tSlotWeight = 8 + (aggr * 9);

    const holePenalty = 12 - (aggr * 4) + (danger * 9);
    const holeDepthPenalty = 1.9 + (danger * 1.5);
    const cavityPenalty = 11 + (danger * 8);
    const heightPenalty = 0.42 + ((1 - aggr) * 0.25) + (danger * 0.38);
    const bumpPenalty = 0.30 + ((1 - aggr) * 0.18) + (danger * 0.22);
    const maxHeightPenalty = 1.2 + (danger * 1.45);
    const rowTransitionPenalty = 0.45 + (danger * 0.22);
    const colTransitionPenalty = 0.22 + (danger * 0.18);
    const wellPenalty = danger > 0.9
      ? (0.9 + danger * 0.5)
      : (0.25 + ((1 - aggr) * 0.10));
    const edgeWellHolePenalty = 10 + (danger * 7);
    const centerWellPenalty = 2.4 + ((1 - aggr) * 1.4);
    const newHolePenalty = 24 + (danger * 15);
    const newHoleDepthPenalty = 3.2 + (danger * 2.3);
    const newCavityPenalty = 18 + (danger * 10);

    let score = 0;
    score += (attackInfo.attack * attackWeight);
    score += (sim.linesCleared * clearWeight);
    if (sim.isTSpin) score += tspinWeight;
    if (attackInfo.b2bBonus) score += b2bWeight;
    if (attackInfo.postCombo > 0) score += Math.min(7, attackInfo.postCombo) * comboWeight;
    if (sim.isAllClear) score += allClearWeight;
    if (sim.linesCleared === 4) {
      score += tetrisWeight;
      if (piece === 'I') score += 16 + (aggr * 8);
    }
    if (sim.isTSpin) {
      const tSpinLineBonus = [0, 30, 66, 104][sim.linesCleared] || 0;
      score += tSpinLineBonus;
      score += sim.linesCleared * tSpinLineWeight;
    }
    if (preB2B > 0 && isB2BMove) score += b2bPreserveWeight;
    if (preB2B > 0 && sim.linesCleared > 0 && !isB2BMove && danger < 1.3) {
      score -= 30 + ((1 - aggr) * 10);
    }
    if (analysis.deepestWell >= 3 && danger < 0.75) {
      score += analysis.deepestWell * (1.8 + (aggr * 2.4));
    }
    if (analysis.edgeWellDepth >= 3 && analysis.edgeWellHoles === 0 && danger < 1.15) {
      score += analysis.edgeWellDepth * (7 + (aggr * 5));
    }
    if (analysis.tSlotOpportunities > 0 && danger < 1.5) {
      score += analysis.tSlotOpportunities * tSlotWeight;
    }
    if (tSlotDelta > 0) score += tSlotDelta * (7 + (aggr * 6));
    if (tSlotDelta < 0 && piece !== 'T') score += tSlotDelta * (4 + ((1 - aggr) * 3));
    if (pendingGarbage > pendingAfterGarbage) {
      score += (pendingGarbage - pendingAfterGarbage) * (10 + (danger * 12));
    }

    score -= (analysis.holes * holePenalty);
    score -= (analysis.holeDepth * holeDepthPenalty);
    score -= (analysis.cavities * cavityPenalty);
    score -= (analysis.aggregateHeight * heightPenalty);
    score -= (analysis.bumpiness * bumpPenalty);
    score -= (analysis.maxHeight * maxHeightPenalty);
    score -= (analysis.rowTransitions * rowTransitionPenalty);
    score -= (analysis.columnTransitions * colTransitionPenalty);
    score -= (analysis.wellCells * wellPenalty);
    score -= (analysis.edgeWellHoles * edgeWellHolePenalty);
    score -= (analysis.centerWellPenalty * centerWellPenalty);

    if (holesDelta > 0) score -= holesDelta * newHolePenalty;
    if (holeDepthDelta > 0) score -= holeDepthDelta * newHoleDepthPenalty;
    if (cavitiesDelta > 0) score -= cavitiesDelta * newCavityPenalty;
    if (edgeWellDelta < 0 && sim.linesCleared < 4 && !sim.isTSpin && danger < 1.15) {
      score += edgeWellDelta * (16 + (aggr * 7));
    }

    if (strategy === 'opener_mix') {
      if (piecesPlaced <= 12 && sim.linesCleared === 4 && danger < 0.95 && pendingAfterGarbage === 0) score -= 34;
      if (tSlotDelta > 0) score += tSlotDelta * (30 + (aggr * 10));
      if (analysis.tSlotOpportunities > 0) score += 12 + (analysis.tSlotOpportunities * 4);
      if (analysis.edgeWellDepth >= 6 && analysis.tSlotOpportunities === 0 && sim.linesCleared < 4) score -= 24;
      if (!sim.isTSpin && sim.linesCleared === 2) score += 8 + (nearFullRows * 2);
    } else if (strategy === 'tspin_build') {
      if (tSlotDelta > 0) score += tSlotDelta * (44 + (aggr * 10));
      if (analysis.tSlotOpportunities > 0) score += 20 + (analysis.tSlotOpportunities * 6);
      if (sim.isTSpin) score += 42 + (sim.linesCleared * 16);
      if (tSlotDelta < 0 && piece !== 'T') score += tSlotDelta * (18 + ((1 - aggr) * 10));
      if (sim.linesCleared === 4 && danger < 1.15 && analysis.tSlotOpportunities === 0) score -= 20;
      if (analysis.edgeWellDepth >= 7 && analysis.tSlotOpportunities === 0 && piece !== 'I') score -= 22;
    } else if (strategy === 'tspin_convert') {
      if (sim.isTSpin) score += 78 + (sim.linesCleared * 18);
      if (sim.linesCleared === 4) score += 12;
      if (!sim.isTSpin && tSlotDelta < 0) score += tSlotDelta * (14 + ((1 - aggr) * 8));
      if (analysis.tSlotOpportunities > 0 && !sim.isTSpin) score += 12;
      if (piece === 'T' && sim.linesCleared === 0 && tSlotDelta >= 0) score += 10;
    } else if (strategy === 'combo_downstack') {
      if (sim.linesCleared === 1 || sim.linesCleared === 2) score += 18 + (comboDepth * 6);
      if (sim.linesCleared === 3) score += 12 + (comboDepth * 4);
      if (holesDelta < 0) score += Math.abs(holesDelta) * (34 + (comboDepth * 4));
      if (cavitiesDelta < 0) score += Math.abs(cavitiesDelta) * (24 + (comboDepth * 3));
      if (sim.linesCleared === 0 && (analysis.holes > 0 || pendingAfterGarbage > 0)) {
        score -= 32 + (pendingAfterGarbage * 4);
      }
      if (sim.linesCleared === 4 && danger < 1.2 && analysis.holes > 0) score -= 18;
    } else {
      if (sim.isTSpin) score += 28 + (sim.linesCleared * 8);
      if (sim.linesCleared === 4) score += 24;
      if (analysis.tSlotOpportunities > 0 && !sim.isTSpin) score += 6;
      if (
        analysis.edgeWellDepth >= 7 &&
        analysis.tSlotOpportunities === 0 &&
        sim.linesCleared !== 4 &&
        piece !== 'I' &&
        danger < 1.2
      ) {
        score -= 22;
      }
      if (sim.linesCleared === 4 && analysis.tSlotOpportunities === 0 && danger < 0.9 && piecesPlaced > 14) {
        score -= 12;
      }
    }

    if (
      analysis.edgeWellDepth >= 8 &&
      analysis.tSlotOpportunities === 0 &&
      piece !== 'I' &&
      sim.linesCleared < 4 &&
      !sim.isTSpin &&
      danger < 1.2
    ) {
      score -= 30;
    }

    if (pendingAfterGarbage > 0 && sim.linesCleared === 0) score -= 24 + (pendingAfterGarbage * 1.5);
    if (danger > 1.0 && sim.linesCleared > 0) score += sim.linesCleared * (8 + (danger * 9));
    if (danger > 1.25 && sim.linesCleared === 0) score -= 18 + (danger * 14);
    if (!sim.isTSpin && sim.linesCleared === 1 && danger < 1.05 && pendingAfterGarbage === 0) score -= 26;
    if (!sim.isTSpin && sim.linesCleared === 2 && danger < 0.95 && pendingAfterGarbage === 0) score -= 15;
    if (!sim.isTSpin && sim.linesCleared === 3 && danger < 0.85 && pendingAfterGarbage === 0) score -= 8;
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
    const beforeAnalysis = options.beforeAnalysis || this._analyzeBoard(board);
    const strategy = (typeof options.strategy === 'string' && options.strategy) ? options.strategy : 'b2b_mix';
    const piecesPlaced = Math.max(0, Number(options.piecesPlaced) || 0);
    const nearFullRows = Number.isFinite(Number(options.nearFullRows))
      ? Math.max(0, Number(options.nearFullRows))
      : this._countNearFullRows(board, 8);

    const out = [];
    for (let rot = 0; rot < 4; rot++) {
      const shape = this._shapeFor(piece, rot);
      if (!shape) continue;

      const width = shape[0].length;
      const minX = -2;
      const maxX = COLS - width + 2;

      for (let x = minX; x <= maxX; x++) {
        const lockYs = this._getLockYs(board, piece, rot, x);
        if (lockYs.length === 0) continue;

        for (const y of lockYs) {
          const preClearBoard = this._placePiece(board, piece, rot, x, y);
          if (!preClearBoard) continue;

          const cleared = this._clearFullLines(preClearBoard);
          const isAllClear = this._isAllClear(cleared.board);
          const isTSpin = this._isTSpin(preClearBoard, piece, x, y, cleared.linesCleared);
          const attackInfo = this._estimateAttack(piece, cleared.linesCleared, isTSpin, isAllClear, preB2B, preCombo);
          const analysis = this._analyzeBoard(cleared.board);
          const holesDelta = analysis.holes - beforeAnalysis.holes;
          const holeDepthDelta = analysis.holeDepth - beforeAnalysis.holeDepth;
          const cavitiesDelta = analysis.cavities - beforeAnalysis.cavities;
          const bumpinessDelta = analysis.bumpiness - beforeAnalysis.bumpiness;
          const maxHeightDelta = analysis.maxHeight - beforeAnalysis.maxHeight;
          const tSlotDelta = analysis.tSlotOpportunities - beforeAnalysis.tSlotOpportunities;
          const edgeWellDelta = analysis.edgeWellDepth - beforeAnalysis.edgeWellDepth;
          const centerWellPenaltyDelta = analysis.centerWellPenalty - beforeAnalysis.centerWellPenalty;
          const pendingAfterGarbage = Math.max(0, pendingGarbage - attackInfo.attack);
          const dangerAfter = this._dangerLevel(analysis, pendingAfterGarbage);
          const score = this._scorePlacement(
            { linesCleared: cleared.linesCleared, isTSpin, isAllClear },
            analysis,
            attackInfo,
            {
              pendingGarbage,
              pendingAfterGarbage,
              preB2B,
              preCombo,
              strategy,
              piecesPlaced,
              nearFullRows,
              piece,
              beforeAnalysis,
            }
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
            holesDelta,
            holeDepthDelta,
            cavitiesDelta,
            bumpinessDelta,
            maxHeightDelta,
            tSlotDelta,
            edgeWellDelta,
            centerWellPenaltyDelta,
            pendingAfterGarbage,
            analysisAfter: analysis,
            boardAfter: cleared.board,
          });
        }
      }
    }

    out.sort((a, b) => b.score - a.score);
    return out;
  }

  _filterCandidatesForCleanStack(candidates, context = {}) {
    if (!Array.isArray(candidates) || candidates.length <= 1) return candidates;

    const immediateDanger = Math.max(0, Number(context.immediateDanger) || 0);
    const pendingGarbage = Math.max(0, Number(context.pendingGarbage) || 0);
    const strategy = (typeof context.strategy === 'string' && context.strategy) ? context.strategy : 'b2b_mix';
    const lowDanger = immediateDanger < 1.25 && pendingGarbage <= 2;
    if (!lowDanger) return candidates;

    let pool = candidates.slice();

    const zeroHoleOptions = pool.filter((c) => c.holesDelta <= 0 && c.cavitiesDelta <= 0);
    if (zeroHoleOptions.length > 0) {
      pool = zeroHoleOptions;
    }

    const gentleSurface = pool.filter(
      (c) => c.bumpinessDelta <= 2 && c.maxHeightDelta <= 1 && c.centerWellPenaltyDelta <= 1
    );
    if (gentleSurface.length > 0) {
      pool = gentleSurface;
    }

    const minHoles = Math.min(...pool.map((c) => c.analysisAfter?.holes ?? 0));
    pool = pool.filter((c) => (c.analysisAfter?.holes ?? 0) <= minHoles + 1);

    const minBump = Math.min(...pool.map((c) => c.analysisAfter?.bumpiness ?? 0));
    const smoothPool = pool.filter((c) => (c.analysisAfter?.bumpiness ?? 0) <= minBump + 4);
    if (smoothPool.length > 0) {
      pool = smoothPool;
    }

    if (strategy === 'combo_downstack') {
      const comboPool = pool.filter(
        (c) => (c.linesCleared >= 1 && c.linesCleared <= 2) || c.holesDelta < 0 || c.cavitiesDelta < 0
      );
      if (comboPool.length > 0) return comboPool;
    }

    if (strategy === 'tspin_build' || strategy === 'tspin_convert') {
      const tspinPool = pool.filter((c) => c.isTSpin || c.tSlotDelta > 0);
      if (tspinPool.length > 0) return tspinPool;
    }

    if (strategy === 'opener_mix') {
      const openerPool = pool.filter((c) => c.tSlotDelta > 0 || (!c.isTSpin && c.linesCleared === 2));
      if (openerPool.length > 0) return openerPool;
    }

    const b2bAttackPool = pool.filter((c) => c.isTSpin || c.linesCleared === 4);
    const cleanB2BAttackPool = b2bAttackPool.filter((c) => c.holesDelta <= 0 && c.cavitiesDelta <= 0);
    if (cleanB2BAttackPool.length > 0) return cleanB2BAttackPool;
    if (b2bAttackPool.length > 0 && b2bAttackPool.length >= Math.max(2, Math.floor(pool.length / 4))) {
      return b2bAttackPool;
    }

    return pool.length > 0 ? pool : candidates;
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
    const strategyContext = this._chooseStrategy(boardNow, gs, queue, pendingGarbage, immediateDanger);
    this.lastStrategy = strategyContext.strategy;

    const candidates = [];
    candidates.push(
      ...this._generateCandidates(board, gs.currentPiece, {
        useHold: false,
        preCombo,
        preB2B,
        pendingGarbage,
        beforeAnalysis: boardNow,
        strategy: strategyContext.strategy,
        piecesPlaced: strategyContext.piecesPlaced,
        nearFullRows: strategyContext.nearFullRows,
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
            beforeAnalysis: boardNow,
            strategy: strategyContext.strategy,
            piecesPlaced: strategyContext.piecesPlaced,
            nearFullRows: strategyContext.nearFullRows,
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
          beforeAnalysis: cand.analysisAfter,
          strategy: strategyContext.strategy,
          piecesPlaced: strategyContext.piecesPlaced + 1,
          nearFullRows: this._countNearFullRows(cand.boardAfter, 8),
        });
        if (nextCandidates.length > 0) {
          const bestNext = nextCandidates[0];
          total += bestNext.score * lookaheadWeight;
          total += bestNext.attack * (10 + (aggr * 14));
          if (bestNext.linesCleared === 4) total += 14 + (aggr * 8);
          if (bestNext.isTSpin) total += 18 + (bestNext.linesCleared * (10 + (aggr * 5)));

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
                  beforeAnalysis: branch.analysisAfter,
                  strategy: strategyContext.strategy,
                  piecesPlaced: strategyContext.piecesPlaced + 2,
                  nearFullRows: this._countNearFullRows(branch.boardAfter, 8),
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

      if (cand.linesCleared === 4) total += 34 + (aggr * 16);
      if (cand.isTSpin) total += 38 + (cand.linesCleared * (14 + (aggr * 6)));
      if (preB2B > 0 && cand.linesCleared > 0 && !(cand.linesCleared === 4 || cand.isTSpin) && immediateDanger < 1.2) {
        total -= 22;
      }
      if (immediateDanger < 1.45) {
        if (cand.holesDelta > 0) total -= cand.holesDelta * (240 + (aggr * 70));
        if (cand.holeDepthDelta > 0) total -= cand.holeDepthDelta * (38 + (aggr * 10));
        if (cand.cavitiesDelta > 0) total -= cand.cavitiesDelta * (190 + (aggr * 55));
        if (cand.bumpinessDelta > 0) total -= cand.bumpinessDelta * (28 + ((1 - aggr) * 10));
        if (cand.maxHeightDelta > 0) total -= cand.maxHeightDelta * (34 + ((1 - aggr) * 14));
        if (cand.centerWellPenaltyDelta > 0) total -= cand.centerWellPenaltyDelta * (20 + ((1 - aggr) * 8));
        if (cand.edgeWellDelta < 0 && cand.linesCleared < 4 && !cand.isTSpin) {
          total += cand.edgeWellDelta * (24 + (aggr * 7));
        }
      }
      if (cand.holesDelta < 0) total += Math.abs(cand.holesDelta) * (42 + (aggr * 18));
      if (cand.cavitiesDelta < 0) total += Math.abs(cand.cavitiesDelta) * (30 + (aggr * 12));
      if (cand.bumpinessDelta < 0) total += Math.min(6, Math.abs(cand.bumpinessDelta)) * (8 + ((1 - aggr) * 6));
      if (cand.maxHeightDelta < 0) total += Math.abs(cand.maxHeightDelta) * (10 + ((1 - aggr) * 8));
      if (strategyContext.strategy === 'combo_downstack') {
        if (cand.linesCleared >= 1 && cand.linesCleared <= 2) total += 18;
        if (cand.holesDelta < 0) total += Math.abs(cand.holesDelta) * 24;
        if (cand.cavitiesDelta < 0) total += Math.abs(cand.cavitiesDelta) * 16;
        if (cand.linesCleared === 0 && (cand.analysisAfter?.holes ?? 0) > 0) total -= 26;
      } else if (strategyContext.strategy === 'tspin_build' || strategyContext.strategy === 'tspin_convert') {
        if (cand.isTSpin) total += 36 + (cand.linesCleared * 10);
        if (cand.tSlotDelta > 0) total += cand.tSlotDelta * 18;
        if (cand.linesCleared === 4 && (cand.analysisAfter?.tSlotOpportunities ?? 0) === 0 && immediateDanger < 1.15) {
          total -= 14;
        }
      } else if (strategyContext.strategy === 'opener_mix') {
        if (cand.tSlotDelta > 0) total += cand.tSlotDelta * 14;
        if (cand.linesCleared === 4 && strategyContext.piecesPlaced < 10 && immediateDanger < 1.0) total -= 28;
      } else {
        if (cand.isTSpin) total += 16;
        if (cand.linesCleared === 4) total += 12;
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

    this._applyRecentPatternBias(candidates, strategyContext, immediateDanger);

    const filtered = this._filterCandidatesForCleanStack(candidates, {
      immediateDanger,
      pendingGarbage,
      strategy: strategyContext.strategy,
    });
    const selectionPool = (filtered && filtered.length > 0) ? filtered : candidates;

    selectionPool.sort((a, b) => b.totalScore - a.totalScore);

    const pressure = Math.max(immediateDanger, selectionPool[0]?.dangerAfter || 0);
    let effectiveMistakeChance = this.mistakeChance * (1 - (aggr * 0.75));
    effectiveMistakeChance *= (1 - Math.min(0.85, pressure * 0.55));
    effectiveMistakeChance = Math.max(0, Math.min(0.20, effectiveMistakeChance));
    if (pressure < 1.2) effectiveMistakeChance *= 0.45;
    const best = selectionPool[0] || null;
    if (
      best &&
      pressure < 1.35 &&
      best.holesDelta <= 0 &&
      best.cavitiesDelta <= 0 &&
      best.bumpinessDelta <= 2
    ) {
      effectiveMistakeChance = 0;
    }

    if (Math.random() < effectiveMistakeChance) {
      const poolSize = pressure > 0.8 ? 2 : 3;
      const pool = selectionPool.slice(0, Math.min(poolSize, selectionPool.length));
      return pool[Math.floor(Math.random() * pool.length)];
    }

    return selectionPool[0];
  }

  _executePlacement(plan) {
    const gs = this.gameState;
    if (!gs || !gs.currentPiece) return true;

    if (!plan) {
      this._recordMoveOutcome(null);
      return gs.hardDropAndSpawn();
    }

    if (plan.useHold) {
      const held = gs.holdCurrentPiece();
      if (!held) {
        this._recordMoveOutcome(null);
        return gs.hardDropAndSpawn();
      }
      if (!gs.currentPiece) return false;
    }

    if (plan.piece && gs.currentPiece !== plan.piece) {
      this._recordMoveOutcome(null);
      return gs.hardDropAndSpawn();
    }

    if (!gs.isValidPosition(plan.x, plan.y, plan.rot)) {
      this._recordMoveOutcome(null);
      return gs.hardDropAndSpawn();
    }

    const didRotate = (plan.rot !== gs.currentRotation);
    gs.lastActionWasRotation = (gs.currentPiece === 'T') && (didRotate || !!plan.lastActionWasRotation);
    gs.currentRotation = plan.rot;
    gs.currentX = plan.x;
    gs.currentY = plan.y;

    const locked = gs.lockPiece();
    if (!locked) {
      this._recordMoveOutcome(null);
      return gs.hardDropAndSpawn();
    }
    this._recordMoveOutcome(plan);
    return gs.spawnPiece();
  }
}

if (typeof globalThis !== 'undefined') {
  globalThis.TetrisBot = TetrisBot;
}
