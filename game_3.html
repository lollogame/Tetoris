// Game Constants
const COLS = 10;
const ROWS = 20;
const BLOCK_SIZE = 32;
const PREVIEW_BLOCK_SIZE = 16;

// Seeded Random Number Generator for synchronized piece generation
class SeededRandom {
    constructor(seed) {
        this.seed = seed;
    }
    
    next() {
        this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
        return this.seed / 0x7fffffff;
    }
    
    nextInt(max) {
        return Math.floor(this.next() * max);
    }
}

// Game seed - will be shared between players
let gameSeed = null;

// PeerJS connection
let peer = null;
let conn = null;
let isHost = false;
let myPeerId = null;

// SRS Kick Table
const KICK_TABLE = {
    'JLSTZ': {
        '0->R': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
        'R->0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
        'R->2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
        '2->R': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
        '2->L': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
        'L->2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
        'L->0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
        '0->L': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]]
    },
    'I': {
        '0->R': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
        'R->0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
        'R->2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
        '2->R': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
        '2->L': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
        'L->2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
        'L->0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
        '0->L': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]]
    },
    'O': {
        '0->R': [[0, 0]], 'R->0': [[0, 0]], 'R->2': [[0, 0]], '2->R': [[0, 0]],
        '2->L': [[0, 0]], 'L->2': [[0, 0]], 'L->0': [[0, 0]], '0->L': [[0, 0]]
    }
};

// Tetromino shapes and colors
const SHAPES = {
    'I': {
        shape: [
            [[0,0,0,0], [1,1,1,1], [0,0,0,0], [0,0,0,0]],
            [[0,0,1,0], [0,0,1,0], [0,0,1,0], [0,0,1,0]],
            [[0,0,0,0], [0,0,0,0], [1,1,1,1], [0,0,0,0]],
            [[0,1,0,0], [0,1,0,0], [0,1,0,0], [0,1,0,0]]
        ],
        color: '#00f0f0'
    },
    'O': {
        shape: [[[1,1], [1,1]], [[1,1], [1,1]], [[1,1], [1,1]], [[1,1], [1,1]]],
        color: '#f0f000'
    },
    'T': {
        shape: [
            [[0,1,0], [1,1,1], [0,0,0]],
            [[0,1,0], [0,1,1], [0,1,0]],
            [[0,0,0], [1,1,1], [0,1,0]],
            [[0,1,0], [1,1,0], [0,1,0]]
        ],
        color: '#a000f0'
    },
    'S': {
        shape: [
            [[0,1,1], [1,1,0], [0,0,0]],
            [[0,1,0], [0,1,1], [0,0,1]],
            [[0,0,0], [0,1,1], [1,1,0]],
            [[1,0,0], [1,1,0], [0,1,0]]
        ],
        color: '#00f000'
    },
    'Z': {
        shape: [
            [[1,1,0], [0,1,1], [0,0,0]],
            [[0,0,1], [0,1,1], [0,1,0]],
            [[0,0,0], [1,1,0], [0,1,1]],
            [[0,1,0], [1,1,0], [1,0,0]]
        ],
        color: '#f00000'
    },
    'J': {
        shape: [
            [[1,0,0], [1,1,1], [0,0,0]],
            [[0,1,1], [0,1,0], [0,1,0]],
            [[0,0,0], [1,1,1], [0,0,1]],
            [[0,1,0], [0,1,0], [1,1,0]]
        ],
        color: '#0000f0'
    },
    'L': {
        shape: [
            [[0,0,1], [1,1,1], [0,0,0]],
            [[0,1,0], [0,1,0], [0,1,1]],
            [[0,0,0], [1,1,1], [1,0,0]],
            [[1,1,0], [0,1,0], [0,1,0]]
        ],
        color: '#f0a000'
    }
};

// Game State
class GameState {
    constructor(canvasId, holdCanvasId, queueCanvasId, playerId, seed) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.holdCanvas = document.getElementById(holdCanvasId);
        this.holdCtx = this.holdCanvas.getContext('2d');
        this.queueCanvas = document.getElementById(queueCanvasId);
        this.queueCtx = this.queueCanvas.getContext('2d');
        this.playerId = playerId;
        
        this.rng = new SeededRandom(seed);
        
        this.board = Array(ROWS).fill(null).map(() => Array(COLS).fill(0));
        this.currentPiece = null;
        this.currentX = 0;
        this.currentY = 0;
        this.currentRotation = 0;
        this.holdPiece = null;
        this.canHold = true;
        this.bag = [];
        this.queue = [];
        this.gravity = 1000;
        this.lastGravityTime = 0;
        this.gameStartTime = Date.now();
        
        this.lockDelay = 500;
        this.lockDelayTimer = 0;
        this.isTouchingGround = false;
        this.maxLockResets = 15;
        this.lockResetCount = 0;
        this.hardDropLockout = 0; // Only blocks hard drop, not other inputs
        
        this.piecesPlaced = 0;
        this.attacksSent = 0;
        this.b2bCounter = 0;
        this.comboCounter = -1;
        this.lastClearWasB2B = false;
        
        // Movement handling (millisecond-based)
        this.dasLeft = 0;
        this.dasRight = 0;
        this.arrLeft = 0;
        this.arrRight = 0;
        this.sdDas = 0;
        this.sdArr = 0;
        
        // Initial action states
        this.pendingIRS = null;
        this.pendingIHS = false;
        this.pendingIMS = 0;
        
        this.pendingGarbage = [];
        
        this.initQueue();
    }
    
    initQueue() {
        for (let i = 0; i < 6; i++) {
            this.queue.push(this.getNextPiece());
        }
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
    
    getSpawnColumn(pieceType) {
        const spawnColumns = {
            'O': 4, 'T': 3, 'Z': 3, 'I': 3, 'L': 3, 'J': 3, 'S': 3
        };
        return spawnColumns[pieceType] || 3;
    }
    
    spawnPiece() {
        const pieceType = this.queue.shift();
        this.queue.push(this.getNextPiece());
        this.currentPiece = pieceType;
        this.currentRotation = 0;
        this.currentX = this.getSpawnColumn(pieceType);
        this.currentY = 0;
        this.canHold = true;
        this.lockDelayTimer = 0;
        this.lockResetCount = 0;
        this.isTouchingGround = false;
        
        // Apply Initial Movement System (IMS)
        if (document.getElementById('ims').value === 'true' && this.pendingIMS !== 0) {
            this.currentX += this.pendingIMS;
            if (!this.isValidPosition(this.currentX, this.currentY, this.currentRotation)) {
                this.currentX -= this.pendingIMS;
            }
        }
        
        // Apply Initial Rotation System (IRS)
        if (document.getElementById('irs').value === 'true' && this.pendingIRS) {
            this.rotate(this.pendingIRS);
        }
        
        // Apply Initial Hold System (IHS)
        if (document.getElementById('ihs').value === 'true' && this.pendingIHS) {
            this.holdCurrentPiece();
            this.pendingIHS = false;
        }
        
        // Reset DAS if DAS Cut is enabled
        if (document.getElementById('dasCut').value === 'true') {
            this.dasLeft = 0;
            this.dasRight = 0;
            this.arrLeft = 0;
            this.arrRight = 0;
        }
        
        return true;
    }
    
    isValidPosition(x, y, rotation) {
        const shape = SHAPES[this.currentPiece].shape[rotation];
        for (let row = 0; row < shape.length; row++) {
            for (let col = 0; col < shape[row].length; col++) {
                if (shape[row][col]) {
                    const newX = x + col;
                    const newY = y + row;
                    if (newX < 0 || newX >= COLS || newY >= ROWS) return false;
                    if (newY >= 0 && this.board[newY][newX]) return false;
                }
            }
        }
        return true;
    }
    
    rotate(direction) {
        const oldRotation = this.currentRotation;
        let newRotation;
        
        if (direction === 'cw') newRotation = (oldRotation + 1) % 4;
        else if (direction === 'ccw') newRotation = (oldRotation + 3) % 4;
        else if (direction === '180') newRotation = (oldRotation + 2) % 4;
        
        const kickTable = ['I'].includes(this.currentPiece) ? KICK_TABLE.I : 
                           this.currentPiece === 'O' ? KICK_TABLE.O : KICK_TABLE.JLSTZ;
        const rotations = ['0', 'R', '2', 'L'];
        const kickKey = `${rotations[oldRotation]}->${rotations[newRotation]}`;
        const kicks = kickTable[kickKey] || [[0, 0]];
        
        for (const [dx, dy] of kicks) {
            if (this.isValidPosition(this.currentX + dx, this.currentY - dy, newRotation)) {
                this.currentX += dx;
                this.currentY -= dy;
                this.currentRotation = newRotation;
                if (this.isTouchingGround && this.lockResetCount < this.maxLockResets) {
                    this.lockDelayTimer = 0;
                    this.lockResetCount++;
                }
                return true;
            }
        }
        return false;
    }
    
    move(dx) {
        if (this.isValidPosition(this.currentX + dx, this.currentY, this.currentRotation)) {
            this.currentX += dx;
            if (this.isTouchingGround && this.lockResetCount < this.maxLockResets) {
                this.lockDelayTimer = 0;
                this.lockResetCount++;
            }
            return true;
        }
        return false;
    }
    
    softDrop() {
        const sdf = document.getElementById('sdf').value;
        const multiplier = sdf === 'inf' ? Infinity : parseFloat(sdf);
        
        if (multiplier === Infinity) {
            while (this.isValidPosition(this.currentX, this.currentY + 1, this.currentRotation)) {
                this.currentY++;
            }
            return true;
        } else {
            if (this.isValidPosition(this.currentX, this.currentY + 1, this.currentRotation)) {
                this.currentY++;
                return true;
            }
        }
        return false;
    }
    
    hardDrop() {
        // Only block hard drop with DCD, not other inputs
        if (this.hardDropLockout > 0) return true;
        
        while (this.isValidPosition(this.currentX, this.currentY + 1, this.currentRotation)) {
            this.currentY++;
        }
        return this.lockPiece();
    }
    
    lockPiece() {
        const pieceType = this.currentPiece;
        const pieceX = this.currentX;
        const pieceY = this.currentY;
        const pieceRotation = this.currentRotation;
        
        const shape = SHAPES[this.currentPiece].shape[this.currentRotation];
        
        for (let row = 0; row < shape.length; row++) {
            for (let col = 0; col < shape[row].length; col++) {
                if (shape[row][col]) {
                    const boardY = this.currentY + row;
                    const boardX = this.currentX + col;
                    
                    if (boardY >= 0 && this.board[boardY][boardX]) {
                        return false;
                    }
                    
                    if (boardY >= 0) {
                        this.board[boardY][boardX] = this.currentPiece;
                    }
                }
            }
        }
        
        this.piecesPlaced++;
        
        // Set hard drop lockout (DCD) - only affects hard drop
        const dcdValue = parseInt(document.getElementById('dcd').value);
        this.hardDropLockout = dcdValue;
        
        this.lockDelayTimer = 0;
        this.lockResetCount = 0;
        this.isTouchingGround = false;
        
        this.clearLines(pieceType, pieceX, pieceY, pieceRotation);
        return true;
    }
    
    clearLines(lastPieceType, lastPieceX, lastPieceY, lastPieceRotation) {
        const clearedRows = [];
        
        for (let row = 0; row < ROWS; row++) {
            if (this.board[row].every(cell => cell !== 0)) {
                clearedRows.push(row);
            }
        }
        
        const linesCleared = clearedRows.length;
        
        if (linesCleared > 0) {
            for (let i = clearedRows.length - 1; i >= 0; i--) {
                this.board.splice(clearedRows[i], 1);
            }
            
            for (let i = 0; i < linesCleared; i++) {
                this.board.unshift(Array(COLS).fill(0));
            }
            
            const isSpin = this.checkSpin(lastPieceType, lastPieceX, lastPieceY, lastPieceRotation);
            const isAllClear = this.board.every(row => row.every(cell => cell === 0));
            let attack = this.calculateAttack(linesCleared, isSpin, isAllClear, lastPieceType);
            
            const isB2BMove = linesCleared === 4 || isSpin;
            if (isB2BMove) {
                if (this.lastClearWasB2B) {
                    this.b2bCounter++;
                    // B2B bonus: +1 for each B2B clear
                    attack += 1;
                } else {
                    this.b2bCounter = 1;
                }
                this.lastClearWasB2B = true;
            } else {
                this.b2bCounter = 0;
                this.lastClearWasB2B = false;
            }
            
            this.comboCounter++;
            // Combo table: starts at combo 1
            if (this.comboCounter >= 1) {
                const comboTable = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5];
                const comboBonus = this.comboCounter < comboTable.length ? 
                    comboTable[this.comboCounter] : 5;
                attack += comboBonus;
            }
            
            // Garbage canceling
            if (this.pendingGarbage.length > 0) {
                let totalPending = this.pendingGarbage.reduce((sum, g) => sum + g.lines, 0);
                
                if (attack >= totalPending) {
                    attack -= totalPending;
                    this.pendingGarbage = [];
                    addChatMessage(`Canceled ${totalPending} garbage lines!`, 'System');
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
                    addChatMessage(`Canceled ${attack} garbage lines!`, 'System');
                    attack = 0;
                }
            }
            
            this.attacksSent += attack;
            
            // Send attack if > 0
            if (attack > 0) {
                this.sendAttack(attack);
                console.log(`Sending ${attack} lines of attack`);
            }
        } else {
            this.comboCounter = -1;
            
            if (this.pendingGarbage.length > 0) {
                this.applyGarbage();
            }
        }
        
        this.updateStats();
    }
    
    checkSpin(pieceType, pieceX, pieceY, pieceRotation) {
        if (pieceType === 'T') {
            return this.checkTSpin(pieceX, pieceY);
        }
        return false;
    }
    
    checkTSpin(pieceX, pieceY) {
        const corners = [
            [pieceX, pieceY],
            [pieceX + 2, pieceY],
            [pieceX, pieceY + 2],
            [pieceX + 2, pieceY + 2]
        ];
        
        let filledCorners = 0;
        for (const [x, y] of corners) {
            if (x < 0 || x >= COLS || y < 0 || y >= ROWS || this.board[y][x]) {
                filledCorners++;
            }
        }
        
        return filledCorners >= 3;
    }
    
    calculateAttack(lines, isSpin, isAllClear, pieceType) {
        let attack = 0;
        
        if (isAllClear) {
            // Perfect clear bonus
            attack = lines === 1 ? 10 : lines === 2 ? 12 : lines === 3 ? 14 : 18;
        } else if (pieceType === 'T' && isSpin) {
            // T-Spin attack values
            if (lines === 1) attack = 2;      // T-Spin Single: 2 lines
            else if (lines === 2) attack = 4; // T-Spin Double: 4 lines
            else if (lines === 3) attack = 6; // T-Spin Triple: 6 lines
            else attack = 0; // T-Spin Mini (0 lines cleared)
        } else if (isSpin) {
            // Other spin bonuses
            attack = lines * 2;
        } else {
            // Regular line clears
            if (lines === 1) attack = 0;      // Single: 0 lines
            else if (lines === 2) attack = 1; // Double: 1 line
            else if (lines === 3) attack = 2; // Triple: 2 lines
            else if (lines === 4) attack = 4; // Quad: 4 lines
        }
        
        return attack;
    }
    
    sendAttack(lines) {
        if (conn && conn.open && lines > 0) {
            // Don't cap - send full attack
            conn.send({
                type: 'attack',
                lines: lines
            });
        }
    }
    
    receiveAttack(lines) {
        this.pendingGarbage.push({
            lines: lines,
            hole: this.rng.nextInt(COLS)
        });
        console.log(`Received ${lines} lines of garbage, total pending: ${this.pendingGarbage.reduce((sum, g) => sum + g.lines, 0)}`);
    }
    
    applyGarbage() {
        if (this.pendingGarbage.length === 0) return;
        
        let totalLines = 0;
        let alignedHole = null;
        
        for (const garbage of this.pendingGarbage) {
            totalLines += garbage.lines;
            
            if (garbage.lines >= 2) {
                alignedHole = garbage.hole;
            }
        }
        
        for (let i = 0; i < totalLines && i < ROWS; i++) {
            this.board.shift();
        }
        
        let linesAdded = 0;
        for (const garbage of this.pendingGarbage) {
            const useAlignedHole = garbage.lines >= 2;
            const hole = useAlignedHole && alignedHole !== null ? alignedHole : this.rng.nextInt(COLS);
            
            for (let i = 0; i < garbage.lines && linesAdded < totalLines; i++) {
                const garbageLine = Array(COLS).fill('G');
                garbageLine[hole] = 0;
                this.board.push(garbageLine);
                linesAdded++;
            }
        }
        
        addChatMessage(`Received ${totalLines} garbage lines!`, 'System');
        this.pendingGarbage = [];
    }
    
    holdCurrentPiece() {
        if (!this.canHold) return false;
        
        if (this.holdPiece === null) {
            this.holdPiece = this.currentPiece;
            this.spawnPiece();
        } else {
            const temp = this.holdPiece;
            this.holdPiece = this.currentPiece;
            this.currentPiece = temp;
            this.currentRotation = 0;
            this.currentX = this.getSpawnColumn(temp);
            this.currentY = 0;
        }
        
        this.canHold = false;
        return true;
    }
    
    updateStats() {
        const elapsed = (Date.now() - this.gameStartTime) / 1000;
        const pps = this.piecesPlaced / elapsed;
        const apm = (this.attacksSent / elapsed) * 60;
        
        document.getElementById(`pps${this.playerId}`).textContent = pps.toFixed(2);
        document.getElementById(`apm${this.playerId}`).textContent = apm.toFixed(2);
        document.getElementById(`b2b${this.playerId}`).textContent = this.b2bCounter;
        document.getElementById(`combo${this.playerId}`).textContent = Math.max(0, this.comboCounter);
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
            b2bCounter: this.b2bCounter,
            comboCounter: this.comboCounter
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
        this.b2bCounter = state.b2bCounter;
        this.comboCounter = state.comboCounter;
        
        const elapsed = (Date.now() - this.gameStartTime) / 1000;
        const pps = this.piecesPlaced / elapsed;
        const apm = (this.attacksSent / elapsed) * 60;
        
        document.getElementById(`pps${this.playerId}`).textContent = pps.toFixed(2);
        document.getElementById(`apm${this.playerId}`).textContent = apm.toFixed(2);
        document.getElementById(`b2b${this.playerId}`).textContent = this.b2bCounter;
        document.getElementById(`combo${this.playerId}`).textContent = Math.max(0, this.comboCounter);
    }
    
    draw() {
        this.ctx.fillStyle = '#0a0e27';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.ctx.strokeStyle = 'rgba(139, 157, 195, 0.1)';
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
        
        for (let row = 0; row < ROWS; row++) {
            for (let col = 0; col < COLS; col++) {
                if (this.board[row][col]) {
                    const color = this.board[row][col] === 'G' ? '#666666' : 
                                 SHAPES[this.board[row][col]].color;
                    this.drawBlock(this.ctx, col * BLOCK_SIZE, row * BLOCK_SIZE, color);
                }
            }
        }
        
        if (this.currentPiece) {
            let ghostY = this.currentY;
            while (this.isValidPosition(this.currentX, ghostY + 1, this.currentRotation)) {
                ghostY++;
            }
            this.drawPiece(this.ctx, this.currentPiece, this.currentX, ghostY, 
                          this.currentRotation, 0.3);
        }
        
        if (this.currentPiece) {
            this.drawPiece(this.ctx, this.currentPiece, this.currentX, this.currentY, 
                          this.currentRotation);
        }
        
        this.drawHold();
        this.drawQueue();
    }
    
    drawBlock(ctx, x, y, color, alpha = 1.0) {
        ctx.fillStyle = color;
        ctx.globalAlpha = alpha;
        ctx.fillRect(x + 1, y + 1, BLOCK_SIZE - 2, BLOCK_SIZE - 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.fillRect(x + 2, y + 2, BLOCK_SIZE - 4, 6);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(x + 2, y + BLOCK_SIZE - 8, BLOCK_SIZE - 4, 6);
        ctx.globalAlpha = 1.0;
    }
    
    drawPiece(ctx, pieceType, x, y, rotation, alpha = 1.0) {
        const shape = SHAPES[pieceType].shape[rotation];
        const color = SHAPES[pieceType].color;
        
        for (let row = 0; row < shape.length; row++) {
            for (let col = 0; col < shape[row].length; col++) {
                if (shape[row][col]) {
                    this.drawBlock(ctx, (x + col) * BLOCK_SIZE, 
                                 (y + row) * BLOCK_SIZE, color, alpha);
                }
            }
        }
    }
    
    drawHold() {
        this.holdCtx.fillStyle = '#0a0e27';
        this.holdCtx.fillRect(0, 0, this.holdCanvas.width, this.holdCanvas.height);
        
        if (this.holdPiece) {
            const shape = SHAPES[this.holdPiece].shape[0];
            const color = SHAPES[this.holdPiece].color;
            const offsetX = (this.holdCanvas.width - shape[0].length * PREVIEW_BLOCK_SIZE) / 2;
            const offsetY = (this.holdCanvas.height - shape.length * PREVIEW_BLOCK_SIZE) / 2;
            
            for (let row = 0; row < shape.length; row++) {
                for (let col = 0; col < shape[row].length; col++) {
                    if (shape[row][col]) {
                        this.holdCtx.fillStyle = color;
                        this.holdCtx.fillRect(
                            offsetX + col * PREVIEW_BLOCK_SIZE,
                            offsetY + row * PREVIEW_BLOCK_SIZE,
                            PREVIEW_BLOCK_SIZE - 1,
                            PREVIEW_BLOCK_SIZE - 1
                        );
                    }
                }
            }
        }
    }
    
    drawQueue() {
        this.queueCtx.fillStyle = '#0a0e27';
        this.queueCtx.fillRect(0, 0, this.queueCanvas.width, this.queueCanvas.height);
        
        for (let i = 0; i < 6; i++) {
            const pieceType = this.queue[i];
            const shape = SHAPES[pieceType].shape[0];
            const color = SHAPES[pieceType].color;
            const offsetX = (this.queueCanvas.width - shape[0].length * PREVIEW_BLOCK_SIZE) / 2;
            const offsetY = i * 80 + (80 - shape.length * PREVIEW_BLOCK_SIZE) / 2;
            
            for (let row = 0; row < shape.length; row++) {
                for (let col = 0; col < shape[row].length; col++) {
                    if (shape[row][col]) {
                        this.queueCtx.fillStyle = color;
                        this.queueCtx.fillRect(
                            offsetX + col * PREVIEW_BLOCK_SIZE,
                            offsetY + row * PREVIEW_BLOCK_SIZE,
                            PREVIEW_BLOCK_SIZE - 1,
                            PREVIEW_BLOCK_SIZE - 1
                        );
                    }
                }
            }
        }
    }
}

// Game state instances
let gameState1 = null;
let gameState2 = null;
let gameRunning = false;

// Key bindings
const keyBindings = {
    left: 'ArrowLeft',
    right: 'ArrowRight',
    softDrop: 'ArrowDown',
    hardDrop: ' ',
    rotateCW: 'ArrowUp',
    rotateCCW: 'z',
    rotate180: 'a',
    hold: 'c'
};

// Setup key binding listeners
Object.keys(keyBindings).forEach(action => {
    const input = document.getElementById(`key${action.charAt(0).toUpperCase() + action.slice(1)}`);
    input.addEventListener('click', () => {
        input.value = 'Press a key...';
        const listener = (e) => {
            e.preventDefault();
            keyBindings[action] = e.key;
            input.value = e.key;
            document.removeEventListener('keydown', listener);
        };
        document.addEventListener('keydown', listener);
    });
});

// Chat functions
function addChatMessage(message, sender = 'System') {
    const chatMessages = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message';
    messageDiv.textContent = `${sender}: ${message}`;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

document.getElementById('sendChatBtn').addEventListener('click', () => {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    if (message && conn && conn.open) {
        conn.send({
            type: 'chat',
            message: message
        });
        addChatMessage(message, 'You');
        input.value = '';
    }
});

document.getElementById('chatInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        document.getElementById('sendChatBtn').click();
    }
});

// PeerJS connection functions
function initializePeer() {
    peer = new Peer({
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        }
    });
    
    peer.on('open', (id) => {
        myPeerId = id;
        document.getElementById('peerIdDisplay').textContent = id;
        document.getElementById('myPeerId').classList.remove('hidden');
        addChatMessage(`Your Peer ID: ${id}`);
        addChatMessage('Share this ID with your opponent to let them join!');
    });
    
    peer.on('connection', (connection) => {
        conn = connection;
        setupConnection();
        addChatMessage('Opponent connected!');
        document.getElementById('gameStatus').textContent = 'Connected! Starting game...';
        
        gameSeed = Math.floor(Math.random() * 1000000000);
        addChatMessage(`Generated game seed: ${gameSeed}`, 'System');
        
        setTimeout(() => {
            conn.send({ 
                type: 'start',
                seed: gameSeed 
            });
            startGame();
        }, 1000);
    });
    
    peer.on('error', (err) => {
        console.error('PeerJS error:', err);
        addChatMessage(`Connection error: ${err.type}`);
    });
}

function setupConnection() {
    conn.on('data', (data) => {
        if (data.type === 'chat') {
            addChatMessage(data.message, 'Opponent');
        } else if (data.type === 'attack') {
            if (gameState1) {
                gameState1.receiveAttack(data.lines);
            }
        } else if (data.type === 'start') {
            if (data.seed) {
                gameSeed = data.seed;
                addChatMessage(`Received game seed: ${gameSeed}`, 'System');
            }
            startGame();
        } else if (data.type === 'gameState') {
            if (gameState2) {
                gameState2.setState(data.state);
            }
        } else if (data.type === 'restart') {
            if (data.seed) {
                gameSeed = data.seed;
            }
            restartGame();
        } else if (data.type === 'gameOver') {
            gameRunning = false;
            addChatMessage('Opponent lost! You win! 🎉', 'System');
            document.getElementById('gameStatus').textContent = 'You Win! 🏆';
        }
    });
    
    conn.on('close', () => {
        addChatMessage('Opponent disconnected');
        document.getElementById('gameStatus').textContent = 'Opponent disconnected';
        gameRunning = false;
    });
}

function copyPeerId() {
    const peerId = document.getElementById('peerIdDisplay').textContent;
    navigator.clipboard.writeText(peerId).then(() => {
        addChatMessage('Peer ID copied to clipboard!');
    });
}

// Button handlers
document.getElementById('createGameBtn').addEventListener('click', () => {
    if (!peer) {
        initializePeer();
        isHost = true;
        document.getElementById('gameStatus').textContent = 'Waiting for opponent to join...';
        document.getElementById('createGameBtn').disabled = true;
    }
});

document.getElementById('joinGameBtn').addEventListener('click', () => {
    const opponentId = document.getElementById('opponentPeerId').value.trim();
    if (!opponentId) {
        addChatMessage('Please enter an opponent Peer ID');
        return;
    }
    
    if (!peer) {
        initializePeer();
    }
    
    setTimeout(() => {
        conn = peer.connect(opponentId);
        
        conn.on('open', () => {
            setupConnection();
            addChatMessage('Connected to opponent!');
            document.getElementById('gameStatus').textContent = 'Connected! Waiting for host to start...';
            document.getElementById('joinGameBtn').disabled = true;
        });
        
        conn.on('error', (err) => {
            addChatMessage(`Failed to connect: ${err}`);
        });
    }, 1000);
});

document.getElementById('restartBtn').addEventListener('click', () => {
    gameSeed = Math.floor(Math.random() * 1000000000);
    addChatMessage(`New game seed: ${gameSeed}`, 'System');
    
    if (conn && conn.open) {
        conn.send({ 
            type: 'restart',
            seed: gameSeed 
        });
    }
    restartGame();
});

function restartGame() {
    gameRunning = false;
    
    setTimeout(() => {
        startGame();
        addChatMessage('Game restarted!', 'System');
    }, 500);
}

function startGame() {
    gameRunning = true;
    document.getElementById('gameArea').classList.remove('hidden');
    document.getElementById('restartBtn').classList.remove('hidden');
    document.getElementById('gameStatus').textContent = 'Game in progress!';
    
    if (!gameSeed) {
        gameSeed = Math.floor(Math.random() * 1000000000);
        addChatMessage(`Generated game seed: ${gameSeed}`, 'System');
    }
    
    gameState1 = new GameState('gameCanvas1', 'holdCanvas1', 'queueCanvas1', 1, gameSeed);
    gameState2 = new GameState('gameCanvas2', 'holdCanvas2', 'queueCanvas2', 2, gameSeed);
    
    const startTime = Date.now();
    gameState1.gameStartTime = startTime;
    gameState2.gameStartTime = startTime;
    
    gameState1.spawnPiece();
    gameState2.spawnPiece();
    
    addChatMessage('Game started! Good luck!');
    addChatMessage('Enhanced handling enabled!', 'System');
    
    gameLoop();
}

// Game loop
let lastTime = 0;
let lastStateSendTime = 0;
const STATE_SEND_INTERVAL = 50;

function gameLoop(timestamp = 0) {
    if (!gameRunning) return;
    
    const deltaTime = timestamp - lastTime;
    lastTime = timestamp;
    
    // Update Player 1
    if (gameState1) {
        // Countdown hard drop lockout (DCD)
        if (gameState1.hardDropLockout > 0) gameState1.hardDropLockout -= deltaTime;
        
        const wasTouching = gameState1.isTouchingGround;
        gameState1.isTouchingGround = !gameState1.isValidPosition(
            gameState1.currentX, gameState1.currentY + 1, gameState1.currentRotation
        );
        
        if (gameState1.isTouchingGround && !wasTouching) {
            gameState1.lockDelayTimer = 0;
        }
        
        gameState1.lastGravityTime += deltaTime;
        
        if (gameState1.isTouchingGround) {
            gameState1.lockDelayTimer += deltaTime;
            
            if (gameState1.lockDelayTimer >= gameState1.lockDelay || 
                gameState1.lockResetCount >= gameState1.maxLockResets) {
                
                const lockSuccess = gameState1.lockPiece();
                
                if (!lockSuccess) {
                    addChatMessage('You lost! Click Restart to play again.', 'System');
                    document.getElementById('gameStatus').textContent = 'Game Over! You lost.';
                    gameRunning = false;
                    
                    if (conn && conn.open) {
                        conn.send({ type: 'gameOver' });
                    }
                    return;
                }
                
                gameState1.spawnPiece();
                gameState1.lastGravityTime = 0;
            }
        } else {
            if (gameState1.lastGravityTime >= gameState1.gravity) {
                if (gameState1.isValidPosition(gameState1.currentX, gameState1.currentY + 1, 
                                               gameState1.currentRotation)) {
                    gameState1.currentY++;
                }
                gameState1.lastGravityTime = 0;
            }
        }
        
        gameState1.draw();
        
        if (conn && conn.open && timestamp - lastStateSendTime > STATE_SEND_INTERVAL) {
            conn.send({
                type: 'gameState',
                state: gameState1.getState()
            });
            lastStateSendTime = timestamp;
        }
    }
    
    if (gameState2) {
        gameState2.draw();
    }
    
    requestAnimationFrame(gameLoop);
}

// Input handling
const keysHeld = {};

document.addEventListener('keydown', (e) => {
    if (!gameRunning || !gameState1) return;
    
    if (keysHeld[e.key]) return;
    keysHeld[e.key] = true;
    
    // Movement keys
    if (e.key === keyBindings.left) {
        e.preventDefault();
        gameState1.move(-1);
        gameState1.dasLeft = 0;
        gameState1.arrLeft = 0;
        gameState1.pendingIMS = -1;
    } else if (e.key === keyBindings.right) {
        e.preventDefault();
        gameState1.move(1);
        gameState1.dasRight = 0;
        gameState1.arrRight = 0;
        gameState1.pendingIMS = 1;
    } else if (e.key === keyBindings.softDrop) {
        e.preventDefault();
        gameState1.softDrop();
        gameState1.sdDas = 0;
        gameState1.sdArr = 0;
    } else if (e.key === keyBindings.hardDrop) {
        e.preventDefault();
        const success = gameState1.hardDrop();
        
        if (!success) {
            addChatMessage('You lost! Click Restart to play again.', 'System');
            document.getElementById('gameStatus').textContent = 'Game Over! You lost.';
            gameRunning = false;
            
            if (conn && conn.open) {
                conn.send({ type: 'gameOver' });
            }
        } else {
            gameState1.spawnPiece();
        }
    } else if (e.key === keyBindings.rotateCW) {
        e.preventDefault();
        gameState1.rotate('cw');
        gameState1.pendingIRS = 'cw';
    } else if (e.key === keyBindings.rotateCCW) {
        e.preventDefault();
        gameState1.rotate('ccw');
        gameState1.pendingIRS = 'ccw';
    } else if (e.key === keyBindings.rotate180) {
        e.preventDefault();
        gameState1.rotate('180');
        gameState1.pendingIRS = '180';
    } else if (e.key === keyBindings.hold) {
        e.preventDefault();
        gameState1.holdCurrentPiece();
        gameState1.pendingIHS = true;
    }
});

document.addEventListener('keyup', (e) => {
    delete keysHeld[e.key];
    
    if (!gameState1) return;
    
    // Reset pending initial actions when keys are released
    if (e.key === keyBindings.left || e.key === keyBindings.right) {
        gameState1.pendingIMS = 0;
        gameState1.dasLeft = 0;
        gameState1.dasRight = 0;
        gameState1.arrLeft = 0;
        gameState1.arrRight = 0;
    } else if (e.key === keyBindings.rotateCW || e.key === keyBindings.rotateCCW || e.key === keyBindings.rotate180) {
        gameState1.pendingIRS = null;
    } else if (e.key === keyBindings.hold) {
        gameState1.pendingIHS = false;
    } else if (e.key === keyBindings.softDrop) {
        gameState1.sdDas = 0;
        gameState1.sdArr = 0;
    }
});

// Millisecond-based DAS/ARR processing
setInterval(() => {
    if (!gameRunning || !gameState1) return;
    
    const dasDelay = parseInt(document.getElementById('das').value);
    const arrDelay = parseInt(document.getElementById('arr').value);
    const sdDasDelay = parseInt(document.getElementById('sdDas').value);
    const sdArrDelay = parseInt(document.getElementById('sdArr').value);
    
    const intervalMs = 16; // ~16ms per tick
    
    // Horizontal movement DAS/ARR
    if (keysHeld[keyBindings.left]) {
        gameState1.dasLeft += intervalMs;
        if (gameState1.dasLeft >= dasDelay) {
            gameState1.arrLeft += intervalMs;
            if (arrDelay === 0 || gameState1.arrLeft >= arrDelay) {
                gameState1.move(-1);
                gameState1.arrLeft = 0;
            }
        }
    }
    
    if (keysHeld[keyBindings.right]) {
        gameState1.dasRight += intervalMs;
        if (gameState1.dasRight >= dasDelay) {
            gameState1.arrRight += intervalMs;
            if (arrDelay === 0 || gameState1.arrRight >= arrDelay) {
                gameState1.move(1);
                gameState1.arrRight = 0;
            }
        }
    }
    
    // Soft drop DAS/ARR
    if (keysHeld[keyBindings.softDrop]) {
        gameState1.sdDas += intervalMs;
        if (gameState1.sdDas >= sdDasDelay) {
            gameState1.sdArr += intervalMs;
            if (sdArrDelay === 0 || gameState1.sdArr >= sdArrDelay) {
                gameState1.softDrop();
                gameState1.sdArr = 0;
            }
        }
    }
}, 16);

// Initialize
addChatMessage('Welcome to Tetris Online Battle!');
addChatMessage('Enhanced with improved handling and proper attack system!');
addChatMessage('Click "Create Game" to host or enter a Peer ID to join.');
