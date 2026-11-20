// Exercises server/sockets.js against a tiny in-memory fake of socket.io (no network needed).
import assert from 'node:assert/strict';
import { registerSockets } from '../server/sockets.js';

const log = []; const sockets = new Map(); let connectionCb;
const roomSockets = (code) => [...sockets.values()].filter((s) => s.joined.has(code));
const io = {
  on: (_e, cb) => (connectionCb = cb),
  to: (code) => ({ emit: (ev, d) => roomSockets(code).forEach((s) => s.got.push([ev, d])), volatile: { emit: (ev, d) => roomSockets(code).forEach((s) => s.got.push([ev, d])) } }),
};
function connect(id) {
  const h = {}, s = { id, joined: new Set(), got: [], rooms: new Set([id]),
    on: (e, f) => (h[e] = f), emit: (ev, d) => s.got.push([ev, d]),
    join: (c) => { s.joined.add(c); s.rooms.add(c); }, leave: (c) => { s.joined.delete(c); s.rooms.delete(c); },
    to: (c) => ({ emit: (ev, d) => roomSockets(c).filter((x) => x !== s).forEach((x) => x.got.push([ev, d])) }), h };
  sockets.set(id, s); connectionCb(s); return s;
}
registerSockets(io);
const a = connect('A'), b = connect('B');
let ackA, ackB;
a.h['room:join']({ name: 'Alice', room: 'x1', map: 'neon', car: 'velocity' }, (r) => (ackA = r));
b.h['room:join']({ name: 'Bob', room: 'X1', map: 'frost', car: 'zenith' }, (r) => (ackB = r));
assert.equal(ackA.room, 'X1'); assert.equal(ackA.map, 'neon'); assert.equal(ackB.map, 'neon', 'joiner gets the room\'s map, not the one asked for');
assert.equal(ackB.players.length, 2); assert.equal(ackA.you.car, 'velocity'); assert.equal(ackB.players.find((p) => p.id === 'A').car, 'velocity'); assert.equal(ackB.you.slot, 1);
assert.ok(a.got.some(([e, d]) => e === 'room:joined' && d.id === 'B' && d.name === 'Bob' && d.car === 'zenith'), 'Alice told about Bob');
a.h['player:state']({ x: 1, z: 2, h: 0, vx: 0, vz: 0, st: 0, yr: 0, f: 0 });
b.h['player:state']({ x: 5, z: 6, h: 0, vx: 0, vz: 0, st: 0, yr: 0, f: 4 });
await new Promise((r) => setTimeout(r, 130));
const snap = a.got.filter(([e]) => e === 'room:snapshot').at(-1)?.[1];
assert.ok(snap, 'snapshot broadcast'); assert.equal(snap.players.length, 2);
b.h.disconnect();
assert.ok(a.got.some(([e, d]) => e === 'room:left' && d.id === 'B'), 'Alice told Bob left');
let bad; b.h['room:join']({ name: 'B' }, () => {}); // joining without ack must not throw
console.log('sockets tests passed'); process.exit(0);
