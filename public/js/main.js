import * as THREE from 'three';
import { Vehicle } from './physics/Vehicle.js';
import { collideVehicle } from './physics/Collision.js';
import { World, HORIZON } from './world/World.js';
import { CarModel } from './vehicle/CarModel.js';
import { Smoke } from './vehicle/Smoke.js';
import { Input } from './core/Input.js';
import { CameraRig } from './core/CameraRig.js';
import { Settings } from './core/Settings.js';
import { GameAudio } from './core/Audio.js';
import { Network } from './core/Network.js';
import { UI } from './core/UI.js';
import { ROAD_WIDTH } from './world/Track.js';

const STEP = 1 / 120, PIXEL_RATIO = { low: 1, medium: 1.5, high: 2 };
const settings = new Settings();
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(HORIZON, 120, 1100);
const camera = new THREE.PerspectiveCamera(70, 1, 0.3, 2600);

const world = new World(); scene.add(world.group);
const envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(world.skyMesh.geometry, world.skyMesh.material));
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(envScene, 0.02, 0.1, 3000).texture;

const vehicle = new Vehicle();
const car = new CarModel(); scene.add(car.root);
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
settings.onChange((k) => {
  if (k === 'volume') audio.setVolume(settings.get('volume') / 100);
  else if (k === 'shadows') applyShadows();
  else if (k === 'quality') resize();
});

// ---- game flow ----
function resetVehicle(toast = true) {
  const near = world.track.nearest(vehicle.x, vehicle.z), p = world.track.pose(near.i);
  vehicle.reset(p.x, p.z, p.heading); car.update(STEP, vehicle); rig.snap(vehicle);
  if (toast && state === 'playing') ui.toast('VEHICLE RESET');
}
function spawnAtStart() { const p = world.track.pose(0); vehicle.reset(p.x, p.z, p.heading); car.update(STEP, vehicle); }
function setState(next) {
  state = next;
  ui.showHud(next === 'playing' || next === 'paused');
  if (next === 'playing') { ui.show(null); } else if (next === 'paused') { ui.show('pause'); audio.silence(); } else { ui.show('menu'); audio.silence(); }
}
const ui = new UI(settings, {
  onPlay() { audio.start(); spawnAtStart(); rig.snap(vehicle); setState('playing'); },
  onResume() { setState('playing'); },
  onPause() { if (state === 'playing') setState('paused'); },
  onReset() { resetVehicle(); if (state === 'paused') setState('playing'); },
  onQuit() { spawnAtStart(); setState('menu'); },
});
input.onPress('Escape', () => {
  if (state === 'playing') setState('paused');
  else if (state === 'paused') (ui.current === 'pause' ? setState('playing') : ui.back());
  else if (ui.current !== 'menu') ui.back();
});
input.onPress('KeyR', () => { if (state === 'playing') resetVehicle(); });
new Network((s) => ui.setNet(s));

// ---- simulation ----
let onGrass = false;
const fwd = new THREE.Vector3(), tmp = new THREE.Vector3();
function simulate(dt) {
  const inp = input.state;
  vehicle.update(dt, inp, onGrass);
  const impact = collideVehicle(vehicle, world.colliders);
  if (impact > 2.5) { rig.addShake(Math.min(1, impact / 25)); audio.impact(impact); car.bump(impact); }
}
function emitEffects(dt) {
  const v = vehicle, s = Math.sin(v.heading), c = Math.cos(v.heading);
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
    onGrass = world.track.nearest(vehicle.x, vehicle.z).dist > ROAD_WIDTH / 2 + 1.2;
    for (acc += dt; acc >= STEP; acc -= STEP) simulate(STEP);
    car.update(dt, vehicle); emitEffects(dt);
    rig.update(dt, vehicle, settings.get('fov'), settings.get('shake'));
    audio.update(vehicle, input.state.throttle);
    ui.updateHud(vehicle);
  } else if (state === 'menu') {
    car.update(dt, vehicle); rig.orbitAround(dt, vehicle);
  }
  smoke.update(dt);
  world.update(tmp.set(vehicle.x, 0, vehicle.z), camera.position);
  if (composer && settings.get('bloom')) composer.render(); else renderer.render(scene, camera);
}

applySettings();
spawnAtStart();
ui.hideLoading();
requestAnimationFrame(frame);
window.__apex = { vehicle, world, renderer, setState, get state() { return state; } }; // debug handle
