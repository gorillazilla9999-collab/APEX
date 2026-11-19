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
console.log('rooms tests passed');
