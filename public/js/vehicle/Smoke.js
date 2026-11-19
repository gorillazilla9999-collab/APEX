import * as THREE from 'three';

/** Pooled sprite particles used for tyre smoke and off-road dust. */
export class Smoke {
  constructor(scene, n = 140) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    this.i = 0; this.p = [];
    for (let k = 0; k < n; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false; scene.add(s);
      this.p.push({ s, on: false, age: 0, life: 1, vx: 0, vy: 0, vz: 0, size: 1, op: 1 });
    }
  }
  emit(x, y, z, vx, vz, color, size, life, op) {
    const p = this.p[this.i++ % this.p.length];
    Object.assign(p, { on: true, age: 0, life, vx, vy: 0.6 + Math.random() * 0.6, vz, size, op });
    p.s.position.set(x, y, z); p.s.material.color.set(color); p.s.visible = true;
  }
  update(dt) {
    for (const p of this.p) {
      if (!p.on) continue;
      p.age += dt; const t = p.age / p.life;
      if (t >= 1) { p.on = false; p.s.visible = false; continue; }
      p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
      p.s.scale.setScalar(p.size * (1 + t * 2.6));
      p.s.material.opacity = p.op * (1 - t) * (1 - t);
    }
  }
}
