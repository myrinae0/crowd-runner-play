// Pixel-art drawing for the v2/v3 mechanics (hazards, road features, special
// enemies, projectiles, warnings, hints). Gets the renderer's helpers through
// `V` and reads sim state only. Floor-level marks (saw rails, crusher
// footprints, boss telegraphs, stomp rings) are handed to the floor renderer
// as tints, so they are drawn per pixel row with the floor itself.

import { SAW_R, ARROW_R, AMBUSH_FROM, AMBUSH_WARN, SQUEEZE_SHRINK } from './config.js';
import { squadRadius, crowdRadius } from './combat.js';
import { sawX, crusherLift, crusherWarn } from './hazards.js';
import { bandFor, intScale, pickSize } from './pixel/atlas.js';
import { wrapText } from './pixel/font.js';
import { OUT } from './pixel/palette.js';

const SAW_SIZES = [7, 9, 11, 13, 15, 17, 19, 22];
// Slash arc widths (pre-drawn) and the height ratios they come in.
export const SLASH_W = [16, 20, 24, 30, 36, 44, 52, 62, 74, 88, 104, 124];
export const SLASH_RATIOS = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6];
export const SLASH_HALVES = [55, 65, 75, 85, 95];
const BOULDER_SIZES = [5, 7, 9, 11, 13, 15, 17];

export function createFeatureDrawer(V) {
  const { gfx, R, rect, box, pill, proj } = V;
  const G = () => V.g;

  // ---- floor marks (tints handed to the floor renderer) ----------------------
  function floorMarks(state, F) {
    const dist = state.dist;
    for (const h of state.hazards) {
      const d = h.y - dist;
      if (d < V.nearD - 10 || d > V.VIEW) continue;
      if (h.kind === 'saw') {
        F.tints.push({ y0: h.y - 0.9, y1: h.y + 0.9, x0: h.a - SAW_R - 1, x1: h.b + SAW_R + 1, c: [35, 42, 55], a: 0.65 });
      } else if (h.kind === 'crusher') {
        const lift = crusherLift(h, state.t), warn = crusherWarn(h, state.t);
        F.tints.push({
          y0: h.y - h.depth / 2, y1: h.y + h.depth / 2, x0: h.x0 + 0.6, x1: h.x1 - 0.6,
          c: lift < 0.3 ? [200, 40, 30] : [230, 70, 40], a: lift < 0.3 ? 0.45 : 0.12 + 0.3 * warn,
        });
      }
    }
    if (!state.bossAtks.length) return;
    const far = state.boss.y;
    for (const a of state.bossAtks) {
      const u = Math.min(1, (state.t - a.t0) / (a.tHit - a.t0));
      const after = state.t - a.tHit;
      if (after > 0.35) continue;
      const boulder = a.kind === 'boulder';
      const pulse = 0.5 + 0.5 * Math.sin(state.t * (10 + u * 14));
      const alpha = after > 0 ? 0.5 * (1 - after / 0.35) : 0.16 + 0.34 * u + 0.12 * pulse;
      const y0 = dist + Math.max(V.nearD, -30);
      F.tints.push({ y0, y1: far, x0: a.x0, x1: a.x1, c: boulder ? [230, 40, 30] : [255, 120, 20], a: alpha });
      for (const x of [a.x0, a.x1]) {
        if (x <= 0.5 || x >= 99.5) continue;
        F.tints.push({ y0, y1: far, x0: x - 0.6, x1: x + 0.6, c: boulder ? [200, 20, 10] : [230, 90, 10], a: 0.85 });
      }
      if (!boulder && after > 0) {
        const bq = proj(state.boss.x, far - dist);
        for (let i = 0; i < 3; i++) {
          const rx = (after * 900 + i * 50) * 0.5;
          F.rings.push({ cx: bq.x, cy: bq.y, rx, ry: rx * 0.35, t: 3, wx0: a.x0, wx1: a.x1, c: [255, 240, 200], a: 0.9 * (1 - after / 0.35) });
        }
      }
    }
  }

  // ---- saws -------------------------------------------------------------------------
  function drawSaw(state, h) {
    const d = h.y - state.dist;
    if (d < V.nearD - 8 || d > V.VIEW) return;
    const g = G();
    g.globalAlpha = V.fadeFor(d);
    const a = proj(h.a - SAW_R - 1, d), b = proj(h.b + SAW_R + 1, d);
    const ph = Math.max(3, R(4 * V.ppu * a.s));
    for (const p of [a, b]) { box(p.x - 1, p.y - ph, 2, ph, '#f2c230'); rect(p.x - 1, p.y - ph, 2, 1, '#fff3a6'); }
    const x = sawX(h, state.t);
    const q = proj(x, d);
    const size = pickSize(SAW_SIZES, SAW_R * 2 * V.ppu * q.s);
    const hot = state.t - (h.lastHit ?? -9) < 0.15;
    const frame = Math.floor(state.t * 20) % 4;
    gfx.blit(g, gfx.ellipse(Math.max(4, R(size * 0.9)), 3, 'rgba(43,29,43,0.3)'), q.x, q.y, true);
    gfx.blit(g, gfx.saw(size, frame, hot), q.x, R(q.y + size * 0.38));
    g.globalAlpha = 1;
  }

  // ---- crushers -----------------------------------------------------------------------
  function drawCrusher(state, h) {
    const d = h.y - state.dist;
    if (d < V.nearD - 10 || d > V.VIEW) return;
    const g = G();
    const lift = crusherLift(h, state.t);
    const warn = crusherWarn(h, state.t);
    g.globalAlpha = V.fadeFor(d);
    const fa = proj(h.x0 + 0.6, d - h.depth / 2), fb = proj(h.x1 - 0.6, d - h.depth / 2);
    const ba = proj(h.x0 + 0.6, d + h.depth / 2);
    const s = fa.s;
    const x0 = R(fa.x), x1 = R(fb.x), w = x1 - x0;
    const top = R(30 * V.ppu * s);
    const pw = Math.max(2, R(2 * V.ppu * s));
    // Frame: posts and beam.
    box(x0 - pw, R(fa.y) - top, pw, top, '#5a6988');
    box(x1, R(fb.y) - top, pw, top, '#5a6988');
    box(x0 - pw, R(fa.y) - top - pw, w + pw * 2, pw, '#8b9bb4');
    // Block: top face, then front face with hazard stripes.
    const gapH = R(lift * 20 * V.ppu * s);
    const bh = Math.max(3, R(10 * V.ppu * s));
    const wob = warn > 0 ? R(Math.sin(state.t * 70) * warn * 1.5) : 0;
    const y0 = R(fa.y) - gapH - bh + wob;
    const by0 = R(ba.y - gapH * (ba.s / s) - bh * (ba.s / s)) + wob;
    if (by0 < y0) box(x0, by0, w, y0 - by0, '#c0cbdc');
    box(x0, y0, w, bh, '#8b9bb4');
    rect(x0, y0, w, 1, '#c0cbdc');
    const sh = Math.max(2, R(bh * 0.35));
    const sy = y0 + bh - sh;
    rect(x0, sy, w, sh, '#f2c230');
    g.fillStyle = '#20242b';
    for (let yy = 0; yy < sh; yy++) for (let xx = -sh; xx < w; xx += sh * 2) {
      const a = Math.max(0, xx + yy), e = Math.min(w, xx + yy + sh);
      if (e > a) g.fillRect(x0 + a, sy + yy, e - a, 1);
    }
    g.globalAlpha = 1;
  }

  // ---- archer towers: stone tower, red banner, an archer on top ---------------------
  function drawTower(state, e) {
    const d = e.y - state.dist;
    if (d < V.nearD || d > V.VIEW) return;
    const g = G();
    g.globalAlpha = V.fadeFor(d);
    const x = (e.x0 + e.x1) / 2;
    const q = proj(x, d);
    const w = Math.max(6, R((e.x1 - e.x0) * V.ppu * q.s));
    const h = Math.max(10, R(17 * V.ppu * q.s));
    const flash = state.t - (e.lastHit ?? -9) < 0.08;
    const X = R(q.x - w / 2), Y = R(q.y) - h;
    gfx.blit(g, gfx.ellipse(R(w * 1.3), 3, 'rgba(43,29,43,0.3)'), q.x, q.y, true);
    box(X, Y, w, h, flash ? '#e8ddd6' : '#a3a7b3');
    rect(X + R(w * 0.62), Y, w - R(w * 0.62), h, flash ? '#d0c4bc' : '#7f8492');
    g.fillStyle = '#5f6370';
    for (let yy = 4, k = 0; yy < h; yy += 4, k++) {
      g.fillRect(X, Y + yy, w, 1);
      for (let xx = (k & 1) * 3 + 2; xx < w; xx += 6) g.fillRect(X + xx, Y + yy - 3, 1, 3);
    }
    // Battlements.
    const bw = w + 4;
    box(X - 2, Y - 3, bw, 3, '#8b8f9b');
    for (let i = 0; i < bw; i += 3) box(X - 2 + i, Y - 5, 2, 2, '#8b8f9b');
    // Banner.
    const fw = Math.max(3, R(w * 0.36)), fh = Math.max(4, R(h * 0.4));
    const fx = R(q.x - fw / 2), fy = Y + R(h * 0.2);
    box(fx, fy, fw, fh, '#e84537');
    rect(fx, fy, fw, 1, '#ff7571');
    rect(R(q.x) - (fw > 4 ? 1 : 0), fy + fh - 1, fw > 4 ? 2 : 1, 1, OUT);
    // Archer.
    gfx.spr(g, `soldier-red-${bandFor(q.s)}-${Math.floor(state.t * 3) & 1}`, q.x, Y - 3);
    pill(q.x, R(q.y) + 7, String(Math.ceil(e.hp)), '#e84537', '#7a1712', 1, bandFor(q.s) === 'S' ? 'small' : 'big');
    g.globalAlpha = 1;
  }

  // ---- walls: a red brick wall with its HP --------------------------------------------
  function drawWall(state, e) {
    const d = e.y - state.dist;
    const g = G();
    const a = proj(e.x0, d - 2.5), b = proj(e.x1, d - 2.5), c = proj(e.x0, d + 2.5);
    const h = Math.max(4, R(5 * V.ppu * a.s));
    const x = R(a.x), w = R(b.x) - x, y = R(a.y) - h;
    const top = R(c.y - 5 * V.ppu * c.s);
    if (top < y) box(x, top, w, y - top, '#e0605a');
    box(x, y, w, h, '#b8322c');
    rect(x, y, w, 1, '#e0605a');
    g.fillStyle = '#7a1c18';
    const bh = Math.max(2, R(h / 3));
    const bwk = Math.max(4, bh * 2);
    for (let yy = bh, k = 0; yy < h; yy += bh, k++) g.fillRect(x, y + yy, w, 1);
    for (let yy = 0, k = 0; yy < h; yy += bh, k++) {
      for (let xx = (k & 1) * (bwk >> 1) + bwk; xx < w; xx += bwk) g.fillRect(x + xx, y + yy + 1, 1, Math.min(bh - 1, h - yy - 1));
    }
    const ft = V.fitText(String(Math.ceil(e.hp)), w - 2, bandFor(a.s) === 'L' ? 2 : 1);
    gfx.text(g, String(Math.ceil(e.hp)), x + w / 2, y + h / 2, '#ffffff', ft);
  }

  // ---- giants: the enemy soldier at a whole-number scale ----------------------------
  function drawGiant(state, e) {
    const d = e.y - state.dist;
    const g = G();
    const q = proj(e.x, d);
    const hot = state.t - (e.lastHit ?? -9) < 0.06;
    const sc = intScale(14 * V.ppu * q.s * 2.2, 16, 4); // about 3x a soldier sprite up close
    gfx.blit(g, gfx.ellipse(10 * sc, 2 + sc, 'rgba(43,29,43,0.32)'), q.x, q.y, true);
    gfx.spr(g, `soldier-red-L-${Math.floor(state.t * 3) & 1}${hot ? '-flash' : ''}`, q.x, R(q.y) + sc, sc);
    const fh = gfx.frame('soldier-red-L-0').h * sc;
    const bw = Math.max(20, 10 * sc), bx = R(q.x - bw / 2), by = R(q.y) - fh - 4;
    box(bx, by, bw, 2, '#4a1a1a');
    rect(bx, by, R(bw * Math.max(0, e.hp / e.start)), 2, '#ff4a4a');
    pill(q.x, by - 8, String(Math.ceil(e.hp)), '#e84537', '#7a1712', 1);
  }

  // ---- shields: a row of steel plates in front of the squad -------------------------
  function drawShield(state, e) {
    const d = e.y - state.dist;
    const g = G();
    const Rw = squadRadius(e.count) + 1.4;
    const front = d - Rw * 0.8;
    const l = proj(e.x - Rw, front), r = proj(e.x + Rw, front);
    const h = Math.max(4, R(4.6 * V.ppu * l.s));
    const hot = state.t - (e.lastHit ?? -9) < 0.06;
    const k = e.shield / (e.shieldMax || e.shield);
    const x0 = R(l.x), w = R(r.x) - x0, y = R(l.y) - h;
    const n = Math.max(2, Math.round(w / 7));
    const pwid = w / n;
    const fill = hot ? '#eef6ff' : k > 0.5 ? '#9fb7d6' : '#b8a4a4';
    for (let i = 0; i < n; i++) {
      const px = R(x0 + i * pwid), pw2 = R(x0 + (i + 1) * pwid) - px - 1;
      const bow = R(Math.sin(((i + 0.5) / n) * Math.PI) * 2); // curved wall: middle plates further forward
      box(px, y + bow, pw2, h, fill);
      rect(px, y + bow, pw2, 1, '#eaf3fb');
      if (pw2 >= 3 && h >= 5) rect(px + R(pw2 / 2), y + bow + R(h / 2), 1, 1, '#5a6988');
    }
    pill(x0 + w / 2, y - 6, String(Math.ceil(e.shield)), '#5a6988', '#2a3450', 1, bandFor(l.s) === 'S' ? 'small' : 'big');
  }

  // ---- arrows ---------------------------------------------------------------------------
  function drawArrowMarks(state) {
    const g = G();
    for (const a of state.arrows) {
      const d = a.ty - state.dist;
      if (d < V.nearD || d > V.VIEW) continue;
      const u = Math.min(1, (state.t - a.t0) / (a.t1 - a.t0));
      const q = proj(a.tx, d);
      const w = Math.max(6, R(((ARROW_R + 1.5) * V.ppu * q.s * (1.5 - 0.5 * u))) * 2);
      const h = Math.max(4, R(w * 0.4 / 2) * 2);
      g.globalAlpha = 0.55 + 0.45 * u;
      gfx.blit(g, gfx.ellipse(w, h, 'rgba(255,50,40,0.35)'), q.x, q.y, true);
      gfx.blit(g, gfx.ring(w, h, '#ff3b30', 1), q.x, q.y, true);
      rect(R(q.x) - 2, R(q.y), 5, 1, '#ff3b30');
      rect(R(q.x), R(q.y) - 1, 1, 3, '#ff3b30');
    }
    g.globalAlpha = 1;
  }

  const TOWER_TOP = 17;
  function arrowPos(a, u, dist) {
    const wx = a.x0 + (a.tx - a.x0) * u;
    const wy = a.y0 + (a.ty - a.y0) * u;
    const z = TOWER_TOP * (1 - u) + 30 * u * (1 - u);
    const q = proj(wx, wy - dist);
    return { x: q.x, y: q.y - z * V.ppu * q.s, s: q.s };
  }
  function drawArrows(state) {
    const g = G();
    for (const a of state.arrows) {
      const u = Math.min(1, (state.t - a.t0) / (a.t1 - a.t0));
      if (a.ty - state.dist > V.VIEW) continue;
      const p = arrowPos(a, u, state.dist);
      const b = arrowPos(a, Math.max(0, u - 0.05), state.dist);
      let dx = p.x - b.x, dy = p.y - b.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      const L = Math.max(7, R(6 * V.ppu * p.s));
      // Shaft as pixels: white halo first, then brown.
      for (const [col, sz] of [['#ffffff', 3], ['#7a4434', 1]]) {
        g.fillStyle = col;
        for (let i = 0; i <= L; i++) g.fillRect(R(p.x - dx * i) - (sz >> 1), R(p.y - dy * i) - (sz >> 1), sz, sz);
      }
      box(R(p.x) - 1, R(p.y) - 1, 2, 2, '#e84537');
      rect(R(p.x - dx * L) - 1, R(p.y - dy * L) - 1, 2, 2, '#ffffff');
    }
  }

  // ---- fork: hedge front face and the RISKY / SAFE signs -------------------------------
  function drawForkStart(state, sg) {
    const d = sg.y0 - state.dist;
    if (d < V.nearD || d > V.VIEW) return;
    const g = G();
    g.globalAlpha = V.fadeFor(d);
    const l = proj(sg.d0, d), r = proj(sg.d1, d);
    const hh = Math.max(2, R(3.2 * V.ppu * l.s));
    box(R(l.x), R(l.y) - hh, R(r.x) - R(l.x), hh, '#2f6e3c');
    rect(R(l.x), R(l.y) - hh, R(r.x) - R(l.x), 1, '#84c669');
    if (d >= 6) {
      for (const side of ['left', 'right']) {
        const risky = side === sg.risky;
        const q = proj(side === 'left' ? 24 : 76, d);
        const ph = R(13 * V.ppu * q.s);
        box(R(q.x) - 1, R(q.y) - ph, 2, ph, '#7a4434');
        pill(q.x, R(q.y) - ph - 4, risky ? 'RISKY' : 'SAFE', risky ? '#d63c28' : '#289650', risky ? '#7a1712' : '#145a2c', 1, bandFor(q.s) === 'S' ? 'small' : 'big');
      }
    }
    g.globalAlpha = 1;
  }

  // ---- boss attacks ----------------------------------------------------------------------
  function drawTelegraphMarks(state) {
    if (!state.bossAtks.length) return;
    for (const a of state.bossAtks) {
      const u = Math.min(1, (state.t - a.t0) / (a.tHit - a.t0));
      if (state.t - a.tHit > 0) continue;
      const pulse = Math.sin(state.t * (10 + u * 14)) > 0;
      const q = proj((a.x0 + a.x1) / 2, 2);
      gfx.text(G(), '!', q.x, q.y - 22, a.kind === 'boulder' ? (pulse ? '#ff4a3c' : '#ffb3a8') : (pulse ? '#ff9a2e' : '#ffd8a8'), { scale: 3 });
    }
  }

  function drawBoulders(state) {
    if (!state.bossAtks.length) return;
    const g = G();
    const far = state.boss.y - state.dist;
    for (const a of state.bossAtks) {
      if (a.kind !== 'boulder') continue;
      const fly = 0.55;
      const tt = state.t - (a.tHit - fly);
      if (tt < 0) continue;
      const x = (a.x0 + a.x1) / 2;
      let d, z, alpha = 1;
      if (tt <= fly) {
        const u = tt / fly;
        d = far + (0 - far) * u;
        z = 26 * (1 - u) + 30 * u * (1 - u);
      } else {
        const k = tt - fly;
        d = -k * 45;
        z = Math.abs(Math.sin(k * 9)) * 3 * (1 - k);
        alpha = Math.max(0, 1 - k / 0.8);
      }
      const q = proj(x, d);
      const size = pickSize(BOULDER_SIZES, 9.2 * V.ppu * q.s);
      g.globalAlpha = alpha;
      gfx.blit(g, gfx.ellipse(size, 3, 'rgba(43,29,43,0.32)'), q.x, q.y, true);
      gfx.blit(g, gfx.boulder(size, Math.floor(state.t * 10) % 4), q.x, R(q.y - z * V.ppu * q.s) + 1);
      g.globalAlpha = 1;
    }
  }

  // ---- coins on the track (spinning) ------------------------------------------------------
  function drawCoin(state, k) {
    const d = k.y - state.dist;
    const q = proj(k.x, d);
    const spin = Math.abs(Math.cos(state.t * 4 + k.id * 0.7));
    const f = spin > 0.85 ? 0 : spin > 0.55 ? 1 : spin > 0.25 ? 2 : 3;
    const band = bandFor(q.s);
    const g = G();
    g.globalAlpha = V.fadeFor(d);
    gfx.spr(g, `coin-${band}-${f}`, q.x, q.y - (k.pulled ? 6 : 2));
    g.globalAlpha = 1;
  }

  // ---- rockets and lasers -------------------------------------------------------------------
  function drawSpecialShots(state) {
    const g = G();
    for (const b of state.bullets) {
      if (!b.rocket && !b.laser) continue;
      const d = b.y - state.dist;
      if (d > V.VIEW) continue;
      const q = proj(b.x, d);
      const lift = 3 * V.ppu * q.s;
      if (b.reflect) {
        // A blocked arrow flying back at its tower: white shaft, blue head.
        const t = proj(b.x - (b.vx / 120) * 4, d - (b.vy / 120) * 4);
        const x0 = R(q.x), y0 = R(q.y - lift), x1 = R(t.x), y1 = R(t.y - lift);
        const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
        g.fillStyle = '#ffffff';
        for (let i = 0; i <= n; i++) g.fillRect(R(x0 + ((x1 - x0) * i) / n), R(y0 + ((y1 - y0) * i) / n), 1, 1);
        box(x0 - 1, y0 - 1, 2, 2, '#6fb0ff');
      } else if (b.laser) {
        const t = proj(b.x, d + 7);
        const y1 = R(t.y - lift), y0 = R(q.y - lift);
        g.globalAlpha = 0.5;
        rect(R(q.x) - 1, y1, 3, y0 - y1, '#78f0ff');
        g.globalAlpha = 1;
        rect(R(q.x), y1, 1, y0 - y1, '#e8fdff');
      } else {
        const x = R(q.x), y = R(q.y - lift);
        g.fillStyle = '#e6e6e6';
        for (let i = 1; i <= 3; i++) {
          const p = proj(b.x, d - i * 3.2);
          const sz = 1 + (i > 1 ? 1 : 0);
          g.fillRect(R(p.x) - (sz >> 1), R(p.y - lift) + 1, sz, sz);
        }
        rect(x - 1, y + 1, 3, 2, state.tick % 4 < 2 ? '#ffb02e' : '#ff6a1f');
        box(x - 1, y - 5, 3, 6, '#e8ecf1');
        rect(x - 2, y - 1, 5, 1, '#ef4b3a');
        rect(x - 1, y - 5, 3, 1, '#ef4b3a');
      }
    }
  }

  // ---- magnet field: a pink ring that pulses out from the crowd --------------------------
  function drawMagnetField(state) {
    if (!(state.buffs.magnet > 0)) return;
    const c = state.crowd;
    const a = proj(c.x - 20, 0), b = proj(c.x + 20, 0);
    const k = (state.t * 1.5) % 1;
    const w = Math.max(8, R(((b.x - a.x) * (0.6 + k * 0.6)) / 2) * 2);
    const g = G();
    g.globalAlpha = 0.6 * (1 - k);
    gfx.blit(g, gfx.ring(w, Math.max(4, R(w * 0.35 / 2) * 2), '#f05ab4', 1), (a.x + b.x) / 2, a.y, true);
    g.globalAlpha = 1;
  }

  // ---- weapon modes on the crowd ------------------------------------------------------------
  // Shield: a row of raised shields along the crowd's front (behind the front
  // soldiers, tall enough to show over their heads). Gold while Fortress is on.
  function drawShieldWall(state, r, fort) {
    const c = state.crowd;
    const g = G();
    const front = r * 0.72 + 1;
    const l = proj(c.x - r * 0.85, front), rr = proj(c.x + r * 0.85, front);
    const x0 = R(l.x), w = Math.max(6, R(rr.x) - x0);
    const h = Math.max(5, R(6.5 * V.ppu * l.s));
    const n = Math.max(2, Math.round(w / 6));
    const pw = w / n;
    const fill = fort ? '#ffd23f' : '#5a8fd8', hi = fort ? '#fff3a6' : '#c0dcff', dk = fort ? '#a06c00' : '#2a4a8c';
    const y = R(l.y) - h - 3;
    for (let i = 0; i < n; i++) {
      const px = R(x0 + i * pw), pw2 = Math.max(2, R(x0 + (i + 1) * pw) - px - 1);
      const bow = R(Math.sin(((i + 0.5) / n) * Math.PI) * 1.5);
      box(px, y - bow, pw2, h, fill);
      rect(px, y - bow, pw2, 1, hi);
      rect(px, y - bow + h - 1, pw2, 1, dk);
      if (pw2 >= 3 && h >= 5) rect(px + R(pw2 / 2), y - bow + R(h / 2) - 1, 1, 2, dk);
    }
  }

  // Melee: a few blades glinting over the front soldiers.
  function drawGlints(state, pack, n, spread) {
    const c = state.crowd;
    const g = G();
    let k = 0;
    for (const p of pack) {
      if (p.i >= n || p.i % 5 !== 0) continue;
      if (((Math.floor(state.t * 7) + k) % 4) === 0) {
        const q = proj(c.x + p.ox * spread, p.oy * spread);
        const y = R(q.y - 9 * q.s * (V.ppu / 1.6)) - 2, x = R(q.x) + 2;
        rect(x, y - 2, 1, 4, '#ffffff');
        rect(x - 1, y, 3, 1, '#cdeefc');
      }
      if (++k >= 6) break;
    }
    g.globalAlpha = 1;
  }

  // The slash arc: a sweep in front of the crowd (a whole ring for a whirlwind).
  function drawSlash(state) {
    const w8 = state.weapon;
    const sl = w8 && w8.slash;
    if (!sl) return;
    const age = state.t - sl.t;
    if (age < 0 || age >= 0.2) return;
    const c = state.crowd;
    const R0 = crowdRadius(c.count) * (1 - SQUEEZE_SHRINK * c.squeeze) + sl.reach;
    const f = proj(c.x, R0), b = proj(c.x, sl.whirl ? -R0 : 0), l = proj(c.x - R0, 0), r = proj(c.x + R0, 0);
    const want = r.x - l.x;
    const w = pickSize(SLASH_W, want);
    // A forward arc only needs the front half of the ellipse: its box is the
    // full ellipse, centred on the crowd.
    const fullH = sl.whirl ? b.y - f.y : (b.y - f.y) * 2;
    const ratio = SLASH_RATIOS.reduce((a, x) => (Math.abs(x - fullH / want) < Math.abs(a - fullH / want) ? x : a));
    const h = Math.max(6, R((w * ratio) / 2) * 2);
    const half = SLASH_HALVES.reduce((a, x) => (Math.abs(x - (sl.half * 180) / Math.PI) < Math.abs(a - (sl.half * 180) / Math.PI) ? x : a));
    const frame = Math.min(3, Math.floor(age / 0.05));
    const spr = gfx.slash(w, h, frame, half, !!sl.whirl);
    const cy = sl.whirl ? (f.y + b.y) / 2 : b.y;
    gfx.blit(G(), spr, (l.x + r.x) / 2, cy, true);
  }

  // Builds the slash sprites a run will use (between rounds, so the first
  // slash doesn't pay for them): every width at this screen's ratio.
  function warmSlash(state) {
    if (!state.ws || state.level < 5) return;
    const R0 = 20;
    const f = proj(50, R0), b = proj(50, 0), l = proj(50 - R0, 0), r = proj(50 + R0, 0);
    const ratio0 = ((b.y - f.y) * 2) / (r.x - l.x);
    const ratio = SLASH_RATIOS.reduce((a, x) => (Math.abs(x - ratio0) < Math.abs(a - ratio0) ? x : a));
    const deg = (state.ws.arcHalf * 180) / Math.PI;
    const half = SLASH_HALVES.reduce((a, x) => (Math.abs(x - deg) < Math.abs(a - deg) ? x : a));
    for (const w of SLASH_W) {
      const h = Math.max(6, R((w * ratio) / 2) * 2);
      for (let fr = 0; fr < 4; fr++) {
        gfx.slash(w, h, fr, half, false);
        if (state.ws.whirlEvery) gfx.slash(w, Math.max(6, R((w * ratio) / 4) * 2), fr, half, true);
      }
    }
  }

  // ---- v3 ambush: warning chevrons and the red edge glow ----------------------------------
  function drawAmbushWarnings(state, bar = null) {
    if (state.level < AMBUSH_FROM || state.phase !== 'run') return;
    const c = state.crowd;
    const r = crowdRadius(c.count) * (1 - SQUEEZE_SHRINK * c.squeeze);
    const g = G();
    const on = Math.sin(state.t * 14) > -0.3;
    for (const e of state.enemies) {
      if (!e.alive || e.x === undefined) continue;
      const dy = e.y - state.dist;
      if (dy < -r || dy > AMBUSH_WARN + r) continue;
      const er = e.kind === 'giant' ? 6 : squadRadius(e.count);
      if (Math.abs(e.x - c.x) < r + er * 0.6) continue;
      const x = Math.max(V.sx0 + 9, Math.min(V.sx0 + V.LW - 9, proj(e.x, 0).x));
      // Lifted above the weapon buttons where they would sit under them.
      const y = bar && x - 7 < bar.right ? Math.min(V.sy0 + V.LH - 3, bar.top - 3) : V.sy0 + V.LH - 3;
      g.globalAlpha = on ? 1 : 0.55;
      gfx.spr(g, 'icon-chevron', x, y - 7);
      gfx.spr(g, 'icon-chevron', x, y);
      g.globalAlpha = 1;
    }
  }

  function drawAmbushFlash(fx) {
    if (!(fx.flash > 0)) return;
    const g = G();
    const a = Math.min(1, fx.flash / 0.4) * 0.45;
    const X = V.sx0, Y = V.sy0, W = V.LW, H = V.LH;
    // Three stepped bands per edge (no gradients, no full-screen fill).
    for (let i = 0; i < 3; i++) {
      g.globalAlpha = a * (1 - i * 0.33);
      g.fillStyle = '#ff1e14';
      g.fillRect(X + i * 3, Y, 3, H);
      g.fillRect(X + W - (i + 1) * 3, Y, 3, H);
      g.fillRect(X, Y + H - (i + 1) * 3, W, 3);
    }
    g.globalAlpha = 1;
  }

  function drawHazard(state, h) {
    if (h.kind === 'saw') drawSaw(state, h);
    else if (h.kind === 'crusher') drawCrusher(state, h);
  }

  // ---- first-time hint panel ------------------------------------------------------------------
  function drawHint(fx) {
    const h = fx.hint;
    if (!h || h.life <= 0) return;
    const g = G();
    const a = Math.min(1, h.life / 0.4, (h.max - h.life) / 0.2 + 0.2);
    g.globalAlpha = Math.max(0, a);
    const w = Math.min(V.LW - 12, 200);
    const tf = V.fitText(h.title, w - 8, 2);
    const tc = gfx.textCanvas(h.title, '#ffd23f', OUT, tf.font, tf.scale);
    const lines = h.sub ? wrapText(h.sub, w - 10, 'big', 1) : [];
    const ph = 6 + tc.height + lines.length * 10 + 4;
    const x = R(V.sx0 + (V.LW - w) / 2), y = V.sy0 + 36;
    box(x - 1, y - 1, w + 2, ph + 2, '#ffd23f');
    rect(x, y, w, ph, '#1b1424');
    g.drawImage(tc, R(x + w / 2 - tc.width / 2), y + 4);
    lines.forEach((ln, i) => gfx.text(g, ln, x + w / 2, y + 6 + tc.height + i * 10 + 4, '#ffffff'));
    g.globalAlpha = 1;
  }

  return {
    floorMarks, drawAmbushWarnings, drawShieldWall, drawGlints, drawSlash, warmSlash, drawAmbushFlash, drawCoin, drawSpecialShots, drawMagnetField, drawGiant, drawShield,
    drawWall, drawTelegraphMarks, drawBoulders, drawHazard, drawHint, drawForkStart, drawTower, drawArrowMarks, drawArrows,
  };
}
