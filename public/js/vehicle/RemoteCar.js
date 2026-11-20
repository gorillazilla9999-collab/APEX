import * as THREE from 'three';
import { CarModel } from './CarModel.js';
import { getCar } from './cars.js';
import { angleDiff, damp } from '../utils.js';

const DELAY = 0.12; // render remote cars this many seconds in the past so we always have two snapshots to blend

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
    this.id = id; this.scene = scene; this.name = name; this.color = color;
    this.car = new CarModel({ color, beams: false, style: getCar(car).style });
    this.tag = makeTag(name); this.car.root.add(this.tag);
    scene.add(this.car.root); this.car.root.visible = false;
    this.buf = []; // {t (local seconds), x, z, h, vx, vz, st, yr, f}
    this.v = { x: 0, z: 0, heading: 0, vx: 0, vz: 0, vF: 0, speed: 0, steer: 0, longAccel: 0, latAccel: 0,
      yawRate: 0, braking: false, handbrake: false, nitroActive: false, sliding: false, onGrass: false };
    this.away = false;
  }
  push(s, now) {
    const last = this.buf[this.buf.length - 1];
    if (last && Math.hypot(s.x - last.x, s.z - last.z) > 25) this.buf.length = 0; // reset / respawn: snap, don't glide
    this.buf.push({ ...s, t: now }); if (this.buf.length > 30) this.buf.shift();
    this.away = !!s.away;
  }
  /** Returns the interpolated vehicle-like state (also drives smoke emission). */
  update(dt, now) {
    const b = this.buf, v = this.v;
    if (!b.length) return v;
    const rt = now - DELAY;
    let a = b[0], c = b[0];
    for (let i = b.length - 1; i >= 0; i--) { if (b[i].t <= rt) { a = b[i]; c = b[Math.min(i + 1, b.length - 1)]; break; } a = c = b[0]; }
    const k = c.t > a.t ? Math.min(1, Math.max(0, (rt - a.t) / (c.t - a.t))) : 0;
    const first = !this.car.root.visible;
    const x = a.x + (c.x - a.x) * k, z = a.z + (c.z - a.z) * k;
    const h = a.h + angleDiff(c.h, a.h) * k;
    const vx = a.vx + (c.vx - a.vx) * k, vz = a.vz + (c.vz - a.vz) * k;
    const prevVF = v.vF;
    v.x = x; v.z = z; v.heading = h; v.vx = vx; v.vz = vz;
    v.vF = vx * Math.sin(h) + vz * Math.cos(h);
    v.speed = Math.hypot(vx, vz);
    v.steer = a.st + (c.st - a.st) * k; v.yawRate = a.yr + (c.yr - a.yr) * k;
    const f = c.f;
    v.braking = !!(f & 1); v.handbrake = !!(f & 2); v.nitroActive = !!(f & 4); v.sliding = !!(f & 8); v.onGrass = !!(f & 16);
    if (dt > 0 && !first) v.longAccel = damp(v.longAccel, (v.vF - prevVF) / dt, 10, dt);
    v.latAccel = damp(v.latAccel, -v.yawRate * v.vF, 10, dt);
    this.car.root.visible = !this.away;
    this.car.update(dt, v);
    return v;
  }
  dispose() { this.tag.material.map.dispose(); this.tag.material.dispose(); this.car.dispose(); }
}
