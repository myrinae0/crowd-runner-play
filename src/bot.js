// A simple autopilot used by ?demo=1, screenshots and balance tests.
// It reads the sim state and returns an input ({ dx, squeeze, weapon }); it
// never mutates state.
//
// It picks a target x (the best gate lane, an enemy to shoot, a power-up), then
// moves to the nearby x with the least danger from hazards, staying close to the target.
//
// Weapons: botInput(s, policy) plays with one weapon ('rifle' (the default,
// exactly the old autopilot), 'shield', 'melee'; a weapon that isn't unlocked
// yet falls back to the rifle) or 'switch': before each threat it picks the
// weapon whose estimated losses are lowest (chooseWeapon below). A weapon
// "model" (M) tells the path planner how that weapon deals with things.

import { applyGate, previewHits } from './gates.js';
import { crowdRadius, squadRadius } from './combat.js';
import { RAPID_MULT, SAW_R, X_MIN, X_MAX, SQUEEZE_SHRINK, ARROW_R, AMBUSH_FROM, AMBUSH_MULT } from './config.js';

const ambushMult = (s) => (s.level >= AMBUSH_FROM ? AMBUSH_MULT : 1);
import { volleyStreams, enemyX, enemyRadius, contactCost } from './sim.js';
import { WT, weaponUnlocked, meleeDamage } from './weapons.js';
import { sawX, crusherLift, chordOverlapFrac, slideOffset, swapCount } from './hazards.js';

const LOOK = 170;
const MAX_DX = 1.1; // units per tick (~66 units/s)
const DANGER_AHEAD = 60; // hazards closer than this (world units) shape the path

// How a weapon deals with things, for the planner. shots: bullets vs the
// rifle; gate: gate hits per shot; clash / amb: share of a head-on clash /
// an ambush that still costs soldiers; hit(e): damage one slash does to e.
const RIFLE_MODEL = { w: 'rifle', shots: 1, gate: 1, clash: 1, amb: 1, hit: () => 0 };
export function weaponModel(s, w) {
  const ws = s.ws;
  if (w === 'shield') return { w, shots: WT.shieldFire, gate: WT.shieldFire, clash: ws.clash, amb: ws.clash, hit: () => 0 };
  if (w === 'melee') {
    const d = meleeDamage(s.crowd.count);
    return { w, shots: 0, gate: 0, clash: 1, amb: 1, hit: (e) => d * (e.kind === 'giant' || e.kind === 'wall' ? ws.bigHit : 1) };
  }
  return ws.tuner !== 1 ? { ...RIFLE_MODEL, gate: ws.tuner } : RIFLE_MODEL;
}

function shotsUntil(s, dy, M = RIFLE_MODEL) {
  if (!M.shots) return 0;
  const rate = s.stats.fireRate * (s.buffs.rapid > 0 && M.w === 'rifle' ? RAPID_MULT : 1) * (M.shots === 1 ? 1 : M.shots); // assumes we spread out to shoot
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
function forkPlan(s, M) {
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
        else if (kind === 'enemy') n -= Math.max(0, contactCost(o) * 0.6 - shotsUntil(s, 60, M) * s.stats.damage - M.hit(o)) * M.clash;
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

export function botInput(s, policy = 'rifle') {
  let want = policy === 'switch' ? chooseWeapon(s) : policy;
  if (!weaponUnlocked(s.level, want)) want = 'rifle';
  const out = steer(s, weaponModel(s, want));
  out.weapon = want;
  return out;
}

function steer(s, M) {
  const c = s.crowd;
  let target = c.x;
  let squeeze = false;
  const r = crowdRadius(c.count);

  if (s.phase === 'run') {
    const plan = forkPlan(s, M);
    const row = s.rows.find((rw) => !rw.used && rw.y > s.dist && rw.y - s.dist < LOOK
      && (!plan || !rw.fork || rowSide(rw) === plan.side));
    let best = null;
    if (row) {
      const hits = shotsUntil(s, row.y - s.dist, M) * (row.move && row.move.kind === 'swap' ? 0.5 : 1) * (M.gate / (M.shots || 1));
      const lanes = [];
      const at = rowAtArrival(s, row);
      for (const l of at) lanes.push({ x: (l.x0 + l.x1) / 2, score: laneScore(s, l.gate, hits) });
      // Open lane (single-gate rows).
      if (at.length === 1) lanes.push({ x: at[0].x0 > 50 - (at[0].x1 - 50) ? at[0].x0 / 2 : (at[0].x1 + 100) / 2, score: c.count });
      for (const lane of lanes) {
        // Penalise enemies between us and that lane: met head-on in the lane,
        // or (v3) ambushing us for double if the lane goes past them.
        for (const e of s.enemies) {
          if (!e.alive || e.y < s.dist || e.y > row.y) continue;
          const ex = enemyX(e);
          const half = e.x !== undefined ? enemyRadius(e) : (e.x1 - e.x0) / 2;
          const n = Math.max(0, contactCost(e) + (e.shield || 0) - shotsUntil(s, e.y - s.dist, M) * s.stats.damage * 0.6 - M.hit(e));
          if (Math.abs(ex - lane.x) < half + r) lane.score -= n * M.clash;
          else if (e.x !== undefined) lane.score -= n * ambushMult(s) * M.amb;
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
    // Squads and giants coming at us: from AMBUSH_FROM on, letting one past
    // costs double, so line up with one (to shoot it, then take what's left
    // head-on). Pick the line-up that costs least overall. Before that level,
    // dodge the ones we can't beat, like v2 did.
    const meet = ambushMult(s) > 1;
    if (meet) {
      const threats = s.enemies.filter((e) => e.alive && e.x !== undefined && e.y > s.dist - 2 && e.y - s.dist < 110
        && !(row && row.y < e.y && e.y - s.dist > 45 + r)); // a gate row first: deal with it after
      if (threats.length) {
        const dmg = s.stats.damage;
        const left = (e) => Math.max(0, contactCost(e) + (e.shield || 0) - shotsUntil(s, e.y - s.dist, M) * dmg * 0.8 - M.hit(e));
        let bestX = null, bestCost = Infinity;
        for (const t of threats) {
          let cost = Math.abs(t.x - c.x) * 0.05; // prefer less steering
          for (const o of threats) {
            const lined = Math.abs(o.x - t.x) < enemyRadius(o) + r * 0.8;
            cost += lined ? (o === t ? left(o) : contactCost(o)) * M.clash : ambushMult(s) * left(o) * M.amb;
          }
          if (cost < bestCost) { bestCost = cost; bestX = t.x; }
        }
        const urgent = threats.some((e) => e.y - s.dist < 45 + r);
        if (!row || urgent || row.y > Math.min(...threats.map((e) => e.y))) target = bestX;
      }
    } else {
      for (const e of s.enemies) {
        if (!e.alive || e.x === undefined || e.y < s.dist || e.y - s.dist > 30) continue;
        const n = contactCost(e) + (e.shield || 0);
        if (n * 2 < c.count) continue;
        const gap = enemyRadius(e) + r + 2;
        if (Math.abs(target - e.x) < gap) target = e.x + (target >= e.x ? gap : -gap);
      }
    }
    // Walls and towers don't ambush: still go around the ones we can't break.
    for (const e of s.enemies) {
      if (!e.alive || e.x !== undefined || e.y < s.dist || e.y - s.dist > 30) continue;
      if (target + r > e.x0 && target - r < e.x1 && (e.hp - M.hit(e)) * 2 * M.clash >= c.count) {
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
    // Fortress (shield upgrade): squeeze to become immune when a saw or an
    // arrow is about to get us anyway.
    const w = s.weapon;
    if (M.w === 'shield' && s.ws.fortress > 0 && w.armT <= 0 && (w.fortT > 0 || w.fortCd <= 0) && dangerAt(s, c.x, r) > 0.3) squeeze = true;
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

// ---- the switching policy ----------------------------------------------------
// Rough losses (minus gate gains) of meeting what is coming up with weapon w.
// Threats are the enemies ahead within reaction range; we assume we line up
// with the costliest one and the others go past (ambush) unless the weapon
// handles them. A gate row before the threats adds what the weapon's shots
// would make of it.
export function outlook(s, w, threats, row) {
  const M = weaponModel(s, w);
  const c = s.crowd;
  const r = crowdRadius(c.count);
  const switching = w !== s.weapon.cur;
  const delay = switching ? s.ws.switchTime : Math.max(0, s.weapon.armT);
  const dmg = s.stats.damage;
  const amb = ambushMult(s);
  const gunRate = M.shots ? s.stats.fireRate * M.shots * volleyStreams(c.count) * 0.85 * dmg * 0.8 : 0;
  let loss = 0;
  let tDone = 0; // when the last threat is dealt with (then we'd go back to the rifle)
  let firstFree = switching && w === 'shield';
  // Line up with the biggest; things within reach of it share its fate.
  let main = null;
  for (const e of threats) if (e.x !== undefined && (!main || contactCost(e) > contactCost(main))) main = e;
  for (const e of threats) {
    const er = e.x !== undefined ? enemyRadius(e) : 0;
    const gap = Math.max(0, e.y - s.dist - r - er);
    const tC = gap / (s.speed + (e.kind === 'giant' ? 4.5 : e.x !== undefined ? 7 : 0)); // seconds to contact
    tDone = Math.max(tDone, tC);
    const armed = tC >= delay; // a weapon switched to too late meets it unarmed
    const shots = armed ? gunRate * Math.max(0, tC - delay - 0.2) : 0;
    const hit = armed ? M.hit(e) : 0;
    const clash = armed ? M.clash : 1;
    const ambM = armed ? M.amb : 1;
    const cost = contactCost(e) + (e.shield || 0);
    if (e.kind === 'tower') {
      // Towers: shoot them down, or soak the arrows.
      const arrows = Math.max(0, (e.hp - shots) / Math.max(1, e.hp)) * 3;
      const per = 2 + c.count * 0.05;
      loss += arrows * per * 0.35 * (w === 'shield' && armed ? 1 - WT.arrowBlock : 1);
      continue;
    }
    if (e.x === undefined) {
      // Walls: only hurt when lined up; go around the big ones.
      if (target2(c.x, r, e)) loss += Math.min(c.count * 0.5, Math.max(0, cost - shots - hit) * clash);
      continue;
    }
    const near = main && (e === main || (Math.abs(e.x - main.x) < enemyRadius(e) + r * 0.8));
    let left = Math.max(0, cost - shots - hit);
    // Melee: one slash per cooldown. A second squad only shares the slash if
    // it is right next to the first; otherwise it is met head-on.
    if (w === 'melee' && near && e !== main && (Math.abs(e.y - main.y) > 6 || Math.abs(e.x - main.x) > r * 0.5)) left = cost;
    if (near) {
      if (firstFree && armed) { firstFree = false; left = 0; }
      loss += left * clash;
    } else {
      loss += left * amb * ambM;
    }
  }
  // The next gate row: what our shots make of it. Away from the rifle, it
  // only gets the shield's few shots until the threats are dealt with, then
  // rifle shots after switching back.
  let gain = 0;
  if (row) {
    const tRow = (row.y - s.dist) / s.speed;
    let hits;
    if (w === 'rifle') hits = shotsUntil(s, Math.max(0, tRow - delay) * s.speed, M) * M.gate;
    else {
      const tBack = Math.min(tRow, tDone + 0.3);
      const R = weaponModel(s, 'rifle');
      hits = shotsUntil(s, Math.max(0, tBack - delay) * s.speed, M) * (M.gate / (M.shots || 1))
        + shotsUntil(s, Math.max(0, tRow - tBack - s.ws.switchTime) * s.speed + 0.4 * s.speed, R) * R.gate;
    }
    let best0 = -Infinity, best = -Infinity;
    for (const l of rowAtArrival(s, row)) {
      best0 = Math.max(best0, laneScore(s, l.gate, 0));
      best = Math.max(best, laneScore(s, l.gate, hits));
    }
    gain = best - best0;
  }
  return gain - loss;
}
const target2 = (x, r, e) => x + r > e.x0 && x - r < e.x1;

// Picks the weapon for what is coming next ('rifle' when nothing threatens).
export function chooseWeapon(s) {
  const w = s.weapon;
  if (w.armT > 0) return w.cur; // let a switch finish
  const has = (k) => weaponUnlocked(s.level, k);
  if (!has('shield')) return 'rifle';
  const options = ['rifle', 'shield'];
  if (has('melee')) options.push('melee');
  const c = s.crowd;
  if (s.phase === 'boss') return bossPick(s, options);
  if (s.phase !== 'run') return w.cur;
  const r = crowdRadius(c.count);
  const reactT = s.ws.switchTime + 0.5;
  const range = (s.speed + 7) * reactT + r + 30;
  const threats = [];
  for (const e of s.enemies) {
    if (!e.alive) continue;
    const dy = e.y - s.dist;
    if (dy < -r - 2 || dy > (e.kind === 'tower' ? 110 : range)) continue;
    threats.push(e);
  }
  // Nothing to fight (and nothing just behind it): back to the rifle for the gates.
  if (!threats.length && !s.enemies.some((e) => e.alive && e.x !== undefined && e.y > s.dist && e.y - s.dist < range + 45)) return 'rifle';
  if (!threats.length) return w.cur;
  if (s.t - w.since < s.ws.switchTime + 1.5) return w.cur; // otherwise commit for a while after a switch
  const row = s.rows.find((rw) => !rw.used && rw.y > s.dist && rw.y - s.dist < LOOK + 60);
  let best = w.cur, bestV = outlook(s, w.cur, threats, row);
  for (const k of options) {
    if (k === w.cur) continue;
    const v = outlook(s, k, threats, row);
    if (v > bestV + Math.max(4, c.count * 0.06)) { best = k; bestV = v; }
  }
  return best;
}

// Boss fight: the weapon that loses the fewest soldiers until it's down.
function bossPick(s, options) {
  const b = s.boss, c = s.crowd, ws = s.ws;
  const fighters = Math.min(c.count, b.fighters ?? Infinity);
  const gun = volleyStreams(c.count) * s.stats.fireRate * s.stats.damage;
  let best = s.weapon.cur, bestLoss = Infinity;
  for (const k of options) {
    const dps = fighters * 0.6 + (k === 'rifle' ? gun : k === 'shield' ? gun * WT.shieldFire : (meleeDamage(c.count) * ws.slayer) / ws.meleeCd);
    const loss = (b.dps * (k === 'shield' ? WT.bossGuard : 1) * b.hp) / Math.max(1, dps) + (k !== s.weapon.cur ? b.dps * ws.switchTime : 0);
    if (loss < bestLoss - 1) { bestLoss = loss; best = k; }
  }
  return best;
}
