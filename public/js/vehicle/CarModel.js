import * as THREE from 'three';
import { clamp } from '../utils.js';

const R = 0.34, W = 0.27; // wheel radius / width

class Spring {
  constructor() { this.x = 0; this.v = 0; }
  step(target, dt, k = 110, c = 12) { this.v += (k * (target - this.x) - c * this.v) * dt; this.x += this.v * dt; }
}

/** Extrude a side profile [z,y] into a body of given width (centred on x=0). */
function profile(pts, width, bev) {
  const s = new THREE.Shape();
  pts.forEach(([z, y], i) => (i ? s.lineTo(z, y) : s.moveTo(z, y)));
  const depth = width - 2 * bev;
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 3, steps: 1, curveSegments: 4 });
  g.translate(0, 0, -depth / 2); g.rotateY(-Math.PI / 2);
  return g;
}

export class CarModel {
  /**
   * opts.color: paint colour; opts.beams: headlight spotlights (disable for remote cars - they are costly);
   * opts.style: body shape from cars.js { len, hs, ws, wing, stripe } (length / height / width scale, rear wing size, livery stripe).
   */
  constructor({ color = 0xc8101e, beams = true, style = {} } = {}) {
    const { len = 1, hs = 1, ws = 1, wing = 1, stripe = null } = style;
    const HY = (y) => (y > 0.5 ? 0.46 + (y - 0.46) * hs : y); // squash / stretch everything above the sills
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.pitch = new Spring(); this.roll = new Spring(); this.heave = new Spring(); this.droop = new Spring(); this.pvy = 0; this.ay = 0;
    this.spin = 0; this.t = 0;

    const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.04 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.55, metalness: 0.3 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x07090d, metalness: 0.9, roughness: 0.06, clearcoat: 1 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 1, roughness: 0.18 });
    const head = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xcfe6ff, emissiveIntensity: 4 });
    this.tailMat = new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff0a14, emissiveIntensity: 1.2 });
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, parent = this.body) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x * ws, HY(y), z * len); m.rotation.set(rx, ry, 0); parent.add(m); return m;
    };
    const P = (pts) => pts.map(([z, y]) => [z * len, HY(y)]);
    const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

    // body + cabin
    add(profile(P([[-2.15, 0.46], [-2.15, 0.9], [-1.7, 0.98], [-1.2, 1.0], [0.9, 0.98], [1.55, 0.9], [2.1, 0.7], [2.14, 0.5]]), 1.86 * ws, 0.07), paint, 0, 0, 0);
    add(profile(P([[-1.2, 0.98], [-0.8, 1.46], [0.45, 1.46], [1.0, 0.98]]), 1.55 * ws, 0.03), glass, 0, 0, 0);
    add(box(1.45 * 1, 0.05, 1.2), paint, 0, 1.5, -0.17);
    for (const s of [-1, 1]) {
      add(box(0.07, 0.06, 0.73), paint, s * 0.77, 1.24, 0.725, 0.72);   // A pillars
      add(box(0.09, 0.06, 0.66), paint, s * 0.76, 1.24, -1.025, -0.82); // C pillars
      add(box(0.1, 0.12, 2.3), dark, s * 0.96, 0.46, 0.1);              // side skirts
      add(box(0.2, 0.12, 0.12), paint, s * 1.0, 1.12, 0.55);            // mirrors
      if (wing > 0) {
        add(box(0.05, 0.2, 0.46), dark, s * 0.86, 1.34 + (wing - 1) * 0.2, -2.0);   // wing end plates
        add(box(0.06, 0.3, 0.1), dark, s * 0.6, 1.1 + (wing - 1) * 0.2, -1.95);     // wing stands
      }
      add(box(0.55, 0.1, 0.1), head, s * 0.66, 0.62, 2.19);             // headlights
      add(box(0.3, 0.05, 0.08), head, s * 0.66, 0.5, 2.2);              // DRL
      add(box(0.5, 0.1, 0.06), this.tailMat, s * 0.62, 0.78, -2.24);    // tail lights
      const ex = add(new THREE.CylinderGeometry(0.07, 0.07, 0.3, 14), chrome, s * 0.45, 0.5, -2.2, Math.PI / 2); ex.castShadow = true;
    }
    add(box(1.9, 0.05, 0.4), dark, 0, 0.42, 2.25);                      // splitter
    add(box(1.0, 0.18, 0.05), dark, 0, 0.58, 2.27);                     // grille
    add(box(1.6, 0.14, 0.4), dark, 0, 0.5, -2.15);                      // diffuser
    if (wing > 0) add(box(1.75, 0.05, 0.44), dark, 0, 1.3 + (wing - 1) * 0.2, -2.0, 0.08); // wing
    else add(box(1.5, 0.05, 0.3), paint, 0, 1.0, -2.0, 0.12);           // ducktail lip
    if (stripe != null) { // livery stripe: bonnet, roof, boot lid
      const st = new THREE.MeshStandardMaterial({ color: stripe, roughness: 0.35, metalness: 0.3 });
      add(box(0.34, 0.012, 0.75), st, 0, 1.0, 1.25, 0.06); add(box(0.34, 0.012, 1.15), st, 0, 1.53, -0.17); add(box(0.34, 0.012, 0.7), st, 0, 1.0, -1.55, -0.04);
    }
    add(box(0.4, 0.04, 0.8), dark, 0, 1.02, 1.1);                       // bonnet vent
    add(box(0.55, 0.06, 0.06), this.tailMat, 0, 0.78, -2.25);           // centre tail strip
    this.body.traverse((o) => { if (o.isMesh) o.castShadow = true; });

    // headlight beams
    this.beams = [];
    for (const s of beams ? [-1, 1] : []) {
      const sp = new THREE.SpotLight(0xfff0d8, 40, 70, 0.5, 0.6, 1);
      sp.position.set(s * 0.66, 0.7, 2.1);
      const tg = new THREE.Object3D(); tg.position.set(s * 0.5, 0, 25);
      this.root.add(sp, tg); sp.target = tg; this.beams.push(sp);
    }

    // nitro flames
    const flameGeo = new THREE.ConeGeometry(0.1, 1, 10).translate(0, 0.5, 0).rotateX(-Math.PI / 2);
    const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.55, 1).multiplyScalar(3), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.flames = [-1, 1].map((s) => add(flameGeo, flameMat, s * 0.45, 0.5, -2.35, 0, 0, this.root));
    this.flames.forEach((f) => (f.visible = false));

    // wheels (outside the body pivot so they stay planted while the body rolls)
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x0f0f11, roughness: 0.92 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 1, roughness: 0.22 });
    const caliper = new THREE.MeshStandardMaterial({ color: 0xd01010, roughness: 0.4 });
    this.wheels = [];
    for (const [sx, z, front] of [[-1, 1.4, true], [1, 1.4, true], [-1, -1.35, false], [1, -1.35, false]]) {
      const pivot = new THREE.Group(); pivot.position.set(sx * 0.93 * ws, R, z * len);
      const spin = new THREE.Group(); pivot.add(spin);
      spin.add(new THREE.Mesh(new THREE.CylinderGeometry(R, R, W, 28).rotateZ(Math.PI / 2), tireMat));
      spin.add(new THREE.Mesh(new THREE.CylinderGeometry(R * 0.68, R * 0.68, W * 0.9, 24).rotateZ(Math.PI / 2), rimMat));
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.55, R * 0.55, 0.03, 20).rotateZ(Math.PI / 2), dark);
      disc.position.x = -sx * 0.06; spin.add(disc);
      for (let k = 0; k < 5; k++) {
        const sp = new THREE.Mesh(new THREE.BoxGeometry(0.04, R * 1.25, 0.06), chrome);
        sp.position.x = sx * W * 0.43; sp.rotation.x = (k * Math.PI) / 5; spin.add(sp);
      }
      const cal = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.2), caliper); cal.position.set(-sx * 0.04, R * 0.38, 0); pivot.add(cal);
      const arch = new THREE.Mesh(new THREE.TorusGeometry(R + 0.09, 0.045, 8, 20, Math.PI).rotateY(Math.PI / 2), dark);
      arch.position.set(sx * 0.93 * ws, R, z * len); this.body.add(arch);
      pivot.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.root.add(pivot); this.wheels.push({ pivot, spin, front });
    }
  }

  dispose() {
    this.root.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); [].concat(o.material).forEach((m) => m.dispose()); } });
    this.root.removeFromParent();
  }

  bump(strength) { this.heave.v -= clamp(strength, 0, 14) * 0.06; this.pitch.v += (Math.random() - 0.5) * strength * 0.02; }

  update(dt, v) {
    dt = Math.min(dt, 1 / 30); this.t += dt;
    this.root.position.set(v.x, v.y ?? 0, v.z);
    if (v.q) this.root.quaternion.set(v.q[0], v.q[1], v.q[2], v.q[3]); // full 3D orientation (slopes, jumps, flips)
    else this.root.rotation.y = v.heading;

    // suspension: pitch from accel/brake, roll from cornering, heave from bumps
    this.pitch.step(-clamp(v.longAccel, -16, 16) * 0.0042, dt);
    this.roll.step(-clamp(v.latAccel, -26, 26) * 0.0042, dt);
    if (v.onGrass && v.speed > 3) this.heave.v += (Math.random() - 0.5) * v.speed * 0.012;
    // vertical loading: ramp entries / landings squash the suspension, crests unload it, and in the air the springs extend (wheels hang low)
    const vy = v.vy ?? 0, ay = clamp((vy - this.pvy) / dt, -40, 40); this.pvy = vy;
    this.ay += (ay - this.ay) * (1 - Math.exp(-dt * 18));
    this.heave.step(v.airborne ? 0 : -this.ay * 0.003, dt, 140, 11);
    this.droop.step(v.airborne ? 0.09 : 0, dt, 90, 9);
    this.body.rotation.set(this.pitch.x, 0, this.roll.x);
    this.body.position.y = this.heave.x + this.droop.x;

    // wheels: roll + front steer; rear locks under handbrake
    this.spin += (v.vF * dt) / R;
    for (const w of this.wheels) {
      if (!(v.handbrake && !w.front && v.speed > 1)) w.spin.rotation.x += (v.vF * dt) / R;
      w.pivot.rotation.y = w.front ? -v.steer : 0;
      w.pivot.position.y = R + (v.onGrass ? (Math.random() - 0.5) * 0.02 * Math.min(1, v.speed / 15) : 0);
    }

    this.tailMat.emissiveIntensity = v.braking || v.handbrake ? 6 : 1.2;
    const f = v.nitroActive ? 1 : 0;
    for (const fl of this.flames) {
      fl.visible = !!f;
      if (f) fl.scale.set(1, 1, 1.2 + Math.random() * 1.4);
    }
  }
}
