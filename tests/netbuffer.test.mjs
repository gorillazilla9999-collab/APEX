import assert from 'node:assert/strict';
import { NetBuffer, INTERP_DELAY } from '../public/js/vehicle/NetBuffer.js';

// A car doing 30 m/s along +x, sampled at 30 Hz by its owner; arrival times get random jitter and duplicates.
const truth = (t) => ({ x: 30 * t, z: 0, h: 0, vx: 30, vz: 0, st: 0, yr: 0, f: 0 });
const nb = new NetBuffer();
let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const arrivals = [];
for (let i = 0; i < 90; i++) { const t = i / 30; arrivals.push({ t, arrive: 5 + t + 0.03 + rnd() * 0.05 }); } // 30-80 ms jitter
arrivals.sort((a, b) => a.arrive - b.arrive);
let maxErr = 0, now = 5, idx = 0;
while (now < 5 + 2.6) {
  while (idx < arrivals.length && arrivals[idx].arrive <= now) {
    const a = arrivals[idx++], st = { ...truth(a.t), ts: Math.round(a.t * 1000 + 700000) };
    nb.push(st, a.arrive); nb.push(st, a.arrive + 0.001); // second push = server rebroadcast duplicate
  }
  const s = nb.sample(now);
  if (s && now > 5.6) maxErr = Math.max(maxErr, Math.abs(s.x - 30 * (now - nb.off - INTERP_DELAY - 700))); // vs true position at the sender's render time
  now += 1 / 144;
}
assert.ok(maxErr < 0.01, 'straight-line path is exact despite jitter + duplicates, err=' + maxErr);
assert.ok(nb.length <= 30);

// duplicates / out-of-order dropped
const d = new NetBuffer();
assert.ok(d.push({ ...truth(0), ts: 1000 }, 1)); assert.ok(!d.push({ ...truth(0), ts: 1000 }, 1.01)); assert.ok(!d.push({ ...truth(0), ts: 900 }, 1.02));

// smooth, monotonic motion in a straight line even with jittered arrivals (no backwards steps)
const m = new NetBuffer(); let prev = -Infinity, back = 0, t = 0;
for (let i = 0; i < 120; i++) {
  const st = i / 30, arrive = 10 + st + 0.02 + rnd() * 0.06;
  m.push({ ...truth(st), ts: st * 1000 }, arrive);
  while (t < arrive) { const s = m.sample(t); if (s) { if (s.x < prev - 1e-6) back++; prev = s.x; } t += 1 / 144; }
}
assert.equal(back, 0, 'cars never jump backwards under jitter');

// Hermite follows a circle better than linear interpolation (samples 33 ms apart, radius 30 m at 30 m/s)
const R = 30, w = 1, circ = (tt) => ({ x: R * Math.sin(w * tt), z: R * (1 - Math.cos(w * tt)), h: w * tt, vx: R * w * Math.cos(w * tt), vz: R * w * Math.sin(w * tt), st: 0, yr: w, f: 0 });
const c = new NetBuffer(); for (let i = 0; i <= 10; i++) c.push({ ...circ(i / 30), ts: (i / 30) * 1000 }, 100 + i / 30);
const mid = 4.5 / 30;
const probe = c.sample(c.off + mid + INTERP_DELAY), ref = circ(mid);
assert.ok(Math.hypot(probe.x - ref.x, probe.z - ref.z) < 0.01, 'Hermite tracks the true curve');

// packet loss: dead-reckons, then holds after MAX_EXTRAPOLATE
const e = new NetBuffer(); e.push({ ...truth(0), ts: 0 }, 50);
const ex = e.sample(50 + INTERP_DELAY + 0.1);
assert.ok(Math.abs(ex.x - 3) < 1e-6, 'extrapolates from velocity');
const held = e.sample(50 + INTERP_DELAY + 5);
assert.ok(Math.abs(held.x - 30 * 0.25) < 1e-6, 'holds after cap');

// a teleport (reset) snaps instead of gliding
const r = new NetBuffer(); r.push({ ...truth(0), ts: 0 }, 1); r.push({ ...truth(0.03), x: 500, ts: 33 }, 1.03);
assert.equal(r.length, 1);
console.log('netbuffer tests passed');
