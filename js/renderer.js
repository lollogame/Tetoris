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

    // Tiny FX timers (flash/shake)
    this._fx = {
      clearUntil: 0,
      clearStrength: 0,
      garbageInUntil: 0,
      garbageApplyUntil: 0,
      shakeUntil: 0,
      shakeMag: 0
    };

    // ✅ CRITICAL: Ensure canvas internal resolution matches what we draw
    this._ensureSizes();

    // Optional but nice for crisp pixels
    this.ctx.imageSmoothingEnabled = false;
    this.holdCtx.imageSmoothingEnabled = false;
    this.queueCtx.imageSmoothingEnabled = false;
  }

  _ensureSizes() {
    // Main board must match grid math exactly
    this._setCanvasSize(this.canvas, COLS * BLOCK_SIZE, ROWS * BLOCK_SIZE);

    // Hold preview: big enough for 4x4 at PREVIEW_BLOCK_SIZE + padding
    // (If your HTML already sets these, this still won’t break layout; it only fixes internal resolution.)
    this._setCanvasSize(this.holdCanvas, 6 * PREVIEW_BLOCK_SIZE, 6 * PREVIEW_BLOCK_SIZE);

    // Queue preview: 6 entries * 80px each (you draw with i*80)
    this._setCanvasSize(this.queueCanvas, 6 * PREVIEW_BLOCK_SIZE, 6 * 80);
  }

  _setCanvasSize(canvas, w, h) {
    if (!canvas) return;

    // If CSS scales the canvas, you can also set style width/height.
    // Only set style if not already present to avoid messing your layout.
    if (!canvas.style.width) canvas.style.width = `${w}px`;
    if (!canvas.style.height) canvas.style.height = `${h}px`;

    // Internal pixel buffer must match drawing coordinates
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
  }

  // ✅ Always reset alpha + transform + clear before drawing
  _clearAndFill(ctx, w, h) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0a0e27';
    ctx.fillRect(0, 0, w, h);
  }

  drawBlock(x, y, color, alpha = 1) {
    // Assume ctx is already in normal transform
    const prevAlpha = this.ctx.globalAlpha;

    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x + 1, y + 1, BLOCK_SIZE - 2, BLOCK_SIZE - 2);

    // highlight
    this.ctx.fillStyle = 'rgba(255,255,255,0.3)';
    this.ctx.fillRect(x + 2, y + 2, BLOCK_SIZE - 4, 6);

    // shadow
    this.ctx.fillStyle = 'rgba(0,0,0,0.3)';
    this.ctx.fillRect(x + 2, y + BLOCK_SIZE - 8, BLOCK_SIZE - 4, 6);

    this.ctx.globalAlpha = prevAlpha;
  }

  drawBoard(board) {
    this._clearAndFill(this.ctx, this.canvas.width, this.canvas.height);

    // Grid
    this.ctx.strokeStyle = 'rgba(139,157,195,0.1)';
    this.ctx.lineWidth = 1;

    for (let i = 0; i <= COLS; i++) {
      this.ctx.beginPath();
      this.ctx.moveTo(i * BLOCK_SIZE, 0);
      this.ctx.lineTo(i * BLOCK_SIZE, ROWS * BLOCK_SIZE);
      this.ctx.stroke();
    }

    for (let i = 0; i <= ROWS; i++) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, i * BLOCK_SIZE);
      this.ctx.lineTo(COLS * BLOCK_SIZE, i * BLOCK_SIZE);
      this.ctx.stroke();
    }

    // Cells
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const v = board[r][c];
        if (!v) continue;
        const color = (v === 'G') ? '#666666' : SHAPES[v].color;
        this.drawBlock(c * BLOCK_SIZE, r * BLOCK_SIZE, color, 1);
      }
    }

    // FX overlays (simple, fast)
    if (now < this._fx.clearUntil) {
      this.ctx.globalAlpha = Math.min(0.35, Math.max(0.05, this._fx.clearStrength));
      this.ctx.fillStyle = 'rgba(255,255,255,1)';
      this.ctx.fillRect(0, 0, COLS * BLOCK_SIZE, ROWS * BLOCK_SIZE);
      this.ctx.globalAlpha = 1;
    }

    if (now < this._fx.garbageInUntil) {
      this.ctx.globalAlpha = 0.12;
      this.ctx.fillStyle = 'rgba(255,0,180,1)';
      this.ctx.fillRect(0, 0, COLS * BLOCK_SIZE, ROWS * BLOCK_SIZE);
      this.ctx.globalAlpha = 1;
    }

    if (now < this._fx.garbageApplyUntil) {
      this.ctx.globalAlpha = 0.10;
      this.ctx.fillStyle = 'rgba(255,80,0,1)';
      this.ctx.fillRect(0, 0, COLS * BLOCK_SIZE, ROWS * BLOCK_SIZE);
      this.ctx.globalAlpha = 1;
    }
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
    this._clearAndFill(this.holdCtx, this.holdCanvas.width, this.holdCanvas.height);
    if (piece) this.drawPreviewPiece(this.holdCtx, piece, this.holdCanvas.width, this.holdCanvas.height);
  }

  drawQueue(queue) {
    this._clearAndFill(this.queueCtx, this.queueCanvas.width, this.queueCanvas.height);
    for (let i = 0; i < Math.min(6, queue.length); i++) {
      this.drawPreviewPiece(this.queueCtx, queue[i], this.queueCanvas.width, 80, 0, i * 80);
    }
  }

  flashClear(lines = 1) {
    const now = performance.now();
    const l = Math.max(1, Math.min(4, Number(lines) || 1));
    this._fx.clearUntil = now + 120;
    this._fx.clearStrength = 0.10 + (l - 1) * 0.05;
    this.shake(70, 2 + l); // tiny punch
  }

  flashGarbageIn() {
    const now = performance.now();
    this._fx.garbageInUntil = now + 120;
    this.shake(90, 4);
  }

  flashGarbageApply() {
    const now = performance.now();
    this._fx.garbageApplyUntil = now + 140;
    this.shake(120, 5);
  }

  shake(durationMs = 80, magnitude = 4) {
    const now = performance.now();
    this._fx.shakeUntil = Math.max(this._fx.shakeUntil, now + durationMs);
    this._fx.shakeMag = Math.max(this._fx.shakeMag, magnitude);
  }
}
