// Scenery: themes, props beside the road, flat patches in the fields, and
// far-off landmarks. Pure (no canvas): the layout is a function of the level
// number and its segments only, so the same level always looks the same, and
// tests can check every prop against the road.
//
// Scenery is cosmetic. It reads the level (segments, boss position) and never
// changes it.

import { createRng, hashSeed } from '../rng.js';
import { KENNEY, COMPOSITES } from './atlas.js';
import { SCENERY, PROPS } from './sprites.js';
import { rgba32 } from './palette.js';
import { K, FAR } from './view.js';

// ---- themes ----------------------------------------------------------------
// One per level, cycling: farm, forest, village, autumn. Each mixes the props
// and patches differently and tints the grass.
//   grass: RGB multipliers for the grass texels.
//   orange: share of trees that are autumn coloured.
//   roadside: chance of a tree or bush beside the road every 9 units (per side).
//   clusters / patches: weighted choices for the fields.
export const THEMES = [
  {
    name: 'farm', grass: [1.06, 1.05, 0.82], orange: 0.2, roadside: 0.4,
    roadsideMix: [['tall', 3], ['tree', 3], ['bush', 3], ['hay', 1]],
    fieldP: 0.75, clusters: [['hay', 4], ['yard', 3], ['fence', 3], ['trees', 2], ['grove', 1], ['barrels', 1], ['well', 0.6]],
    patchP: 0.55, patches: [['crops', 5], ['pond', 1.2], ['dirt', 1], ['flowers', 1]],
    landmarks: ['windmill'], sky: 'farm',
  },
  {
    name: 'forest', grass: [0.76, 0.88, 0.78], orange: 0.12, roadside: 0.65,
    roadsideMix: [['tall', 5], ['tree', 4], ['sapling', 2], ['bush', 2], ['rocks', 1]],
    fieldP: 0.7, clusters: [['grove', 7], ['trees', 3], ['rocks', 2], ['bushes', 2]],
    patchP: 0.45, patches: [['pond', 3], ['dirt', 1], ['flowers', 1.2]],
    landmarks: ['tower'], sky: 'forest',
  },
  {
    name: 'village', grass: [1, 1, 1], orange: 0.3, roadside: 0.45,
    roadsideMix: [['tall', 3], ['tree', 2], ['bush', 3], ['barrel', 1], ['crate', 1]],
    fieldP: 0.8, clusters: [['yard', 7], ['fence', 2], ['well', 1.5], ['barrels', 2], ['trees', 2], ['grove', 1]],
    patchP: 0.55, patches: [['dirt', 3], ['flowers', 2.5], ['pond', 1]],
    landmarks: ['tower', 'windmill'], sky: 'village',
  },
  {
    name: 'autumn', grass: [1.32, 0.93, 0.5], orange: 0.8, roadside: 0.5,
    roadsideMix: [['tall', 4], ['tree', 3], ['bush', 1], ['pumpkin', 2], ['hay', 1]],
    fieldP: 0.8, clusters: [['grove', 4], ['pumpkins', 3], ['hay', 2], ['trees', 2], ['rocks', 1], ['yard', 1]],
    patchP: 0.55, patches: [['leaves', 4], ['pond', 1], ['dirt', 1], ['crops', 1]],
    landmarks: ['windmill', 'tower'], sky: 'autumn',
  },
];

export function themeFor(level) {
  const i = (Math.max(1, Math.floor(level)) - 1) % THEMES.length;
  return THEMES[i];
}

// ---- prop frames --------------------------------------------------------------
// Size classes by projection scale s (like the trees): 0 near, 1 mid, 2 far,
// 3 very far. Each prop kind has a frame per class (null: not drawn).
export const CLS_S = [0.78, 0.48, 0.25];
export const clsFor = (s) => (s >= CLS_S[0] ? 0 : s >= CLS_S[1] ? 1 : s >= CLS_S[2] ? 2 : 3);
export const S_FAR = K / (K + FAR); // smallest s a prop is drawn at

const kf = (n) => ({ src: 'kenney', n, w: KENNEY[n].w, h: KENNEY[n].h });
const cf = (n) => ({ src: 'comp', n, w: COMPOSITES[n].grid[0].length * 16, h: COMPOSITES[n].grid.length * 16 });
const af = (n) => {
  const rows = SCENERY[n] || PROPS[n];
  if (!rows) throw new Error(`no sprite ${n}`);
  return { src: 'atlas', n, w: rows[0].length, h: rows.length };
};

// FRAMES[kind][alt] = [cls0, cls1, cls2, cls3].
export const FRAMES = {
  tall: [
    [kf('treeTallGreen'), kf('treeGreen'), af('pineM'), af('pineS')],
    [kf('treeTallOrange'), kf('treeOrange'), af('autumnM'), af('autumnS')],
  ],
  tree: [
    [kf('treeGreen'), af('pineM'), af('pineS'), af('pineS')],
    [kf('treeOrange'), af('autumnM'), af('autumnS'), af('autumnS')],
  ],
  sapling: [
    [kf('sapling'), kf('sapling'), af('pineS'), af('pineS')],
    [kf('saplings'), kf('sapling'), af('pineS'), af('pineS')],
  ],
  bush: [
    [af('bushM'), af('bushM'), af('bushS'), af('bushS')],
    [kf('mushrooms'), af('bushM'), af('bushS'), af('bushS')],
  ],
  rocks: [[af('rocksL'), af('rocksM'), af('rockS'), af('rockS')]],
  house: [
    [cf('houseBlue'), af('houseMb'), af('houseSb'), af('houseTb')],
    [cf('houseBlueChimney'), af('houseMb'), af('houseSb'), af('houseTb')],
    [cf('houseRed'), af('houseMr'), af('houseSr'), af('houseTr')],
    [cf('houseRedChimney'), af('houseMr'), af('houseSr'), af('houseTr')],
  ],
  fence: [[kf('fence'), af('fenceM'), af('fenceS'), null]],
  well: [[kf('well'), af('wellM'), af('wellS'), null]],
  barrel: [[af('barrelL'), af('barrelM'), af('barrelS'), null]],
  crate: [[af('crateL'), af('crateM'), af('crateS'), null]],
  hay: [[af('hayL'), af('hayM'), af('hayS'), af('hayS')]],
  pumpkin: [[af('pumpkinL'), af('pumpkinM'), af('pumpkinM'), null]],
};
export const KINDS = Object.keys(FRAMES);
// Kinds that cast a soft shadow at near sizes.
export const SHADOW = new Set(['tall', 'tree', 'sapling', 'house', 'well']);

export function propFrame(kind, alt, s) {
  const set = FRAMES[kind];
  return set[alt % set.length][clsFor(s)];
}

// Worst-case (narrowest) track scale in buffer px per world unit: the view
// makes ppu = min(LW * 0.78, LH * 0.5) / 100 with LW >= 170.
export const PPU_MIN = 1.3;
export const MARGIN = 5; // world units of clear grass between the road and any prop (>= 1 px everywhere)

// Half-width in world units that a prop of this kind can cover at any size class.
const HW = {};
for (const k of KINDS) {
  let m = 0;
  for (const alts of FRAMES[k]) alts.forEach((f, c) => {
    if (!f) return;
    const sMin = c < 3 ? CLS_S[c] : S_FAR;
    m = Math.max(m, f.w / 2 / (PPU_MIN * sMin));
  });
  HW[k] = m;
}
export const propHalfWidth = (kind) => HW[kind];

// ---- landmarks -------------------------------------------------------------------
// World height (units) and how far out from the road edge the centre sits.
export const LANDMARKS = {
  windmill: { height: 85, out: 85 },
  tower: { height: 80, out: 60 },
  castle: { height: 92, out: 85 },
};
export const LM_SIZES = [10, 12, 14, 16, 18, 21, 24, 28, 32, 36, 41, 47, 54, 62, 70, 80, 90, 100, 112];
export const LM_FAR = 1700; // landmarks are drawn up to this far ahead
// Landmarks are hazed less than the floor, so they still read on the horizon.
export const hazeFor = (d) => Math.round(Math.min(0.5, Math.max(0, (d - 300) / 900)) * 8) / 8;

// ---- flat patches (drawn by the floor pass) ------------------------------------
// Sizes in floor texels (1.6 per world unit). Row 0 is the far edge.
export const PATCH_SIZES = {
  pond: [[40, 26], [56, 34], [30, 20]],
  dirt: [[36, 22], [50, 30]],
  flowers: [[30, 16], [42, 20]],
  crops: [[56, 40], [76, 50], [56, 34]],
  leaves: [[44, 28], [60, 36]],
};
export const TEXEL = 1.6; // = floor TEX_PER_UNIT

const hash = (a, b) => {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// Distance (in texels, 4-neighbour) from each mask pixel to the outside.
function edgeDist(mask, w, h) {
  const d = new Int16Array(w * h).fill(999);
  const q = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!mask[i]) { d[i] = 0; continue; }
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { d[i] = 1; q.push(i); continue; }
    if (!mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w]) { d[i] = 1; q.push(i); }
  }
  for (let k = 0; k < q.length; k++) {
    const i = q[k], x = i % w, y = (i / w) | 0;
    const n = d[i] + 1;
    if (x > 0 && d[i - 1] > n) { d[i - 1] = n; q.push(i - 1); }
    if (x < w - 1 && d[i + 1] > n) { d[i + 1] = n; q.push(i + 1); }
    if (y > 0 && d[i - w] > n) { d[i - w] = n; q.push(i - w); }
    if (y < h - 1 && d[i + w] > n) { d[i + w] = n; q.push(i + w); }
  }
  return d;
}

// Wobbly ellipse mask.
function blob(w, h, seed, rect = false) {
  const m = new Uint8Array(w * h);
  const p1 = seed * 6.1, p2 = seed * 2.3;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const nx = (x + 0.5 - w / 2) / (w / 2), ny = (y + 0.5 - h / 2) / (h / 2);
    const a = Math.atan2(ny, nx);
    const r = 0.94 + 0.05 * Math.sin(3 * a + p1) + 0.03 * Math.sin(5 * a + p2);
    const v = rect ? Math.max(Math.abs(nx) ** 4 + Math.abs(ny) ** 4) ** 0.25 : Math.hypot(nx, ny);
    m[y * w + x] = v <= (rect ? 1.0 - 0.02 * Math.sin(2 * a + p1) : r) ? 1 : 0;
  }
  return m;
}

// Half-size copy keeping transparency (0): a texel is opaque when at least
// two of its four sources are, averaging the opaque ones.
function halveAlpha(t) {
  const w = Math.max(1, t.w >> 1), h = Math.max(1, t.h >> 1);
  const data = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let k = 0; k < 4; k++) {
      const sx = Math.min(t.w - 1, x * 2 + (k & 1)), sy = Math.min(t.h - 1, y * 2 + (k >> 1));
      const p = t.data[sy * t.w + sx];
      if (!p) continue;
      r += p & 255; g += (p >>> 8) & 255; b += (p >>> 16) & 255; n += 1;
    }
    if (n >= 2) data[y * w + x] = (0xff000000 | (((b / n) | 0) << 16) | (((g / n) | 0) << 8) | ((r / n) | 0)) >>> 0;
  }
  return { w, h, data };
}

// tiles: { water: Uint32Array(256), dirt: Uint32Array(256) } (16x16 Kenney tiles).
// Returns { kind: [ { w, h, mips: [{ w, h, data }] } per size ] }; data 0 = transparent.
export function buildPatchTextures(tiles) {
  const cols = new Map();
  const c = (hex) => { let v = cols.get(hex); if (v === undefined) { v = rgba32(hex); cols.set(hex, v); } return v; };
  const out = {};
  for (const [kind, sizes] of Object.entries(PATCH_SIZES)) {
    out[kind] = sizes.map(([w, h], vi) => {
      const data = new Uint32Array(w * h);
      const seed = vi * 7 + kind.length;
      const rect = kind === 'crops' || kind === 'flowers';
      const mask = blob(w, h, seed + 1, rect);
      const dist = edgeDist(mask, w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!mask[i]) continue;
        const e = dist[i], hh = hash(x + seed * 131, y + 17);
        let p = 0;
        if (kind === 'pond') {
          // Kenney-style bank: sand on the far side, foam all round, then water.
          const far = y < h * 0.45;
          if (e === 1) p = far ? c('#479f4a') : c('#ffffff');
          else if (e === 2) p = far ? c('#eaa56c') : c('#d4f4ff');
          else if (e === 3) p = c(far ? '#ffffff' : '#a6e8ff');
          else p = tiles.water[(y & 15) * 16 + (x & 15)];
        } else if (kind === 'dirt') {
          if (e === 1) p = hh < 0.5 ? 0 : c('#cf8254');
          else if (e === 2) p = c('#cf8254');
          else p = tiles.dirt[(y & 15) * 16 + (x & 15)];
        } else if (kind === 'flowers') {
          if (e === 1) p = c('#7a4434');
          else {
            p = c((x + y) % 2 ? '#8a5a3c' : '#7a4434');
            if (x % 3 === 1 && y % 3 === 1) p = c(['#e84537', '#ffd23f', '#ffffff', '#d29bff'][(((x / 3) | 0) + ((y / 3) | 0) * 2 + seed) % 4]);
            else if (x % 3 === 1 && y % 3 === 2) p = c('#479f4a');
          }
        } else if (kind === 'crops') {
          // Rows running towards the horizon: crop, crop, soil.
          const green = vi === 2;
          if (e === 1) p = c('#7a4434');
          else if (x % 4 === 0) p = c('#8a5a3c');
          else if (green) p = c(hh < 0.3 ? '#2f6e3c' : x % 4 === 1 ? '#84c669' : '#479f4a');
          else p = c(hh < 0.2 ? '#c99a2e' : x % 4 === 1 ? '#f3d36b' : '#e0b84a');
        } else if (kind === 'leaves') {
          // Scattered leaves, thinning towards the edge.
          if (hh < Math.min(0.55, 0.12 * e)) p = c(['#e38628', '#fdbe53', '#e84537', '#c99a2e'][(hash(x, y + seed) * 4) | 0]);
        }
        data[i] = p;
      }
      const mips = [{ w, h, data }];
      for (let k = 1; k < 4; k++) mips.push(halveAlpha(mips[k - 1]));
      return { w, h, mips };
    });
  }
  return out;
}

// ---- layout ------------------------------------------------------------------------
// level: { level, segments, bossY }. Returns { theme, props, patches, landmarks },
// props sorted by y: { y, x, kind, alt, far } (far: still drawn beyond 280 units);
// patches sorted by y0: { y0, y1, x0, x1, kind, v }; landmarks: { y, x, kind }.
export function buildScenery({ level, segments = [], bossY }) {
  const theme = themeFor(level);
  const rng = createRng(hashSeed('scenery', level));
  const end = bossY + FAR + 160;
  const bridges = segments.filter((s) => s.kind === 'bridge');
  const wet = (y0, y1) => bridges.some((b) => y1 > b.y0 - 7 && y0 < b.y1 + 4);
  const props = [], patches = [], landmarks = [];
  const orange = () => (rng.chance(theme.orange) ? 1 : 0);

  // Flat patches first, so upright props can keep out of ponds and fields.
  for (let y = 10; y < end; y += 24) {
    for (let side = 0; side < 2; side++) {
      if (!rng.chance(theme.patchP)) continue;
      const kind = rng.weighted(theme.patches);
      const v = rng.int(0, PATCH_SIZES[kind].length - 1);
      const [tw, th] = PATCH_SIZES[kind][v];
      const ww = tw / TEXEL, wh = th / TEXEL;
      const out = MARGIN + 2 + rng.range(0, 150);
      const x0 = side ? 100 + out : -out - ww;
      const y0 = y + rng.range(0, 10);
      if (wet(y0, y0 + wh)) continue;
      const p = { y0, y1: y0 + wh, x0, x1: x0 + ww, kind, v };
      if (patches.some((q) => q.y1 + 3 > p.y0 && q.y0 - 3 < p.y1 && q.x1 + 3 > p.x0 && q.x0 - 3 < p.x1)) continue;
      patches.push(p);
    }
  }
  const inPatch = (x, y) => patches.some((p) => p.kind !== 'leaves' && p.kind !== 'flowers' && x > p.x0 - 3 && x < p.x1 + 3 && y > p.y0 - 2 && y < p.y1 + 2);

  function place(kind, alt, x, y, far = false) {
    const hw = HW[kind];
    if (x < 50) x = Math.min(x, -MARGIN - hw);
    else x = Math.max(x, 100 + MARGIN + hw);
    if (wet(y, y)) return;
    if (Math.abs(y - bossY) < 16 && (x < 50 ? -x - hw : x - hw - 100) < 24) return; // keep the boss's flags clear
    if (inPatch(x, y)) return;
    props.push({ y, x, kind, alt, far });
  }

  // Trees and bushes lining the road.
  for (let y = -20; y < end; y += 9) {
    for (let side = 0; side < 2; side++) {
      if (!rng.chance(theme.roadside)) continue;
      const kind = rng.weighted(theme.roadsideMix);
      const alt = kind === 'tall' || kind === 'tree' ? orange() : rng.int(0, 1);
      const off = MARGIN + HW[kind] + rng.range(0, 14);
      place(kind, alt, side ? 100 + off : -off, y + rng.range(0, 6), rng.chance(0.15));
    }
  }

  // Clusters out in the fields.
  const treeKind = () => rng.weighted([['tall', 3], ['tree', 3], ['sapling', 1]]);
  for (let y = 0; y < end; y += 20) {
    for (let side = 0; side < 2; side++) {
      if (!rng.chance(theme.fieldP)) continue;
      const kind = rng.weighted(theme.clusters);
      const out = rng.range(22, 200);
      const x = side ? 100 + out : -out;
      const yy = y + rng.range(0, 10);
      const sgn = side ? 1 : -1;
      switch (kind) {
        case 'yard': {
          place('house', theme.name === 'village' ? rng.int(0, 3) : rng.chance(0.6) ? rng.int(2, 3) : rng.int(0, 1), x, yy, true);
          if (rng.chance(0.55)) place('fence', 0, x + rng.range(-6, 6), yy - 10);
          const n = rng.int(0, 3);
          for (let i = 0; i < n; i++) place(rng.weighted([['barrel', 2], ['crate', 2], ['hay', theme.name === 'farm' ? 3 : 0.5]]), 0, x + sgn * (HW.house + rng.range(2, 9)) * (rng.chance(0.5) ? 1 : -1), yy + rng.range(-4, 3));
          if (rng.chance(0.2)) place('well', 0, x + sgn * rng.range(30, 40), yy + rng.range(-3, 3), true);
          break;
        }
        case 'grove': {
          const n = rng.int(4, 8);
          for (let i = 0; i < n; i++) place(treeKind(), orange(), x + rng.range(-16, 16), yy + rng.range(-10, 12), i === 0);
          break;
        }
        case 'trees': {
          const n = rng.int(1, 3);
          for (let i = 0; i < n; i++) place(treeKind(), orange(), x + rng.range(-10, 10), yy + rng.range(-6, 6), i === 0 && rng.chance(0.5));
          break;
        }
        case 'rocks': {
          const n = rng.int(1, 3);
          for (let i = 0; i < n; i++) place('rocks', 0, x + rng.range(-8, 8), yy + rng.range(-5, 5), i === 0 && rng.chance(0.4));
          break;
        }
        case 'bushes': {
          const n = rng.int(2, 4);
          for (let i = 0; i < n; i++) place('bush', rng.chance(0.3) ? 1 : 0, x + rng.range(-8, 8), yy + rng.range(-5, 5));
          break;
        }
        case 'hay': {
          const n = rng.int(2, 4);
          for (let i = 0; i < n; i++) place('hay', 0, x + rng.range(-12, 12), yy + rng.range(-8, 8), i === 0 && rng.chance(0.4));
          break;
        }
        case 'pumpkins': {
          const n = rng.int(3, 6);
          for (let i = 0; i < n; i++) place('pumpkin', 0, x + rng.range(-9, 9), yy + rng.range(-6, 6));
          break;
        }
        case 'fence':
          place('fence', 0, x, yy, rng.chance(0.3));
          break;
        case 'well': {
          place('well', 0, x, yy, true);
          if (rng.chance(0.6)) place('barrel', 0, x + rng.range(6, 10) * (rng.chance(0.5) ? 1 : -1), yy - 2);
          break;
        }
        default: { // barrels
          const n = rng.int(2, 4);
          for (let i = 0; i < n; i++) place(rng.chance(0.5) ? 'barrel' : 'crate', 0, x + rng.range(-5, 5), yy + rng.range(-3, 3));
        }
      }
    }
  }
  props.sort((a, b) => a.y - b.y);
  patches.sort((a, b) => a.y0 - b.y0);

  // Landmarks: one every ~560 units on alternating sides, then the boss's castle.
  let side = rng.int(0, 1);
  const lmAt = (kind, y) => {
    while (wet(y - 10, y + 10)) y += 20;
    const out = LANDMARKS[kind].out;
    landmarks.push({ y, x: side ? 100 + out : -out, kind });
    side = 1 - side;
  };
  let i = 0;
  for (let y = 380 + rng.range(0, 120); y < bossY - 200; y += 520 + rng.range(0, 120)) lmAt(theme.landmarks[i++ % theme.landmarks.length], y);
  lmAt('castle', bossY + 450); // far enough back to be whole on screen during the fight
  landmarks.sort((a, b) => a.y - b.y);
  return { theme, props, patches, landmarks };
}

// First index in a y-sorted array with key >= y.
export function lowerBound(arr, y, key = 'y') {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (arr[m][key] < y) lo = m + 1; else hi = m;
  }
  return lo;
}
