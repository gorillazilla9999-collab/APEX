import assert from 'node:assert/strict';
import { Rooms, trackFor } from '../server/rooms.js';
import { RaceSession, RaceTracker, cleanSettings, gridPose, COUNTDOWN_MS, DNF_GRACE_MS, DEFAULT_SETTINGS } from '../public/js/race/RaceSession.js';
import { fmtTime, fmtGap, ordinal } from '../public/js/race/format.js';

// ---- settings validation ----
assert.deepEqual(cleanSettings({ laps: 5, nitro: false, map: 'neon', maxPlayers: 4 }), { map: 'neon', laps: 5, nitro: false, maxPlayers: 4 });
assert.deepEqual(cleanSettings({ laps: 0, map: '../x', nitro: 'yes', maxPlayers: 99 }), DEFAULT_SETTINGS, 'invalid values ignored');
assert.equal(cleanSettings({ laps: 31 }).laps, DEFAULT_SETTINGS.laps); assert.equal(cleanSettings({ laps: 2.5 }).laps, DEFAULT_SETTINGS.laps); assert.equal(cleanSettings(null).laps, 3);

// ---- formatting ----
assert.equal(fmtTime(83456), '1:23.456'); assert.equal(fmtTime(null), '--:--.---'); assert.equal(fmtGap(1.26), '+1.3'); assert.equal(fmtGap(null), '');
assert.deepEqual([1, 2, 3, 4, 11, 12, 21].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '21st']);

// ---- grid ----
const track = trackFor('sunset');
const g0 = gridPose(track, 0), g1 = gridPose(track, 1), g5 = gridPose(track, 5);
assert.equal(g0.index, 0); assert.ok(g1.index > track.n / 2 && g5.index < g1.index, 'rows are behind the line, further back');
assert.ok(Math.hypot(g0.x - g1.x, g0.z - g1.z) > 8, 'cars do not overlap');

// ---- a driver model: follows the centre-line at constant speed ----
const at = (t, idx, off = 0) => { const i = ((Math.round(idx) % t.n) + t.n) % t.n; return [t.px[i] - t.tz[i] * off, t.pz[i] + t.tx[i] * off]; };
class Driver {
  constructor(id, track, slot, speed) { this.id = id; this.t = track; this.pos = gridPose(track, slot).index; this.speed = speed; }
  step(dt) { this.pos += (this.speed * dt) / this.t.ds; return at(this.t, this.pos); }
}
function run(session, drivers, from, until, dt = 33, cb) {
  let now = from;
  while (now < until && session.phase !== 'results' && session.phase !== 'lobby') {
    for (const d of drivers) { if (d.stopped) continue; const [x, z] = d.step(dt / 1000); session.update(d.id, x, z, d.speed, now); }
    session.tick(now); cb?.(now); now += dt;
  }
  return now;
}

// ---- a full race: two drivers, 3 laps ----
{
  const s = new RaceSession(trackFor); s.setSettings({ laps: 3 });
  const A = new Driver('A', track, 0, 50), B = new Driver('B', track, 1, 44);
  const st = s.start([{ id: 'A', name: 'Ann' }, { id: 'B', name: 'Bob' }], 1000);
  assert.equal(s.phase, 'countdown'); assert.equal(st.goAt, 1000 + COUNTDOWN_MS); assert.deepEqual(st.grid, { A: 0, B: 1 });
  assert.equal(s.setSettings({ laps: 9 }), false, 'settings locked once the race starts');
  s.update('A', ...at(track, A.pos), 0, 1100); s.update('B', ...at(track, B.pos), 0, 1100); // sitting on the grid
  assert.equal(s.tick(2000), null); assert.equal(s.tick(st.goAt), 'racing');
  let sawLeader = null;
  run(s, [A, B], st.goAt, st.goAt + 400000, 33, (now) => { if (now > st.goAt + 20000 && !sawLeader) sawLeader = s.order()[0].id; });
  assert.equal(sawLeader, 'A', 'faster car leads');
  assert.equal(s.phase, 'results'); const [r1, r2] = s.results;
  assert.equal(r1.id, 'A'); assert.equal(r1.place, 1); assert.equal(r2.id, 'B'); assert.equal(r2.place, 2); assert.ok(!r1.dnf && !r2.dnf);
  assert.ok(r1.totalMs < r2.totalMs);
  const lapA = (track.length / 50) * 1000; assert.ok(Math.abs(r1.bestMs - lapA) < 150, `lap time ${r1.bestMs} ~ ${lapA}`);
  assert.equal(r1.laps, 3);
  assert.equal(s.tickPayload(st.goAt + 90000).rows[0][0], 'A');
  assert.equal(s.tick(s.resultsAt), 'lobby'); assert.equal(s.phase, 'lobby');
}

// ---- cheating / mistakes don't earn laps ----
{
  const s = new RaceSession(trackFor); s.setSettings({ laps: 2 });
  const st = s.start([{ id: 'C', name: 'Cat' }], 0); const D = new Driver('C', track, 0, 40);
  s.update('C', ...at(track, D.pos), 0, 100); s.tick(st.goAt);
  // drive forward a bit, then teleport to the far side of the track: no progress
  let now = st.goAt; for (let i = 0; i < 100; i++, now += 33) { const [x, z] = D.step(0.033); s.update('C', x, z, 40, now); }
  const before = s.racers.get('C').score;
  for (let i = 0; i < 30; i++, now += 33) { const [x, z] = at(track, D.pos + track.n * 0.5); s.update('C', x, z, 40, now); }
  assert.ok(s.racers.get('C').score <= before + 1, 'jumping across the map earns nothing');
  // reverse over the line and back repeatedly: no lap
  const s2 = new RaceSession(trackFor); const st2 = s2.start([{ id: 'D', name: 'Dan' }], 0); s2.update('D', ...at(track, 0), 0, 1); s2.tick(st2.goAt);
  now = st2.goAt; let idx = 0;
  for (let rep = 0; rep < 6; rep++) for (const dir of [1, -1]) for (let k = 0; k < 40; k++, now += 33) { idx += dir * 3; s2.update('D', ...at(track, idx), 10, now); }
  assert.ok(s2.racers.get('D').tracker.crossings <= 1, 'back and forth over the line never counts extra laps');
  assert.equal(s2.racers.get('D').lapTimes.length, 0);
}

// ---- backwards then forwards through the line = still one crossing ----
{
  const t = new RaceTracker(track); t.init(...at(track, track.n - 20)); assert.equal(t.crossings, 0);
  let evs = []; for (let i = -20; i <= 30; i += 2) evs.push(t.update(...at(track, i)));
  assert.equal(evs.filter(Boolean).length, 1); assert.equal(t.crossings, 1);
}

// ---- DNF: after the winner finishes the rest get a grace period ----
{
  const s = new RaceSession(trackFor); s.setSettings({ laps: 1 });
  const A = new Driver('A', track, 0, 60), Slow = new Driver('S', track, 1, 5);
  const st = s.start([{ id: 'A', name: 'A' }, { id: 'S', name: 'S' }], 0); s.update('A', ...at(track, A.pos), 0, 1); s.update('S', ...at(track, Slow.pos), 0, 1);
  s.tick(st.goAt); let end = run(s, [A, Slow], st.goAt, st.goAt + 600000);
  assert.equal(s.phase, 'results'); assert.equal(s.results[1].dnf, true); assert.equal(s.results[1].totalMs, null);
  assert.ok(end - s.firstFinish >= DNF_GRACE_MS - 100, 'waited for the grace period');
}

// ---- a driver leaving mid-race ----
{
  const s = new RaceSession(trackFor); s.setSettings({ laps: 1 });
  const A = new Driver('A', track, 0, 60), B = new Driver('B', track, 1, 20);
  const st = s.start([{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }], 0); s.update('A', ...at(track, A.pos), 0, 1); s.update('B', ...at(track, B.pos), 0, 1); s.tick(st.goAt);
  s.remove('B', st.goAt + 5000); run(s, [A], st.goAt + 5000, st.goAt + 200000);
  assert.equal(s.phase, 'results'); assert.equal(s.results.length, 1); assert.equal(s.results[0].id, 'A');
  const e = new RaceSession(trackFor); e.start([{ id: 'X', name: 'X' }], 0); e.remove('X', 10); assert.equal(e.phase, 'lobby', 'everyone left before the start -> back to lobby');
}

// ---- rooms: hosting, joining, host powers ----
{
  const R = new Rooms();
  const h = R.join('h', 'Host', '', 1, 'neon', 'blaze', 'host');
  assert.ok(!h.error); assert.match(h.room.label, /^[A-Z0-9]{5}$/); assert.equal(h.room.host, 'h'); assert.equal(h.room.map, 'neon');
  assert.equal(R.join('x', 'X', h.room.label, 1, 'sunset', 'apex', 'host').error, 'CODE IN USE');
  assert.equal(R.join('x', 'X', 'NOPE1', 1, 'sunset', 'apex', 'join').error, 'ROOM NOT FOUND');
  assert.equal(R.join('x', 'X', '', 1, 'sunset', 'apex', 'join').error, 'ENTER A ROOM CODE');
  const j = R.join('j', 'Joe', h.room.label.toLowerCase(), 1, 'sunset', 'apex', 'join'); assert.ok(!j.error); assert.equal(j.room, h.room);
  const pub = R.join('p', 'Pub', 'whatever', 1, 'dunes', 'apex', 'public'); assert.equal(pub.room.label, 'PUBLIC'); assert.equal(pub.room.map, 'dunes');

  // only the host controls the race
  assert.equal(R.setSettings('j', { laps: 9 }).error, 'HOST ONLY'); assert.equal(R.startRace('j').error, 'HOST ONLY');
  let r = R.setSettings('h', { laps: 7, map: 'frost', nitro: false }); assert.ok(r.changed); assert.deepEqual(R.roomState(h.room).settings, { map: 'frost', laps: 7, nitro: false, maxPlayers: 12 });
  assert.equal(h.room.map, 'frost');
  assert.equal(R.setSettings('h', { maxPlayers: 2 }).room.race.settings.maxPlayers, 2); assert.equal(R.join('k', 'K', h.room.label, 1, 'x', 'apex', 'join').error, 'ROOM FULL');
  assert.equal(R.setSettings('h', { maxPlayers: 12 }).room.race.settings.maxPlayers, 12);
  assert.equal(R.setCar('j', 'phantom').room, h.room); assert.equal(R.list(h.room).find((p) => p.id === 'j').car, 'phantom'); assert.ok(R.setCar('j', 'nope').error);

  const st = R.startRace('h', 5000); assert.ok(!st.error); assert.equal(st.goAt, 5000 + COUNTDOWN_MS); assert.deepEqual(Object.keys(st.grid).sort(), ['h', 'j']);
  assert.equal(R.startRace('h', 5001).error, 'RACE IN PROGRESS'); assert.equal(R.setSettings('h', { laps: 2 }).error, 'RACE IN PROGRESS');
  // a latecomer is a spectator until the next race
  const late = R.join('l', 'Late', h.room.label, 6000, 'x', 'apex', 'join'); assert.ok(!late.error); assert.equal(late.players.find((p) => p.id === 'l').spec, 1);
  assert.equal(R.tickRaces(5000 + COUNTDOWN_MS)[0].phase, 'racing');
  // host leaves -> next driver is host; race continues for the rest
  R.leave('h', 9000); assert.equal(h.room.host, 'j'); assert.equal(R.toLobby('j').room.race.phase, 'lobby');
  assert.equal(R.roomState(h.room).players.length, 2);
  const st2 = R.startRace('j', 20000); assert.ok(!st2.error); assert.deepEqual(Object.keys(st2.grid).sort(), ['j', 'l'], 'spectator joins the next race'); assert.equal(R.list(h.room).find((p) => p.id === 'l').spec, 0);
}
// ---- quick play matchmaking ----
{
  const R = new Rooms();
  const a = R.join('a', 'A', '', 1, 'sunset', 'apex', 'public'), b = R.join('b', 'B', '', 1, 'neon', 'apex', 'public');
  assert.equal(b.room, a.room, 'a second quick-player lands in the same public lobby even with a different map choice'); assert.equal(b.room.map, 'sunset');
  R.startRace('a', 10); const c = R.join('c', 'C', '', 20, 'dunes', 'apex', 'public');
  assert.notEqual(c.room, a.room, 'a lobby that is mid-race is skipped'); assert.equal(c.room.label, 'PUBLIC'); assert.equal(c.room.map, 'dunes');
  const d = R.join('d', 'D', '', 30, 'neon', 'apex', 'public'); assert.equal(d.room, c.room, 'joins the open lobby, not the running race');
  R.setSettings('c', { maxPlayers: 2 }); const e = R.join('e', 'E', '', 40, 'neon', 'apex', 'public'); assert.notEqual(e.room, c.room, 'full public lobby is skipped'); assert.ok(R.rooms.has(e.room.code));
}
console.log('race tests passed');
