// Pure maths behind the sound engine (no Web Audio here, so it can be unit-tested in Node).
import { TUNING, SHIFT_UP } from '../physics/Vehicle.js';

export const SPEED_OF_SOUND = 343; // m/s
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * Engine "voice" per car (matches the car ids in vehicle/cars.js).
 *  cyl    cylinders: firing frequency = rpm/60 * cyl/2, so more cylinders = higher, smoother note
 *  tilt   harmonic roll-off (lower = brighter / buzzier)      even  extra even harmonics (burbly V8 character)
 *  bright exhaust filter opening                              lump  idle roughness / uneven firing
 *  sub    sub-octave rumble                                   pops  overrun crackle + downshift blips
 *  turbo  turbo whistle + blow-off valve                      whine gearbox whine      detune bank-to-bank beat (cents)
 */
export const VOICES = {
  apex:     { cyl: 6,  tilt: 1.15, even: 1.2, bright: 1.0,  lump: 0.35, sub: 0.5,  pops: 0.3,  turbo: 0,   whine: 0.4, detune: 6 },
  velocity: { cyl: 10, tilt: 0.95, even: 1.0, bright: 1.35, lump: 0.1,  sub: 0.25, pops: 0.15, turbo: 0,   whine: 0.6, detune: 4 },
  blaze:    { cyl: 8,  tilt: 1.3,  even: 1.5, bright: 0.9,  lump: 0.8,  sub: 0.7,  pops: 0.9,  turbo: 0,   whine: 0.2, detune: 10 },
  zenith:   { cyl: 4,  tilt: 1.0,  even: 0.9, bright: 1.2,  lump: 0.2,  sub: 0.3,  pops: 0.4,  turbo: 0.8, whine: 0.5, detune: 5 },
  bulldog:  { cyl: 8,  tilt: 1.55, even: 1.3, bright: 0.7,  lump: 0.5,  sub: 0.9,  pops: 0.1,  turbo: 0,   whine: 0.3, detune: 7 },
  phantom:  { cyl: 6,  tilt: 1.05, even: 1.1, bright: 1.15, lump: 0.25, sub: 0.35, pops: 0.6,  turbo: 0.6, whine: 0.5, detune: 5 },
};
export const voiceFor = (id) => VOICES[id] || VOICES.apex;

export const firingHz = (rpm, cyl) => (rpm / 60) * (cyl / 2);

/** Harmonic recipe for the engine's PeriodicWave. */
export function harmonicSeries(voice, n = 32) {
  const real = new Float32Array(n + 1), imag = new Float32Array(n + 1);
  for (let k = 1; k <= n; k++) {
    let a = Math.pow(k, -voice.tilt);
    if (k % 2 === 0) a *= voice.even;
    a *= 1 + 0.6 * Math.exp(-((k - 4) ** 2) / 6); // exhaust-pipe resonance bump
    imag[k] = a;
  }
  return { real, imag };
}

/** Soft-clip curve for the exhaust growl. */
export function driveCurve(drive, n = 1024) {
  const c = new Float32Array(n), d = Math.tanh(drive);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * drive) / d; }
  return c;
}

/** Gear for a given speed (stateless version of the gearbox in physics/Vehicle.js). */
export function gearFor(speed, topSpeed = TUNING.topSpeed) {
  const k = topSpeed / TUNING.topSpeed;
  for (let g = 0; g < 5; g++) if (speed <= SHIFT_UP[g] * k) return g + 1;
  return 6;
}
/** Engine rpm for a speed, used for other players' cars (we only receive their velocity). */
export function rpmForSpeed(speed, topSpeed = TUNING.topSpeed) {
  const k = topSpeed / TUNING.topSpeed, g = gearFor(speed, topSpeed), hi = SHIFT_UP[g - 1] * k, lo = g > 1 ? SHIFT_UP[g - 2] * k * 0.78 : 0;
  return 1100 + clamp((speed - lo) / (hi - lo), 0, 1) * 6300;
}

/** Pitch ratio heard by the listener: <1 when the source moves away, >1 when it approaches. */
export function dopplerRatio(relX, relZ, vsx, vsz, vlx, vlz) {
  const d = Math.hypot(relX, relZ); if (d < 1) return 1;
  const apart = ((vsx - vlx) * relX + (vsz - vlz) * relZ) / d;
  return clamp(SPEED_OF_SOUND / (SPEED_OF_SOUND + apart), 0.8, 1.25);
}
/** Stereo position (-1 left … +1 right) for a source at (relX, relZ) when the listener faces (fx, fz). */
export function panFor(relX, relZ, fx, fz) {
  const d = Math.hypot(relX, relZ); if (d < 0.5) return 0;
  return clamp(((relX * -fz + relZ * fx) / d) * 0.85, -1, 1);
}
/** 1 = straight ahead, -1 = directly behind. */
export function frontness(relX, relZ, fx, fz) {
  const d = Math.hypot(relX, relZ); return d < 0.5 ? 1 : (relX * fx + relZ * fz) / d;
}
/** Loudness falloff with distance; fades to silence at maxD. */
export function distanceGain(d, ref = 12, rolloff = 1.5, maxD = 170) {
  if (d >= maxD) return 0;
  return (ref / (ref + rolloff * Math.max(0, d - ref))) * clamp((maxD - d) / (maxD * 0.25), 0, 1);
}
