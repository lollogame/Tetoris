'use strict';

/* =========================================================
   Renderer
========================================================= */
class TetrisRenderer {
  constructor(canvas, holdCanvas, queueCanvas){
    this.canvas=canvas; this.holdCanvas=holdCanvas; this.queueCanvas=queueCanvas;
    this.ctx=canvas.getContext('2d');
    this.holdCtx=holdCanvas.getContext('2d');
    this.queueCtx=queueCanvas.getContext('2d');
  }

  drawBlock(x,y,color,alpha=1){
    this.ctx.fillStyle=color;
    this.ctx.globalAlpha=alpha;
    this.ctx.fillRect(x+1,y+1,BLOCK_SIZE-2,BLOCK_SIZE-2);
    this.ctx.fillStyle='rgba(255,255,255,0.3)';
    this.ctx.fillRect(x+2,y+2,BLOCK_SIZE-4,6);
    this.ctx.fillStyle='rgba(0,0,0,0.3)';
    this.ctx.fillRect(x+2,y+BLOCK_SIZE-8,BLOCK_SIZE-4,6);
    this.ctx.globalAlpha=1;
  }

  drawBoard(board){
    this.ctx.fillStyle='#0a0e27';
    this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height);

    this.ctx.strokeStyle='rgba(139,157,195,0.1)';
    this.ctx.lineWidth=1;

    for(let i=0;i<=COLS;i++){
      this.ctx.beginPath();
      this.ctx.moveTo(i*BLOCK_SIZE,0);
      this.ctx.lineTo(i*BLOCK_SIZE,ROWS*BLOCK_SIZE);
      this.ctx.stroke();
    }
    for(let i=0;i<=ROWS;i++){
      this.ctx.beginPath();
      this.ctx.moveTo(0,i*BLOCK_SIZE);
      this.ctx.lineTo(COLS*BLOCK_SIZE,i*BLOCK_SIZE);
      this.ctx.stroke();
    }

    for(let r=0;r<ROWS;r++){
      for(let c=0;c<COLS;c++){
        if(board[r][c]){
          const v=board[r][c];
          const color = v==='G' ? '#666666' : SHAPES[v].color;
          this.drawBlock(c*BLOCK_SIZE,r*BLOCK_SIZE,color,1);
        }
      }
    }
  }

  drawPiece(piece,x,y,rot,alpha=1){
    const shape=SHAPES[piece].shape[rot];
    const color=SHAPES[piece].color;
    for(let r=0;r<shape.length;r++){
      for(let c=0;c<shape[r].length;c++){
        if(shape[r][c]){
          this.drawBlock((x+c)*BLOCK_SIZE,(y+r)*BLOCK_SIZE,color,alpha);
        }
      }
    }
  }

  drawGhostPiece(piece,x,ghostY,rot){ this.drawPiece(piece,x,ghostY,rot,0.3); }

  drawPreviewPiece(ctx,piece,containerW,containerH,offsetX=0,offsetY=0){
    const shape=SHAPES[piece].shape[0];
    const color=SHAPES[piece].color;
    const pw=shape[0].length*PREVIEW_BLOCK_SIZE;
    const ph=shape.length*PREVIEW_BLOCK_SIZE;
    const x=offsetX+(containerW-pw)/2;
    const y=offsetY+(containerH-ph)/2;
    for(let r=0;r<shape.length;r++){
      for(let c=0;c<shape[r].length;c++){
        if(shape[r][c]){
          ctx.fillStyle=color;
          ctx.fillRect(x+c*PREVIEW_BLOCK_SIZE,y+r*PREVIEW_BLOCK_SIZE,PREVIEW_BLOCK_SIZE-1,PREVIEW_BLOCK_SIZE-1);
        }
      }
    }
  }

  drawHold(piece){
    this.holdCtx.fillStyle='#0a0e27';
    this.holdCtx.fillRect(0,0,this.holdCanvas.width,this.holdCanvas.height);
    if(piece) this.drawPreviewPiece(this.holdCtx,piece,this.holdCanvas.width,this.holdCanvas.height);
  }

  drawQueue(queue){
    this.queueCtx.fillStyle='#0a0e27';
    this.queueCtx.fillRect(0,0,this.queueCanvas.width,this.queueCanvas.height);
    for(let i=0;i<Math.min(6,queue.length);i++){
      this.drawPreviewPiece(this.queueCtx,queue[i],this.queueCanvas.width,80,0,i*80);
    }
  }
}
