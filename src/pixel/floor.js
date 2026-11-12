// The sky and the "Mode 7" floor, rendered in plain JS into the low-res
// buffer's pixels (one putImageData per frame instead of hundreds of draw
// calls). Pure: works on typed arrays only, so it runs (and is tested) without
// a canvas.
//
// Pixels are 32-bit little-endian RGBA (what ImageData uses): 0xAABBGGRR.

import { rgba32 } from './palette.js';

export const TEX_PER_UNIT = 1.6; // floor texels per world unit
export const TW = 352;           // ground texture width: world x -60..160
export const TV = 512;           // ground texture length (repeats every 320 units)
export const TX0 = 60;           // world x of texel column 0 is -TX0
const GRASS_WRAP = 64;           // columns 0..63 are grass only (used off the edges)
const FOG = [163, 222, 250];

const hash = (a, b) => {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

function shade(p, k) {
  const r = p & 255, g = (p >>> 8) & 255, b = (p >>> 16) & 255;
  return (0xff000000 | (Math.min(255, b * k) << 16) | (Math.min(255, g * k) << 8) | Math.min(255, r * k)) >>> 0;
}

// Box-filtered half-size copy (wrapping), for distant rows (less shimmer).
function halve(t) {
  const w = t.w >> 1, h = t.h >> 1;
  const d = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const p = t.data[(y * 2 + dy) * t.w + x * 2 + dx];
      r += p & 255; g += (p >>> 8) & 255; b += (p >>> 16) & 255;
    }
    d[y * w + x] = (0xff000000 | ((b >> 2) << 16) | ((g >> 2) << 8) | (r >> 2)) >>> 0;
  }
  return { w, h, data: d };
}

// tiles: { grass: [3 x Uint32Array(256)], roadL, road, roadR, water } (16x16 each).
export function buildFloorTextures(tiles) {
  const data = new Uint32Array(TW * TV);
  const dirtDark = rgba32('#cf8254'), dirtLight = rgba32('#f3bf86');
  for (let r = 0; r < TV / 16; r++) {
    const dark = (r >> 1) & 1; // grass bands every 20 units, so motion reads
    for (let k = 0; k < TW / 16; k++) {
      let tile;
      if (k < 6 || k > 15) {
        const h = hash(k % 4, r);
        tile = tiles.grass[h < 0.62 ? 0 : h < 0.84 ? 1 : 2];
      } else tile = k === 6 ? tiles.roadL : k === 15 ? tiles.roadR : tiles.road;
      const grass = k < 6 || k > 15;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        let p = tile[y * 16 + x];
        if (grass && dark) p = shade(p, 0.92);
        if (!grass && k > 6 && k < 15) {
          const h = hash(k * 16 + x, r * 16 + y);
          if (h < 0.012) p = dirtDark; else if (h > 0.994) p = dirtLight;
        }
        data[(r * 16 + y) * TW + k * 16 + x] = p;
      }
    }
  }
  // Worn centre line: short darker dashes down the middle of the road.
  const mid = (TX0 + 50) * TEX_PER_UNIT;
  for (let v = 0; v < TV; v += 32) {
    for (let y = 4; y < 14; y++) for (let x = -2; x < 2; x++) data[(v + y) * TW + mid + x] = dirtDark;
  }
  const mips = [{ w: TW, h: TV, data }];
  for (let i = 1; i < 4; i++) mips.push(halve(mips[i - 1]));
  // Hedge (fork) tile: leafy greens with dark gaps.
  const hedge = new Uint32Array(256);
  const hc = [rgba32('#479f4a'), rgba32('#84c669'), rgba32('#2f6e3c')];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const h = hash(x + 99, y + 7);
    hedge[y * 16 + x] = h < 0.2 ? hc[2] : h < 0.45 ? hc[1] : hc[0];
  }
  return { mips, water: tiles.water, hedge };
}

// Sky, hills and clouds for a buffer W wide, rows 0..hz-1.
export function buildSky(W, hz) {
  const out = new Uint32Array(W * hz);
  const bands = ['#3a8fd9', '#4a9fe3', '#5aafeb', '#6dbff2', '#86cff6', '#a3defa'].map(rgba32);
  for (let y = 0; y < hz; y++) {
    const c = bands[Math.min(5, Math.floor((y / hz) * 6))];
    out.fill(c, y * W, (y + 1) * W);
  }
  const white = rgba32('#ffffff'), shadow = rgba32('#d7ecfa');
  const rect = (x, y, w, h, c) => {
    for (let yy = Math.max(0, y); yy < Math.min(hz, y + h); yy++) for (let xx = Math.max(0, x); xx < Math.min(W, x + w); xx++) out[yy * W + xx] = c;
  };
  for (const [fx, fy] of [[0.12, 0.5], [0.66, 0.36], [0.85, 0.66]]) {
    const x = Math.round(fx * W), y = Math.round(fy * hz);
    rect(x, y, 22, 5, white); rect(x + 4, y - 4, 10, 4, white); rect(x + 12, y - 6, 6, 3, white); rect(x, y + 4, 22, 1, shadow);
  }
  const h1c = rgba32('#5d9e6a'), h2c = rgba32('#4a8a5a');
  for (let x = 0; x < W; x++) {
    const h1 = 10 + Math.round(6 * Math.sin(x / 17) + 4 * Math.sin(x / 7 + 2));
    rect(x, hz - h1, 1, h1, h1c);
    const h2 = 4 + Math.round(3 * Math.sin(x / 11 + 1));
    rect(x, hz - h2, 1, h2, h2c);
  }
  return out;
}

// Renders floor rows hz..H-1 into `buf` (W wide).
// f: { dist, t, bridges: [{y0,y1,x0,x1}], forks: [{y0,y1,d0,d1}],
//      tints: [{y0,y1,x0,x1,c:[r,g,b],a}] (world rects; a 0..1),
//      rings: [{cx,cy,rx,ry,t,wx0,wx1,c,a}] (screen-space ellipse outlines,
//      clipped to world x wx0..wx1) }
export function renderFloor(buf, v, tex, f) {
  const { W, H, hz, span, ppu, cx, K } = v;
  const dist = f.dist;
  const plankA = rgba32('#b98448'), plankB = rgba32('#a8743c'), plankGap = rgba32('#5b3c1e'), plankHi = rgba32('#cf9a5a');
  const stripeY = rgba32('#f2c230'), stripeK = rgba32('#20242b'), cliff = rgba32('#6d5a45'), hedgeEdge = rgba32('#3f2631');
  const water = tex.water, hedge = tex.hedge;
  const wshift = (f.t * 6) | 0;
  for (let y = hz; y < H; y++) {
    const s = (y + 0.5 - hz) / span;
    const d = K / s - K;
    const wy = dist + d;
    const upp = 1 / (ppu * s); // world units per pixel
    const xw0 = 50 + (0.5 - cx) * upp; // world x at pixel 0
    const pxOf = (xw) => Math.round(cx + (xw - 50) / upp - 0.5);
    const row = y * W;
    const vt = Math.floor(wy * TEX_PER_UNIT);
    let bridge = null;
    for (const b of f.bridges) if (wy >= b.y0 && wy < b.y1) { bridge = b; break; }
    if (!bridge) {
      const du = TEX_PER_UNIT * upp, dv = TEX_PER_UNIT * K / (s * s * span);
      const m = Math.max(du, dv);
      const lvl = m < 1.5 ? 0 : m < 3 ? 1 : m < 6 ? 2 : 3;
      const t = tex.mips[lvl], tw = t.w, data = t.data, g = GRASS_WRAP >> lvl;
      const vrow = ((TV - 1 - (((vt % TV) + TV) % TV)) >> lvl) * tw;
      // 16.16 fixed point across the row; off the texture's sides the grass
      // columns repeat (g is a power of two, so & wraps negatives too).
      const step = ((du / (1 << lvl)) * 65536) | 0;
      let u = ((((xw0 + TX0) * TEX_PER_UNIT) / (1 << lvl)) * 65536) | 0;
      const gm = g - 1;
      for (let i = row, end = row + W; i < end; i++, u += step) {
        let ui = u >> 16;
        if (ui < 0 || ui >= tw) ui &= gm;
        buf[i] = data[vrow + ui];
      }
      // Hazard stripes where the road ends at a bridge.
      for (const b of f.bridges) {
        if (wy >= b.y0 - 2.5 && wy < b.y0) {
          const a = Math.max(0, pxOf(0)), e = Math.min(W, pxOf(100));
          for (let px = a; px < e; px++) {
            const xw = xw0 + px * upp;
            if (xw > b.x0 && xw < b.x1) continue;
            buf[row + px] = Math.floor(xw / 5) % 2 ? stripeK : stripeY;
          }
        }
      }
    } else {
      // Water edge to edge, then the cliff where the road resumes, then the deck.
      const vw = (vt & 15) * 16;
      let uw = (xw0 * TEX_PER_UNIT) + wshift;
      const duw = TEX_PER_UNIT * upp;
      for (let px = 0; px < W; px++, uw += duw) buf[row + px] = water[vw + (Math.floor(uw) & 15)];
      if (wy >= bridge.y1 - 2.2) buf.fill(cliff, row, row + W);
      const p = ((vt % 6) + 6) % 6;
      const plank = p === 0 ? plankGap : p === 1 ? plankHi : (Math.floor(vt / 6) & 1 ? plankA : plankB);
      // Deck with a dark rim at least 1 px wide on each side.
      const a = pxOf(bridge.x0 - 0.8), b0 = Math.max(a + 1, pxOf(bridge.x0));
      const b1 = pxOf(bridge.x1), e = Math.max(b1 + 1, pxOf(bridge.x1 + 0.8));
      for (let px = Math.max(0, a); px < Math.min(W, e); px++) buf[row + px] = (px < b0 || px >= b1) ? plankGap : plank;
    }
    // Fork hedge down the middle, with a dark rim and a shadow either side.
    for (const k of f.forks) {
      if (wy < k.y0 || wy >= k.y1) continue;
      const a = pxOf(k.d0), e = pxOf(k.d1);
      const vh = (vt & 15) * 16;
      for (let px = Math.max(0, a - 1); px < Math.min(W, e + 1); px++) {
        if (px < a || px >= e) { buf[row + px] = shade(buf[row + px], 0.7); continue; }
        if (px === a || px === e - 1) { buf[row + px] = hedgeEdge; continue; }
        const xw = xw0 + px * upp;
        buf[row + px] = hedge[vh + (Math.floor(xw * TEX_PER_UNIT) & 15)];
      }
    }
    // Translucent world-space tints (boss telegraphs, crusher footprints, saw rails).
    for (const q of f.tints) {
      if (wy < q.y0 || wy >= q.y1) continue;
      blendSpan(buf, row, Math.max(0, pxOf(q.x0)), Math.min(W, pxOf(q.x1)), q.c, q.a);
    }
    // Screen-space ellipse outlines (stomp shock rings).
    for (const r of f.rings) {
      const dy = y + 0.5 - r.cy;
      if (Math.abs(dy) > r.ry) continue;
      const half = r.rx * Math.sqrt(1 - (dy / r.ry) ** 2);
      const iy = r.ry - r.t, ix = r.rx - r.t;
      const inner = Math.abs(dy) < iy ? ix * Math.sqrt(1 - (dy / iy) ** 2) : 0;
      const lo = Math.max(0, pxOf(r.wx0)), hi = Math.min(W, pxOf(r.wx1));
      blendSpan(buf, row, Math.max(lo, Math.round(r.cx - half)), Math.min(hi, Math.round(r.cx - inner)), r.c, r.a);
      blendSpan(buf, row, Math.max(lo, Math.round(r.cx + inner)), Math.min(hi, Math.round(r.cx + half)), r.c, r.a);
    }
    // Haze towards the horizon, in 1/16 steps.
    const fog = Math.min(0.85, Math.max(0, (d - 260) / 520));
    if (fog > 0) blendSpan(buf, row, 0, W, FOG, Math.round(fog * 16) / 16);
  }
}

export function blendSpan(buf, row, a, e, c, alpha) {
  const k = Math.round(alpha * 256);
  if (e <= a || k <= 0) return;
  const cr = c[0], cg = c[1], cb = c[2];
  for (let i = row + a; i < row + e; i++) {
    const p = buf[i];
    const r = p & 255, g = (p >>> 8) & 255, b = (p >>> 16) & 255;
    buf[i] = (0xff000000 | ((b + (((cb - b) * k) >> 8)) << 16) | ((g + (((cg - g) * k) >> 8)) << 8) | (r + (((cr - r) * k) >> 8))) >>> 0;
  }
}
