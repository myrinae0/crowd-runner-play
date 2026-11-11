// Canvas renderer. Reads sim state, never changes it.
// Mild perspective: things further down the track get smaller and closer together.

import { RENDER_CAP } from './config.js';
import { gateLabel, gateMood, gateProgress } from './gates.js';
import { crowdRadius, squadRadius } from './combat.js';
import { progress } from './sim.js';

const VIEW = 175;     // how far ahead (world units) we draw
const K = 300;        // perspective strength (bigger = flatter)
const FONT = '800 {px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const COLORS = {
  grassA: '#4fae5f', grassB: '#46a055', track: '#e8edf3', trackB: '#dde4ec',
  rail: '#9aa7b6', crowd: '#2f7cf6', crowdDark: '#1b4fb0', enemy: '#e2453c', enemyDark: '#9e2420',
  good: '#22b0ff', goodEdge: '#9fe2ff', bad: '#ff4a4a', badEdge: '#ffb3b3', neutral: '#9aa3ad',
  bullet: '#ffd23f', coin: '#ffc934', text: '#ffffff', ink: '#14202e',
};

const font = (px) => FONT.replace('{px}', Math.max(6, Math.round(px)));

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
};
const TAU = Math.PI * 2;

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  // Scratch buffers for batched soldier drawing.
  const PX = new Float32Array(256), PY = new Float32Array(256), PS = new Float32Array(256);
  let W = 0, H = 0, dpr = 1;
  let ppu = 4, cx = 0, baseY = 0, horizon = 0, topY = 0, nearD = -30;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const trackW = Math.min(W * 0.92, H * 0.6);
    ppu = trackW / 100;
    cx = W / 2;
    baseY = H * 0.8;
    topY = Math.min(96, H * 0.11);
    const sV = K / (K + VIEW);
    horizon = (topY - baseY * sV) / (1 - sV);
    const sB = (H - horizon) / (baseY - horizon);
    nearD = K / sB - K - 4;
  }

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
    // rails and track as single quads (no seams)
    ctx.fillStyle = COLORS.rail;
    quad(proj(-2.5, nearD), proj(102.5, nearD), proj(102.5, VIEW), proj(-2.5, VIEW));
    ctx.fillStyle = COLORS.track;
    quad(proj(0, nearD), proj(100, nearD), proj(100, VIEW), proj(0, VIEW));
    // darker track bands for a sense of speed
    ctx.fillStyle = COLORS.trackB;
    for (let y = start; y < state.dist + VIEW + band; y += band) {
      if (Math.floor(y / band) % 2) continue;
      const d0 = Math.max(nearD, y - state.dist);
      const d1 = Math.min(VIEW, y + band - state.dist);
      if (d1 <= d0) continue;
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
  function drawPack(team, pack, n, x, d, t, sizeU, bob) {
    let m = 0;
    for (const p of pack) {
      if (p.i >= n) continue;
      const wob = bob ? Math.sin(t * 14 + p.i * 1.7) * 0.25 : 0;
      const q = proj(x + p.ox, d + p.oy + wob);
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
    for (const g of row.gates) {
      const mood = gateMood(g);
      const col = mood === 'good' ? COLORS.good : mood === 'bad' ? COLORS.bad : COLORS.neutral;
      const edge = mood === 'good' ? COLORS.goodEdge : mood === 'bad' ? COLORS.badEdge : '#d5dae0';
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
      const px = 8.5 * ppu * l.s * (1 + flash * 0.15);
      outlinedText(gateLabel(g), mx, l.y - h * 0.55, px, '#fff');
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
  }

  function drawEnemy(state, e) {
    const d = e.y - state.dist;
    if (d < nearD || d > VIEW) return;
    ctx.globalAlpha = fadeFor(d);
    if (e.kind === 'squad') {
      drawPack('red', SQUAD_PACK, Math.min(e.count, 80), e.x, d, state.t, 3.5, true);
      const top = proj(e.x, d + squadRadius(e.count) + 2);
      pill(top.x, top.y - 4 * ppu * top.s, String(e.count), 4.6 * ppu * top.s + 4, 'rgba(160,30,30,0.9)');
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
    ctx.fillStyle = p.kind === 'rapid' ? '#ff9a1f' : '#a35cff';
    ctx.beginPath(); ctx.arc(q.x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(1.5, r * 0.14);
    ctx.stroke();
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (p.kind === 'rapid') {
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
    const q = proj(b.x + shake, d);
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
    grad.addColorStop(0, hitT < 0.06 ? '#ff8a80' : '#e0453c');
    grad.addColorStop(1, '#7d1612');
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
      outlinedText(`BOSS ${Math.ceil(b.hp)}`, q.x, by - bh * 1.1, Math.max(11, bh * 1.3), '#fff');
    }
    ctx.globalAlpha = 1;
  }

  function drawBullets(state) {
    ctx.fillStyle = COLORS.bullet;
    for (const b of state.bullets) {
      const d = b.y - state.dist;
      if (d > VIEW) continue;
      const q = proj(b.x, d);
      const r = Math.max(2, 1.0 * ppu * q.s);
      const h = 3 * ppu * q.s;
      ctx.fillRect(q.x - r / 2, q.y - h - r * 4, r, r * 4);
    }
  }

  function drawCrowd(state) {
    const c = state.crowd;
    if (c.count <= 0) return;
    const n = Math.min(c.count, RENDER_CAP);
    drawPack('blue', CROWD_PACK, n, c.x, 0, state.t, 3.7, state.phase === 'run' || state.phase === 'boss');
    const r = crowdRadius(c.count);
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
    // buffs
    let bx = barX;
    for (const [k, label, col] of [['rapid', 'RAPID', '#ff9a1f'], ['spread', 'SPREAD', '#a35cff']]) {
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

    // Painter's order: far to near.
    const items = [];
    for (const row of state.rows) if (!row.used) items.push([row.y, 0, row]);
    for (const e of state.enemies) if (e.alive) items.push([e.y, 1, e]);
    for (const p of state.powerups) if (!p.taken) items.push([p.y, 2, p]);
    items.sort((a, b) => b[0] - a[0]);
    drawBoss(state);
    for (const [, k, o] of items) {
      if (k === 0) drawGateRow(state, o);
      else if (k === 1) drawEnemy(state, o);
      else drawPowerup(state, o);
    }
    drawBullets(state);
    drawCrowd(state);
    drawFx(state, fx);
    ctx.restore();
    if (!hud.hidden) drawHud(state, hud);
  }

  resize();
  return { resize, draw, get size() { return { W, H, ppu }; } };
}
