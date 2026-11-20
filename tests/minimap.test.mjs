import assert from 'node:assert/strict';
import { apply, followMatrix, fitMatrix, matScale, followRange, northOnScreen } from '../public/js/core/minimapMath.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
// Car forward = (sin h, cos h), car right = (-cos h, sin h). On the heading-up map forward must be screen-up and right must be screen-right.
for (const h of [0, 0.7, Math.PI / 2, 2.4, Math.PI, -1.3, 5.5]) {
  const x = 123, z = -45, m = followMatrix(x, z, h, 0.5, 100, 120);
  const [cx, cy] = apply(m, x, z); assert.ok(near(cx, 100) && near(cy, 120), 'car sits on the anchor');
  const [fx, fy] = apply(m, x + 10 * Math.sin(h), z + 10 * Math.cos(h));
  assert.ok(near(fx, 100, 1e-6) && near(fy, 120 - 5, 1e-6), `forward is up (h=${h})`);
  const [rx, ry] = apply(m, x - 10 * Math.cos(h), z + 10 * Math.sin(h));
  assert.ok(near(rx, 105, 1e-6) && near(ry, 120, 1e-6), `right is right (h=${h})`);
  assert.ok(near(matScale(m), 0.5), 'uniform scale (no skew)');
  const [nx, ny] = northOnScreen(h), [tx, ty] = apply(m, x, z - 10); // a point 10 m north of the car
  assert.ok(near(tx - 100, nx * 5, 1e-6) && near(ty - 120, ny * 5, 1e-6), `north marker agrees with the map (h=${h})`);
}
// full-track fit: bounds land inside the box, centred, uniform scale
const b = { x0: -280, x1: 380, z0: -40, z1: 480, cx: 50, cz: 220 }, f = fitMatrix(b, 200, 200, 16);
for (const [x, z] of [[b.x0, b.z0], [b.x1, b.z1], [b.x0, b.z1], [b.x1, b.z0]]) { const [sx, sy] = apply(f, x, z); assert.ok(sx >= 15.99 && sx <= 184.01 && sy >= 15.99 && sy <= 184.01, 'inside padding'); }
const [mx, my] = apply(f, b.cx, b.cz); assert.ok(near(mx, 100) && near(my, 100), 'centred');
assert.ok(followRange(0) === 120 && followRange(500) === 210 && followRange(40) > followRange(10), 'zoom grows with speed, capped');
console.log('minimap tests passed');
