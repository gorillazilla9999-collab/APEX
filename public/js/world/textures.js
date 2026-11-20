import * as THREE from 'three';

export function canvasTex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const speckle = (g, w, h, n, cols, size) => {
  for (let i = 0; i < n; i++) { g.fillStyle = cols[i % cols.length]; g.fillRect(Math.random() * w, Math.random() * h, size, size); }
};

/** Road surface; `o` comes from a map theme: { base, speck[], edge, centre }. Defaults = the original asphalt. */
export const roadTex = (o = {}) => canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = o.base || '#2a2c31'; g.fillRect(0, 0, w, h);
  speckle(g, w, h, 9000, o.speck || ['#34373d', '#212327', '#3b3e44'], 2);
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(w * 0.27, 0, w * 0.1, h); g.fillRect(w * 0.63, 0, w * 0.1, h); // tyre wear
  g.fillStyle = o.edge || '#e9e9e9'; g.fillRect(w * 0.03, 0, 9, h); g.fillRect(w * 0.97 - 9, 0, 9, h);
  g.fillStyle = o.centre || '#f2f2f2'; g.fillRect(w / 2 - 4, 0, 8, h * 0.3);
});
/** Kerb stripes: `a` = coloured half, `b` = base colour. */
export const kerbTex = (a = '#d11a1a', b = '#d8d8d8') => canvasTex(64, 128, (g, w, h) => {
  g.fillStyle = b; g.fillRect(0, 0, w, h); g.fillStyle = a; g.fillRect(0, 0, w, h / 2);
});
export const grassTex = (base = '#41612c', speck = ['#4c7233', '#375424', '#587a35', '#44652d']) => canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  speckle(g, w, h, 14000, speck, 3);
}, [700, 700]);
export const checkerTex = () => canvasTex(64, 16, (g) => {
  for (let x = 0; x < 8; x++) for (let y = 0; y < 2; y++) { g.fillStyle = (x + y) % 2 ? '#fff' : '#111'; g.fillRect(x * 8, y * 8, 8, 8); }
});

/**
 * Building facade: returns {map, emissiveMap} sharing one window pattern.
 * `glow` = list of lit-window colours for the emissive map (one entry consumes no RNG, so old maps stay identical);
 * `face` = lit-window colour in the albedo map (defaults to the glow colour).
 */
export function windowTex(base, litChance, rng, glow = ['#ffc977'], face = '#ffe2a8') {
  const cols = 8, rows = 16, cw = 32, ch = 16, lit = [], pick = [];
  for (let i = 0; i < cols * rows; i++) { lit.push(rng() < litChance); pick.push(glow.length > 1 ? Math.floor(rng() * glow.length) : 0); }
  const draw = (emissive) => (g) => {
    g.fillStyle = emissive ? '#000' : base; g.fillRect(0, 0, cols * cw, rows * ch);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const on = lit[r * cols + c], col = glow[pick[r * cols + c]];
      g.fillStyle = emissive ? (on ? col : '#000') : (on ? (face || col) : '#141b26');
      g.fillRect(c * cw + 6, r * ch + 3, cw - 12, ch - 7);
    }
  };
  return { map: canvasTex(256, 256, draw(false)), emissiveMap: canvasTex(256, 256, draw(true)) };
}
export const signTex = (text, bg, fg = '#fff') => canvasTex(512, 160, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, bg); gr.addColorStop(1, '#0c0d10');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.font = 'italic 900 78px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 4);
  g.fillStyle = '#ff2a2a'; g.fillRect(0, h - 10, w, 10);
});
/** Grandstand crowd: rows of coloured specks on a dark base. */
export const crowdTex = () => canvasTex(256, 32, (g, w, h) => {
  g.fillStyle = '#23262c'; g.fillRect(0, 0, w, h);
  const cols = ['#d11a1a', '#1e6bff', '#f2c230', '#f4f4f4', '#16a34a', '#ff6a00', '#9333ea', '#e11d8f'];
  for (let i = 0; i < 1500; i++) { g.fillStyle = cols[Math.floor(Math.random() * cols.length)]; g.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
});
