import { drawThumbnail } from './Minimap.js';
import { fmtTime, fmtGap, ordinal } from '../race/format.js';

/** DOM layer: menus, settings binding, lobby / results screens and HUD updates. Game logic talks to it via callbacks. */
const ARC_SPEED = 603 * 0.75, ARC_RPM = 515 * 0.75, MAX_KMH = 300;
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export class UI {
  /** maps = [{ def, track }] for the map-select screen. */
  constructor(settings, cb, maps = [], cars = []) {
    const $ = (this.$ = (id) => document.getElementById(id));
    this.settings = settings; this.cb = cb; this.current = 'menu'; this.from = 'menu';
    this.screens = { menu: $('menu'), maps: $('maps'), cars: $('cars'), settings: $('settings'), controls: $('controls'), pause: $('pause'), multi: $('multi'), lobby: $('lobby'), results: $('results') };
    this.mapId = null; this.lobby = null; this.mapNames = {}; this.carNames = {};
    this.hud = $('hud'); this.last = {};

    // keep Space (handbrake) from re-clicking a HUD button that still has focus
    this.hud.addEventListener('click', (e) => e.target.blur?.());

    this.inName = $('in-name'); this.inRoom = $('in-room');
    try { this.inName.value = localStorage.getItem('apexdrive.name') || ''; this.inRoom.value = localStorage.getItem('apexdrive.room') || ''; } catch { /* storage unavailable */ }
    this.inRoom.oninput = () => (this.inRoom.value = this.inRoom.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
    // typing a name must never steer the car or trigger R / Esc handlers
    for (const e of [this.inName, this.inRoom]) e.addEventListener('keydown', (ev) => { if (ev.code !== 'Escape') ev.stopPropagation(); });
    this.inRoom.addEventListener('keydown', (ev) => { if (ev.code === 'Enter') cb.onJoin(this.identity().room); });

    // main menu
    $('btn-play').onclick = () => cb.onFreeDrive();
    $('btn-solo').onclick = () => cb.onSolo();
    $('btn-multi').onclick = () => { this.setMultiNote(''); this.open('multi'); };
    $('btn-multi-back').onclick = () => this.back();
    $('btn-host').onclick = () => cb.onHost(this.identity().room);
    $('btn-join').onclick = () => cb.onJoin(this.identity().room);
    $('btn-quick').onclick = () => cb.onQuick();
    // lobby / results
    $('btn-lobby-leave').onclick = $('btn-res-leave').onclick = () => cb.onLeave();
    $('btn-start').onclick = () => cb.onStartRace();
    $('btn-res-lobby').onclick = () => cb.onBackToLobby();
    $('btn-lobby-map').onclick = () => this.open('maps');
    $('btn-car-lobby').onclick = () => this.open('cars');
    $('laps-dec').onclick = () => cb.onSetup({ laps: (this.lobby?.settings.laps ?? 3) - 1 });
    $('laps-inc').onclick = () => cb.onSetup({ laps: (this.lobby?.settings.laps ?? 3) + 1 });
    $('max-dec').onclick = () => cb.onSetup({ maxPlayers: (this.lobby?.settings.maxPlayers ?? 12) - 1 });
    $('max-inc').onclick = () => cb.onSetup({ maxPlayers: (this.lobby?.settings.maxPlayers ?? 12) + 1 });
    $('lobby-nitro').onchange = (e) => cb.onSetup({ nitro: e.target.checked });
    $('btn-copy').onclick = async () => {
      const code = $('lobby-code').textContent;
      try { await navigator.clipboard.writeText(code); $('btn-copy').textContent = 'COPIED'; } catch { $('btn-copy').textContent = code; }
      setTimeout(() => ($('btn-copy').textContent = 'COPY'), 1500);
    };
    // pause / HUD
    $('btn-resume').onclick = () => cb.onResume();
    $('btn-reset').onclick = () => cb.onReset();
    $('btn-quit').onclick = () => cb.onQuit();
    $('btn-hud-reset').onclick = () => cb.onReset();
    $('btn-hud-pause').onclick = () => cb.onPause();
    $('btn-settings').onclick = $('btn-pause-settings').onclick = () => this.open('settings');
    $('btn-controls').onclick = $('btn-pause-controls').onclick = () => this.open('controls');
    $('btn-settings-back').onclick = $('btn-controls-back').onclick = $('btn-maps-back').onclick = $('btn-cars-back').onclick = () => this.back();
    $('btn-car').onclick = () => this.open('cars');
    this._buildCarCards(cars);
    $('btn-map').onclick = () => this.open('maps');
    this._buildMapCards(maps);

    const bindRange = (id, key, fmt) => {
      const input = $(id), out = $(id + '-val'); input.value = settings.get(key);
      const show = () => (out.textContent = fmt(input.value)); show();
      input.oninput = () => { settings.set(key, +input.value); show(); };
    };
    bindRange('set-fov', 'fov', (v) => v + '°');
    bindRange('set-volume', 'volume', (v) => v + '%');
    for (const [id, key] of [['set-stats', 'stats'], ['set-shadows', 'shadows'], ['set-bloom', 'bloom'], ['set-shake', 'shake']]) {
      const input = $(id); input.checked = settings.get(key); input.onchange = () => settings.set(key, input.checked);
    }
    const q = $('set-quality'); q.value = settings.get('quality'); q.onchange = () => settings.set('quality', q.value);
    const mm = $('set-minimap'); mm.value = settings.get('minimap'); mm.onchange = () => settings.set('minimap', mm.value);
    this.perf = $('perf'); this.perf.classList.toggle('hidden', !settings.get('stats'));
    settings.onChange((k, v) => { if (k === 'stats') this.perf.classList.toggle('hidden', !v); });
    settings.onChange((k, v) => { if (k === 'minimap') mm.value = v; }); // also changes via the M key
  }

  _buildMapCards(maps) {
    const grid = this.$('map-grid'); this.cards = new Map();
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
  _buildCarCards(cars) {
    const grid = this.$('car-grid'); this.carCards = new Map();
    for (const def of cars) {
      const card = el('button', 'map-card car-card'); card.type = 'button';
      const head = el('div', 'car-head'), sw = el('i', 'swatch'); sw.style.background = hex(def.color);
      head.append(sw, el('div', 'map-name', def.name));
      card.append(head, el('div', 'map-tag', def.tag));
      for (const [k, label] of [['speed', 'SPEED'], ['accel', 'ACCEL'], ['turn', 'TURN'], ['brake', 'BRAKE']]) {
        const row = el('div', 'stat'), bar = el('div', 'bar2'), fill = document.createElement('i'); fill.style.width = def.stats[k] * 10 + '%';
        bar.append(fill); row.append(el('span', '', label), bar); card.append(row);
      }
      card.onclick = () => this.cb.onSelectCar(def.id);
      grid.append(card); this.carCards.set(def.id, card);
    }
  }
  setNames(maps, cars) {
    this.mapNames = Object.fromEntries(maps.map((m) => [m.def.id, m.def.name]));
    this.carNames = Object.fromEntries(cars.map((c) => [c.id, c.name]));
  }
  setCar(def) {
    this.$('car-name').textContent = def.name;
    for (const [id, card] of this.carCards) card.classList.toggle('sel', id === def.id);
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
    this._showPing();
    const { online, ping } = this._net, n = this.$('net'); n.classList.toggle('on', !!online);
    n.textContent = online ? `● SERVER ONLINE${ping != null ? ' · ' + ping + ' MS' : ''}` : '○ OFFLINE · SINGLE PLAYER';
  }
  /** Live FPS readout (called a few times a second from the render loop). */
  setFps(fps) {
    const e = this.$('perf-fps'); if (!e) return;
    e.textContent = fps + ' FPS';
    e.className = fps >= 50 ? 'good' : fps >= 30 ? 'ok' : 'bad';
  }
  _showPing() {
    const e = this.$('perf-ping'); if (!e) return;
    const { online, ping } = this._net || {};
    if (!online || ping == null) { e.textContent = online ? '-- MS' : 'OFFLINE'; e.className = ''; return; }
    e.textContent = ping + ' MS';
    e.className = ping <= 60 ? 'good' : ping <= 120 ? 'ok' : 'bad';
  }
  flashNet(text) {
    const n = this.$('net'); this._flash = true; n.classList.remove('on'); n.textContent = text;
    clearTimeout(this._ft); this._ft = setTimeout(() => { this._flash = false; this.setNet({}); }, 3000);
  }
  setMode(text) { this.$('mode').textContent = text; }
  toast(text, ms = 900) {
    const t = this.$('toast'); t.textContent = text; t.classList.add('on');
    clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.remove('on'), ms);
  }
  setMultiNote(text) {
    const n = this.$('multi-note'); if (!n) return;
    n.textContent = text || 'Hosting creates a room you control: you pick the map, laps and rules, then start the race. Leave the code blank for a random one.';
    n.style.color = text ? '#ff6b6b' : '';
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

  // ---- race lobby ----
  /** `s` = room state {host, phase, settings, players}; `me` = my id; `code` = room code to show (null = solo race). */
  setLobby(s, me, code, carName) {
    this.lobby = s; const $ = this.$, host = s.host === me, solo = code === null;
    $('lobby').firstElementChild.classList.toggle('guest', !host);
    $('lobby-title').textContent = solo ? 'Solo Race' : 'Race Lobby';
    $('lobby-code-row').classList.toggle('hidden', solo); $('lobby-code').textContent = code ?? '';
    $('lobby-map').textContent = this.mapNames[s.settings.map] || s.settings.map.toUpperCase();
    $('lobby-laps').textContent = s.settings.laps; $('lobby-max').textContent = s.settings.maxPlayers; $('lobby-nitro').checked = s.settings.nitro;
    $('lobby-car').textContent = carName;
    $('max-dec').parentElement.parentElement.classList.toggle('hidden', solo);
    $('lobby-players').classList.toggle('hidden', solo);
    $('lobby-players').replaceChildren(...s.players.map((p) => {
      const d = el('div', 'p' + (p.id === me ? ' me' : '')), dot = document.createElement('i'); dot.style.background = hex(p.color);
      d.append(dot, el('span', '', p.name));
      if (p.id === s.host) d.append(el('span', 'crown', '★ HOST'));
      d.append(el('small', '', p.spec ? 'WATCHING' : this.carNames[p.car] || '')); return d;
    }));
    const inRace = s.phase !== 'lobby', start = $('btn-start');
    start.classList.toggle('hidden', !host); start.textContent = inRace ? 'Race in progress…' : 'Start race'; start.disabled = inRace;
    $('lobby-note').textContent = inRace ? 'A race is running. You will join the next one.' : host ? 'You are the host: set the rules, then start when everyone is here.' : 'Waiting for the host to start the race…';
  }

  // ---- race HUD ----
  raceHud(on, nitro = true) {
    this.$('race').classList.toggle('hidden', !on);
    this.$('nitro-fill').parentElement.parentElement.classList.toggle('hidden', !nitro);
    if (!on) { this.countdown(null); this.$('wrongway').classList.remove('on'); this.$('finish').classList.remove('on'); }
    this.last = {};
  }
  /** Standings panel (right side): rows = [{place, name, color, me, lap, gap, done}]. */
  setStandings(rows, laps) {
    const panel = this.$('players'); panel.classList.toggle('hidden', !rows.length);
    panel.replaceChildren(...rows.map((r) => {
      const d = el('div', 'p' + (r.me ? ' me' : '')), dot = document.createElement('i'); dot.style.background = hex(r.color);
      d.append(el('em', '', r.place), dot, el('span', '', r.name), el('span', 'gap', r.done ? 'FIN' : r.gap != null ? fmtGap(r.gap) : `L${Math.min(laps, r.lap + 1)}`)); return d;
    }));
  }
  /** My race panel; `v` = {place, total, lap, laps, ms, last, best, gap, done}. Only touches the DOM when text changes. */
  updateRace(v) {
    const set = (id, text) => { if (this.last[id] !== text) { this.last[id] = text; this.$(id).textContent = text; } };
    set('r-place', v.place ? ordinal(v.place) : '-'); set('r-of', '/ ' + v.total); set('r-lap', Math.min(v.laps, v.lap)); set('r-laps', '/ ' + v.laps);
    set('r-time', fmtTime(v.ms)); set('r-last', 'LAST ' + (v.last != null ? fmtTime(v.last) : '--')); set('r-best', 'BEST ' + (v.best != null ? fmtTime(v.best) : '--'));
    set('r-gap', v.done ? '' : v.gap != null ? fmtGap(v.gap) + ' s to car ahead' : v.place === 1 && v.total > 1 ? 'LEADING' : '');
  }
  countdown(text, go = false) {
    const c = this.$('countdown'); c.classList.remove('on', 'go');
    if (text === null || text === '') return;
    void c.offsetWidth; c.textContent = text; c.classList.add('on'); c.classList.toggle('go', go); // reflow restarts the animation
  }
  wrongWay(on) { this.$('wrongway').classList.toggle('on', !!on); }
  finishBanner(place, ms) {
    const f = this.$('finish'); f.replaceChildren(el('div', '', place === 1 ? 'WINNER!' : `FINISHED · ${ordinal(place)}`), el('small', '', fmtTime(ms))); f.classList.add('on');
    clearTimeout(this._fb); this._fb = setTimeout(() => f.classList.remove('on'), 5000);
  }
  showResults(rows, me, host, solo) {
    const $ = this.$, row = (cls, cells) => { const d = el('div', 'res-row ' + cls); d.append(...cells); return d; };
    $('res-table').replaceChildren(
      row('head', [el('span', '', '#'), el('span', '', 'DRIVER'), el('span', 't', 'TOTAL'), el('span', 't', 'BEST LAP')]),
      ...rows.map((r) => {
        const nm = el('span', 'nm'), dot = document.createElement('i'); dot.style.background = hex(r.color ?? 0xffffff); nm.append(dot, el('span', '', r.name));
        return row((r.id === me ? 'me ' : '') + (r.place === 1 ? 'first' : ''), [el('span', 'pl', r.place), nm, el('span', 't' + (r.dnf ? ' dim' : ''), r.dnf ? `DNF · L${r.laps}` : fmtTime(r.totalMs)), el('span', 't dim', fmtTime(r.bestMs))]);
      }));
    $('btn-res-lobby').classList.toggle('hidden', !host); $('btn-res-lobby').textContent = solo ? 'Race again' : 'Back to lobby';
    $('btn-res-leave').textContent = solo ? 'Main menu' : 'Leave room';
    $('res-note').textContent = host ? 'Everyone returns to the lobby when you continue (automatic after a minute).' : 'Waiting for the host to continue…';
  }
}
