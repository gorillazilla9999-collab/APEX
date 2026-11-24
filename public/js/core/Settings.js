const KEY = 'apexdrive.settings.v1';
const DEFAULTS = { fov: 72, volume: 50, shadows: true, bloom: true, shake: true, quality: 'high', minimap: 'follow', stats: true, camera: 'chase' };

export class Settings {
  constructor() {
    this.v = { ...DEFAULTS }; this.listeners = [];
    try { Object.assign(this.v, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* ignore corrupt storage */ }
    if (!['follow', 'full', 'off'].includes(this.v.minimap)) this.v.minimap = DEFAULTS.minimap;
    if (!['chase', 'first'].includes(this.v.camera)) this.v.camera = DEFAULTS.camera;
  }
  get(k) { return this.v[k]; }
  set(k, val) {
    this.v[k] = val;
    try { localStorage.setItem(KEY, JSON.stringify(this.v)); } catch { /* storage may be unavailable */ }
    this.listeners.forEach((fn) => fn(k, val));
  }
  onChange(fn) { this.listeners.push(fn); }
}
