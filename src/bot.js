// A simple autopilot used by ?demo=1, screenshots and balance tests.
// It reads the sim state and returns an input ({ dx, squeeze }); it never mutates state.
//
// It picks a target x (the best gate lane, an enemy to shoot, a power-up), then
// moves to the nearby x with the least danger from hazards, staying close to the target.

import { applyGate, previewHits } from './gates.js';
import { crowdRadius, squadRadius } from './combat.js';
import { RAPID_MULT, SAW_R, X_MIN, X_MAX, SQUEEZE_SHRINK, ARROW_R } from './config.js';
import { volleyStreams, enemyX, enemyRadius, contactCost } from './sim.js';
import { sawX, crusherLift, chordOverlapFrac, slideOffset, swapCount } from './hazards.js';

const LOOK = 170;
const MAX_DX = 1.1; // units per tick (~66 units/s)
const DANGER_AHEAD = 60; // hazards closer than this (world units) shape the path

function shotsUntil(s, dy) {
  const rate = s.stats.fireRate * (s.buffs.rapid > 0 ? RAPID_MULT : 1); // assumes we spread out to shoot
  const streams = volleyStreams(s.crowd.count);
  const t = Math.max(0, dy / s.speed - 0.4);
  return Math.floor(rate * t * streams * 0.85);
}

// A row's gates as they will be when the crowd reaches it (moving gates slide
// or swap in the meantime): [{ x0, x1, gate }].
export function rowAtArrival(s, row) {
  const tArr = Math.max(0, (row.y - s.dist) / s.speed);
  const m = row.move;
  const n = row.gates.length;
  const rot = m && m.kind === 'swap' ? swapCount(m, s.t + tArr) - (row.swaps || 0) : 0;
  const off = m && m.kind === 'slide' ? slideOffset(m, s.t + tArr) : 0;
  return row.gates.map((g, i) => {
    const src = row.gates[(((i - rot) % n) + n) % n];
    const x0 = m && m.kind === 'slide' ? g.bx0 + off : g.x0;
    const x1 = m && m.kind === 'slide' ? g.bx1 + off : g.x1;
    return { x0, x1, gate: src };
  });
}

// Crowd after passing gate g (with `hits` more bullets in it first). A hidden
// "?" gate is scored by its rough expected value: the bot can't peek.
function laneScore(s, g, hits, c = s.crowd.count) {
  if (g.kind === 'gamble') return 0.6 * (c + 15 * (1 + 0.35 * (s.level - 1))) + 0.4 * Math.floor(c / 2);
  return applyGate(c, previewHits(g, hits));
}

const rowSide = (rw) => ((rw.gates[0].x0 + rw.gates[rw.gates.length - 1].x1) / 2 < 50 ? 'left' : 'right');

// A fork we're in or coming up to, and which side to take: rough value of each
// side (best gate per row, minus enemies and saws on that side).
function forkPlan(s) {
  for (const g of s.segments) {
    if (g.kind !== 'fork' || g.y1 < s.dist || g.y0 - s.dist > LOOK) continue;
    if (s.fork && s.fork.id === g.id) return { g, side: s.fork.side };
    let best = null;
    for (const side of ['left', 'right']) {
      let n = s.crowd.count;
      const inSide = (x) => (side === 'left' ? x < g.d0 : x > g.d1);
      const things = [];
      for (const rw of s.rows) if (rw.fork && !rw.used && rw.y >= g.y0 && rw.y <= g.y1 && rowSide(rw) === side) things.push([rw.y, 'row', rw]);
      for (const e of s.enemies) if (e.alive && e.y >= g.y0 && e.y <= g.y1 && inSide(enemyX(e))) things.push([e.y, 'enemy', e]);
      for (const h of s.hazards) if (h.y >= g.y0 && h.y <= g.y1 && inSide((h.a ?? h.x0) + 1)) things.push([h.y, 'hazard', h]);
      things.sort((a, b) => a[0] - b[0]);
      for (const [, kind, o] of things) {
        if (kind === 'row') n = Math.max(...o.gates.map((gt) => laneScore(s, gt, 4, n)));
        else if (kind === 'enemy') n -= Math.max(0, contactCost(o) * 0.6 - shotsUntil(s, 60) * s.stats.damage);
        else n *= 0.85;
      }
      if (!best || n > best.n) best = { side, n };
    }
    return { g, side: best.side };
  }
  return null;
}

// How bad it is to stand at x (crowd radius r) over the next second or two.
// Roughly the share of the crowd at risk, summed over hazards (0 = safe).
export function dangerAt(s, x, r) {
  let d = 0;
  for (const h of s.hazards) {
    const dy = h.y - s.dist;
    if (dy < -r - 4 || dy > DANGER_AHEAD + r) continue;
    const near = dy < r + 8 ? 1.5 : 1; // things we're touching now matter most
    if (h.kind === 'saw') {
      // The whole sweep counts, a bit more where the blade is now.
      d += near * chordOverlapFrac(x, r + 1, h.a - SAW_R - 1.5, h.b + SAW_R + 1.5);
      if (dy < r + 6) { const bx = sawX(h, s.t); d += chordOverlapFrac(x, r + 2, bx - SAW_R, bx + SAW_R); }
    } else if (h.kind === 'crusher') {
      // Avoid crusher lanes unless it will clearly be up while we pass.
      const tArrive = Math.max(0, (dy - r - h.depth) / s.speed);
      const tLeave = Math.max(0, (dy + r + h.depth) / s.speed);
      let safe = true;
      for (let t = tArrive; t <= tLeave + 0.05; t += 0.1) if (crusherLift(h, s.t + t) < 0.5) { safe = false; break; }
      if (!safe) d += near * chordOverlapFrac(x, r + 1, h.x0, h.x1);
    }
  }
  // Boss attacks: stay out of telegraphed lanes / sides.
  for (const a of s.bossAtks) {
    if (!a.done) d += 1.5 * chordOverlapFrac(x, r + 1.5, a.x0, a.x1);
  }
  // Arrows: stay out of the landing rings.
  for (const a of s.arrows) {
    if (Math.abs(x - a.tx) < r * 0.9 + ARROW_R + 1.5) d += 1.2;
  }
  return d;
}

// Move toward `target`, but prefer a safe spot. Scans candidate positions.
function safeTarget(s, target, r) {
  if (dangerAt(s, target, r) <= 0 && dangerAt(s, s.crowd.x, r) <= 0) return target;
  let best = target;
  let bestCost = Infinity;
  for (let x = X_MIN; x <= X_MAX; x += 2) {
    const cost = dangerAt(s, x, r) * 100 + Math.abs(x - target) * 0.15 + Math.abs(x - s.crowd.x) * 0.1;
    if (cost < bestCost) { bestCost = cost; best = x; }
  }
  return best;
}

export function botInput(s) {
  const c = s.crowd;
  let target = c.x;
  let squeeze = false;
  const r = crowdRadius(c.count);

  if (s.phase === 'run') {
    const plan = forkPlan(s);
    const row = s.rows.find((rw) => !rw.used && rw.y > s.dist && rw.y - s.dist < LOOK
      && (!plan || !rw.fork || rowSide(rw) === plan.side));
    let best = null;
    if (row) {
      const hits = shotsUntil(s, row.y - s.dist) * (row.move && row.move.kind === 'swap' ? 0.5 : 1);
      const lanes = [];
      const at = rowAtArrival(s, row);
      for (const l of at) lanes.push({ x: (l.x0 + l.x1) / 2, score: laneScore(s, l.gate, hits) });
      // Open lane (single-gate rows).
      if (at.length === 1) lanes.push({ x: at[0].x0 > 50 - (at[0].x1 - 50) ? at[0].x0 / 2 : (at[0].x1 + 100) / 2, score: c.count });
      for (const lane of lanes) {
        // Penalise enemies standing between us and that lane.
        for (const e of s.enemies) {
          if (!e.alive || e.y < s.dist || e.y > row.y) continue;
          const ex = enemyX(e);
          const half = e.x !== undefined ? enemyRadius(e) : (e.x1 - e.x0) / 2;
          if (Math.abs(ex - lane.x) < half + r) {
            const n = contactCost(e) + (e.shield || 0);
            lane.score -= Math.max(0, n - shotsUntil(s, e.y - s.dist) * s.stats.damage * 0.6);
          }
        }
        if (!best || lane.score > best.score) best = lane;
      }
      target = best.x;
    } else {
      // No gate coming: line up with the nearest enemy to shoot it, or grab a power-up.
      const pu = s.powerups.find((p) => !p.taken && p.y > s.dist && p.y - s.dist < 80);
      const e = s.enemies.find((en) => en.alive && en.y > s.dist + 25 && en.y - s.dist < LOOK);
      if (pu) target = pu.x;
      else if (e) target = enemyX(e);
      else {
        // Nothing else to do: pick up coins.
        const k = s.coinItems.find((q) => !q.taken && q.y > s.dist + 4 && q.y - s.dist < 60);
        if (k) target = k.x;
      }
    }
    // A power-up we can reach before the next gate row is worth a detour.
    const pu = s.powerups.find((p) => !p.taken && p.y > s.dist + 3 && p.y - s.dist < 70
      && (!row || p.y < row.y - 15) && Math.abs(p.x - c.x) < ((p.y - s.dist) / s.speed) * 55);
    if (pu) target = pu.x;
    // Dodge anything about to touch us that we won't kill in time.
    for (const e of s.enemies) {
      if (!e.alive || e.y < s.dist || e.y - s.dist > 30) continue;
      if (e.x !== undefined) {
        const n = contactCost(e) + (e.shield || 0);
        if (n * 2 < c.count) continue;
        const gap = enemyRadius(e) + r + 2;
        if (Math.abs(target - e.x) < gap) target = e.x + (target >= e.x ? gap : -gap);
      } else if (target + r > e.x0 && target - r < e.x1 && e.hp * 2 >= c.count) {
        target = e.x0 < 10 ? e.x1 + r + 1 : e.x0 - r - 1;
      }
    }
    // Bridge coming up (or under us): line up with the deck, pack if we don't fit.
    const rPack = r * (1 - SQUEEZE_SHRINK);
    const br = s.segments.find((g) => g.kind === 'bridge' && g.y1 > s.dist - 2 && g.y0 - s.dist < 70 + r);
    if (br) {
      const mid = (br.x0 + br.x1) / 2;
      const half = (br.x1 - br.x0) / 2;
      const pack = r > half - 0.8;
      const rr = pack ? rPack : r;
      if (br.y0 - s.dist < 60) target = Math.max(br.x0 + rr, Math.min(br.x1 - rr, target));
      if (rr > half - 0.5 || br.y0 - s.dist < 20) target = mid;
      const dx = Math.max(-MAX_DX, Math.min(MAX_DX, target - c.x));
      return { dx, squeeze: pack && br.y0 - s.dist < 22 + r };
    }
    // Fork: get to (and stay on) the chosen side.
    if (plan && plan.g.y0 - s.dist < 45) {
      target = plan.side === 'left' ? Math.min(target, plan.g.d0 - r * 0.7) : Math.max(target, plan.g.d1 + r * 0.7);
    }
    // Find a safe spot; pack the crowd if that makes it clearly safer.
    const tFull = safeTarget(s, target, r);
    const dFull = dangerAt(s, tFull, r);
    target = tFull;
    if (dFull > 0) {
      const tPack = safeTarget(s, target, rPack);
      if (dangerAt(s, tPack, rPack) < dFull * 0.7) { squeeze = true; target = tPack; }
    }
  } else if (s.phase === 'boss') {
    target = s.boss.x;
    if (s.bossAtks.length) {
      const rPack = r * (1 - SQUEEZE_SHRINK);
      const tFull = safeTarget(s, target, r);
      const dFull = dangerAt(s, tFull, r);
      target = tFull;
      if (dFull > 0) {
        const tPack = safeTarget(s, target, rPack);
        if (dangerAt(s, tPack, rPack) < dFull * 0.7) { squeeze = true; target = tPack; }
      }
    }
  }
  const dx = Math.max(-MAX_DX, Math.min(MAX_DX, target - c.x));
  return { dx, squeeze };
}
