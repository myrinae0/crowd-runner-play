// Canvas renderer. Reads sim state, never changes it.
// Mild perspective: things further down the track get smaller and closer together.

import { RENDER_CAP, SQUEEZE_SHRINK } from './config.js';
import { gateLabel, gateMood, gateProgress } from './gates.js';
import { crowdRadius, squadRadius } from './combat.js';
import { progress } from './sim.js';
import { createFeatureDrawer } from './render-features.js';
import { sinceSwap } from './hazards.js';

const VIEW = 175;     // how far ahead (world units) we draw
const K = 300;        // perspective strength (bigger = flatter)
const FONT = '800 {px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const COLORS = {
  grassA: '#4fae5f', grassB: '#46a055', track: '#e8edf3', trackB: '#dde4ec',
  rail: '#9aa7b6', crowd: '#2f7cf6', crowdDark: '#1b4fb0', enemy: '#e2453c', enemyDark: '#9e2420',
  good: '#22b0ff', goodEdge: '#9fe2ff', bad: '#ff4a4a', badEdge: '#ffb3b3', neutral: '#9aa3ad',
  bullet: '#ffd23f', coin: '#ffc934', text: '#ffffff', ink: '#14202e',
};

// Font strings, built once per pixel size (canvas text calls this a lot).
const FONTS = [];
const font = (px) => {
  const n = Math.max(6, Math.round(px));
  return FONTS[n] || (FONTS[n] = FONT.replace('{px}', n));
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

const TEAMS = {
  blue: { body: COLORS.crowd, dark: COLORS.crowdDark },
  red: { body: COLORS.enemy, dark: COLORS.enemyDark },
  purple: { body: '#a24bf0', dark: '#5e1f99' }, // splitters
};
const TAU = Math.PI * 2;
const ITEM_POOL = [];
const ITEMS = [];
const farFirst = (a, b) => b[0] - a[0];
const POWER_COLORS = { rapid: '#ff9a1f', spread: '#a35cff', rocket: '#ef4b3a', laser: '#16b8dc', magnet: '#e0409a' };

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  // Scratch buffers for batched soldier drawing.
  const PX = new Float32Array(256), PY = new Float32Array(256), PS = new Float32Array(256);
  let W = 0, H = 0, dpr = 1;
  let ppu = 4, cx = 0, baseY = 0, horizon = 0, topY = 0, nearD = -30;

  // Returns true when the canvas was actually resized (and so cleared).
  // Setting canvas.width wipes the picture, and mobile Firefox fires many
  // resize events (toolbar moves), so skip no-op and bogus tiny sizes.
  function resize() {
    const rect = canvas.getBoundingClientRect();
    const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
    if (W > 0 && (rect.width < 50 || rect.height < 50)) return false;
    const nextW = Math.max(1, rect.width);
    const nextH = Math.max(1, rect.height);
    const bw = Math.round(nextW * nextDpr);
    const bh = Math.round(nextH * nextDpr);
    if (nextW === W && nextH === H && nextDpr === dpr && canvas.width === bw && canvas.height === bh) return false;
    dpr = nextDpr;
    W = nextW;
    H = nextH;
    canvas.width = bw;
    canvas.height = bh;
    const trackW = Math.min(W * 0.92, H * 0.6);
    ppu = trackW / 100;
    cx = W / 2;
    baseY = H * 0.8;
    topY = Math.min(96, H * 0.11);
    const sV = K / (K + VIEW);
    horizon = (topY - baseY * sV) / (1 - sV);
    const sB = (H - horizon) / (baseY - horizon);
    nearD = K / sB - K - 4;
    return true;
  }

  // Helpers shared with the v2 feature drawer.
  const V = {
    ctx, VIEW, TEAMS,
    proj: (x, d) => proj(x, d),
    quad: (a, b, c, d) => quad(a, b, c, d),
    pill: (...a) => pill(...a),
    outlinedText: (...a) => outlinedText(...a),
    roundRect: (...a) => roundRect(...a),
    fadeFor: (d) => fadeFor(d),
    drawPack: (...a) => drawPack(...a),
    get ppu() { return ppu; },
    get nearD() { return nearD; },
    get W() { return W; },
    get H() { return H; },
  };
  const feat = createFeatureDrawer(V);

  function proj(x, d) {
    const s = K / (K + d);
    return { x: cx + (x - 50) * ppu * s, y: horizon + (baseY - horizon) * s, s };
  }

  function fadeFor(d) {
    return d > VIEW - 25 ? Math.max(0, (VIEW - d) / 25) : 1;
  }

  function drawGround(state) {
    ctx.fillStyle = COLORS.grassA;
    ctx.fillRect(0, 0, W, H);
    const band = 20;
    const start = Math.floor((state.dist + nearD) / band) * band;
    // grass stripes
    ctx.fillStyle = COLORS.grassB;
    for (let y = start; y < state.dist + VIEW + band; y += band) {
      if (Math.floor(y / band) % 2) continue;
      const d0 = Math.max(nearD, y - state.dist);
      const d1 = Math.min(VIEW, y + band - state.dist);
      if (d1 <= d0) continue;
      const a = proj(0, d0), b = proj(0, d1);
      ctx.fillRect(0, b.y, W, a.y - b.y);
    }
    // Rails and track, drawn as one strip per band rather than one tall quad:
    // mobile Firefox's GPU canvas sometimes dropped the tall quads, leaving
    // only the darker bands on green grass (the "flicker"). Strips overlap
    // slightly so there are no seams.
    const strips = [];
    for (let y = start; y < state.dist + VIEW + band; y += band) {
      const d0 = Math.max(nearD, y - state.dist);
      const d1 = Math.min(VIEW, y + band - state.dist);
      if (d1 <= d0) continue;
      strips.push([d0, Math.min(VIEW, d1 + 0.5), Math.floor(y / band) % 2 === 0]);
    }
    ctx.fillStyle = COLORS.rail;
    for (const [d0, d1] of strips) quad(proj(-2.5, d0), proj(102.5, d0), proj(102.5, d1), proj(-2.5, d1));
    for (const [d0, d1, dark] of strips) {
      ctx.fillStyle = dark ? COLORS.trackB : COLORS.track;
      quad(proj(0, d0), proj(100, d0), proj(100, d1), proj(0, d1));
    }
    // lane dashes
    ctx.fillStyle = 'rgba(120,135,155,0.35)';
    const dash = 16;
    const ds = Math.floor((state.dist + nearD) / dash) * dash;
    for (let y = ds; y < state.dist + VIEW; y += dash) {
      const d0 = Math.max(nearD, y - state.dist), d1 = Math.min(VIEW, y + dash * 0.5 - state.dist);
      if (d1 <= d0) continue;
      quad(proj(49.4, d0), proj(50.6, d0), proj(50.6, d1), proj(49.4, d1));
    }
    feat.drawBridges(state);
    feat.drawForks(state);
    // sky haze at the far end
    const sky = ctx.createLinearGradient(0, 0, 0, topY + 40);
    sky.addColorStop(0, '#7fc7ff');
    sky.addColorStop(0.55, '#a9dbff');
    sky.addColorStop(1, 'rgba(169,219,255,0)');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, topY + 40);
  }

  function quad(a, b, c, d) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
    ctx.closePath(); ctx.fill();
  }

  function pill(x, y, text, px, bg, fg = '#fff') {
    ctx.font = font(px);
    const w = ctx.measureText(text).width + px * 0.9;
    const h = px * 1.35;
    ctx.fillStyle = bg;
    roundRect(x - w / 2, y - h / 2, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + px * 0.05);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  function outlinedText(text, x, y, px, fill, stroke = 'rgba(10,20,35,0.75)') {
    ctx.font = font(px);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, px * 0.16);
    ctx.strokeStyle = stroke;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
  }

  // Soldiers are drawn in a few batched paths (shadows, bodies, heads) instead of
  // one draw call each, so 150 soldiers cost about as much as 5.
  function drawPack(team, pack, n, x, d, t, sizeU, bob, spread = 1) {
    let m = 0;
    for (const p of pack) {
      if (p.i >= n) continue;
      const wob = bob ? Math.sin(t * 14 + p.i * 1.7) * 0.25 : 0;
      const q = proj(x + p.ox * spread, d + p.oy * spread + wob);
      PX[m] = q.x; PY[m] = q.y; PS[m] = sizeU * ppu * q.s;
      m += 1;
    }
    if (!m) return;
    const col = TEAMS[team];
    const layer = (fill, fn) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      for (let i = 0; i < m; i++) fn(PX[i], PY[i], PS[i]);
      ctx.fill();
    };
    layer('rgba(0,0,0,0.18)', (X, Y, S) => { ctx.moveTo(X + S * 0.3, Y + S * 0.06); ctx.ellipse(X, Y + S * 0.06, S * 0.3, S * 0.1, 0, 0, TAU); });
    layer(col.dark, (X, Y, S) => { ctx.moveTo(X + S * 0.27, Y - S * 0.2); ctx.arc(X, Y - S * 0.2, S * 0.27, 0, TAU); });
    layer(col.body, (X, Y, S) => { ctx.moveTo(X + S * 0.22, Y - S * 0.24); ctx.arc(X, Y - S * 0.24, S * 0.22, 0, TAU); });
    layer('#ffd9b8', (X, Y, S) => { ctx.moveTo(X + S * 0.15, Y - S * 0.5); ctx.arc(X, Y - S * 0.5, S * 0.15, 0, TAU); });
    layer(col.dark, (X, Y, S) => { ctx.moveTo(X - S * 0.155, Y - S * 0.54); ctx.arc(X, Y - S * 0.54, S * 0.155, Math.PI, TAU); ctx.closePath(); });
  }

  function drawGateRow(state, row) {
    const d = row.y - state.dist;
    if (d < nearD || d > VIEW) return;
    const alpha = fadeFor(d);
    const m = row.move;
    if (m && m.kind === 'slide') {
      // Guide rail the gates slide along, with end stops.
      const g0 = row.gates[0], g1 = row.gates[row.gates.length - 1];
      const a = proj(g0.bx0 - m.amp, d), b = proj(g1.bx1 + m.amp, d);
      const th = Math.max(2, 1.1 * ppu * a.s);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(40,60,90,0.55)';
      ctx.fillRect(a.x, a.y - th / 2, b.x - a.x, th);
      ctx.fillStyle = '#5b6573';
      ctx.fillRect(a.x - th, a.y - th * 2, th * 2, th * 4);
      ctx.fillRect(b.x - th, b.y - th * 2, th * 2, th * 4);
      ctx.globalAlpha = 1;
    }
    const flipT = m && m.kind === 'swap' ? sinceSwap(m, state.t) : 99;
    const flip = flipT < 0.3 ? Math.max(0.06, Math.abs(Math.cos((Math.PI * flipT) / 0.3))) : 1;
    for (const g of row.gates) {
      const mood = gateMood(g);
      const col = mood === 'good' ? COLORS.good : mood === 'bad' ? COLORS.bad : mood === 'gamble' ? '#f5b60a' : COLORS.neutral;
      const edge = mood === 'good' ? COLORS.goodEdge : mood === 'bad' ? COLORS.badEdge : mood === 'gamble' ? '#fff0a8' : '#d5dae0';
      const l = proj(g.x0 + 0.6, d), r = proj(g.x1 - 0.6, d);
      const h = 15 * ppu * l.s;
      const flash = Math.max(0, 1 - (state.t - g.lastHit) / 0.12);
      ctx.globalAlpha = alpha * 0.62;
      ctx.fillStyle = col;
      ctx.fillRect(l.x, l.y - h, r.x - l.x, h);
      if (flash > 0) {
        ctx.globalAlpha = alpha * 0.45 * flash;
        ctx.fillStyle = '#fff';
        ctx.fillRect(l.x, l.y - h, r.x - l.x, h);
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = edge;
      ctx.fillRect(l.x, l.y - h, r.x - l.x, Math.max(2, h * 0.08));
      // posts
      const pw = Math.max(2, 1.6 * ppu * l.s);
      ctx.fillStyle = '#5b6573';
      ctx.fillRect(l.x - pw / 2, l.y - h * 1.05, pw, h * 1.05);
      ctx.fillRect(r.x - pw / 2, r.y - h * 1.05, pw, h * 1.05);
      // label
      const mx = (l.x + r.x) / 2;
      const px = 8.5 * ppu * l.s * (1 + flash * 0.15) * (mood === 'gamble' ? 1.15 + 0.08 * Math.sin(state.t * 6) : 1);
      if (flip < 1) {
        ctx.save();
        ctx.translate(mx, l.y - h * 0.55);
        ctx.scale(flip, 1);
        outlinedText(gateLabel(g), 0, 0, px, '#fff');
        ctx.restore();
      } else {
        outlinedText(gateLabel(g), mx, l.y - h * 0.55, px, '#fff');
      }
      if (g.kind === 'mul') {
        const pr = gateProgress(g);
        const bw = (r.x - l.x) * 0.5, bh = Math.max(3, 1.3 * ppu * l.s);
        const bx = mx - bw / 2, by = l.y - h * 0.18;
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = '#fff';
        ctx.fillRect(bx, by, bw * pr, bh);
      }
      ctx.globalAlpha = 1;
    }
    if (m && m.kind === 'swap') {
      // Swap badge over the middle post: arrows plus a timer to the next swap.
      const g0 = row.gates[0], g1 = row.gates[row.gates.length - 1];
      const q = proj((g0.x0 + g1.x1) / 2, d);
      const h = 15 * ppu * q.s;
      const R = Math.max(11, 3.6 * ppu * q.s);
      const cy = q.y - h - R * 0.9;
      const u = (state.t % m.period) / m.period;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(15,25,40,0.85)';
      ctx.beginPath(); ctx.arc(q.x, cy, R, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,210,63,0.9)';
      ctx.beginPath(); ctx.moveTo(q.x, cy); ctx.arc(q.x, cy, R * 0.92, -Math.PI / 2, -Math.PI / 2 + TAU * u); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(15,25,40,0.9)';
      ctx.beginPath(); ctx.arc(q.x, cy, R * 0.66, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(1.5, R * 0.14);
      ctx.lineCap = 'round';
      const w = R * 0.42, k = R * 0.2;
      ctx.beginPath();
      ctx.moveTo(q.x - w, cy - k); ctx.lineTo(q.x + w, cy - k); ctx.lineTo(q.x + w - k, cy - k * 2);
      ctx.moveTo(q.x + w, cy + k); ctx.lineTo(q.x - w, cy + k); ctx.lineTo(q.x - w + k, cy + k * 2);
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.globalAlpha = 1;
    }
  }

  function drawEnemy(state, e) {
    const d = e.y - state.dist;
    if (d < nearD || d > VIEW) return;
    if (e.kind === 'tower') { feat.drawTower(state, e); return; }
    ctx.globalAlpha = fadeFor(d);
    if (e.kind === 'giant') {
      feat.drawGiant(state, e);
    } else if (e.kind === 'squad') {
      const purple = e.split || e.splitChild;
      drawPack(purple ? 'purple' : 'red', SQUAD_PACK, Math.min(e.count, 80), e.x, d, state.t, 3.5, true);
      const top = proj(e.x, d + squadRadius(e.count) + 2);
      // Past the sprite cap (80) the number does the talking: make it bigger.
      const big = e.count > 80 ? 1.35 : 1;
      pill(top.x, top.y - 4 * ppu * top.s * big, String(e.count), (4.6 * ppu * top.s + 4) * big, purple ? 'rgba(110,40,170,0.92)' : 'rgba(160,30,30,0.9)');
      if (e.shield > 0) feat.drawShield(state, e);
    } else {
      const a = proj(e.x0, d - 2.5), b = proj(e.x1, d - 2.5), c = proj(e.x1, d + 2.5), f = proj(e.x0, d + 2.5);
      const h = 5 * ppu * a.s;
      ctx.fillStyle = '#b8322c';
      ctx.fillRect(a.x, a.y - h, b.x - a.x, h); // front face
      ctx.fillStyle = '#e0605a';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y - h); ctx.lineTo(b.x, b.y - h); ctx.lineTo(c.x, c.y - h); ctx.lineTo(f.x, f.y - h);
      ctx.closePath(); ctx.fill();
      // brick lines
      ctx.strokeStyle = 'rgba(80,10,10,0.45)';
      ctx.lineWidth = 1;
      const bricks = Math.max(2, Math.round((e.x1 - e.x0) / 6));
      ctx.beginPath();
      ctx.moveTo(a.x, a.y - h / 2); ctx.lineTo(b.x, b.y - h / 2);
      for (let i = 1; i < bricks; i++) {
        const x = a.x + ((b.x - a.x) * i) / bricks;
        const off = i % 2 ? 0 : h / 2;
        ctx.moveTo(x, a.y - h + off); ctx.lineTo(x, a.y - h / 2 + off);
      }
      ctx.stroke();
      outlinedText(String(Math.ceil(e.hp)), (a.x + b.x) / 2, a.y - h * 0.5, 5.5 * ppu * a.s + 3, '#fff');
    }
    ctx.globalAlpha = 1;
  }

  function drawPowerup(state, p) {
    const d = p.y - state.dist;
    if (p.taken || d < nearD || d > VIEW) return;
    const q = proj(p.x, d);
    const bob = Math.sin(state.t * 4 + p.id) * 1.2;
    const r = 3.6 * ppu * q.s;
    const y = q.y - r * 1.4 - bob * ppu * q.s;
    ctx.globalAlpha = fadeFor(d);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath(); ctx.ellipse(q.x, q.y, r * 0.9, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = POWER_COLORS[p.kind];
    ctx.beginPath(); ctx.arc(q.x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(1.5, r * 0.14);
    ctx.stroke();
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (p.kind === 'rocket' || p.kind === 'laser' || p.kind === 'magnet') {
      feat.drawWeaponIcon(p.kind, q.x, y, r);
    } else if (p.kind === 'rapid') {
      for (const o of [-0.3, 0.25]) {
        ctx.moveTo(q.x - r * 0.35, y + r * (o + 0.2)); ctx.lineTo(q.x, y + r * (o - 0.15)); ctx.lineTo(q.x + r * 0.35, y + r * (o + 0.2));
      }
    } else {
      for (const a of [-0.5, 0, 0.5]) {
        ctx.moveTo(q.x, y + r * 0.45); ctx.lineTo(q.x + Math.sin(a) * r * 0.6, y + r * 0.45 - Math.cos(a) * r * 0.85);
      }
    }
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.globalAlpha = 1;
  }

  function drawBoss(state) {
    const b = state.boss;
    if (!b.alive && state.phase !== 'won') return;
    const d = b.y - state.dist;
    if (d > VIEW || d < nearD) return;
    const hitT = state.t - b.lastHit;
    const shake = hitT < 0.08 ? (Math.random() - 0.5) * 1.2 : 0;
    // Lean into a coming stomp; hop a little when throwing.
    let lean = 0, hop = 0;
    for (const a of state.bossAtks) {
      if (a.done) continue;
      const u = Math.min(1, (state.t - a.t0) / (a.tHit - a.t0));
      if (a.kind === 'stomp') lean = (a.x0 < 10 ? -1 : 1) * 4 * u;
      else hop = Math.max(hop, Math.sin(u * Math.PI) * 2);
    }
    const q0 = proj(b.x + shake + lean, d);
    const q = { x: q0.x, y: q0.y - hop * ppu * q0.s, s: q0.s };
    const angry = b.phase2 && b.alive;
    const R = b.r * ppu * q.s;
    ctx.globalAlpha = fadeFor(d) * (b.alive ? 1 : 0.35);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(q.x, q.y, R * 1.05, R * 0.35, 0, 0, Math.PI * 2); ctx.fill();
    const cy = q.y - R * 0.95;
    // horns
    ctx.fillStyle = '#f3e6c8';
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(q.x + sgn * R * 0.45, cy - R * 0.7);
      ctx.lineTo(q.x + sgn * R * 0.95, cy - R * 1.35);
      ctx.lineTo(q.x + sgn * R * 0.8, cy - R * 0.45);
      ctx.closePath(); ctx.fill();
    }
    const grad = ctx.createRadialGradient(q.x - R * 0.3, cy - R * 0.4, R * 0.2, q.x, cy, R);
    grad.addColorStop(0, hitT < 0.06 ? '#ff8a80' : angry ? '#ff3020' : '#e0453c');
    grad.addColorStop(1, angry ? '#4d0806' : '#7d1612');
    if (angry) {
      // Red glow.
      ctx.fillStyle = `rgba(255,60,30,${0.18 + 0.1 * Math.sin(state.t * 8)})`;
      ctx.beginPath(); ctx.arc(q.x, cy, R * 1.25, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(q.x, cy, R, 0, Math.PI * 2); ctx.fill();
    // belly
    ctx.fillStyle = 'rgba(255,200,170,0.35)';
    ctx.beginPath(); ctx.ellipse(q.x, cy + R * 0.35, R * 0.55, R * 0.45, 0, 0, Math.PI * 2); ctx.fill();
    // eyes
    for (const sgn of [-1, 1]) {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(q.x + sgn * R * 0.32, cy - R * 0.25, R * 0.17, R * 0.13, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath(); ctx.arc(q.x + sgn * R * 0.28, cy - R * 0.22, R * 0.07, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#3a0705';
      ctx.lineWidth = Math.max(2, R * 0.07);
      ctx.beginPath();
      ctx.moveTo(q.x + sgn * R * 0.12, cy - R * 0.36); ctx.lineTo(q.x + sgn * R * 0.5, cy - R * 0.48); ctx.stroke();
    }
    // mouth
    ctx.strokeStyle = '#3a0705';
    ctx.beginPath(); ctx.arc(q.x, cy + R * 0.32, R * 0.28, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    // HP bar
    if (b.alive) {
      const bw = R * 2.2, bh = Math.max(8, R * 0.16);
      const bx = q.x - bw / 2, by = cy - R * 1.6;
      ctx.fillStyle = 'rgba(20,10,10,0.75)';
      roundRect(bx - 2, by - 2, bw + 4, bh + 4, bh / 2 + 2); ctx.fill();
      ctx.fillStyle = '#ff4a4a';
      roundRect(bx, by, Math.max(0, bw * (b.hp / b.maxHp)), bh, bh / 2); ctx.fill();
      outlinedText(`${angry ? 'ANGRY ' : ''}BOSS ${Math.ceil(b.hp)}`, q.x, by - bh * 1.1, Math.max(11, bh * 1.3), angry ? '#ffb3a8' : '#fff');
      if (b.attacks && !angry) {
        // Notch at 50%: phase 2 starts there.
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillRect(bx + bw / 2 - 1, by - 1, 2, bh + 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawBullets(state) {
    ctx.fillStyle = COLORS.bullet;
    for (const b of state.bullets) {
      const d = b.y - state.dist;
      if (d > VIEW || b.rocket || b.laser) continue;
      const q = proj(b.x, d);
      const r = Math.max(2, 1.0 * ppu * q.s);
      const h = 3 * ppu * q.s;
      ctx.fillRect(q.x - r / 2, q.y - h - r * 4, r, r * 4);
    }
    feat.drawSpecialShots(state);
  }

  function drawCrowd(state) {
    const c = state.crowd;
    if (c.count <= 0) return;
    const n = Math.min(c.count, RENDER_CAP);
    const spread = 1 - SQUEEZE_SHRINK * c.squeeze;
    const r = crowdRadius(c.count) * spread;
    if (c.squeeze > 0.05) {
      // Gold ring on the ground while packed.
      const a = proj(c.x - r - 1.5, 0), b = proj(c.x + r + 1.5, 0);
      ctx.globalAlpha = Math.min(1, c.squeeze * 1.4);
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = Math.max(2, 0.6 * ppu);
      ctx.beginPath();
      ctx.ellipse((a.x + b.x) / 2, a.y, (b.x - a.x) / 2, (b.x - a.x) * 0.3, 0, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    drawPack('blue', CROWD_PACK, n, c.x, 0, state.t, 3.7 * (0.8 + 0.2 * spread), state.phase === 'run' || state.phase === 'boss', spread);
    const px = Math.max(15, 6 * ppu);
    if (state.phase === 'boss' || state.phase === 'won') {
      // Under the crowd so it doesn't cover the boss.
      const bot = proj(c.x, -r * 0.8 - 1);
      pill(bot.x, bot.y + px * 0.9, String(c.count), px, 'rgba(25,70,170,0.92)');
    } else {
      const top = proj(c.x, r * 0.85 + 1);
      pill(top.x, top.y - 3.2 * ppu * top.s - px * 0.6, String(c.count), px, 'rgba(25,70,170,0.92)');
    }
  }

  function drawFx(state, fx) {
    for (const p of fx.particles) {
      const q = proj(p.x, p.y - state.dist);
      const sz = Math.max(1.5, p.size * ppu * q.s);
      ctx.globalAlpha = Math.min(1, p.life / p.max * 1.5);
      ctx.fillStyle = p.color;
      ctx.fillRect(q.x - sz / 2, q.y - p.z * ppu * q.s - sz / 2, sz, sz);
    }
    ctx.globalAlpha = 1;
    for (const tx of fx.texts) {
      const q = proj(tx.x, tx.y - state.dist);
      const a = Math.min(1, tx.life / 0.35);
      const grow = 1 + Math.max(0, tx.life - (tx.max - 0.15)) * 3;
      ctx.globalAlpha = a;
      const y = tx.screen ? H * tx.sy - (tx.max - tx.life) * 30 : q.y - (tx.max - tx.life) * 70 - 20 * ppu * q.s;
      const x = tx.screen ? W / 2 : q.x;
      outlinedText(tx.text, x, y, tx.size * Math.min(1.6, Math.max(0.8, ppu / 4)) * grow, tx.color);
    }
    ctx.globalAlpha = 1;
  }

  // Squeeze pad (bottom right). Its hit area is kept for the input module.
  let padGeom = null;
  function drawPad(state, x0, colW) {
    const R = 36;
    const x = x0 + colW - R - 16, y = H - R - 26;
    padGeom = { x, y, r: R + 14 };
    const on = state.crowd.packed;
    ctx.fillStyle = on ? 'rgba(255,210,63,0.92)' : 'rgba(15,25,40,0.5)';
    ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
    ctx.strokeStyle = on ? '#fff' : 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // Icon: two arrows pointing inward.
    const ink = on ? '#14202e' : '#ffffff';
    ctx.strokeStyle = ink;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const sgn of [-1, 1]) {
      const tip = x + sgn * 4, tail = x + sgn * 18;
      ctx.moveTo(tail, y - 6); ctx.lineTo(tip, y - 6);
      ctx.moveTo(tip + sgn * 6, y - 12); ctx.lineTo(tip, y - 6); ctx.lineTo(tip + sgn * 6, y);
    }
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = ink;
    ctx.font = font(10.5);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(on ? 'PACKED' : 'SQUEEZE', x, y + 13);
  }

  function hitPad(x, y) {
    if (!padGeom) return false;
    const dx = x - padGeom.x, dy = y - padGeom.y;
    return dx * dx + dy * dy <= padGeom.r * padGeom.r;
  }

  function drawHud(state, hud) {
    const pad = 10;
    const colW = Math.min(W, 520);
    const x0 = (W - colW) / 2;
    const barX = x0 + 60, barW = Math.max(60, colW - 60 - 110), barY = 16, barH = 14;
    // level + progress
    ctx.fillStyle = 'rgba(15,25,40,0.55)';
    roundRect(barX - 4, barY - 4, barW + 8, barH + 8, (barH + 8) / 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    roundRect(barX, barY, Math.max(barH, barW * progress(state)), barH, barH / 2); ctx.fill();
    outlinedText(`LEVEL ${state.level}`, barX + barW / 2, barY + barH + 15, 14, '#fff');
    // boss marker
    ctx.fillStyle = '#ff4a4a';
    ctx.beginPath(); ctx.arc(barX + barW - 2, barY + barH / 2, barH * 0.55, 0, Math.PI * 2); ctx.fill();
    // coins
    const coins = (hud.bankedCoins || 0) + state.coins;
    const cxp = x0 + colW - pad - 14;
    ctx.font = font(18);
    const txt = String(coins);
    const tw = ctx.measureText(txt).width;
    ctx.fillStyle = 'rgba(15,25,40,0.55)';
    roundRect(cxp - tw - 34, barY - 6, tw + 48, 30, 15); ctx.fill();
    ctx.fillStyle = COLORS.coin;
    ctx.beginPath(); ctx.arc(cxp - tw - 16, barY + 9, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e09e12';
    ctx.beginPath(); ctx.arc(cxp - tw - 16, barY + 9, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, cxp + 6, barY + 10);
    if (hud.pad) drawPad(state, x0, colW);
    else padGeom = null;
    // buffs
    let bx = barX;
    for (const [k, label] of [['rapid', 'RAPID'], ['spread', 'SPREAD'], ['rocket', 'ROCKET'], ['laser', 'LASER'], ['magnet', 'MAGNET']]) {
      const col = POWER_COLORS[k];
      const t = state.buffs[k];
      if (t <= 0) continue;
      const text = `${label} ${t.toFixed(1)}s`;
      ctx.font = font(12);
      const w = ctx.measureText(text).width + 16;
      ctx.fillStyle = col;
      roundRect(bx, barY + barH + 28, w, 20, 10); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(text, bx + 8, barY + barH + 38.5);
      bx += w + 6;
    }
  }

  function draw(state, fx, hud = {}) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sh = fx.shake;
    const sx = sh > 0 ? (Math.random() - 0.5) * sh : 0;
    const sy = sh > 0 ? (Math.random() - 0.5) * sh : 0;
    ctx.save();
    ctx.translate(sx, sy);
    drawGround(state);

    // Painter's order: far to near. Only what's in view, in reused slots, so a
    // frame allocates next to nothing (less garbage, fewer GC pauses).
    let n = 0;
    const lo = state.dist + nearD - 12, hi = state.dist + VIEW + 2;
    const add = (y, k, o) => {
      const it = ITEM_POOL[n] || (ITEM_POOL[n] = [0, 0, null]);
      it[0] = y; it[1] = k; it[2] = o;
      n += 1;
    };
    for (const row of state.rows) if (!row.used && row.y > lo && row.y < hi) add(row.y, 0, row);
    for (const e of state.enemies) if (e.alive && e.y > lo && e.y < hi) add(e.y, 1, e);
    for (const p of state.powerups) if (!p.taken && p.y > lo && p.y < hi) add(p.y, 2, p);
    for (const h of state.hazards) if (h.y > lo && h.y < hi) add(h.y, 3, h);
    for (const g of state.segments) if (g.kind === 'fork' && g.y0 - state.dist > 0 && g.y0 - state.dist < VIEW) add(g.y0, 4, g);
    for (const k of state.coinItems) {
      if (k.taken) continue;
      const d = k.y - state.dist;
      if (d > VIEW) break;
      if (d > nearD) add(k.y, 5, k);
    }
    const items = ITEMS;
    items.length = 0;
    for (let i = 0; i < n; i++) items.push(ITEM_POOL[i]);
    items.sort(farFirst);
    feat.drawArrowMarks(state);
    feat.drawBossTelegraphs(state);
    drawBoss(state);
    for (let i = 0; i < n; i++) {
      const k = items[i][1], o = items[i][2];
      if (k === 0) drawGateRow(state, o);
      else if (k === 1) drawEnemy(state, o);
      else if (k === 2) drawPowerup(state, o);
      else if (k === 3) feat.drawHazard(state, o);
      else if (k === 4) feat.drawForkSigns(state, o);
      else feat.drawCoin(state, o);
    }
    drawBullets(state);
    feat.drawMagnetField(state);
    drawCrowd(state);
    feat.drawBoulders(state);
    feat.drawArrows(state);
    drawFx(state, fx);
    ctx.restore();
    if (hud.hidden) padGeom = null;
    if (!hud.hidden) {
      feat.drawAmbushFlash(fx);
      feat.drawAmbushWarnings(state);
      drawHud(state, hud);
      feat.drawHint(fx);
    }
  }

  resize();
  return { resize, draw, hitPad, get size() { return { W, H, ppu }; } };
}
