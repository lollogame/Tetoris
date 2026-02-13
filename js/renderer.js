'use strict';

/* =========================================================
   Renderer
========================================================= */
class TetrisRenderer {
  constructor(canvas, holdCanvas, queueCanvas) {
    this.canvas = canvas;
    this.holdCanvas = holdCanvas;
    this.queueCanvas = queueCanvas;

    this.ctx = canvas.getContext('2d');
    this.holdCtx = holdCanvas.getContext('2d');
    this.queueCtx = queueCanvas.getContext('2d');

    this.boardLayerCanvas = document.createElement('canvas');
    this.boardLayerCtx = this.boardLayerCanvas.getContext('2d');

    this._lastBoardSignature = '';
    this._lastHoldSignature = null;
    this._lastQueueSignature = null;

    // Ensure canvas internal resolution matches draw coordinates.
    this._ensureSizes();

    this.ctx.imageSmoothingEnabled = false;
    this.holdCtx.imageSmoothingEnabled = false;
    this.queueCtx.imageSmoothingEnabled = false;
    this.boardLayerCtx.imageSmoothingEnabled = false;
  }

  _ensureSizes() {
    // Main board must match grid math exactly.
    this._setCanvasSize(this.canvas, COLS * BLOCK_SIZE, ROWS * BLOCK_SIZE);
    this._setCanvasSize(this.boardLayerCanvas, COLS * BLOCK_SIZE, ROWS * BLOCK_SIZE);

    // Hold preview: 4x4 plus padding.
    this._setCanvasSize(this.holdCanvas, 6 * PREVIEW_BLOCK_SIZE, 6 * PREVIEW_BLOCK_SIZE);

    // Queue preview: 6 entries * 80px each.
    this._setCanvasSize(this.queueCanvas, 6 * PREVIEW_BLOCK_SIZE, 6 * 80);
  }

  _setCanvasSize(canvas, w, h) {
    if (!canvas) return;

    if (!canvas.style.width) canvas.style.width = `${w}px`;
    if (!canvas.style.height) canvas.style.height = `${h}px`;

    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
  }

  _clearAndFill(ctx, w, h) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0a0e27';
    ctx.fillRect(0, 0, w, h);
  }

  _drawBlockOn(ctx, x, y, color, alpha = 1) {
    const prevAlpha = ctx.globalAlpha;

    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x + 1, y + 1, BLOCK_SIZE - 2, BLOCK_SIZE - 2);

    // highlight
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(x + 2, y + 2, BLOCK_SIZE - 4, 6);

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x + 2, y + BLOCK_SIZE - 8, BLOCK_SIZE - 4, 6);

    ctx.globalAlpha = prevAlpha;
  }

  drawBlock(x, y, color, alpha = 1) {
    this._drawBlockOn(this.ctx, x, y, color, alpha);
  }

  _getBoardSignature(board) {
    let sig = '';
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        sig += String(board[r][c] || 0);
      }
      sig += '|';
    }
    return sig;
  }

  _redrawBoardLayer(board) {
    this._clearAndFill(this.boardLayerCtx, this.boardLayerCanvas.width, this.boardLayerCanvas.height);

    // Grid
    this.boardLayerCtx.strokeStyle = 'rgba(139,157,195,0.1)';
    this.boardLayerCtx.lineWidth = 1;

    for (let i = 0; i <= COLS; i++) {
      this.boardLayerCtx.beginPath();
      this.boardLayerCtx.moveTo(i * BLOCK_SIZE, 0);
      this.boardLayerCtx.lineTo(i * BLOCK_SIZE, ROWS * BLOCK_SIZE);
      this.boardLayerCtx.stroke();
    }

    for (let i = 0; i <= ROWS; i++) {
      this.boardLayerCtx.beginPath();
      this.boardLayerCtx.moveTo(0, i * BLOCK_SIZE);
      this.boardLayerCtx.lineTo(COLS * BLOCK_SIZE, i * BLOCK_SIZE);
      this.boardLayerCtx.stroke();
    }

    // Cells
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const v = board[r][c];
        if (!v) continue;
        const color = (v === 'G') ? '#666666' : SHAPES[v].color;
        this._drawBlockOn(this.boardLayerCtx, c * BLOCK_SIZE, r * BLOCK_SIZE, color, 1);
      }
    }
  }

  drawBoard(board) {
    const sig = this._getBoardSignature(board);
    if (sig !== this._lastBoardSignature) {
      this._lastBoardSignature = sig;
      this._redrawBoardLayer(board);
    }

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.globalAlpha = 1;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(this.boardLayerCanvas, 0, 0);
  }

  drawPiece(piece, x, y, rot, alpha = 1) {
    const shape = SHAPES[piece].shape[rot];
    const color = SHAPES[piece].color;

    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        this.drawBlock((x + c) * BLOCK_SIZE, (y + r) * BLOCK_SIZE, color, alpha);
      }
    }
  }

  drawGhostPiece(piece, x, ghostY, rot) {
    this.drawPiece(piece, x, ghostY, rot, 0.3);
  }

  drawPreviewPiece(ctx, piece, containerW, containerH, offsetX = 0, offsetY = 0) {
    const shape = SHAPES[piece].shape[0];
    const color = SHAPES[piece].color;

    const pw = shape[0].length * PREVIEW_BLOCK_SIZE;
    const ph = shape.length * PREVIEW_BLOCK_SIZE;

    const x = offsetX + (containerW - pw) / 2;
    const y = offsetY + (containerH - ph) / 2;

    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        ctx.fillStyle = color;
        ctx.fillRect(
          x + c * PREVIEW_BLOCK_SIZE,
          y + r * PREVIEW_BLOCK_SIZE,
          PREVIEW_BLOCK_SIZE - 1,
          PREVIEW_BLOCK_SIZE - 1
        );
      }
    }
  }

  drawHold(piece) {
    const sig = piece || '';
    if (sig === this._lastHoldSignature) return;
    this._lastHoldSignature = sig;

    this._clearAndFill(this.holdCtx, this.holdCanvas.width, this.holdCanvas.height);
    if (piece) this.drawPreviewPiece(this.holdCtx, piece, this.holdCanvas.width, this.holdCanvas.height);
  }

  drawQueue(queue) {
    const sig = Array.isArray(queue) ? queue.slice(0, 6).join('') : '';
    if (sig === this._lastQueueSignature) return;
    this._lastQueueSignature = sig;

    this._clearAndFill(this.queueCtx, this.queueCanvas.width, this.queueCanvas.height);
    for (let i = 0; i < Math.min(6, queue.length); i++) {
      this.drawPreviewPiece(this.queueCtx, queue[i], this.queueCanvas.width, 80, 0, i * 80);
    }
  }

  /* ---------------------------------------------------------
     No-op FX hooks (user requested no flashes)
     These are called by the SFX-enabled gameState.js patch.
  --------------------------------------------------------- */
  flashClear(_lines) { /* intentionally blank */ }
  flashGarbageIn() { /* intentionally blank */ }
  flashGarbageApply() { /* intentionally blank */ }
}
