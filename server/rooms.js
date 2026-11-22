// Pure room/player logic (no socket.io dependency) so it can be unit-tested headlessly.
// Map ids come from the same catalogue the client renders from (plain data, no Three.js).
import { DEFAULT_MAP, isMap } from '../public/js/world/maps.js';
import { DEFAULT_CAR, isCar } from '../public/js/vehicle/cars.js';
import { RaceSession } from '../public/js/race/RaceSession.js';
import { buildCenterline } from '../public/js/world/trackMath.js';
import { getMap } from '../public/js/world/maps.js';

export const MAX_PER_ROOM = 12;
export const DEFAULT_ROOM = 'PUBLIC';
export const COLORS = [0xc8101e, 0x1e6bff, 0xf2b705, 0x16a34a, 0xff6a00, 0x9333ea, 0x00c2c7, 0xe11d8f, 0xf4f4f4, 0x2b2f38, 0x84cc16, 0x8b5a2b];
const MIN_STATE_GAP_MS = 25, AWAY_AFTER_MS = 6000, LIMIT = 6000;

export const cleanName = (n) => String(n ?? '').replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 14) || 'Driver';
export const cleanRoom = (r) => String(r ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || DEFAULT_ROOM;
const trackCache = new Map();
/** Server-side centre-line for a map (no Three.js needed); used by the race rules. */
export const trackFor = (mapId) => { let t = trackCache.get(mapId); if (!t) trackCache.set(mapId, (t = buildCenterline(getMap(mapId)))); return t; };
const CODE_CHARS = 'ACDEFGHJKLMNPQRTUVWXY34679';
const randomCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const num = (v, lim = LIMIT) => (Number.isFinite(v) && Math.abs(v) <= lim ? v : null);
const r2 = (v) => Math.round(v * 100) / 100;

export class Rooms {
  constructor() { this.rooms = new Map(); this.byPlayer = new Map(); }

  /**
   * Add a player; returns { error } or { room, player, players }.
   * A room's map is fixed by whoever creates it; later joiners get that map whatever they asked for.
   * mode 'public' (Quick play) joins the busiest public lobby that is still waiting to start; blank / "PUBLIC" without a mode keeps the old one-lobby-per-map behaviour.
   */
  join(id, name, roomCode, now = Date.now(), mapId = DEFAULT_MAP, carId = DEFAULT_CAR, mode) {
    this.leave(id, now);
    const want = isMap(mapId) ? mapId : DEFAULT_MAP;
    let typed = cleanRoom(roomCode), pub = typed === DEFAULT_ROOM;
    const raw = String(roomCode ?? '').trim();
    if (mode === 'public') pub = true;
    else if (mode === 'host') {
      if (!raw || pub) { do typed = randomCode(); while (this.rooms.has(typed)); }
      pub = false; if (this.rooms.has(typed)) return { error: 'CODE IN USE' };
    } else if (mode === 'join') {
      if (!raw || pub) return { error: 'ENTER A ROOM CODE' };
      if (!this.rooms.has(typed)) return { error: 'ROOM NOT FOUND' };
    }
    let code = pub ? `${DEFAULT_ROOM}~${want.toUpperCase()}` : typed; // '~' can never be typed, so no clash with private codes
    if (mode === 'public') { // quick play: fill the busiest public lobby that is waiting for a race, otherwise open a new one
      const open = [...this.rooms.values()].filter((r) => r.label === DEFAULT_ROOM && r.race.phase === 'lobby' && r.players.size < Math.min(MAX_PER_ROOM, r.race.settings.maxPlayers))
        .sort((a, b) => b.players.size - a.players.size);
      if (open[0]) code = open[0].code;
      else { const base = code; for (let i = 2; this.rooms.has(code); i++) code = `${base}~${i}`; }
    }
    let room = this.rooms.get(code);
    if (!room) {
      const race = new RaceSession(trackFor); race.settings.map = want;
      room = { code, label: pub ? DEFAULT_ROOM : typed, host: id, race, players: new Map(), get map() { return this.race.settings.map; } };
      this.rooms.set(code, room);
    }
    if (room.players.size >= Math.min(MAX_PER_ROOM, room.race.settings.maxPlayers)) return { error: 'ROOM FULL' };
    const used = new Set([...room.players.values()].map((p) => p.slot));
    let slot = 0; while (used.has(slot)) slot++;
    const player = { id, name: cleanName(name), slot, color: COLORS[slot % COLORS.length], car: isCar(carId) ? carId : DEFAULT_CAR, spectating: room.race.phase !== 'lobby', state: null, last: now, lastAccepted: 0 };
    room.players.set(id, player); this.byPlayer.set(id, code);
    return { room, player, players: this.list(room) };
  }

  leave(id, now = Date.now()) {
    const code = this.byPlayer.get(id); if (!code) return null;
    this.byPlayer.delete(id);
    const room = this.rooms.get(code); if (!room) return null;
    room.players.delete(id); room.race.remove(id, now);
    if (room.players.size === 0) this.rooms.delete(code);
    else if (room.host === id) room.host = room.players.keys().next().value; // oldest remaining driver takes over
    return room;
  }

  roomOf(id) { return this.rooms.get(this.byPlayer.get(id)); }
  list(room) { return [...room.players.values()].map(({ id, name, slot, color, car, spectating }) => ({ id, name, slot, color, car, spec: spectating ? 1 : 0 })); }

  /** Everything a client needs to draw the lobby. */
  roomState(room) { return { host: room.host, phase: room.race.phase, settings: room.race.settings, players: this.list(room) }; }

  // ---- host actions (all return { error } or { room, ... }) ----
  _hostRoom(id) {
    const room = this.roomOf(id); if (!room) return { error: 'NOT IN A ROOM' };
    if (room.host !== id) return { error: 'HOST ONLY' };
    return { room };
  }
  setSettings(id, patch) {
    const r = this._hostRoom(id); if (r.error) return r;
    if (r.room.race.phase !== 'lobby') return { error: 'RACE IN PROGRESS' };
    const size = r.room.players.size, before = r.room.race.settings;
    r.room.race.setSettings(patch);
    if (r.room.race.settings.maxPlayers < size) r.room.race.settings = { ...r.room.race.settings, maxPlayers: Math.max(2, size) }; // never below who is already here
    return { room: r.room, changed: r.room.race.settings !== before && JSON.stringify(before) !== JSON.stringify(r.room.race.settings) };
  }
  setCar(id, carId) {
    const room = this.roomOf(id), p = room?.players.get(id);
    if (!p || !isCar(carId) || room.race.phase !== 'lobby') return { error: 'CANNOT CHANGE CAR NOW' };
    p.car = carId; return { room };
  }
  startRace(id, now = Date.now()) {
    const r = this._hostRoom(id); if (r.error) return r;
    if (r.room.race.phase !== 'lobby') return { error: 'RACE IN PROGRESS' };
    const entries = [...r.room.players.values()].sort((a, b) => a.slot - b.slot);
    entries.forEach((p) => { p.spectating = false; p.state = null; });
    const res = r.room.race.start(entries.map((p) => ({ id: p.id, name: p.name })), now);
    return res ? { room: r.room, ...res, serverNow: now } : { error: 'COULD NOT START' };
  }
  toLobby(id) {
    const r = this._hostRoom(id); if (r.error) return r;
    if (r.room.race.phase === 'lobby') return { room: r.room };
    r.room.race.toLobby(); return { room: r.room };
  }
  /** Advance every room's race clock; returns [{ room, phase }] for rooms whose phase just changed. */
  tickRaces(now = Date.now()) {
    const out = [];
    for (const room of this.rooms.values()) { const phase = room.race.tick(now); if (phase) out.push({ room, phase }); }
    return out;
  }

  /** Validate and store a client-reported state. Returns true if accepted. */
  update(id, s, now = Date.now()) {
    const p = this.roomOf(id)?.players.get(id);
    if (!p || !s || typeof s !== 'object') return false;
    if (now - p.lastAccepted < MIN_STATE_GAP_MS) return false;
    const ts = num(s.ts, 1e10), x = num(s.x), z = num(s.z), h = num(s.h, 1e4), vx = num(s.vx, 400), vz = num(s.vz, 400), st = num(s.st, 2), yr = num(s.yr, 20);
    if ([x, z, h, vx, vz, st, yr].some((v) => v === null)) return false;
    p.state = { ...(ts !== null && { ts: Math.round(ts) }), x: r2(x), z: r2(z), h: Math.round(h * 1000) / 1000, vx: r2(vx), vz: r2(vz), st: Math.round(st * 1000) / 1000, yr: r2(yr), f: (s.f | 0) & 63 };
    p.lastAccepted = now; p.last = now;
    this.roomOf(id).race.update(id, p.state.x, p.state.z, Math.hypot(p.state.vx, p.state.vz), now);
    return true;
  }

  snapshot(room, now = Date.now()) {
    const out = [];
    for (const p of room.players.values()) if (p.state) out.push({ id: p.id, ...p.state, away: now - p.last > AWAY_AFTER_MS ? 1 : 0 });
    return out;
  }
}
