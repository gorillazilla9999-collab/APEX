import { angleDiff } from '../utils.js';

export const INTERP_DELAY = 0.1;   // seconds behind "now" that remote cars are drawn, so two samples always bracket the render time
export const MAX_EXTRAPOLATE = 0.25; // if packets stop, keep dead-reckoning for this long, then hold position
const SNAP_DIST = 25;               // a jump bigger than this (reset / respawn) snaps instead of gliding

/**
 * Per-remote-car snapshot buffer (pure maths, no Three.js, unit-tested).
 *
 * Accuracy comes from three things:
 *  1. Samples are placed on the SENDER's own clock (`ts`), so network jitter and the server's snapshot batching
 *     cannot make a car speed up, slow down or stutter. The offset between clocks is tracked with a min-filter.
 *  2. The server re-broadcasts each player's last state every tick; duplicates / out-of-order samples are dropped.
 *  3. Between samples the path is a cubic Hermite curve using the reported velocity, so corners are not cut,
 *     and if packets are lost the car dead-reckons from its velocity and yaw rate instead of freezing.
 */
export class NetBuffer {
  constructor() { this.buf = []; this.off = null; this.out = {}; }

  /** `s` = snapshot entry (x z h vx vz st yr f, optional ts in ms); `now` = local clock in seconds. */
  push(s, now) {
    const t = Number.isFinite(s.ts) ? s.ts / 1000 : null;
    const last = this.buf[this.buf.length - 1];
    let st;
    if (t === null) st = last ? Math.max(last.t + 1e-3, now - (this.off ?? 0)) : now; // old server: fall back to arrival time
    else {
      if (last && t <= last.t) return false; // duplicate or out of order
      st = t;
      const sample = now - t;
      if (this.off === null || sample < this.off) this.off = sample;
      else this.off += (sample - this.off) * 0.002; // let the offset creep up so clock drift can't strand us
    }
    if (last && Math.hypot(s.x - last.x, s.z - last.z) > SNAP_DIST) this.buf.length = 0;
    this.buf.push({ ...s, t: st });
    if (this.buf.length > 30) this.buf.shift();
    return true;
  }

  get length() { return this.buf.length; }

  /** Interpolated state at local time `now` (seconds), or null if nothing has arrived yet. */
  sample(now, delay = INTERP_DELAY) {
    const b = this.buf; if (!b.length) return null;
    const rt = now - (this.off ?? 0) - delay; // render time on the sender's clock
    const o = this.out, n = b.length, lastS = b[n - 1];
    if (rt <= b[0].t) return fill(o, b[0], b[0], 0, 0);
    if (rt >= lastS.t) { // ran out of samples: dead-reckon from the newest one
      const e = Math.min(rt - lastS.t, MAX_EXTRAPOLATE), moving = Math.hypot(lastS.vx, lastS.vz) > 0.05;
      fill(o, lastS, lastS, 0, 0);
      if (moving) { o.x = lastS.x + lastS.vx * e; o.z = lastS.z + lastS.vz * e; o.h = lastS.h + lastS.yr * e; }
      return o;
    }
    let i = n - 2; while (i > 0 && b[i].t > rt) i--;
    const a = b[i], c = b[i + 1], T = c.t - a.t, k = (rt - a.t) / T;
    return fill(o, a, c, k, T);
  }
}

function fill(o, a, c, k, T) {
  const lerp = (p, q) => p + (q - p) * k;
  if (T > 0) { // cubic Hermite on position, tangents = velocity * segment time
    const k2 = k * k, k3 = k2 * k, h00 = 2 * k3 - 3 * k2 + 1, h10 = k3 - 2 * k2 + k, h01 = -2 * k3 + 3 * k2, h11 = k3 - k2;
    o.x = h00 * a.x + h10 * a.vx * T + h01 * c.x + h11 * c.vx * T;
    o.z = h00 * a.z + h10 * a.vz * T + h01 * c.z + h11 * c.vz * T;
  } else { o.x = a.x; o.z = a.z; }
  o.h = a.h + angleDiff(c.h, a.h) * k;
  o.vx = lerp(a.vx, c.vx); o.vz = lerp(a.vz, c.vz);
  o.st = lerp(a.st, c.st); o.yr = lerp(a.yr, c.yr);
  o.f = c.f; o.away = c.away;
  return o;
}
