import assert from 'node:assert/strict';
import { Rooms, MAX_PER_ROOM, cleanRoom, cleanName } from '../server/rooms.js';

const R = new Rooms();
assert.equal(cleanRoom('  ab-c!d  '), 'ABCD'); assert.equal(cleanRoom(''), 'PUBLIC'); assert.equal(cleanName('<b>Bob</b>'), 'bBobb');
let a = R.join('a', 'Alice', 'race1'), b = R.join('b', 'Bob', 'RACE1');
assert.equal(a.player.slot, 0); assert.equal(b.player.slot, 1); assert.equal(b.players.length, 2);
assert.notEqual(a.player.color, b.player.color);

// state validation + rate limit
const good = { x: 10.123, z: -5, h: 1.5, vx: 3, vz: 4, st: 0.2, yr: 0.1, f: 3 };
assert.ok(R.update('a', good, 1000));
assert.ok(!R.update('a', good, 1010), 'rate-limited');
assert.ok(!R.update('a', { ...good, x: NaN }, 2000), 'NaN rejected');
assert.ok(!R.update('a', { ...good, x: 1e9 }, 2000), 'out of range rejected');
assert.ok(!R.update('ghost', good, 2000));
assert.ok(R.update('b', { ...good, x: 20 }, 1000));
const snap = R.snapshot(R.roomOf('a'), 1500);
assert.equal(snap.length, 2); assert.equal(snap[0].x, 10.12); assert.equal(snap[0].away, 0);
assert.equal(R.snapshot(R.roomOf('a'), 20000)[0].away, 1, 'stale players flagged away');

// slot reuse after leave, room cleanup, full room
R.leave('a'); assert.equal(R.join('c', 'Cy', 'race1').player.slot, 0);
R.leave('b'); R.leave('c'); assert.equal(R.rooms.size, 0);
for (let i = 0; i < MAX_PER_ROOM; i++) assert.ok(!R.join('p' + i, 'P', 'full').error);
assert.equal(R.join('extra', 'X', 'full').error, 'ROOM FULL');
// rejoining another room moves the player
R.join('p0', 'P', 'other'); assert.equal(R.roomOf('p0').code, 'OTHER'); assert.equal(R.roomOf('p1').players.size, MAX_PER_ROOM - 1);

// ---- maps ----
const M = new Rooms();
let n1 = M.join('n1', 'N', '', 1, 'neon'), s1 = M.join('s1', 'S', '', 1, 'sunset'), n2 = M.join('n2', 'N2', 'PUBLIC', 1, 'neon');
assert.equal(n1.room.map, 'neon'); assert.equal(s1.room.map, 'sunset'); assert.equal(n1.room.label, 'PUBLIC');
assert.equal(n2.room, n1.room, 'public lobby is per map'); assert.notEqual(s1.room, n1.room);
assert.equal(M.rooms.size, 2);
// a private room keeps the map of whoever created it
let p1 = M.join('p1', 'P', 'garage', 1, 'dunes'), p2 = M.join('p2', 'Q', 'GARAGE', 1, 'frost');
assert.equal(p1.room.map, 'dunes'); assert.equal(p2.room.map, 'dunes'); assert.equal(p2.room, p1.room);
// bad / missing map ids fall back to the default; a private code can't collide with a public lobby
assert.equal(M.join('x1', 'X', 'bad1', 1, '../../etc').room.map, 'sunset'); assert.equal(M.join('x2', 'X', 'bad2', 1).room.map, 'sunset');
assert.equal(M.join('x3', 'X', 'bad3', 1, { toString() { return 'neon'; } }).room.map, 'sunset', 'non-string map ignored');
assert.ok(![...M.rooms.keys()].some((k) => k === 'PUBLIC'), 'public lobbies are keyed per map');
console.log('rooms tests passed');
