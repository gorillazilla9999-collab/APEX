// Generates public/js/world/mapdata.js: extra track layouts (pure data) with automatic elevation.
//   node tools/gen-maps.mjs            (deterministic: same seeds -> same maps)
// A layout is accepted only if it passes the same rules as tests/maps.test.mjs (with margin) AND the AI driver can lap it with every car.
// Elevation is placed from the layout itself: kickers / tables on long straights, rollers on short ones, hills in the twisty parts.
import fs from 'node:fs';
import { sample, resample } from '../tests/_spline.mjs';
import { lap, prepare } from '../tests/balance.mjs';
import { CARS } from '../public/js/vehicle/cars.js';

const TAU = Math.PI * 2;
const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const R = (rng, a, b) => a + (b - a) * rng();

// name, flavour sentence, theme, width range. Order matters: 8 per theme, families cycle through them.
const SPECS = [
  ['sundown', 'SUNDOWN BOULEVARD', 'Palm-lined city boulevard at golden hour.', 'sunset', [16, 20]],
  ['ambercoast', 'AMBER COAST', 'Cliff-top coast road in warm evening light.', 'sunset', [16, 20]],
  ['marina', 'MARINA DRIVE', 'Loops around the yacht marina.', 'sunset', [16, 20]],
  ['palmbluff', 'PALM BLUFF', 'Sweeping bluff-top road with ocean views.', 'sunset', [16, 20]],
  ['terracotta', 'TERRACOTTA RUN', 'Sun-baked hill-town streets.', 'sunset', [15, 18]],
  ['vineyard', 'VINEYARD LOOP', 'Rolling lanes through the vines.', 'sunset', [15, 18]],
  ['lighthouse', 'LIGHTHOUSE POINT', 'Headland road past the old lighthouse.', 'sunset', [16, 20]],
  ['orchard', 'ORCHARD HILLS', 'Country lanes over the orchard hills.', 'sunset', [15, 18]],
  ['midnight', 'MIDNIGHT DOCKS', 'Rain-slick night docks, cranes overhead.', 'neon', [14, 16]],
  ['cyberalley', 'CYBER ALLEY', 'Neon back-streets, no room for mistakes.', 'neon', [14, 16]],
  ['chromecanal', 'CHROME CANAL', 'Canal-side night circuit.', 'neon', [14, 17]],
  ['skyline', 'SKYLINE DISTRICT', 'Downtown towers glowing above the road.', 'neon', [15, 17]],
  ['pulseplaza', 'PULSE PLAZA', 'Plaza circuit pulsing with light.', 'neon', [15, 18]],
  ['subway', 'SUBWAY SPRINT', 'Fast and narrow through the old rail yards.', 'neon', [14, 16]],
  ['rooftop', 'ROOFTOP RUSH', 'Night run over the harbour warehouses.', 'neon', [14, 17]],
  ['laserlanes', 'LASER LANES', 'Electric night lanes, flat out between the lights.', 'neon', [15, 18]],
  ['mirage', 'MIRAGE FLATS', 'Shimmering salt-and-sand flats.', 'dunes', [18, 22]],
  ['scorpion', 'SCORPION PASS', 'Winding desert pass with a sting in the tail.', 'dunes', [16, 20]],
  ['oasis', 'OASIS RUN', 'Palm-fringed desert loop.', 'dunes', [18, 22]],
  ['redmesa', 'RED MESA', 'Canyon floor beneath the red mesas.', 'dunes', [17, 21]],
  ['sandstorm', 'SANDSTORM', 'Wide, fast and wild across the dunes.', 'dunes', [19, 23]],
  ['cactusgulch', 'CACTUS GULCH', 'Dusty gulch road lined with cacti.', 'dunes', [16, 19]],
  ['bonevalley', 'BONE VALLEY', 'Sun-bleached valley of long sweepers.', 'dunes', [18, 22]],
  ['dustdevil', 'DUST DEVIL', 'Twisting dust-track that never sits still.', 'dunes', [16, 20]],
  ['aurora', 'AURORA RIDGE', 'Ridge road under the northern lights.', 'frost', [14, 16]],
  ['whiteout', 'WHITEOUT', 'Blinding snow, barely any visibility.', 'frost', [14, 16]],
  ['icecrest', 'ICECREST', 'Frozen crest road, brittle and fast.', 'frost', [14, 17]],
  ['polar', 'POLAR EXPRESS', 'Fast snow-bound express through the pines.', 'frost', [15, 18]],
  ['summit', 'SUMMIT FEVER', 'A mountain road that keeps climbing.', 'frost', [14, 16]],
  ['snowdrift', 'SNOWDRIFT', 'Drifting snow across open slopes.', 'frost', [15, 18]],
  ['gorge', 'GLACIER GORGE', 'Narrow gorge cut through the ice.', 'frost', [14, 16]],
  ['yeti', 'YETI TRAIL', 'Remote trail high in the snowfields.', 'frost', [14, 17]],
  ['thunderbowl', 'THUNDER BOWL', 'Roaring bowl-shaped speedway.', 'speedway', [21, 25]],
  ['apexpark', 'APEX PARK', 'Purpose-built park circuit with a bit of everything.', 'speedway', [20, 24]],
  ['pitlane', 'PIT LANE PRO', 'Pro-level circuit beside a packed pit lane.', 'speedway', [20, 24]],
  ['grandprix', 'GRAND PRIX', 'The classic grand-prix layout.', 'speedway', [20, 24]],
  ['velocityring', 'VELOCITY RING', 'High-speed ring for flat-out driving.', 'speedway', [21, 25]],
  ['checkered', 'CHECKERED FLAG', 'Race-day circuit under the grandstands.', 'speedway', [20, 24]],
  ['turbotriangle', 'TURBO TRIANGLE', 'Three fast corners and three big straights.', 'speedway', [21, 25]],
  ['redline', 'REDLINE RACEWAY', 'Hard on the engine, harder on the brakes.', 'speedway', [20, 24]],
];
const PROPS = { sunset: [], neon: ['water', 'containers', 'cranes'], dunes: ['dunes', 'rocks', 'cacti'], frost: ['snowfall'], speedway: ['grandstands', 'floodlights'] };
const FAMILIES = ['polar', 'star', 'stadium', 'dogbone', 'kinked', 'rect'];
// one entry per SPECS row: layout family (+ template for 'rect')
const PLAN = ['star', 'rect:L', 'polar', 'rect:T', 'kinked', 'star', 'rect:U', 'dogbone', 'rect:Z', 'polar', 'star', 'rect:plus', 'kinked', 'rect:H', 'star', 'stadium',
  'rect:stair', 'polar', 'kinked', 'star', 'rect:L', 'dogbone', 'rect:T', 'star', 'rect:U', 'polar', 'star', 'rect:Z', 'kinked', 'rect:plus', 'star', 'dogbone',
  'rect:L', 'stadium', 'rect:stair', 'star', 'polar', 'rect:L', 'kinked', 'star'];
// rectilinear outlines (unit squares, counter-clockwise): rounded by Chaikin cutting they become circuits with real straights and corners
const TEMPLATES = {
  L: [[0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3]],
  T: [[0, 2], [1, 2], [1, 0], [2, 0], [2, 2], [3, 2], [3, 3], [0, 3]],
  U: [[0, 0], [1, 0], [1, 2], [2, 2], [2, 0], [3, 0], [3, 3], [0, 3]],
  Z: [[0, 0], [2, 0], [2, 1], [3, 1], [3, 3], [1, 3], [1, 2], [0, 2]],
  plus: [[1, 0], [2, 0], [2, 1], [3, 1], [3, 2], [2, 2], [2, 3], [1, 3], [1, 2], [0, 2], [0, 1], [1, 1]],
  H: [[0, 0], [1.3, 0], [1.3, 1.3], [2.6, 1.3], [2.6, 0], [3.9, 0], [3.9, 3.9], [2.6, 3.9], [2.6, 2.6], [1.3, 2.6], [1.3, 3.9], [0, 3.9]],
  stair: [[0, 0], [3.6, 0], [3.6, 1.3], [2.4, 1.3], [2.4, 2.6], [1.2, 2.6], [1.2, 3.9], [0, 3.9]],
};

// ---- layout families: each returns a closed list of unit-ish [x, z] points -----------------------------------------------
function chaikin(pts, it) {
  for (let k = 0; k < it; k++) {
    const out = [];
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]); }
    pts = out;
  }
  return pts;
}
function family(kind, rng, tpl) {
  const sx = R(rng, 0.7, 1.7), sz = 1;
  if (kind === 'rect') {
    const pts = TEMPLATES[tpl].map(([x, z]) => [x * R(rng, 0.85, 1.25) + R(rng, -0.12, 0.12), z * R(rng, 0.85, 1.25) + R(rng, -0.12, 0.12)]);
    if (rng() < 0.5) pts.forEach((p) => (p[0] = -p[0]));
    const poly = rng() < 0.5 ? pts : pts.reverse(); // mirrored copies flip the winding; either direction is fine for Chaikin
    return chaikin(poly, 2);
  }
  if (kind === 'polar' || kind === 'dogbone') {
    const N = 24 + Math.floor(rng() * 10), ks = kind === 'dogbone' ? [2, 3] : [2, 3, 4, 5], co = ks.map((k) => [k, (kind === 'dogbone' && k === 2 ? R(rng, 0.35, 0.5) : R(rng, 0.05, 0.3)) / Math.pow(k, 0.45), R(rng, 0, TAU)]);
    return Array.from({ length: N }, (_, i) => { const t = (i / N) * TAU, r = Math.max(0.4, 1 + co.reduce((s, [k, a, ph]) => s + a * Math.cos(k * t + ph), 0)); return [Math.cos(t) * r * sx, Math.sin(t) * r * sz]; });
  }
  if (kind === 'star') {
    const M = 7 + Math.floor(rng() * 6), lo = R(rng, 0.3, 0.6), poly = Array.from({ length: M }, (_, i) => { const t = ((i + R(rng, -0.3, 0.3)) / M) * TAU, r = R(rng, lo, 1); return [Math.cos(t) * r * sx, Math.sin(t) * r]; });
    return chaikin(poly, 2);
  }
  // stadium (superellipse with long straights); 'kinked' adds a wiggle along the straights
  const p = R(rng, 2.6, 5.5), a = R(rng, 1.4, 2.4), N = 36, kink = kind === 'kinked', amp = R(rng, 0.18, 0.32), fr = 3 + Math.floor(rng() * 3), ph = R(rng, 0, TAU);
  return Array.from({ length: N }, (_, i) => {
    const t = (i / N) * TAU, c = Math.cos(t), s = Math.sin(t), x = a * Math.sign(c) * Math.pow(Math.abs(c), 2 / p), z = Math.sign(s) * Math.pow(Math.abs(s), 2 / p);
    return [x, z + (kink ? amp * Math.sin(fr * t + ph) * Math.abs(c) : 0)];
  });
}

// ---- analysis ---------------------------------------------------------------------------------------------------------
function analyse(control) {
  const { P, L, ds } = resample(sample(control), 2.5), n = P.length, Rad = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = P[(i + n - 4) % n], b = P[i], c = P[(i + 4) % n];
    const d1x = (c[0] - a[0]) / 8, d1z = (c[1] - a[1]) / 8, d2x = (c[0] - 2 * b[0] + a[0]) / 16, d2z = (c[1] - 2 * b[1] + a[1]) / 16;
    Rad[i] = 1 / Math.max(Math.abs(d1x * d2z - d1z * d2x) / Math.pow(d1x * d1x + d1z * d1z, 1.5), 1e-6);
  }
  return { P, L, ds, n, Rad, rmin: testRadius(control) };
}
/** Tightest corner radius, measured exactly like tests/maps.test.mjs does. */
function testRadius(control) {
  const { P, ds } = resample(sample(control), 3), n = P.length; let rmin = 1e9;
  for (let i = 0; i < n; i++) {
    const a = P[(i + n - 1) % n], b = P[i], c = P[(i + 1) % n], d1x = (c[0] - a[0]) / 2, d1z = (c[1] - a[1]) / 2, d2x = c[0] - 2 * b[0] + a[0], d2z = c[1] - 2 * b[1] + a[1];
    const k = Math.abs(d1x * d2z - d1z * d2x) / Math.pow(d1x * d1x + d1z * d1z, 1.5); if (k > 0) rmin = Math.min(rmin, 1 / k);
  }
  return rmin;
}
/** Maximal runs where pred(radius) holds, as [startIndex, lengthInSamples], circular. */
function runs(Rad, pred) {
  const n = Rad.length, ok = Array.from(Rad, pred); let start = ok.findIndex((v) => !v); if (start < 0) return [[0, n]];
  const out = []; let cur = null;
  for (let k = 0; k < n; k++) { const i = (start + k) % n; if (ok[i]) { if (!cur) cur = [i, 0]; cur[1]++; } else if (cur) { out.push(cur); cur = null; } }
  if (cur) out.push(cur); return out;
}

/** Rotate / translate so control[0] sits in the middle of the longest straight (grid + start line there) at the origin. */
function startOnStraight(control) {
  const { P, ds, n, Rad } = analyse(control), st = runs(Rad, (r) => r > 380).sort((a, b) => b[1] - a[1])[0];
  const mid = st ? (st[0] + Math.floor(st[1] / 2)) % n : 0; let best = 0, bd = 1e18;
  control.forEach((c, i) => { const d = Math.min(...[0].map(() => 0)) + P.reduce((m, p, j) => (Math.abs(j - mid) < 40 ? Math.min(m, Math.hypot(p[0] - c[0], p[1] - c[1])) : m), 1e18); if (d < bd) { bd = d; best = i; } });
  const rot = [...control.slice(best), ...control.slice(0, best)], [x0, z0] = rot[0];
  return rot.map(([x, z]) => [Math.round(x - x0), Math.round(z - z0)]);
}

// ---- elevation --------------------------------------------------------------------------------------------------------
function elevate(control, theme, rng) {
  const { L, ds, Rad } = analyse(control), allowed = [40, L - 165];
  const straights = [], curvy = [];
  const clip = (a, b, out) => { for (const [lo, hi] of b > L ? [[a, L], [0, b - L]] : [[a, b]]) { const x = Math.max(lo, allowed[0]), y = Math.min(hi, allowed[1]); if (y - x > 0) out.push([x, y]); } };
  for (const [i, len] of runs(Rad, (r) => r > 380)) if (len * ds >= 90) clip(i * ds, (i + len) * ds, straights);
  for (const [i, len] of runs(Rad, (r) => r <= 380)) if (len * ds >= 200) clip(i * ds, (i + len) * ds, curvy);
  const mountain = theme === 'frost', dune = theme === 'dunes', jumpy = theme === 'speedway' || theme === 'neon';
  const E = { hills: [], kickers: [], tables: [], rollers: [] }, taken = [];
  const free = (a, b, pad = 25) => taken.every(([x, y]) => b + pad < x || a - pad > y), take = (a, b) => taken.push([a, b]);
  const at = (s) => Math.round((s / L) * 10000) / 10000, r1 = (v) => Math.round(v * 10) / 10;
  for (const [a, b] of straights.sort((x, y) => y[1] - y[0] - (x[1] - x[0]))) {
    const len = b - a;
    const jumps = !mountain || rng() < 0.25, wantJump = jumps && (jumpy || rng() < (dune ? 0.45 : 0.8));
    if (wantJump && len >= 300) {
      const kl = Math.round(R(rng, 14, 20)), kh = r1(Math.min(R(rng, 1.8, 2.7), kl * 0.14)), s0 = a + 105;
      if (free(s0, s0 + kl + 150)) { E.kickers.push({ at: at(s0), len: kl, h: kh }); take(s0, s0 + kl + 150);
        if (len >= 540 && !dune) { const up = Math.round(R(rng, 14, 18)), top = Math.round(R(rng, 18, 24)), s1 = s0 + kl + 175; if (s1 + up + top + up + 110 <= b && free(s1, s1 + 2 * up + top + 110)) { E.tables.push({ at: at(s1), up, top, down: up + 2, h: r1(Math.min(R(rng, 2, 2.8), up * 0.14)) }); take(s1, s1 + 2 * up + top + 110); } }
      }
    } else if (len >= 140) {
      const cnt = 3 + Math.floor(rng() * (dune ? 3 : 2)), rl = Math.round(R(rng, 8, dune ? 13 : 11)), span = cnt * 2 * rl, s0 = a + 30 + R(rng, 0, Math.max(0, len - span - 70));
      if (len - 60 > span && free(s0, s0 + span)) { E.rollers.push({ at: at(s0), count: cnt, len: rl, h: r1(Math.min(R(rng, 0.9, dune ? 1.5 : 1.2), rl * 0.14)) }); take(s0, s0 + span); }
    }
  }
  for (const [a, b] of curvy) {
    const zone = b - a, nHills = zone > 700 ? 2 : 1;
    for (let k = 0; k < nHills; k++) {
      const cap = mountain ? 17 : dune ? 8 : jumpy ? 4.5 : 6.5, ln = Math.round(Math.min(mountain ? R(rng, 120, 220) : R(rng, 55, 130), zone * 0.3)), hold = mountain && rng() < 0.6 ? Math.round(R(rng, 60, 140)) : 0, span = 2 * ln + hold;
      const lo = a + (k * zone) / nHills + 20, hi = a + ((k + 1) * zone) / nHills - span - 20; if (hi < lo) continue;
      const s0 = R(rng, lo, hi), h = r1(Math.min(R(rng, cap * 0.45, cap), ln * 0.15));
      if (h >= 2.5 && free(s0, s0 + span, 15)) { E.hills.push({ at: at(s0), len: ln, h, ...(hold && { hold }) }); take(s0, s0 + span); }
    }
  }
  const out = {}; for (const k of ['kickers', 'tables', 'hills', 'rollers']) if (E[k].length) out[k] = E[k].sort((x, y) => x.at - y.at);
  return Object.keys(out).length ? out : { hills: [{ at: at(Math.min(L * 0.5, L - 500)), len: 70, h: 3 }] };
}

// ---- tag / difficulty -------------------------------------------------------------------------------------------------
function describe(control, elev, flavour, width) {
  const { L, ds, Rad } = analyse(control), rmin = Math.min(...Rad), st = runs(Rad, (r) => r > 380).map(([, l]) => l * ds), longest = Math.max(0, ...st);
  const tight = runs(Rad, (r) => r < 75).length, jumps = (elev.kickers?.length ?? 0) + (elev.tables?.length ?? 0);
  const shape = longest >= 420 ? 'Long fast straights' : longest >= 250 ? 'A couple of big straights' : tight >= 5 ? 'Constant turns' : 'Flowing bends';
  const extra = tight >= 4 && longest >= 250 ? ' and tight hairpins' : '';
  const hills = Math.max(0, ...(elev.hills ?? []).map((h) => h.h)), ev = jumps >= 3 ? ', with several jumps' : jumps ? ', with a jump' : hills >= 10 ? ', climbing high' : elev.rollers ? ', with whoops' : ', over rolling hills';
  const difficulty = Math.max(1, Math.min(5, 1 + (rmin < 3.4 * width) + (rmin < 2.4 * width) + (tight >= 2) + (tight >= 5) + (longest < 200 && tight >= 3)));
  return { tag: `${flavour} ${shape}${extra}${ev}.`, difficulty, L, rmin, longest, tight };
}

export { family, startOnStraight, analyse, mulberry32, R, FAMILIES, SPECS, PLAN };
if (process.argv[1]?.endsWith('gen-maps.mjs')) {
// ---- main -------------------------------------------------------------------------------------------------------------
const maps = [], stats = [];
SPECS.forEach(([id, name, flavour, theme, [w0, w1]], idx) => {
  const [kind, tpl] = PLAN[idx].split(':');
  for (let attempt = 0; attempt < 400; attempt++) {
    const rng = mulberry32(idx * 7919 + attempt * 104729 + 17), width = Math.round(R(rng, w0, w1));
    let pts = family(kind, rng, tpl); const base = resample(sample(pts), 3).L, target = R(rng, 1900, 3150), k = target / base;
    let control = startOnStraight(pts.map(([x, z]) => [x * k, z * k]));
    if (rng() < 0.5) control = [control[0], ...control.slice(1).reverse()]; // drive the other way round
    if (control.length < 12 || control.length > 70) continue;
    const { L, rmin } = analyse(control);
    const P = resample(sample(control), 3), n = P.P.length, gap = Math.round(150 / P.ds); let sep = 1e9;
    for (let i = 0; i < n; i += 2) for (let j = 0; j < n; j++) { const arc = Math.min(Math.abs(i - j), n - Math.abs(i - j)); if (arc > gap) sep = Math.min(sep, Math.hypot(P.P[i][0] - P.P[j][0], P.P[i][1] - P.P[j][1])); }
    if (!(L > 1700 && L < 3350 && rmin > width * 1.7 && sep > 115)) continue;
    const def = { id, control, roadWidth: width };
    const tr = prepare(def), cap = { maxT: L / 18 + 30 }; // generous: a lap should take ~L/30 s
    const first = lap(def, CARS[0], tr, cap); if (!first.done || first.grass >= 1) continue; // cheap early-out before the other cars
    const laps = [first, ...CARS.slice(1).map((c) => lap(def, c, tr, cap))]; if (laps.some((x) => !x.done || x.grass >= 1)) continue;
    const ts = laps.map((x) => x.time), spread = (Math.max(...ts) - Math.min(...ts)) / Math.min(...ts); if (spread > 0.09) continue;
    const elev = elevate(control, theme, rng), d = describe(control, elev, flavour, width);
    maps.push({ id, name, tag: d.tag, difficulty: d.difficulty, roadWidth: width, seed: 100 + idx, theme, props: PROPS[theme], elev, control });
    stats.push(`${id.padEnd(14)} ${(tpl ? kind + ':' + tpl : kind).padEnd(11)} try ${String(attempt).padStart(3)}  ${(L / 1000).toFixed(2)} km  rmin ${rmin.toFixed(0).padStart(4)}  sep ${sep.toFixed(0).padStart(4)}  longest ${d.longest.toFixed(0).padStart(4)}  spread ${(spread * 100).toFixed(1)}%  diff ${d.difficulty}`);
    console.error(`[${idx + 1}/${SPECS.length}] ${id}`);
    return;
  }
  console.log('FAILED to generate', id);
});
console.log(stats.join('\n'));

const fmt = (v) => (Array.isArray(v) ? '[' + v.map(fmt).join(', ') + ']' : v && typeof v === 'object' ? '{ ' + Object.entries(v).map(([k, x]) => `${k}: ${fmt(x)}`).join(', ') + ' }' : JSON.stringify(v).replace(/"/g, "'"));
const body = maps.map((m) => `  {\n    id: '${m.id}', name: '${m.name}', difficulty: ${m.difficulty}, roadWidth: ${m.roadWidth}, seed: ${m.seed}, theme: '${m.theme}', props: ${fmt(m.props)},\n    tag: ${JSON.stringify(m.tag).replace(/"/g, "'")},\n    elev: ${fmt(m.elev)},\n    control: [${m.control.map((c) => `[${c[0]}, ${c[1]}]`).join(', ').replace(/(.{110,}?\],) /g, '$1\n      ')}],\n  },`).join('\n');
fs.writeFileSync(new URL('../public/js/world/mapdata.js', import.meta.url), `// GENERATED by tools/gen-maps.mjs (node tools/gen-maps.mjs): extra track layouts + their elevation. Pure data, no Three.js.\n// \`theme\` is a key into the theme table in maps.js; maps.js turns each entry into a full map definition.\nexport const EXTRA_MAPS = [\n${body}\n];\n`);
console.log(`wrote ${maps.length} maps`);
}
