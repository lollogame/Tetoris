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
  }

  static getInstance() {
    if (!GameSettings.instance) GameSettings.instance = new GameSettings();
    return GameSettings.instance;
  }

  /* =========================================================
     Persistence (localStorage)
  ========================================================= */
  static STORAGE_KEY = 'tetoris.settings.v1';

  loadFromStorage() {
    try {
      const raw = localStorage.getItem(GameSettings.STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);

      if (data && typeof data === 'object') {
        if (Number.isFinite(data.arr)) this.arr = Math.min(200, Math.max(0, Math.trunc(data.arr)));
        if (Number.isFinite(data.das)) this.das = Math.min(500, Math.max(0, Math.trunc(data.das)));
        if (Number.isFinite(data.dcd)) this.dcd = Math.min(100, Math.max(0, Math.trunc(data.dcd)));

        if (data.sdf === 'inf') {
          this.sdf = 'inf';
        } else if (Number.isFinite(data.sdf)) {
          // allow big but sane values
          this.sdf = Math.min(999999, Math.max(1, Number(data.sdf)));
        }

        if (typeof data.preventMissdrop === 'boolean') {
          this.preventMissdrop = data.preventMissdrop;
        }
      }
    } catch (_) {
      // ignore corrupt storage
    }
  }

  saveToStorage() {
    try {
      const payload = {
        arr: this.arr,
        das: this.das,
        dcd: this.dcd,
        sdf: this.sdf,
        preventMissdrop: this.preventMissdrop
      };
      localStorage.setItem(GameSettings.STORAGE_KEY, JSON.stringify(payload));
    } catch (_) {
      // storage can be blocked; ignore
    }
  }

  applyToDOM() {
    const setVal = (id, v) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = String(v);
    };

    setVal('arr', this.arr);
    setVal('das', this.das);
    setVal('dcd', this.dcd);

    const sdfEl = document.getElementById('sdf');
    if (sdfEl) sdfEl.value = (this.sdf === 'inf') ? 'inf' : String(this.sdf);

    const pmEl = document.getElementById('preventMissdrop');
    if (pmEl) pmEl.value = this.preventMissdrop ? 'true' : 'false';
  }

  setupAutoSave() {
    const scheduleSave = () => {
      this.update();
      this.saveToStorage();
    };

    const bind = (id, evt) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener(evt, scheduleSave);
    };

    // number inputs update live
    bind('arr', 'input');
    bind('das', 'input');
    bind('dcd', 'input');

    // selects update on change
    bind('sdf', 'change');
    bind('preventMissdrop', 'change');
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
  }
}
