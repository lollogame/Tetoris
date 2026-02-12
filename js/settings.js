'use strict';

/* =========================================================
   Settings + localStorage persistence
========================================================= */
class GameSettings {
  static instance = null;
  static STORAGE_KEY = 'tetoris_settings_v1';

  constructor() {
    // Defaults
    this.arr = 0;
    this.das = 167;
    this.dcd = 0;
    this.sdf = 6;              // number or 'inf'
    this.preventMissdrop = true;

    this._persistenceWired = false;
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

  /* =========================
     Persistence
  ========================= */
  initPersistence() {
    if (this._persistenceWired) return;
    this._persistenceWired = true;

    // Load saved values -> push into UI -> sync internal state
    this.loadFromStorage();
    this.applyToUI();
    this.update();

    this.wireAutoSave();
  }

  loadFromStorage() {
    try {
      const raw = localStorage.getItem(GameSettings.STORAGE_KEY);
      if (!raw) return;

      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return;

      if (Number.isFinite(Number(data.arr))) this.arr = Math.max(0, Math.min(200, parseInt(data.arr, 10)));
      if (Number.isFinite(Number(data.das))) this.das = Math.max(0, Math.min(500, parseInt(data.das, 10)));
      if (Number.isFinite(Number(data.dcd))) this.dcd = Math.max(0, Math.min(100, parseInt(data.dcd, 10)));

      if (data.sdf === 'inf') this.sdf = 'inf';
      else if (Number.isFinite(Number(data.sdf))) this.sdf = Math.max(1, Number(data.sdf));

      if (typeof data.preventMissdrop === 'boolean') this.preventMissdrop = data.preventMissdrop;
      else if (typeof data.preventMissdrop === 'string') this.preventMissdrop = (data.preventMissdrop === 'true');
    } catch (err) {
      console.warn('Failed to load settings', err);
    }
  }

  saveToStorage() {
    try {
      const payload = {
        arr: this.arr,
        das: this.das,
        dcd: this.dcd,
        sdf: this.sdf,
        preventMissdrop: this.preventMissdrop,
      };
      localStorage.setItem(GameSettings.STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.warn('Failed to save settings', err);
    }
  }

  applyToUI() {
    const arrEl = document.getElementById('arr');
    const dasEl = document.getElementById('das');
    const dcdEl = document.getElementById('dcd');
    const sdfEl = document.getElementById('sdf');
    const pmEl  = document.getElementById('preventMissdrop');

    if (arrEl) arrEl.value = String(this.arr);
    if (dasEl) dasEl.value = String(this.das);
    if (dcdEl) dcdEl.value = String(this.dcd);
    if (sdfEl) sdfEl.value = String(this.sdf);
    if (pmEl)  pmEl.value  = this.preventMissdrop ? 'true' : 'false';
  }

  wireAutoSave() {
    const idsInput = ['arr', 'das', 'dcd'];
    for (const id of idsInput) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.addEventListener('input', () => {
        this.update();
        this.saveToStorage();
      });
    }

    const sdfEl = document.getElementById('sdf');
    if (sdfEl) {
      sdfEl.addEventListener('change', () => {
        this.update();
        this.saveToStorage();
      });
    }

    const pmEl = document.getElementById('preventMissdrop');
    if (pmEl) {
      pmEl.addEventListener('change', () => {
        this.update();
        this.saveToStorage();
      });
    }
  }
}
