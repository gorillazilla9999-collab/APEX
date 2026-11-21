import { voiceFor, firingHz, harmonicSeries, driveCurve, rpmForSpeed, dopplerRatio, panFor, frontness, distanceGain } from './audioMath.js';
import { getCar, tuningFor } from '../vehicle/cars.js';

/**
 * Procedural car audio (no asset files).
 *  - Engine: firing-frequency harmonic stack (per-car voice) + sub-octave + detuned bank, through a soft-clip "exhaust",
 *    resonant exhaust/intake filters, idle lumpiness, induction noise, gearbox whine, turbo whistle and blow-off.
 *  - Events: shift dips, downshift blips, overrun crackle, nitro ignition/roar, tyre squeal (cornering, braking, handbrake),
 *    road / gravel / wind beds, layered crash sounds.
 *  - Space: small synthetic reverb + master compressor.
 *  - Multiplayer: every other car has its own positional engine voice (distance, stereo pan, Doppler).
 */
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const tc = (p, v, t, k) => { if (Number.isFinite(v)) p.setTargetAtTime(v, t, k); };

function pinkNoise(c, secs) {
  const n = (c.sampleRate * secs) | 0, b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) { // Paul Kellet's pink-noise filter
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
  }
  return b;
}
function makeIR(c, secs = 1.3) { // decaying stereo noise that gets duller over time, like air absorbing the highs
  const n = (c.sampleRate * secs) | 0, b = c.createBuffer(2, n, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch); let lp = 0;
    for (let i = 0; i < n; i++) { const t = i / n; lp += ((Math.random() * 2 - 1) - lp) * (0.9 - 0.8 * t); d[i] = lp * Math.pow(1 - t, 3.2) * 0.6; }
  }
  return b;
}

export class GameAudio {
  constructor() {
    this.ctx = null; this.volume = 0.5; this.carId = 'apex'; this.voice = voiceFor('apex');
    this.remotes = new Map(); this.waves = new Map();
    this.prev = { gear: 1, nitro: false, thr: 0, nextPop: 0, boost: 0, t: 0 };
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC({ latencyHint: 'interactive' });
    this.master = c.createGain();
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 18; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(comp).connect(c.destination);
    this.out = c.createGain(); this.out.connect(this.master); // everything goes through here: dry + reverb send
    const verb = c.createConvolver(); verb.buffer = makeIR(c);
    const send = c.createGain(); send.gain.value = 0.16; this.out.connect(send).connect(verb).connect(this.master);
    this.noiseBuf = pinkNoise(c, 3);
    this.beds = [];
    this._buildEngine(); this._buildBeds();
    this.setVolume(this.volume); this.setCar(this.carId);
  }

  setVolume(v) { this.volume = v; if (this.ctx) this.master.gain.value = v; }

  setCar(id) {
    this.carId = id; this.voice = voiceFor(id);
    if (!this.ctx) return;
    const e = this.eng, v = this.voice;
    const w = this._wave(id); e.main.setPeriodicWave(w); e.det.setPeriodicWave(w);
    e.det.detune.value = v.detune; e.subG.gain.value = 0.22 * v.sub;
    e.turbo.gain.value = 0; e.prevBoost = 0;
    this.prev.boost = 0;
  }

  _wave(id) {
    let w = this.waves.get(id);
    if (!w) { const { real, imag } = harmonicSeries(voiceFor(id)); w = this.ctx.createPeriodicWave(real, imag); this.waves.set(id, w); }
    return w;
  }
  _noise(type, freq, q, dest = this.out) {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.value = 0; s.connect(f).connect(g).connect(dest); s.start(0, Math.random() * 2);
    return { f, g, s };
  }
  _osc(type, freq = 60) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.start(); return o; }

  _buildEngine() {
    const c = this.ctx, e = this.eng = {};
    e.mix = c.createGain(); e.mix.gain.value = 0.6;
    e.main = this._osc('sawtooth'); e.det = this._osc('sawtooth'); e.sub = this._osc('sine');
    const mg = c.createGain(), dg = c.createGain(); mg.gain.value = 0.5; dg.gain.value = 0.35; e.subG = c.createGain();
    e.main.connect(mg).connect(e.mix); e.det.connect(dg).connect(e.mix); e.sub.connect(e.subG).connect(e.mix);
    e.shaper = c.createWaveShaper(); e.shaper.curve = driveCurve(2.6); e.shaper.oversample = '2x';
    e.lp = c.createBiquadFilter(); e.lp.type = 'lowpass'; e.lp.frequency.value = 900; e.lp.Q.value = 0.8;
    e.exh = c.createBiquadFilter(); e.exh.type = 'peaking'; e.exh.frequency.value = 200; e.exh.gain.value = 6; e.exh.Q.value = 1.2;
    e.int = c.createBiquadFilter(); e.int.type = 'peaking'; e.int.frequency.value = 1000; e.int.gain.value = 3; e.int.Q.value = 1.5;
    e.gain = c.createGain(); e.gain.gain.value = 0;
    e.duck = c.createGain(); e.duck.gain.value = 1; // shift dips; the idle-lump LFO also rides on this
    e.mix.connect(e.shaper).connect(e.lp).connect(e.exh).connect(e.int).connect(e.gain).connect(e.duck).connect(this.out);
    e.lfo = this._osc('sine', 9); e.lfoG = c.createGain(); e.lfoG.gain.value = 0; e.lfo.connect(e.lfoG).connect(e.duck.gain);
    e.intake = this._noise('bandpass', 900, 0.8);                  // induction roar
    e.whineO = this._osc('triangle', 300); e.whine = c.createGain(); e.whine.gain.value = 0; e.whineO.connect(e.whine).connect(this.out);
    e.turboO = this._osc('sine', 2000); e.turbo = c.createGain(); e.turbo.gain.value = 0; e.turboO.connect(e.turbo).connect(this.out);
    e.nitro = this._noise('bandpass', 1200, 0.9);                  // nitro roar
    this.beds.push(e.gain, e.intake.g, e.whine, e.turbo, e.nitro.g);
  }
  _buildBeds() {
    this.road = this._noise('lowpass', 400, 0.7); this.gravel = this._noise('bandpass', 900, 0.8);
    this.screech = this._noise('bandpass', 1800, 6); this.scrub = this._noise('bandpass', 750, 1.4);
    this.wind = this._noise('bandpass', 500, 0.5);
    this.beds.push(this.road.g, this.gravel.g, this.screech.g, this.scrub.g, this.wind.g);
  }

  /** Player car. Called every frame while driving. */
  update(car, throttle) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime, v = this.voice, e = this.eng, P = this.prev;
    const dt = clamp(t - P.t || 0.016, 0.001, 0.1); P.t = t;
    const rpm = car.rpm, rn = car.rpmNorm, speed = car.speed, thr = clamp(+throttle || 0, 0, 1);
    const load = thr * (car.reversing ? 0.6 : 1), nitro = !!car.nitroActive;

    // --- engine note ---
    const f0 = firingHz(rpm, v.cyl);
    tc(e.main.frequency, f0, t, 0.02); tc(e.det.frequency, f0, t, 0.02); tc(e.sub.frequency, f0 / 2, t, 0.02);
    tc(e.lfo.frequency, rpm / 120, t, 0.05);
    tc(e.lfoG.gain, v.lump * 0.3 * (1 - clamp(rn / 0.45, 0, 1)) * (1 - 0.5 * load), t, 0.1);
    tc(e.mix.gain, 0.45 + 0.5 * load + (nitro ? 0.15 : 0), t, 0.05); // more input = more saturation = more growl on throttle
    tc(e.lp.frequency, 650 + rpm * 0.55 * v.bright + load * 1500 + (nitro ? 900 : 0), t, 0.04);
    tc(e.lp.Q, 0.7 + load * 0.8, t, 0.08);
    tc(e.exh.frequency, 150 + rn * 150, t, 0.05); tc(e.exh.gain, 4 + 5 * load, t, 0.08);
    tc(e.int.frequency, 700 + rpm * 0.12, t, 0.05);
    const overrun = thr < 0.1 && rn > 0.25;
    tc(e.gain.gain, (0.1 + 0.15 * load + 0.07 * rn) * (overrun ? 0.7 : 1), t, 0.045);
    tc(e.intake.g.gain, 0.22 * load * Math.pow(rn, 1.2), t, 0.06); tc(e.intake.f.frequency, 500 + rpm * 0.4, t, 0.05);
    tc(e.whineO.frequency, 90 + speed * 14, t, 0.05);
    tc(e.whine.gain, v.whine * 0.012 * Math.min(1, speed / 30) * (0.4 + 0.6 * load), t, 0.1);

    // --- turbo ---
    P.boost += (thr * rn - P.boost) * Math.min(1, dt * 3);
    if (v.turbo) {
      tc(e.turboO.frequency, 1200 + P.boost * 2800, t, 0.05); tc(e.turbo.gain, v.turbo * 0.02 * P.boost * P.boost, t, 0.06);
      if (P.thr > 0.5 && thr < 0.1 && P.boost > 0.4) this._bov(v.turbo * P.boost);
    }

    // --- gearbox events ---
    if (car.gear > P.gear && speed > 4) { // upshift: brief torque cut
      e.duck.gain.cancelScheduledValues(t); e.duck.gain.setValueAtTime(1, t);
      e.duck.gain.linearRampToValueAtTime(0.35, t + 0.03); e.duck.gain.linearRampToValueAtTime(1, t + 0.15);
      if (v.pops > 0.4 && thr > 0.5) this._pop(v.pops * 0.5, 0.05);
    } else if (car.gear < P.gear && speed > 6) { // downshift: rev-match blip
      this._pop(0.5 * v.pops, 0.04);
    }
    P.gear = car.gear;

    // --- throttle lift crackle ---
    if (P.thr > 0.5 && thr < 0.1 && rn > 0.55 && speed > 15) this._burble(v.pops, t);
    if (overrun && speed > 12 && v.pops > 0 && t > P.nextPop) { this._pop(rand(0.25, 0.6) * v.pops); P.nextPop = t + rand(0.08, 0.4) / v.pops; }
    P.thr = thr;

    // --- nitro ---
    if (nitro && !P.nitro) { this._whoosh(1); this._pop(1); }
    if (!nitro && P.nitro) this._bov(0.9);
    P.nitro = nitro;
    tc(e.nitro.g.gain, nitro ? 0.16 : 0, t, nitro ? 0.05 : 0.15); tc(e.nitro.f.frequency, 900 + rn * 1800, t, 0.08);

    // --- tyres / road / wind ---
    const grass = !!car.onGrass;
    tc(this.road.g.gain, Math.min(0.17, speed * 0.0028) * (grass ? 0.3 : 1), t, 0.1); tc(this.road.f.frequency, 260 + speed * 16, t, 0.1);
    tc(this.gravel.g.gain, grass ? Math.min(0.22, 0.02 + speed * 0.0045) : 0, t, 0.08); tc(this.gravel.f.frequency, 700 + speed * 10, t, 0.1);
    const latRatio = Math.abs(car.latAccel) / (22 * (grass ? 0.7 : 1));
    const slide = car.sliding ? clamp(Math.abs(car.vR) * 0.045, 0, 1) : 0;
    const edge = speed > 10 ? clamp((latRatio - 0.78) / 0.22, 0, 1) * 0.45 : 0;        // tyres singing right at the limit
    const lock = car.braking && speed > 22 ? clamp((speed - 22) / 30, 0, 1) * 0.25 : 0; // hard-braking chirp
    const hb = car.handbrake && speed > 8 ? 0.7 : 0;
    const sq = Math.max(slide, edge, lock, hb) * (grass ? 0.2 : 1);
    tc(this.screech.g.gain, sq * 0.2, t, 0.04); tc(this.screech.f.frequency, 1400 + sq * 1100 + rand(-70, 70), t, 0.03);
    tc(this.scrub.g.gain, sq * 0.12, t, 0.05);
    tc(this.wind.g.gain, Math.min(0.16, (speed / 60) ** 2 * 0.2) + (nitro ? 0.05 : 0), t, 0.1); tc(this.wind.f.frequency, 350 + speed * 9, t, 0.1);
  }

  /** Other players' cars: positional voices (distance, pan, Doppler). `L` = listener {x,z,fx,fz,vx,vz}. */
  updateRemote(id, carId, v, L, away = false) {
    if (!this.ctx) return;
    let r = this.remotes.get(id);
    if (!r) r = this._makeRemote(id, carId);
    const c = this.ctx, t = c.currentTime, vo = r.voice;
    const rx = v.x - L.x, rz = v.z - L.z, d = Math.hypot(rx, rz);
    const dg = away ? 0 : distanceGain(d);
    const rpm = rpmForSpeed(v.speed, r.topSpeed), ratio = dopplerRatio(rx, rz, v.vx, v.vz, L.vx, L.vz), fr = frontness(rx, rz, L.fx, L.fz);
    const f0 = firingHz(rpm, vo.cyl) * ratio, load = clamp(0.45 + v.longAccel * 0.08, 0.3, 1);
    tc(r.main.frequency, f0, t, 0.04); tc(r.sub.frequency, f0 / 2, t, 0.04);
    tc(r.lp.frequency, (600 + rpm * 0.45 * vo.bright + load * 700) * (0.6 + 0.4 * Math.max(0, fr)) / (1 + d / 90), t, 0.05);
    tc(r.gain.gain, dg * (0.1 + 0.1 * load), t, 0.05);
    tc(r.sq.g.gain, v.sliding || (v.handbrake && v.speed > 8) ? dg * 0.1 : 0, t, 0.06);
    if (r.pan) tc(r.pan.pan, panFor(rx, rz, L.fx, L.fz), t, 0.05);
  }
  _makeRemote(id, carId) {
    const c = this.ctx, voice = voiceFor(carId), r = { voice, topSpeed: tuningFor(getCar(carId)).topSpeed };
    r.main = this._osc('sawtooth'); r.main.setPeriodicWave(this._wave(carId));
    r.sub = this._osc('sine'); const sg = c.createGain(); sg.gain.value = 0.4 * voice.sub;
    const mix = c.createGain(); mix.gain.value = 0.6; r.main.connect(mix); r.sub.connect(sg).connect(mix);
    const sh = c.createWaveShaper(); sh.curve = driveCurve(2.2);
    r.lp = c.createBiquadFilter(); r.lp.type = 'lowpass'; r.lp.frequency.value = 900; r.lp.Q.value = 0.8;
    r.gain = c.createGain(); r.gain.gain.value = 0;
    r.pan = c.createStereoPanner ? c.createStereoPanner() : null;
    const tail = r.pan || c.createGain(); tail.connect(this.out);
    mix.connect(sh).connect(r.lp).connect(r.gain).connect(tail);
    r.sq = this._noise('bandpass', 1700, 6, tail);
    r.nodes = [r.main, r.sub, r.sq.s]; this.remotes.set(id, r); return r;
  }
  removeRemote(id) {
    const r = this.remotes.get(id); if (!r) return;
    r.nodes.forEach((n) => { try { n.stop(); } catch { /* already stopped */ } });
    [r.lp, r.gain, r.pan, r.sq.g].forEach((n) => n?.disconnect());
    this.remotes.delete(id);
  }
  silenceRemotes() {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    for (const r of this.remotes.values()) { tc(r.gain.gain, 0, t, 0.05); tc(r.sq.g.gain, 0, t, 0.05); }
  }

  silence() {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    this.beds.forEach((g) => tc(g.gain, 0, t, 0.05)); this.silenceRemotes();
  }

  // ---- one-shot effects ----
  _burst(type, freq, q, gain, decay, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay, s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0005, t + decay);
    s.connect(f).connect(g).connect(this.out); s.start(t, Math.random() * 2, decay + 0.05);
  }
  _thump(f1, f2, gain, decay, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(f2, t + decay);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0005, t + decay);
    o.connect(g).connect(this.out); o.start(t); o.stop(t + decay + 0.05);
  }
  _pop(strength, delay = 0) { // exhaust crack
    if (strength <= 0.02) return;
    this._burst('bandpass', rand(180, 420), 1.1, strength * 0.4, rand(0.07, 0.14), delay);
    this._thump(rand(110, 150), 45, strength * 0.22, 0.1, delay);
  }
  _burble(strength, t) { // run of crackles after lifting off
    if (strength <= 0.05) return;
    const n = 1 + Math.round(strength * 3); let d = 0.04;
    for (let i = 0; i < n; i++) { this._pop(rand(0.4, 0.9) * strength, d); d += rand(0.05, 0.16); }
    this.prev.nextPop = t + d + 0.1;
  }
  _bov(strength) { this._burst('highpass', 3200, 0.7, clamp(strength, 0, 1) * 0.14, 0.38); } // blow-off "pssh"
  _whoosh(strength) { this._burst('bandpass', 1400, 0.6, 0.2 * strength, 0.5); this._thump(90, 40, 0.18 * strength, 0.3); }

  /** Short UI/countdown tone. */
  beep(freq = 660, dur = 0.12, vol = 0.2) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = 'square'; o.frequency.value = freq; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.out); o.start(t); o.stop(t + dur + 0.02);
  }
  /** Rising three-note jingle when you cross the finish line. */
  fanfare() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.beep(f, i === 3 ? 0.5 : 0.14, 0.18), i * 130)); }

  impact(strength) {
    if (!this.ctx) return;
    const s = clamp(strength * 0.04, 0, 0.9);
    this._thump(150, 38, s * 0.9, 0.3);                       // body thud
    this._burst('lowpass', 600, 0.7, s, 0.35);                // low crunch
    this._burst('bandpass', 1800, 0.8, s * 0.7, 0.09);        // sharp crack
    if (strength > 8) {                                       // metal clank
      const c = this.ctx, t = c.currentTime;
      for (const m of [1, 1.51, 2.3]) {
        const o = c.createOscillator(), g = c.createGain(); o.type = 'triangle'; o.frequency.value = rand(380, 620) * m;
        g.gain.setValueAtTime(s * 0.08, t); g.gain.exponentialRampToValueAtTime(0.0005, t + rand(0.15, 0.3));
        o.connect(g).connect(this.out); o.start(t); o.stop(t + 0.35);
      }
    }
  }
}
