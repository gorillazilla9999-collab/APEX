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

export const roadTex = () => canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#2a2c31'; g.fillRect(0, 0, w, h);
  speckle(g, w, h, 9000, ['#34373d', '#212327', '#3b3e44'], 2);
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(w * 0.27, 0, w * 0.1, h); g.fillRect(w * 0.63, 0, w * 0.1, h); // tyre wear
  g.fillStyle = '#e9e9e9'; g.fillRect(w * 0.03, 0, 9, h); g.fillRect(w * 0.97 - 9, 0, 9, h);
  g.fillStyle = '#f2f2f2'; g.fillRect(w / 2 - 4, 0, 8, h * 0.3);
});
export const kerbTex = () => canvasTex(64, 128, (g, w, h) => {
  g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, w, h); g.fillStyle = '#d11a1a'; g.fillRect(0, 0, w, h / 2);
});
export const grassTex = () => canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#41612c'; g.fillRect(0, 0, w, h);
  speckle(g, w, h, 14000, ['#4c7233', '#375424', '#587a35', '#44652d'], 3);
}, [700, 700]);
export const checkerTex = () => canvasTex(64, 16, (g) => {
  for (let x = 0; x < 8; x++) for (let y = 0; y < 2; y++) { g.fillStyle = (x + y) % 2 ? '#fff' : '#111'; g.fillRect(x * 8, y * 8, 8, 8); }
});

/** Building facade: returns {map, emissiveMap} sharing one window pattern. */
export function windowTex(base, litChance, rng) {
  const cols = 8, rows = 16, cw = 32, ch = 16, lit = [];
  for (let i = 0; i < cols * rows; i++) lit.push(rng() < litChance);
  const draw = (emissive) => (g) => {
    g.fillStyle = emissive ? '#000' : base; g.fillRect(0, 0, cols * cw, rows * ch);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const on = lit[r * cols + c];
      g.fillStyle = emissive ? (on ? '#ffc977' : '#000') : (on ? '#ffe2a8' : '#141b26');
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
