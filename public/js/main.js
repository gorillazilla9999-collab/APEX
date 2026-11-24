import * as THREE from 'three';
import { Vehicle } from './physics/Vehicle.js';
import { World } from './world/World.js';
import { Track } from './world/Track.js';
import { MAPS, BASE_MAPS, DEFAULT_MAP, getMap, isMap } from './world/maps.js';
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
import { LocalLink } from './core/LocalLink.js';
import { gridPose } from './race/RaceSession.js';
import { fmtTime } from './race/format.js';

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
const tracks = new Map(); // a map and its flat twin share one Track (same layout)
for (const m of BASE_MAPS) { const t = new Track(m); tracks.set(m.id, t); tracks.set(m.id + 'flat', t); }
let world = null, envTarget = null;

const vehicle = new Vehicle();
let car = null, carDef = null; // built by loadCar() once the UI exists
const smoke = new Smoke(scene);
const rig = new CameraRig(camera);
rig.ground = (x, z) => (world ? world.terrain.height(x, z) : 0);
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
function toggleCamera() {
  const next = settings.get('camera') === 'first' ? 'chase' : 'first';
  settings.set('camera', next);
  if (state === 'playing') ui.toast('CAMERA: ' + (next === 'first' ? 'FIRST PERSON' : 'CHASE'));
}
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
  vehicle.setTuning(tuningFor(def)); audio.setCar(def.id); ui.setCar(def); car.update(STEP, vehicle);
  return true;
}

// ---- game flow ----
function resetVehicle(toast = true) {
  if (race.active && race.locked) return; // no moving off the grid before the start
  const near = world.track.nearest(vehicle.x, vehicle.z), p = world.track.pose(near.i);
  vehicle.reset(p.x, p.z, p.heading, world.terrain.height(p.x, p.z)); car.update(STEP, vehicle); rig.snap(vehicle);
  if (toast && state === 'playing') ui.toast('VEHICLE RESET');
}
/** Online players get staggered grid slots (2 abreast, ~11 m apart) so nobody spawns inside anybody else. */
function spawnAtStart(slot = -1) {
  const t = world.track;
  if (slot < 0) { const p = t.pose(0); vehicle.reset(p.x, p.z, p.heading, world.terrain.height(p.x, p.z)); }
  else { const p = gridPose(t, slot); vehicle.reset(p.x, p.z, p.heading, world.terrain.height(p.x, p.z)); }
  car.update(STEP, vehicle);
}
function setState(next) {
  state = next;
  ui.showHud(next === 'playing' || next === 'paused');
  if (next === 'playing') ui.show(null);
  else if (next === 'paused') { ui.show('pause'); audio.silence(); }
  else { ui.show(next); audio.silence(); } // 'menu' | 'lobby' | 'results'
}

// ---- racing: one "link" at a time = online room (Network) or solo race (LocalLink); both speak the same protocol ----
const NEUTRAL = { throttle: false, brake: false, steer: 0, handbrake: false, nitro: false };
const freshRace = () => ({ active: false, goAt: 0, laps: 3, nitro: true, rows: [], lapsDone: 0, finished: false, finishMs: 0, went: false, lastCount: null, wrong: 0, locked: false, resultRows: null });
let joining = false, link = null, lobby = null, roomCode = null, race = freshRace(), drive = NEUTRAL;
const local = new LocalLink((id) => tracks.get(id));
const isHost = () => !!link && !!lobby && lobby.host === link.id;
const who = (id) => lobby?.players.find((p) => p.id === id);
const mapsList = BASE_MAPS.map((def) => ({ def, track: tracks.get(def.id) })); // one card per layout; the Hills / Flat toggle picks the version
const allMaps = MAPS.map((def) => ({ def, track: tracks.get(def.id) }));

function leaveLink() { link?.leave(); link = null; lobby = null; roomCode = null; race = freshRace(); ui.raceHud(false); ui.setStandings([], 0); clearRemotes(); }
function leaveRoom() { leaveLink(); setModeLabel('TEST DRIVE'); spawnAtStart(); rig.snap(vehicle); setState('menu'); }
function backToLobby() {
  race = freshRace(); ui.raceHud(false); ui.setStandings([], 0);
  remotes.forEach((r) => r.reset()); spawnAtStart(); rig.snap(vehicle); setState('lobby');
}
function enterLobby(st) {
  race = freshRace(); ui.raceHud(false); applyRoomState(st);
  setModeLabel(roomCode === null ? 'SOLO RACE' : `RACE · ROOM ${roomCode}`);
  spawnAtStart(); rig.snap(vehicle); setState('lobby');
}
/** The room's rules / roster changed (or we just joined). The host's map choice applies to everyone. */
function applyRoomState(st) {
  if (!link) return;
  lobby = st;
  if (st.settings.map !== world.map.id && loadMap(st.settings.map)) { spawnAtStart(); rig.snap(vehicle); }
  if (link !== local) syncRoster(st.players);
  ui.setLobby(st, link.id, roomCode, carDef.name);
  if (state === 'results' && race.resultRows) ui.showResults(race.resultRows, link.id, isHost(), link === local);
  if (st.phase === 'lobby' && (race.active || state === 'results' || state === 'playing' || state === 'paused')) backToLobby();
}
function onRaceStarted({ goAt, grid, settings }) {
  if (!link || grid[link.id] == null) return;
  if (settings.map !== world.map.id) loadMap(settings.map);
  race = { ...freshRace(), active: true, goAt, laps: settings.laps, nitro: settings.nitro, locked: true };
  remotes.forEach((r) => r.reset());
  spawnAtStart(grid[link.id]); rig.snap(vehicle);
  ui.raceHud(true, settings.nitro); ui.setStandings([], settings.laps); setState('playing');
}
function onRaceTick({ rows }) {
  if (!link || !race.active) return;
  race.rows = rows;
  ui.setStandings(rows.map((r, i) => ({ place: i + 1, name: who(r[0])?.name ?? '?', color: who(r[0])?.color ?? 0xffffff, me: r[0] === link.id, lap: r[1], gap: r[3], done: r[2] > 0 })), race.laps);
  const i = rows.findIndex((r) => r[0] === link.id); if (i < 0) return;
  const me = rows[i];
  if (me[1] > race.lapsDone) {
    if (!race.finished && me[1] < race.laps) { ui.toast(`LAP ${me[1]} · ${fmtTime(me[4])}${me[4] === me[5] ? ' · BEST' : ''}`, 2200); audio.beep(880, 0.08); }
    race.lapsDone = me[1];
  }
  if (me[2] > 0 && !race.finished) { race.finished = true; race.finishMs = me[2]; ui.finishBanner(i + 1, me[2]); audio.fanfare(); }
}
function onRaceResults({ rows }) {
  if (!link || !race.active) return;
  race.resultRows = rows.map((r) => ({ ...r, color: who(r.id)?.color ?? 0xffffff }));
  ui.showResults(race.resultRows, link.id, isHost(), link === local);
  ui.raceHud(false); ui.setStandings([], 0); setState('results');
}
const hooks = { 'room:state': applyRoomState, 'race:started': onRaceStarted, 'race:tick': onRaceTick, 'race:results': onRaceResults };

async function joinOnline(mode, code) {
  if (joining) return;
  if (!net.connected) { ui.setMultiNote('SERVER OFFLINE · TRY A SOLO RACE'); return; }
  audio.start(); joining = true; ui.setMultiNote('');
  try {
    const res = await net.join(ui.identity().name, code, world.map.id, carDef.id, mode);
    if (link) link.leave();
    clearRemotes(); link = net; roomCode = res.room;
    enterLobby({ host: res.host, phase: res.phase, settings: res.settings, players: res.players });
  } catch (e) { ui.setMultiNote('✕ ' + e); }
  joining = false;
}

const ui = new UI(settings, {
  onFreeDrive() { audio.start(); leaveLink(); setModeLabel('TEST DRIVE'); spawnAtStart(); rig.snap(vehicle); setState('playing'); },
  onSolo() {
    audio.start(); leaveLink(); link = local; roomCode = null;
    enterLobby(local.open({ name: ui.identity().name, car: carDef.id, color: carDef.color, map: world.map.id }));
  },
  onHost: (code) => joinOnline('host', code), onJoin: (code) => joinOnline('join', code), onQuick: () => joinOnline('public', ''),
  onLeave: leaveRoom, onQuit: leaveRoom,
  onStartRace() { if (isHost()) link.startRace(); },
  onBackToLobby() { if (isHost()) link.toLobby(); },
  onSetup(patch) { if (isHost()) link.setup(patch); },
  onSelectCar(id) {
    if (!isCar(id)) return;
    try { localStorage.setItem('apexdrive.car', id); } catch { /* storage unavailable */ }
    loadCar(id);
    if (link && state === 'lobby') { link.setCar(id); if (lobby) ui.setLobby(lobby, link.id, roomCode, carDef.name); }
  },
  onSelectMap(id) {
    if (!isMap(id)) return;
    if (link) { if (isHost()) link.setup({ map: id }); return; } // inside a lobby only the host picks the map
    try { localStorage.setItem('apexdrive.map', id); } catch { /* storage unavailable */ }
    if (loadMap(id)) { spawnAtStart(); rig.snap(vehicle); }
  },
  onResume() { setState('playing'); },
  onPause() { if (state === 'playing') setState('paused'); },
  onReset() { resetVehicle(); if (state === 'paused') setState('playing'); },
}, mapsList, CARS);
ui.setNames(allMaps, CARS);
const minimap = new Minimap(document.getElementById('minimap'));
minimap.c.onclick = () => cycleMinimap();
input.onPress('Escape', () => {
  if (state === 'playing') setState('paused');
  else if (state === 'paused') (ui.current === 'pause' ? setState('playing') : ui.back());
  else if (['maps', 'cars', 'settings', 'controls', 'multi'].includes(ui.current)) ui.back();
});
input.onPress('KeyR', () => { if (state === 'playing') resetVehicle(); });
input.onPress('KeyM', () => { if (state === 'playing') cycleMinimap(); });
input.onPress('KeyC', () => { if (state === 'playing') toggleCamera(); });
// ---- multiplayer ----
const remotes = new Map(); // socket id -> RemoteCar
const clock = () => performance.now() / 1000;
function addRemote(p) { if (p.id !== net.id && !remotes.has(p.id)) remotes.set(p.id, new RemoteCar(scene, p)); }
function removeRemote(id) { remotes.get(id)?.dispose(); remotes.delete(id); audio.removeRemote(id); }
function clearRemotes() { [...remotes.keys()].forEach(removeRemote); }
function syncRoster(players) { // add newcomers, drop leavers, rebuild cars whose owner switched model
  for (const [id, r] of [...remotes]) { const p = players.find((q) => q.id === id); if (!p || p.car !== r.carId) removeRemote(id); }
  players.forEach(addRemote);
}
const net = new Network((s) => ui.setNet(s))
  .on('room:joined', (p) => { if (link === net) { addRemote(p); if (state === 'playing') ui.toast(`${p.name} JOINED`); } })
  .on('room:left', ({ id }) => { const r = remotes.get(id); if (r && state === 'playing') ui.toast(`${r.name} LEFT`); removeRemote(id); })
  .on('room:snapshot', ({ players }) => { const now = clock(); for (const p of players) remotes.get(p.id)?.push(p, now); })
  .on('disconnected', () => { clearRemotes(); if (link === net && state !== 'menu') ui.toast('CONNECTION LOST'); })
  .on('rejoined', (res) => { // the server forgot us: we are back as a spectator in the same room, so show the lobby
    if (link !== net) return;
    roomCode = res.room; lobby = null;
    applyRoomState({ host: res.host, phase: res.phase, settings: res.settings, players: res.players });
    if (state !== 'lobby') backToLobby();
  })
  .on('kicked', () => { if (link === net) { leaveRoom(); ui.flashNet('✕ DISCONNECTED FROM ROOM'); } });
for (const [ev, fn] of Object.entries(hooks)) { net.on(ev, (d) => link === net && fn(d)); local.on(ev, (d) => link === local && fn(d)); }

let sendAcc = 0;
function sendState(dt) {
  if (!link?.inRoom || (state !== 'playing' && state !== 'paused')) return;
  sendAcc += dt;
  if (sendAcc < 1 / 30) return; // 30 Hz
  sendAcc = 0;
  const v = vehicle, idle = state === 'paused';
  link.sendState({
    ts: Math.round(clock() * 1000), x: v.x, z: v.z, y: v.y, vy: idle ? 0 : v.vy, q: v.q, h: v.heading, vx: idle ? 0 : v.vx, vz: idle ? 0 : v.vz, st: v.steer, yr: idle ? 0 : v.yawRate,
    f: idle ? 0 : (v.braking ? 1 : 0) | (v.handbrake ? 2 : 0) | (v.nitroActive ? 4 : 0) | (v.sliding ? 8 : 0) | (v.onGrass ? 16 : 0) | (v.airborne ? 32 : 0),
  });
}

/** Countdown, race clock, place / lap readout and wrong-way warning (runs every frame while driving). */
function updateRace(dt, near) {
  if (!race.active || !link) return;
  const toGo = race.goAt - link.serverNow();
  race.locked = toGo > 0;
  if (race.locked) {
    const c = Math.ceil(toGo / 1000);
    if (c !== race.lastCount) { race.lastCount = c; ui.countdown(c); audio.beep(c <= 1 ? 740 : 520, 0.14); }
  } else if (!race.went) { race.went = true; ui.countdown('GO!', true); audio.beep(1175, 0.45, 0.25); setTimeout(() => ui.countdown(null), 900); }

  const t = world.track;
  if (!race.locked && !race.finished && vehicle.speed > 6 && near.dist < world.roadWidth) {
    const f = Math.sin(vehicle.heading) * t.tx[near.i] + Math.cos(vehicle.heading) * t.tz[near.i];
    race.wrong = f < -0.35 ? Math.min(2, race.wrong + dt) : Math.max(0, race.wrong - dt * 2);
  } else race.wrong = 0;
  ui.wrongWay(race.wrong > 0.7);

  const i = race.rows.findIndex((r) => r[0] === link.id), me = i >= 0 ? race.rows[i] : null;
  ui.updateRace({
    place: me ? i + 1 : 0, total: Math.max(1, race.rows.length || lobby?.players.filter((p) => !p.spec).length || 1), lap: me ? me[1] + 1 : 1, laps: race.laps,
    ms: race.finished ? race.finishMs : race.locked ? 0 : link.serverNow() - race.goAt, last: me?.[4] ?? null, best: me?.[5] ?? null, gap: me?.[3] ?? null, done: race.finished,
  });
}

// ---- simulation ----
let onGrass = false;
const fwd = new THREE.Vector3(), tmp = new THREE.Vector3();
function simulate(dt) {
  vehicle.update(dt, drive, onGrass, world.terrain);
  const impact = vehicle.collide(world.colliders);
  if (impact > 2.5) { rig.addShake(Math.min(1, impact / 25)); audio.impact(impact); car.bump(impact); }
  const ev = vehicle.takeEvent();
  if (ev) onVehicleEvent(ev);
}
/** Landings and crashes from the 3D physics: thump, shake, and a toast for big air / flips. */
function onVehicleEvent(ev) {
  if (ev.impact > 3) { rig.addShake(Math.min(1, ev.impact / 22)); audio.impact(ev.impact * 1.3); car.bump(ev.impact); }
  if (ev.type !== 'land' || state !== 'playing') return;
  const flips = [];
  const fp = Math.round(Math.abs(ev.flipsPitch)), fr = Math.round(Math.abs(ev.flipsRoll));
  if (fp >= 1) flips.push(`${fp > 1 ? fp + '× ' : ''}${ev.flipsPitch > 0 ? 'FRONT' : 'BACK'} FLIP`);
  if (fr >= 1) flips.push(`${fr > 1 ? fr + '× ' : ''}BARREL ROLL`);
  if (flips.length) ui.toast(`${flips.join(' + ')} · ${ev.air.toFixed(1)}s`, 2200);
  else if (ev.air >= 0.8) ui.toast(`AIR TIME ${ev.air.toFixed(1)}s · ${Math.round(ev.dist)} m`, 1800);
}
function emitEffects(dt, v) {
  if (v.airborne) return; // no tyre smoke / dust while the wheels are off the ground
  const s = Math.sin(v.heading), c = Math.cos(v.heading), y = (v.y ?? 0) + 0.15;
  const slide = v.sliding || (v.handbrake && v.speed > 8), dust = v.onGrass && v.speed > 6;
  if ((slide || dust) && Math.random() < dt * 60) {
    for (const side of [-1, 1]) {
      const x = v.x - s * 1.35 - c * side * 0.93, z = v.z - c * 1.35 + s * side * 0.93;
      smoke.emit(x, y, z, v.vx * 0.15 + (Math.random() - 0.5), v.vz * 0.15 + (Math.random() - 0.5),
        dust && !slide ? 0x8a6f4a : 0xdddddd, 1.2 + Math.random(), 0.9 + Math.random() * 0.6, dust && !slide ? 0.4 : 0.5);
    }
  }
}

const listener = { x: 0, z: 0, fx: 0, fz: 1, vx: 0, vz: 0 };
let last = performance.now(), acc = 0, fpsFrames = 0, fpsT = performance.now();
function frame(now, background = false) {
  if (!background) requestAnimationFrame(frame);
  fpsFrames++;
  if (!background && now - fpsT >= 500) { ui.setFps(Math.round(fpsFrames * 1000 / (now - fpsT))); fpsFrames = 0; fpsT = now; }
  const dt = Math.max(0, Math.min((now - last) / 1000, 0.1)); last = Math.max(last, now); // rAF timestamps can be slightly older than a manual frame's now
  if (state === 'playing') {
    const near = world.track.nearest(vehicle.x, vehicle.z);
    onGrass = near.dist > world.roadWidth / 2 + 1.2;
    updateRace(dt, near);
    const raw = input.state; // the countdown locks the controls; "no nitro" rooms mask the nitro key
    drive = race.active && race.locked ? NEUTRAL : race.active && !race.nitro ? { ...raw, nitro: false } : raw;
    for (acc += dt; acc >= STEP; acc -= STEP) simulate(STEP);
    if (vehicle.needsReset) { resetVehicle(false); ui.toast('FLIPPED · VEHICLE RESET'); } // crashed upside-down / stuck: put it back on the road
    rig.mode = settings.get('camera'); car.body.visible = !rig.firstPerson; // in the driver's seat the bodywork is hidden (wheels stay, peeking in at the edges)
    car.update(dt, vehicle); emitEffects(dt, vehicle);
    rig.update(dt, vehicle, settings.get('fov'), settings.get('shake'));
    audio.update(vehicle, drive.throttle);
    ui.updateHud(vehicle);
  } else if (state === 'menu' || state === 'lobby' || state === 'results') {
    car.body.visible = true; rig.mode = 'chase'; rig._restoreNear(); car.update(dt, vehicle); rig.orbitAround(dt, vehicle);
  }
  if (link === local) local.tick();
  if (remotes.size) {
    const now = clock(), hear = state === 'playing';
    if (hear) { camera.getWorldDirection(tmp); const l = Math.hypot(tmp.x, tmp.z) || 1; listener.fx = tmp.x / l; listener.fz = tmp.z / l; listener.x = camera.position.x; listener.z = camera.position.z; listener.vx = vehicle.vx; listener.vz = vehicle.vz; }
    else audio.silenceRemotes();
    for (const r of remotes.values()) {
      const rv = r.update(dt, now);
      if (state === 'menu' || state === 'lobby' || state === 'results') r.car.root.visible = false;
      if (hear) audio.updateRemote(r.id, r.carId, rv, listener, r.away);
      if (!r.away && r.car.root.visible && Math.hypot(rv.x - camera.position.x, rv.z - camera.position.z) < 160) emitEffects(dt, rv);
    }
  }
  sendState(dt);
  smoke.update(dt);
  if (background) return; // hidden tab: simulate + network only, skip drawing
  if (state === 'playing' || state === 'paused') minimap.draw(vehicle, [...remotes.values()].filter((r) => r.car.root.visible).map((r) => ({ x: r.v.x, z: r.v.z, color: r.color })), dt);
  world.update(tmp.set(vehicle.x, vehicle.y, vehicle.z), camera.position, dt);
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
window.__apex = { vehicle, renderer, setState, loadMap, frame, get world() { return world; }, get state() { return state; } }; // debug handle
// Browsers pause requestAnimationFrame in background tabs, which froze your car for everyone else (and stopped the race clock HUD).
// A worker timer is not throttled, so a hidden tab keeps simulating and sending its position.
try {
  const w = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 33)'], { type: 'text/javascript' })));
  w.onmessage = () => { if (document.hidden) frame(performance.now(), true); };
} catch { /* workers unavailable: the tab simply pauses in the background */ }
