// Canvas renderer, pixel-art edition. Reads sim state, never changes it.
//
// The scene is drawn into a small low-res buffer (about 200-250 art pixels
// wide): sky and floor are written as pixels in JS ("Mode 7" style, one
// putImageData), then sprites go on top at whole-pixel positions. The buffer is
// copied to the screen canvas at a whole-number scale with smoothing off, in a
// few horizontal strips (mobile Firefox's GPU canvas once dropped tall quads).

import { RENDER_CAP, SQUEEZE_SHRINK } from './config.js';
import { gateLabel, gateMood, gateProgress } from './gates.js';
import { crowdRadius, squadRadius } from './combat.js';
import { progress } from './sim.js';
import { sinceSwap } from './hazards.js';
import { createFeatureDrawer } from './render-features.js';
import { createGfx } from './pixel/gfx.js';
import { pickScale, makeView, VIEW, FAR, HUD_H } from './pixel/view.js';
import { buildSky, renderFloor } from './pixel/floor.js';
import { bandFor, intScale, pickSize } from './pixel/atlas.js';
import { OUT } from './pixel/palette.js';
import { buildScenery, propFrame, clsFor, lowerBound, LANDMARKS, LM_SIZES, LM_FAR, hazeFor, SHADOW } from './pixel/scenery.js';

export const COLORS = {
  crowd: '#2f7cf6', enemy: '#e2453c', bullet: '#ffd23f', coin: '#ffc934', text: '#ffffff', ink: '#14202e',
};

// Vogel (sunflower) packing, sorted far-to-near for painter's order.
function packOffsets(n, spacing) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const r = spacing * Math.sqrt(i + 0.5);
    const a = i * 2.399963;
    pts.push({ i, ox: r * Math.cos(a), oy: r * Math.sin(a) * 0.75 });
  }
  return pts.slice().sort((a, b) => b.oy - a.oy);
}
const CROWD_PACK = packOffsets(RENDER_CAP, 1.25);
const SQUAD_PACK = packOffsets(80, 1.2);

const ITEM_POOL = [];
const ITEMS = [];
const PROP_CAP = 110; // most props drawn in one frame (nearest first; a safety net)
const NEAR_ALL = 240; // beyond this, only the big "far" props are drawn
const PATCH_LIST = [];
const farFirst = (a, b) => b[0] - a[0];
export const POWER_COLORS = {
  rapid: ['#ff9a1f', '#a85a00'], spread: ['#a35cff', '#5a22a8'], rocket: ['#ef4b3a', '#8a1c12'],
  laser: ['#16b8dc', '#0a5f78'], magnet: ['#e0409a', '#801850'],
};
const GATE_COLORS = {
  good: { fill: '#2f9bff', hi: '#9fe2ff', lo: '#1a56b0' },
  bad: { fill: '#ff4a4a', hi: '#ffb3b3', lo: '#a32020' },
  gamble: { fill: '#f5b60a', hi: '#fff0a8', lo: '#a06c00' },
  neutral: { fill: '#9aa3ad', hi: '#e2e6ea', lo: '#5d6670' },
};
const BOSS_SIZES = [12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60];
const STRIPS = 8;

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const lo = document.createElement('canvas');
  let g = lo.getContext('2d');
  const gfx = createGfx();
  let W = 0, H = 0, dpr = 1, bw = 0, bh = 0;
  let S = 1, LW = 0, LH = 0, v = null, img = null, buf = null, sky = null;
  let ox = 0; // device-pixel x of art column 0 (the buffer is centred; may be < 0)
  let sx = 0, sy = 0; // this frame's screen shake (art px)
  let assetsReady = false;
  let skyStyle = '';
  // Scenery layouts by level (pure, deterministic): the current and the next.
  const scenCache = new Map();
  function sceneryFor(state) {
    const key = `${state.level}|${state.seed}|${state.boss.y}`;
    let sc = scenCache.get(key);
    if (!sc) {
      sc = buildScenery({ level: state.level, segments: state.segments, bossY: state.boss.y });
      scenCache.set(key, sc);
      if (scenCache.size > 3) scenCache.delete(scenCache.keys().next().value);
    }
    return sc;
  }
  let scen = null;
  const ready = gfx.ready.then(() => { assetsReady = true; });

  // Returns true when the canvas was actually resized (and so cleared).
  // Setting canvas.width wipes the picture, and mobile Firefox fires many
  // resize events (toolbar moves), so skip no-op and bogus tiny sizes.
  function resize() {
    const rect = canvas.getBoundingClientRect();
    const nextDpr = Math.min(window.devicePixelRatio || 1, 3);
    if (W > 0 && (rect.width < 50 || rect.height < 50)) return false;
    const nextW = Math.max(1, rect.width);
    const nextH = Math.max(1, rect.height);
    const nbw = Math.round(nextW * nextDpr);
    const nbh = Math.round(nextH * nextDpr);
    if (nextW === W && nextH === H && nextDpr === dpr && canvas.width === nbw && canvas.height === nbh) return false;
    dpr = nextDpr; W = nextW; H = nextH; bw = nbw; bh = nbh;
    canvas.width = bw;
    canvas.height = bh;
    ({ S, LW, LH } = pickScale(bw, bh));
    v = makeView(LW, LH);
    ox = Math.floor((bw - LW * S) / 2);
    lo.width = v.W;
    lo.height = v.H;
    g = lo.getContext('2d');
    g.imageSmoothingEnabled = false;
    ctx.imageSmoothingEnabled = false;
    img = g.createImageData(v.W, v.H);
    buf = new Uint32Array(img.data.buffer);
    skyStyle = '';
    return true;
  }

  // ---- helpers shared with the feature drawer ------------------------------
  function proj(x, d) {
    const s = v.K / (v.K + Math.max(d, -v.K * 0.6));
    return { x: v.cx + (x - 50) * v.ppu * s, y: v.hz + v.span * s, s };
  }
  const fadeFor = (d) => (d > VIEW - 25 ? Math.max(0, (VIEW - d) / 25) : 1);
  const R = Math.round;
  function rect(x, y, w, h, col) {
    g.fillStyle = col;
    g.fillRect(R(x), R(y), R(w), R(h));
  }
  // Outlined box: OUT border, fill inside.
  function box(x, y, w, h, fill) {
    x = R(x); y = R(y); w = R(w); h = R(h);
    g.fillStyle = OUT; g.fillRect(x - 1, y - 1, w + 2, h + 2);
    g.fillStyle = fill; g.fillRect(x, y, w, h);
  }
  // Number badge: rounded pixel pill with a dark lower band, centred at (x, y).
  function pill(x, y, str, bg, dark, scale = 1, font = 'big') {
    const c = gfx.textCanvas(str, '#ffffff', dark, font, scale);
    const w = c.width + 4, h = c.height + 2;
    gfx.blit(g, gfx.panel(w, h, bg, dark, null), x, y, true);
    g.drawImage(c, R(x - c.width / 2), R(y - h / 2) + 1);
  }
  // Text scale that fits `maxW` (2 big, 1 big, or small).
  function fitText(str, maxW, maxScale = 2) {
    for (let sc = maxScale; sc >= 1; sc--) {
      const c = gfx.textCanvas(str, '#fff', OUT, 'big', sc);
      if (c.width <= maxW) return { font: 'big', scale: sc };
    }
    return { font: 'small', scale: 1 };
  }

  const NAMES = {};
  for (const team of ['blue', 'red', 'purple']) {
    NAMES[team] = {};
    for (const b of ['L', 'M', 'S']) NAMES[team][b] = [0, 1].map((f) => `soldier-${team}-${b}-${f}`);
  }
  // Soldiers: one atlas sprite each, band picked once for the group.
  // Packs use one band smaller than their distance alone would pick: a dense
  // crowd of big sprites only shows a carpet of helmets.
  function drawPack(team, pack, n, x, d, t, bob, spread = 1) {
    const band = bandFor(proj(x, d).s * (team === 'blue' ? 0.62 : 0.8));
    const names = NAMES[team][band];
    const step = bob ? Math.floor(t * 8) : 0;
    const atlas = gfx.atlas;
    for (const p of pack) {
      if (p.i >= n) continue;
      const wob = bob ? Math.sin(t * 14 + p.i * 1.7) * 0.25 : 0;
      const q = proj(x + p.ox * spread, d + p.oy * spread + wob);
      const f = gfx.frame(names[(p.i + step) & 1]);
      g.drawImage(atlas, f.x, f.y, f.w, f.h, R(q.x - f.w / 2), R(q.y - f.h + 1), f.w, f.h);
    }
  }

  const V = {
    gfx, VIEW, R, rect, box, pill, fitText, drawPack, proj, fadeFor,
    get g() { return g; },
    get ppu() { return v.ppu; },
    get nearD() { return v.nearD; },
    get v() { return v; },
    get LW() { return LW; },
    get LH() { return LH; },
    // Screen-space origin (top left of what is shown, shake compensated).
    get sx0() { return v.M + sx; },
    get sy0() { return v.M + sy; },
  };
  const feat = createFeatureDrawer(V);

  // ---- floor ----------------------------------------------------------------
  const FLOOR = { dist: 0, t: 0, bridges: [], forks: [], tints: [], rings: [] };
  function drawGround(state) {
    if (skyStyle !== scen.theme.sky) { sky = buildSky(v.W, v.hz, scen.theme.sky); skyStyle = scen.theme.sky; }
    buf.set(sky);
    FLOOR.dist = state.dist;
    FLOOR.t = state.t;
    FLOOR.bridges.length = 0;
    FLOOR.forks.length = 0;
    FLOOR.tints.length = 0;
    FLOOR.rings.length = 0;
    const far = state.dist + FAR;
    for (const s of state.segments) {
      if (s.y1 < state.dist + v.nearD || s.y0 > far) continue;
      if (s.kind === 'bridge') FLOOR.bridges.push(s);
      else if (s.kind === 'fork') FLOOR.forks.push(s);
    }
    feat.floorMarks(state, FLOOR);
    // Flat patches in view (sorted by y0; none is longer than 40 units).
    PATCH_LIST.length = 0;
    const pts = scen.patches, pt = gfx.patches;
    for (let i = lowerBound(pts, state.dist + v.nearD - 40, 'y0'); i < pts.length && pts[i].y0 < far; i++) {
      const p = pts[i];
      if (p.y1 < state.dist + v.nearD) continue;
      // Off the side of the screen even at its far edge (where it's widest in view)?
      const sF = v.K / (v.K + Math.max(0, p.y1 - state.dist));
      if (v.cx + (p.x1 - 50) * v.ppu * sF < 0 || v.cx + (p.x0 - 50) * v.ppu * sF > v.W) continue;
      if (!p.tex) p.tex = pt[p.kind][p.v];
      PATCH_LIST.push(p);
    }
    FLOOR.patches = PATCH_LIST;
    renderFloor(buf, v, gfx.floorFor(scen.theme.name), FLOOR);
    g.putImageData(img, 0, 0);
  }

  // ---- scenery: props beside the road and far-off landmarks ----------------------
  // The layout (src/pixel/scenery.js) keeps every prop clear of the road; here
  // they are culled to the screen and capped. Beyond 240 units only the big
  // ones ("far") are drawn.
  function addScenery(state, add) {
    const props = scen.props;
    const far = state.dist + FAR, K = v.K, kx = v.ppu, cx = v.cx, W2 = v.W;
    let n = 0;
    for (let i = lowerBound(props, state.dist + v.nearD - 12); i < props.length; i++) {
      const p = props[i];
      if (p.y > far) break;
      const d = p.y - state.dist;
      if (d > NEAR_ALL && !p.far) continue;
      const s = K / (K + d);
      const f = propFrame(p.kind, p.alt, s);
      if (!f) continue;
      const X = cx + (p.x - 50) * kx * s, hw = f.w / 2;
      if (X + hw < 0 || X - hw > W2) continue;
      // Last guard: never over the road (the layout already keeps clear).
      if (p.x < 50 ? X + hw > cx - 50 * kx * s - 1 : X - hw < cx + 50 * kx * s + 1) continue;
      // Per-frame scratch on the layout object, read back by drawProp.
      p.sx = X; p.sy = v.hz + v.span * s; p.f = f; p.c = clsFor(s);
      add(p.y, 6, p);
      if (++n >= PROP_CAP) break;
    }
    for (const lm of scen.landmarks) {
      const d = lm.y - state.dist;
      if (d > v.nearD && d < LM_FAR) add(lm.y, 7, lm);
    }
  }
  // True when a sprite `w` px wide centred at screen x `X` (world x `wx`, depth
  // d) would reach over the road: a last guard, the layout already avoids it.
  function onRoad(wx, X, w, d) {
    return wx < 50 ? X + w / 2 > proj(0, d).x - 1 : X - w / 2 < proj(100, d).x + 1;
  }
  const SHADOWS = new Map();
  function drawProp(p) {
    const f = p.f, X = p.sx, Y = p.sy;
    if (p.c < 2 && SHADOW.has(p.kind)) {
      const sw = Math.max(6, Math.round(f.w * 0.7));
      let sh = SHADOWS.get(sw);
      if (!sh) { sh = gfx.ellipse(sw, 3, 'rgba(43,29,43,0.3)'); SHADOWS.set(sw, sh); }
      g.drawImage(sh, R(X - sw / 2), R(Y + 1 - 1.5));
    }
    if (f.src === 'atlas') gfx.spr(g, f.n, X, Y);
    else if (f.src === 'kenney') gfx.kspr(g, f.n, X, f.n === 'mushrooms' ? Y + 3 : Y);
    else gfx.cspr(g, f.n, X, Y);
  }
  function drawLandmark(state, lm) {
    const d = lm.y - state.dist;
    const q = proj(lm.x, d);
    const h = pickSize(LM_SIZES, LANDMARKS[lm.kind].height * v.ppu * q.s);
    const frame = lm.kind === 'windmill' ? Math.floor(state.t * 2.5) & 3 : lm.kind === 'tower' && scen.theme.name === 'village' ? 1 : 0;
    const c = gfx.landmark(lm.kind, h, frame, hazeFor(d));
    if (q.x + c.width / 2 < 0 || q.x - c.width / 2 > v.W || onRoad(lm.x, q.x, c.width, d)) return;
    gfx.blit(g, c, q.x, q.y + 1);
  }

  // ---- gates ------------------------------------------------------------------
  function drawGateRow(state, row) {
    const d = row.y - state.dist;
    if (d < v.nearD || d > VIEW) return;
    const alpha = fadeFor(d);
    const m = row.move;
    const s0 = proj(50, d).s;
    const band = bandFor(s0);
    if (m && m.kind === 'slide') {
      const g0 = row.gates[0], g1 = row.gates[row.gates.length - 1];
      const a = proj(g0.bx0 - m.amp, d), b = proj(g1.bx1 + m.amp, d);
      g.globalAlpha = alpha;
      box(a.x, a.y - 1, b.x - a.x, 2, '#5a6988');
      box(a.x - 1, a.y - 4, 2, 6, '#8b9bb4');
      box(b.x - 1, b.y - 4, 2, 6, '#8b9bb4');
      g.globalAlpha = 1;
    }
    const flipT = m && m.kind === 'swap' ? sinceSwap(m, state.t) : 99;
    const flip = flipT < 0.3 ? Math.max(0.06, Math.abs(Math.cos((Math.PI * flipT) / 0.3))) : 1;
    const pw = band === 'L' ? 3 : band === 'M' ? 2 : 1;
    for (const gt of row.gates) {
      const mood = gateMood(gt);
      const col = GATE_COLORS[mood] || GATE_COLORS.neutral;
      const l = proj(gt.x0 + 0.6, d), r = proj(gt.x1 - 0.6, d);
      const h = Math.max(6, R(15 * v.ppu * l.s));
      const x = R(l.x), w = R(r.x) - x, y = R(l.y) - h;
      const lob = band === 'L' ? 4 : band === 'M' ? 3 : 2;
      const flash = Math.max(0, 1 - (state.t - gt.lastHit) / 0.12);
      g.globalAlpha = alpha * 0.72;
      rect(x, y, w, h, col.fill);
      rect(x, y + h - lob, w, lob, col.lo);
      if (flash > 0) { g.globalAlpha = alpha * 0.5 * flash; rect(x, y, w, h, '#ffffff'); }
      g.globalAlpha = alpha;
      rect(x + 1, y + 1, w - 2, 1, col.hi);
      rect(x + 1, y + 2, 1, Math.min(6, h - 4), col.hi);
      g.fillStyle = OUT;
      g.fillRect(x, y - 1, w, 1); g.fillRect(x, y + h, w, 1);
      // Posts with gold caps.
      for (const px of [x, x + w]) {
        const p0 = px - Math.floor(pw / 2);
        rect(p0 - 1, y - 3, pw + 2, h + 4, OUT);
        rect(p0, y - 2, pw, h + 2, '#c8ced8');
        if (pw > 1) rect(p0, y - 2, 1, h + 2, '#ffffff');
        rect(p0, y - 4, pw, 2, '#ffd23f');
        rect(p0, y - 5, pw, 1, OUT);
      }
      // Label (gold/white blink on mystery gates).
      const label = gateLabel(gt);
      const ft = fitText(label, w - 4, band === 'L' && h - lob >= 19 ? 2 : 1);
      const fill = mood === 'gamble' && Math.floor(state.t * 4) % 2 ? '#fff0a8' : '#ffffff';
      gfx.text(g, label, x + w / 2, y + (h - lob) / 2, fill, { ...ft, squash: flip < 1 ? flip : null });
      if (gt.kind === 'mul') {
        const pr = gateProgress(gt);
        const bw2 = Math.max(6, R(w * 0.5)), bx = R(x + w / 2 - bw2 / 2), by = y + h - lob + 1;
        box(bx, by, bw2, 1, '#4a3a5c');
        rect(bx, by, R(bw2 * pr), 1, '#ffffff');
      }
      g.globalAlpha = 1;
    }
    if (m && m.kind === 'swap') {
      // Swap badge over the middle: arrows plus a bar counting to the next swap.
      const g0 = row.gates[0], g1 = row.gates[row.gates.length - 1];
      const q = proj((g0.x0 + g1.x1) / 2, d);
      const h = R(15 * v.ppu * q.s);
      const u = (state.t % m.period) / m.period;
      g.globalAlpha = alpha;
      const bx = R(q.x - 6), by = R(q.y) - h - 14;
      box(bx, by, 12, 9, '#1b1424');
      g.drawImage(gfx.icon('swap', '#ffffff'), bx + 3, by + 1);
      rect(bx + 1, by + 7, R(10 * u), 1, '#ffd23f');
      g.globalAlpha = 1;
    }
  }

  // ---- enemies ------------------------------------------------------------------
  function drawEnemy(state, e) {
    const d = e.y - state.dist;
    if (d < v.nearD || d > VIEW) return;
    if (e.kind === 'tower') { feat.drawTower(state, e); return; }
    g.globalAlpha = fadeFor(d);
    if (e.kind === 'giant') {
      feat.drawGiant(state, e);
    } else if (e.kind === 'squad') {
      const purple = e.split || e.splitChild;
      drawPack(purple ? 'purple' : 'red', SQUAD_PACK, Math.min(e.count, 80), e.x, d, state.t, true);
      const top = proj(e.x, d + squadRadius(e.count) + 2);
      const band = bandFor(top.s);
      const lift = band === 'L' ? 20 : band === 'M' ? 14 : 9;
      const big = e.count > 80 ? 2 : 1;
      pill(top.x, top.y - lift - (big - 1) * 4, String(e.count), purple ? '#a24bf0' : '#e84537', purple ? '#4a1580' : '#7a1712', big, band === 'S' && big === 1 ? 'small' : 'big');
      if (e.shield > 0) feat.drawShield(state, e);
    } else {
      feat.drawWall(state, e);
    }
    g.globalAlpha = 1;
  }

  // ---- pickups --------------------------------------------------------------------
  function drawPowerup(state, p) {
    const d = p.y - state.dist;
    if (p.taken || d < v.nearD || d > VIEW) return;
    const q = proj(p.x, d);
    const band = bandFor(q.s);
    const dia = band === 'L' ? 13 : band === 'M' ? 11 : 7;
    const bob = R(Math.sin(state.t * 4 + p.id) * 1.5);
    const [col, dark] = POWER_COLORS[p.kind];
    g.globalAlpha = fadeFor(d);
    gfx.blit(g, gfx.ellipse(dia - 2, 3, 'rgba(43,29,43,0.32)'), q.x, q.y, true);
    gfx.blit(g, gfx.orb(dia, col, dark, band === 'S' ? null : p.kind), q.x, q.y - 3 - bob);
    g.globalAlpha = 1;
  }

  // ---- boss -------------------------------------------------------------------------
  function drawBoss(state) {
    const b = state.boss;
    if (!b.alive && state.phase !== 'won') return;
    const d = b.y - state.dist;
    if (d > VIEW || d < v.nearD) return;
    const hitT = state.t - b.lastHit;
    const shake = hitT < 0.08 ? (Math.random() < 0.5 ? -1 : 1) / v.ppu : 0;
    let lean = 0, hop = 0;
    for (const a of state.bossAtks) {
      if (a.done) continue;
      const u = Math.min(1, (state.t - a.t0) / (a.tHit - a.t0));
      if (a.kind === 'stomp') lean = (a.x0 < 10 ? -1 : 1) * 4 * u;
      else hop = Math.max(hop, Math.sin(u * Math.PI) * 2);
    }
    const q = proj(b.x + shake + lean, d);
    const angry = b.phase2 && b.alive;
    const rad = b.r * v.ppu * q.s;
    const size = pickSize(BOSS_SIZES, rad * 2.5);
    // Hit flash on alternate frames only, so steady fire doesn't wash the boss out.
    const flash = hitT < 0.06 && (state.tick & 2);
    const variant = (angry ? 'angry' : '') + (flash ? (angry ? 'Hit' : 'hit') : '') || 'normal';
    g.globalAlpha = fadeFor(d) * (b.alive ? 1 : 0.35);
    const by = R(q.y - hop * v.ppu * q.s);
    gfx.blit(g, gfx.ellipse(R(size * 1.1), Math.max(3, R(size * 0.3)), 'rgba(43,29,43,0.35)'), q.x, q.y, true);
    if (angry) {
      const k = 0.5 + 0.5 * Math.sin(state.t * 8);
      g.globalAlpha *= 0.35 + 0.25 * k;
      gfx.blit(g, gfx.ellipse(R(size * 1.4), R(size * 1.3), '#ff3c1e'), q.x, by - size / 2, true);
      g.globalAlpha = fadeFor(d);
    }
    // Red flags either side of the boss's spot.
    for (const fxw of [-5, 105]) {
      const f = proj(fxw, d + 4);
      if (f.s >= 0.4) gfx.kspr(g, 'flagRed', f.x, f.y, f.s >= 0.9 ? 2 : 1);
    }
    const spr = gfx.boss(size, variant);
    gfx.blit(g, spr, q.x, by + 1);
    if (b.alive) {
      const bw2 = Math.max(34, R(size * 1.2)), bh2 = 3;
      const bx = R(q.x - bw2 / 2), byy = by - spr.height - 6;
      box(bx, byy, bw2, bh2, '#4a1a1a');
      rect(bx, byy, R(bw2 * Math.max(0, b.hp / b.maxHp)), bh2, '#ff4a4a');
      rect(bx, byy, R(bw2 * Math.max(0, b.hp / b.maxHp)), 1, '#ff9a8a');
      if (b.attacks && !angry) rect(bx + R(bw2 / 2), byy - 1, 1, bh2 + 2, '#ffffff');
      gfx.text(g, `${angry ? 'ANGRY ' : ''}BOSS ${Math.ceil(b.hp)}`, q.x, byy - 7, angry ? '#ffb3a8' : '#ffffff');
    }
    g.globalAlpha = 1;
  }

  // ---- bullets (batched: one colour at a time) -----------------------------------
  // Tracers: white tip, yellow body, orange trail. Positions first, then one
  // colour at a time (three fill styles per frame, however many bullets).
  const BX = new Int16Array(512), BY = new Int16Array(512), BL = new Uint8Array(512);
  function drawBullets(state) {
    let n = 0;
    for (const b of state.bullets) {
      const d = b.y - state.dist;
      if (d > VIEW || b.rocket || b.laser || n >= 512) continue;
      const q = proj(b.x, d);
      BX[n] = R(q.x); BY[n] = R(q.y - 3 * v.ppu * q.s); BL[n] = q.s >= 0.78 ? 4 : q.s >= 0.48 ? 3 : 2;
      n += 1;
    }
    g.fillStyle = '#e07a10';
    for (let i = 0; i < n; i++) g.fillRect(BX[i], BY[i], 1, 2);
    g.fillStyle = '#ffd23f';
    for (let i = 0; i < n; i++) g.fillRect(BX[i], BY[i] - BL[i], 1, BL[i]);
    g.fillStyle = '#ffffff';
    for (let i = 0; i < n; i++) g.fillRect(BX[i], BY[i] - BL[i] - 1, 1, 1);
    feat.drawSpecialShots(state);
  }

  // ---- the player's crowd ----------------------------------------------------------
  function drawCrowd(state) {
    const c = state.crowd;
    if (c.count <= 0) return;
    const n = Math.min(c.count, RENDER_CAP);
    const spread = 1 - SQUEEZE_SHRINK * c.squeeze;
    const r = crowdRadius(c.count) * spread;
    if (c.squeeze > 0.05) {
      const a = proj(c.x - r - 1.5, 0), b = proj(c.x + r + 1.5, 0);
      const w = Math.max(8, R((b.x - a.x) / 2) * 2);
      g.globalAlpha = Math.min(1, c.squeeze * 1.4);
      gfx.blit(g, gfx.ring(w, Math.max(4, R(w * 0.3) * 2), '#ffd23f', 2), (a.x + b.x) / 2, a.y, true);
      g.globalAlpha = 1;
    }
    drawPack('blue', CROWD_PACK, n, c.x, 0, state.t, state.phase === 'run' || state.phase === 'boss', spread);
    if (state.phase === 'boss' || state.phase === 'won') {
      const bot = proj(c.x, -r * 0.8 - 1);
      pill(bot.x, Math.min(v.M + LH - 10, bot.y + 9), String(c.count), '#2f7cf6', '#0e3a8c');
    } else {
      const top = proj(c.x, r * 0.85 + 1);
      pill(top.x, top.y - 22, String(c.count), '#2f7cf6', '#0e3a8c');
    }
  }

  // ---- particles and floating text ---------------------------------------------------
  function drawFx(state, fx) {
    for (const p of fx.particles) {
      const q = proj(p.x, p.y - state.dist);
      const sz = Math.max(1, R(p.size * v.ppu * q.s * 0.8));
      g.globalAlpha = Math.min(1, Math.ceil(Math.min(1, (p.life / p.max) * 1.5) * 4) / 4);
      g.fillStyle = p.color;
      g.fillRect(R(q.x - sz / 2), R(q.y - p.z * v.ppu * q.s - sz / 2), sz, sz);
    }
    g.globalAlpha = 1;
    for (const tx of fx.texts) {
      const a = Math.min(1, tx.life / 0.35);
      g.globalAlpha = a;
      let x, y;
      if (tx.screen) { x = v.M + sx + LW / 2; y = v.M + sy + LH * tx.sy - (tx.max - tx.life) * 15; } else {
        const q = proj(tx.x, tx.y - state.dist);
        x = q.x; y = q.y - (tx.max - tx.life) * 35 - 10 * v.ppu * q.s;
      }
      const ft = fitText(tx.text, LW - 8, tx.size >= 30 ? 2 : 1);
      gfx.text(g, tx.text, x, y, tx.color, ft);
    }
    g.globalAlpha = 1;
  }

  // ---- HUD (screen space, not shaken) --------------------------------------------------
  let padGeom = null;
  function drawPad(state) {
    const Ra = Math.max(14, R((36 * dpr) / S));
    const x = V.sx0 + LW - Ra - 8, y = V.sy0 + LH - Ra - 13;
    // CSS-pixel hit area for the input module.
    padGeom = { x: ((x - V.sx0) * S + ox) / dpr, y: ((y - V.sy0) * S) / dpr, r: ((Ra + 7) * S) / dpr };
    const on = state.crowd.packed;
    const dd = Ra * 2;
    g.globalAlpha = on ? 0.95 : 0.6;
    gfx.blit(g, gfx.ellipse(dd, dd, on ? '#ffd23f' : '#1b1424'), x, y, true);
    g.globalAlpha = 1;
    gfx.blit(g, gfx.ring(dd, dd, on ? '#ffffff' : 'rgba(255,255,255,0.8)', 1), x, y, true);
    const ink = on ? OUT : '#ffffff';
    g.drawImage(gfx.icon('squeeze', ink), x - 5, y - 7);
    gfx.text(g, on ? 'PACKED' : 'SQUEEZE', x, y + 4, ink, { font: 'small', outline: on ? '#ffd23f' : OUT });
  }

  function hitPad(x, y) {
    if (!padGeom) return false;
    const dx = x - padGeom.x, dy = y - padGeom.y;
    return dx * dx + dy * dy <= padGeom.r * padGeom.r;
  }

  function drawHud(state, hud) {
    const X = V.sx0, Y = V.sy0;
    g.globalAlpha = 0.85;
    rect(X, Y, LW, HUD_H, '#1b1424');
    g.globalAlpha = 1;
    rect(X, Y + HUD_H - 1, LW, 1, '#4a3a5c');
    rect(X, Y + HUD_H, LW, 1, OUT);
    const mid = X + LW / 2;
    gfx.text(g, `LEVEL ${state.level}`, mid, Y + 6, '#ffd23f');
    const pw = 64, px = R(mid - pw / 2), py = Y + 13;
    box(px, py, pw, 3, '#4a3a5c');
    const f = R(pw * progress(state));
    rect(px, py, f, 3, '#38d36b');
    rect(px, py, f, 1, '#8ff0a8');
    g.drawImage(gfx.icon('skull', '#ffffff'), px + pw + 2, py - 2);
    // Coins.
    const coins = (hud.bankedCoins || 0) + state.coins;
    const tw = gfx.text(g, String(coins), X + LW - 4, Y + 11, '#ffffff', { align: 'right' });
    gfx.spr(g, 'icon-coin', X + LW - 9 - tw, Y + 15);
    if (hud.pad) drawPad(state);
    else padGeom = null;
    // Buffs: small coloured pills under the bar, centred.
    const list = [];
    for (const [k, label] of [['rapid', 'RAPID'], ['spread', 'SPREAD'], ['rocket', 'ROCKET'], ['laser', 'LASER'], ['magnet', 'MAGNET']]) {
      if (state.buffs[k] > 0) list.push([k, `${label} ${state.buffs[k].toFixed(1)}`]);
    }
    if (list.length) {
      const widths = list.map(([, t]) => gfx.textCanvas(t, '#fff', OUT, 'small', 1).width + 4);
      let bx = R(mid - (widths.reduce((a, b) => a + b, 0) + 3 * (list.length - 1)) / 2);
      list.forEach(([k, t], i) => {
        const [col, dark] = POWER_COLORS[k];
        gfx.blit(g, gfx.panel(widths[i], 10, col, dark, null), bx + widths[i] / 2, Y + HUD_H + 7, true);
        gfx.text(g, t, bx + widths[i] / 2, Y + HUD_H + 7, '#ffffff', { font: 'small', outline: dark });
        bx += widths[i] + 3;
      });
    }
  }

  // ---- frame ---------------------------------------------------------------------------
  function blitToScreen() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const sh = Math.ceil(LH / STRIPS);
    for (let y0 = 0; y0 < LH; y0 += sh) {
      const h = Math.min(sh, LH - y0);
      ctx.drawImage(lo, v.M + sx, v.M + sy + y0, LW, h, ox, y0 * S, LW * S, h * S);
    }
  }

  function draw(state, fx, hud = {}) {
    if (!v) return;
    const sh = fx.shake;
    sx = sh > 0 ? Math.max(-3, Math.min(3, R((Math.random() - 0.5) * sh * 0.5))) : 0;
    sy = sh > 0 ? Math.max(-3, Math.min(3, R((Math.random() - 0.5) * sh * 0.5))) : 0;
    if (!assetsReady) {
      g.fillStyle = '#6fc35a';
      g.fillRect(0, 0, v.W, v.H);
      blitToScreen();
      return;
    }
    scen = sceneryFor(state);
    drawGround(state);

    // Painter's order: far to near. Only what's in view, in reused slots, so a
    // frame allocates next to nothing (less garbage, fewer GC pauses).
    let n = 0;
    const lo2 = state.dist + v.nearD - 12, hi = state.dist + VIEW + 2;
    const add = (y, k, o) => {
      const it = ITEM_POOL[n] || (ITEM_POOL[n] = [0, 0, null]);
      it[0] = y; it[1] = k; it[2] = o;
      n += 1;
    };
    for (const row of state.rows) if (!row.used && row.y > lo2 && row.y < hi) add(row.y, 0, row);
    for (const e of state.enemies) if (e.alive && e.y > lo2 && e.y < hi) add(e.y, 1, e);
    for (const p of state.powerups) if (!p.taken && p.y > lo2 && p.y < hi) add(p.y, 2, p);
    for (const h of state.hazards) if (h.y > lo2 && h.y < hi) add(h.y, 3, h);
    for (const sg of state.segments) if (sg.kind === 'fork' && sg.y0 - state.dist > v.nearD && sg.y0 - state.dist < VIEW) add(sg.y0, 4, sg);
    for (const k of state.coinItems) {
      if (k.taken) continue;
      const d = k.y - state.dist;
      if (d > VIEW) break;
      if (d > v.nearD) add(k.y, 5, k);
    }
    addScenery(state, add);
    const items = ITEMS;
    items.length = 0;
    for (let i = 0; i < n; i++) items.push(ITEM_POOL[i]);
    items.sort(farFirst);
    feat.drawArrowMarks(state);
    const bossY = state.boss.y;
    let bossDrawn = false;
    for (let i = 0; i < n; i++) {
      const y = items[i][0], k = items[i][1], o = items[i][2];
      if (!bossDrawn && y < bossY) { drawBoss(state); bossDrawn = true; }
      if (k === 0) drawGateRow(state, o);
      else if (k === 1) drawEnemy(state, o);
      else if (k === 2) drawPowerup(state, o);
      else if (k === 3) feat.drawHazard(state, o);
      else if (k === 4) feat.drawForkStart(state, o);
      else if (k === 5) feat.drawCoin(state, o);
      else if (k === 6) drawProp(o);
      else drawLandmark(state, o);
    }
    if (!bossDrawn) drawBoss(state);
    feat.drawTelegraphMarks(state);
    drawBullets(state);
    feat.drawMagnetField(state);
    drawCrowd(state);
    feat.drawBoulders(state);
    feat.drawArrows(state);
    drawFx(state, fx);
    if (hud.hidden) padGeom = null;
    if (!hud.hidden) {
      feat.drawAmbushFlash(fx);
      feat.drawAmbushWarnings(state);
      drawHud(state, hud);
      feat.drawHint(fx);
    }
    blitToScreen();
  }

  // Builds the scenery layout and the themed floor for a run ahead of time
  // (between levels), so its first frame doesn't pay for them.
  function prepare(state) {
    const sc = sceneryFor(state);
    if (assetsReady) gfx.floorFor(sc.theme.name);
  }

  resize();
  return {
    resize, draw, hitPad, ready, prepare,
    // ppu in CSS pixels per world unit (the input module converts drags with it).
    get size() { return { W, H, ppu: v ? (v.ppu * S) / dpr : 4 }; },
  };
}
