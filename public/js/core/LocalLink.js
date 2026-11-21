import { RaceSession, DEFAULT_SETTINGS } from '../race/RaceSession.js';

/**
 * Solo race: the same RaceSession the server runs for online rooms, but in the browser with one driver.
 * Exposes the same methods / events as Network so main.js treats both identically.
 */
export class LocalLink {
  constructor(trackFor) { this.session = new RaceSession(trackFor); this.handlers = {}; this.id = 'me'; this.active = false; this.n = 0; this.player = null; }
  on(ev, fn) { this.handlers[ev] = fn; return this; }
  emit(ev, d) { this.handlers[ev]?.(d); }
  serverNow() { return Date.now(); }
  get inRoom() { return this.active; }
  open({ name, car, color, map }) {
    this.session.reset(); this.session.settings = { ...DEFAULT_SETTINGS, map, maxPlayers: 2 };
    this.player = { id: this.id, name, slot: 0, color, car, spec: 0 }; this.active = true; return this.state();
  }
  state() { return { host: this.id, phase: this.session.phase, settings: this.session.settings, players: [this.player] }; }
  pushState() { this.emit('room:state', this.state()); }
  setup(patch) { if (this.session.setSettings(patch)) this.pushState(); }
  setCar(id) { if (this.player) this.player.car = id; }
  startRace() {
    const now = Date.now(), r = this.session.start([{ id: this.id, name: this.player.name }], now);
    if (r) { this.emit('race:started', { ...r, serverNow: now }); this.pushState(); }
  }
  toLobby() { this.session.toLobby(); this.pushState(); }
  sendState(s) { if (this.active) this.session.update(this.id, s.x, s.z, Math.hypot(s.vx, s.vz), Date.now()); }
  /** Call every frame. */
  tick() {
    if (!this.active) return;
    const now = Date.now(), ph = this.session.tick(now);
    if (ph) { if (ph === 'results') this.emit('race:results', { rows: this.session.results }); this.pushState(); }
    if (this.n++ % 6 === 0 && this.session.phase !== 'lobby') this.emit('race:tick', this.session.tickPayload(now));
  }
  leave() { this.active = false; this.session.reset(); }
}
