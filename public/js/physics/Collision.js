import { clamp } from '../utils.js';

const RESTITUTION = 0.28, TORQUE = 0.045;
const CAR_R = 0.95, OFFSETS = [-1.35, 0, 1.35]; // three circles approximate the car body
let nx = 0, nz = 0, pen = 0;

/** Static obstacle store with a uniform spatial grid. */
export class Colliders {
  constructor(cell = 30) { this.cell = cell; this.grid = new Map(); this.count = 0; }
  addCircle(x, z, r) { this._add({ t: 0, x, z, r }, r); }
  addBox(x, z, hx, hz, theta) {
    this._add({ t: 1, x, z, hx, hz, c: Math.cos(theta), s: Math.sin(theta) }, Math.hypot(hx, hz));
  }
  _key(i, j) { return (i + 2048) * 4096 + (j + 2048); }
  _add(o, ext) {
    ext += 1.3; this.count++;
    const c = this.cell;
    for (let i = Math.floor((o.x - ext) / c); i <= Math.floor((o.x + ext) / c); i++)
      for (let j = Math.floor((o.z - ext) / c); j <= Math.floor((o.z + ext) / c); j++) {
        const k = this._key(i, j);
        (this.grid.get(k) || this.grid.set(k, []).get(k)).push(o);
      }
  }
  at(x, z) { return this.grid.get(this._key(Math.floor(x / this.cell), Math.floor(z / this.cell))); }
}

function contact(o, px, pz, r) {
  const dx = px - o.x, dz = pz - o.z;
  if (o.t === 0) {
    const d = Math.hypot(dx, dz), m = r + o.r;
    if (d >= m) return false;
    if (d < 1e-5) { nx = 1; nz = 0; } else { nx = dx / d; nz = dz / d; }
    pen = m - d; return true;
  }
  const lx = dx * o.c - dz * o.s, lz = dx * o.s + dz * o.c;
  const ex = lx - clamp(lx, -o.hx, o.hx), ez = lz - clamp(lz, -o.hz, o.hz);
  const d = Math.hypot(ex, ez);
  let lnx, lnz;
  if (d > 1e-5) {
    if (d >= r) return false;
    lnx = ex / d; lnz = ez / d; pen = r - d;
  } else { // centre is inside the box: push out along the shallowest axis
    const px_ = o.hx - Math.abs(lx), pz_ = o.hz - Math.abs(lz);
    if (px_ < pz_) { lnx = Math.sign(lx) || 1; lnz = 0; pen = px_ + r; }
    else { lnx = 0; lnz = Math.sign(lz) || 1; pen = pz_ + r; }
  }
  nx = lnx * o.c + lnz * o.s; nz = -lnx * o.s + lnz * o.c;
  return true;
}

/** Resolves vehicle vs static colliders. Returns impact speed (m/s) of the hardest hit this step. */
export function collideVehicle(v, cols) {
  let impact = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (const off of OFFSETS) {
      const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
      const list = cols.at(v.x + fx * off, v.z + fz * off);
      if (!list) continue;
      for (const o of list) {
        if (!contact(o, v.x + fx * off, v.z + fz * off, CAR_R)) continue;
        v.x += nx * pen; v.z += nz * pen;
        const vn = v.vx * nx + v.vz * nz;
        if (vn >= 0) continue;
        const j = -(1 + RESTITUTION) * vn;
        v.vx += nx * j; v.vz += nz * j;
        const tx = -nz, tz = nx, vt = v.vx * tx + v.vz * tz; // wall friction
        v.vx -= tx * vt * 0.08; v.vz -= tz * vt * 0.08;
        v.yawRate += clamp(TORQUE * (fz * off * nx * j - fx * off * nz * j), -2, 2);
        impact = Math.max(impact, -vn);
      }
    }
  }
  return impact;
}
