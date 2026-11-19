/** Procedural engine / tyre / impact audio (no asset files). */
export class GameAudio {
  constructor() { this.ctx = null; this.volume = 0.5; }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.connect(c.destination);
    this.filter = c.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 900;
    this.engineGain = c.createGain(); this.engineGain.gain.value = 0;
    this.oscs = [['sawtooth', 1, 0.5], ['square', 0.5, 0.3], ['sawtooth', 1.01, 0.3]].map(([type, mul, g]) => {
      const o = c.createOscillator(); o.type = type; const og = c.createGain(); og.gain.value = g;
      o.connect(og).connect(this.filter); o.start(); return { o, mul };
    });
    this.filter.connect(this.engineGain).connect(this.master);
    const len = c.sampleRate * 1.5, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const loop = (freq, q) => {
      const s = c.createBufferSource(); s.buffer = buf; s.loop = true;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); g.gain.value = 0; s.connect(f).connect(g).connect(this.master); s.start(); return g;
    };
    this.screech = loop(2300, 3); this.wind = loop(500, 0.6);
    this.setVolume(this.volume);
  }

  setVolume(v) { this.volume = v; if (this.ctx) this.master.gain.value = v; }

  update(car, throttle) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, f = car.rpm / 30;
    this.oscs.forEach(({ o, mul }) => o.frequency.setTargetAtTime(f * mul, t, 0.03));
    this.filter.frequency.setTargetAtTime(500 + car.rpm * 0.35 + (car.nitroActive ? 600 : 0), t, 0.05);
    this.engineGain.gain.setTargetAtTime(0.1 + 0.16 * (throttle ? 1 : 0.4) + car.rpmNorm * 0.06, t, 0.05);
    this.screech.gain.setTargetAtTime(car.sliding ? Math.min(0.22, Math.abs(car.vR) * 0.012) : 0, t, 0.05);
    this.wind.gain.setTargetAtTime(Math.min(0.12, car.speed * 0.0016) + (car.nitroActive ? 0.06 : 0), t, 0.1);
  }

  silence() {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    [this.engineGain, this.screech, this.wind].forEach((g) => g.gain.setTargetAtTime(0, t, 0.05));
  }

  impact(strength) {
    if (!this.ctx) return;
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
    const g = c.createGain(), t = c.currentTime;
    g.gain.setValueAtTime(Math.min(0.9, strength * 0.04), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    s.connect(f).connect(g).connect(this.master); s.start(t, Math.random()); s.stop(t + 0.4);
  }
}
