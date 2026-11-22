// Exports every car in public/js/vehicle/cars.js to glTF binary (.glb) and Wavefront OBJ (+MTL) for Blender.
// Rebuilds the exact geometry from public/js/vehicle/CarModel.js without needing Three.js.
//   node tools/export_cars.mjs [outDir]
import fs from 'node:fs'; import path from 'node:path';
import { CARS } from '../public/js/vehicle/cars.js';

const R = 0.34, W = 0.27, PI = Math.PI;
const out = path.resolve(process.argv[2] || 'car_models');

// ---------- geometry primitives: { pos:[], nrm:[], idx:[] } (Y up, +Z = nose, 1 unit = 1 metre) ----------
const G = () => ({ pos: [], nrm: [], idx: [] });
function box(w, h, d) {
  const g = G(), hw = w / 2, hh = h / 2, hd = d / 2;
  const faces = [[[1, 0, 0], [hw, -hh, hd], [hw, -hh, -hd], [hw, hh, -hd], [hw, hh, hd]], [[-1, 0, 0], [-hw, -hh, -hd], [-hw, -hh, hd], [-hw, hh, hd], [-hw, hh, -hd]],
    [[0, 1, 0], [-hw, hh, hd], [hw, hh, hd], [hw, hh, -hd], [-hw, hh, -hd]], [[0, -1, 0], [-hw, -hh, -hd], [hw, -hh, -hd], [hw, -hh, hd], [-hw, -hh, hd]],
    [[0, 0, 1], [-hw, -hh, hd], [hw, -hh, hd], [hw, hh, hd], [-hw, hh, hd]], [[0, 0, -1], [hw, -hh, -hd], [-hw, -hh, -hd], [-hw, hh, -hd], [hw, hh, -hd]]];
  for (const [n, ...vs] of faces) { const b = g.pos.length / 3; vs.forEach((v) => { g.pos.push(...v); g.nrm.push(...n); }); g.idx.push(b, b + 1, b + 2, b, b + 2, b + 3); }
  return g;
}
function cyl(rt, rb, h, seg, openEnded = false) { // along Y; rt=0 gives a cone with its tip at +Y
  const g = G(), slope = (rb - rt) / h;
  for (let i = 0; i <= seg; i++) {
    const u = i / seg, th = u * 2 * PI, s = Math.sin(th), c = Math.cos(th), nl = Math.hypot(1, slope);
    g.pos.push(rt * s, h / 2, rt * c, rb * s, -h / 2, rb * c); g.nrm.push(s / nl, slope / nl, c / nl, s / nl, slope / nl, c / nl);
  }
  for (let i = 0; i < seg; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; g.idx.push(a, b, c, b, d, c); }
  if (!openEnded) for (const [r, y, ny] of [[rt, h / 2, 1], [rb, -h / 2, -1]]) {
    if (r === 0) continue; const c0 = g.pos.length / 3; g.pos.push(0, y, 0); g.nrm.push(0, ny, 0);
    for (let i = 0; i <= seg; i++) { const th = (i / seg) * 2 * PI; g.pos.push(r * Math.sin(th), y, r * Math.cos(th)); g.nrm.push(0, ny, 0); }
    for (let i = 0; i < seg; i++) ny > 0 ? g.idx.push(c0 + i + 1, c0, c0 + i + 2) : g.idx.push(c0 + i + 2, c0, c0 + i + 1);
  }
  return g;
}
function torus(Rr, tube, rs, ts, arc) {
  const g = G();
  for (let j = 0; j <= rs; j++) for (let i = 0; i <= ts; i++) {
    const u = (i / ts) * arc, v = (j / rs) * 2 * PI, cx = Rr * Math.cos(u), cy = Rr * Math.sin(u);
    const x = (Rr + tube * Math.cos(v)) * Math.cos(u), y = (Rr + tube * Math.cos(v)) * Math.sin(u), z = tube * Math.sin(v);
    g.pos.push(x, y, z); const nx = x - cx, ny = y - cy, nz = z, l = Math.hypot(nx, ny, nz) || 1; g.nrm.push(nx / l, ny / l, nz / l);
  }
  for (let j = 1; j <= rs; j++) for (let i = 1; i <= ts; i++) { const a = (ts + 1) * j + i - 1, b = (ts + 1) * (j - 1) + i - 1, c = (ts + 1) * (j - 1) + i, d = (ts + 1) * j + i; g.idx.push(a, b, d, b, c, d); }
  return g;
}
const rot = (g, axis, a) => { // rotate geometry (positions + normals) about X/Y/Z
  const c = Math.cos(a), s = Math.sin(a);
  const f = (arr) => { for (let i = 0; i < arr.length; i += 3) { const [x, y, z] = [arr[i], arr[i + 1], arr[i + 2]];
    if (axis === 'x') { arr[i + 1] = y * c - z * s; arr[i + 2] = y * s + z * c; } else if (axis === 'y') { arr[i] = x * c + z * s; arr[i + 2] = -x * s + z * c; } else { arr[i] = x * c - y * s; arr[i + 1] = x * s + y * c; } } };
  f(g.pos); f(g.nrm); return g;
};
const move = (g, x, y, z) => { for (let i = 0; i < g.pos.length; i += 3) { g.pos[i] += x; g.pos[i + 1] += y; g.pos[i + 2] += z; } return g; };

/** Side profile [z,y] extruded across the car's width with a rounded bevel (same recipe as CarModel.profile). */
function profile(pts, width, bev) {
  let P = pts.map(([x, y]) => [x, y]);
  const area = P.reduce((a, [x, y], i) => { const [x2, y2] = P[(i + 1) % P.length]; return a + (x * y2 - x2 * y); }, 0);
  if (area < 0) P.reverse(); // make it counter-clockwise
  const n = P.length, depth = width - 2 * bev, segs = 3;
  const nrm2 = P.map((p, i) => { const q = P[(i + 1) % n], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy); return [dy / l, -dx / l]; });
  const offs = (bs) => P.map((p, i) => { const a = nrm2[(i + n - 1) % n], b = nrm2[i], k = 1 / Math.max(0.35, 1 + a[0] * b[0] + a[1] * b[1]); return [p[0] + (a[0] + b[0]) * k * bs, p[1] + (a[1] + b[1]) * k * bs]; });
  const layers = [];
  for (let b = 0; b <= segs; b++) { const t = b / segs; layers.push([-bev * Math.cos(t * PI / 2), offs(bev * Math.sin(t * PI / 2))]); }
  for (let b = segs; b >= 0; b--) { const t = b / segs; layers.push([depth + bev * Math.cos(t * PI / 2), offs(bev * Math.sin(t * PI / 2))]); }
  const g = G(), tri = (a, b, c) => { const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0]; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const b0 = g.pos.length / 3; for (const p of [a, b, c]) { g.pos.push(...p); g.nrm.push(nx, ny, nz); } g.idx.push(b0, b0 + 1, b0 + 2); };
  for (let l = 0; l < layers.length - 1; l++) { const [za, ca] = layers[l], [zb, cb] = layers[l + 1];
    for (let i = 0; i < n; i++) { const j = (i + 1) % n, A = [...ca[i], za], B = [...ca[j], za], C = [...cb[j], zb], D = [...cb[i], zb]; tri(A, B, C); tri(A, C, D); } }
  const ears = earClip(layers[0][1]); // caps (front faces -z, back +z)
  for (const [a, b, c] of ears) { const f = layers[0][1], k = layers[layers.length - 1][1];
    tri([...f[a], layers[0][0]], [...f[c], layers[0][0]], [...f[b], layers[0][0]]); tri([...k[a], layers[layers.length - 1][0]], [...k[b], layers[layers.length - 1][0]], [...k[c], layers[layers.length - 1][0]]); }
  move(g, 0, 0, -depth / 2); rot(g, 'y', -PI / 2); return g;
}
function earClip(poly) { // counter-clockwise simple polygon -> triangle index triples
  const idx = poly.map((_, i) => i), tris = [], cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p, a, b, c) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < 1000) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
      if (cross(poly[a], poly[b], poly[c]) <= 1e-12) continue;
      if (idx.some((k) => k !== a && k !== b && k !== c && inside(poly[k], poly[a], poly[b], poly[c]))) continue;
      tris.push([a, b, c]); idx.splice(i, 1); cut = true; break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) tris.push([...idx]); return tris;
}

// ---------- the car, mirroring CarModel.js ----------
const hex = (c) => [(c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255];
const eul = (rx, ry) => { const q = (ax, a) => { const s = Math.sin(a / 2), c = Math.cos(a / 2); return ax === 'x' ? [s, 0, 0, c] : [0, s, 0, c]; };
  const m = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  return m(q('x', rx), q('y', ry)); }; // three.js Euler 'XYZ' => qx * qy

function buildCar(def) {
  const { len = 1, hs = 1, ws = 1, wing = 1, stripe = null } = def.style;
  const HY = (y) => (y > 0.5 ? 0.46 + (y - 0.46) * hs : y);
  const mats = {
    paint: { name: 'Paint', color: hex(def.color), metal: 0.55, rough: 0.3, clearcoat: 1 }, dark: { name: 'Dark_Trim', color: hex(0x0b0c0e), metal: 0.3, rough: 0.55 },
    glass: { name: 'Glass', color: hex(0x07090d), metal: 0.9, rough: 0.06, clearcoat: 1 }, chrome: { name: 'Chrome', color: hex(0xdddddd), metal: 1, rough: 0.18 },
    head: { name: 'Headlight', color: hex(0xffffff), metal: 0, rough: 0.5, emissive: hex(0xcfe6ff), estr: 4 }, tail: { name: 'Taillight', color: hex(0x300000), metal: 0, rough: 0.5, emissive: hex(0xff0a14), estr: 1.2 },
    tire: { name: 'Tyre', color: hex(0x0f0f11), metal: 0, rough: 0.92 }, rim: { name: 'Rim', color: hex(0xc9ced6), metal: 1, rough: 0.22 }, caliper: { name: 'Brake_Caliper', color: hex(0xd01010), metal: 0, rough: 0.4 },
  };
  if (stripe != null) mats.stripe = { name: 'Livery_Stripe', color: hex(stripe), metal: 0.3, rough: 0.35 };
  const body = { name: 'Body', t: [0, 0, 0], q: [0, 0, 0, 1], kids: [] }, root = { name: def.name.replace(/\s+/g, '_'), t: [0, 0, 0], q: [0, 0, 0, 1], kids: [body] };
  const add = (name, geo, mat, x, y, z, rx = 0, ry = 0, parent = body, noScale = false) => { parent.kids.push({ name, geo, mat, t: noScale ? [x, y, z] : [x * ws, HY(y), z * len], q: eul(rx, ry), kids: [] }); };
  const P = (pts) => pts.map(([z, y]) => [z * len, HY(y)]);
  add('Body_Shell', profile(P([[-2.15, 0.46], [-2.15, 0.9], [-1.7, 0.98], [-1.2, 1.0], [0.9, 0.98], [1.55, 0.9], [2.1, 0.7], [2.14, 0.5]]), 1.86 * ws, 0.07), 'paint', 0, 0, 0);
  add('Cabin_Glass', profile(P([[-1.2, 0.98], [-0.8, 1.46], [0.45, 1.46], [1.0, 0.98]]), 1.55 * ws, 0.03), 'glass', 0, 0, 0);
  add('Roof_Panel', box(1.45, 0.05, 1.2), 'paint', 0, 1.5, -0.17);
  for (const [s, L] of [[-1, 'R'], [1, 'L']]) {
    add('Pillar_A_' + L, box(0.07, 0.06, 0.73), 'paint', s * 0.77, 1.24, 0.725, 0.72); add('Pillar_C_' + L, box(0.09, 0.06, 0.66), 'paint', s * 0.76, 1.24, -1.025, -0.82);
    add('Side_Skirt_' + L, box(0.1, 0.12, 2.3), 'dark', s * 0.96, 0.46, 0.1); add('Mirror_' + L, box(0.2, 0.12, 0.12), 'paint', s * 1.0, 1.12, 0.55);
    if (wing > 0) { add('Wing_EndPlate_' + L, box(0.05, 0.2, 0.46), 'dark', s * 0.86, 1.34 + (wing - 1) * 0.2, -2.0); add('Wing_Stand_' + L, box(0.06, 0.3, 0.1), 'dark', s * 0.6, 1.1 + (wing - 1) * 0.2, -1.95); }
    add('Headlight_' + L, box(0.55, 0.1, 0.1), 'head', s * 0.66, 0.62, 2.19); add('DRL_' + L, box(0.3, 0.05, 0.08), 'head', s * 0.66, 0.5, 2.2);
    add('Taillight_' + L, box(0.5, 0.1, 0.06), 'tail', s * 0.62, 0.78, -2.24); add('Exhaust_' + L, cyl(0.07, 0.07, 0.3, 14), 'chrome', s * 0.45, 0.5, -2.2, PI / 2);
  }
  add('Front_Splitter', box(1.9, 0.05, 0.4), 'dark', 0, 0.42, 2.25); add('Grille', box(1.0, 0.18, 0.05), 'dark', 0, 0.58, 2.27); add('Rear_Diffuser', box(1.6, 0.14, 0.4), 'dark', 0, 0.5, -2.15);
  if (wing > 0) add('Rear_Wing', box(1.75, 0.05, 0.44), 'dark', 0, 1.3 + (wing - 1) * 0.2, -2.0, 0.08); else add('Ducktail_Lip', box(1.5, 0.05, 0.3), 'paint', 0, 1.0, -2.0, 0.12);
  if (stripe != null) { add('Stripe_Bonnet', box(0.34, 0.012, 0.75), 'stripe', 0, 1.0, 1.25, 0.06); add('Stripe_Roof', box(0.34, 0.012, 1.15), 'stripe', 0, 1.53, -0.17); add('Stripe_Boot', box(0.34, 0.012, 0.7), 'stripe', 0, 1.0, -1.55, -0.04); }
  add('Bonnet_Vent', box(0.4, 0.04, 0.8), 'dark', 0, 1.02, 1.1); add('Tail_Strip', box(0.55, 0.06, 0.06), 'tail', 0, 0.78, -2.25);
  // wheels: pivot (steering) -> spin (rolling). Pivot origins sit on the axle, so rotate "Spin" about X in Blender to roll them.
  for (const [sx, z, front, nm] of [[-1, 1.4, true, 'FR'], [1, 1.4, true, 'FL'], [-1, -1.35, false, 'RR'], [1, -1.35, false, 'RL']]) {
    const pivot = { name: 'Wheel_' + nm, t: [sx * 0.93 * ws, R, z * len], q: [0, 0, 0, 1], kids: [] }, spin = { name: 'Spin_' + nm, t: [0, 0, 0], q: [0, 0, 0, 1], kids: [] };
    pivot.kids.push(spin); root.kids.push(pivot);
    add('Tyre_' + nm, rot(cyl(R, R, W, 28), 'z', PI / 2), 'tire', 0, 0, 0, 0, 0, spin, true); add('Rim_' + nm, rot(cyl(R * 0.68, R * 0.68, W * 0.9, 24), 'z', PI / 2), 'rim', 0, 0, 0, 0, 0, spin, true);
    add('Brake_Disc_' + nm, rot(cyl(R * 0.55, R * 0.55, 0.03, 20), 'z', PI / 2), 'dark', -sx * 0.06, 0, 0, 0, 0, spin, true);
    for (let k = 0; k < 5; k++) add(`Spoke_${nm}_${k + 1}`, box(0.04, R * 1.25, 0.06), 'chrome', sx * W * 0.43, 0, 0, (k * PI) / 5, 0, spin, true);
    add('Caliper_' + nm, box(0.05, 0.12, 0.2), 'caliper', -sx * 0.04, R * 0.38, 0, 0, 0, pivot, true);
    add('Wheel_Arch_' + nm, rot(torus(R + 0.09, 0.045, 8, 20, PI), 'y', PI / 2), 'dark', sx * 0.93 * ws, R, z * len, 0, 0, body, true);
  }
  return { root, mats };
}

// ---------- glTF (.glb) ----------
function toGLB(car, def) {
  const bin = [], views = [], accs = [], meshes = [], nodes = [], matIdx = {}, materials = [];
  const align = (n) => (4 - (n % 4)) % 4, push = (buf, target) => { const off = bin.reduce((a, b) => a + b.length, 0); bin.push(buf); const pad = align(buf.length); if (pad) bin.push(Buffer.alloc(pad)); views.push({ buffer: 0, byteOffset: off, byteLength: buf.length, target }); return views.length - 1; };
  const mat = (key) => { if (matIdx[key] != null) return matIdx[key]; const m = car.mats[key], ext = {};
    if (m.clearcoat) ext.KHR_materials_clearcoat = { clearcoatFactor: 1, clearcoatRoughnessFactor: 0.04 };
    const o = { name: m.name, pbrMetallicRoughness: { baseColorFactor: [...m.color, 1], metallicFactor: m.metal, roughnessFactor: m.rough } };
    if (m.emissive) { o.emissiveFactor = m.emissive; ext.KHR_materials_emissive_strength = { emissiveStrength: m.estr }; }
    if (Object.keys(ext).length) o.extensions = ext; materials.push(o); return (matIdx[key] = materials.length - 1); };
  const emit = (n) => { const node = { name: n.name }; if (n.t.some((v) => v)) node.translation = n.t.map((v) => +v.toFixed(6)); if (n.q.some((v, i) => v !== [0, 0, 0, 1][i])) node.rotation = n.q.map((v) => +v.toFixed(8));
    if (n.geo) { const g = n.geo, pos = new Float32Array(g.pos), nr = new Float32Array(g.nrm), ix = new Uint32Array(g.idx);
      const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i + k]); mx[k] = Math.max(mx[k], pos[i + k]); }
      const a = (view, ct, count, type, extra = {}) => { accs.push({ bufferView: view, componentType: ct, count, type, ...extra }); return accs.length - 1; };
      const P = a(push(Buffer.from(pos.buffer), 34962), 5126, pos.length / 3, 'VEC3', { min: mn, max: mx }), N = a(push(Buffer.from(nr.buffer), 34962), 5126, nr.length / 3, 'VEC3'), I = a(push(Buffer.from(ix.buffer), 34963), 5125, ix.length, 'SCALAR');
      meshes.push({ name: n.name, primitives: [{ attributes: { POSITION: P, NORMAL: N }, indices: I, material: mat(n.mat) }] }); node.mesh = meshes.length - 1; }
    const id = nodes.push(node) - 1; if (n.kids.length) node.children = n.kids.map(emit); return id; };
  const rootId = emit(car.root);
  const json = { asset: { version: '2.0', generator: 'ApexDrive car exporter' }, scene: 0, scenes: [{ name: def.name, nodes: [rootId] }], nodes, meshes, materials, accessors: accs, bufferViews: views,
    extensionsUsed: ['KHR_materials_clearcoat', 'KHR_materials_emissive_strength'], buffers: [{ byteLength: Buffer.concat(bin).length }] };
  const jb = Buffer.from(JSON.stringify(json)), jp = Buffer.concat([jb, Buffer.alloc(align(jb.length), 0x20)]), bb = Buffer.concat(bin), bp = Buffer.concat([bb, Buffer.alloc(align(bb.length))]);
  json.buffers[0].byteLength = bp.length; const jb2 = Buffer.from(JSON.stringify(json)), jp2 = Buffer.concat([jb2, Buffer.alloc(align(jb2.length), 0x20)]);
  const head = Buffer.alloc(12); head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + jp2.length + 8 + bp.length, 8);
  const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.write(type, 4, 'latin1'); return b; };
  return Buffer.concat([head, ch(jp2.length, 'JSON'), jp2, ch(bp.length, 'BIN\0'), bp]);
}

// ---------- OBJ ----------
function toOBJ(car, def, name) {
  const qm = ([x, y, z, w]) => [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]];
  const apply = (M, t, p) => [M[0][0] * p[0] + M[0][1] * p[1] + M[0][2] * p[2] + t[0], M[1][0] * p[0] + M[1][1] * p[1] + M[1][2] * p[2] + t[1], M[2][0] * p[0] + M[2][1] * p[1] + M[2][2] * p[2] + t[2]];
  let o = `# ${def.name} - ApexDrive (Y up, nose +Z, 1 unit = 1 m)\nmtllib ${name}.mtl\n`, vo = 1;
  const walk = (n, chain) => { const ch = [{ t: n.t, M: qm(n.q) }, ...chain];
    if (n.geo) { const tr = (p, isN) => ch.reduce((v, c) => (isN ? apply(c.M, [0, 0, 0], v) : apply(c.M, c.t, v)), p);
      o += `o ${n.name}\nusemtl ${car.mats[n.mat].name}\n`; const g = n.geo;
      for (let i = 0; i < g.pos.length; i += 3) o += 'v ' + tr([g.pos[i], g.pos[i + 1], g.pos[i + 2]]).map((v) => v.toFixed(5)).join(' ') + '\n';
      for (let i = 0; i < g.nrm.length; i += 3) o += 'vn ' + tr([g.nrm[i], g.nrm[i + 1], g.nrm[i + 2]], true).map((v) => v.toFixed(4)).join(' ') + '\n';
      for (let i = 0; i < g.idx.length; i += 3) o += 'f ' + [0, 1, 2].map((k) => { const v = g.idx[i + k] + vo; return `${v}//${v}`; }).join(' ') + '\n'; vo += g.pos.length / 3; }
    n.kids.forEach((k) => walk(k, ch)); };
  walk(car.root, []);
  const mtl = Object.values(car.mats).map((m) => `newmtl ${m.name}\nKd ${m.color.map((v) => v.toFixed(4)).join(' ')}\nKs ${(m.metal * 0.5).toFixed(3)} ${(m.metal * 0.5).toFixed(3)} ${(m.metal * 0.5).toFixed(3)}\nNs ${Math.round((1 - m.rough) * 200)}\n${m.emissive ? `Ke ${m.emissive.map((v) => (v * 1).toFixed(3)).join(' ')}\n` : ''}illum 2\n`).join('\n');
  return { obj: o, mtl };
}

fs.mkdirSync(path.join(out, 'glb'), { recursive: true }); fs.mkdirSync(path.join(out, 'obj'), { recursive: true });
const stats = [];
for (const def of CARS) {
  const car = buildCar(def), glb = toGLB(car, def), { obj, mtl } = toOBJ(car, def, def.id);
  fs.writeFileSync(path.join(out, 'glb', def.id + '.glb'), glb); fs.writeFileSync(path.join(out, 'obj', def.id + '.obj'), obj); fs.writeFileSync(path.join(out, 'obj', def.id + '.mtl'), mtl);
  let tris = 0, parts = 0; const walk = (n) => { if (n.geo) { tris += n.geo.idx.length / 3; parts++; } n.kids.forEach(walk); }; walk(car.root);
  stats.push(`${def.id.padEnd(9)} ${String(parts).padStart(3)} parts ${String(tris).padStart(6)} tris  ${(glb.length / 1024).toFixed(0)} KB glb`);
}
console.log(stats.join('\n'));
