// Elevation + 3D vehicle physics, headless: terrain profile, jumps, flips, crashes, hills, collisions, netcode fields.
import assert from 'node:assert/strict';
import { Vehicle } from '../public/js/physics/Vehicle.js';
import { Colliders } from '../public/js/physics/Collision.js';
import { qRot } from '../public/js/physics/rigid.js';
import { Terrain, makeProfile, featureSpan } from '../public/js/world/terrain.js';
import { BASE_MAPS as MAPS, MAP_IDS, getMap } from '../public/js/world/maps.js';
import { NetBuffer } from '../public/js/vehicle/NetBuffer.js';
import { Rooms } from '../server/rooms.js';
import { worldFor, spawn, run, DT, NONE } from './_lab3d.mjs';

const tiltDeg = (v) => Math.acos(Math.max(-1, Math.min(1, v.upY))) * 57.3;
const gas = (c) => ({ throttle: c.airborne ? 0 : 1 });

// ---- profile maths ----
{
  const p = makeProfile({ hills: [{ at: 0.1, len: 100, hold: 50, h: 10 }], kickers: [{ at: 0.5, len: 20, h: 2 }], tables: [{ at: 0.7, up: 10, top: 10, down: 10, h: 3 }] }, 2000);
  assert.equal(p(0), 0); assert.ok(Math.abs(p(200 + 100) - 10) < 1e-9 && Math.abs(p(200 + 125) - 10) < 1e-9, 'hill plateau');
  assert.ok(Math.abs(p(200 + 50) - 5) < 1e-9, 'half-way up the climb'); assert.ok(p(200 + 250) < 1e-9, 'back to the base');
  assert.ok(Math.abs(p(1000 + 20 - 1e-6) - 2) < 1e-4, 'top of the kicker'); assert.ok(p(1000 + 20 + 0.31) < 1.1 && p(1000 + 21) === 0, 'the lip falls away within a metre');
  assert.equal(p(1400 + 15), 3, 'table top is flat'); assert.equal(p(1400 + 31), 0);
  assert.equal(makeProfile(null, 1000)(123), 0);
}

// ---- every elevated map: well-formed, starting grid flat, features do not overlap, no map becomes a mountain ----
const elevMaps = MAPS.filter((m) => m.elev);
assert.equal(elevMaps.length, MAPS.length, 'every hilly map has elevation');
for (const m of MAPS) { const f = worldFor(m.id + 'flat'); assert.ok(f.terrain.flat && f.map.flat && f.terrain.height(f.track.px[10], f.track.pz[10]) === 0, `${m.id}flat is perfectly flat`); }
assert.ok(MAP_IDS.every((id) => getMap(id).id === id));
for (const m of elevMaps) {
  const { track, terrain } = worldFor(m.id), L = track.length, tag = `[${m.id}]`, spans = [];
  for (const kind of ['hills', 'kickers', 'tables']) for (const f of terrain.elev[kind]) { // terrain.elev has rollers expanded into hills
    assert.ok(f.at > 0 && f.at < 1 && f.h > 0, `${tag} ${kind} sane`);
    spans.push([f.at * L, f.at * L + featureSpan(f, kind), kind]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < spans.length; i++) assert.ok(spans[i][0] >= spans[i - 1][1] - 1e-6, `${tag} features overlap`);
  assert.ok(spans[spans.length - 1][1] < L - 150, `${tag} last 150 m before the line must be flat (starting grid)`);
  let max = 0, maxSlope = 0, prev = 0;
  for (let s = 0; s < L; s += 0.5) { const y = terrain.profile(s); max = Math.max(max, y); if (s) maxSlope = Math.max(maxSlope, Math.abs(y - prev) / 0.5 * (y - prev > 0 && Math.abs(y - prev) < 0.45 ? 1 : 0)); prev = y; }
  assert.ok(terrain.profile(0) === 0 && terrain.profile(L - 1) === 0, `${tag} flat at the line`);
  assert.ok(max <= 20, `${tag} max height ${max}`); assert.ok(maxSlope < 0.35, `${tag} climbs no steeper than ${maxSlope.toFixed(2)}`);
  console.log(`${m.id.padEnd(9)} max height ${max.toFixed(1)} m, steepest climb ${(Math.atan(maxSlope) * 57.3).toFixed(1)}°`);
}
{ const { terrain } = worldFor('sunset', null); assert.ok(terrain.flat && terrain.height(5, 5) === 0); assert.deepEqual(terrain.normal(0, 0), [0, 1, 0]); }

// ---- ground queries agree with the embankment formula the mesh is built from ----
{
  const { track, terrain } = worldFor('alpine');
  for (let k = 0; k < 400; k++) {
    const i = (k * 37) % track.n, side = k % 2 ? 1 : -1, d = terrain.barrierOff + (k % 20), y = terrain.roadAt(i);
    const x = track.px[i] - track.tz[i] * side * d, z = track.pz[i] + track.tx[i] * side * d;
    assert.ok(Math.abs(terrain.height(x, z) - terrain.bank(y, d)) < 0.35, 'bank height matches mesh formula'); // tolerance: nearest-point vs sample
  }
  const i = 100, x = track.px[i], z = track.pz[i]; assert.ok(Math.abs(terrain.height(x, z) - terrain.roadAt(i)) < 0.05, 'on the centre-line the ground is the road');
}

// ---- flat terrain behaves exactly like no terrain ----
{
  const w = worldFor('sunset', null), a = new Vehicle(), b = new Vehicle(); a.reset(0, 0, 0); b.reset(0, 0, 0);
  for (let i = 0; i < 1200; i++) {
    const inp = { ...NONE, throttle: 1, steer: Math.sin(i / 90), handbrake: i % 400 > 330, nitro: i > 600 };
    a.update(DT, inp); b.update(DT, inp, false, w.terrain);
  }
  assert.ok(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.z - b.z) < 1e-9 && Math.abs(a.heading - b.heading) < 1e-9, 'flat terrain = old physics');
  assert.equal(b.y, 0); assert.equal(b.mode, 'ground');
}

// ---- jump over a kicker: climbs, flies, lands on its wheels, further when faster ----
{
  const w = worldFor('highway'), L = w.track.length, dist = [];
  for (const v of [15, 35, 55]) {
    const car = spawn(w, 0.53 * L - 60, v); let maxY = 0, tilt = 0;
    const log = run(w, car, 7, gas, { stopOnLand: true, hook(c) { maxY = Math.max(maxY, c.y); tilt = Math.max(tilt, tiltDeg(c)); } });
    const land = log.find((e) => e.type === 'land');
    assert.ok(land && land.air > 0.8 && land.dist > 25, `v=${v}: real air time (${land?.air}s, ${land?.dist}m)`);
    assert.ok(maxY > 2.4, 'left the 2 m lip going up'); assert.ok(tilt < 15, 'stays level in flight'); assert.ok(land.impact < 12, 'survivable landing');
    assert.equal(car.mode, 'ground'); assert.ok(!log.some((e) => e.type === 'crash'), 'no crash'); assert.ok(Math.abs(car.y) < 0.05, 'back on the road');
    dist.push(land.dist); console.log(`kicker @ start speed ${v}: ${land.air.toFixed(2)} s air, ${land.dist.toFixed(0)} m, impact ${land.impact.toFixed(1)} m/s`);
  }
  assert.ok(dist[0] < dist[1] && dist[1] < dist[2], 'higher speed = longer jump');
}
// ---- every kicker and table-top on every map is jumpable at city and highway speed: lands wheels-down on the road, no crash ----
{
  let runs = 0;
  for (const m of MAPS) {
    const w = worldFor(m.id), L = w.track.length, E = w.terrain.elev;
    for (const [kind, at] of [...E.kickers.map((f) => ['kicker', f.at]), ...E.tables.map((f) => ['table', f.at])]) for (const v of [25, 45]) {
      const car = spawn(w, at * L - 100, v); let lat = 0, crashed = false;
      const log = run(w, car, 9, (c) => ({ throttle: !c.airborne && c.speed < v ? 1 : 0 }), { stopOnLand: true, hook(c) { lat = Math.max(lat, Math.abs(w.terrain._locate(c.x, c.z).lat)); crashed ||= c.crashed; } });
      const ev = log.find((e) => e.type === 'land'); runs++;
      assert.ok(ev && !crashed && lat < w.terrain.barrierOff - 0.5 && ev.impact < 14, `${m.id} ${kind} @${at} v=${v}: lands cleanly on the road`);
    }
  }
  console.log(`${runs} jump runs across ${MAPS.length} maps: all land cleanly`);
}
// ---- table-top ----
{
  const w = worldFor('highway'), L = w.track.length, car = spawn(w, 0.06 * L - 80, 20); let air = 0;
  const log = run(w, car, 6, gas, { stopOnLand: true, hook(c) { if (c.airborne) air += DT; } });
  assert.ok(air > 0.8 && log.some((e) => e.type === 'land') && car.mode === 'ground' && !log.some((e) => e.type === 'crash'), 'table-top jump lands cleanly');
}
// ---- air control: barrel roll (A/D), flips (W/S) ----
{
  const w = worldFor('saltflats'), L = w.track.length, at = 0.255 * L - 150;
  let car = spawn(w, at, 30);
  let log = run(w, car, 7, (c) => ({ throttle: c.airborne ? 0 : 1, steer: c.airborne ? 1 : 0 }), { stopOnLand: true });
  const roll = log.find((e) => e.type === 'land');
  assert.ok(roll && Math.abs(roll.flipsRoll) > 0.85 && car.mode === 'ground' && tiltDeg(car) < 20, 'hold D in the air: one clean barrel roll');
  car = spawn(w, at, 30); log = run(w, car, 7, (c) => ({ throttle: c.airborne ? 0 : 1, brake: c.airborne ? 1 : 0 }));
  assert.ok(log.some((e) => e.type === 'crash') || car.tumble, 'hold S all the way: over-rotates and crashes');
  car = spawn(w, at, 30); log = run(w, car, 7, (c) => ({ throttle: 1 }));
  assert.ok(car.tumble || log.some((e) => e.type === 'crash'), 'hold W in the air: nose-dive into the road');
  car = spawn(w, at, 30); log = run(w, car, 7, (c) => ({ throttle: c.airborne ? 0 : 1, handbrake: c.airborne }), { stopOnLand: true });
  assert.ok(car.mode === 'ground' && !log.some((e) => e.type === 'crash'), 'handbrake auto-levels the car');
}
// ---- crashes: dropped upside-down comes to rest and asks for a reset; dropped on its wheels it just lands ----
{
  const w = worldFor('highway'); let car = spawn(w, 300, 0);
  Object.assign(car, { mode: 'air', tumble: true, y: 4, q: [1, 0, 0, 0], clearT: 1, w: [0.5, 0.2, 0.3] }); car._comFromOrigin();
  for (let t = 0; t < 900 && !car.needsReset; t++) car.update(DT, NONE, false, w.terrain);
  assert.ok(car.needsReset && car.speed < 0.5 && car.upY < -0.5 && car.y > -0.01, 'upside-down car rests on its roof and flags reset');
  car = spawn(w, 450, 20); Object.assign(car, { mode: 'air', y: 5, clearT: 1, air: { t: 0, x0: car.x, z0: car.z, pitch: 0, roll: 0 } }); car._comFromOrigin();
  const log = run(w, car, 3, {}, { keepLane: false });
  assert.ok(car.mode === 'ground' && Math.abs(car.y) < 0.05 && log.some((e) => e.type === 'land' && e.impact > 7), 'dropping 5 m on the wheels is a hard but clean landing');
  const R = new Vehicle(); R.reset(10, 10, 1, 3); assert.ok(!R.needsReset && R.y === 3 && R.mode === 'ground', 'reset clears crash state');
}
// ---- hills: gravity slows the climb; no spurious hops; always on the ground ----
{
  const w = worldFor('coastal'), L = w.track.length, car = spawn(w, 0.45 * L - 120, 30); let lifts = 0, was = false, topY = 0, minSpeed = 99;
  run(w, car, 16, (c) => ({ throttle: c.speed < 30 ? 1 : 0 }), { hook(c) { if (c.airborne && !was) lifts++; was = c.airborne; topY = Math.max(topY, c.y); if (c.y > 8) minSpeed = Math.min(minSpeed, c.speed); } });
  assert.equal(lifts, 0, 'a smooth hill never throws the car'); assert.ok(topY > 8.5, 'reaches the 9 m plateau');
  // same hill, engine off: coasting uphill loses speed, downhill gains it
  const c2 = spawn(w, 0.45 * L - 20, 25); let v0 = c2.speed, vTop = 0;
  run(w, c2, 3.5, {}, { hook(c, t) { if (t > 3.4) vTop = c.speed; } });
  assert.ok(vTop < v0 - 1.5, `coasting up a slope slows the car (${v0.toFixed(1)} -> ${vTop.toFixed(1)})`);
}
// ---- every elevated map: long run stays finite and never sinks into the ground ----
for (const m of elevMaps) {
  const w = worldFor(m.id), car = spawn(w, 0, 20); let worst = 0;
  run(w, car, 25, (c) => ({ throttle: !c.airborne && c.speed < 26 ? 1 : 0 }), { hook(c) { worst = Math.max(worst, w.terrain.height(c.x, c.z) - c.y); } });
  assert.ok(worst < 0.5, `${m.id}: car never sinks into the terrain (${worst.toFixed(2)} m)`);
}
// ---- obstacles have a height: you can fly over a wall, not drive through it ----
{
  const cols = new Colliders(); cols.addBox(0, 40, 6, 0.5, 0, 0, 0.9);
  const fly = new Vehicle(); fly.reset(0, 30, 0, 3); fly.vz = 20; let hit = 0; for (let i = 0; i < 120; i++) { fly.z += 0.1; hit = Math.max(hit, fly.collide(cols)); }
  assert.equal(hit, 0, 'a car 3 m up clears a 0.9 m barrier');
  const low = new Vehicle(); low.reset(0, 30, 0, 0); low.vz = 20; low.vF = 20; hit = 0; for (let i = 0; i < 120; i++) { low.z += 0.1; hit = Math.max(hit, low.collide(cols)); }
  assert.ok(hit > 1, 'a car on the road hits it');
}
// ---- network: server accepts / sanitises the 3D fields, NetBuffer interpolates them ----
{
  const R = new Rooms(); R.join('a', 'A', 'x3d');
  const base = { x: 1, z: 2, h: 0.5, vx: 3, vz: 4, st: 0, yr: 0, f: 32 };
  assert.ok(R.update('a', { ...base, y: 6.1234, vy: -4.5, q: [0.1, 0.2, 0.3, 0.9] }, 1000));
  const s = R.snapshot(R.roomOf('a'), 1100)[0]; assert.equal(s.y, 6.12); assert.equal(s.vy, -4.5); assert.deepEqual(s.q, [0.1, 0.2, 0.3, 0.9]);
  assert.ok(R.update('a', base, 2000) && R.snapshot(R.roomOf('a'), 2100)[0].y === undefined, 'older clients without 3D fields still work');
  assert.ok(!R.update('a', { ...base, y: NaN }, 3000), 'NaN height rejected'); assert.ok(!R.update('a', { ...base, y: 1e7 }, 4000), 'absurd height rejected');
  assert.ok(R.update('a', { ...base, q: [5, 5, 5, 5] }, 5000) && R.snapshot(R.roomOf('a'), 5100)[0].q === undefined, 'bad quaternion dropped, rest accepted');
  const nb = new NetBuffer(), mk = (t, y, vy, qz, w) => ({ x: 0, z: 0, h: 0, vx: 0, vz: 0, st: 0, yr: 0, f: 32, y, vy, q: [0, 0, qz, w], ts: t });
  const sq = Math.SQRT1_2; nb.push(mk(1000, 0, 10, 0, 1), 10); nb.push(mk(1100, 1.0, 0, sq, sq), 10.1);
  const m = nb.sample(10.05 + 0.1 + (nb.off ?? 0) * 0); // somewhere between the two samples
  assert.ok(m && m.y >= 0 && m.y <= 1.05 && Math.abs(Math.hypot(...m.q) - 1) < 1e-9, 'y + unit quaternion interpolated');
}
// ---- quaternion helper agrees with the car's basis (X = left, Y = up, Z = forward) ----
{
  const car = new Vehicle(); car.reset(0, 0, Math.PI / 2); const f = qRot(car.q, [0, 0, 1]), l = qRot(car.q, [1, 0, 0]);
  assert.ok(Math.abs(f[0] - 1) < 1e-9 && Math.abs(f[2]) < 1e-9, 'forward at heading 90° = +x');
  assert.ok(Math.abs(l[2] - -1) < 1e-9, 'left of a +x car is -z'); // right-hand rule: x = y × z
}
console.log('terrain tests passed');
