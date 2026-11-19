/** DOM layer: menus, settings binding and HUD updates. Game logic talks to it via callbacks. */
const ARC_SPEED = 603 * 0.75, ARC_RPM = 515 * 0.75, MAX_KMH = 300;

export class UI {
  constructor(settings, cb) {
    const $ = (this.$ = (id) => document.getElementById(id));
    this.settings = settings; this.cb = cb; this.current = 'menu'; this.from = 'menu';
    this.screens = { menu: $('menu'), settings: $('settings'), controls: $('controls'), pause: $('pause') };
    this.hud = $('hud'); this.last = {};

    // keep Space (handbrake) from re-clicking a HUD button that still has focus
    this.hud.addEventListener('click', (e) => e.target.blur?.());

    $('btn-play').onclick = () => cb.onPlay();
    $('btn-resume').onclick = () => cb.onResume();
    $('btn-reset').onclick = () => cb.onReset();
    $('btn-quit').onclick = () => cb.onQuit();
    $('btn-hud-reset').onclick = () => cb.onReset();
    $('btn-hud-pause').onclick = () => cb.onPause();
    $('btn-settings').onclick = $('btn-pause-settings').onclick = () => this.open('settings');
    $('btn-controls').onclick = $('btn-pause-controls').onclick = () => this.open('controls');
    $('btn-settings-back').onclick = $('btn-controls-back').onclick = () => this.back();

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
  }

  show(name) {
    for (const k in this.screens) this.screens[k].classList.toggle('hidden', k !== name);
    this.current = name || 'none';
  }
  open(name) { this.from = this.current; this.show(name); }
  back() { this.show(this.from); }
  showHud(on) { this.hud.classList.toggle('hidden', !on); }
  hideLoading() { this.$('loading').classList.add('done'); }

  setNet({ online, ping }) {
    const n = this.$('net'); n.classList.toggle('on', !!online);
    n.textContent = online ? `● SERVER ONLINE${ping != null ? ' · ' + ping + ' MS' : ''}` : '○ OFFLINE · SINGLE PLAYER';
  }
  toast(text) {
    const t = this.$('toast'); t.textContent = text; t.classList.add('on');
    clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.remove('on'), 900);
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
