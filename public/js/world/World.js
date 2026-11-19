import * as THREE from 'three';
import { Track, ROAD_WIDTH } from './Track.js';
import { Colliders } from '../physics/Collision.js';
import { roadTex, kerbTex, grassTex, checkerTex, windowTex, signTex } from './textures.js';
import { mulberry32 } from '../utils.js';

export const HORIZON = new THREE.Color(0xe39a6e);
export const SUN_DIR = new THREE.Vector3(0.75, 0.22, -0.5).normalize();
const HALF = ROAD_WIDTH / 2, BARRIER_OFF = HALF + 3.4;
const dummy = new THREE.Object3D();

export class World {
  constructor() {
    this.group = new THREE.Group();
    this.colliders = new Colliders();
    this.track = new Track();
    this.rng = mulberry32(7);
    this.blocked = [];
    this._lights(); this._sky(); this._ground(); this._road(); this._barriers();
    this._lamps(); this._gantry(); this._signs(); this._buildings(); this._trees(); this._mountains();
  }

  update(carPos, camPos) {
    this.sun.position.copy(carPos).addScaledVector(SUN_DIR, 120);
    this.sun.target.position.copy(carPos);
    this.skyMesh.position.copy(camPos);
  }

  _lights() {
    this.group.add(new THREE.HemisphereLight(0x9bb4e6, 0x5a4636, 0.9));
    const sun = this.sun = new THREE.DirectionalLight(0xffb27a, 3.0);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 320 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
    this.group.add(sun, sun.target);
  }

  _sky() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x1b3566) }, hor: { value: HORIZON.clone() }, sun: { value: SUN_DIR.clone() } },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top,hor,sun; varying vec3 vD;
        void main(){ vec3 d=normalize(vD); float h=d.y;
          vec3 c=mix(hor,top,pow(clamp(h,0.0,1.0),0.45)); c=mix(c,hor*0.9,smoothstep(0.0,-0.12,h));
          float s=max(dot(d,sun),0.0);
          c+=vec3(1.0,0.55,0.25)*pow(s,5.0)*0.55+vec3(1.0,0.82,0.55)*pow(s,350.0)*10.0;
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
    const g = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: grassTex(), roughness: 1 }));
    g.receiveShadow = true; this.group.add(g);
  }

  _strip(d0, d1, y, mat) {
    const t = this.track, n = t.n, vLen = t.length / Math.round(t.length / 12);
    const pos = new Float32Array((n + 1) * 6), uv = new Float32Array((n + 1) * 4), idx = [];
    let dist = 0;
    for (let i = 0; i <= n; i++) {
      const k = i % n, rx = -t.tz[k], rz = t.tx[k];
      pos.set([t.px[k] + rx * d0, y, t.pz[k] + rz * d0, t.px[k] + rx * d1, y, t.pz[k] + rz * d1], i * 6);
      uv.set([0, dist / vLen, 1, dist / vLen], i * 4); dist += t.ds;
      if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; this.group.add(m);
  }

  _road() {
    const po = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
    this._strip(-HALF, HALF, 0.04, new THREE.MeshStandardMaterial({ map: roadTex(), roughness: 0.85, ...po }));
    const kerb = new THREE.MeshStandardMaterial({ map: kerbTex(), roughness: 0.7, ...po });
    kerb.map.repeat.set(1, 1);
    this._strip(HALF, HALF + 1.2, 0.05, kerb);
    this._strip(-HALF - 1.2, -HALF, 0.05, kerb);
  }

  _barriers() {
    const t = this.track, step = 3, segs = [];
    for (const side of [-1, 1]) for (let i = 0; i < t.n; i += step) {
      const j = (i + step) % t.n;
      const ax = t.px[i] - t.tz[i] * side * BARRIER_OFF, az = t.pz[i] + t.tx[i] * side * BARRIER_OFF;
      const bx = t.px[j] - t.tz[j] * side * BARRIER_OFF, bz = t.pz[j] + t.tx[j] * side * BARRIER_OFF;
      segs.push({ x: (ax + bx) / 2, z: (az + bz) / 2, len: Math.hypot(bx - ax, bz - az) + 0.15, th: Math.atan2(bx - ax, bz - az), alt: (i / step) % 2 });
    }
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.9, 6), new THREE.MeshStandardMaterial({ roughness: 0.6 }), segs.length);
    const red = new THREE.Color(0xd21a1a), white = new THREE.Color(0xe6e6e6);
    segs.forEach((s, k) => {
      dummy.position.set(s.x, 0.45, s.z); dummy.rotation.set(0, s.th, 0); dummy.scale.set(1, 1, s.len / 6); dummy.updateMatrix();
      mesh.setMatrixAt(k, dummy.matrix); mesh.setColorAt(k, s.alt ? red : white);
      this.colliders.addBox(s.x, s.z, 0.3, s.len / 2, s.th);
    });
    mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false; this.group.add(mesh);
  }

  _lamps() {
    const t = this.track, ids = [];
    for (let i = 0, k = 0; i < t.n; i += 32, k++) ids.push([i, k % 2 ? 1 : -1]);
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.5, metalness: 0.7 });
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.82, 0.55).multiplyScalar(3) });
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.17, 9, 8), metal, ids.length);
    const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 0.12, 0.14), metal, ids.length);
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.12, 0.35), glow, ids.length);
    ids.forEach(([i, side], k) => {
      const tx = t.tx[i], tz = t.tz[i], rx = -tz * side, rz = tx * side, off = HALF + 7;
      const px = t.px[i] + rx * off, pz = t.pz[i] + rz * off, th = Math.atan2(-tx, -tz);
      dummy.scale.set(1, 1, 1); dummy.rotation.set(0, th, 0);
      dummy.position.set(px, 4.5, pz); dummy.updateMatrix(); poles.setMatrixAt(k, dummy.matrix);
      dummy.position.set(px - rx * 1.1, 9, pz - rz * 1.1); dummy.updateMatrix(); arms.setMatrixAt(k, dummy.matrix);
      dummy.position.set(px - rx * 2.1, 8.9, pz - rz * 2.1); dummy.updateMatrix(); heads.setMatrixAt(k, dummy.matrix);
      this.colliders.addCircle(px, pz, 0.3);
    });
    poles.castShadow = true;
    [poles, arms, heads].forEach((m) => { m.frustumCulled = false; this.group.add(m); });
  }

  _gantry() {
    const t = this.track, i = 0, tx = t.tx[i], tz = t.tz[i], rx = -tz, rz = tx, th = Math.atan2(-tx, -tz);
    const dark = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.5, metalness: 0.6 });
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 8.4, 0.8), dark);
      post.position.set(t.px[i] + rx * s * (HALF + 1.8), 4.2, t.pz[i] + rz * s * (HALF + 1.8));
      post.castShadow = true; this.group.add(post);
      this.colliders.addCircle(post.position.x, post.position.z, 0.6);
    }
    const sign = new THREE.MeshStandardMaterial({ map: signTex('APEX DRIVE', '#c8101e'), emissiveMap: null, roughness: 0.5 });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(ROAD_WIDTH + 5, 1.7, 0.7), [dark, dark, dark, dark, sign, sign]);
    beam.position.set(t.px[i], 8, t.pz[i]); beam.rotation.y = th; beam.castShadow = true; this.group.add(beam);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_WIDTH, 2).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: checkerTex(), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    line.material.map.repeat.set(1, 1);
    line.position.set(t.px[i], 0.06, t.pz[i]); line.rotation.y = th; this.group.add(line);
  }

  _signs() {
    const t = this.track, defs = [['TURBO', '#0b6bd1'], ['VELOCITY', '#c8101e'], ['NITRO+', '#e08a00'], ['APEX', '#14a05a']];
    defs.forEach(([txt, bg], k) => {
      const i = 90 + k * 210, side = k % 2 ? 1 : -1, off = HALF + 15;
      const tx = t.tx[i], tz = t.tz[i], x = t.px[i] - tz * side * off, z = t.pz[i] + tx * side * off;
      const dark = new THREE.MeshStandardMaterial({ color: 0x20232a, roughness: 0.6 });
      const face = new THREE.MeshStandardMaterial({ map: signTex(txt, bg), roughness: 0.55 });
      const board = new THREE.Mesh(new THREE.BoxGeometry(14, 4.4, 0.4), [dark, dark, dark, dark, face, dark]);
      board.position.set(x, 5.2, z); board.rotation.y = Math.atan2(-tz, tx) + (side > 0 ? Math.PI : 0);
      board.castShadow = true; this.group.add(board);
      for (const s of [-1, 1]) {
        const px = x + tx * s * 5, pz = z + tz * s * 5;
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 3.2, 8), dark);
        post.position.set(px, 1.6, pz); post.castShadow = true; this.group.add(post);
        this.colliders.addCircle(px, pz, 0.3);
      }
      this.blocked.push({ x, z, r: 9 });
    });
  }

  _buildings() {
    const rng = this.rng, t = this.track;
    const sets = [['#3a4150', 0.35], ['#2c3a4d', 0.5], ['#4a3f3a', 0.25]].map(([base, lit]) => {
      const tex = windowTex(base, lit, rng);
      return new THREE.MeshStandardMaterial({ map: tex.map, emissiveMap: tex.emissiveMap, emissive: 0xffffff, emissiveIntensity: 1.1, roughness: 0.6, metalness: 0.2 });
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
    for (let tries = 0; placed < 30 && tries < 4000; tries++) {
      const x = -460 + rng() * 940, z = -330 + rng() * 900;
      if (t.nearest(x, z).dist < HALF + 34) continue;
      if (this.blocked.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + 26)) continue;
      place(x, z, 14 + rng() * 22, 14 + rng() * 22, 14 + rng() * 40, true); placed++;
    }
    for (let k = 0; k < 40; k++) { // distant skyline, no collision
      const a = rng() * Math.PI * 2, r = 650 + rng() * 350;
      place(70 + Math.cos(a) * r, 200 + Math.sin(a) * r, 30 + rng() * 40, 30 + rng() * 40, 70 + rng() * 150, false);
    }
  }

  _trees() {
    const rng = this.rng, t = this.track, N = 520, spots = [];
    for (let tries = 0; spots.length < N && tries < 6000; tries++) {
      const x = -480 + rng() * 1000, z = -380 + rng() * 1000;
      if (t.nearest(x, z).dist < HALF + 10) continue;
      if (this.blocked.some((b) => Math.hypot(b.x - x, b.z - z) < b.r)) continue;
      spots.push([x, z, 0.8 + rng() * 0.9]);
    }
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.34, 2.4, 6), new THREE.MeshStandardMaterial({ color: 0x4b3424, roughness: 1 }), spots.length);
    const fol = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true });
    const low = new THREE.InstancedMesh(new THREE.ConeGeometry(2.3, 4.2, 7), fol, spots.length);
    const high = new THREE.InstancedMesh(new THREE.ConeGeometry(1.7, 3.6, 7), fol, spots.length);
    const palette = [0x2f6b2f, 0x3c7a34, 0x4a8a3a, 0x6f8a2c, 0xc9822b].map((c) => new THREE.Color(c));
    spots.forEach(([x, z, s], k) => {
      dummy.rotation.set(0, rng() * 6, 0); dummy.scale.setScalar(s);
      dummy.position.set(x, 1.2 * s, z); dummy.updateMatrix(); trunk.setMatrixAt(k, dummy.matrix);
      dummy.position.set(x, 4.0 * s, z); dummy.updateMatrix(); low.setMatrixAt(k, dummy.matrix);
      dummy.position.set(x, 6.3 * s, z); dummy.updateMatrix(); high.setMatrixAt(k, dummy.matrix);
      const c = palette[Math.floor(rng() * (rng() < 0.12 ? 5 : 4))];
      low.setColorAt(k, c); high.setColorAt(k, c);
      this.colliders.addCircle(x, z, 0.5 * s);
    });
    [trunk, low, high].forEach((m) => { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; this.group.add(m); });
  }

  _mountains() {
    const rng = this.rng, mat = new THREE.MeshStandardMaterial({ color: 0x353b5c, roughness: 1, flatShading: true });
    for (let k = 0; k < 26; k++) {
      const a = (k / 26) * Math.PI * 2 + rng() * 0.2, r = 1050 + rng() * 150, h = 90 + rng() * 170;
      const m = new THREE.Mesh(new THREE.ConeGeometry(130 + rng() * 140, h, 6 + Math.floor(rng() * 3)), mat);
      m.position.set(50 + Math.cos(a) * r, h / 2 - 5, 200 + Math.sin(a) * r); m.rotation.y = rng() * 3; this.group.add(m);
    }
  }
}
