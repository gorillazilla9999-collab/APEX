import { clamp, lerp, damp } from '../utils.js';
import { collideVehicle } from './Collision.js';
import { dot, cross, norm, len, qYaw, qConj, qMul, qNorm, qRot, qFromBasis, qIntegrate, qDelta } from './rigid.js';

export const GRAVITY = 9.81;

// Axes: forward = (sin h, cos h), right = (-cos h, sin h). Steering > 0 = right.
export const TUNING = {
  wheelBase: 2.6, accel: 17, topSpeed: 60, nitroTopSpeed: 76, nitroMul: 1.75,
  brake: 30, reverseAccel: 8, reverseMax: 15, handbrakeDecel: 7,
  rolling: 0.45, drag: 0.0011, engineBrake: 1.6,
  maxSteer: 0.62, steerFalloff: 25, latGrip: 22, grip: 12, handbrakeGrip: 1.0,
  scrub: 0.22, nitroDuration: 4.5, nitroRecharge: 12,
};
export const SHIFT_UP = [14, 26, 38, 49, 59, 100]; // upper speed (m/s) of gears 1..6

// ---- rigid-body constants (body frame: +X left, +Y up, +Z forward; origin = centre of the four tyre contact patches) ----
const WL = 1.38, WH = 0.93;                  // half wheelbase / half track
const CL = [0, 0.55, 0.05];                  // centre of mass
const INV_I = [1 / 1.78, 1 / 1.91, 1 / 0.46]; // inverse inertia about body X (pitch), Y (yaw), Z (roll) for unit mass
const LIFT_TOL = 0.004;                      // how far the road must fall away from the ballistic path before the car leaves it (m)
// contact points: [x, y, z, kind]  kind 0 = tyre (rolls, grips sideways), 1 = bodywork (slides, crumples)
const PTS = [
  [-WH, 0, WL, 0], [WH, 0, WL, 0], [-WH, 0, -WL, 0], [WH, 0, -WL, 0],
  [-0.8, 0.5, 2.1, 1], [0.8, 0.5, 2.1, 1], [-0.8, 0.5, -2.1, 1], [0.8, 0.5, -2.1, 1],      // bumpers
  [-0.7, 1.48, 0.3, 1], [0.7, 1.48, 0.3, 1], [-0.7, 1.48, -0.7, 1], [0.7, 1.48, -0.7, 1],  // roof
  [-0.95, 0.95, 1.0, 1], [0.95, 0.95, 1.0, 1], [-0.95, 0.95, -1.0, 1], [0.95, 0.95, -1.0, 1], // flanks
];
const Y_UP = [0, 1, 0];

export class Vehicle {
  /** `tuning` = TUNING scaled per car (see vehicle/cars.js). */
  constructor(tuning = TUNING) { this.setTuning(tuning); this.reset(0, 0, 0); }

  setTuning(t) { this.T = t; this.SU = SHIFT_UP.map((v) => v * (t.topSpeed / TUNING.topSpeed)); }

  reset(x, z, heading, y = 0) {
    Object.assign(this, {
      x, z, heading, vx: 0, vz: 0, yawRate: 0, steer: 0,
      nitro: 1, nitroActive: false, nitroLocked: false, nitroDelay: 0,
      gear: 1, gearLabel: 'N', rpm: 1000, rpmNorm: 0, vF: 0, vR: 0, speed: 0,
      longAccel: 0, latAccel: 0, sliding: false, braking: false, reversing: false,
      handbrake: false, onGrass: false,
      // 3D state: y = height of the tyre contact plane under the car, q = orientation, mode 'ground' (arcade driving) or 'air' (rigid body)
      y, vy: 0, q: qYaw(heading), qd: [0, 0, 0, 1], w: [0, 0, 0], _wm: [0, 0, 0], c: [x, y, z],
      mode: 'ground', tumble: false, sF: 0, sR: 0, upY: 1, crashT: 0, needsReset: false, event: null, air: null, wheelsDown: 4,
    });
  }

  get speedKmh() { return this.speed * 3.6; }
  /** True while the wheels are off the ground (flying or tumbling). */
  get airborne() { return this.mode === 'air'; }
  /** True while the car is tumbling / crashed (rigid-body contact), as opposed to a controlled jump. */
  get crashed() { return this.mode === 'air' && this.tumble; }
  /** The last notable event since the previous call: { type: 'land' | 'crash', impact, air, dist, flipsPitch, flipsRoll } or null. */
  takeEvent() { const e = this.event; this.event = null; return e; }

  /** `terrain` (world/terrain.js) is optional: without it the car drives on a perfectly flat plane exactly as before. */
  update(dt, inp, onGrass = false, terrain = null) {
    if (!terrain) { this._drive(dt, inp, onGrass, 0, 0, true); this.y = 0; this.vy = 0; this.q = qYaw(this.heading); return; }
    if (this.mode === 'air') { this._drive(dt, inp, onGrass, 0, 0, false); this._air(dt, inp, terrain); }
    else { this._drive(dt, inp, onGrass, this.sF, this.sR, true); this._ground(dt, terrain); }
  }

  /** Static-obstacle collisions (walls, trees...). Handles the airborne body, whose state lives at its centre of mass. */
  collide(cols) {
    if (this.mode !== 'air') return collideVehicle(this, cols);
    const ox = this.x, oz = this.z; this.yawRate = 0;
    const impact = collideVehicle(this, cols);
    this.w[1] += this.yawRate; this.yawRate = 0;
    this.c[0] += this.x - ox; this.c[2] += this.z - oz;
    return impact;
  }

  // Arcade driving model (identical on the flat). `sF` / `sR` = road slope (rise per metre) along / across the car.
  // powered = false while airborne: only nitro, the steering wheel and the engine revs carry on.
  _drive(dt, inp, onGrass, sF, sR, powered) {
    const T = this.T, SU = this.SU;
    this.onGrass = onGrass;
    if (powered) this.heading += this.yawRate * dt;
    const h = this.heading;
    const fx = Math.sin(h), fz = Math.cos(h), rx = -Math.cos(h), rz = Math.sin(h);
    let vF = this.vx * fx + this.vz * fz;
    let vR = this.vx * rx + this.vz * rz;
    const prevVF = vF;
    const speed = Math.hypot(vF, vR);
    const throttle = inp.throttle ? 1 : 0, brake = inp.brake ? 1 : 0;
    this.handbrake = !!inp.handbrake;

    // --- Nitro ---
    if (this.nitroLocked && this.nitro > 0.25) this.nitroLocked = false;
    const wantNitro = inp.nitro && throttle > 0 && !this.nitroLocked && this.nitro > 0;
    this.nitroActive = wantNitro;
    if (wantNitro) {
      this.nitro = Math.max(0, this.nitro - dt / T.nitroDuration);
      this.nitroDelay = 1.2;
      if (this.nitro === 0) this.nitroLocked = true;
    } else {
      this.nitroDelay -= dt;
      if (this.nitroDelay <= 0) this.nitro = Math.min(1, this.nitro + dt / T.nitroRecharge);
    }

    // --- Steering: speed-dependent lock, smoothed ---
    const maxSteer = Math.max(0.07, T.maxSteer / (1 + Math.pow(speed / T.steerFalloff, 1.7)));
    this.steer = damp(this.steer, inp.steer * maxSteer, inp.steer === 0 ? 12 : 8, dt);

    // --- Gearbox / rpm ---
    const s = Math.abs(vF);
    while (this.gear < 6 && s > SU[this.gear - 1]) this.gear++;
    while (this.gear > 1 && s < SU[this.gear - 2] * 0.82) this.gear--;
    const lo = this.gear > 1 ? SU[this.gear - 2] * 0.78 : 0;
    const frac = clamp((s - lo) / (SU[this.gear - 1] - lo), 0, 1);
    let rpmTarget = 1100 + frac * 6300;
    if (this.gear === 1) rpmTarget = Math.max(rpmTarget, 1100 + throttle * 2600);

    if (!powered) { // wheels off the ground: the engine free-revs and nothing pushes the car
      this.rpm = damp(this.rpm, throttle ? Math.max(rpmTarget, 6800) : Math.min(rpmTarget, 3200), 7, dt);
      this.rpmNorm = clamp((this.rpm - 1000) / 7000, 0, 1);
      this.braking = false; this.reversing = false; this.sliding = false;
      this.vF = vF; this.vR = vR; this.speed = Math.hypot(this.vx, this.vz);
      this.longAccel = damp(this.longAccel, 0, 4, dt); this.latAccel = damp(this.latAccel, 0, 4, dt);
      this.gearLabel = String(this.gear);
      return;
    }
    this.rpm = damp(this.rpm, rpmTarget, 22, dt);
    this.rpmNorm = clamp((this.rpm - 1000) / 7000, 0, 1);

    // --- Longitudinal forces ---
    const top = this.nitroActive ? T.nitroTopSpeed : T.topSpeed;
    let aF = 0;
    this.braking = false; this.reversing = false;
    if (throttle > 0) {
      if (vF < -1) { aF += T.brake; this.braking = true; }
      else {
        let eng = T.accel * (1 - 0.4 * frac) * (1 - Math.pow(clamp(vF / top, 0, 1), 3));
        if (this.nitroActive) eng *= T.nitroMul;
        if (onGrass) eng *= 0.75;
        aF += eng;
      }
    }
    if (brake > 0) {
      if (vF > 1) { aF -= T.brake; this.braking = true; }
      else { aF -= T.reverseAccel * (1 - clamp(-vF / T.reverseMax, 0, 1)); this.reversing = true; }
    }
    if (this.handbrake) aF -= Math.sign(vF) * T.handbrakeDecel;
    if (sF) aF -= (GRAVITY * sF) / Math.sqrt(1 + sF * sF); // hills: gravity along the slope slows the climb, speeds the descent
    let res = T.rolling * (onGrass ? 4 : 1) + T.drag * vF * vF * (onGrass ? 2 : 1);
    if (!throttle && !brake) res += T.engineBrake;
    let nv = vF + aF * dt;
    const rdv = res * dt;
    nv = Math.abs(nv) <= rdv ? 0 : nv - Math.sign(nv) * rdv;
    vF = nv;

    // --- Lateral grip: handbrake, power-oversteer and slip-angle falloff create drifts ---
    if (sR) vR -= GRAVITY * sR * dt; // cross-slope (embankments): the car slides downhill
    let grip = T.grip * (onGrass ? 0.55 : 1);
    const slip = Math.atan2(Math.abs(vR), Math.abs(vF) + 0.5);
    if (this.handbrake && speed > 3) grip = T.handbrakeGrip;
    else if (throttle > 0 && speed > 18) {
      const k = clamp((Math.abs(this.steer) * speed - 4.5) / 4, 0, 1);
      grip *= 1 - 0.6 * k;
    }
    grip /= 1 + Math.pow(slip / 0.5, 2) * 0.6;
    const newVR = vR * Math.exp(-grip * dt);
    const lost = Math.abs(vR - newVR);
    vF -= Math.sign(vF) * Math.min(Math.abs(vF), lost * T.scrub);
    this.sliding = Math.abs(vR) > 3.2 && speed > 5;
    vR = newVR;

    // --- Yaw: bicycle model limited by lateral grip ---
    let maxYaw = Math.min(2.4, T.latGrip * (onGrass ? 0.7 : 1) / Math.max(Math.abs(vF), 5));
    let targetYaw = -(vF / T.wheelBase) * Math.tan(this.steer);
    if (this.handbrake && speed > 6) { targetYaw *= 1.45; maxYaw *= 1.5; }
    this.yawRate = damp(this.yawRate, clamp(targetYaw, -maxYaw, maxYaw), this.handbrake ? 5 : 9, dt);

    // --- Recompose world velocity and integrate ---
    this.vx = fx * vF + rx * vR;
    this.vz = fz * vF + rz * vR;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.vF = vF; this.vR = vR; this.speed = Math.hypot(vF, vR);

    this.longAccel = damp(this.longAccel, (vF - prevVF) / dt, 10, dt);
    this.latAccel = damp(this.latAccel, -this.yawRate * vF, 10, dt);
    this.gearLabel = vF < -0.5 ? 'R' : this.speed < 0.5 && !throttle ? 'N' : String(this.gear);
  }

  // ------------------------------------------------------------------------------------------------------------------
  // On the ground: follow the surface (4 tyre samples give height + pitch + roll) and leave it when the road falls away
  // faster than gravity can pull the car down (crests, kicker lips).
  // ------------------------------------------------------------------------------------------------------------------
  _plane(T) {
    const h = this.heading, fx = Math.sin(h), fz = Math.cos(h), rx = -Math.cos(h), rz = Math.sin(h), x = this.x, z = this.z;
    const hFR = T.height(x + fx * WL + rx * WH, z + fz * WL + rz * WH), hFL = T.height(x + fx * WL - rx * WH, z + fz * WL - rz * WH);
    const hRR = T.height(x - fx * WL + rx * WH, z - fz * WL + rz * WH), hRL = T.height(x - fx * WL - rx * WH, z - fz * WL - rz * WH);
    const hF = (hFR + hFL) / 2, hR = (hRR + hRL) / 2;
    return { gnd: (hF + hR) / 2, sF: (hF - hR) / (2 * WL), sR: (hFR + hRR - hFL - hRL) / (4 * WH) };
  }

  /** Orientation of a car sitting on a plane with the given slopes, pointing along `heading`. */
  _groundQ(sF, sR) {
    const h = this.heading, f0 = [Math.sin(h), 0, Math.cos(h)], r0 = [-Math.cos(h), 0, Math.sin(h)];
    const gx = sF * f0[0] + sR * r0[0], gz = sF * f0[2] + sR * r0[2], nl = Math.hypot(gx, 1, gz), u = [-gx / nl, 1 / nl, -gz / nl];
    const d = dot(f0, u), f = norm([f0[0] - u[0] * d, -u[1] * d, f0[2] - u[2] * d]);
    return qFromBasis(cross(u, f), u, f);
  }

  _ground(dt, T) {
    const p = this._plane(T); this.sF = p.sF; this.sR = p.sR;
    const vyb = this.vy - GRAVITY * dt, yb = this.y + vyb * dt; // where gravity alone would put the car
    if (yb > p.gnd + LIFT_TOL) { this._liftoff(yb, vyb); return; }
    this.vy = (p.gnd - this.y) / dt; this.y = p.gnd; // stay on the surface, moving with it
    // orientation: sit on the surface, plus a landing deviation that settles out quickly
    const a = 1 - Math.exp(-12 * dt), qd = this.qd;
    this.qd = qNorm([qd[0] * (1 - a), qd[1] * (1 - a), qd[2] * (1 - a), qd[3] + (1 - qd[3]) * a]);
    const qn = qNorm(qMul(this._groundQ(p.sF, p.sR), this.qd)), wm = qDelta(this.q, qn, dt), m = this._wm, k = 1 - Math.exp(-25 * dt);
    m[0] += (wm[0] - m[0]) * k; m[1] += (wm[1] - m[1]) * k; m[2] += (wm[2] - m[2]) * k;
    this.q = qn; this.upY = 1 - 2 * (qn[0] * qn[0] + qn[2] * qn[2]); this.crashT = 0;
  }

  _liftoff(yb, vyb) {
    this.mode = 'air'; this.tumble = false; this.y = yb; this.vy = vyb;
    this.w = this._wm.slice(); this.air = { t: 0, x0: this.x, z0: this.z, pitch: 0, roll: 0 };
    this._comFromOrigin(); this.wheelsDown = 0; this.clearT = 0;
  }

  // ------------------------------------------------------------------------------------------------------------------
  // In the air: a 3D rigid body (centre-of-mass position + velocity, quaternion + world angular velocity). Tyre, bumper,
  // roof and flank points are tested against the terrain; a wheels-first landing hands control back to the arcade model,
  // anything else becomes an impulse-based tumble.
  // ------------------------------------------------------------------------------------------------------------------
  _comFromOrigin() { const cw = qRot(this.q, CL); this.c = [this.x + cw[0], this.y + cw[1], this.z + cw[2]]; }
  _originFromCom() { const cw = qRot(this.q, CL), c = this.c; this.x = c[0] - cw[0]; this.y = c[1] - cw[1]; this.z = c[2] - cw[2]; }
  _iinv(v) { const l = qRot(qConj(this.q), v); return qRot(this.q, [l[0] * INV_I[0], l[1] * INV_I[1], l[2] * INV_I[2]]); }

  _air(dt, inp, T) {
    this.vy -= GRAVITY * dt; // gravity + aerodynamic drag
    const sp = Math.hypot(this.vx, this.vy, this.vz), kd = Math.max(0, 1 - this.T.drag * sp * dt);
    this.vx *= kd; this.vy *= kd; this.vz *= kd;
    const q = this.q, L = qRot(q, [1, 0, 0]), U = qRot(q, [0, 1, 0]), F = qRot(q, [0, 0, 1]);
    if (!this.tumble) this._airControl(dt, inp, L, U, F);
    const w = this.w, wd = Math.exp(-0.05 * dt); w[0] *= wd; w[1] *= wd; w[2] *= wd;
    if (this.air) { this.air.t += dt; this.air.pitch += dot(w, L) * dt; this.air.roll += dot(w, F) * dt; }
    this.q = qIntegrate(q, w, dt);
    const c = this.c; c[0] += this.vx * dt; c[1] += this.vy * dt; c[2] += this.vz * dt;
    this._originFromCom();
    this._contacts(dt, T);
    this._airSync();
  }

  /** Mid-air steering: W / S pitch (flip), A / D roll (barrel roll), handbrake levels the car out. */
  _airControl(dt, inp, L, U, F) {
    const w = this.w, pitchIn = (inp.throttle ? 1 : 0) - (inp.brake ? 1 : 0), roll = inp.steer || 0;
    const wl = dot(w, L), wf = dot(w, F);
    if (pitchIn) { const d = clamp(pitchIn * 4.2 - wl, -11 * dt, 11 * dt); w[0] += L[0] * d; w[1] += L[1] * d; w[2] += L[2] * d; }
    if (roll) { const d = clamp(roll * 4.8 - wf, -11 * dt, 11 * dt); w[0] += F[0] * d; w[1] += F[1] * d; w[2] += F[2] * d; }
    if (inp.handbrake) { // auto-level: upright, and stop the spin
      const ax = cross(U, Y_UP), k = Math.exp(-3.5 * dt);
      for (let i = 0; i < 3; i++) w[i] = (w[i] + ax[i] * 7 * dt) * k;
      return;
    }
    const sp = Math.hypot(this.vx, this.vy, this.vz);
    if (!pitchIn && sp > 8) { // weathervane: the nose gently follows the flight path, so un-steered jumps land flat-ish
      const ax = cross(F, [this.vx / sp, this.vy / sp, this.vz / sp]);
      for (let i = 0; i < 3; i++) w[i] += ax[i] * 2.2 * dt;
      const cut = dot(w, L) * (1 - Math.exp(-2.6 * dt)); w[0] -= L[0] * cut; w[1] -= L[1] * cut; w[2] -= L[2] * cut;
    }
    if (!roll) { const cut = wf * (1 - Math.exp(-0.25 * dt)); w[0] -= F[0] * cut; w[1] -= F[1] * cut; w[2] -= F[2] * cut; }
  }

  _contacts(dt, T) {
    const c = this.c, q = this.q, gc = T.height(c[0], c[2]);
    if (c[1] - gc > T.margin) { this.clearT += dt; this.wheelsDown = 0; return; } // nothing can reach the ground from up here
    const hits = [];
    let wheels = 0, body = 0, nx = 0, ny = 0, nz = 0;
    for (const [px, py, pz, kind] of PTS) {
      const r = qRot(q, [px - CL[0], py - CL[1], pz - CL[2]]), x = c[0] + r[0], z = c[2] + r[2], y = c[1] + r[1], gh = T.height(x, z);
      if (gh <= y) continue;
      const N = T.normal(x, z), pen = (gh - y) * N[1];
      hits.push({ r, pen, kind, jn: 0, N });
      if (kind === 0) { wheels++; nx += N[0]; ny += N[1]; nz += N[2]; } else body++;
    }
    this.wheelsDown = wheels;
    if (!hits.length) { this.clearT += dt; return; }
    const U = qRot(q, [0, 1, 0]), Nav = wheels ? norm([nx, ny, nz]) : hits[0].N, upDot = dot(U, Nav);
    if (!this.tumble) {
      if (this.clearT < 0.06 && this.air && this.air.t < 0.3) { // still leaving the ramp (rear tyres on the surface): just let the contacts carry / pivot the car
        if (body === 0) { this._solve(hits); return; }
      } else if (body === 0 && upDot > 0.79 && len(this.w) < 5.5) { this._land(T); return; } // clean, wheels-first landing
      this.tumble = true;
    }
    this.clearT = 0;
    this._solve(hits);
    const wm = len(this.w), spd = Math.hypot(this.vx, this.vy, this.vz);
    if ((wheels >= 3 || (wheels >= 2 && spd < 3)) && upDot > 0.8 && wm < 3.5) { this._land(T); return; } // rolled back onto its wheels
    this.crashT = spd < 2.5 && wm < 0.8 ? this.crashT + dt : 0;
    if (this.crashT > 2.2) this.needsReset = true;
  }

  /** Sequential-impulse contact resolution: restitution, tyre friction (rolls freely, grips sideways), Coulomb bodywork friction. */
  _solve(hits) {
    const v = [this.vx, this.vy, this.vz], w = this.w, c = this.c, F = qRot(this.q, [0, 0, 1]);
    let hardest = 0;
    const kOf = (r, d) => 1 + dot(d, cross(this._iinv(cross(r, d)), r)); // 1 / effective mass along d (unit mass)
    const push = (r, d, j) => { // apply impulse j along d at offset r from the centre of mass
      const wd = this._iinv(cross(r, d));
      v[0] += d[0] * j; v[1] += d[1] * j; v[2] += d[2] * j; w[0] += wd[0] * j; w[1] += wd[1] * j; w[2] += wd[2] * j;
    };
    const vel = (r) => { const wr = cross(w, r); return [v[0] + wr[0], v[1] + wr[1], v[2] + wr[2]]; };
    for (const h of hits) { // tyre rolling / side directions in this contact's tangent plane
      const N = h.N, fn = dot(F, N); h.Ft = norm([F[0] - N[0] * fn, F[1] - N[1] * fn, F[2] - N[2] * fn]); h.Sd = cross(N, h.Ft);
    }
    for (let it = 0; it < 6; it++) {
      for (const h of hits) {
        const r = h.r, N = h.N, vn = dot(vel(r), N);
        if (vn < 0) {
          const e = vn < -2.5 ? (h.kind === 0 ? 0.08 : 0.28) : 0, jn = (-(1 + e) * vn) / kOf(r, N);
          h.jn += jn; push(r, N, jn); if (it === 0) hardest = Math.max(hardest, -vn);
        }
        if (h.kind === 0) {
          for (const [d, mu] of [[h.Ft, 0.05], [h.Sd, 0.95]]) { const lim = mu * h.jn; push(r, d, clamp(-dot(vel(r), d) / kOf(r, d), -lim, lim)); }
        } else {
          const vp = vel(r), vn2 = dot(vp, N), vt = [vp[0] - N[0] * vn2, vp[1] - N[1] * vn2, vp[2] - N[2] * vn2], m = len(vt);
          if (m > 1e-4) { const d = [vt[0] / m, vt[1] / m, vt[2] / m]; push(r, d, -Math.min(m / kOf(r, d), 0.55 * h.jn)); }
        }
      }
    }
    if (this.tumble && len(v) < 0.18 && len(w) < 0.25) { v[0] = v[1] = v[2] = 0; w[0] = w[1] = w[2] = 0; } // a crashed car comes to rest
    for (const h of hits) { const k = h.pen * 0.9; c[0] += h.N[0] * k / hits.length * 1.6; c[1] += h.N[1] * k / hits.length * 1.6; c[2] += h.N[2] * k / hits.length * 1.6; } // push out of the ground
    this.vx = v[0]; this.vy = v[1]; this.vz = v[2];
    if (hardest > 3 && (!this.event || this.event.impact < hardest)) this.event = { type: 'crash', impact: hardest };
    this._originFromCom();
  }

  /** Wheels are down: hand the body back to the arcade driving model. */
  _land(T) {
    const F = qRot(this.q, [0, 0, 1]); if (Math.hypot(F[0], F[2]) > 0.2) this.heading = Math.atan2(F[0], F[2]);
    this._originFromCom();
    const p = this._plane(T), nl = Math.hypot(p.sF, p.sR, 1), N = [0, 1, 0];
    { // ground normal from the tyre plane (rise p.sF along the heading, p.sR to its right)
      const h = this.heading, gx = p.sF * Math.sin(h) - p.sR * Math.cos(h), gz = p.sF * Math.cos(h) + p.sR * Math.sin(h), l = Math.hypot(gx, 1, gz);
      N[0] = -gx / l; N[1] = 1 / l; N[2] = -gz / l;
    }
    const vn = this.vx * N[0] + this.vy * N[1] + this.vz * N[2], impact = Math.max(0, -vn);
    if (vn < 0) { this.vx -= N[0] * vn; this.vy -= N[1] * vn; this.vz -= N[2] * vn; }
    const scrub = impact > 7 ? 1 - Math.min(0.3, (impact - 7) * 0.015) : 1; this.vx *= scrub; this.vz *= scrub; // hard landings cost speed
    this.yawRate = clamp(this.w[1], -2.4, 2.4);
    this.sF = p.sF; this.sR = p.sR; this.y = p.gnd; this.vy = 0;
    const qd = qMul(qConj(this._groundQ(p.sF, p.sR)), this.q); this.qd = qd[3] < 0 ? [-qd[0], -qd[1], -qd[2], -qd[3]] : qd;
    this._wm = [this.w[0] * 0.5, this.w[1] * 0.5, this.w[2] * 0.5];
    const a = this.air;
    if (a && (a.t > 0.15 || impact > 3)) this.event = { type: 'land', impact, air: a.t, dist: Math.hypot(this.x - a.x0, this.z - a.z0), flipsPitch: a.pitch / (2 * Math.PI), flipsRoll: a.roll / (2 * Math.PI) };
    this.mode = 'ground'; this.tumble = false; this.air = null; this.crashT = 0; this.wheelsDown = 4;
    this.q = qNorm(qMul(this._groundQ(p.sF, p.sR), this.qd)); this.upY = 1 - 2 * (this.q[0] * this.q[0] + this.q[2] * this.q[2]);
  }

  /** Keep the arcade-facing fields (heading, speeds, upright-ness) in step with the rigid body. */
  _airSync() {
    const F = qRot(this.q, [0, 0, 1]);
    if (Math.hypot(F[0], F[2]) > 0.3) this.heading = Math.atan2(F[0], F[2]);
    const h = this.heading;
    this.vF = this.vx * Math.sin(h) + this.vz * Math.cos(h); this.vR = -this.vx * Math.cos(h) + this.vz * Math.sin(h);
    this.speed = Math.hypot(this.vx, this.vz); this.yawRate = 0;
    this.upY = 1 - 2 * (this.q[0] * this.q[0] + this.q[2] * this.q[2]);
  }
}
