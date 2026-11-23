import * as THREE from 'three';
import { Track } from './Track.js';
import { Terrain } from './terrain.js';
import { Colliders } from '../physics/Collision.js';
import { roadTex, kerbTex, grassTex, checkerTex, windowTex, signTex } from './textures.js';
import { PROPS } from './Scenery.js';
import { mulberry32 } from '../utils.js';

const dummy = new THREE.Object3D();
const rnd = (rng, [a, b]) => a + rng() * (b - a);

/** One playable map: lights, sky, ground, road, barriers and scenery, all driven by a definition from maps.js. */
export class World {
  constructor(map, track = new Track(map)) {
    const th = (this.theme = map.theme);
    this.map = map; this.track = track; this.roadWidth = track.roadWidth; this.half = this.roadWidth / 2;
    this.barrierOff = this.half + 3.4; this.bounds = track.bounds;
    this.terrain = new Terrain(track, map.elev); // road height profile + ground queries (shared with the vehicle physics)
    this.group = new THREE.Group(); this.colliders = new Colliders();
    this.rng = mulberry32(map.seed ?? 7); this.blocked = []; this.dyn = [];
    this.horizon = new THREE.Color(th.sky.horizon);
    this.sunDir = new THREE.Vector3(...th.sun.dir).normalize();
    this._lights(); this._sky(); this._ground(); this._road(); if (!this.terrain.flat) { this._banks(); this._ramps(); } this._barriers();
    if (th.lamp) this._lamps();
    this._gantry(); this._signs();
    if (th.buildings) this._buildings();
    if (th.trees?.count) this._trees();
    if (th.mountains?.count) this._mountains();
    for (const p of map.props ?? []) PROPS[p]?.(this);
  }

  update(carPos, camPos, dt = 0) {
    this.sun.position.copy(carPos).addScaledVector(this.sunDir, 120);
    this.sun.target.position.copy(carPos);
    this.skyMesh.position.copy(camPos);
    for (const f of this.dyn) f(camPos, dt);
  }

  /** Free GPU memory when switching maps. */
  dispose() {
    this.group.traverse((o) => {
      o.geometry?.dispose?.();
      if (o.isInstancedMesh) o.dispose();
      for (const m of [].concat(o.material || [])) {
        for (const k in m) if (m[k]?.isTexture) m[k].dispose();
        m.dispose();
      }
    });
    this.sun.shadow.map?.dispose(); this.sun.dispose?.();
  }

  _lights() {
    const th = this.theme;
    this.group.add(new THREE.HemisphereLight(th.hemi.sky, th.hemi.ground, th.hemi.intensity));
    const sun = this.sun = new THREE.DirectionalLight(th.sun.color, th.sun.intensity);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 320 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
    this.group.add(sun, sun.target);
  }

  _sky() {
    const s = this.theme.sky;
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(s.top) }, hor: { value: this.horizon.clone() }, sun: { value: this.sunDir.clone() },
        glowCol: { value: new THREE.Vector3(...s.glow) }, discCol: { value: new THREE.Vector3(...s.disc) }, stars: { value: s.stars || 0 },
      },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top,hor,sun,glowCol,discCol; uniform float stars; varying vec3 vD;
        void main(){ vec3 d=normalize(vD); float h=d.y;
          vec3 c=mix(hor,top,pow(clamp(h,0.0,1.0),0.45)); c=mix(c,hor*0.9,smoothstep(0.0,-0.12,h));
          float s=max(dot(d,sun),0.0);
          c+=glowCol*pow(s,5.0)*0.55+discCol*pow(s,350.0)*10.0;
          if(stars>0.0){ vec3 q=floor(d*220.0); float n=fract(sin(dot(q,vec3(12.9898,78.233,37.719)))*43758.5453);
            c+=vec3(0.9,0.95,1.0)*step(0.9972,n)*stars*smoothstep(0.05,0.35,h); }
          gl_FragColor=vec4(c,1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.skyMesh = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 16), mat);
    this.skyMesh.frustumCulled = false; this.skyMesh.renderOrder = -1;
    this.group.add(this.skyMesh);
  }

  _ground() {
    const g = this.theme.ground;
    this.groundMat = new THREE.MeshStandardMaterial({ map: grassTex(g.base, g.speck), roughness: 1 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), this.groundMat);
    m.receiveShadow = true; this.group.add(m);
  }

  /** Centre-line station k (0..n*sub): position, unit tangent and road height. Sub-sampled on elevated maps so ramp lips stay sharp. */
  _station(i, sub) {
    const t = this.track, n = t.n, kk = Math.floor(i / sub), f = (i % sub) / sub, a = kk % n, b = (kk + 1) % n;
    let tx = t.tx[a] + (t.tx[b] - t.tx[a]) * f, tz = t.tz[a] + (t.tz[b] - t.tz[a]) * f; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    return { x: t.px[a] + (t.px[b] - t.px[a]) * f, z: t.pz[a] + (t.pz[b] - t.pz[a]) * f, tx, tz, y: this.terrain.flat ? 0 : this.terrain.profile((kk + f) * t.ds) };
  }

  _strip(d0, d1, yOff, mat) {
    const t = this.track, n = t.n, sub = this.terrain.flat ? 1 : 4, N = n * sub, vLen = t.length / Math.round(t.length / 12), dd = t.ds / sub;
    const pos = new Float32Array((N + 1) * 6), uv = new Float32Array((N + 1) * 4), idx = [];
    let dist = 0;
    for (let i = 0; i <= N; i++) {
      const st = this._station(i, sub), rx = -st.tz, rz = st.tx, y = st.y + yOff;
      pos.set([st.x + rx * d0, y, st.z + rz * d0, st.x + rx * d1, y, st.z + rz * d1], i * 6);
      uv.set([0, dist / vLen, 1, dist / vLen], i * 4); dist += dd;
      if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; this.group.add(m);
  }

  /** Embankments: grass slopes that carry an elevated road down to the ground on both sides (and the run-off between kerb and barrier). */
  _banks() {
    const T = this.terrain, t = this.track, sub = 4, N = t.n * sub, H = this.half, B = this.barrierOff, K = [0, 0.12, 0.3, 0.5, 0.7, 0.85, 1];
    const mat = this.groundMat.clone(); Object.assign(mat, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    for (const side of [-1, 1]) {
      const rows = K.length + 1, pos = new Float32Array((N + 1) * rows * 3), uv = new Float32Array((N + 1) * rows * 2), idx = [], hi = new Float32Array(N + 1);
      for (let i = 0; i <= N; i++) {
        const st = this._station(i, sub), rx = -st.tz * side, rz = st.tx * side, w = T.shoulder(st.y); hi[i] = st.y;
        for (let r = 0; r < rows; r++) {
          const d = r === 0 ? H + 1.2 : B + K[r - 1] * w, y = d <= B ? st.y : T.bank(st.y, d), x = st.x + rx * d, z = st.z + rz * d, o = (i * rows + r);
          pos.set([x, y - (d <= B ? 0.01 : 0), z], o * 3); uv.set([x / 4000 + 0.5, 0.5 - z / 4000], o * 2);
        }
        if (i < N) for (let r = 0; r < rows - 1; r++) {
          if (Math.max(hi[i], T.profile(((i + 1) / sub) * t.ds)) < 0.02) continue; // flat stretch: the ground plane already covers it
          const a = i * rows + r, b = a + rows;
          if (side > 0) idx.push(a, a + 1, b + 1, a, b + 1, b); else idx.push(a, b + 1, a + 1, a, b, b + 1); // winding flips with the side so both face up
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; m.frustumCulled = false; this.group.add(m);
    }
  }

  /** Hazard stripes painted along each ramp's lip so jumps can be spotted from a distance. */
  _ramps() {
    const E = this.terrain.elev, t = this.track, L = t.length, mat = new THREE.MeshStandardMaterial({ map: kerbTex('#f2c230', '#161616'), roughness: 0.6, emissive: 0x332600, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    mat.map.repeat.set(1, 1);
    const put = (s0, len, h) => { // stripe over the last 1.8 m of a ramp that climbs h over len, starting at arc length s0
      const w = 1.8, sc = s0 + len - w / 2, i = Math.round(((sc % L) + L) % L / t.ds) % t.n, tx = t.tx[i], tz = t.tz[i], y = h * (1 - w / 2 / len) + 0.07;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(this.roadWidth, w).rotateX(-Math.PI / 2), mat);
      m.rotation.order = 'YXZ'; m.rotation.set(-Math.atan2(h, len), Math.atan2(tx, tz), 0); m.position.set(t.px[i], y, t.pz[i]); m.receiveShadow = true; this.group.add(m);
    };
    for (const f of E.kickers ?? []) put(f.at * L, f.len, f.h);
    for (const f of E.tables ?? []) put(f.at * L, f.up, f.h);
  }

  _road() {
    const th = this.theme, H = this.half, po = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
    this._strip(-H, H, 0.04, new THREE.MeshStandardMaterial({ map: roadTex(th.road), roughness: th.road.roughness ?? 0.85, ...po }));
    const kerb = new THREE.MeshStandardMaterial({ map: kerbTex(th.kerb[0], th.kerb[1]), roughness: 0.7, ...po });
    kerb.map.repeat.set(1, 1);
    this._strip(H, H + 1.2, 0.05, kerb);
    this._strip(-H - 1.2, -H, 0.05, kerb);
  }

  _barriers() {
    const t = this.track, T = this.terrain, step = T.flat ? 3 : 1, segs = [], B = this.barrierOff;
    for (const side of [-1, 1]) for (let i = 0; i < t.n; i += step) {
      const j = (i + step) % t.n;
      const ax = t.px[i] - t.tz[i] * side * B, az = t.pz[i] + t.tx[i] * side * B;
      const bx = t.px[j] - t.tz[j] * side * B, bz = t.pz[j] + t.tx[j] * side * B;
      const ya = T.roadAt(i), yb = i + step >= t.n ? T.roadAt(0) : T.roadAt(j), run = Math.hypot(bx - ax, bz - az);
      segs.push({ x: (ax + bx) / 2, z: (az + bz) / 2, len: run + 0.15, th: Math.atan2(bx - ax, bz - az), alt: (i / step) % 2, y: (ya + yb) / 2, pitch: -Math.max(-0.45, Math.min(0.45, Math.atan2(yb - ya, run))), y0: Math.min(ya, yb) - 0.4, y1: Math.max(ya, yb) + 0.9 });
    }
    const [ca, cb] = this.theme.barrier, bd = new THREE.Object3D(); bd.rotation.order = 'YXZ';
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.9, 6), new THREE.MeshStandardMaterial({ roughness: 0.6 }), segs.length);
    const a = new THREE.Color(ca), b = new THREE.Color(cb);
    segs.forEach((s, k) => {
      bd.position.set(s.x, 0.45 + s.y, s.z); bd.rotation.set(s.pitch, s.th, 0); bd.scale.set(1, 1, s.len / 6); bd.updateMatrix();
      mesh.setMatrixAt(k, bd.matrix); mesh.setColorAt(k, s.alt ? a : b);
      this.colliders.addBox(s.x, s.z, 0.3, s.len / 2, s.th, s.y0, s.y1);
    });
    mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false; this.group.add(mesh);
  }

  _lamps() {
    const t = this.track, L = this.theme.lamp, ids = [], step = Math.max(6, Math.round(L.spacing / t.ds));
    for (let i = 0, k = 0; i < t.n; i += step, k++) ids.push([i, k % 2 ? 1 : -1]);
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.5, metalness: 0.7 });
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(...L.glow).multiplyScalar(L.strength) });
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.17, 9, 8), metal, ids.length);
    const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 0.12, 0.14), metal, ids.length);
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.12, 0.35), glow, ids.length);
    ids.forEach(([i, side], k) => {
      const tx = t.tx[i], tz = t.tz[i], rx = -tz * side, rz = tx * side, off = this.half + 7;
      const px = t.px[i] + rx * off, pz = t.pz[i] + rz * off, th = Math.atan2(-tx, -tz), gy = this.terrain.height(px, pz);
      dummy.scale.set(1, 1, 1); dummy.rotation.set(0, th, 0);
      dummy.position.set(px, 4.5 + gy, pz); dummy.updateMatrix(); poles.setMatrixAt(k, dummy.matrix);
      dummy.position.set(px - rx * 1.1, 9 + gy, pz - rz * 1.1); dummy.updateMatrix(); arms.setMatrixAt(k, dummy.matrix);
      dummy.position.set(px - rx * 2.1, 8.9 + gy, pz - rz * 2.1); dummy.updateMatrix(); heads.setMatrixAt(k, dummy.matrix);
      this.colliders.addCircle(px, pz, 0.3, gy, gy + 9);
    });
    poles.castShadow = true;
    [poles, arms, heads].forEach((m) => { m.frustumCulled = false; this.group.add(m); });
  }

  _gantry() {
    const t = this.track, i = 0, tx = t.tx[i], tz = t.tz[i], rx = -tz, rz = tx, th = Math.atan2(-tx, -tz), H = this.half, gy = this.terrain.roadAt(0);
    const dark = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.5, metalness: 0.6 });
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 8.4, 0.8), dark);
      post.position.set(t.px[i] + rx * s * (H + 1.8), 4.2 + gy, t.pz[i] + rz * s * (H + 1.8));
      post.castShadow = true; this.group.add(post);
      this.colliders.addCircle(post.position.x, post.position.z, 0.6);
    }
    const sign = new THREE.MeshStandardMaterial({ map: signTex('APEX DRIVE', '#c8101e'), emissiveMap: null, roughness: 0.5 });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(this.roadWidth + 5, 1.7, 0.7), [dark, dark, dark, dark, sign, sign]);
    beam.position.set(t.px[i], 8 + gy, t.pz[i]); beam.rotation.y = th; beam.castShadow = true; this.group.add(beam);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(this.roadWidth, 2).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: checkerTex(), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    line.material.map.repeat.set(1, 1);
    line.position.set(t.px[i], 0.06 + gy, t.pz[i]); line.rotation.y = th; this.group.add(line);
  }

  _signs() {
    const t = this.track, defs = this.theme.signs, glow = this.theme.signGlow;
    defs.forEach(([txt, bg], k) => {
      const i = t.at(0.1 + k * 0.2333), side = k % 2 ? 1 : -1, off = this.half + 15;
      const tx = t.tx[i], tz = t.tz[i], x = t.px[i] - tz * side * off, z = t.pz[i] + tx * side * off, gy = this.terrain.height(x, z);
      const dark = new THREE.MeshStandardMaterial({ color: 0x20232a, roughness: 0.6 });
      const tex = signTex(txt, bg);
      const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, ...(glow ? { emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: glow } : {}) });
      const board = new THREE.Mesh(new THREE.BoxGeometry(14, 4.4, 0.4), [dark, dark, dark, dark, face, dark]);
      board.position.set(x, 5.2 + gy, z); board.rotation.y = Math.atan2(-tz, tx) + (side > 0 ? Math.PI : 0);
      board.castShadow = true; this.group.add(board);
      for (const s of [-1, 1]) {
        const px = x + tx * s * 5, pz = z + tz * s * 5;
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 3.2, 8), dark);
        post.position.set(px, 1.6 + gy, pz); post.castShadow = true; this.group.add(post);
        this.colliders.addCircle(px, pz, 0.3, gy, gy + 3.2);
      }
      this.blocked.push({ x, z, r: 9 });
    });
  }

  /** Placement area: the theme's explicit box if it has one (keeps the original map identical), else the track bounds + margin. */
  _area(explicit, margin) {
    const b = this.bounds;
    return explicit ?? { x: [b.x0 - margin, b.x1 + margin], z: [b.z0 - margin, b.z1 + margin] };
  }

  _buildings() {
    const rng = this.rng, t = this.track, B = this.theme.buildings, H = this.half, area = this._area(B.area, 190);
    const sets = B.lit.map(([base, lit]) => {
      const tex = windowTex(base, lit, rng, B.glow, B.face);
      return new THREE.MeshStandardMaterial({ map: tex.map, emissiveMap: tex.emissiveMap, emissive: 0xffffff, emissiveIntensity: B.emissive, roughness: 0.6, metalness: 0.2 });
    });
    const roof = new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.9 });
    const place = (x, z, w, d, h, solid) => {
      const geo = new THREE.BoxGeometry(w, h, d), uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ((w + d) / 2 / 12), uv.getY(i) * (h / 24));
      const side = sets[Math.floor(rng() * sets.length)], th = solid ? rng() * Math.PI : 0;
      const m = new THREE.Mesh(geo, [side, side, roof, roof, side, side]);
      m.position.set(x, h / 2, z); m.rotation.y = th; m.castShadow = m.receiveShadow = true; this.group.add(m);
      if (solid) { this.colliders.addBox(x, z, w / 2, d / 2, th); this.blocked.push({ x, z, r: Math.hypot(w, d) / 2 + 4 }); }
    };
    let placed = 0;
    const [xa, xb] = area.x, [za, zb] = area.z;
    for (let tries = 0; placed < B.solid && tries < 4000; tries++) {
      const x = xa + rng() * (xb - xa), z = za + rng() * (zb - za);
      if (t.nearest(x, z).dist < H + B.gap) continue;
      if (this.blocked.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + 26)) continue;
      place(x, z, 14 + rng() * 22, 14 + rng() * 22, B.h[0] + rng() * (B.h[1] - B.h[0]), true); placed++;
    }
    const [cx, cz] = B.center ?? [this.bounds.cx, this.bounds.cz];
    for (let k = 0; k < B.skyline; k++) { // distant skyline, no collision
      const a = rng() * Math.PI * 2, r = (B.skyRing ?? 650) + rng() * 350;
      place(cx + Math.cos(a) * r, cz + Math.sin(a) * r, 30 + rng() * 40, 30 + rng() * 40, B.sky[0] + rng() * (B.sky[1] - B.sky[0]), false);
    }
  }

  _trees() {
    const rng = this.rng, t = this.track, T = this.theme.trees, N = T.count, spots = [], H = this.half, area = this._area(T.area, 200);
    const [xa, xb] = area.x, [za, zb] = area.z;
    for (let tries = 0; spots.length < N && tries < 6000; tries++) {
      const x = xa + rng() * (xb - xa), z = za + rng() * (zb - za);
      if (t.nearest(x, z).dist < H + 10) continue;
      if (this.blocked.some((b) => Math.hypot(b.x - x, b.z - z) < b.r)) continue;
      spots.push([x, z, 0.8 + rng() * 0.9, this.terrain.height(x, z)]);
    }
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.34, 2.4, 6), new THREE.MeshStandardMaterial({ color: 0x4b3424, roughness: 1 }), spots.length);
    const fol = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true });
    const low = new THREE.InstancedMesh(new THREE.ConeGeometry(2.3, 4.2, 7), fol, spots.length);
    const high = new THREE.InstancedMesh(new THREE.ConeGeometry(1.7, 3.6, 7), fol, spots.length);
    const base = T.palette.map((c) => new THREE.Color(c)), rare = T.rare != null ? new THREE.Color(T.rare) : null, all = rare ? [...base, rare] : base;
    const white = new THREE.Color(0xf4f8fc), cap = new THREE.Color();
    spots.forEach(([x, z, s, gy], k) => {
      dummy.rotation.set(0, rng() * 6, 0); dummy.scale.setScalar(s);
      dummy.position.set(x, gy + 1.2 * s, z); dummy.updateMatrix(); trunk.setMatrixAt(k, dummy.matrix);
      dummy.position.set(x, gy + 4.0 * s, z); dummy.updateMatrix(); low.setMatrixAt(k, dummy.matrix);
      dummy.position.set(x, gy + 6.3 * s, z); dummy.updateMatrix(); high.setMatrixAt(k, dummy.matrix);
      const c = all[Math.floor(rng() * (rng() < 0.12 ? all.length : base.length))];
      low.setColorAt(k, c);
      high.setColorAt(k, T.snow ? cap.copy(c).lerp(white, T.snow) : c); // snow-covered upper boughs
      this.colliders.addCircle(x, z, 0.5 * s, gy, gy + 8 * s);
    });
    [trunk, low, high].forEach((m) => { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; this.group.add(m); });
  }

  _mountains() {
    const rng = this.rng, M = this.theme.mountains, [cx, cz] = M.center ?? [this.bounds.cx, this.bounds.cz];
    const mat = new THREE.MeshStandardMaterial({ color: M.snow ? 0xffffff : M.color, roughness: 1, flatShading: true, vertexColors: !!M.snow });
    for (let k = 0; k < M.count; k++) {
      const a = (k / M.count) * Math.PI * 2 + rng() * 0.2, r = M.ring + rng() * 150, h = M.h[0] + rng() * (M.h[1] - M.h[0]);
      const rad = M.kind === 'hill' ? 220 + rng() * 200 : 130 + rng() * 140, seg = 6 + Math.floor(rng() * 3);
      const geo = M.kind === 'mesa' ? new THREE.CylinderGeometry(rad * 0.55, rad * 1.1, h, seg) : new THREE.ConeGeometry(rad, h, seg);
      if (M.snow) { // dark rock below, snow above ~35% of the height
        const rock = new THREE.Color(M.color), snow = new THREE.Color(0xf2f6fb), pos = geo.attributes.position, c = new Float32Array(pos.count * 3), tmp = new THREE.Color();
        for (let v = 0; v < pos.count; v++) { tmp.copy(rock).lerp(snow, Math.min(1, Math.max(0, (pos.getY(v) / h + 0.5 - 0.3) / 0.15))); c.set([tmp.r, tmp.g, tmp.b], v * 3); }
        geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
      }
      const m = new THREE.Mesh(geo, mat);
      m.position.set(cx + Math.cos(a) * r, h / 2 - 5, cz + Math.sin(a) * r); m.rotation.y = rng() * 3; this.group.add(m);
    }
  }
}
