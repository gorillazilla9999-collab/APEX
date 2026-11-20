import assert from 'node:assert/strict';
import { Vehicle } from '../public/js/physics/Vehicle.js';
import { CARS, CAR_IDS, DEFAULT_CAR, isCar, getCar, tuningFor, STATS } from '../public/js/vehicle/cars.js';
import { MAPS } from '../public/js/world/maps.js';
import { lap } from './balance.mjs';

assert.ok(CARS.length >= 6 && new Set(CAR_IDS).size === CARS.length && isCar(DEFAULT_CAR) && !isCar('x') && getCar('nope').id === CARS[0].id);
for (const c of CARS) {
  assert.ok(c.name && c.tag && Number.isInteger(c.color), c.id);
  for (const k of STATS) assert.ok(c.stats[k] >= 1 && c.stats[k] <= 10, `${c.id}.${k}`);
}
assert.deepEqual(tuningFor({ stats: { speed: 6, accel: 6, turn: 6, brake: 6 } }).topSpeed, 60, 'baseline car = original tuning');

// --- measurable differences between cars (each car must be best or tied-best at something) ---
const NONE = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
const drive = (v, secs, inp, until) => { let t = 0; for (; t < secs * 120; t++) { v.update(1 / 120, inp); if (until?.(v)) break; } return t / 120; };
const m = {};
for (const c of CARS) {
  let v = new Vehicle(tuningFor(c)); drive(v, 30, { ...NONE, throttle: 1 }); const top = v.speedKmh;
  v = new Vehicle(tuningFor(c)); const t100 = drive(v, 30, { ...NONE, throttle: 1 }, (x) => x.speedKmh >= 100);
  v = new Vehicle(tuningFor(c)); drive(v, 12, { ...NONE, throttle: 1 }); const x0 = v.x, z0 = v.z; v.vx = v.vz = 0; v.vx = Math.sin(v.heading) * 27.78; v.vz = Math.cos(v.heading) * 27.78;
  drive(v, 10, { ...NONE, brake: 1 }, (x) => x.speed < 0.5); const stop = Math.hypot(v.x - x0, v.z - z0);
  v = new Vehicle(tuningFor(c)); drive(v, 8, { ...NONE, throttle: 1 }); const h0 = v.heading; drive(v, 1.2, { ...NONE, steer: 1 }); const turn = Math.abs(v.heading - h0);
  m[c.id] = { top, t100, stop, turn };
}
console.log('car'.padEnd(10), 'top km/h', ' 0-100 s', ' 100-0 m', ' turn rad/1.2s');
for (const c of CARS) console.log(c.id.padEnd(10), m[c.id].top.toFixed(0).padStart(8), m[c.id].t100.toFixed(2).padStart(8), m[c.id].stop.toFixed(1).padStart(8), m[c.id].turn.toFixed(2).padStart(10));
const best = (key, dir) => CARS.map((c) => c.id).sort((a, b) => dir * (m[a][key] - m[b][key]))[0];
assert.equal(best('top', -1), 'velocity'); assert.equal(best('t100', 1), 'blaze'); assert.equal(best('turn', -1), 'zenith'); assert.equal(best('stop', 1), 'bulldog');
assert.ok(m.velocity.top > m.apex.top + 15 && m.blaze.t100 < m.apex.t100 - 0.15 && m.zenith.turn > m.apex.turn + 0.04 && m.bulldog.stop < m.apex.stop - 1.5, 'clear gaps to the baseline');

// --- overall balance: AI laps on every map ---
const times = CARS.map((c) => MAPS.map((map) => lap(map, c)));
for (const r of times) for (const x of r) { assert.ok(x.done, 'lap completed'); assert.ok(x.grass < 2, 'stays on the road'); }
const mean = times.map((r) => r.reduce((a, x) => a + x.time, 0) / r.length), lo = Math.min(...mean), hi = Math.max(...mean);
console.log('mean lap times:', CARS.map((c, i) => `${c.id} ${mean[i].toFixed(1)}`).join(' | '), `| spread ${(((hi - lo) / lo) * 100).toFixed(2)}%`);
assert.ok((hi - lo) / lo < 0.012, 'no car is faster overall than another (mean lap time spread < 1.2%)');
MAPS.forEach((map, i) => { const ts = times.map((r) => r[i].time), s = (Math.max(...ts) - Math.min(...ts)) / Math.min(...ts); assert.ok(s < 0.06, `${map.id} spread ${s}`); });
console.log('cars tests passed');
