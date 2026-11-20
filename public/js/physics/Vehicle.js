import { clamp, lerp, damp } from '../utils.js';

// Axes: forward = (sin h, cos h), right = (-cos h, sin h). Steering > 0 = right.
export const TUNING = {
  wheelBase: 2.6, accel: 17, topSpeed: 60, nitroTopSpeed: 76, nitroMul: 1.75,
  brake: 30, reverseAccel: 8, reverseMax: 15, handbrakeDecel: 7,
  rolling: 0.45, drag: 0.0011, engineBrake: 1.6,
  maxSteer: 0.62, steerFalloff: 25, latGrip: 22, grip: 12, handbrakeGrip: 1.0,
  scrub: 0.22, nitroDuration: 4.5, nitroRecharge: 12,
};
const SHIFT_UP = [14, 26, 38, 49, 59, 100]; // upper speed (m/s) of gears 1..6

export class Vehicle {
  /** `tuning` = TUNING scaled per car (see vehicle/cars.js). */
  constructor(tuning = TUNING) { this.setTuning(tuning); this.reset(0, 0, 0); }

  setTuning(t) { this.T = t; this.SU = SHIFT_UP.map((v) => v * (t.topSpeed / TUNING.topSpeed)); }

  reset(x, z, heading) {
    Object.assign(this, {
      x, z, heading, vx: 0, vz: 0, yawRate: 0, steer: 0,
      nitro: 1, nitroActive: false, nitroLocked: false, nitroDelay: 0,
      gear: 1, gearLabel: 'N', rpm: 1000, rpmNorm: 0, vF: 0, vR: 0, speed: 0,
      longAccel: 0, latAccel: 0, sliding: false, braking: false, reversing: false,
      handbrake: false, onGrass: false,
    });
  }

  get speedKmh() { return this.speed * 3.6; }

  update(dt, inp, onGrass = false) {
    const T = this.T, SU = this.SU;
    this.onGrass = onGrass;
    this.heading += this.yawRate * dt;
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
    let res = T.rolling * (onGrass ? 4 : 1) + T.drag * vF * vF * (onGrass ? 2 : 1);
    if (!throttle && !brake) res += T.engineBrake;
    let nv = vF + aF * dt;
    const rdv = res * dt;
    nv = Math.abs(nv) <= rdv ? 0 : nv - Math.sign(nv) * rdv;
    vF = nv;

    // --- Lateral grip: handbrake, power-oversteer and slip-angle falloff create drifts ---
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
}
