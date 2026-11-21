// Smoke-tests GameAudio against a recording mock of the Web Audio API (catches JS errors and non-finite param values).
const bad = [];
const mkParam = (name) => { let v = 0; return new Proxy({}, { get: (_, k) => k === 'value' ? v : (...a) => { if (a.some((x) => typeof x === 'number' && !Number.isFinite(x))) bad.push(name + '.' + String(k) + ' ' + a); }, set: (_, k, val) => { if (k === 'value') { if (!Number.isFinite(val)) bad.push(name + '.value=' + val); v = val; } return true; } }); };
const mkNode = (kind) => { const params = {}; const o = { kind, connect: (d) => d, disconnect() {}, start: (...a) => { if (a.some((x) => typeof x === 'number' && !Number.isFinite(x))) bad.push(kind + '.start ' + a); }, stop() {}, setPeriodicWave() {}, buffer: null, loop: false, type: '', curve: null, oversample: '' };
  return new Proxy(o, { get: (t, k) => k in t ? t[k] : (params[k] ??= mkParam(kind + '.' + String(k))), set: (t, k, v) => { t[k] = v; return true; } }); };
class Ctx { constructor() { this.currentTime = 0; this.sampleRate = 48000; this.destination = mkNode('dest'); }
  resume() {} createGain() { return mkNode('gain'); } createOscillator() { return mkNode('osc'); } createBiquadFilter() { return mkNode('biquad'); }
  createDynamicsCompressor() { return mkNode('comp'); } createConvolver() { return mkNode('conv'); } createWaveShaper() { return mkNode('shaper'); }
  createStereoPanner() { return mkNode('pan'); } createBufferSource() { return mkNode('src'); } createPeriodicWave(r, i) { if (r.length !== i.length) bad.push('wave len'); return {}; }
  createBuffer(ch, n, sr) { const d = new Float32Array(n); return { getChannelData: () => d }; } }
globalThis.window = { AudioContext: Ctx };
const { GameAudio } = await import('../public/js/core/Audio.js');
const { Vehicle, TUNING } = await import('../public/js/physics/Vehicle.js');
const { CARS, tuningFor } = await import('../public/js/vehicle/cars.js');
const a = new GameAudio(); a.setCar('blaze'); a.start();
for (const def of CARS) {
  a.setCar(def.id); const v = new Vehicle(tuningFor(def)); v.reset(0, 0, 0);
  for (let i = 0; i < 60 * 25; i++) {
    const phase = i / 60, inp = { throttle: phase % 12 < 8 ? 1 : 0, brake: phase % 12 > 9 ? 1 : 0, steer: Math.sin(phase) , handbrake: phase > 20 && phase < 21, nitro: phase > 5 && phase < 8 };
    v.update(1 / 60, inp, phase > 14 && phase < 16);
    a.ctx.currentTime += 1 / 60; a.update(v, inp.throttle);
    if (i % 3 === 0) a.updateRemote('r1', def.id, { x: 30 + i * 0.1, z: 10, vx: 20, vz: 5, speed: 25, longAccel: 1, sliding: i % 200 > 100, handbrake: false }, { x: 0, z: 0, fx: 0, fz: 1, vx: 0, vz: 0 }, false);
  }
  a.impact(20); a.impact(3); a.silence();
}
a.removeRemote('r1'); a.removeRemote('nope');
console.log(bad.length ? 'PROBLEMS:\n' + bad.slice(0, 10).join('\n') : 'audio smoke test OK (no errors, no non-finite values)');
