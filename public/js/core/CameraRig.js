import * as THREE from 'three';
import { clamp, damp, angleDiff } from '../utils.js';

export class CameraRig {
  constructor(camera) {
    this.cam = camera; this.yaw = 0; this.fov = 70; this.shake = 0; this.orbit = 0; this.t = 0;
    this.pos = new THREE.Vector3(); this.look = new THREE.Vector3();
    this.ground = null; // optional (x, z) => terrain height, keeps the camera out of hills
  }
  snap(v) { this.yaw = v.heading; this.pos.set(0, -100, 0); this._chase(v, 1, 0, 70, true); }

  addShake(a) { this.shake = Math.min(1, this.shake + a); }

  /** Slow showcase orbit used behind the main menu. */
  orbitAround(dt, v) {
    this.orbit += dt * 0.22;
    const r = 9.5, a = v.heading + 2.4 + this.orbit;
    const y = v.y ?? 0;
    this.cam.position.set(v.x + Math.sin(a) * r, y + 2.6 + Math.sin(this.orbit * 0.7) * 0.5, v.z + Math.cos(a) * r);
    this.cam.lookAt(v.x, y + 0.8, v.z);
    this.cam.fov = 45; this.cam.updateProjectionMatrix();
  }

  update(dt, v, fovBase, shakeOn) { this._chase(v, dt, 0, fovBase, false, shakeOn); }

  _chase(v, dt, _u, fovBase, snap = false, shakeOn = true) {
    this.t += dt;
    let desired = v.heading;
    if (v.speed > 6 && v.vF > 0) desired += angleDiff(Math.atan2(v.vx, v.vz), v.heading) * 0.45; // follow the slide a bit
    this.yaw += angleDiff(desired, this.yaw) * (snap ? 1 : 1 - Math.exp(-dt * 4.5));
    const k = clamp(v.speed / 70, 0, 1), dist = 7.2 + k * 2.6, height = 2.5 + k * 0.5;
    const sx = Math.sin(this.yaw), sz = Math.cos(this.yaw);
    const tx = v.x - sx * dist, tz = v.z - sz * dist;
    const a = snap ? 1 : 1 - Math.exp(-dt * 12);
    this.pos.x += (tx - this.pos.x) * a; this.pos.z += (tz - this.pos.z) * a;
    const vy = v.y ?? 0;
    this.pos.y += (vy + height - this.pos.y) * (snap ? 1 : 1 - Math.exp(-dt * (v.airborne ? 3 : 6)));
    this.look.set(v.x + sx * 5, vy + 1.1, v.z + sz * 5);

    const targetFov = fovBase + v.speed * 0.12 + (v.nitroActive ? 9 : 0);
    this.fov = snap ? targetFov : damp(this.fov, targetFov, 4, dt);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const amp = shakeOn ? this.shake * 0.35 + (v.nitroActive ? 0.03 : 0) + (v.onGrass ? v.speed * 0.0008 : 0) : 0;
    const floor = this.ground ? this.ground(this.pos.x, this.pos.z) + 0.9 : -1e9; // never dip below the hill behind the car
    if (this.pos.y < floor) this.pos.y = floor;
    this.cam.position.set(this.pos.x + (Math.random() - 0.5) * amp, this.pos.y + (Math.random() - 0.5) * amp, this.pos.z + (Math.random() - 0.5) * amp);
    this.cam.lookAt(this.look);
    this.cam.fov = this.fov; this.cam.updateProjectionMatrix();
  }
}
