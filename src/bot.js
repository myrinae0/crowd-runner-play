// A simple autopilot used by ?demo=1, screenshots and balance tests.
// It reads the sim state and returns an input ({ dx }); it never mutates state.

import { applyGate, previewHits } from './gates.js';
import { crowdRadius, squadRadius } from './combat.js';
import { RAPID_MULT } from './config.js';
import { volleyStreams } from './sim.js';

const LOOK = 170;
const MAX_DX = 1.1; // units per tick (~66 units/s)

function shotsUntil(s, dy) {
  const rate = s.stats.fireRate * (s.buffs.rapid > 0 ? RAPID_MULT : 1);
  const streams = volleyStreams(s.crowd.count);
  const t = Math.max(0, dy / s.speed - 0.4);
  return Math.floor(rate * t * streams * 0.85);
}

export function botInput(s) {
  const c = s.crowd;
  let target = c.x;
  const r = crowdRadius(c.count);

  if (s.phase === 'run') {
    const row = s.rows.find((rw) => !rw.used && rw.y > s.dist && rw.y - s.dist < LOOK);
    let best = null;
    if (row) {
      const hits = shotsUntil(s, row.y - s.dist);
      const lanes = [];
      for (const g of row.gates) lanes.push({ x: (g.x0 + g.x1) / 2, score: applyGate(c.count, previewHits(g, hits)) });
      // Open lane (single-gate rows).
      if (row.gates.length === 1) lanes.push({ x: row.gates[0].x0 < 10 ? 75 : 25, score: c.count });
      for (const lane of lanes) {
        // Penalise enemies standing between us and that lane.
        for (const e of s.enemies) {
          if (!e.alive || e.y < s.dist || e.y > row.y) continue;
          const ex = e.kind === 'squad' ? e.x : (e.x0 + e.x1) / 2;
          const half = e.kind === 'squad' ? squadRadius(e.count) : (e.x1 - e.x0) / 2;
          if (Math.abs(ex - lane.x) < half + r) {
            const n = e.kind === 'squad' ? e.count : e.hp;
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
      else if (e) target = e.kind === 'squad' ? e.x : (e.x0 + e.x1) / 2;
    }
    // Dodge anything about to touch us that we won't kill in time.
    for (const e of s.enemies) {
      if (!e.alive || e.y < s.dist || e.y - s.dist > 30) continue;
      if (e.kind === 'squad') {
        const n = e.count;
        if (n * 2 < c.count) continue;
        const gap = squadRadius(n) + r + 2;
        if (Math.abs(target - e.x) < gap) target = e.x + (target >= e.x ? gap : -gap);
      } else if (target + r > e.x0 && target - r < e.x1 && e.hp * 2 >= c.count) {
        target = e.x0 < 10 ? e.x1 + r + 1 : e.x0 - r - 1;
      }
    }
  } else if (s.phase === 'boss') {
    target = s.boss.x;
  }
  const dx = Math.max(-MAX_DX, Math.min(MAX_DX, target - c.x));
  return { dx };
}
