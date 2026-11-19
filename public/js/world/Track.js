import * as THREE from 'three';

export const ROAD_WIDTH = 16;
const CONTROL = [[0, 0], [140, -8], [280, 40], [380, 150], [360, 290], [240, 360], [110, 320],
  [40, 430], [-90, 480], [-230, 420], [-280, 290], [-200, 190], [-250, 70], [-150, -40]];

/** Closed centre-line sampled at uniform spacing. Right-hand normal = (-tz, tx). */
export class Track {
  constructor(n = 900) {
    const curve = new THREE.CatmullRomCurve3(CONTROL.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
    const pts = curve.getSpacedPoints(n); pts.pop();
    this.n = n; this.length = curve.getLength(); this.ds = this.length / n;
    this.px = new Float32Array(n); this.pz = new Float32Array(n);
    this.tx = new Float32Array(n); this.tz = new Float32Array(n);
    pts.forEach((p, i) => { this.px[i] = p.x; this.pz[i] = p.z; });
    for (let i = 0; i < n; i++) {
      const a = (i + n - 1) % n, b = (i + 1) % n;
      const dx = this.px[b] - this.px[a], dz = this.pz[b] - this.pz[a], l = Math.hypot(dx, dz);
      this.tx[i] = dx / l; this.tz[i] = dz / l;
    }
  }
  nearest(x, z) {
    let best = 1e18, bi = 0;
    for (let i = 0; i < this.n; i++) {
      const d = (this.px[i] - x) ** 2 + (this.pz[i] - z) ** 2;
      if (d < best) { best = d; bi = i; }
    }
    return { i: bi, dist: Math.sqrt(best) };
  }
  pose(i) { return { x: this.px[i], z: this.pz[i], heading: Math.atan2(this.tx[i], this.tz[i]) }; }
}
