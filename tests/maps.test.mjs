// Data checks for every map: valid theme, closed track, no hairpins tighter than the car can drive, no section too close to another.
// The centripetal Catmull-Rom below mirrors THREE.CatmullRomCurve3(..., true, 'centripetal') so this runs without Three.js.
import assert from 'node:assert/strict';
import { MAPS, BASE_MAPS, MAP_IDS, DEFAULT_MAP, isMap, getMap, flatId, hillyId, isFlat } from '../public/js/world/maps.js';
import { sample, resample } from './_spline.mjs';

const KNOWN_PROPS = ['water', 'containers', 'cranes', 'dunes', 'rocks', 'cacti', 'grandstands', 'floodlights', 'snowfall'];

assert.equal(new Set(MAP_IDS).size, MAPS.length, 'unique ids');
assert.ok(isMap(DEFAULT_MAP) && !isMap('nope') && !isMap(undefined) && getMap('nope').id === MAPS[0].id);
assert.ok(BASE_MAPS.length >= 65, 'at least 65 layouts');
assert.equal(MAPS.length, BASE_MAPS.length * 2, 'every layout has a hilly and a flat version');
for (const m of MAPS) assert.match(m.id, /^[a-z]+$/, `${m.id}: id is letters only`);
for (const m of BASE_MAPS) { // the flat twin: same track, theme, scenery; no elevation
  const f = getMap(flatId(m.id)), tag = `[${m.id}]`;
  assert.ok(m.elev && !m.flat && !isFlat(m.id) && hillyId(m.id) === m.id, tag + ' hilly version has elevation');
  assert.ok(f.flat && isFlat(f.id) && f.base === m.id && f.id === m.id + 'flat' && hillyId(f.id) === m.id && flatId(f.id) === f.id, tag + ' flat twin ids');
  assert.ok(!f.elev && f.control === m.control && f.theme === m.theme && f.props === m.props && f.roadWidth === m.roadWidth && f.seed === m.seed, tag + ' flat twin shares layout + look');
  assert.ok(f.name !== m.name && f.name.includes(m.name) && f.tag && f.difficulty === m.difficulty, tag + ' flat twin labels');
}
assert.ok(isMap('highwayflat') && getMap('highwayflat').flat && !isMap('highwayflatflat'));

for (const m of BASE_MAPS) {
  const th = m.theme, tag = `[${m.id}]`;
  assert.ok(m.name && m.tag, tag + ' text');
  assert.ok(m.difficulty >= 1 && m.difficulty <= 5, tag + ' difficulty'); assert.ok(m.roadWidth >= 12 && m.roadWidth <= 26, tag + ' road width');
  assert.ok(m.control.length >= 10 && m.control.every((p) => p.length === 2 && p.every(Number.isFinite)), tag + ' control points');
  assert.deepEqual(m.control[0].length, 2);
  for (const k of ['sky', 'sun', 'hemi', 'exposure', 'fog', 'ground', 'road', 'kerb', 'barrier', 'signs', 'mini']) assert.ok(th[k] != null, `${tag} theme.${k}`);
  assert.equal(th.signs.length, 4, tag + ' four signs'); assert.ok(th.fog[0] < th.fog[1]);
  assert.ok(th.road.base && th.road.edge && th.road.centre && th.mini.bg && th.mini.road, tag + ' colours');
  for (const p of m.props) assert.ok(KNOWN_PROPS.includes(p), `${tag} unknown prop ${p}`);
  if (th.buildings) assert.ok(th.buildings.lit.length && th.buildings.glow.length, tag + ' buildings');

  const { P, L, ds } = resample(sample(m.control), 3);
  const n = P.length; let rmin = 1e9, sep = 1e9;
  for (let i = 0; i < n; i++) {
    const a = P[(i + n - 1) % n], b = P[i], c = P[(i + 1) % n];
    const d1x = (c[0] - a[0]) / 2, d1z = (c[1] - a[1]) / 2, d2x = c[0] - 2 * b[0] + a[0], d2z = c[1] - 2 * b[1] + a[1];
    const k = Math.abs(d1x * d2z - d1z * d2x) / Math.pow(d1x * d1x + d1z * d1z, 1.5); if (k > 0) rmin = Math.min(rmin, 1 / k);
  }
  const gap = Math.round(150 / ds);
  for (let i = 0; i < n; i += 2) for (let j = 0; j < n; j++) {
    const arc = Math.min(Math.abs(i - j), n - Math.abs(i - j)); if (arc <= gap) continue;
    sep = Math.min(sep, Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]));
  }
  console.log(`${m.id.padEnd(9)} ${(L / 1000).toFixed(2)} km  min radius ${rmin.toFixed(0)} m  closest approach ${sep.toFixed(0)} m  width ${m.roadWidth} m`);
  assert.ok(L > 1500 && L < 3500, `${tag} lap length ${L}`);
  assert.ok(rmin > m.roadWidth * 1.2, `${tag} corner too tight: ${rmin}`);
  assert.ok(sep > 90, `${tag} track passes too close to itself: ${sep}`);
}
console.log('maps tests passed');
