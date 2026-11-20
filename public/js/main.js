import * as THREE from 'three';
import { Vehicle } from './physics/Vehicle.js';
import { collideVehicle } from './physics/Collision.js';
import { World } from './world/World.js';
import { Track } from './world/Track.js';
import { MAPS, DEFAULT_MAP, getMap, isMap } from './world/maps.js';
import { CarModel } from './vehicle/CarModel.js';
import { CARS, DEFAULT_CAR, getCar, isCar, tuningFor } from './vehicle/cars.js';
import { RemoteCar } from './vehicle/RemoteCar.js';
import { Smoke } from './vehicle/Smoke.js';
import { Input } from './core/Input.js';
import { CameraRig } from './core/CameraRig.js';
import { Settings } from './core/Settings.js';
import { GameAudio } from './core/Audio.js';
import { Network } from './core/Network.js';
import { UI } from './core/UI.js';
import { Minimap } from './core/Minimap.js';

const STEP = 1 / 120, PIXEL_RATIO = { low: 1, medium: 1.5, high: 2 };
const settings = new Settings();
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.3, 2600);

// ---- maps: tracks are cheap to build, so all of them exist up front (menu thumbnails + minimap); a World is built per selected map ----
const pmrem = new THREE.PMREMGenerator(renderer);
const tracks = new Map(MAPS.map((m) => [m.id, new Track(m)]));
let world = null, envTarget = null;

const vehicle = new Vehicle();
let car = null, carDef = null; // built by loadCar() once the UI exists
const smoke = new Smoke(scene);
const rig = new CameraRig(camera);
const input = new Input();
const audio = new GameAudio();
let state = 'menu', composer = null, bloom = null;

// ---- post-processing (optional: falls back to direct rendering) ----
(async () => {
  try {
    const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'), import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/UnrealBloomPass.js'), import('three/addons/postprocessing/OutputPass.js'),
    ]);
    const target = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.7, 0.9);
    composer.addPass(bloom); composer.addPass(new OutputPass());
    resize();
  } catch (e) { console.warn('Bloom disabled:', e); composer = null; }
})();

function resize() {
  const pr = Math.min(devicePixelRatio, PIXEL_RATIO[settings.get('quality')]);
  renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  composer?.setPixelRatio(pr); composer?.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);
function applyShadows() {
  renderer.shadowMap.enabled = settings.get('shadows'); world.sun.castShadow = settings.get('shadows');
  scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; }); // recompile with/without shadow maps
}
function applySettings() { applyShadows(); audio.setVolume(settings.get('volume') / 100); resize(); }
settings.onChange((k, v) => {
  if (k === 'volume') audio.setVolume(settings.get('volume') / 100);
  else if (k === 'shadows') applyShadows();
  else if (k === 'quality') resize();
  else if (k === 'minimap') minimap.setMode(v);
});

/** Swap the whole environment (world, sky, fog, lighting, reflections, minimap). Returns false if that map is already loaded. */
function loadMap(id) {
  const def = getMap(id);
  if (world?.map.id === def.id) return false;
  if (world) { scene.remove(world.group); world.dispose(); }
  world = new World(def, tracks.get(def.id)); scene.add(world.group);
  scene.fog = new THREE.Fog(world.horizon, def.theme.fog[0], def.theme.fog[1]);
  renderer.toneMappingExposure = def.theme.exposure;
  const envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(world.skyMesh.geometry, world.skyMesh.material));
  envTarget?.dispose(); envTarget = pmrem.fromScene(envScene, 0.02, 0.1, 3000); scene.environment = envTarget.texture;
  world.sun.castShadow = settings.get('shadows');
  minimap.setMap(def, world.track); ui.setMap(def); setModeLabel(modeBase);
  return true;
}
let modeBase = 'TEST DRIVE';
function setModeLabel(text) { modeBase = text; ui.setMode(`${text} · ${world.map.name}`); }
const MINI_MODES = ['follow', 'full', 'off'], MINI_NAMES = { follow: 'FOLLOW CAR', full: 'FULL TRACK', off: 'OFF' };
function cycleMinimap() {
  const next = MINI_MODES[(MINI_MODES.indexOf(settings.get('minimap')) + 1) % MINI_MODES.length];
  settings.set('minimap', next);
  if (state === 'playing') ui.toast('MINIMAP: ' + MINI_NAMES[next]);
}

/** Swap the player's car: new body model + new physics tuning. Returns false if it is already selected. */
function loadCar(id) {
  const def = getCar(id);
  if (carDef?.id === def.id) return false;
  if (car) car.dispose();
  carDef = def; car = new CarModel({ color: def.color, style: def.style }); scene.add(car.root);
  vehicle.setTuning(tuningFor(def)); ui.setCar(def); car.update(STEP, vehicle);
  return true;
}

// ---- game flow ----
function resetVehicle(toast = true) {
  const near = world.track.nearest(vehicle.x, vehicle.z), p = world.track.pose(near.i);
  vehicle.reset(p.x, p.z, p.heading); car.update(STEP, vehicle); rig.snap(vehicle);
  if (toast && state === 'playing') ui.toast('VEHICLE RESET');
}
/** Online players get staggered grid slots (2 abreast, ~11 m apart) so nobody spawns inside anybody else. */
function spawnAtStart(slot = -1) {
  const t = world.track, gap = Math.max(1, Math.round(11 / t.ds)), i = slot < 0 ? 0 : (((-slot * gap) % t.n) + t.n) % t.n, p = t.pose(i);
  const off = slot < 0 ? 0 : (slot % 2 ? 3.2 : -3.2);
  vehicle.reset(p.x - t.tz[i] * off, p.z + t.tx[i] * off, p.heading); car.update(STEP, vehicle);
}
function setState(next) {
  state = next;
  ui.showHud(next === 'playing' || next === 'paused');
  if (next === 'playing') { ui.show(null); } else if (next === 'paused') { ui.show('pause'); audio.silence(); } else { ui.show('menu'); audio.silence(); }
}
let joining = false;
const ui = new UI(settings, {
  async onPlay() {
    if (joining) return;
    let notice = '';
    audio.start(); // inside the click handler, before any await, so the browser lets audio start
    let slot = -1;
    if (net.connected) {
      joining = true;
      try {
        const { name, room } = ui.identity();
        const res = await net.join(name, room, world.map.id, carDef.id);
        if (res.map && loadMap(res.map)) notice = `ROOM MAP: ${world.map.name}`; // an existing room decides the map
        syncRoster(res.players); slot = res.you.slot;
        setModeLabel(`ONLINE · ROOM ${res.room}`);
      } catch (e) { joining = false; ui.flashNet(`✕ ${e}`); return; }
      joining = false;
    } else setModeLabel('TEST DRIVE');
    spawnAtStart(slot); rig.snap(vehicle); setState('playing');
    if (notice) ui.toast(notice, 2200);
  },
  onSelectCar(id) {
    if (!isCar(id)) return;
    try { localStorage.setItem('apexdrive.car', id); } catch { /* storage unavailable */ }
    loadCar(id);
  },
  onSelectMap(id) {
    if (!isMap(id)) return;
    try { localStorage.setItem('apexdrive.map', id); } catch { /* storage unavailable */ }
    if (loadMap(id)) { spawnAtStart(); rig.snap(vehicle); }
  },
  onResume() { setState('playing'); },
  onPause() { if (state === 'playing') setState('paused'); },
  onReset() { resetVehicle(); if (state === 'paused') setState('playing'); },
  onQuit() { net.leave(); clearRemotes(); setModeLabel('TEST DRIVE'); spawnAtStart(); setState('menu'); },
}, MAPS.map((def) => ({ def, track: tracks.get(def.id) })), CARS);
const minimap = new Minimap(document.getElementById('minimap'));
minimap.c.onclick = () => cycleMinimap();
input.onPress('Escape', () => {
  if (state === 'playing') setState('paused');
  else if (state === 'paused') (ui.current === 'pause' ? setState('playing') : ui.back());
  else if (ui.current !== 'menu') ui.back();
});
input.onPress('KeyR', () => { if (state === 'playing') resetVehicle(); });
input.onPress('KeyM', () => { if (state === 'playing') cycleMinimap(); });
// ---- multiplayer ----
const remotes = new Map(); // socket id -> RemoteCar
const clock = () => performance.now() / 1000;
function addRemote(p) { if (p.id !== net.id && !remotes.has(p.id)) remotes.set(p.id, new RemoteCar(scene, p)); }
function removeRemote(id) { remotes.get(id)?.dispose(); remotes.delete(id); }
function clearRemotes() { [...remotes.keys()].forEach(removeRemote); }
function syncRoster(players) {
  const ids = new Set(players.map((p) => p.id));
  for (const id of [...remotes.keys()]) if (!ids.has(id)) removeRemote(id);
  players.forEach(addRemote);
}
const net = new Network((s) => ui.setNet(s))
  .on('room:joined', (p) => { addRemote(p); if (state !== 'menu') ui.toast(`${p.name} JOINED`); })
  .on('room:left', ({ id }) => { const r = remotes.get(id); if (r && state !== 'menu') ui.toast(`${r.name} LEFT`); removeRemote(id); })
  .on('room:snapshot', ({ players }) => { const now = clock(); for (const p of players) remotes.get(p.id)?.push(p, now); })
  .on('disconnected', () => { clearRemotes(); if (state !== 'menu') ui.toast('CONNECTION LOST'); })
  .on('rejoined', (res) => {
    if (res.map && loadMap(res.map)) { clearRemotes(); spawnAtStart(res.you.slot); rig.snap(vehicle); if (state !== 'menu') ui.toast(`ROOM MAP: ${world.map.name}`, 2200); }
    else if (state !== 'menu') ui.toast('RECONNECTED');
    syncRoster(res.players); setModeLabel(`ONLINE · ROOM ${res.room}`);
  })
  .on('kicked', () => { clearRemotes(); if (state !== 'menu') ui.toast('COULD NOT REJOIN ROOM'); });

let sendAcc = 0, rosterAcc = 0;
function sendState(dt) {
  if (!net.inRoom || state === 'menu') return;
  rosterAcc += dt;
  if (rosterAcc > 0.5) {
    rosterAcc = 0;
    const rows = [{ name: net.you?.name || 'You', color: net.you?.color ?? 0xc8101e, kmh: Math.round(vehicle.speedKmh), me: true }];
    for (const r of remotes.values()) rows.push({ name: r.name, color: r.color, kmh: Math.round(r.v.speed * 3.6) });
    ui.setPlayers(rows);
  }
  sendAcc += dt;
  if (sendAcc < 0.05) return; // 20 Hz
  sendAcc = 0;
  const v = vehicle, idle = state === 'paused';
  net.sendState({
    x: v.x, z: v.z, h: v.heading, vx: idle ? 0 : v.vx, vz: idle ? 0 : v.vz, st: v.steer, yr: idle ? 0 : v.yawRate,
    f: idle ? 0 : (v.braking ? 1 : 0) | (v.handbrake ? 2 : 0) | (v.nitroActive ? 4 : 0) | (v.sliding ? 8 : 0) | (v.onGrass ? 16 : 0),
  });
}

// ---- simulation ----
let onGrass = false;
const fwd = new THREE.Vector3(), tmp = new THREE.Vector3();
function simulate(dt) {
  const inp = input.state;
  vehicle.update(dt, inp, onGrass);
  const impact = collideVehicle(vehicle, world.colliders);
  if (impact > 2.5) { rig.addShake(Math.min(1, impact / 25)); audio.impact(impact); car.bump(impact); }
}
function emitEffects(dt, v) {
  const s = Math.sin(v.heading), c = Math.cos(v.heading);
  const slide = v.sliding || (v.handbrake && v.speed > 8), dust = v.onGrass && v.speed > 6;
  if ((slide || dust) && Math.random() < dt * 60) {
    for (const side of [-1, 1]) {
      const x = v.x - s * 1.35 - c * side * 0.93, z = v.z - c * 1.35 + s * side * 0.93;
      smoke.emit(x, 0.15, z, v.vx * 0.15 + (Math.random() - 0.5), v.vz * 0.15 + (Math.random() - 0.5),
        dust && !slide ? 0x8a6f4a : 0xdddddd, 1.2 + Math.random(), 0.9 + Math.random() * 0.6, dust && !slide ? 0.4 : 0.5);
    }
  }
}

let last = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1); last = now;
  if (state === 'playing') {
    onGrass = world.track.nearest(vehicle.x, vehicle.z).dist > world.roadWidth / 2 + 1.2;
    for (acc += dt; acc >= STEP; acc -= STEP) simulate(STEP);
    car.update(dt, vehicle); emitEffects(dt, vehicle);
    rig.update(dt, vehicle, settings.get('fov'), settings.get('shake'));
    audio.update(vehicle, input.state.throttle);
    ui.updateHud(vehicle);
  } else if (state === 'menu') {
    car.update(dt, vehicle); rig.orbitAround(dt, vehicle);
  }
  if (remotes.size) {
    const now = clock();
    for (const r of remotes.values()) {
      const rv = r.update(dt, now);
      if (!r.away && Math.hypot(rv.x - camera.position.x, rv.z - camera.position.z) < 160) emitEffects(dt, rv);
    }
  }
  sendState(dt);
  smoke.update(dt);
  if (state !== 'menu') minimap.draw(vehicle, [...remotes.values()].filter((r) => r.car.root.visible).map((r) => ({ x: r.v.x, z: r.v.z, color: r.color })), dt);
  world.update(tmp.set(vehicle.x, 0, vehicle.z), camera.position, dt);
  if (composer && settings.get('bloom')) composer.render(); else renderer.render(scene, camera);
}

let savedMap = null, savedCar = null;
try { savedMap = localStorage.getItem('apexdrive.map'); savedCar = localStorage.getItem('apexdrive.car'); } catch { /* storage unavailable */ }
loadCar(isCar(savedCar) ? savedCar : DEFAULT_CAR);
loadMap(isMap(savedMap) ? savedMap : DEFAULT_MAP);
minimap.setMode(settings.get('minimap'));
applySettings();
spawnAtStart();
ui.hideLoading();
requestAnimationFrame(frame);
window.__apex = { vehicle, renderer, setState, loadMap, get world() { return world; }, get state() { return state; } }; // debug handle
