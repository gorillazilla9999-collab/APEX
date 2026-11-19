// Pure room/player logic (no socket.io dependency) so it can be unit-tested headlessly.
export const MAX_PER_ROOM = 12;
export const DEFAULT_ROOM = 'PUBLIC';
export const COLORS = [0xc8101e, 0x1e6bff, 0xf2b705, 0x16a34a, 0xff6a00, 0x9333ea, 0x00c2c7, 0xe11d8f, 0xf4f4f4, 0x2b2f38, 0x84cc16, 0x8b5a2b];
const MIN_STATE_GAP_MS = 25, AWAY_AFTER_MS = 6000, LIMIT = 6000;

export const cleanName = (n) => String(n ?? '').replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 14) || 'Driver';
export const cleanRoom = (r) => String(r ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || DEFAULT_ROOM;
const num = (v, lim = LIMIT) => (Number.isFinite(v) && Math.abs(v) <= lim ? v : null);
const r2 = (v) => Math.round(v * 100) / 100;

export class Rooms {
  constructor() { this.rooms = new Map(); this.byPlayer = new Map(); }

  /** Add a player; returns { error } or { room, player, players }. */
  join(id, name, roomCode, now = Date.now()) {
    this.leave(id);
    const code = cleanRoom(roomCode);
    let room = this.rooms.get(code);
    if (!room) this.rooms.set(code, (room = { code, players: new Map() }));
    if (room.players.size >= MAX_PER_ROOM) return { error: 'ROOM FULL' };
    const used = new Set([...room.players.values()].map((p) => p.slot));
    let slot = 0; while (used.has(slot)) slot++;
    const player = { id, name: cleanName(name), slot, color: COLORS[slot % COLORS.length], state: null, last: now, lastAccepted: 0 };
    room.players.set(id, player); this.byPlayer.set(id, code);
    return { room, player, players: this.list(room) };
  }

  leave(id) {
    const code = this.byPlayer.get(id); if (!code) return null;
    this.byPlayer.delete(id);
    const room = this.rooms.get(code); if (!room) return null;
    room.players.delete(id);
    if (room.players.size === 0) this.rooms.delete(code);
    return room;
  }

  roomOf(id) { return this.rooms.get(this.byPlayer.get(id)); }
  list(room) { return [...room.players.values()].map(({ id, name, slot, color }) => ({ id, name, slot, color })); }

  /** Validate and store a client-reported state. Returns true if accepted. */
  update(id, s, now = Date.now()) {
    const p = this.roomOf(id)?.players.get(id);
    if (!p || !s || typeof s !== 'object') return false;
    if (now - p.lastAccepted < MIN_STATE_GAP_MS) return false;
    const x = num(s.x), z = num(s.z), h = num(s.h, 1e4), vx = num(s.vx, 400), vz = num(s.vz, 400), st = num(s.st, 2), yr = num(s.yr, 20);
    if ([x, z, h, vx, vz, st, yr].some((v) => v === null)) return false;
    p.state = { x: r2(x), z: r2(z), h: Math.round(h * 1000) / 1000, vx: r2(vx), vz: r2(vz), st: Math.round(st * 1000) / 1000, yr: r2(yr), f: (s.f | 0) & 63 };
    p.lastAccepted = now; p.last = now;
    return true;
  }

  snapshot(room, now = Date.now()) {
    const out = [];
    for (const p of room.players.values()) if (p.state) out.push({ id: p.id, ...p.state, away: now - p.last > AWAY_AFTER_MS ? 1 : 0 });
    return out;
  }
}
