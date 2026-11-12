// Code-drawn pixel sprites (pure data and pure functions, no canvas), so tests
// can check every frame. Each sprite is ASCII art: one character per pixel,
// '.' is transparent, letters index PAL (palette.js) and L/M/D take the team
// colours. Procedural sprites (boss, saw, boulder, rings, orbs) are rasterised
// here with hard edges at each size they are used, so nothing is ever scaled
// by a fractional amount.
//
// Every sprite comes out as { w, h, rgba: Uint8ClampedArray } and the atlas
// adds a 1 px transparent border around it.

import { PAL, TEAMS, rgba } from './palette.js';

// Rows joined from parts, so frames can share an upper body.
const rows = (...parts) => parts.flat();

// ---- soldiers -------------------------------------------------------------
// Player soldiers are seen from BEHIND (running up the track, away from the
// camera): helmet, collar, backpack, alternating legs. Enemies face the camera.
// Three sizes (distance bands): L near, M mid, S far.

const BACK_L_TOP = [
  '...kkkkk...',
  '..kLLLLMk..',
  '.kLLLMMMDk.',
  '.kLMMMMMDk.',
  '.kMMMMMDDk.',
  '.kkDDDDDkk.',
  'kkMkSSSkMkk',
  'kMMkgggkMMk',
  'kMDkgGGkDMk',
  'kskkGGGkksk',
  '.kkDDDDDkk.',
];
const BACK_L_A = [
  '..kDDkDDk..',
  '..kwwkDDk..',
  '..kkk.kwk..',
  '......kk...',
  '..~~~~~~~..',
];
const BACK_L_B = [
  '..kDDkDDk..',
  '..kDDkwwk..',
  '..kwk.kkk..',
  '...kk......',
  '..~~~~~~~..',
];

const BACK_M_TOP = [
  '..kkkk..',
  '.kLLLMk.',
  '.kLMMDk.',
  '.kDDDDk.',
  'kMkGGkMk',
  'kskGGksk',
  '.kDDDDk.',
];
const BACK_M_A = [
  '.kwkDk..',
  '.kkkwk..',
  '....k...',
  '.~~~~~~.',
];
const BACK_M_B = [
  '..kDkwk.',
  '..kwkkk.',
  '...k....',
  '.~~~~~~.',
];

const BACK_S_TOP = [
  '.LMM.',
  'kLMDk',
  'kDDDk',
  'kMGMk',
];
const BACK_S_A = [
  'kwkDk',
  '.k.k.',
  '~~~~~',
];
const BACK_S_B = [
  'kDkwk',
  '.k.k.',
  '~~~~~',
];

const FRONT_L_TOP = [
  '...kkkkk...',
  '..kLLLLMk..',
  '.kLLMMMMDk.',
  '.kMMMMMMDk.',
  '.kDDDDDDDk.',
  '.kSssssSSk.',
  '.kskssksSk.',
  '..kSsssSk..',
  '.kkMMMMMkk.',
  'kMMgggggMMk',
  'kskGGGGGksk',
  '.kkMMMMMkk.',
];
const FRONT_L_A = [
  '..kDDkDDk..',
  '..kwwkDDk..',
  '...kkkwwk..',
  '......kk...',
  '..~~~~~~~..',
];
const FRONT_L_B = [
  '..kDDkDDk..',
  '..kDDkwwk..',
  '..kwwkkk...',
  '...kk......',
  '..~~~~~~~..',
];

const FRONT_M_TOP = [
  '..kkkk..',
  '.kLLLMk.',
  '.kMMMDk.',
  '.kskskk.',
  '.kSssSk.',
  'kMggggMk',
  'kskGGksk',
  '.kDDDDk.',
];
const FRONT_M_A = [
  '.kwkDk..',
  '.kkkwk..',
  '....k...',
  '.~~~~~~.',
];
const FRONT_M_B = [
  '..kDkwk.',
  '..kwkkk.',
  '...k....',
  '.~~~~~~.',
];

const FRONT_S_TOP = [
  '.LMM.',
  'kLMDk',
  'kskSk',
  'kMgMk',
];

export const SOLDIER = {
  back: {
    L: [rows(BACK_L_TOP, BACK_L_A), rows(BACK_L_TOP, BACK_L_B)],
    M: [rows(BACK_M_TOP, BACK_M_A), rows(BACK_M_TOP, BACK_M_B)],
    S: [rows(BACK_S_TOP, BACK_S_A), rows(BACK_S_TOP, BACK_S_B)],
  },
  front: {
    L: [rows(FRONT_L_TOP, FRONT_L_A), rows(FRONT_L_TOP, FRONT_L_B)],
    M: [rows(FRONT_M_TOP, FRONT_M_A), rows(FRONT_M_TOP, FRONT_M_B)],
    S: [rows(FRONT_S_TOP, BACK_S_A), rows(FRONT_S_TOP, BACK_S_B)],
  },
};

// ---- scenery (smaller trees for the mid and far bands; near trees are Kenney tiles)
export const SCENERY = {
  pineM: [
    '....kk....',
    '...kEEk...',
    '...kEek...',
    '..kEeeEk..',
    '..kEeeek..',
    '.kEEeeEEk.',
    '.kEeeeeek.',
    'kEEeeeeEEk',
    'kkEEEEEEkk',
    '..kkWWkk..',
    '....kk....',
  ],
  pineS: [
    '..kk..',
    '.kEek.',
    '.kEek.',
    'kEeeEk',
    'kEEEEk',
    '.kWWk.',
    '..kk..',
  ],
  autumnM: [
    '....kk....',
    '...kCCk...',
    '...kCck...',
    '..kCccCk..',
    '..kCccck..',
    '.kCCccCCk.',
    '.kCcccccCk',
    'kCCccccCCk',
    'kkCCCCCCkk',
    '..kkWWkk..',
    '....kk....',
  ],
  autumnS: [
    '..kk..',
    '.kCck.',
    '.kCck.',
    'kCccCk',
    'kCCCCk',
    '.kWWk.',
    '..kk..',
  ],
  bushM: [
    '..kkkk..',
    '.keeEEk.',
    'keeeeEEk',
    'kEeeEEEk',
    'kEEEEEnk',
    '.kkkkkk.',
  ],
  bushS: [
    '.kkk.',
    'keeEk',
    'kEEnk',
    '.kkk.',
  ],
  rockS: [
    '.kkk.',
    'kggGk',
    'kGGxk',
    '.kkk.',
  ],
};

// ---- village and nature props (mid / far sizes; near ones are Kenney tiles) --
// A small house front in Kenney's style: shingled roof with a gable over the
// door, wall with door and windows. Letters: roof r/rd, wall wl/wd.
export function houseArt(W, H, r, rd, wl, wd) {
  const g = Array.from({ length: H }, () => Array(W).fill('.'));
  const roofH = Math.round(H * 0.58);
  for (let y = 0; y < roofH; y++) for (let x = 0; x < W; x++) {
    const edge = x === 0 || x === W - 1 || y === 0 || y === roofH - 1;
    if (y === 0 && (x === 0 || x === W - 1)) continue;
    g[y][x] = edge ? 'k' : (y % 2 === 0 && (x + y) % 4 === 1 ? rd : r);
  }
  // Gable: a triangle of wall colour under the roof's ridge, over the door.
  const cx = (W - 1) / 2, gh = Math.max(2, Math.round(roofH * 0.55));
  for (let y = roofH - gh; y < roofH; y++) {
    const hw = (y - (roofH - gh)) * 0.9 + 0.6;
    for (let x = 1; x < W - 1; x++) {
      const dx = Math.abs(x - cx);
      if (dx <= hw - 1 && y < roofH - 1) g[y][x] = wl;
      else if (dx <= hw && dx > hw - 1) g[y][x] = 'k';
    }
  }
  for (let y = roofH; y < H; y++) for (let x = 0; x < W; x++) {
    const edge = x === 0 || x === W - 1 || y === H - 1;
    g[y][x] = edge ? 'k' : y === roofH ? wd : wl;
  }
  const wallH = H - roofH;
  // Door (centre) and windows (either side) when there's room.
  const dw = W >= 12 ? 4 : W >= 8 ? 2 : 1, dh = Math.max(1, Math.min(wallH - 1, Math.round(wallH * 0.8)));
  const d0 = Math.round(cx - dw / 2 + 0.5);
  for (let y = H - 1 - dh; y < H - 1; y++) for (let x = d0; x < d0 + dw; x++) {
    g[y][x] = dw >= 4 && (x === d0 || x === d0 + dw - 1 || y === H - 1 - dh) ? 'k' : 'W';
  }
  if (W >= 20 && wallH >= 5) {
    const wy = roofH + 2;
    for (const wx of [2, W - 6]) for (let y = wy; y < wy + 3; y++) for (let x = wx; x < wx + 4; x++) {
      g[y][x] = x === wx || x === wx + 3 || y === wy || y === wy + 2 ? 'k' : 'b';
    }
  }
  return g.map((row) => row.join(''));
}

// Fence: posts every `step` px joined by a rail (3 rows: outline, wood, outline).
function fenceArt(W, step) {
  const n = Math.max(1, Math.round((W - 3) / step));
  const posts = new Set(Array.from({ length: n + 1 }, (_, i) => Math.round((i * (W - 3)) / n)));
  const isPost = (x) => [...posts].some((p) => x >= p && x < p + 3);
  const mid = (x) => [...posts].some((p) => x === p + 1);
  const row = (f) => Array.from({ length: W }, (_, x) => f(x)).join('');
  return [
    row((x) => (isPost(x) ? 'k' : '.')),
    row((x) => (isPost(x) ? (mid(x) ? 'o' : 'k') : '.')),
    row((x) => (isPost(x) && mid(x) ? 'o' : 'k')),
    row((x) => (x === 0 || x === W - 1 ? 'k' : 'o')),
    row((x) => (isPost(x) && mid(x) ? 'w' : 'k')),
    row((x) => (isPost(x) ? (mid(x) ? 'w' : 'k') : '.')),
    row((x) => (isPost(x) ? 'k' : '.')),
  ];
}

export const PROPS = {
  houseMb: houseArt(24, 22, 'G', 'x', 'o', 'w'),
  houseMr: houseArt(24, 22, 'r', 'R', '+', 'G'),
  houseSb: houseArt(14, 12, 'G', 'x', 'o', 'w'),
  houseSr: houseArt(14, 12, 'r', 'R', '+', 'G'),
  houseTb: houseArt(8, 7, 'G', 'x', 'o', 'w'),
  houseTr: houseArt(8, 7, 'r', 'R', '+', 'G'),
  fenceM: fenceArt(24, 10),
  fenceS: [
    'kk....kk....kk',
    'kokkkkookkkkok',
    'kooooooooooook',
    'kokkkkookkkkok',
    'kk....kk....kk',
  ],
  wellM: [
    '..kkkkkk..',
    '.kRrrrrRk.',
    'kRrrrrrrRk',
    'kkkkkkkkkk',
    '.kd....dk.',
    '.kd.kk.dk.',
    '.kd.kk.dk.',
    'kkkkkkkkkk',
    'kgGgGgGgGk',
    'kGgbbbbgGk',
    'kgGgGgGgGk',
    '.kkkkkkkk.',
  ],
  wellS: ['.kkkk.', 'kRrrRk', 'kkkkkk', 'kd..dk', 'kkkkkk', 'kgbbgk', 'kGggGk', '.kkkk.'],
  barrelL: ['.kkkkkk.', 'kwoooowk', 'kwovoowk', 'kGGGGGGk', 'kwoooowk', 'kwoooowk', 'kGGGGGGk', 'kwoooowk', '.kkkkkk.'],
  barrelM: ['.kkkk.', 'kwovwk', 'kGGGGk', 'kwoowk', 'kGGGGk', 'kwoowk', '.kkkk.'],
  barrelS: ['.kk.', 'kovk', 'kGGk', 'kowk', '.kk.'],
  crateL: ['kkkkkkkkk', 'kwwwwwwwk', 'kwoooowwk', 'kwooowowk', 'kwoowoowk', 'kwowooowk', 'kwwoooowk', 'kwwwwwwwk', 'kkkkkkkkk'],
  crateM: ['kkkkkk', 'kwwwwk', 'kowowk', 'kwowok', 'kwwwwk', 'kkkkkk'],
  crateS: ['kkkk', 'kowk', 'kwok', 'kkkk'],
  // Square bales (tan, with two strings) so they never read as coins.
  hayL: ['kkkkkkkkkkkk', 'kvvvHvvvvHvk', 'khhhHhhhhHhk', 'khhhHhhhhHhk', 'khhhHhhhhHhk', 'kHHHdHHHHdHk', 'kkkkkkkkkkkk'],
  hayM: ['kkkkkkkk', 'kvHvvHvk', 'khHhhHhk', 'kHdHHdHk', 'kkkkkkkk'],
  hayS: ['kkkkk', 'khHhk', 'kHdHk', 'kkkkk'],
  pumpkinL: ['....k...', '...kEk..', '.kkkkkk.', 'kpvppPPk', 'kppPppPk', 'kPpPpPPk', '.kkkkkk.'],
  pumpkinM: ['..k..', '.kkk.', 'kpvPk', 'kPpPk', '.kkk.'],
  rocksL: [
    '....kkkk........',
    '...kg+ggk.......',
    '..kg+gggGk.kkk..',
    '..kggggGGkkg+gk.',
    '.kgggGGGxkgggGk.',
    '.kggGGGxxkgGGxk.',
    'kgGGGxxxxkGxxk..',
    'kkkkkkkkkkkkkk..',
  ],
  rocksM: ['..kkk.....', '.kg+gk.kk.', 'kggGGkkggk', 'kgGGxkgGxk', 'kkkkkkkkkk'],
};

// ---- coins (4 spin frames per size) ---------------------------------------
export const COIN = {
  L: [
    ['.kkkkk.', 'kyyyyYk', 'kyvyyYk', 'kyvyyYk', 'kyvyyYk', 'kyyyyYk', '.kkkkk.'],
    ['.kkkk.', 'kyyyYk', 'kvyyYk', 'kvyyYk', 'kvyyYk', 'kyyyYk', '.kkkk.'],
    ['.kkk.', 'kyyYk', 'kvyYk', 'kvyYk', 'kvyYk', 'kyyYk', '.kkk.'],
    ['.kk.', 'kyYk', 'kyYk', 'kyYk', 'kyYk', 'kyYk', '.kk.'],
  ],
  M: [
    ['.kkk.', 'kvyYk', 'kvyYk', 'kyyYk', '.kkk.'],
    ['.kk.', 'kvYk', 'kvYk', 'kyYk', '.kk.'],
    ['.k.', 'kyk', 'kyk', 'kYk', '.k.'],
    ['.k.', 'kyk', 'kyk', 'kYk', '.k.'],
  ],
  S: [
    ['kk', 'yY', 'kk'],
    ['kk', 'yY', 'kk'],
    ['k', 'y', 'k'],
    ['k', 'y', 'k'],
  ],
};

// ---- small icons ------------------------------------------------------------
export const ICONS = {
  // Pickup icons, white on the orb colour.
  rapid: ['..#..', '.#.#.', '#...#', '..#..', '.#.#.', '#...#'],
  spread: ['#.#.#', '#.#.#', '.###.', '..#..', '..#..'],
  rocket: ['..#..', '.###.', '.###.', '.###.', '#####', '#.y.#', '..y..'],
  laser: ['..#..', '..#..', '#####', '..#..', '..#..', '..#..'],
  magnet: ['##.##', '##.##', '#...#', '#...#', '.###.'],
  // Squeeze pad: arrows pointing in.
  squeeze: ['#.......#', '##.....##', '###...###', '##.....##', '#.......#'],
  // Swap badge arrows.
  swap: ['..#....', '.######', '..#....', '....#..', '######.', '....#..'],
  // Ambush warning chevron (drawn twice, stacked).
  chevron: [
    'kk.........kk',
    'krk.......krk',
    'krrk.....krrk',
    '.krrk...krrk.',
    '..krrk.krrk..',
    '...krrkrrk...',
    '....krrrk....',
    '.....krk.....',
    '......k......',
  ],
  crowd: [
    '..kkkk..',
    '.kLLMMk.',
    '.kMMMDk.',
    '.kDDDDk.',
    'kMkGGkMk',
    'kskGGksk',
    '.kDDDDk.',
    '.kDkkDk.',
    '.kwk.kwk',
    '..k...k.',
  ].map((r) => r.slice(0, 8)),
  coin: ['.kkkkk.', 'kyyyyYk', 'kyvyyYk', 'kyvyyYk', 'kyvyyYk', 'kyyyyYk', '.kkkkk.'],
  skull: ['.kkkkk.', 'k#####k', 'k#k#k#k', 'k#####k', '.k#k#k.', '..kkk..'],
};

// ---- rasterising ------------------------------------------------------------
const colourCache = new Map();
function colour(ch, team, teamOutline) {
  if (ch === 'k' && teamOutline && team) ch = 'O';
  const key = ch + (team || '');
  let c = colourCache.get(key);
  if (!c) {
    const t = TEAMS[team || 'blue'];
    const hex = (ch === 'L' || ch === 'M' || ch === 'D' || ch === 'O') ? t[ch] : PAL[ch];
    if (!hex) throw new Error(`unknown sprite colour '${ch}'`);
    c = rgba(hex);
    colourCache.set(key, c);
  }
  return c;
}

// ASCII rows -> { w, h, rgba }. `team` picks the L/M/D colours; `fill`
// replaces '#' (used to tint icons).
export function raster(lines, team, fill, teamOutline = false) {
  const h = lines.length;
  const w = Math.max(...lines.map((l) => l.length));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = lines[y][x];
      if (!ch || ch === '.') continue;
      const c = ch === '#' && fill ? rgba(fill) : colour(ch, team, teamOutline);
      out.set(c, (y * w + x) * 4);
    }
  }
  return { w, h, rgba: out };
}

// Blank sprite to draw into.
export function blank(w, h) { return { w, h, rgba: new Uint8ClampedArray(w * h * 4) }; }
// Pixels a procedural sprite tried to draw outside its own box (i.e. that
// would have been cut off). Tests require this to stay 0.
export const clipStats = { dropped: 0 };
function put(sp, x, y, c) {
  if (x < 0 || y < 0 || x >= sp.w || y >= sp.h) { clipStats.dropped += 1; return; }
  sp.rgba.set(c, (y * sp.w + x) * 4);
}
const at = (sp, x, y) => (x < 0 || y < 0 || x >= sp.w || y >= sp.h ? 0 : sp.rgba[(y * sp.w + x) * 4 + 3]);

// Adds a 1 px outline (in `col`) around every opaque pixel.
export function outline(sp, col = PAL.k) {
  const c = rgba(col);
  const o = blank(sp.w + 2, sp.h + 2);
  for (let y = 0; y < sp.h; y++) for (let x = 0; x < sp.w; x++) {
    if (at(sp, x, y) > 0) o.rgba.set(sp.rgba.subarray((y * sp.w + x) * 4, (y * sp.w + x) * 4 + 4), ((y + 1) * o.w + x + 1) * 4);
  }
  for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) {
    if (at(o, x, y) > 0) continue;
    let near = false;
    for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((dx || dy) && at(sp, x - 1 + dx, y - 1 + dy) > 128) { near = true; break; }
    }
    if (near) put(o, x, y, c);
  }
  return o;
}

// Filled disc of diameter `d` with a shading function (x, y in -1..1) -> colour.
function disc(d, shade) {
  const sp = blank(d, d);
  const r = d / 2;
  for (let y = 0; y < d; y++) for (let x = 0; x < d; x++) {
    const nx = (x + 0.5 - r) / r, ny = (y + 0.5 - r) / r;
    if (nx * nx + ny * ny <= 1) { const c = shade(nx, ny); if (c) put(sp, x, y, rgba(c)); }
  }
  return sp;
}

// ---- procedural sprites ------------------------------------------------------
// Boss: a round horned brute. `d` is the body diameter in pixels. Variants:
// normal, hit (flash), angry, angryHit.
export function bossSprite(d, variant = 'normal') {
  const angry = variant.startsWith('angry');
  const hit = variant.endsWith('it') && variant !== 'normal'; // hit, angryHit
  const pad = Math.max(3, Math.round(d * 0.32)); // room for the horns
  const W = d + 2, H = d + pad + 2;
  const sp = blank(W, H);
  const body = disc(d, (nx, ny) => {
    const l = -0.55 * nx - 0.65 * ny; // light from the top left
    if (ny > 0.15 && Math.abs(nx) < 0.55 && nx * nx / 0.3 + (ny - 0.45) * (ny - 0.45) / 0.2 < 1) return angry ? '#ff8a6a' : '#f0a07a'; // belly
    // A hit lightens every shade one step (a flash that keeps the shape).
    if (l > 0.55) return hit ? '#ffb0a6' : angry ? '#ff6a50' : '#ff7571';
    if (l > -0.2) return hit ? '#ff6a5a' : angry ? '#ff3020' : '#e84537';
    return hit ? '#c8382c' : angry ? '#8a0f0a' : '#aa2c23';
  });
  // Horns.
  const hw = Math.max(2, Math.round(d * 0.12));
  for (const sgn of [-1, 1]) {
    const bx = Math.round(d / 2 + sgn * d * 0.28);
    for (let i = 0; i < pad + 2; i++) {
      const w = Math.max(1, Math.round(hw * (1 - i / (pad + 2))));
      const x0 = bx + sgn * Math.round(i * 0.45) - (sgn < 0 ? w - 1 : 0);
      for (let k = 0; k < w; k++) put(sp, x0 + k + 1, pad + 1 - i, rgba(i > pad - 1 ? '#fff3d6' : '#f3e6c8'));
    }
  }
  for (let y = 0; y < d; y++) for (let x = 0; x < d; x++) {
    const q = (y * d + x) * 4;
    if (body.rgba[q + 3]) put(sp, x + 1, y + pad + 1, body.rgba.subarray(q, q + 4));
  }
  // Face: eyes, brows, mouth (scaled with the body).
  const cx = 1 + d / 2, cy = pad + 1 + d / 2;
  const ex = Math.max(2, Math.round(d * 0.17)), ey = Math.round(cy - d * 0.12);
  const ew = Math.max(2, Math.round(d * 0.14)), eh = Math.max(2, Math.round(d * 0.1));
  for (const sgn of [-1, 1]) {
    const x0 = Math.round(cx + sgn * ex - ew / 2);
    for (let y = 0; y < eh; y++) for (let x = 0; x < ew; x++) put(sp, x0 + x, ey + y, rgba('#ffffff'));
    const px = sgn < 0 ? x0 + ew - Math.max(1, Math.round(ew / 2)) : x0;
    for (let y = Math.floor(eh / 3); y < eh; y++) for (let x = 0; x < Math.max(1, Math.round(ew / 2)); x++) put(sp, px + x, ey + y, rgba(PAL.k));
    // Brow slanting down to the middle.
    for (let x = -1; x <= ew; x++) {
      const t = sgn < 0 ? x / ew : 1 - x / ew;
      put(sp, x0 + x, ey - 2 + Math.round(t * (angry ? 2 : 1)), rgba(PAL.k));
    }
  }
  const mw = Math.max(3, Math.round(d * 0.34)), my = Math.round(cy + d * 0.2);
  for (let x = 0; x < mw; x++) {
    const t = Math.abs(x - (mw - 1) / 2) / (mw / 2);
    put(sp, Math.round(cx - mw / 2) + x, my + Math.round((1 - t * t) * -1.5 + 1), rgba(PAL.k));
    if (d >= 26 && (x === 1 || x === mw - 2)) put(sp, Math.round(cx - mw / 2) + x, my - 1, rgba('#ffffff'));
  }
  return outline(sp);
}

// Saw blade standing on its edge: teeth ring, red hub. 4 rotation frames.
export function sawSprite(d, frame = 0, hot = false) {
  const sp = blank(d, d);
  const r = d / 2;
  const N = d >= 16 ? 10 : 8;
  const rot = (frame / 4) * ((Math.PI * 2) / N);
  for (let y = 0; y < d; y++) for (let x = 0; x < d; x++) {
    const nx = x + 0.5 - r, ny = y + 0.5 - r;
    const rr = Math.hypot(nx, ny) / r;
    const a = Math.atan2(ny, nx) - rot;
    const u = ((a / ((Math.PI * 2) / N)) % 1 + 1) % 1;
    const edge = 0.74 + 0.26 * (1 - u); // saw-tooth profile
    if (rr > edge) continue;
    let c;
    if (rr < 0.2) c = '#3a4250';
    else if (rr < 0.48) c = '#e04a3c';
    else if (rr < 0.56) c = '#8b9bb4';
    else c = hot ? '#ffb4a8' : (nx + ny < 0 ? '#eef2f7' : '#c0cbdc');
    put(sp, x, y, rgba(c));
  }
  return outline(sp);
}

// Boulder with a few dark spots that turn as it rolls (4 frames).
export function boulderSprite(d, frame = 0) {
  const rot = (frame / 4) * Math.PI * 0.5;
  const sp = disc(d, (nx, ny) => {
    for (let i = 0; i < 3; i++) {
      const a = rot + i * 2.1;
      const dx = nx - Math.cos(a) * 0.45, dy = ny - Math.sin(a) * 0.45;
      if (dx * dx + dy * dy < 0.05) return '#6b5848';
    }
    const l = -0.6 * nx - 0.6 * ny;
    return l > 0.45 ? '#c9b597' : l > -0.3 ? '#9c8468' : '#6b5848';
  });
  return outline(sp);
}

// Ellipse ring (outline only), `t` pixels thick.
export function ringSprite(w, h, col, t = 1) {
  const sp = blank(w, h);
  const c = rgba(col);
  const rx = w / 2, ry = h / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const nx = (x + 0.5 - rx) / rx, ny = (y + 0.5 - ry) / ry;
    const o = nx * nx + ny * ny;
    const ix = (x + 0.5 - rx) / Math.max(0.5, rx - t), iy = (y + 0.5 - ry) / Math.max(0.5, ry - t);
    if (o <= 1 && ix * ix + iy * iy > 1) put(sp, x, y, c);
  }
  return sp;
}

// Filled ellipse (soft shadows, landing marks).
export function ellipseSprite(w, h, col) {
  const sp = blank(w, h);
  const c = rgba(col);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const nx = (x + 0.5 - w / 2) / (w / 2), ny = (y + 0.5 - h / 2) / (h / 2);
    if (nx * nx + ny * ny <= 1) put(sp, x, y, c);
  }
  return sp;
}

// Pickup orb: shaded ball in `col` with a white rim highlight and an icon.
export function orbSprite(d, col, dark, icon) {
  const sp = disc(d, (nx, ny) => {
    const l = -0.6 * nx - 0.7 * ny;
    if (nx * nx + ny * ny > 0.72) return '#ffffff';
    return l > 0.5 ? '#ffffff' : l > -0.35 ? col : dark;
  });
  if (icon) {
    const ic = raster(icon, null, '#ffffff');
    const ox = Math.round((d - ic.w) / 2), oy = Math.round((d - ic.h) / 2);
    for (let y = 0; y < ic.h; y++) for (let x = 0; x < ic.w; x++) {
      const q = (y * ic.w + x) * 4;
      if (ic.rgba[q + 3]) put(sp, ox + x, oy + y, ic.rgba.subarray(q, q + 4));
    }
  }
  return outline(sp);
}

// Rounded, outlined panel with a highlight row: buttons, pills, hint boxes.
export function panelSprite(w, h, fill, dark, light = null) {
  const sp = blank(w, h);
  const cf = rgba(fill), cd = rgba(dark), co = rgba(PAL.k), cl = light ? rgba(light) : null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const corner = (x === 0 || x === w - 1) && (y === 0 || y === h - 1);
    if (corner) continue;
    const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
    put(sp, x, y, edge ? co : y >= h - 3 ? cd : cl && y === 1 ? cl : cf);
  }
  return sp;
}

// All the static code-drawn frames the renderer uses, by name. Procedural
// families (boss, saw, boulder, rings, orbs) are generated by the atlas at the
// sizes it needs, through the functions above.
export function staticSprites() {
  const out = {};
  for (const [view, team] of [['back', 'blue'], ['front', 'red'], ['front', 'purple']]) {
    for (const band of ['L', 'M', 'S']) {
      SOLDIER[view][band].forEach((f, i) => { out[`soldier-${team}-${band}-${i}`] = raster(f, team, null, band !== 'L'); });
    }
  }
  for (const [k, f] of Object.entries(SCENERY)) out[k] = raster(f);
  for (const [k, f] of Object.entries(PROPS)) out[k] = raster(f);
  for (const band of ['L', 'M', 'S']) COIN[band].forEach((f, i) => { out[`coin-${band}-${i}`] = raster(f); });
  for (const k of ['chevron', 'coin', 'skull']) out[`icon-${k}`] = raster(ICONS[k]);
  out['icon-crowd'] = raster(ICONS.crowd, 'blue');
  for (const k of ['squeeze', 'swap']) {
    out[`icon-${k}`] = raster(ICONS[k], null, '#ffffff');
    out[`icon-${k}-ink`] = raster(ICONS[k], null, PAL.k);
  }
  return out;
}

// ---- far-off landmarks (drawn at a ladder of heights, hazed with distance) ----
// Each takes the total height `h` in pixels (the outline adds 2) and `haze`
// 0..1: how far every colour is blended towards the horizon fog.
const FOG_RGB = [163, 222, 250];
function hazeSprite(sp, haze) {
  if (haze <= 0) return sp;
  const k = Math.round(haze * 256);
  for (let i = 0; i < sp.rgba.length; i += 4) {
    if (!sp.rgba[i + 3]) continue;
    for (let c = 0; c < 3; c++) sp.rgba[i + c] += ((FOG_RGB[c] - sp.rgba[i + c]) * k) >> 8;
  }
  return sp;
}
function fillRect(sp, x0, y0, w, h, col) {
  const c = rgba(col);
  for (let y = Math.round(y0); y < Math.round(y0 + h); y++) for (let x = Math.round(x0); x < Math.round(x0 + w); x++) put(sp, x, y, c);
}
// Stone wall texture: light grey with darker brick dashes.
function stone(sp, x0, y0, w, h, light = '#c0cbdc', dark = '#8b9bb4') {
  const cl = rgba(light), cd = rgba(dark);
  const bw = Math.max(3, Math.round(sp.h / 14)), bh = Math.max(2, Math.round(sp.h / 22));
  for (let y = Math.round(y0); y < Math.round(y0 + h); y++) for (let x = Math.round(x0); x < Math.round(x0 + w); x++) {
    const row = Math.floor((y - y0) / bh), off = row & 1 ? Math.floor(bw / 2) : 0;
    const mortar = (y - Math.round(y0)) % bh === bh - 1 || (x - Math.round(x0) + off) % bw === 0;
    put(sp, x, y, mortar && sp.h >= 18 ? cd : cl);
  }
}
// Cone roof (triangle) from apex (cx, top) to a base `w` wide at y = base.
function cone(sp, cx, top, base, w, col, dark) {
  const c = rgba(col), cd = rgba(dark);
  for (let y = Math.round(top); y < Math.round(base); y++) {
    const hw = ((y - top + 1) / (base - top)) * (w / 2);
    for (let x = Math.round(cx - hw); x < Math.round(cx + hw); x++) put(sp, x, y, x < cx - hw * 0.2 ? c : cd);
  }
}
function flag(sp, x, top, h, col) {
  const pole = Math.max(2, Math.round(h * 0.6));
  fillRect(sp, x, top, 1, pole, '#5a6988');
  const fw = Math.min(sp.w - x - 1, Math.max(2, Math.round(h * 0.5))), fh = Math.max(1, Math.round(h * 0.28));
  fillRect(sp, x + 1, top, fw, fh, col);
}

// Windmill: tapered tower, red cap, four sails (4 turn frames).
export function windmillSprite(h, frame = 0, haze = 0) {
  const H = h, sw0 = Math.max(1, Math.round(H * 0.11));
  const Rr = Math.min(Math.round(H * 0.36) + sw0 + 1, Math.floor((H - 1) / 2));
  const sw = Math.min(sw0, Math.max(1, Rr - 3)), L = Rr - sw - 1;
  const W = 2 * Rr + 2;
  const sp = blank(W, H);
  const cx = W / 2, hubY = Rr;
  const bTop = hubY - Math.round(H * 0.06), bH = H - bTop;
  for (let y = bTop; y < H; y++) {
    const t = (y - bTop) / bH;
    const hw = (H * 0.1) + t * (H * 0.09);
    for (let x = Math.round(cx - hw); x < Math.round(cx + hw); x++) put(sp, x, y, rgba(x < cx - hw * 0.35 ? '#eaa56c' : x < cx + hw * 0.45 ? '#e19a65' : '#bd6c4a'));
  }
  // Cap.
  cone(sp, cx, bTop - Math.round(H * 0.1), bTop + 1, H * 0.26, '#e84537', '#aa2c23');
  // Door and a window.
  const dw = Math.max(1, Math.round(H * 0.07)), dh = Math.max(1, Math.round(H * 0.11));
  fillRect(sp, Math.round(cx - dw / 2), H - dh, dw, dh, '#7a4434');
  if (H >= 24) fillRect(sp, Math.round(cx - dw / 2), bTop + Math.round(bH * 0.35), dw, dw, '#3f2631');
  // Sails.
  const rot = (frame / 4) * (Math.PI / 2) + 0.35;
  for (let k = 0; k < 4; k++) {
    const a = rot + (k * Math.PI) / 2, ux = Math.cos(a), uy = Math.sin(a), px = -uy, py = ux;
    for (let t = 0; t <= L; t += 0.5) {
      put(sp, Math.round(cx - 0.5 + ux * t), Math.round(hubY + uy * t), rgba('#7a4434'));
      if (t < L * 0.3) continue;
      for (let o = 1; o <= sw; o += 0.5) {
        const lattice = H >= 30 && (Math.round(o) === sw || Math.round(t) % 4 === 0);
        put(sp, Math.round(cx - 0.5 + ux * t + px * o), Math.round(hubY + uy * t + py * o), rgba(lattice ? '#c0cbdc' : '#ffffff'));
      }
    }
  }
  fillRect(sp, Math.round(cx - 1), hubY - 1, 2, 2, '#3f2631');
  return hazeSprite(outline(sp), haze);
}

// Watchtower: round stone tower with a cone roof and a flag.
export function towerSprite(h, roof = 'red', haze = 0) {
  const H = h, W = Math.max(5, Math.round(H * 0.42));
  const sp = blank(W, H);
  const [rc, rd] = roof === 'blue' ? ['#8b9bb4', '#5a6988'] : ['#e84537', '#aa2c23'];
  const flagH = Math.max(2, Math.round(H * 0.12));
  const roofTop = flagH, roofBase = roofTop + Math.round(H * 0.28);
  const bw = Math.round(W * 0.76), bx = Math.round((W - bw) / 2);
  stone(sp, bx, roofBase - 1, bw, H - roofBase + 1);
  // Shading on the right third.
  for (let y = roofBase; y < H; y++) for (let x = bx + Math.round(bw * 0.7); x < bx + bw; x++) put(sp, x, y, rgba(H >= 18 && (y % 3 === 0) ? '#5a6988' : '#8b9bb4'));
  cone(sp, W / 2, roofTop, roofBase, W, rc, rd);
  flag(sp, Math.floor(W / 2), 0, flagH + 1, '#ffd23f');
  const ww = Math.max(1, Math.round(W * 0.14)), wh = Math.max(1, Math.round(H * 0.07));
  fillRect(sp, Math.round(W / 2 - ww / 2), roofBase + Math.round(H * 0.08), ww, wh, '#3f2631');
  const dw = Math.max(1, Math.round(W * 0.26)), dh = Math.max(1, Math.round(H * 0.12));
  fillRect(sp, Math.round(W / 2 - dw / 2), H - dh, dw, dh, '#7a4434');
  return hazeSprite(outline(sp), haze);
}

// Castle: crenellated wall with a gate, a tall keep and two corner towers.
export function castleSprite(h, haze = 0) {
  const H = h, W = Math.round(H * 1.3);
  const sp = blank(W, H);
  const merl = Math.max(1, Math.round(H / 18));
  const crenel = (x0, w, y) => { for (let x = x0; x < x0 + w; x += merl * 2) fillRect(sp, x, y - merl, Math.min(merl, x0 + w - x), merl, '#c0cbdc'); };
  // Keep (centre back).
  const kw = Math.round(W * 0.34), kx = Math.round((W - kw) / 2), kTop = Math.round(H * 0.22);
  stone(sp, kx, kTop, kw, H - kTop, '#d7e1ee', '#8b9bb4');
  crenel(kx, kw, kTop);
  // Curtain wall.
  const wTop = Math.round(H * 0.5);
  stone(sp, 0, wTop, W, H - wTop);
  crenel(0, W, wTop);
  // Corner towers with roofs.
  const tw = Math.max(3, Math.round(W * 0.2)), tTop = Math.round(H * 0.32);
  for (const tx of [0, W - tw]) {
    stone(sp, tx, tTop, tw, H - tTop);
    for (let y = tTop; y < H; y++) put(sp, tx + tw - 1, y, rgba('#8b9bb4'));
    cone(sp, tx + tw / 2, Math.round(H * 0.1), tTop + 1, tw, '#e84537', '#aa2c23');
    flag(sp, Math.floor(tx + tw / 2), 0, Math.max(2, Math.round(H * 0.11)), '#e84537');
  }
  // Gate (arched, dark) and windows on the keep.
  const gw = Math.max(2, Math.round(W * 0.14)), gh = Math.max(2, Math.round(H * 0.24));
  const gx = Math.round(W / 2 - gw / 2);
  for (let y = H - gh; y < H; y++) for (let x = gx; x < gx + gw; x++) {
    const ny = (H - gh + gw / 2 - y) / (gw / 2), nx = (x + 0.5 - W / 2) / (gw / 2);
    if (y < H - gh + gw / 2 && nx * nx + ny * ny > 1) continue;
    put(sp, x, y, rgba(H >= 30 && (x - gx) % 2 === 1 && y > H - gh + 2 ? '#5a6988' : '#3f2631'));
  }
  if (H >= 20) for (const wx of [kx + Math.round(kw * 0.25), kx + Math.round(kw * 0.75) - 1]) fillRect(sp, wx, kTop + Math.round(H * 0.08), Math.max(1, Math.round(H / 24)), Math.max(1, Math.round(H / 14)), '#3f2631');
  return hazeSprite(outline(sp), haze);
}
