/**
 * Map catalogue. Pure data (no Three.js import) so the server can validate map ids with the very same list the
 * client renders from. A map = track layout + visual theme + a list of scenery props.
 *
 * Track: closed centre-line through `control` [x, z] points (Catmull-Rom, centripetal). Start/finish is control[0],
 * the car drives towards control[1]. `samples` = number of centre-line samples (omit to pick ~2.6 m spacing).
 */
export const DEFAULT_MAP = 'sunset';

const SUNSET = {
  id: 'sunset', name: 'SUNSET CIRCUIT', tag: 'Golden-hour city loop. Fast, flowing, forgiving.', difficulty: 2,
  roadWidth: 16, samples: 900, seed: 7,
  control: [[0, 0], [140, -8], [280, 40], [380, 150], [360, 290], [240, 360], [110, 320],
    [40, 430], [-90, 480], [-230, 420], [-280, 290], [-200, 190], [-250, 70], [-150, -40]],
  theme: {
    sky: { top: 0x1b3566, horizon: 0xe39a6e, glow: [1, 0.55, 0.25], disc: [1, 0.82, 0.55], stars: 0 },
    sun: { dir: [0.75, 0.22, -0.5], color: 0xffb27a, intensity: 3.0 },
    hemi: { sky: 0x9bb4e6, ground: 0x5a4636, intensity: 0.9 },
    exposure: 0.95, fog: [120, 1100],
    ground: { base: '#41612c', speck: ['#4c7233', '#375424', '#587a35', '#44652d'] },
    road: { base: '#2a2c31', speck: ['#34373d', '#212327', '#3b3e44'], edge: '#e9e9e9', centre: '#f2f2f2', roughness: 0.85 },
    kerb: ['#d11a1a', '#d8d8d8'], barrier: [0xd21a1a, 0xe6e6e6],
    lamp: { glow: [1, 0.82, 0.55], strength: 3, spacing: 72 },
    mountains: { kind: 'cone', count: 26, color: 0x353b5c, ring: 1050, center: [50, 200], h: [90, 260] },
    buildings: {
      solid: 30, skyline: 40, gap: 34, h: [14, 54], sky: [70, 220], emissive: 1.1, skyRing: 650, center: [70, 200],
      area: { x: [-460, 480], z: [-330, 570] }, lit: [['#3a4150', 0.35], ['#2c3a4d', 0.5], ['#4a3f3a', 0.25]],
      glow: ['#ffc977'], face: '#ffe2a8',
    },
    trees: { count: 520, palette: [0x2f6b2f, 0x3c7a34, 0x4a8a3a, 0x6f8a2c], rare: 0xc9822b, area: { x: [-480, 520], z: [-380, 620] } },
    signs: [['TURBO', '#0b6bd1'], ['VELOCITY', '#c8101e'], ['NITRO+', '#e08a00'], ['APEX', '#14a05a']],
    mini: { bg: '#1a2230', road: '#e8ebf0' },
  },
  props: [],
};

const NEON = {
  id: 'neon', name: 'NEON HARBOR', tag: 'Night street circuit between container stacks. Tight and technical.', difficulty: 4,
  roadWidth: 15, seed: 21,
  control: [[0, 0], [110, 22], [230, -28], [330, 10], [375, 90], [330, 170], [310, 250], [360, 310], [375, 390], [310, 445],
    [200, 440], [140, 385], [70, 390], [20, 445], [-70, 440], [-140, 390], [-150, 300], [-135, 200], [-145, 100], [-85, 35]],
  theme: {
    sky: { top: 0x02030a, horizon: 0x2a1450, glow: [0.55, 0.35, 1.0], disc: [0.8, 0.9, 1.0], stars: 0.9 },
    sun: { dir: [-0.45, 0.4, 0.6], color: 0x7f9cff, intensity: 1.1 },
    hemi: { sky: 0x3a4290, ground: 0x0b0b18, intensity: 0.65 },
    exposure: 1.0, fog: [80, 900],
    ground: { base: '#15171e', speck: ['#1c1f28', '#101218', '#23262f'] },
    road: { base: '#1a1b22', speck: ['#22242c', '#14151a', '#2a2c35'], edge: '#19e6ff', centre: '#ff3ea5', roughness: 0.5 },
    kerb: ['#ff3ea5', '#19e6ff'], barrier: [0x19e6ff, 0x1a1c28],
    lamp: { glow: [1, 0.25, 0.75], strength: 4, spacing: 60 },
    mountains: null,
    buildings: {
      solid: 46, skyline: 70, gap: 24, h: [24, 70], sky: [90, 200], emissive: 1.5, skyRing: 560,
      lit: [['#1a2236', 0.55], ['#241a3a', 0.6], ['#14262f', 0.5]],
      glow: ['#19e6ff', '#ff3ea5', '#ffd35a', '#ffffff'], face: null,
    },
    trees: null,
    signs: [['NEON', '#ff3ea5'], ['HARBOR', '#19e6ff'], ['DOCKS', '#a855f7'], ['24/7', '#ffb020']], signGlow: 1.4,
    mini: { bg: '#0a0b18', road: '#6df0ff' },
  },
  props: ['water', 'containers', 'cranes'],
};

const DUNES = {
  id: 'dunes', name: 'DUNE CANYON', tag: 'Long, wide desert sweepers. Flat out and keep it tidy.', difficulty: 3,
  roadWidth: 18, seed: 5,
  control: [[0, 0], [180, 20], [360, -30], [520, 40], [600, 170], [560, 320], [430, 380], [330, 300], [230, 330], [200, 450],
    [100, 540], [-60, 520], [-150, 420], [-120, 300], [-220, 220], [-250, 90], [-150, -20]],
  theme: {
    sky: { top: 0x2b6cb0, horizon: 0xf0d9a8, glow: [1, 0.85, 0.55], disc: [1, 0.95, 0.8], stars: 0 },
    sun: { dir: [0.35, 0.62, -0.35], color: 0xfff0d0, intensity: 3.3 },
    hemi: { sky: 0xbcd8ff, ground: 0xc9a36b, intensity: 1.0 },
    exposure: 1.0, fog: [150, 1500],
    ground: { base: '#d1ab6b', speck: ['#dcb979', '#c19a5c', '#e4c487', '#c8a263'] },
    road: { base: '#4a4742', speck: ['#57534d', '#3d3b37', '#625e57'], edge: '#f2efe6', centre: '#f0e6c8', roughness: 0.9 },
    kerb: ['#e58a1f', '#f4efe6'], barrier: [0xe58a1f, 0xf1ece0],
    lamp: null,
    mountains: { kind: 'mesa', count: 22, color: 0xb35b34, ring: 1250, h: [70, 190] },
    buildings: null, trees: null,
    signs: [['DUNES', '#e08a00'], ['CANYON', '#c8101e'], ['MIRAGE', '#0b6bd1'], ['OASIS', '#14a05a']],
    mini: { bg: '#3a2c1a', road: '#f4e3c0' },
  },
  props: ['dunes', 'rocks', 'cacti'],
};

const FROST = {
  id: 'frost', name: 'FROSTBITE PASS', tag: 'Snowy mountain road with hairpins and heavy fog. Brake early.', difficulty: 5,
  roadWidth: 15, seed: 33,
  control: [[0, 0], [120, -20], [220, -90], [330, -70], [390, 20], [340, 115], [230, 125], [170, 200], [225, 280], [330, 300],
    [395, 380], [340, 470], [220, 480], [140, 420], [60, 450], [-30, 510], [-140, 480], [-180, 380], [-140, 310], [-195, 235],
    [-250, 140], [-200, 40], [-100, 10]],
  theme: {
    sky: { top: 0x4f78a6, horizon: 0xe3ecf5, glow: [0.9, 0.95, 1.0], disc: [1, 1, 0.95], stars: 0 },
    sun: { dir: [0.3, 0.32, -0.7], color: 0xe4eeff, intensity: 2.1 },
    hemi: { sky: 0xd4e4ff, ground: 0x9fb2c8, intensity: 1.05 },
    exposure: 1.0, fog: [60, 820],
    ground: { base: '#e4ebf3', speck: ['#f4f8fc', '#d3deea', '#ffffff', '#c9d6e4'] },
    road: { base: '#30353b', speck: ['#3a4047', '#262a2f', '#444a52'], edge: '#e9edf2', centre: '#f2c230', roughness: 0.75 },
    kerb: ['#1b6fd1', '#f4f7fa'], barrier: [0x1b6fd1, 0xf1f5f9],
    lamp: { glow: [1, 0.85, 0.6], strength: 3, spacing: 64 },
    mountains: { kind: 'cone', count: 28, color: 0x5a6475, ring: 1050, h: [110, 280], snow: true },
    buildings: null,
    trees: { count: 800, palette: [0x20463a, 0x2b5645, 0x1f3f33], rare: null, snow: 0.78 },
    signs: [['FROST', '#1b6fd1'], ['SUMMIT', '#c8101e'], ['ALPINE', '#0b6bd1'], ['PASS', '#14a05a']],
    mini: { bg: '#1c2733', road: '#ffffff' },
  },
  props: ['snowfall'],
};

const SPEEDWAY = {
  id: 'speedway', name: 'GRAND SPEEDWAY', tag: 'Huge, wide oval with grandstands. Pure top speed and nitro.', difficulty: 1,
  roadWidth: 22, seed: 11,
  control: [[0, 0], [200, 0], [400, -10], [560, 20], [650, 100], [640, 220], [540, 290], [380, 300], [200, 300], [60, 290],
    [-60, 270], [-140, 200], [-140, 90], [-80, 20]],
  theme: {
    sky: { top: 0x2c6fd6, horizon: 0xcfe6ff, glow: [1, 0.95, 0.8], disc: [1, 1, 0.9], stars: 0 },
    sun: { dir: [0.45, 0.55, -0.4], color: 0xfff4e0, intensity: 3.0 },
    hemi: { sky: 0xbfd9ff, ground: 0x6b8a55, intensity: 1.0 },
    exposure: 0.95, fog: [140, 1300],
    ground: { base: '#4f8a3a', speck: ['#5a9a43', '#437a31', '#68a84a', '#4a8236'] },
    road: { base: '#2c2e33', speck: ['#34373d', '#212327', '#3b3e44'], edge: '#ffffff', centre: '#f2f2f2', roughness: 0.8 },
    kerb: ['#f2c230', '#161616'], barrier: [0x1e6bff, 0xf4f4f4],
    lamp: null,
    mountains: { kind: 'hill', count: 24, color: 0x6f8f5f, ring: 1100, h: [30, 80] },
    buildings: { solid: 0, skyline: 26, gap: 40, h: [14, 40], sky: [50, 120], emissive: 0.8, skyRing: 800, lit: [['#5a6272', 0.2], ['#48546a', 0.25]], glow: ['#ffe2a8'], face: '#ffe2a8' },
    trees: { count: 160, palette: [0x2f6b2f, 0x3c7a34, 0x4a8a3a], rare: null },
    signs: [['SPEEDWAY', '#c8101e'], ['GRAND', '#0b6bd1'], ['PRIX', '#e08a00'], ['APEX', '#14a05a']],
    mini: { bg: '#16261a', road: '#e8ebf0' },
  },
  props: ['grandstands', 'floodlights'],
};

export const MAPS = [SUNSET, NEON, DUNES, FROST, SPEEDWAY];
export const MAP_IDS = MAPS.map((m) => m.id);
export const isMap = (id) => typeof id === 'string' && MAP_IDS.includes(id);
export const getMap = (id) => MAPS.find((m) => m.id === id) || MAPS[0];
