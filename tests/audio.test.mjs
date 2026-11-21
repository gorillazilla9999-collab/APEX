import assert from 'node:assert/strict';
import { VOICES, voiceFor, firingHz, harmonicSeries, driveCurve, gearFor, rpmForSpeed, dopplerRatio, panFor, frontness, distanceGain } from '../public/js/core/audioMath.js';
import { CAR_IDS } from '../public/js/vehicle/cars.js';
import { Vehicle, TUNING } from '../public/js/physics/Vehicle.js';

// every car has its own voice, and each voice is sane
for (const id of CAR_IDS) {
  const v = VOICES[id]; assert.ok(v, 'voice for ' + id);
  assert.ok(v.cyl >= 4 && v.cyl <= 12 && v.tilt > 0.5 && v.bright > 0.3);
  const { real, imag } = harmonicSeries(v); assert.equal(real.length, 33); assert.equal(imag[0], 0);
  assert.ok([...imag].every(Number.isFinite) && imag[1] > imag[20], 'fundamental stronger than high harmonics');
}
assert.equal(voiceFor('nope'), VOICES.apex);
assert.equal(new Set(CAR_IDS.map((id) => VOICES[id].cyl + '/' + VOICES[id].tilt)).size, CAR_IDS.length, 'voices are distinct');

// firing frequency: V8 at 6000 rpm = 400 Hz, 4-cyl at 3000 = 100 Hz
assert.equal(firingHz(6000, 8), 400); assert.equal(firingHz(3000, 4), 100);

// soft-clip curve is bounded, odd-symmetric and monotonic
const cv = driveCurve(2.5); assert.ok(Math.abs(cv[0] + 1) < 1e-6 && Math.abs(cv[cv.length - 1] - 1) < 1e-6);
for (let i = 1; i < cv.length; i++) assert.ok(cv[i] >= cv[i - 1]);

// gear / rpm model matches the real gearbox in Vehicle.js at steady speed
assert.equal(gearFor(5), 1); assert.equal(gearFor(30), 3); assert.equal(gearFor(70), 6);
const veh = new Vehicle(TUNING); veh.reset(0, 0, 0);
const inp = { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false };
for (let i = 0; i < 60 * 14; i++) {
  veh.update(1 / 60, inp);
  if (i > 60 && i % 120 === 0) assert.ok(Math.abs(veh.rpm - rpmForSpeed(Math.abs(veh.vF))) < 900, `rpm model close at ${veh.speed.toFixed(0)} m/s: ${veh.rpm.toFixed(0)} vs ${rpmForSpeed(veh.speed).toFixed(0)}`);
}
let prev = 0; for (let s = 0; s < 14; s += 0.5) { const r = rpmForSpeed(s); assert.ok(r >= prev && r <= 7500); prev = r; }

// Doppler: approaching raises pitch, receding lowers it, and it is symmetric/bounded
assert.ok(dopplerRatio(0, 100, 0, -50, 0, 0) > 1, 'approaching = higher');
assert.ok(dopplerRatio(0, 100, 0, 50, 0, 0) < 1, 'receding = lower');
assert.equal(dopplerRatio(0, 100, 20, 0, 0, 0), 1, 'sideways motion = no shift');
assert.ok(dopplerRatio(0, 5, 0, -400, 0, 0) <= 1.25);

// stereo: listener faces +z (forward = (0,1)); right is -x? right = (-fz, fx) = (-1, 0)
assert.equal(panFor(0, 20, 0, 1), 0, 'dead ahead is centred');
assert.ok(panFor(-20, 0, 0, 1) > 0.5, 'source on the right side pans right');
assert.ok(panFor(20, 0, 0, 1) < -0.5, 'source on the left pans left');
assert.ok(frontness(0, 20, 0, 1) > 0.99 && frontness(0, -20, 0, 1) < -0.99);

// distance: loud when close, quieter far, silent past the limit
assert.equal(distanceGain(5), 1); assert.ok(distanceGain(60) < distanceGain(20)); assert.equal(distanceGain(200), 0);
console.log('audio tests passed');
