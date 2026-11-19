import assert from 'node:assert/strict';
import { Vehicle } from '../public/js/physics/Vehicle.js';
import { Colliders, collideVehicle } from '../public/js/physics/Collision.js';

const none = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
const run = (v, secs, inp, cols) => { let impact = 0; for (let i = 0; i < secs * 120; i++) { v.update(1 / 120, inp); if (cols) impact = Math.max(impact, collideVehicle(v, cols)); } return impact; };

let v = new Vehicle();
run(v, 6, { ...none, throttle: 1 });
console.log('6s full throttle  km/h:', v.speedKmh.toFixed(0), 'gear', v.gearLabel);
assert(v.speedKmh > 120 && v.speedKmh < 230);

v = new Vehicle(); run(v, 12, { ...none, throttle: 1 });
const base = v.speedKmh; run(v, 3, { ...none, throttle: 1, nitro: true });
console.log('nitro 3s km/h:', base.toFixed(0), '->', v.speedKmh.toFixed(0));
assert(v.speedKmh > base + 15 && v.nitro < 0.5);

run(v, 4, { ...none, brake: 1 });
console.log('after braking:', v.speedKmh.toFixed(1));
run(v, 3, { ...none, brake: 1 });
assert(v.vF < -3, 'reverses');

v = new Vehicle(); run(v, 5, { ...none, throttle: 1 });
const h0 = v.heading; run(v, 1.5, { ...none, throttle: 1, steer: 1 });
console.log('turn right: heading delta', (v.heading - h0).toFixed(2));
assert(v.heading < h0, 'right steer decreases heading');

v = new Vehicle(); run(v, 5, { ...none, throttle: 1 });
run(v, 0.8, { ...none, throttle: 1, steer: -1, handbrake: true });
console.log('handbrake slide |vR|:', Math.abs(v.vR).toFixed(1), 'sliding', v.sliding);
assert(Math.abs(v.vR) > 3 && v.sliding);

// wall: car driving +x into a box at x=60
const cols = new Colliders(); cols.addBox(60, 0, 1, 20, 0);
v = new Vehicle(); v.reset(0, 0, Math.PI / 2);
const impact = run(v, 8, { ...none, throttle: 1 }, cols);
console.log('wall impact m/s:', impact.toFixed(1), 'x:', v.x.toFixed(1));
assert(impact > 5 && v.x < 60 && Number.isFinite(v.x));
console.log('all physics checks passed');
