// Three.js-free centre-line builder (mirrors THREE.CatmullRomCurve3(..., true, 'centripetal') closely enough for race logic).
// Used by the server, which has no WebGL, to track lap progress. Same field names as world/Track.js (n, ds, length, px, pz, tx, tz).
function sampleSpline(ctrl, perSeg = 60) {
  const n = ctrl.length, out = [], d = (a, b) => Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1]));
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [ctrl[(i + n - 1) % n], ctrl[i], ctrl[(i + 1) % n], ctrl[(i + 2) % n]];
    const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
    for (let k = 0; k < perSeg; k++) {
      const t = t1 + ((t2 - t1) * k) / perSeg, mix = (a, b, ta, tb) => [0, 1].map((j) => ((tb - t) / (tb - ta)) * a[j] + ((t - ta) / (tb - ta)) * b[j]);
      const A1 = mix(p0, p1, t0, t1), A2 = mix(p1, p2, t1, t2), A3 = mix(p2, p3, t2, t3);
      out.push(mix(mix(A1, A2, t0, t2), mix(A2, A3, t1, t3), t1, t2));
    }
  }
  return out;
}

export function buildCenterline(map) {
  const pts = sampleSpline(map.control), seg = pts.map((p, i) => Math.hypot(pts[(i + 1) % pts.length][0] - p[0], pts[(i + 1) % pts.length][1] - p[1]));
  const length = seg.reduce((a, b) => a + b, 0), cum = [0]; for (let i = 0; i < seg.length - 1; i++) cum.push(cum[i] + seg[i]);
  const n = map.samples ?? Math.max(600, Math.round(length / 2.6)), px = new Float32Array(n), pz = new Float32Array(n), tx = new Float32Array(n), tz = new Float32Array(n);
  let j = 0;
  for (let k = 0; k < n; k++) {
    const s = (k * length) / n; while (j < cum.length - 1 && cum[j + 1] <= s) j++;
    const f = (s - cum[j]) / seg[j], a = pts[j], b = pts[(j + 1) % pts.length];
    px[k] = a[0] + (b[0] - a[0]) * f; pz[k] = a[1] + (b[1] - a[1]) * f;
  }
  for (let i = 0; i < n; i++) {
    const a = (i + n - 1) % n, b = (i + 1) % n, dx = px[b] - px[a], dz = pz[b] - pz[a], l = Math.hypot(dx, dz) || 1;
    tx[i] = dx / l; tz[i] = dz / l;
  }
  return { n, length, ds: length / n, px, pz, tx, tz, roadWidth: map.roadWidth ?? 16 };
}
