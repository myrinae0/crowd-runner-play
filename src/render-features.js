// Drawing for the v2 mechanics (hazards, road features, new enemies, projectiles).
// Gets the renderer's helpers through `V` and reads sim state only.

import { SAW_R, ARROW_R } from './config.js';
import { squadRadius } from './combat.js';
import { sawX, crusherLift, crusherWarn } from './hazards.js';

const TAU = Math.PI * 2;
const RIPPLE_X = [8, 30, 70, 92];

export function createFeatureDrawer(V) {
  const { ctx } = V;

  // ---- saws
  function drawSaw(state, h) {
    const d = h.y - state.dist;
    if (d < V.nearD - 8 || d > V.VIEW) return;
    const { proj, ppu } = V;
    ctx.globalAlpha = V.fadeFor(d);
    // Rail slot across the sweep, with end posts.
    const a = proj(h.a - SAW_R - 1, d), b = proj(h.b + SAW_R + 1, d);
    const gh = Math.max(2, 1.4 * ppu * a.s);
    ctx.fillStyle = 'rgba(35,42,55,0.65)';
    ctx.fillRect(a.x, a.y - gh / 2, b.x - a.x, gh);
    ctx.fillStyle = '#f2c230';
    const pw = Math.max(3, 1.6 * ppu * a.s), ph = 4 * ppu * a.s;
    ctx.fillRect(a.x - pw / 2, a.y - ph, pw, ph);
    ctx.fillRect(b.x - pw / 2, b.y - ph, pw, ph);
    // Blade: standing on its edge, spinning, half in the slot.
    const x = sawX(h, state.t);
    const q = proj(x, d);
    const R = SAW_R * ppu * q.s;
    const cy = q.y - R * 0.62;
    const rot = state.t * 13;
    const N = 12;
    const hot = state.t - (h.lastHit ?? -9) < 0.15;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(q.x, q.y, R * 0.9, R * 0.22, 0, 0, TAU); ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < N * 2; i++) {
      const ang = rot + (i * Math.PI) / N;
      const rr = i % 2 ? R * 0.8 : R;
      const px = q.x + Math.cos(ang) * rr, py = cy + Math.sin(ang) * rr;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = hot ? '#ffb4a8' : '#d6dde5';
    ctx.fill();
    ctx.lineWidth = Math.max(1, R * 0.07);
    ctx.strokeStyle = '#4a5462';
    ctx.stroke();
    ctx.fillStyle = '#e04a3c';
    ctx.beginPath(); ctx.arc(q.x, cy, R * 0.5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#3a4250';
    ctx.beginPath(); ctx.arc(q.x, cy, R * 0.17, 0, TAU); ctx.fill();
    // Spin streaks so it reads as moving even when frozen.
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = Math.max(1, R * 0.08);
    ctx.beginPath();
    ctx.arc(q.x, cy, R * 0.33, rot, rot + 1.3);
    ctx.moveTo(q.x + Math.cos(rot + Math.PI) * R * 0.33, cy + Math.sin(rot + Math.PI) * R * 0.33);
    ctx.arc(q.x, cy, R * 0.33, rot + Math.PI, rot + Math.PI + 1.3);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ---- crushers
  function drawCrusher(state, h) {
    const d = h.y - state.dist;
    if (d < V.nearD - 10 || d > V.VIEW) return;
    const { proj, ppu } = V;
    const lift = crusherLift(h, state.t);
    const warn = crusherWarn(h, state.t);
    ctx.globalAlpha = V.fadeFor(d);
    const fa = proj(h.x0 + 0.6, d - h.depth / 2), fb = proj(h.x1 - 0.6, d - h.depth / 2);
    const ba = proj(h.x0 + 0.6, d + h.depth / 2), bb = proj(h.x1 - 0.6, d + h.depth / 2);
    // Footprint: red when it's about to slam or down.
    ctx.fillStyle = lift < 0.3 ? 'rgba(200,40,30,0.45)' : `rgba(230,70,40,${0.12 + 0.3 * warn})`;
    V.quad(fa, fb, bb, ba);
    const s = fa.s;
    const top = 30 * ppu * s;
    const gapH = lift * 20 * ppu * s; // space under the block
    const bh = 10 * ppu * s;          // block height
    const wob = warn > 0 ? Math.sin(state.t * 70) * warn * 1.5 : 0;
    // Frame: two posts and a beam.
    const pw = Math.max(3, 2 * ppu * s);
    ctx.fillStyle = '#4c5563';
    ctx.fillRect(fa.x - pw, fa.y - top, pw, top);
    ctx.fillRect(fb.x, fb.y - top, pw, top);
    ctx.fillRect(fa.x - pw, fa.y - top - pw, fb.x - fa.x + pw * 2, pw);
    // Block: top face, then front face with hazard stripes.
    const y0 = fa.y - gapH - bh + wob;
    const by0 = ba.y - gapH - bh * (ba.s / s) + wob;
    ctx.fillStyle = '#9aa5b3';
    ctx.beginPath();
    ctx.moveTo(fa.x, y0); ctx.lineTo(fb.x, y0); ctx.lineTo(bb.x, by0); ctx.lineTo(ba.x, by0);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#6b7685';
    ctx.fillRect(fa.x, y0, fb.x - fa.x, bh);
    const sh = bh * 0.35;
    ctx.save();
    ctx.beginPath(); ctx.rect(fa.x, y0 + bh - sh, fb.x - fa.x, sh); ctx.clip();
    ctx.fillStyle = '#f2c230';
    ctx.fillRect(fa.x, y0 + bh - sh, fb.x - fa.x, sh);
    ctx.fillStyle = '#20242b';
    ctx.beginPath();
    const step = sh * 1.6;
    for (let x = fa.x - sh; x < fb.x; x += step * 2) {
      ctx.moveTo(x, y0 + bh); ctx.lineTo(x + step, y0 + bh); ctx.lineTo(x + step + sh, y0 + bh - sh); ctx.lineTo(x + sh, y0 + bh - sh);
    }
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ---- narrow bridges: the road gives way to water, with a plank deck across.
  // Built from short strips (never one tall quad: mobile Firefox drops those).
  const STRIP = 8;
  // Adds a quad to the current path (for batching many small quads in one fill).
  function sub(a, b, c, d) {
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath();
  }

  function drawBridges(state) {
    const { proj, nearD, VIEW } = V;
    for (const g of state.segments) {
      if (g.kind !== 'bridge') continue;
      const a0 = Math.max(nearD, g.y0 - state.dist), a1 = Math.min(VIEW, g.y1 - state.dist);
      if (a1 <= a0) continue;
      // Water, edge to edge (covers the rails too): two batched passes, one per shade.
      for (const odd of [0, 1]) {
        ctx.fillStyle = odd ? '#2a7fb8' : '#2677ad';
        ctx.beginPath();
        for (let d = a0; d < a1; d += STRIP) {
          if (Math.abs(Math.floor((d + state.dist) / STRIP) % 2) !== odd) continue;
          const e = Math.min(a1, d + STRIP + 0.4);
          sub(proj(-12, d), proj(112, d), proj(112, e), proj(-12, e));
        }
        ctx.fill();
      }
      // Ripples.
      ctx.fillStyle = 'rgba(190,230,255,0.45)';
      ctx.beginPath();
      for (let d = a0; d < a1; d += 11) {
        const yy = d + ((state.t * 6 + d * 3) % 4);
        for (const xr of RIPPLE_X) {
          const x = xr + Math.sin(d * 0.7 + xr) * 6;
          if (x > g.x0 - 3 && x < g.x1 + 3) continue;
          sub(proj(x - 3, yy), proj(x + 3, yy), proj(x + 3, yy + 0.6), proj(x - 3, yy + 0.6));
        }
      }
      ctx.fill();
      // Far cliff face where the road resumes.
      if (g.y1 - state.dist < VIEW) {
        const d = g.y1 - state.dist;
        ctx.fillStyle = '#6d5a45';
        V.quad(proj(-12, d - 2.2), proj(112, d - 2.2), proj(112, d), proj(-12, d));
      }
      // Deck: planks in two shades, then dark edges.
      for (const odd of [0, 1]) {
        ctx.fillStyle = odd ? '#b98448' : '#a8743c';
        ctx.beginPath();
        for (let d = a0; d < a1; d += 3) {
          if (Math.abs(Math.floor((d + state.dist) / 3) % 2) !== odd) continue;
          const e = Math.min(a1, d + 3.05);
          sub(proj(g.x0, d), proj(g.x1, d), proj(g.x1, e), proj(g.x0, e));
        }
        ctx.fill();
      }
      ctx.fillStyle = '#5b3c1e';
      ctx.beginPath();
      for (let d = a0; d < a1; d += STRIP) {
        const e = Math.min(a1, d + STRIP + 0.4);
        sub(proj(g.x0 - 0.8, d), proj(g.x0, d), proj(g.x0, e), proj(g.x0 - 0.8, e));
        sub(proj(g.x1, d), proj(g.x1 + 0.8, d), proj(g.x1 + 0.8, e), proj(g.x1, e));
      }
      ctx.fill();
      // Hazard stripes where the road ends, either side of the deck.
      const d = g.y0 - state.dist;
      if (d > nearD && d < VIEW) {
        for (const odd of [0, 1]) {
          ctx.fillStyle = odd ? '#20242b' : '#f2c230';
          ctx.beginPath();
          for (let x = 0, i = 0; x < 100; x += 5, i++) {
            const x1 = Math.min(100, x + 5);
            if (i % 2 !== odd || (x1 > g.x0 && x < g.x1)) continue;
            sub(proj(x, d - 2.5), proj(x1, d - 2.5), proj(x1, d), proj(x, d));
          }
          ctx.fill();
        }
      }
    }
  }

  // ---- archer towers
  function drawTower(state, e) {
    const d = e.y - state.dist;
    if (d < V.nearD || d > V.VIEW) return;
    const { proj, ppu } = V;
    ctx.globalAlpha = V.fadeFor(d);
    const x = (e.x0 + e.x1) / 2;
    const q = proj(x, d);
    const w = (e.x1 - e.x0) * ppu * q.s;
    const h = 17 * ppu * q.s;
    const flash = state.t - (e.lastHit ?? -9) < 0.08;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(q.x, q.y, w * 0.62, w * 0.18, 0, 0, TAU); ctx.fill();
    // Body with stone courses.
    ctx.fillStyle = flash ? '#d8c9c0' : '#8d8f99';
    ctx.fillRect(q.x - w / 2, q.y - h, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(q.x + w * 0.15, q.y - h, w * 0.35, h);
    ctx.strokeStyle = 'rgba(40,40,50,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 5; i++) { const yy = q.y - (h * i) / 5; ctx.moveTo(q.x - w / 2, yy); ctx.lineTo(q.x + w / 2, yy); }
    ctx.stroke();
    // Battlements.
    const bw = w * 1.2, by = q.y - h;
    ctx.fillStyle = '#6f727d';
    ctx.fillRect(q.x - bw / 2, by - h * 0.12, bw, h * 0.12);
    for (let i = 0; i < 4; i++) ctx.fillRect(q.x - bw / 2 + (bw * i) / 3.5, by - h * 0.22, bw / 7, h * 0.1);
    // Red banner so it reads as an enemy.
    ctx.fillStyle = '#e2453c';
    ctx.beginPath();
    ctx.moveTo(q.x - w * 0.18, q.y - h * 0.8); ctx.lineTo(q.x + w * 0.18, q.y - h * 0.8);
    ctx.lineTo(q.x + w * 0.18, q.y - h * 0.4); ctx.lineTo(q.x, q.y - h * 0.48); ctx.lineTo(q.x - w * 0.18, q.y - h * 0.4);
    ctx.closePath(); ctx.fill();
    // Archer on top: red body, head, bow.
    const S = 4.6 * ppu * q.s, ay = by - h * 0.12;
    ctx.fillStyle = '#9e2420';
    ctx.beginPath(); ctx.arc(q.x, ay - S * 0.25, S * 0.3, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffd9b8';
    ctx.beginPath(); ctx.arc(q.x, ay - S * 0.68, S * 0.18, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#5a3a1a';
    ctx.lineWidth = Math.max(1.5, S * 0.08);
    ctx.beginPath(); ctx.arc(q.x + S * 0.2, ay - S * 0.4, S * 0.35, -1.2, 1.2); ctx.stroke();
    V.pill(q.x, q.y + Math.max(9, 3 * ppu * q.s), String(Math.ceil(e.hp)), 4.4 * ppu * q.s + 4, 'rgba(160,30,30,0.9)');
    ctx.globalAlpha = 1;
  }

  // Landing rings (on the ground, drawn under everything else).
  function drawArrowMarks(state) {
    const { proj, ppu } = V;
    for (const a of state.arrows) {
      const d = a.ty - state.dist;
      if (d < V.nearD || d > V.VIEW) continue;
      const u = Math.min(1, (state.t - a.t0) / (a.t1 - a.t0));
      const q = proj(a.tx, d);
      const R = (ARROW_R + 1.5) * ppu * q.s * (1.5 - 0.5 * u);
      ctx.globalAlpha = 0.55 + 0.45 * u;
      ctx.fillStyle = 'rgba(255,50,40,0.35)';
      ctx.strokeStyle = '#ff3b30';
      ctx.lineWidth = Math.max(2, 0.5 * ppu * q.s);
      ctx.beginPath(); ctx.ellipse(q.x, q.y, R, R * 0.4, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(q.x - R * 0.5, q.y); ctx.lineTo(q.x + R * 0.5, q.y);
      ctx.moveTo(q.x, q.y - R * 0.2); ctx.lineTo(q.x, q.y + R * 0.2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Arrows in flight: a lob from the tower top to the landing point.
  const TOWER_TOP = 17;
  function arrowPos(a, u, dist) {
    const wx = a.x0 + (a.tx - a.x0) * u;
    const wy = a.y0 + (a.ty - a.y0) * u;
    const z = TOWER_TOP * (1 - u) + 30 * u * (1 - u);
    const q = V.proj(wx, wy - dist);
    return { x: q.x, y: q.y - z * V.ppu * q.s, s: q.s };
  }
  function drawArrows(state) {
    for (const a of state.arrows) {
      const u = Math.min(1, (state.t - a.t0) / (a.t1 - a.t0));
      if (a.ty - state.dist > V.VIEW) continue;
      const p = arrowPos(a, u, state.dist);
      const b = arrowPos(a, Math.max(0, u - 0.05), state.dist);
      let dx = p.x - b.x, dy = p.y - b.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      const L = Math.max(20, 11 * V.ppu * p.s);
      const tx = p.x - dx * L, ty = p.y - dy * L;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; // halo for contrast
      ctx.lineWidth = Math.max(6, L * 0.28);
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.strokeStyle = '#4a2e14';
      ctx.lineWidth = Math.max(3, L * 0.13);
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.lineCap = 'butt';
      // Head and fletching.
      const nx = -dy, ny = dx, hs = L * 0.36;
      ctx.fillStyle = '#e2453c';
      ctx.beginPath();
      ctx.moveTo(p.x + dx * hs * 0.6, p.y + dy * hs * 0.6);
      ctx.lineTo(p.x - dx * hs * 0.5 + nx * hs * 0.5, p.y - dy * hs * 0.5 + ny * hs * 0.5);
      ctx.lineTo(p.x - dx * hs * 0.5 - nx * hs * 0.5, p.y - dy * hs * 0.5 - ny * hs * 0.5);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - dx * hs * 0.5 + nx * hs * 0.45, ty - dy * hs * 0.5 + ny * hs * 0.45);
      ctx.lineTo(tx + dx * hs * 0.4, ty + dy * hs * 0.4);
      ctx.lineTo(tx - dx * hs * 0.5 - nx * hs * 0.45, ty - dy * hs * 0.5 - ny * hs * 0.45);
      ctx.closePath(); ctx.fill();
    }
  }

  // ---- fork: a hedge down the middle, drawn as short raised strips.
  function drawForks(state) {
    const { proj, nearD, VIEW, ppu } = V;
    for (const g of state.segments) {
      if (g.kind !== 'fork') continue;
      const a0 = Math.max(nearD, g.y0 - state.dist), a1 = Math.min(VIEW, g.y1 - state.dist);
      if (a1 <= a0) continue;
      const lift = (p, hgt) => ({ x: p.x, y: p.y - hgt * ppu * p.s });
      const HH = 3.2;
      // Shadow strips on the road (one batched path, so overlaps don't darken).
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath();
      for (let d = a0; d < a1; d += STRIP) {
        const e = Math.min(a1, d + STRIP + 0.4);
        sub(proj(g.d0 - 1, d), proj(g.d1 + 1, d), proj(g.d1 + 1, e), proj(g.d0 - 1, e));
      }
      ctx.fill();
      // Hedge top in two shades.
      for (const odd of [0, 1]) {
        ctx.fillStyle = odd ? '#3f9a4c' : '#378a43';
        ctx.beginPath();
        for (let d = a0; d < a1; d += STRIP) {
          if (Math.abs(Math.floor((d + state.dist) / STRIP) % 2) !== odd) continue;
          const e = Math.min(a1, d + STRIP + 0.4);
          sub(lift(proj(g.d0, d), HH), lift(proj(g.d1, d), HH), lift(proj(g.d1, e), HH), lift(proj(g.d0, e), HH));
        }
        ctx.fill();
      }
      // Front face where the hedge starts.
      const d = g.y0 - state.dist;
      if (d >= nearD && d <= VIEW) {
        const l = proj(g.d0, d), r = proj(g.d1, d);
        ctx.fillStyle = '#2c6e36';
        ctx.fillRect(l.x, l.y - HH * ppu * l.s, r.x - l.x, HH * ppu * l.s);
      }
    }
  }

  // Signs over each path where a fork starts.
  function drawForkSigns(state, g) {
    const d = g.y0 - state.dist;
    if (d < 6 || d > V.VIEW) return;
    const { proj, ppu } = V;
    ctx.globalAlpha = V.fadeFor(d);
    for (const side of ['left', 'right']) {
      const risky = side === g.risky;
      const q = proj(side === 'left' ? 24 : 76, d);
      const px = 5.4 * ppu * q.s + 5;
      // Post.
      ctx.fillStyle = '#5b6573';
      ctx.fillRect(q.x - 1.5, q.y - 13 * ppu * q.s, 3, 13 * ppu * q.s);
      V.pill(q.x, q.y - 14 * ppu * q.s, risky ? 'RISKY' : 'SAFE', px, risky ? 'rgba(214,60,40,0.95)' : 'rgba(40,150,80,0.95)');
    }
    ctx.globalAlpha = 1;
  }

  // ---- boss attacks
  // Ground telegraphs: a red lane (boulder) or an orange side (stomp), filling
  // in as the hit gets close. Short strips again.
  function drawBossTelegraphs(state) {
    if (!state.bossAtks.length) return;
    const { proj, nearD } = V;
    const far = state.boss.y - state.dist;
    for (const a of state.bossAtks) {
      const u = Math.min(1, (state.t - a.t0) / (a.tHit - a.t0));
      const after = state.t - a.tHit;
      if (after > 0.35) continue;
      const boulder = a.kind === 'boulder';
      const pulse = 0.5 + 0.5 * Math.sin(state.t * (10 + u * 14));
      const alpha = after > 0 ? 0.5 * (1 - after / 0.35) : 0.16 + 0.34 * u + 0.12 * pulse;
      ctx.fillStyle = boulder ? `rgba(230,40,30,${alpha})` : `rgba(255,120,20,${alpha})`;
      const d0 = Math.max(nearD, -30), d1 = far;
      ctx.beginPath();
      for (let d = d0; d < d1; d += STRIP) {
        const e = Math.min(d1, d + STRIP + 0.3);
        sub(proj(a.x0, d), proj(a.x1, d), proj(a.x1, e), proj(a.x0, e));
      }
      ctx.fill();
      // Bold edges.
      ctx.fillStyle = boulder ? 'rgba(200,20,10,0.85)' : 'rgba(230,90,10,0.85)';
      ctx.beginPath();
      for (const x of [a.x0, a.x1]) {
        if (x <= 0.5 || x >= 99.5) continue;
        for (let d = d0; d < d1; d += STRIP) {
          const e = Math.min(d1, d + STRIP + 0.3);
          sub(proj(x - 0.5, d), proj(x + 0.5, d), proj(x + 0.5, e), proj(x - 0.5, e));
        }
      }
      ctx.fill();
      // Warning mark near the crowd.
      if (after <= 0) {
        const q = proj((a.x0 + a.x1) / 2, 2);
        V.outlinedText('!', q.x, q.y - 26, 30 + 8 * pulse, boulder ? '#ff4a3c' : '#ff9a2e');
      }
      // Stomp: shock rings sweeping toward the crowd after the slam.
      if (!boulder && after > 0) {
        ctx.save();
        const c0 = proj(a.x0, -30), c1 = proj(a.x1, -30), c2 = proj(a.x1, far), c3 = proj(a.x0, far);
        ctx.beginPath(); ctx.moveTo(c0.x, c0.y); ctx.lineTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.lineTo(c3.x, c3.y); ctx.closePath();
        ctx.clip();
        const bq = proj(state.boss.x, far);
        ctx.strokeStyle = `rgba(255,240,200,${0.9 * (1 - after / 0.35)})`;
        ctx.lineWidth = 6;
        for (let i = 0; i < 3; i++) {
          const rr = (after * 900 + i * 50);
          ctx.beginPath(); ctx.ellipse(bq.x, bq.y, rr, rr * 0.35, 0, 0, TAU); ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  // Boulders: thrown from the boss in an arc, then rolling past.
  function drawBoulders(state) {
    if (!state.bossAtks.length) return;
    const { proj, ppu } = V;
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
      const R = 4.6 * ppu * q.s;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(q.x, q.y, R, R * 0.3, 0, 0, TAU); ctx.fill();
      const cy = q.y - R - z * ppu * q.s;
      const grad = ctx.createRadialGradient(q.x - R * 0.3, cy - R * 0.3, R * 0.1, q.x, cy, R);
      grad.addColorStop(0, '#b9a58c');
      grad.addColorStop(1, '#5c4a38');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(q.x, cy, R, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(40,30,20,0.35)';
      const rot = state.t * 8;
      for (let i = 0; i < 3; i++) {
        const ang = rot + i * 2.1;
        ctx.beginPath(); ctx.arc(q.x + Math.cos(ang) * R * 0.45, cy + Math.sin(ang) * R * 0.45, R * 0.18, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  // ---- special enemies
  const ONE = [{ i: 0, ox: 0, oy: 0 }];
  function drawGiant(state, e) {
    const d = e.y - state.dist;
    const { proj, ppu } = V;
    const hot = state.t - (e.lastHit ?? -9) < 0.06;
    V.drawPack('red', ONE, 1, e.x, d, state.t * 0.4, 22, true);
    if (hot) {
      const q = proj(e.x, d);
      const S = 22 * ppu * q.s;
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.arc(q.x, q.y - S * 0.24, S * 0.24, 0, TAU); ctx.fill();
    }
    // HP bar and number over its head.
    const top = proj(e.x, d);
    const S = 22 * ppu * top.s;
    const bw = Math.max(30, S * 0.8), bh = Math.max(5, S * 0.07);
    const bx = top.x - bw / 2, by = top.y - S * 0.85;
    ctx.fillStyle = 'rgba(20,10,10,0.75)';
    V.roundRect(bx - 2, by - 2, bw + 4, bh + 4, bh); ctx.fill();
    ctx.fillStyle = '#ff4a4a';
    V.roundRect(bx, by, Math.max(0, bw * (e.hp / e.start)), bh, bh / 2); ctx.fill();
    V.pill(top.x, by - bh - 4.4 * ppu * top.s, String(Math.ceil(e.hp)), 4.6 * ppu * top.s + 4, 'rgba(160,30,30,0.9)');
  }

  // A curved steel shield wall in front of the squad, with its own number.
  function drawShield(state, e) {
    const d = e.y - state.dist;
    const { proj, ppu } = V;
    const R = squadRadius(e.count) + 1.4;
    const front = d - R * 0.8;
    const l = proj(e.x - R, front), r = proj(e.x + R, front), m = proj(e.x, front - R * 0.35);
    const h = 4.6 * ppu * l.s;
    const hot = state.t - (e.lastHit ?? -9) < 0.06;
    const k = e.shield / (e.shieldMax || e.shield);
    ctx.fillStyle = hot ? '#e8f3ff' : `rgba(${Math.round(120 + 40 * (1 - k))},${Math.round(165 + 20 * k)},215,0.92)`;
    ctx.strokeStyle = '#eaf3fb';
    ctx.lineWidth = Math.max(1.5, 0.45 * ppu * l.s);
    ctx.beginPath();
    ctx.moveTo(l.x, l.y);
    ctx.quadraticCurveTo(m.x, m.y + (m.y - l.y) * 0.2, r.x, r.y);
    ctx.lineTo(r.x, r.y - h);
    ctx.quadraticCurveTo(m.x, m.y - h + (m.y - l.y) * 0.2, l.x, l.y - h);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Rivets.
    ctx.fillStyle = 'rgba(40,60,90,0.6)';
    for (let i = 1; i < 4; i++) {
      const u = i / 4;
      ctx.beginPath(); ctx.arc(l.x + (r.x - l.x) * u, l.y - h * 0.5 + (m.y - l.y) * 0.5 * Math.sin(u * Math.PI), Math.max(1.2, 0.35 * ppu * l.s), 0, TAU); ctx.fill();
    }
    V.pill((l.x + r.x) / 2, l.y - h - 3.6 * ppu * l.s, String(Math.ceil(e.shield)), 3.8 * ppu * l.s + 3, 'rgba(40,80,130,0.95)');
  }

  // ---- coins on the track (spinning) and weapon pickups
  function drawCoin(state, k) {
    const d = k.y - state.dist;
    const q = V.proj(k.x, d);
    const R = Math.max(3, 1.9 * V.ppu * q.s);
    const spin = Math.abs(Math.cos(state.t * 4 + k.id * 0.7));
    const y = q.y - R * (k.pulled ? 2.4 : 1.3);
    ctx.globalAlpha = V.fadeFor(d);
    ctx.fillStyle = '#e09e12';
    ctx.beginPath(); ctx.ellipse(q.x, y, R * Math.max(0.2, spin), R, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath(); ctx.ellipse(q.x, y, R * Math.max(0.12, spin) * 0.72, R * 0.72, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Icon inside a pickup bubble of radius r (white strokes / fills). The
  // caller has begun a path and set the stroke style.
  function drawWeaponIcon(kind, x, y, r) {
    ctx.fillStyle = '#fff';
    if (kind === 'rocket') {
      ctx.beginPath();
      ctx.moveTo(x, y - r * 0.62);
      ctx.quadraticCurveTo(x + r * 0.3, y - r * 0.3, x + r * 0.2, y + r * 0.3);
      ctx.lineTo(x - r * 0.2, y + r * 0.3);
      ctx.quadraticCurveTo(x - r * 0.3, y - r * 0.3, x, y - r * 0.62);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - r * 0.2, y + r * 0.05); ctx.lineTo(x - r * 0.42, y + r * 0.42); ctx.lineTo(x - r * 0.18, y + r * 0.3);
      ctx.moveTo(x + r * 0.2, y + r * 0.05); ctx.lineTo(x + r * 0.42, y + r * 0.42); ctx.lineTo(x + r * 0.18, y + r * 0.3);
      ctx.fill();
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath(); ctx.moveTo(x - r * 0.12, y + r * 0.34); ctx.lineTo(x, y + r * 0.66); ctx.lineTo(x + r * 0.12, y + r * 0.34); ctx.fill();
    } else if (kind === 'laser') {
      ctx.beginPath();
      ctx.moveTo(x, y - r * 0.6); ctx.lineTo(x, y + r * 0.6);
      ctx.moveTo(x - r * 0.45, y - r * 0.15); ctx.lineTo(x + r * 0.45, y - r * 0.15);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y - r * 0.15, r * 0.16, 0, TAU); ctx.fill();
    } else {
      // Magnet: a U with white tips.
      ctx.lineWidth = Math.max(2, r * 0.26);
      ctx.beginPath();
      ctx.arc(x, y - r * 0.05, r * 0.36, 0, Math.PI);
      ctx.moveTo(x - r * 0.36, y - r * 0.05); ctx.lineTo(x - r * 0.36, y - r * 0.5);
      ctx.moveTo(x + r * 0.36, y - r * 0.05); ctx.lineTo(x + r * 0.36, y - r * 0.5);
      ctx.stroke();
    }
  }

  // Rockets (grey body, flame) and laser shots (long cyan streaks).
  function drawSpecialShots(state) {
    const { proj, ppu } = V;
    for (const b of state.bullets) {
      if (!b.rocket && !b.laser) continue;
      const d = b.y - state.dist;
      if (d > V.VIEW) continue;
      const q = proj(b.x, d);
      const lift = 3 * ppu * q.s;
      if (b.laser) {
        const t = proj(b.x, d + 7);
        const w = Math.max(2, 0.9 * ppu * q.s);
        ctx.strokeStyle = 'rgba(120,240,255,0.55)';
        ctx.lineWidth = w * 2.6;
        ctx.beginPath(); ctx.moveTo(q.x, q.y - lift); ctx.lineTo(t.x, t.y - lift); ctx.stroke();
        ctx.strokeStyle = '#e8fdff';
        ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(q.x, q.y - lift); ctx.lineTo(t.x, t.y - lift); ctx.stroke();
      } else {
        const L = Math.max(16, 6 * ppu * q.s), W = Math.max(6, 2.2 * ppu * q.s);
        const y = q.y - lift;
        // Smoke puffs behind, then the flame.
        ctx.fillStyle = 'rgba(230,230,230,0.55)';
        for (let i = 1; i <= 3; i++) {
          const p = proj(b.x, d - i * 3.2);
          ctx.beginPath(); ctx.arc(p.x, p.y - lift, W * (0.35 + i * 0.12), 0, TAU); ctx.fill();
        }
        ctx.fillStyle = state.tick % 4 < 2 ? '#ffb02e' : '#ff6a1f';
        ctx.beginPath(); ctx.moveTo(q.x - W * 0.45, y); ctx.lineTo(q.x, y + L * 0.75); ctx.lineTo(q.x + W * 0.45, y); ctx.fill();
        ctx.fillStyle = '#ef4b3a';
        ctx.fillRect(q.x - W * 0.75, y - L * 0.3, W * 1.5, L * 0.3); // fins
        ctx.fillStyle = '#e8ecf1';
        ctx.fillRect(q.x - W / 2, y - L, W, L);
        ctx.fillStyle = '#ef4b3a';
        ctx.beginPath(); ctx.moveTo(q.x - W / 2, y - L); ctx.lineTo(q.x, y - L - W); ctx.lineTo(q.x + W / 2, y - L); ctx.fill();
      }
    }
  }

  // Magnet field: a soft pink ring around the crowd while it lasts.
  function drawMagnetField(state) {
    if (!(state.buffs.magnet > 0)) return;
    const { proj } = V;
    const c = state.crowd;
    const a = proj(c.x - 20, 0), b = proj(c.x + 20, 0);
    const k = (state.t * 1.5) % 1;
    ctx.strokeStyle = `rgba(240,90,180,${0.5 * (1 - k)})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse((a.x + b.x) / 2, a.y, ((b.x - a.x) / 2) * (0.6 + k * 0.6), ((b.x - a.x) / 2) * (0.6 + k * 0.6) * 0.35, 0, 0, TAU);
    ctx.stroke();
  }

  function drawHazard(state, h) {
    if (h.kind === 'saw') drawSaw(state, h);
    else if (h.kind === 'crusher') drawCrusher(state, h);
  }

  // ---- first-time hint panel
  function drawHint(fx) {
    const h = fx.hint;
    if (!h || h.life <= 0) return;
    const { W, H } = V;
    const a = Math.min(1, h.life / 0.4, (h.max - h.life) / 0.2 + 0.2);
    ctx.globalAlpha = Math.max(0, a);
    const w = Math.min(W - 32, 340);
    const ph = h.sub ? 70 : 46;
    const x = (W - w) / 2, y = 88; // below the HUD and buff pills
    ctx.fillStyle = 'rgba(12,20,34,0.82)';
    V.roundRect(x, y, w, ph, 16); ctx.fill();
    ctx.strokeStyle = 'rgba(255,210,63,0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
    V.outlinedText(h.title, W / 2, y + 24, 24, '#ffd23f');
    if (h.sub) V.outlinedText(h.sub, W / 2, y + 51, 16, '#ffffff');
    ctx.globalAlpha = 1;
  }

  return { drawCoin, drawWeaponIcon, drawSpecialShots, drawMagnetField, drawGiant, drawShield, drawBossTelegraphs, drawBoulders, drawHazard, drawHint, drawBridges, drawForks, drawForkSigns, drawTower, drawArrowMarks, drawArrows };
}
