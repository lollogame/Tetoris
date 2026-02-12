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
  
    // Persistence
    this._storageKey = 'tetoris_settings_v1';
    this.loadFromStorage();
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
    const pm = document.getElementById('preventMissdrop');
    if (pm) pm.value = this.preventMissdrop ? 'true' : 'false';
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
    this.saveToStorage();
  }
}
