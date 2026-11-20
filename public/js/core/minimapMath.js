/**
 * Pure projection maths for the minimap (no DOM) so it can be unit-tested.
 * World axes: +x right, +z down on a north-up map (= looking straight down at the Three.js scene).
 * A matrix is [a, b, c, d, e, f] exactly as CanvasRenderingContext2D.setTransform expects:
 *   sx = a*x + c*z + e,  sy = b*x + d*z + f
 */
export const apply = (m, x, z) => [m[0] * x + m[2] * z + m[4], m[1] * x + m[3] * z + m[5]];
export const matScale = (m) => Math.hypot(m[0], m[1]);

/** Heading-up view: the car (x, z) lands on (cx, cy) with its nose pointing at the top of the screen. Forward = (sin h, cos h). */
export function followMatrix(x, z, heading, scale, cx, cy) {
  const th = heading - Math.PI, cos = Math.cos(th), sin = Math.sin(th);
  const a = scale * cos, b = scale * sin, c = -scale * sin, d = scale * cos;
  return [a, b, c, d, cx - (a * x + c * z), cy - (b * x + d * z)];
}

/** North-up view that fits the whole track (bounds = {x0,x1,z0,z1,cx,cz}) into a w x h box with `pad` px margin. */
export function fitMatrix(bounds, w, h, pad = 12) {
  const bw = Math.max(1, bounds.x1 - bounds.x0), bh = Math.max(1, bounds.z1 - bounds.z0);
  const s = Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh);
  return [s, 0, 0, s, w / 2 - bounds.cx * s, h / 2 - bounds.cz * s];
}

/** Metres from the car to the edge of the follow view; zooms out with speed (m/s). */
export const followRange = (speed) => Math.min(210, 120 + Math.max(0, speed) * 1.1);

/** Where "north" (-z) points on a heading-up map, as a unit screen vector. */
export const northOnScreen = (heading) => [-Math.sin(heading), Math.cos(heading)];
