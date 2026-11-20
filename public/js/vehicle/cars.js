import { TUNING } from '../physics/Vehicle.js';

/**
 * Car catalogue (pure data; the server uses the ids to validate joins).
 * Balance rule: every car spends the same number of stat points (STAT_POINTS) across SPEED / ACCEL / TURN / BRAKE,
 * so each one is strong somewhere and weak somewhere else. `tests/cars.test.mjs` checks the budget and simulates
 * laps on every map to confirm that no car is faster than another overall.
 */
export const DEFAULT_CAR = 'apex';
export const STAT_POINTS = 24;
export const STATS = ['speed', 'accel', 'turn', 'brake'];

// style: look only. len/hs/ws scale length/height/width; wing = rear wing size (0 = none); stripe = livery colour.
export const CARS = [
  { id: 'apex', name: 'APEX GT', tag: 'Does everything well. The benchmark.', color: 0xc8101e,
    stats: { speed: 6, accel: 6, turn: 6, brake: 6 }, style: { len: 1, hs: 1, ws: 1, wing: 1, stripe: null } },
  { id: 'velocity', name: 'VELOCITY', tag: 'Low wedge built for top speed. Slow off the line, brakes late.', color: 0x1e6bff,
    stats: { speed: 9, accel: 5, turn: 6, brake: 5 }, style: { len: 1.05, hs: 0.86, ws: 0.97, wing: 0, stripe: 0xf4f4f4 } },
  { id: 'blaze', name: 'BLAZE', tag: 'Explosive launch and exit speed. Runs out of breath up top.', color: 0xff6a00,
    stats: { speed: 5, accel: 8, turn: 6, brake: 4 }, style: { len: 0.98, hs: 1.05, ws: 1.06, wing: 1.5, stripe: 0x161616 } },
  { id: 'zenith', name: 'ZENITH', tag: 'Razor-sharp in corners. Needs room to brake and mediocre on the straights.', color: 0xf2b705,
    stats: { speed: 5, accel: 5, turn: 9, brake: 3 }, style: { len: 0.9, hs: 1.08, ws: 0.95, wing: 0.7, stripe: 0x161616 } },
  { id: 'bulldog', name: 'BULLDOG', tag: 'Heavy brakes and rock-solid stability. Stops on a dime.', color: 0x16a34a,
    stats: { speed: 6, accel: 6, turn: 6, brake: 8 }, style: { len: 1.02, hs: 1.04, ws: 1.1, wing: 0, stripe: 0xf4f4f4 } },
  { id: 'phantom', name: 'PHANTOM', tag: 'Fast and nimble, but fragile on the brakes and slow to launch.', color: 0x7c3aed,
    stats: { speed: 7, accel: 5, turn: 7, brake: 5 }, style: { len: 1.02, hs: 0.92, ws: 1, wing: 1.1, stripe: 0x00e0ff } },
];
export const CAR_IDS = CARS.map((c) => c.id);
export const isCar = (id) => typeof id === 'string' && CAR_IDS.includes(id);
export const getCar = (id) => CARS.find((c) => c.id === id) || CARS[0];

// How much one stat point (relative to the 6/6/6/6 baseline) changes the underlying physics.
const K = { speed: 0.06, accel: 0.055, turn: 0.04, brake: 0.12 };
/** Physics tuning for a car: TUNING scaled by its stat points. */
export function tuningFor(car) {
  const d = (k) => 1 + (car.stats[k] - 6) * K[k], T = TUNING;
  return {
    ...T,
    topSpeed: T.topSpeed * d('speed'), nitroTopSpeed: T.nitroTopSpeed * d('speed'),
    accel: T.accel * d('accel'),
    maxSteer: T.maxSteer * d('turn'), latGrip: T.latGrip * d('turn'), grip: T.grip * (1 + (d('turn') - 1) * 0.6),
    brake: T.brake * d('brake'),
  };
}
