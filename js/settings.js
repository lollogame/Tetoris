'use strict';

/* =========================================================
   Settings
========================================================= */
class GameSettings {
  static instance = null;

  constructor() {
    this.arr = 0;
    this.das = 167;
    this.dcd = 0;
    this.sdf = 6;              // number or 'inf'
    this.preventMissdrop = true;
    this.screenShake = true;
    this.volumeMaster = 100;
    this.volumeSfx = 100;
    this.volumeMusic = 70;
  
    // Persistence
    this._storageKey = 'tetoris_settings_v1';
    this._uiWired = false;
    this.loadFromStorage();
    this.applyAudioSettings();
}

  static getInstance() {
    if (!GameSettings.instance) GameSettings.instance = new GameSettings();
    return GameSettings.instance;
  }

  _int(id, def, min = -Infinity, max = Infinity) {
    const el = document.getElementById(id);
    const raw = el ? el.value : '';
    const v = parseInt(raw, 10);
    if (!Number.isFinite(v)) return def;
    return Math.min(max, Math.max(min, v));
  }

  _floatStr(str, def, min = -Infinity, max = Infinity) {
    const v = parseFloat(str);
    if (!Number.isFinite(v)) return def;
    return Math.min(max, Math.max(min, v));
  }

  _setPercentLabel(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = `${Math.max(0, Math.min(100, Number(value) || 0))}%`;
  }

  _setTooltipForControl(controlId, text) {
    const el = document.getElementById(controlId);
    if (!el) return;
    el.title = text;

    const wrapper = el.closest('.control-item');
    if (!wrapper) return;
    const label = wrapper.querySelector('label');
    if (label) label.title = text;
  }

  applyAudioSettings() {
    if (typeof SFX === 'undefined' || typeof SFX.setVolumes !== 'function') return;
    SFX.setVolumes(this.volumeMaster, this.volumeSfx, this.volumeMusic);
  }

  applyTooltips() {
    const tips = {
      matchFormat: 'How many rounds are needed to win the match. Infinite has no cap.',
      countdownSeconds: 'Countdown length before each round starts.',
      keyLeft: 'Primary move-left keybind.',
      keyRight: 'Primary move-right keybind.',
      keySoftDrop: 'Soft drop keybind. Holds to accelerate gravity.',
      keyHardDrop: 'Hard drop keybind. Instant lock and next piece spawn.',
      keyRotateCW: 'Rotate clockwise keybind.',
      keyRotateCCW: 'Rotate counterclockwise keybind.',
      keyRotate180: 'Rotate 180 degrees keybind.',
      keyHold: 'Hold/swap keybind. Hold can be used once per piece.',
      arr: 'Auto Repeat Rate in milliseconds. 0 means instant side movement repeat.',
      das: 'Delayed Auto Shift in milliseconds before side movement starts repeating.',
      dcd: 'Delayed Charge Delay in milliseconds before DAS can charge after lock.',
      sdf: 'Soft Drop Factor. Higher values increase soft-drop speed.',
      preventMissdrop: 'Legacy safety toggle. Hard-drop cooldown is disabled by gameplay patch.',
      volumeMaster: 'Master volume for all audio channels.',
      volumeSfx: 'Sound effects volume.',
      volumeMusic: 'Music channel volume (reserved for background music).',
      screenShake: 'Enable or disable board shake effects on clears and garbage hits.',
    };

    for (const id of Object.keys(tips)) {
      this._setTooltipForControl(id, tips[id]);
    }

    const resetBtn = document.getElementById('resetKeybindsBtn');
    if (resetBtn) resetBtn.title = 'Restore all keybinds to default values.';
  }


  loadFromStorage() {
    try {
      const raw = localStorage.getItem(this._storageKey);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (!s || typeof s !== 'object') return;

      if (Number.isFinite(s.arr)) this.arr = Math.min(200, Math.max(0, s.arr));
      if (Number.isFinite(s.das)) this.das = Math.min(500, Math.max(0, s.das));
      if (Number.isFinite(s.dcd)) this.dcd = Math.min(100, Math.max(0, s.dcd));

      if (s.sdf === 'inf') this.sdf = 'inf';
      else if (Number.isFinite(s.sdf)) this.sdf = Math.min(999999, Math.max(1, s.sdf));

      if (typeof s.preventMissdrop === 'boolean') this.preventMissdrop = s.preventMissdrop;
      if (typeof s.screenShake === 'boolean') this.screenShake = s.screenShake;
      if (Number.isFinite(s.volumeMaster)) this.volumeMaster = Math.min(100, Math.max(0, Math.trunc(s.volumeMaster)));
      if (Number.isFinite(s.volumeSfx)) this.volumeSfx = Math.min(100, Math.max(0, Math.trunc(s.volumeSfx)));
      if (Number.isFinite(s.volumeMusic)) this.volumeMusic = Math.min(100, Math.max(0, Math.trunc(s.volumeMusic)));
    } catch (_) {
      // ignore
    }
  }

  saveToStorage() {
    try {
      localStorage.setItem(this._storageKey, JSON.stringify({
        arr: this.arr,
        das: this.das,
        dcd: this.dcd,
        sdf: this.sdf,
        preventMissdrop: this.preventMissdrop,
        screenShake: this.screenShake,
        volumeMaster: this.volumeMaster,
        volumeSfx: this.volumeSfx,
        volumeMusic: this.volumeMusic,
      }));
    } catch (_) {
      // ignore
    }
  }

  applyToUI() {
    const setVal = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.value = String(v);
    };

    setVal('arr', this.arr);
    setVal('das', this.das);
    setVal('dcd', this.dcd);
    setVal('sdf', this.sdf === 'inf' ? 'inf' : this.sdf);
    setVal('volumeMaster', this.volumeMaster);
    setVal('volumeSfx', this.volumeSfx);
    setVal('volumeMusic', this.volumeMusic);
    const pm = document.getElementById('preventMissdrop');
    if (pm) pm.value = this.preventMissdrop ? 'true' : 'false';
    const ss = document.getElementById('screenShake');
    if (ss) ss.value = this.screenShake ? 'true' : 'false';

    this._setPercentLabel('volumeMasterValue', this.volumeMaster);
    this._setPercentLabel('volumeSfxValue', this.volumeSfx);
    this._setPercentLabel('volumeMusicValue', this.volumeMusic);
    this.applyTooltips();
    this.applyAudioSettings();
  }

  update() {
    this.arr = this._int('arr', 0, 0, 200);
    this.das = this._int('das', 167, 0, 500);
    this.dcd = this._int('dcd', 0, 0, 100);

    const sdfEl = document.getElementById('sdf');
    const rawSdf = sdfEl ? sdfEl.value : '6';

    if (rawSdf === 'inf') {
      this.sdf = 'inf';
    } else {
      this.sdf = this._floatStr(rawSdf, 6, 1, 999999);
    }

    const pmEl = document.getElementById('preventMissdrop');
    const rawPM = pmEl ? pmEl.value : 'true';
    this.preventMissdrop = (rawPM === 'true');

    const ssEl = document.getElementById('screenShake');
    const rawSS = ssEl ? ssEl.value : 'true';
    this.screenShake = (rawSS === 'true');

    this.volumeMaster = this._int('volumeMaster', this.volumeMaster, 0, 100);
    this.volumeSfx = this._int('volumeSfx', this.volumeSfx, 0, 100);
    this.volumeMusic = this._int('volumeMusic', this.volumeMusic, 0, 100);

    this._setPercentLabel('volumeMasterValue', this.volumeMaster);
    this._setPercentLabel('volumeSfxValue', this.volumeSfx);
    this._setPercentLabel('volumeMusicValue', this.volumeMusic);
    this.applyAudioSettings();
    this.saveToStorage();
  }

  initPersistence() {
    if (this._uiWired) return;
    this._uiWired = true;

    const watchedIds = [
      'arr', 'das', 'dcd', 'sdf', 'preventMissdrop',
      'volumeMaster', 'volumeSfx', 'volumeMusic', 'screenShake',
      'matchFormat', 'countdownSeconds',
      'keyLeft', 'keyRight', 'keySoftDrop', 'keyHardDrop',
      'keyRotateCW', 'keyRotateCCW', 'keyRotate180', 'keyHold',
    ];

    const onAnyChange = () => this.update();
    for (const id of watchedIds) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.addEventListener('change', onAnyChange);
      if (el.tagName === 'INPUT' && el.type === 'range') {
        el.addEventListener('input', onAnyChange);
      }
    }

    this.applyTooltips();
    this.applyToUI();
  }
}
