import { followMatrix, fitMatrix, apply, matScale, followRange, northOnScreen } from './minimapMath.js';

/** Closed Path2D through every `step`-th centre-line sample, in world coordinates (x, z). */
export function trackPath(track, step = 3) {
  const p = new Path2D();
  for (let i = 0; i < track.n; i += step) (i ? p.lineTo(track.px[i], track.pz[i]) : p.moveTo(track.px[i], track.pz[i]));
  p.closePath(); return p;
}
function roundedRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function drawRoad(g, track, path, m, mini, minPx) {
  const s = matScale(m), road = Math.max(track.roadWidth, minPx / s);
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.lineWidth = road + 3.2 / s; g.strokeStyle = 'rgba(0,0,0,.82)'; g.stroke(path);
  g.lineWidth = road; g.strokeStyle = mini.road; g.stroke(path);
  // start / finish bar
  const nx = -track.tz[0], nz = track.tx[0], hw = road * 0.62; g.lineCap = 'butt';
  g.beginPath(); g.moveTo(track.px[0] - nx * hw, track.pz[0] - nz * hw); g.lineTo(track.px[0] + nx * hw, track.pz[0] + nz * hw);
  g.lineWidth = 5.2 / s; g.strokeStyle = '#000'; g.stroke(); g.lineWidth = 3 / s; g.strokeStyle = '#ff2a2a'; g.stroke();
}

/** Static preview of a map for the selection screen. */
export function drawThumbnail(canvas, def, track) {
  const g = canvas.getContext('2d'), w = canvas.width, h = canvas.height, th = def.theme;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = th.ground.base; g.fillRect(0, 0, w, h);
  const v = g.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, w * 0.7); v.addColorStop(0, 'rgba(0,0,0,.15)'); v.addColorStop(1, 'rgba(0,0,0,.6)');
  g.fillStyle = v; g.fillRect(0, 0, w, h);
  const m = fitMatrix(track.bounds, w, h, Math.round(h * 0.14));
  g.setTransform(...m); drawRoad(g, track, trackPath(track, 4), m, th.mini, Math.max(3, w / 55));
  g.setTransform(1, 0, 0, 1, 0, 0);
}

export class Minimap {
  constructor(canvas) {
    this.c = canvas; this.g = canvas.getContext('2d'); this.mode = 'follow'; this.R = 130; this.size = 200; this.dpr = 1;
    this.track = null; this.path = null; this.fullM = null;
    this._fit();
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this._fit()).observe(canvas);
  }
  _fit() {
    const S = this.c.clientWidth || 200, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (S === this.size && dpr === this.dpr && this.c.width === Math.round(S * dpr)) return;
    this.size = S; this.dpr = dpr; this.c.width = this.c.height = Math.round(S * dpr);
    if (this.track) this.fullM = fitMatrix(this.track.bounds, S, S, 16);
  }
  setMap(def, track) {
    this.def = def; this.track = track; this.mini = def.theme.mini; this.path = trackPath(track);
    this.fullM = fitMatrix(track.bounds, this.size, this.size, 16);
  }
  setMode(mode) {
    this.mode = mode;
    this.c.classList.toggle('hidden', mode === 'off'); this.c.classList.toggle('round', mode === 'follow');
  }
  /** me: {x,z,heading,speed}; others: [{x,z,color,away}] */
  draw(me, others, dt) {
    if (this.mode === 'off' || !this.track) return;
    const g = this.g, S = this.size, dpr = this.dpr, follow = this.mode === 'follow';
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, S, S);
    g.save();
    if (follow) { g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2); } else roundedRect(g, 1, 1, S - 2, S - 2, 14);
    g.clip();
    g.globalAlpha = 0.88; g.fillStyle = this.mini.bg; g.fillRect(0, 0, S, S); g.globalAlpha = 1;

    let m;
    if (follow) {
      this.R += (followRange(me.speed) - this.R) * (1 - Math.exp(-3 * dt));
      m = followMatrix(me.x, me.z, me.heading, (S / 2) / this.R, S / 2, S * 0.6);
    } else m = this.fullM;
    g.setTransform(m[0] * dpr, m[1] * dpr, m[2] * dpr, m[3] * dpr, m[4] * dpr, m[5] * dpr);
    drawRoad(g, this.track, this.path, m, this.mini, follow ? 5 : 4);

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const o of others) {
      if (o.away) continue;
      const [x, y] = apply(m, o.x, o.z);
      g.beginPath(); g.arc(x, y, 4.6, 0, Math.PI * 2); g.fillStyle = '#' + o.color.toString(16).padStart(6, '0'); g.fill();
      g.lineWidth = 1.6; g.strokeStyle = '#fff'; g.stroke();
    }
    const [mx, my] = follow ? [S / 2, S * 0.6] : apply(m, me.x, me.z);
    g.save(); g.translate(mx, my); g.rotate(follow ? 0 : Math.PI - me.heading);
    g.beginPath(); g.moveTo(0, -8.5); g.lineTo(6.2, 7); g.lineTo(0, 3.6); g.lineTo(-6.2, 7); g.closePath();
    g.fillStyle = '#ff2a2a'; g.fill(); g.lineWidth = 1.6; g.strokeStyle = '#fff'; g.stroke(); g.restore();

    if (follow) { // compass: N sits on the rim in the direction of north
      const [nx, ny] = northOnScreen(me.heading), r = S / 2 - 11;
      g.font = '800 11px "Segoe UI",Arial,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.8)'; g.fillStyle = '#fff';
      g.strokeText('N', S / 2 + nx * r, S / 2 + ny * r); g.fillText('N', S / 2 + nx * r, S / 2 + ny * r);
    }
    g.restore();
    g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,.28)';
    if (follow) { g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2); g.stroke(); } else { roundedRect(g, 1, 1, S - 2, S - 2, 14); g.stroke(); }
  }
}
