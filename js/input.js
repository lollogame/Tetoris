'use strict';

/* =========================================================
   Input Manager (USES e.code so ShiftLeft works)
========================================================= */
class InputManager {
  static instance = null;

  constructor() {
    this.heldCodes = {};
    this.lastPressedAt = {};

    this.bindings = {
      left:      'ArrowLeft',
      right:     'ArrowRight',
      softDrop:  'ArrowDown',
      hardDrop:  'Space',
      rotateCW:  'ArrowUp',
      rotateCCW: 'KeyZ',
      rotate180: 'KeyX',
      hold:      'ShiftLeft'
    };

    this.bindingCaptureActive = false;

    this.move = {
      left: false, right: false,
      direction: 0, lastDirection: 0,
      dasTimer: 0, arrTimer: 0, dcdTimer: 0
    };

    this.onMoveImmediate = null;
  }

  static getInstance() {
    if (!InputManager.instance) InputManager.instance = new InputManager();
    return InputManager.instance;
  }

  getBindings() { return this.bindings; }
  getHeldCodes() { return this.heldCodes; }
  getLastPressedAt(code) {
    return Object.prototype.hasOwnProperty.call(this.lastPressedAt, code)
      ? this.lastPressedAt[code]
      : -Infinity;
  }
  isCapturing() { return this.bindingCaptureActive; }
  setCapturing(active) { this.bindingCaptureActive = active; }

  static actionToInputId = {
    left: 'keyLeft',
    right: 'keyRight',
    softDrop: 'keySoftDrop',
    hardDrop: 'keyHardDrop',
    rotateCW: 'keyRotateCW',
    rotateCCW: 'keyRotateCCW',
    rotate180: 'keyRotate180',
    hold: 'keyHold'
  };

  static prettyCode(code) {
    if (code === 'Space') return 'Space';
    if (code === 'ShiftLeft') return 'LShift';
    if (code === 'ShiftRight') return 'RShift';
    if (code.startsWith('Key')) return code.slice(3).toLowerCase();
    return code;
  }

  setupKeyBindings() {
    for (const action of Object.keys(this.bindings)) {
      const inputId = InputManager.actionToInputId[action];
      const el = document.getElementById(inputId);
      if (!el) continue;

      el.value = InputManager.prettyCode(this.bindings[action]);

      el.addEventListener('click', () => {
        this.setCapturing(true);
        el.value = 'Press a key...';

        const capture = (e) => {
          e.preventDefault();
          e.stopPropagation();

          this.bindings[action] = e.code;
          el.value = InputManager.prettyCode(e.code);

          document.removeEventListener('keydown', capture, true);
          this.setCapturing(false);
        };

        document.addEventListener('keydown', capture, true);
      });
    }
  }

  handleKeyDown(code) {
    if (this.heldCodes[code]) return false;
    this.heldCodes[code] = true;
    this.lastPressedAt[code] = performance.now();

    const b = this.bindings;
    if (code === b.left) this.setDirection(-1);
    if (code === b.right) this.setDirection(1);
    return true;
  }

  handleKeyUp(code) {
    delete this.heldCodes[code];

    const b = this.bindings;
    if (code === b.left) this.move.left = false;
    if (code === b.right) this.move.right = false;

    this.recomputeDirection();
  }

  setDirection(dir) {
    if (dir === -1) this.move.left = true;
    if (dir === 1) this.move.right = true;
    this.move.lastDirection = dir;
    this.recomputeDirection(true);
  }

  recomputeDirection(immediate = false) {
    let newDir = 0;
    if (this.move.left && this.move.right) newDir = this.move.lastDirection;
    else if (this.move.left) newDir = -1;
    else if (this.move.right) newDir = 1;

    if (newDir !== this.move.direction) {
      this.move.direction = newDir;
      this.move.dasTimer = 0;
      this.move.arrTimer = 0;
      this.move.dcdTimer = GameSettings.getInstance().dcd;

      if (newDir !== 0 && immediate && this.onMoveImmediate) {
        this.onMoveImmediate(newDir);
      }
    }
  }

  processMovement(deltaTime, moveFn) {
    if (this.move.direction === 0) return;

    const settings = GameSettings.getInstance();

    if (this.move.dcdTimer > 0) {
      this.move.dcdTimer -= deltaTime;
      return;
    }

    this.move.dasTimer += deltaTime;
    if (this.move.dasTimer < settings.das) return;

    if (settings.arr === 0) {
      while (moveFn(this.move.direction)) {}
      return;
    }

    this.move.arrTimer += deltaTime;
    if (this.move.arrTimer >= settings.arr) {
      moveFn(this.move.direction);
      this.move.arrTimer = 0;
    }
  }

  reset() {
    this.move = { left:false, right:false, direction:0, lastDirection:0, dasTimer:0, arrTimer:0, dcdTimer:0 };
    this.heldCodes = {};
    this.lastPressedAt = {};
  }

  resetMovementOnSpawn() {
    this.move.dasTimer = 0;
    this.move.arrTimer = 0;
    this.move.dcdTimer = GameSettings.getInstance().dcd;

    if (this.move.direction !== 0 && this.onMoveImmediate) {
      this.onMoveImmediate(this.move.direction);
    }
  }

  clearCodes(codes) {
    for (const c of codes) {
      if (!c) continue;
      delete this.heldCodes[c];
      delete this.lastPressedAt[c];
    }
  }

  consumeRotationInputs() {
    const b = this.bindings;
    this.clearCodes([b.rotateCW, b.rotateCCW, b.rotate180]);
  }
}
