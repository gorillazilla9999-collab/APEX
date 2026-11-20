// Headless lap simulator: an AI driver (pure pursuit + curvature-limited speed profile) drives every car around every map using the real Vehicle physics.
import { Vehicle } from '../public/js/physics/Vehicle.js';
import { CARS, tuningFor } from '../public/js/vehicle/cars.js';
import { MAPS } from '../public/js/world/maps.js';
import { sample, resample } from './_spline.mjs';
import { angleDiff, clamp } from '../public/js/utils.js';

const DT = 1 / 120, CTRL = 4;
function prepare(map) {
  const { P, L, ds } = resample(sample(map.control), 2.5), n = P.length, R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let kmax = 0;
    for (let w = -3; w <= 3; w++) { // curvature smoothed over +-7 m
      const a = P[(i + w - 2 + 2 * n) % n], b = P[(i + w + 2 * n) % n], c = P[(i + w + 2 + 2 * n) % n];
      const d1x = (c[0] - a[0]) / 2, d1z = (c[1] - a[1]) / 2, d2x = c[0] - 2 * b[0] + a[0], d2z = c[1] - 2 * b[1] + a[1];
      kmax = Math.max(kmax, Math.abs(d1x * d2z - d1z * d2x) / Math.pow(d1x * d1x + d1z * d1z, 1.5));
    }
    R[i] = Math.min(3000, 1 / Math.max(kmax, 1e-6));
  }
  return { P, n, ds, R, L };
}

export function lap(map, car, track = prepare(map), opts = {}) {
  const { P, n, ds, R } = track, T = tuningFor(car), v = new Vehicle(T), half = map.roadWidth / 2;
  const hd = Math.atan2(P[1][0] - P[n - 1][0], P[1][1] - P[n - 1][1]);
  v.reset(P[0][0], P[0][1], hd);
  const aCorner = (opts.cornerG ?? 0.5) * T.latGrip, aBrake = (opts.brakeG ?? 0.75) * T.brake;
  let idx = 0, prog = 0, t = 0, grass = 0, inp = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false }, step = 0, maxOff = 0;
  while (prog < n - 1 && t < 400) {
    if (step++ % CTRL === 0) {
      let best = 1e18, bi = idx; // local search for the nearest centre-line sample
      for (let k = -4; k <= 20; k++) { const j = (idx + k + n) % n, d = (P[j][0] - v.x) ** 2 + (P[j][1] - v.z) ** 2; if (d < best) { best = d; bi = j; } }
      prog += (bi - idx + n) % n < n / 2 ? (bi - idx + n) % n : 0; idx = bi;
      const off = Math.sqrt(best); maxOff = Math.max(maxOff, off);
      const sp = Math.max(v.speed, 1), J = Math.min(120, Math.ceil((sp * sp / (2 * aBrake) + 25) / ds));
      // speed profile: never faster than corner speed ahead + what we can still brake away before reaching it
      let vt = v.T.nitroTopSpeed, straight = true;
      for (let j = 0; j <= J; j++) {
        const r = R[(idx + j) % n]; if (j * ds < 60 && r < 200) straight = false;
        vt = Math.min(vt, Math.sqrt(aCorner * r + 2 * aBrake * j * ds));
      }
      const Ld = 7 + 0.3 * sp, tgt = P[(idx + Math.round(Ld / ds)) % n], want = Math.atan2(tgt[0] - v.x, tgt[1] - v.z);
      const err = angleDiff(want, v.heading);
      inp = { throttle: v.speed < vt - 0.4 ? 1 : 0, brake: v.speed > vt + 0.8 ? 1 : 0, steer: clamp(-err * 2.6, -1, 1), handbrake: false, nitro: false };
      inp.nitro = !!(inp.throttle && straight && vt - v.speed > 6);
    }
    v.update(DT, inp, false);
    t += DT;
    if (step % CTRL === 0 && maxOff > half + 1.2) { grass += DT * CTRL; }
    if (step % (CTRL * 6) === 0) maxOff = 0;
  }
  return { time: t, grass, done: prog >= n - 1 };
}

if (process.argv[1] && process.argv[1].endsWith('balance.mjs')) {
  const tracks = MAPS.map(prepare);
  console.log('lap times (s), standing start, AI driver'); console.log('car'.padEnd(10) + MAPS.map((m) => m.id.padStart(9)).join('') + '     mean');
  const sums = [];
  CARS.forEach((c) => {
    const r = MAPS.map((m, i) => lap(m, c, tracks[i])); const ts = r.map((x) => x.time), mean = ts.reduce((a, b) => a + b, 0) / ts.length;
    sums.push(mean); console.log(c.id.padEnd(10) + ts.map((x, i) => (x.toFixed(1) + (r[i].done ? '' : '!') + (r[i].grass > 1 ? '*' : '')).padStart(9)).join('') + mean.toFixed(1).padStart(9));
  });
}
