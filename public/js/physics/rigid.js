// Minimal quaternion / vector helpers (q = [x, y, z, w], v = [x, y, z]) for the vehicle's airborne / tumbling rigid body.
// No Three.js: the headless tests and the server can use this too. Conventions match Three.js, so q.fromArray() renders directly.
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export const qIdent = () => [0, 0, 0, 1];
export const qYaw = (h) => [0, Math.sin(h / 2), 0, Math.cos(h / 2)];
export const qConj = (q) => [-q[0], -q[1], -q[2], q[3]];
export const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
export function qNorm(q) { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; }
/** Rotate vector v by unit quaternion q. */
export function qRot(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
/** Orientation whose local X, Y, Z axes are the world vectors l, u, f (an orthonormal right-handed basis). */
export function qFromBasis(l, u, f) {
  const m00 = l[0], m01 = u[0], m02 = f[0], m10 = l[1], m11 = u[1], m12 = f[1], m20 = l[2], m21 = u[2], m22 = f[2], tr = m00 + m11 + m22;
  let x, y, z, w, s;
  if (tr > 0) { s = 0.5 / Math.sqrt(tr + 1); w = 0.25 / s; x = (m21 - m12) * s; y = (m02 - m20) * s; z = (m10 - m01) * s; }
  else if (m00 > m11 && m00 > m22) { s = 2 * Math.sqrt(1 + m00 - m11 - m22); w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s; }
  else if (m11 > m22) { s = 2 * Math.sqrt(1 + m11 - m00 - m22); w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s; }
  else { s = 2 * Math.sqrt(1 + m22 - m00 - m11); w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s; }
  return [x, y, z, w];
}
/** q advanced by world-frame angular velocity w (rad/s) over dt. */
export function qIntegrate(q, w, dt) {
  const d = qMul([w[0], w[1], w[2], 0], q), h = 0.5 * dt;
  return qNorm([q[0] + h * d[0], q[1] + h * d[1], q[2] + h * d[2], q[3] + h * d[3]]);
}
/** World-frame angular velocity that takes qa to qb in dt seconds. */
export function qDelta(qa, qb, dt) {
  let d = qMul(qb, qConj(qa)); if (d[3] < 0) d = [-d[0], -d[1], -d[2], -d[3]];
  const s = 2 / dt; return [d[0] * s, d[1] * s, d[2] * s];
}
