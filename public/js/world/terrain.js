// Three.js-free terrain model. One source of truth for "how high is the ground at (x, z)" that both the vehicle physics
// and the World mesh builder use, so what you see is what you drive on.
//
// A map opts in with an `elev` block (see maps.js). The road's height is a function of arc length `s` along the centre-line:
//   hills:   { at, len, hold?, h }       smooth climb over `len` m, optional plateau of `hold` m, then back down over `len` m
//   kickers: { at, len, h }              straight ramp up to height `h`, then a sheer drop (the lip): a proper jump
//   tables:  { at, up, top, down, h }    ramp up, flat top, landing ramp down: a table-top jump
// `at` is a 0..1 fraction of the lap. Beside the road the ground slopes away to y = 0 (an embankment), so an elevated road
// is a raised causeway; the barriers stand on its edge.

export const BARRIER_GAP = 3.4;   // barrier distance beyond the road edge (World.barrierOff = half + BARRIER_GAP)
export const SHOULDER_MIN = 10;   // minimum embankment run-out beyond the barrier (m)
export const DROP = 0.6;          // how many metres a kicker's lip takes to fall away (m): "sheer" but not a zero-width wall

const smooth = (k) => k * k * (3 - 2 * k);
const ease = (u) => 0.5 - 0.5 * Math.cos(Math.PI * u);

/** Road height (m) along arc length s for an `elev` block. */
export function makeProfile(elev, length) {
  if (!elev) return () => 0;
  const F = [];
  for (const f of elev.hills ?? []) F.push({ t: 0, s0: f.at * length, a: f.len, hold: f.hold ?? 0, h: f.h });
  for (const f of elev.kickers ?? []) F.push({ t: 1, s0: f.at * length, a: f.len, h: f.h });
  for (const f of elev.tables ?? []) F.push({ t: 2, s0: f.at * length, a: f.up, top: f.top, c: f.down, h: f.h });
  return (s) => {
    let y = 0;
    for (const f of F) {
      const d = (((s - f.s0) % length) + length) % length; // distance past the feature's start (wraps over the start line)
      if (f.t === 0) {
        if (d < f.a) y += f.h * ease(d / f.a);
        else if (d < f.a + f.hold) y += f.h;
        else if (d < 2 * f.a + f.hold) y += f.h * ease(1 - (d - f.a - f.hold) / f.a);
      } else if (f.t === 1) {
        if (d < f.a) y += f.h * (d / f.a);
        else if (d < f.a + DROP) y += f.h * (1 - (d - f.a) / DROP);
      } else {
        if (d < f.a) y += f.h * (d / f.a);
        else if (d < f.a + f.top) y += f.h;
        else if (d < f.a + f.top + f.c) y += f.h * (1 - (d - f.a - f.top) / f.c);
      }
    }
    return y;
  };
}

/** Total length (m) a feature occupies along the road (used by tests / map checks). */
export const featureSpan = (f, kind) => kind === 'hills' ? 2 * f.len + (f.hold ?? 0) : kind === 'kickers' ? f.len + DROP : f.up + f.top + f.down;

export class Terrain {
  /** `track`: anything with n, ds, length, px, pz, tx, tz, roadWidth (world/Track.js or trackMath.buildCenterline). */
  constructor(track, elev = null) {
    this.t = track; this.n = track.n; this.ds = track.ds; this.length = track.length;
    this.half = track.roadWidth / 2; this.barrierOff = this.half + BARRIER_GAP;
    this.elev = elev; this.flat = !elev; this.profile = makeProfile(elev, this.length);
    this.hint = 0; this.near = { s: 0, lat: 0, i: 0 };
    // how far above the ground a car must be before nothing on it can touch the terrain (covers the tallest ramp and steep slopes)
    this.margin = 3.8 + Math.max(0, ...(elev?.kickers ?? []).map((f) => f.h), ...(elev?.tables ?? []).map((f) => f.h)) + (elev?.hills?.length ? 1.5 : 0);
  }

  /** Road height at sample index i. */
  roadAt(i) { return this.flat ? 0 : this.profile(i * this.ds); }

  /** Width of the embankment run-out for a road at height y. */
  shoulder(y) { return Math.max(SHOULDER_MIN, y * 2.6); }

  /** Height of the embankment surface at lateral distance r (>= barrierOff) from the centre-line, for road height y. */
  bank(y, r) { const k = (r - this.barrierOff) / this.shoulder(y); return k >= 1 ? 0 : y * (1 - smooth(k < 0 ? 0 : k)); }

  _locate(x, z) {
    const t = this.t, n = this.n, px = t.px, pz = t.pz;
    let best = 1e18, bi = this.hint;
    for (let k = -40; k <= 40; k++) {
      const i = (this.hint + k + n) % n, dx = px[i] - x, dz = pz[i] - z, d = dx * dx + dz * dz;
      if (d < best) { best = d; bi = i; }
    }
    if (best > 900) for (let i = 0; i < n; i++) { const dx = px[i] - x, dz = pz[i] - z, d = dx * dx + dz * dz; if (d < best) { best = d; bi = i; } }
    this.hint = bi;
    // closest point on the centre-line polyline (continuous, unlike projecting onto one sample's tangent), so height never jitters
    let bs = bi, bt = 0, bd = 1e18;
    for (const i of [(bi + n - 1) % n, bi]) {
      const j = (i + 1) % n, ex = px[j] - px[i], ez = pz[j] - pz[i], l2 = ex * ex + ez * ez || 1;
      const u = Math.min(1, Math.max(0, ((x - px[i]) * ex + (z - pz[i]) * ez) / l2)), cx = px[i] + ex * u - x, cz = pz[i] + ez * u - z, d = cx * cx + cz * cz;
      if (d < bd) { bd = d; bs = i; bt = u; }
    }
    const j = (bs + 1) % n, ex = px[j] - px[bs], ez = pz[j] - pz[bs], l = Math.hypot(ex, ez) || 1, o = this.near;
    const qx = px[bs] + ex * bt, qz = pz[bs] + ez * bt;
    o.i = bt > 0.5 ? j : bs; o.s = (bs + bt) * this.ds;
    o.lat = ((x - qx) * -ez + (z - qz) * ex) / l; // lat > 0 = right of the direction of travel
    return o;
  }

  /** Ground height at (x, z). */
  height(x, z) {
    if (this.flat) return 0;
    const o = this._locate(x, z), y = this.profile(o.s), r = Math.abs(o.lat);
    return r <= this.barrierOff ? y : this.bank(y, r);
  }

  /** Unit ground normal at (x, z) written into out[0..2]. */
  normal(x, z, out = [0, 1, 0]) {
    if (this.flat) { out[0] = 0; out[1] = 1; out[2] = 0; return out; }
    const e = 0.5, gx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e), gz = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
    const l = Math.hypot(gx, 1, gz); out[0] = -gx / l; out[1] = 1 / l; out[2] = -gz / l; return out;
  }
}
