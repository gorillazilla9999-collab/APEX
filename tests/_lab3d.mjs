// Shared by the 3D physics tests: a headless Terrain for a real map + a tiny "drive straight at speed" harness.
import { Vehicle } from '../public/js/physics/Vehicle.js';
import { Terrain } from '../public/js/world/terrain.js';
import { buildCenterline } from '../public/js/world/trackMath.js';
import { getMap } from '../public/js/world/maps.js';

export const DT = 1 / 120;
export const NONE = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
export function worldFor(id, elevOverride) {
  const map = getMap(id), track = buildCenterline(map), terrain = new Terrain(track, elevOverride !== undefined ? elevOverride : map.elev);
  return { map, track, terrain };
}
/** Put a car on the centre-line at arc length s, heading along the road, moving at speed v (m/s). */
export function spawn(w, s, v = 0, lateral = 0) {
  const t = w.track, i = Math.round((((s % t.length) + t.length) % t.length) / t.ds) % t.n, car = new Vehicle();
  const x = t.px[i] - t.tz[i] * lateral, z = t.pz[i] + t.tx[i] * lateral, h = Math.atan2(t.tx[i], t.tz[i]);
  car.reset(x, z, h, w.terrain.height(x, z)); car.vx = Math.sin(h) * v; car.vz = Math.cos(h) * v; car.vF = v; car.speed = v;
  return car;
}
/** Simple lane keeper: steer towards the centre-line a few metres ahead. */
export function lane(w, car) {
  const t = w.track, near = w.terrain._locate(car.x, car.z), i = near.i, j = (i + Math.round(Math.max(8, car.speed * 0.35) / t.ds)) % t.n;
  const dx = t.px[j] - car.x, dz = t.pz[j] - car.z, want = Math.atan2(dx, dz);
  let d = want - car.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
  return Math.max(-1, Math.min(1, -d * 2.5));
}
export function run(w, car, secs, inp = {}, { hook, keepLane = true, stopOnLand = false } = {}) {
  const log = []; let t = 0;
  for (; t < secs * 120; t++) {
    const i = typeof inp === 'function' ? inp(car, t * DT) : inp;
    const c = { ...NONE, ...i }; if (keepLane && !car.airborne && c.steer === 0) c.steer = lane(w, car);
    car.update(DT, c, false, w.terrain);
    const ev = car.takeEvent(); if (ev) log.push({ t: t * DT, ...ev });
    hook?.(car, t * DT);
    if (!Number.isFinite(car.x + car.y + car.z + car.vx + car.vy + car.vz)) throw new Error('NaN state at t=' + t * DT);
    if (stopOnLand && ev?.type === 'land') break;
  }
  return log;
}
