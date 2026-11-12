// Browser side of the pixel art: loads the Kenney sheets, packs the code-drawn
// sprites into one atlas canvas, builds the floor textures, and caches text
// and procedural sprites. Everything is drawn at whole-pixel positions and
// native size (or a whole-number scale), so nothing is ever smoothed.

import { SHEETS, KENNEY, FLOOR_TILES, buildAtlasImage } from './atlas.js';
import { staticSprites, bossSprite, sawSprite, boulderSprite, ringSprite, ellipseSprite, orbSprite, panelSprite, ICONS, raster } from './sprites.js';
import { textMask } from './font.js';
import { buildFloorTextures } from './floor.js';
import { OUT, rgba } from './palette.js';

const loadImage = (src) => new Promise((ok, no) => {
  const i = new Image();
  i.onload = () => ok(i);
  i.onerror = () => no(new Error(`could not load ${src}`));
  i.src = src;
});

function toCanvas(sp) {
  const c = document.createElement('canvas');
  c.width = sp.w; c.height = sp.h;
  const g = c.getContext('2d');
  const id = g.createImageData(sp.w, sp.h);
  id.data.set(sp.rgba);
  g.putImageData(id, 0, 0);
  return c;
}

// A small LRU of canvases.
function lru(max) {
  const m = new Map();
  return {
    get(k, make) {
      let v = m.get(k);
      if (v) { m.delete(k); m.set(k, v); return v; }
      v = make();
      m.set(k, v);
      if (m.size > max) m.delete(m.keys().next().value);
      return v;
    },
  };
}

export function createGfx() {
  const sheets = {};
  const frames = {}; // name -> { x, y, w, h } in the atlas (with a 1 px clear border)
  let atlas = null;
  let floorTex = null;
  const cache = lru(400);   // procedural sprites
  const texts = lru(300);   // rendered strings

  function buildAtlas() {
    const all = staticSprites();
    // White flash frames for the giant (and anything else that flashes).
    for (const k of Object.keys(all)) {
      if (!k.startsWith('soldier-red-L') && !k.startsWith('soldier-purple-L')) continue;
      const sp = all[k];
      const f = { w: sp.w, h: sp.h, rgba: new Uint8ClampedArray(sp.rgba) };
      for (let i = 0; i < f.rgba.length; i += 4) if (f.rgba[i + 3] > 200 && !(f.rgba[i] === 0x3f && f.rgba[i + 1] === 0x26)) { f.rgba[i] = 255; f.rgba[i + 1] = 236; f.rgba[i + 2] = 230; }
      all[`${k}-flash`] = f;
    }
    const im = buildAtlasImage(all);
    Object.assign(frames, im.frames);
    const c = document.createElement('canvas');
    c.width = im.width; c.height = im.height;
    const g = c.getContext('2d');
    const id = g.createImageData(c.width, c.height);
    id.data.set(im.rgba);
    g.putImageData(id, 0, 0);
    atlas = c;
  }

  function tilePixels(rect) {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 16;
    const g = c.getContext('2d');
    g.drawImage(sheets[rect.sheet], rect.x, rect.y, 16, 16, 0, 0, 16, 16);
    return new Uint32Array(g.getImageData(0, 0, 16, 16).data.buffer.slice(0));
  }

  const ready = (async () => {
    buildAtlas();
    const imgs = await Promise.all(Object.entries(SHEETS).map(async ([k, s]) => [k, await loadImage(s.src)]));
    for (const [k, i] of imgs) sheets[k] = i;
    floorTex = buildFloorTextures({
      grass: FLOOR_TILES.grass.map(tilePixels),
      roadL: tilePixels(FLOOR_TILES.roadL), road: tilePixels(FLOOR_TILES.road), roadR: tilePixels(FLOOR_TILES.roadR),
      water: tilePixels(FLOOR_TILES.water),
    });
  })();

  // ---- drawing helpers (g = the low-res context) -----------------------------
  // Atlas sprite with its bottom centre at (x, y). Returns false if unknown.
  function spr(g, name, x, y, scale = 1) {
    const f = frames[name];
    if (!f) return false;
    const w = f.w * scale, h = f.h * scale;
    g.drawImage(atlas, f.x, f.y, f.w, f.h, Math.round(x - w / 2), Math.round(y - h + scale), w, h);
    return true;
  }
  const frame = (name) => frames[name];

  // Kenney sprite (KENNEY key) with its bottom centre at (x, y).
  function kspr(g, key, x, y, scale = 1) {
    const r = KENNEY[key];
    const img = sheets[r.sheet];
    if (!img) return;
    g.drawImage(img, r.x, r.y, r.w, r.h, Math.round(x - (r.w * scale) / 2), Math.round(y - r.h * scale), r.w * scale, r.h * scale);
  }

  // Cached procedural sprite canvas.
  function proc(key, make) { return cache.get(key, () => toCanvas(make())); }
  // Draws a canvas centred on x with its bottom at y (or centred on y).
  function blit(g, c, x, y, mid = false) {
    g.drawImage(c, Math.round(x - c.width / 2), Math.round(mid ? y - c.height / 2 : y - c.height));
  }

  const boss = (d, variant) => proc(`boss${d}${variant}`, () => bossSprite(d, variant));
  const saw = (d, fr, hot) => proc(`saw${d}|${fr}|${hot}`, () => sawSprite(d, fr, hot));
  const boulder = (d, fr) => proc(`bld${d}|${fr}`, () => boulderSprite(d, fr));
  const ring = (w, h, col, t = 1) => proc(`ring${w}|${h}|${col}|${t}`, () => ringSprite(w, h, col, t));
  const ellipse = (w, h, col) => proc(`ell${w}|${h}|${col}`, () => ellipseSprite(w, h, col));
  const orb = (d, col, dark, icon) => proc(`orb${d}|${col}|${icon}`, () => orbSprite(d, col, dark, icon ? ICONS[icon] : null));
  const panel = (w, h, fill, dark, light) => proc(`pan${w}|${h}|${fill}|${dark}|${light}`, () => panelSprite(w, h, fill, dark, light));
  const icon = (name, fill) => proc(`ico${name}|${fill}`, () => raster(ICONS[name], 'blue', fill));

  // Text as a cached canvas: fill colour, outline colour, font, whole scale.
  function textCanvas(str, fill = '#ffffff', outline = OUT, font = 'big', scale = 1) {
    const key = `${font}|${scale}|${fill}|${outline}|${str}`;
    return texts.get(key, () => {
      const m = textMask(str, font, scale);
      const sp = { w: m.w, h: m.h, rgba: new Uint8ClampedArray(m.w * m.h * 4) };
      const cf = rgba(fill), co = rgba(outline);
      for (let i = 0; i < m.mask.length; i++) if (m.mask[i]) sp.rgba.set(m.mask[i] === 2 ? cf : co, i * 4);
      return toCanvas(sp);
    });
  }
  // Draws text centred at (x, y) (align: 'center' | 'left' | 'right').
  function text(g, str, x, y, fill, opts = {}) {
    const c = textCanvas(String(str), fill, opts.outline || OUT, opts.font || 'big', opts.scale || 1);
    const ax = opts.align === 'left' ? 0 : opts.align === 'right' ? c.width : c.width / 2;
    const dx = Math.round(x - ax), dy = Math.round(y - c.height / 2);
    if (opts.squash != null && opts.squash < 1) {
      const w = Math.max(1, Math.round(c.width * opts.squash));
      g.drawImage(c, Math.round(x - w / 2), dy, w, c.height);
    } else g.drawImage(c, dx, dy);
    return c.width;
  }

  return {
    ready, spr, kspr, frame, blit, text, textCanvas, boss, saw, boulder, ring, ellipse, orb, panel, icon,
    get floor() { return floorTex; },
    get atlas() { return atlas; },
    get sheets() { return sheets; },
    frames,
  };
}
