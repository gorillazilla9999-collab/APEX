import * as THREE from 'three';
import { crowdTex } from './textures.js';

/**
 * Theme props. Each one is `(world) => void` and adds meshes to world.group, colliders to world.colliders and
 * keep-out circles to world.blocked. Frame updaters (e.g. snow) are pushed to world.dyn as (camPos, dt) => void.
 */
const dummy = new THREE.Object3D();
const M = new THREE.Matrix4(), P = new THREE.Matrix4(), L = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S1 = new THREE.Vector3(1, 1, 1);
const col = (hexes) => hexes.map((c) => new THREE.Color(c));

function finish(w, ...meshes) { meshes.forEach((m) => { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; w.group.add(m); }); }

/** Random point beside the road: `minOff`..`maxOff` metres beyond the road edge (side 0 = either). */
function spot(w, minOff, maxOff, side = 0) {
  const t = w.track, rng = w.rng, i = Math.floor(rng() * t.n), sd = side || (rng() < 0.5 ? -1 : 1), off = w.half + minOff + rng() * (maxOff - minOff);
  return { x: t.px[i] - t.tz[i] * sd * off, z: t.pz[i] + t.tx[i] * sd * off, i, side: sd, tx: t.tx[i], tz: t.tz[i] };
}
const clear = (w, x, z, minTrack, pad = 0) => w.track.nearest(x, z).dist >= w.half + minTrack && !w.blocked.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + pad);

/** Place a child part of a composite instance: parent transform * local offset. */
function putPart(mesh, k, parent, lx, ly, lz, rotZ = 0) {
  L.compose(V.set(lx, ly, lz), Q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), rotZ), S1);
  mesh.setMatrixAt(k, M.multiplyMatrices(parent, L));
}

// ---- Neon Harbor ---------------------------------------------------------------------------------------------
function water(w) {
  const b = w.bounds; w.quayX = b.x0 - 240;
  const depthZ = b.z1 - b.z0 + 800;
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(900, depthZ).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x0a1a38, roughness: 0.12, metalness: 0.6, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  sea.position.set(w.quayX - 450, 0.12, (b.z0 + b.z1) / 2); sea.receiveShadow = true; w.group.add(sea);
  const quay = new THREE.Mesh(new THREE.BoxGeometry(6, 0.9, depthZ), new THREE.MeshStandardMaterial({ color: 0x2a2d36, roughness: 0.9 }));
  quay.position.set(w.quayX + 3, 0.45, (b.z0 + b.z1) / 2); quay.receiveShadow = true; w.group.add(quay);
}

function containers(w) {
  const rng = w.rng, palette = col([0xc2410c, 0x1d4ed8, 0x15803d, 0xb91c1c, 0xca8a04, 0x0e7490, 0x7c3aed, 0x475569]), list = [];
  for (let tries = 0; list.length < 22 && tries < 800; tries++) {
    const p = spot(w, 12, 34);
    if (!clear(w, p.x, p.z, 11, 10)) continue;
    list.push({ ...p, rows: 1 + Math.floor(rng() * 3), stack: 1 + Math.floor(rng() * 2) });
    w.blocked.push({ x: p.x, z: p.z, r: 14 });
  }
  const total = list.reduce((s, c) => s + c.rows * c.stack, 0);
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2.5, 2.6, 12), new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.35 }), Math.max(1, total));
  let k = 0;
  for (const c of list) {
    const th = Math.atan2(c.tx, c.tz), nx = -c.tz * c.side, nz = c.tx * c.side; // normal pointing away from the road
    for (let r = 0; r < c.rows; r++) {
      const x = c.x + nx * r * 2.8, z = c.z + nz * r * 2.8;
      w.colliders.addBox(x, z, 1.25, 6, th);
      for (let s = 0; s < c.stack; s++) {
        dummy.position.set(x, 1.3 + s * 2.62, z); dummy.rotation.set(0, th, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
        mesh.setMatrixAt(k, dummy.matrix); mesh.setColorAt(k, palette[Math.floor(rng() * palette.length)]); k++;
      }
    }
  }
  mesh.count = k; finish(w, mesh);
}

function cranes(w) {
  const b = w.bounds, qx = w.quayX ?? b.x0 - 240, n = 4, z0 = b.z0 + 40, step = (b.z1 - b.z0 - 80) / (n - 1);
  const steel = new THREE.MeshStandardMaterial({ color: 0xd9480f, roughness: 0.6, metalness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.6, metalness: 0.5 });
  const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.1, 0.1).multiplyScalar(3) });
  const leg = new THREE.BoxGeometry(1.4, 34, 1.4), beam = new THREE.BoxGeometry(46, 2.2, 3), cab = new THREE.BoxGeometry(5, 4, 5), bulb = new THREE.BoxGeometry(0.9, 0.9, 0.9);
  for (let k = 0; k < n; k++) {
    const cx = qx - 14, cz = z0 + k * step;
    for (const [sx, sz] of [[-6, -8], [6, -8], [-6, 8], [6, 8]]) {
      const m = new THREE.Mesh(leg, steel); m.position.set(cx + sx, 17, cz + sz); m.castShadow = true; w.group.add(m);
      w.colliders.addCircle(cx + sx, cz + sz, 1.1);
    }
    const jib = new THREE.Mesh(beam, steel); jib.position.set(cx - 14, 34.5, cz); jib.castShadow = true; w.group.add(jib);
    const cabin = new THREE.Mesh(cab, dark); cabin.position.set(cx + 4, 37, cz); w.group.add(cabin);
    const light = new THREE.Mesh(bulb, lamp); light.position.set(cx - 36.5, 36, cz); w.group.add(light);
    w.blocked.push({ x: cx, z: cz, r: 14 });
  }
}

// ---- Dune Canyon ---------------------------------------------------------------------------------------------
function dunes(w) {
  const rng = w.rng, { cx, cz } = w.bounds, N = 40, shades = col([0xd9b377, 0xcfa466, 0xe2bf84, 0xc99a5a]);
  const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 10), new THREE.MeshStandardMaterial({ roughness: 1 }), N);
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2 + rng() * 0.15, r = 900 + rng() * 300, sy = 22 + rng() * 46;
    dummy.position.set(cx + Math.cos(a) * r, -sy * 0.35, cz + Math.sin(a) * r); dummy.rotation.set(0, a + rng() * 0.6, 0);
    dummy.scale.set(170 + rng() * 140, sy, 120 + rng() * 110); dummy.updateMatrix();
    mesh.setMatrixAt(k, dummy.matrix); mesh.setColorAt(k, shades[Math.floor(rng() * shades.length)]);
  }
  mesh.frustumCulled = false; w.group.add(mesh);
}

function rocks(w) {
  const rng = w.rng, b = w.bounds, spots = [], tones = col([0x8a5a3a, 0x9c6a44, 0x7a4f34, 0xa9774c, 0x6f4a33]);
  for (let tries = 0; spots.length < 140 && tries < 3000; tries++) {
    let x, z;
    if (rng() < 0.7) { const p = spot(w, 6, 90); x = p.x; z = p.z; } else { x = b.x0 - 250 + rng() * (b.x1 - b.x0 + 500); z = b.z0 - 250 + rng() * (b.z1 - b.z0 + 500); }
    if (!clear(w, x, z, 7, 2)) continue;
    const s = 1.3 + rng() * rng() * 4.4;
    spots.push([x, z, s]); w.blocked.push({ x, z, r: s * 1.2 });
  }
  const mesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), spots.length);
  spots.forEach(([x, z, s], k) => {
    dummy.position.set(x, s * 0.45, z); dummy.rotation.set(rng() * 0.4, rng() * 6, rng() * 0.4);
    dummy.scale.set(s * (0.9 + rng() * 0.5), s * (0.6 + rng() * 0.4), s * (0.9 + rng() * 0.5)); dummy.updateMatrix();
    mesh.setMatrixAt(k, dummy.matrix); mesh.setColorAt(k, tones[Math.floor(rng() * tones.length)]);
    w.colliders.addCircle(x, z, s * 0.95);
  });
  finish(w, mesh);
}

function cacti(w) {
  const rng = w.rng, spots = [];
  for (let tries = 0; spots.length < 110 && tries < 2500; tries++) {
    const p = spot(w, 8, 80);
    if (!clear(w, p.x, p.z, 7, 1.5)) continue;
    spots.push([p.x, p.z, 0.8 + rng() * 0.9, rng() * 6]); w.blocked.push({ x: p.x, z: p.z, r: 2 });
  }
  const green = new THREE.MeshStandardMaterial({ color: 0x3f7d3a, roughness: 0.9 }), n = spots.length;
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.45, 0.55, 5, 8), green, n);
  const armUp = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.28, 2.2, 8), green, n * 2);
  const armOut = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.28, 1.0, 8), green, n * 2);
  spots.forEach(([x, z, s, r], k) => {
    dummy.position.set(x, 2.5 * s, z); dummy.rotation.set(0, r, 0); dummy.scale.setScalar(s); dummy.updateMatrix();
    trunk.setMatrixAt(k, dummy.matrix); P.copy(dummy.matrix);
    for (let a = 0; a < 2; a++) {
      const sd = a ? 1 : -1, h = 0.5 + rng() * 0.8;
      putPart(armOut, k * 2 + a, P, sd * 0.5, h * 1.2 - 0.6, 0, Math.PI / 2);
      putPart(armUp, k * 2 + a, P, sd * 1.0, 0.4 + h, 0);
    }
    w.colliders.addCircle(x, z, 0.7 * s);
  });
  finish(w, trunk, armUp, armOut);
}

// ---- Grand Speedway ------------------------------------------------------------------------------------------
function grandstands(w) {
  const t = w.track, STEP = Math.max(1, Math.round(40 / t.ds)), len = STEP * t.ds - 1, TIER = 3.2, heights = [2.2, 4.4, 6.6], blocks = [];
  const run = (f0, f1, side, off) => {
    const i0 = t.at(f0), count = Math.round((f1 - f0) * t.n / STEP);
    for (let k = 0; k < count; k++) blocks.push({ i: (i0 + k * STEP + (STEP >> 1)) % t.n, side, off });
  };
  const out = w.half + 16;
  run(0.03, 0.24, -1, out); run(0.53, 0.74, -1, out); run(0.06, 0.18, 1, out);
  const crowd = new THREE.MeshStandardMaterial({ map: crowdTex(), roughness: 0.9 });
  const tiers = heights.map(() => new THREE.InstancedMesh(new THREE.BoxGeometry(TIER, 1, 1), crowd, blocks.length));
  const roof = new THREE.InstancedMesh(new THREE.BoxGeometry(11, 0.4, 1), new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.6, metalness: 0.3 }), blocks.length);
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 8.8, 0.4), new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.5, metalness: 0.6 }), blocks.length * 2);
  blocks.forEach((b, k) => {
    const tx = t.tx[b.i], tz = t.tz[b.i], nx = -tz * b.side, nz = tx * b.side, th = Math.atan2(tx, tz);
    const at = (o) => [t.px[b.i] + nx * o, t.pz[b.i] + nz * o];
    heights.forEach((h, ti) => {
      const [x, z] = at(b.off + ti * TIER);
      dummy.position.set(x, h / 2, z); dummy.rotation.set(0, th, 0); dummy.scale.set(1, h, len); dummy.updateMatrix(); tiers[ti].setMatrixAt(k, dummy.matrix);
    });
    const [rx, rz] = at(b.off + TIER * 1.5 - 0.6);
    dummy.position.set(rx, 9.4, rz); dummy.rotation.set(0, th, 0); dummy.scale.set(1, 1, len); dummy.updateMatrix(); roof.setMatrixAt(k, dummy.matrix);
    for (const e of [-1, 1]) {
      const [px, pz] = at(b.off - 0.4);
      dummy.position.set(px + tx * e * (len / 2 - 0.3), 4.4, pz + tz * e * (len / 2 - 0.3)); dummy.rotation.set(0, th, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      posts.setMatrixAt(k * 2 + (e > 0 ? 1 : 0), dummy.matrix);
    }
    const [cx, cz] = at(b.off + TIER);
    w.colliders.addBox(cx, cz, TIER * 1.5, len / 2, th);
    w.blocked.push({ x: cx, z: cz, r: len / 2 + 6 });
  });
  finish(w, ...tiers, roof, posts);
}

function floodlights(w) {
  const t = w.track, ids = [];
  for (let f = 0.02; f < 1; f += 0.07) ids.push([t.at(f), -1]);
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.5, metalness: 0.7 });
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.95, 0.8).multiplyScalar(3) });
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.55, 36, 8), metal, ids.length);
  const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(7, 1.4, 2.6), glow, ids.length);
  ids.forEach(([i, side], k) => {
    const off = w.half + 32, x = t.px[i] - t.tz[i] * side * off, z = t.pz[i] + t.tx[i] * side * off, th = Math.atan2(t.tx[i], t.tz[i]);
    dummy.scale.set(1, 1, 1); dummy.rotation.set(0, th, 0);
    dummy.position.set(x, 18, z); dummy.updateMatrix(); poles.setMatrixAt(k, dummy.matrix);
    dummy.position.set(x, 36.6, z); dummy.updateMatrix(); heads.setMatrixAt(k, dummy.matrix);
    w.colliders.addCircle(x, z, 0.8); w.blocked.push({ x, z, r: 6 });
  });
  poles.castShadow = true; [poles, heads].forEach((m) => { m.frustumCulled = false; w.group.add(m); });
}

// ---- Frostbite Pass ------------------------------------------------------------------------------------------
/** Falling snow: every flake is placed in the shader, wrapped in a box that follows the camera, so no per-frame CPU work. */
function snowfall(w) {
  const N = 2400, pos = new Float32Array(N * 3), seed = new Float32Array(N), BOX = new THREE.Vector3(90, 42, 90);
  for (let i = 0; i < N; i++) { pos.set([Math.random() * BOX.x, Math.random() * BOX.y, Math.random() * BOX.z], i * 3); seed[i] = Math.random(); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { time: { value: 0 }, cam: { value: new THREE.Vector3() }, box: { value: BOX } },
    vertexShader: `uniform float time; uniform vec3 cam, box; attribute float seed; varying float vA;
      void main(){
        vec3 p = position; p.y -= time * (2.2 + seed * 2.0); p.x += time * 1.4 + sin(time * 0.7 + seed * 40.0) * 1.2; p.z += cos(time * 0.5 + seed * 30.0) * 1.0;
        vec3 q = mod(p - cam + 0.5 * box, box) - 0.5 * box;
        vec4 mv = viewMatrix * vec4(cam + q, 1.0);
        vA = smoothstep(46.0, 30.0, length(q));
        gl_PointSize = clamp(150.0 * (0.5 + seed) / -mv.z, 1.5, 6.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(1.0, 1.0, 1.0, vA * smoothstep(0.5, 0.15, d) * 0.9); }`,
  });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; w.group.add(pts);
  w.dyn.push((camPos, dt) => { mat.uniforms.time.value += dt; mat.uniforms.cam.value.copy(camPos); });
}

export const PROPS = { water, containers, cranes, dunes, rocks, cacti, grandstands, floodlights, snowfall };
