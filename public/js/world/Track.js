import * as THREE from 'three';

export const ROAD_WIDTH = 16; // default; maps can override with `roadWidth`

/** Closed centre-line sampled at uniform spacing. Right-hand normal = (-tz, tx). Built from a map definition (see maps.js). */
export class Track {
  constructor(map) {
    const curve = new THREE.CatmullRomCurve3(map.control.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
    const n = map.samples ?? Math.max(600, Math.round(curve.getLength() / 2.6));
    const pts = curve.getSpacedPoints(n); pts.pop();
    this.n = n; this.length = curve.getLength(); this.ds = this.length / n;
    this.roadWidth = map.roadWidth ?? ROAD_WIDTH;
    this.px = new Float32Array(n); this.pz = new Float32Array(n);
    this.tx = new Float32Array(n); this.tz = new Float32Array(n);
    pts.forEach((p, i) => { this.px[i] = p.x; this.pz[i] = p.z; });
    for (let i = 0; i < n; i++) {
      const a = (i + n - 1) % n, b = (i + 1) % n;
      const dx = this.px[b] - this.px[a], dz = this.pz[b] - this.pz[a], l = Math.hypot(dx, dz);
      this.tx[i] = dx / l; this.tz[i] = dz / l;
    }
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < n; i++) { x0 = Math.min(x0, this.px[i]); x1 = Math.max(x1, this.px[i]); z0 = Math.min(z0, this.pz[i]); z1 = Math.max(z1, this.pz[i]); }
    this.bounds = { x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 };
  }
  nearest(x, z) {
    let best = 1e18, bi = 0;
    for (let i = 0; i < this.n; i++) {
      const d = (this.px[i] - x) ** 2 + (this.pz[i] - z) ** 2;
      if (d < best) { best = d; bi = i; }
    }
    return { i: bi, dist: Math.sqrt(best) };
  }
  /** Sample index for a 0..1 fraction of the lap (wraps). */
  at(f) { return (((Math.round(f * this.n)) % this.n) + this.n) % this.n; }
  pose(i) { return { x: this.px[i], z: this.pz[i], heading: Math.atan2(this.tx[i], this.tz[i]) }; }
}
