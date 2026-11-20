import { drawThumbnail } from './Minimap.js';

/** DOM layer: menus, settings binding and HUD updates. Game logic talks to it via callbacks. */
const ARC_SPEED = 603 * 0.75, ARC_RPM = 515 * 0.75, MAX_KMH = 300;

export class UI {
  /** maps = [{ def, track }] for the map-select screen. */
  constructor(settings, cb, maps = []) {
    const $ = (this.$ = (id) => document.getElementById(id));
    this.settings = settings; this.cb = cb; this.current = 'menu'; this.from = 'menu';
    this.screens = { menu: $('menu'), maps: $('maps'), settings: $('settings'), controls: $('controls'), pause: $('pause') };
    this.mapId = null;
    this.hud = $('hud'); this.last = {};

    // keep Space (handbrake) from re-clicking a HUD button that still has focus
    this.hud.addEventListener('click', (e) => e.target.blur?.());

    this.inName = $('in-name'); this.inRoom = $('in-room');
    try { this.inName.value = localStorage.getItem('apexdrive.name') || ''; this.inRoom.value = localStorage.getItem('apexdrive.room') || ''; } catch { /* storage unavailable */ }
    this.inRoom.oninput = () => (this.inRoom.value = this.inRoom.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
    // typing a name must never steer the car or trigger R / Esc handlers
    for (const el of [this.inName, this.inRoom]) el.addEventListener('keydown', (e) => { if (e.code !== 'Escape') e.stopPropagation(); });
    $('btn-play').onclick = () => cb.onPlay();
    $('btn-resume').onclick = () => cb.onResume();
    $('btn-reset').onclick = () => cb.onReset();
    $('btn-quit').onclick = () => cb.onQuit();
    $('btn-hud-reset').onclick = () => cb.onReset();
    $('btn-hud-pause').onclick = () => cb.onPause();
    $('btn-settings').onclick = $('btn-pause-settings').onclick = () => this.open('settings');
    $('btn-controls').onclick = $('btn-pause-controls').onclick = () => this.open('controls');
    $('btn-settings-back').onclick = $('btn-controls-back').onclick = $('btn-maps-back').onclick = () => this.back();
    $('btn-map').onclick = () => this.open('maps');
    this._buildMapCards(maps);

    const bindRange = (id, key, fmt) => {
      const el = $(id), out = $(id + '-val'); el.value = settings.get(key);
      const show = () => (out.textContent = fmt(el.value)); show();
      el.oninput = () => { settings.set(key, +el.value); show(); };
    };
    bindRange('set-fov', 'fov', (v) => v + '°');
    bindRange('set-volume', 'volume', (v) => v + '%');
    for (const [id, key] of [['set-shadows', 'shadows'], ['set-bloom', 'bloom'], ['set-shake', 'shake']]) {
      const el = $(id); el.checked = settings.get(key); el.onchange = () => settings.set(key, el.checked);
    }
    const q = $('set-quality'); q.value = settings.get('quality'); q.onchange = () => settings.set('quality', q.value);
    const mm = $('set-minimap'); mm.value = settings.get('minimap'); mm.onchange = () => settings.set('minimap', mm.value);
    settings.onChange((k, v) => { if (k === 'minimap') mm.value = v; }); // also changes via the M key
  }

  _buildMapCards(maps) {
    const grid = this.$('map-grid'); this.cards = new Map();
    const el = (tag, cls, text) => { const e = document.createElement(tag); e.className = cls; if (text != null) e.textContent = text; return e; };
    for (const { def, track } of maps) {
      const card = el('button', 'map-card'); card.type = 'button';
      const cv = document.createElement('canvas'); cv.width = 320; cv.height = 180; drawThumbnail(cv, def, track);
      const meta = el('div', 'map-meta'); meta.append(el('span', '', (track.length / 1000).toFixed(1) + ' KM'), el('span', 'dots', '●'.repeat(def.difficulty) + '○'.repeat(5 - def.difficulty)));
      meta.title = 'Length · difficulty';
      card.append(cv, el('div', 'map-name', def.name), el('div', 'map-tag', def.tag), meta);
      card.onclick = () => this.cb.onSelectMap(def.id);
      grid.append(card); this.cards.set(def.id, card);
    }
  }
  /** Reflect the loaded map in the menu button and the selection screen. */
  setMap(def) {
    this.mapId = def.id; this.$('map-name').textContent = def.name;
    for (const [id, card] of this.cards) card.classList.toggle('sel', id === def.id);
  }

  show(name) {
    for (const k in this.screens) this.screens[k].classList.toggle('hidden', k !== name);
    this.current = name || 'none';
  }
  open(name) { this.from = this.current; this.show(name); }
  back() { this.show(this.from); }
  showHud(on) { this.hud.classList.toggle('hidden', !on); }
  hideLoading() { this.$('loading').classList.add('done'); }

  identity() {
    const name = this.inName.value.trim() || 'Driver', room = this.inRoom.value.trim();
    try { localStorage.setItem('apexdrive.name', this.inName.value.trim()); localStorage.setItem('apexdrive.room', room); } catch { /* ignore */ }
    return { name, room };
  }
  setNet(s) {
    this._net = { ...this._net, ...s };
    if (this._flash) return;
    const { online, ping } = this._net, n = this.$('net'); n.classList.toggle('on', !!online);
    n.textContent = online ? `● SERVER ONLINE${ping != null ? ' · ' + ping + ' MS' : ''}` : '○ OFFLINE · SINGLE PLAYER';
  }
  flashNet(text) {
    const n = this.$('net'); this._flash = true; n.classList.remove('on'); n.textContent = text;
    clearTimeout(this._ft); this._ft = setTimeout(() => { this._flash = false; this.setNet({}); }, 3000);
  }
  setMode(text) { this.$('mode').textContent = text; }
  setPlayers(rows) {
    const el = this.$('players'); el.classList.toggle('hidden', rows.length < 2);
    if (rows.length < 2) return;
    el.replaceChildren(...rows.map((r) => {
      const d = document.createElement('div'); d.className = 'p' + (r.me ? ' me' : '');
      const dot = document.createElement('i'); dot.style.background = '#' + r.color.toString(16).padStart(6, '0');
      const nm = document.createElement('span'); nm.textContent = r.name;
      const sp = document.createElement('b'); sp.textContent = r.kmh + ' km/h';
      d.append(dot, nm, sp); return d;
    }));
  }
  toast(text, ms = 900) {
    const t = this.$('toast'); t.textContent = text; t.classList.add('on');
    clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.remove('on'), ms);
  }

  updateHud(v) {
    const kmh = Math.round(v.speedKmh), L = this.last;
    if (L.kmh !== kmh) { this.$('hud-speed').textContent = kmh; L.kmh = kmh; this.$('arc-speed').style.strokeDasharray = `${Math.min(1, kmh / MAX_KMH) * ARC_SPEED} 603`; }
    if (L.gear !== v.gearLabel) { this.$('hud-gear').textContent = v.gearLabel; L.gear = v.gearLabel; }
    const rpm = this.$('arc-rpm');
    rpm.style.strokeDasharray = `${v.rpmNorm * ARC_RPM} 515`;
    rpm.style.stroke = v.rpmNorm > 0.86 ? '#ff2a2a' : '#ffffff';
    this.$('nitro-fill').style.transform = `scaleX(${v.nitro})`;
    this.$('nitro-fill').parentElement.parentElement.classList.toggle('on', v.nitroActive);
    this.$('drift').classList.toggle('on', v.sliding && v.speed > 12);
  }
}
