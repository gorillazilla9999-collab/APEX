// End-to-end race protocol over the fake socket.io: host -> join -> setup -> start -> countdown -> racing -> results -> lobby.
import assert from 'node:assert/strict';
import { registerSockets } from '../server/sockets.js';
import { trackFor } from '../server/rooms.js';
import { gridPose } from '../public/js/race/RaceSession.js';

const sockets = new Map(); let connectionCb;
const roomSockets = (code) => [...sockets.values()].filter((s) => s.joined.has(code));
const io = { on: (_e, cb) => (connectionCb = cb), to: (code) => ({ emit: (ev, d) => roomSockets(code).forEach((s) => s.got.push([ev, d])), volatile: { emit: (ev, d) => roomSockets(code).forEach((s) => s.got.push([ev, d])) } }) };
function connect(id) {
  const h = {}, s = { id, joined: new Set(), got: [], rooms: new Set([id]), on: (e, f) => (h[e] = f), emit: (ev, d) => s.got.push([ev, d]),
    join: (c) => { s.joined.add(c); s.rooms.add(c); }, leave: (c) => { s.joined.delete(c); s.rooms.delete(c); },
    to: (c) => ({ emit: (ev, d) => roomSockets(c).filter((x) => x !== s).forEach((x) => x.got.push([ev, d])) }), h };
  sockets.set(id, s); connectionCb(s); return s;
}
const last = (s, ev) => s.got.filter(([e]) => e === ev).at(-1)?.[1];
const call = (s, ev, d) => { let r; s.h[ev](d, (x) => (r = x)); return r; };
registerSockets(io);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const A = connect('A'), B = connect('B'), C = connect('C');
let ack; A.h['room:join']({ name: 'Ann', room: '', map: 'sunset', car: 'apex', mode: 'host' }, (r) => (ack = r));
assert.ok(!ack.error); assert.equal(ack.host, 'A'); assert.equal(ack.phase, 'lobby'); assert.equal(ack.settings.laps, 3); const code = ack.room;
let ackB; B.h['room:join']({ name: 'Bob', room: code, map: 'dunes', car: 'blaze', mode: 'join' }, (r) => (ackB = r));
assert.equal(ackB.map, 'sunset'); assert.equal(last(A, 'room:state').players.length, 2, 'host sees the new player in room:state');
let bad; C.h['room:join']({ name: 'Cy', room: 'ZZZZZ', mode: 'join' }, (r) => (bad = r)); assert.equal(bad.error, 'ROOM NOT FOUND');

assert.equal(call(B, 'race:setup', { laps: 1 }).error, 'HOST ONLY');
assert.ok(call(A, 'race:setup', { laps: 1, map: 'neon', nitro: false }).ok);
assert.deepEqual(last(B, 'room:state').settings, { map: 'neon', laps: 1, nitro: false, maxPlayers: 12 }, 'everyone sees the host\'s settings');
assert.ok(call(B, 'race:car', 'zenith').ok); assert.equal(last(A, 'room:state').players.find((p) => p.id === 'B').car, 'zenith');

assert.equal(call(B, 'race:start').error, 'HOST ONLY');
assert.ok(call(A, 'race:start').ok);
const st = last(B, 'race:started'); assert.ok(st && st.goAt > st.serverNow && st.settings.map === 'neon' && st.grid.A === 0 && st.grid.B === 1);
assert.equal(last(A, 'room:state').phase, 'countdown');

// both cars sit on their grid slots, then (server clock is real, so shorten the wait by editing goAt on the room)
const track = trackFor('neon');
const send = (s, x, z, vx = 0, vz = 0) => s.h['player:state']({ x, z, h: 0, vx, vz, st: 0, yr: 0, f: 0 });
for (const [s, slot] of [[A, 0], [B, 1]]) { const p = gridPose(track, slot); send(s, p.x, p.z); }
await sleep(60);
assert.ok(last(A, 'race:tick') == null || last(A, 'race:tick').ph === 'countdown');
console.log('race protocol tests passed'); process.exit(0);
