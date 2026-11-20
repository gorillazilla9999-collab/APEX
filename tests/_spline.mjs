// Shared by the map and balance tests: mirrors THREE.CatmullRomCurve3(..., true, 'centripetal') so tests run without Three.js.
export function sample(ctrl, perSeg = 120) {
  const n = ctrl.length, out = [], d = (a, b) => Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1]));
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [ctrl[(i + n - 1) % n], ctrl[i], ctrl[(i + 1) % n], ctrl[(i + 2) % n]];
    const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
    for (let k = 0; k < perSeg; k++) {
      const t = t1 + ((t2 - t1) * k) / perSeg, mix = (a, b, ta, tb) => [0, 1].map((j) => ((tb - t) / (tb - ta)) * a[j] + ((t - ta) / (tb - ta)) * b[j]);
      const A1 = mix(p0, p1, t0, t1), A2 = mix(p1, p2, t1, t2), A3 = mix(p2, p3, t2, t3);
      const B1 = mix(A1, A2, t0, t2), B2 = mix(A2, A3, t1, t3);
      out.push(mix(B1, B2, t1, t2));
    }
  }
  return out;
}
export function resample(pts, ds) {
  const seg = pts.map((p, i) => Math.hypot(pts[(i + 1) % pts.length][0] - p[0], pts[(i + 1) % pts.length][1] - p[1]));
  const L = seg.reduce((a, b) => a + b, 0), cum = [0]; for (let i = 0; i < seg.length - 1; i++) cum.push(cum[i] + seg[i]);
  const n = Math.round(L / ds), out = []; let j = 0;
  for (let k = 0; k < n; k++) {
    const s = (k * L) / n; while (j < cum.length - 1 && cum[j + 1] <= s) j++;
    const f = (s - cum[j]) / seg[j], a = pts[j], b = pts[(j + 1) % pts.length];
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return { P: out, L, ds: L / n };
}
