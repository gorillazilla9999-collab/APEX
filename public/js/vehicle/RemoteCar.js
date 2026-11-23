import * as THREE from 'three';
import { CarModel } from './CarModel.js';
import { getCar } from './cars.js';
import { damp } from '../utils.js';
import { NetBuffer } from './NetBuffer.js';

function makeTag(text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d'); g.font = '700 30px "Segoe UI",Arial,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.75)'; g.strokeText(text, 128, 32); g.fillStyle = '#fff'; g.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false, depthWrite: false }));
  sp.scale.set(4.4, 1.1, 1); sp.position.y = 2.7; sp.renderOrder = 10;
  return sp;
}

/** A networked player's car: buffers snapshots and plays them back smoothly. */
export class RemoteCar {
  constructor(scene, { id, name, color, car }) {
    this.id = id; this.carId = car; this.scene = scene; this.name = name; this.color = color;
    this.car = new CarModel({ color, beams: false, style: getCar(car).style });
    this.tag = makeTag(name); this.car.root.add(this.tag);
    scene.add(this.car.root); this.car.root.visible = false;
    this.nb = new NetBuffer(); // timestamped snapshot buffer + interpolation (see NetBuffer.js)
    this.v = { x: 0, z: 0, y: 0, q: null, airborne: false, heading: 0, vx: 0, vz: 0, vF: 0, speed: 0, steer: 0, longAccel: 0, latAccel: 0,
      yawRate: 0, braking: false, handbrake: false, nitroActive: false, sliding: false, onGrass: false };
    this.away = false;
  }
  /** Forget buffered positions (race start / teleport) so the car doesn't glide in from where it last was. */
  reset() { this.nb = new NetBuffer(); this.car.root.visible = false; }
  push(s, now) { this.nb.push(s, now); this.away = !!s.away; }
  /** Returns the interpolated vehicle-like state (also drives smoke emission). */
  update(dt, now) {
    const v = this.v, s = this.nb.sample(now);
    if (!s) return v;
    const first = !this.car.root.visible;
    const prevVF = v.vF;
    v.x = s.x; v.z = s.z; v.y = s.y ?? 0; v.q = s.q ?? null; v.heading = s.h; v.vx = s.vx; v.vz = s.vz;
    v.vF = s.vx * Math.sin(s.h) + s.vz * Math.cos(s.h);
    v.speed = Math.hypot(s.vx, s.vz);
    v.steer = s.st; v.yawRate = s.yr;
    const f = s.f;
    v.braking = !!(f & 1); v.handbrake = !!(f & 2); v.nitroActive = !!(f & 4); v.sliding = !!(f & 8); v.onGrass = !!(f & 16); v.airborne = !!(f & 32);
    if (dt > 0 && !first) v.longAccel = damp(v.longAccel, (v.vF - prevVF) / dt, 10, dt);
    v.latAccel = damp(v.latAccel, -v.yawRate * v.vF, 10, dt);
    this.car.root.visible = !this.away;
    this.car.update(dt, v);
    return v;
  }
  dispose() { this.tag.material.map.dispose(); this.tag.material.dispose(); this.car.dispose(); }
}
