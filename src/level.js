// Procedural level generator. Same (seed, level) always gives the same layout.

import { createRng, hashSeed } from './rng.js';
import { addGate, mulGate, gambleGate } from './gates.js';
import { BOSS_R, FEATURES, TOWER_W, SOLDIER_DPS, AMBUSH_FROM } from './config.js';

export const DEFAULT_SEED = 'chimaek';

// Weapon moments in the mix (see generateLevel): fort walls and warbands.
export const WEAPON_MIX_FROM = 5;
export const FORT_HP = 3;        // fort walls: this times a normal wall's HP
export const WARBAND_SIZE = 2.5; // warbands: this times a normal squad...
export const WARBAND_SHARE = 1.6; // ...and scaled to this times the usual share of the crowd

// Mechanics that take up their own stretch of road.
export const SEGMENT_FEATURES = ['bridge', 'saws', 'archers', 'crushers', 'fork', 'giants'];

// The hint shown the first time a mechanic appears (on its intro level).
export const HINTS = {
  moving: ['MOVING GATES!', 'They slide or swap. Time your pick'],
  gamble: ['MYSTERY GATE!', 'Big bonus... or a big cut. Feeling lucky?'],
  bridge: ['NARROW BRIDGE!', 'Hold SQUEEZE to fit across'],
  saws: ['SAWS!', 'Steer through the gap'],
  archers: ['ARCHERS!', 'Dodge the red rings. Shoot the tower'],
  crushers: ['CRUSHERS!', 'Take the open lane'],
  fork: ['FORK IN THE ROAD!', 'Pick a side: RISKY pays more'],
  bossAttacks: ['BOSS ATTACKS!', 'Steer out of the red zones'],
  giants: ['GIANT!', 'Lots of HP. Shoot it down or go around'],
  shields: ['SHIELDS!', 'Break the shield, then hit the squad'],
  splitters: ['SPLITTERS!', 'Purple squads split in two when hit'],
  weapons: ['WEAPON PICKUPS!', 'Rocket, laser (through gates), magnet'],
};

// v3: shown once, on the level where squads start scaling and ambushing.
export const AMBUSH_HINT = ["DON'T LET THEM PASS!", 'Enemies that get by hit twice as hard'];

export const hasFeature = (level, f) => level >= FEATURES[f];

// The mechanic a level introduces, or null.
export function introFeature(level) {
  for (const f of Object.keys(FEATURES)) if (FEATURES[f] === level) return f;
  return null;
}

export function levelParams(level) {
  const d = Math.max(0, level - 1);
  const speed = 28 + Math.min(10, d * 0.8);
  const duration = 46 + Math.min(24, d * 3); // seconds of running before the boss
  let bossHp = Math.round(220 * Math.pow(1.32, d));
  let bossFighters; // v1 bosses: every soldier fights at once
  if (level >= FEATURES.bossAttacks) {
    // Bosses that attack: only so many soldiers reach them at once, so even a
    // huge crowd has a ~10 s fight to dodge through (bullets shorten it).
    const k = level - FEATURES.bossAttacks;
    bossFighters = 120 + 20 * k;
    bossHp = Math.round(Math.min(bossHp, SOLDIER_DPS * bossFighters * Math.min(13, 10 + 0.4 * k)));
  }
  return {
    speed,
    duration,
    length: Math.round(speed * duration),
    hitsPerStep: Math.min(14, 8 + Math.floor(d / 2)),
    bossHp,
    bossFighters,
    bossDps: 10 + 2 * d, // soldiers per second the boss removes
  };
}

export function generateLevel(seed = DEFAULT_SEED, level = 1) {
  const rng = createRng(hashSeed(seed, level));
  const p = levelParams(level);
  const d = level - 1;
  const H = p.hitsPerStep;

  // f = how far through the level (0..1). Numbers grow along the level and with level number.
  let f = 0;
  const grow = () => 1 + f * 2.2 + d * 0.35;
  const pos = () => Math.round(rng.int(4, 9) * grow());
  const neg = () => -Math.round(rng.int(4, 9) * grow() * (1 + d * 0.06));
  const smallNeg = () => -Math.round(rng.int(2, 5) * grow());
  const squadCount = () => Math.max(2, Math.round(rng.int(3, 7) * (1 + f * 3 + d * 0.5)));

  // Pair templates: [factory, weight]. Each returns the gates of one row.
  const pairTemplates = () => [
    [() => [addGate(pos()), addGate(neg())], 3],                 // good vs bad
    [() => [addGate(smallNeg()), addGate(pos())], 3],             // shoot the bad one until it beats the good one?
    [() => [addGate(pos()), addGate(pos() + rng.int(2, 5))], 1],
    [() => [addGate(pos() + 2), mulGate('×2', H)], f > 0.2 ? 1.1 : 0.5], // add vs multiply
    [() => [mulGate('÷2', H), addGate(pos())], 1.2],              // fix the divider?
    [() => [addGate(neg()), mulGate('÷2', H)], d >= 1 ? 1.5 + d * 0.3 : 0.4], // both bad: shoot one
    [() => [mulGate(d >= 3 && rng.chance(0.3) ? '×3' : '×2', H), addGate(neg() * 2)], f > 0.5 ? 0.7 : 0],
  ];

  const rows = [];
  const enemies = [];
  const powerups = [];
  const hazards = [];
  const segments = [];
  const hints = [];
  let nextId = 1;

  // v2 mechanics use their own random stream, so levels without them are
  // exactly the v1 layouts.
  const rng2 = createRng(hashSeed(seed, level, 'v2'));
  const intro = introFeature(level);
  const counts = {};
  const hint = (f, y) => {
    counts[f] = (counts[f] || 0) + 1;
    if (f === intro && counts[f] === 1) hints.push({ y, title: HINTS[f][0], sub: HINTS[f][1], shown: false });
  };
  const since = (f) => level - FEATURES[f]; // levels since the mechanic arrived (0 on its intro level)

  // ---- segment placers: each adds its stuff at y and returns how much road it used.
  const placers = {
    bridge(y0) {
      const k = since('bridge');
      const len = Math.min(120, 70 + k * 5 + rng2.int(0, 20));
      const w = Math.max(15, 25 - k * 1.1);
      const mid = k === 0 && !counts.bridge ? 50 : rng2.int(Math.ceil(10 + w / 2), Math.floor(90 - w / 2));
      const y = y0 + 25; // a short run-up so the crowd can line up
      segments.push({ id: nextId++, kind: 'bridge', y0: y, y1: y + len, x0: mid - w / 2, x1: mid + w / 2 });
      hint('bridge', y);
      return len + 70; // room after it, so a gate row's guard squad can't stand on the deck
    },
    saws(y0) {
      const k = since('saws');
      const period = Math.max(1.5, 2.6 - k * 0.12);
      const n = counts.saws || 0;
      const pattern = k === 0 ? ['one', 'two', 'zig'][Math.min(2, n)]
        : rng2.weighted([['one', 1], ['two', 1.3], ['zig', 1 + k * 0.1]]);
      const saw = (y, a, b) => hazards.push({ id: nextId++, kind: 'saw', y, a, b, period, phase: rng2.next() });
      const left = rng2.chance(0.5);
      hint('saws', y0);
      if (pattern === 'one') {
        if (left) saw(y0, 10, 46); else saw(y0, 54, 90);
        return 80;
      }
      if (pattern === 'two') {
        saw(y0, 7, 30);
        saw(y0, 70, 93);
        return 80;
      }
      if (left) { saw(y0, 10, 46); saw(y0 + 36, 54, 90); } else { saw(y0, 54, 90); saw(y0 + 36, 10, 46); }
      return 115;
    },
    archers(y0) {
      const k = since('archers');
      const tower = (x, y) => enemies.push({
        id: nextId++, kind: 'tower', x0: x - TOWER_W / 2, x1: x + TOWER_W / 2, y,
        hp: Math.round((9 + rng2.int(0, 5)) * grow()), start: 0, alive: true,
        period: Math.max(1.0, 1.7 - k * 0.07), cd: 0.5, kills: 2 + Math.min(4, Math.floor(k / 2)),
      });
      const side = rng2.chance(0.5);
      const y = y0 + 30;
      tower(side ? rng2.int(12, 30) : rng2.int(70, 88), y);
      if (k >= 2 && rng2.chance(0.35 + k * 0.03)) tower(side ? rng2.int(70, 88) : rng2.int(12, 30), y + 18);
      else if (k >= 1 && rng2.chance(0.5)) addSquad(rng2.int(30, 70), y - 20, Math.max(2, Math.round(rng2.int(3, 7) * (1 + f * 3 + d * 0.5))));
      for (const e of enemies) if (e.kind === 'tower' && !e.start) e.start = e.hp;
      hint('archers', y);
      return 75;
    },
    fork(y0) {
      const k = since('fork');
      const y = y0 + 35; // run-up so the crowd can choose
      const len = Math.min(260, 215 + k * 6);
      const riskyLeft = rng2.chance(0.5);
      const sides = { left: [1, 46], right: [54, 99] };
      const risky = sides[riskyLeft ? 'left' : 'right'], safe = sides[riskyLeft ? 'right' : 'left'];
      segments.push({ id: nextId++, kind: 'fork', y0: y, y1: y + len, d0: 47, d1: 53, risky: riskyLeft ? 'left' : 'right' });
      const g = grow();
      const sideRow = (yy, side, gates) => {
        const m = (side[0] + side[1]) / 2;
        const spans = [[side[0], m - 0.5], [m + 0.5, side[1]]];
        if (rng2.chance(0.5)) gates.reverse();
        rows.push({ id: nextId++, y: yy, used: false, fork: true, gates: gates.map((gt, i) => ({ ...gt, id: nextId++, x0: spans[i][0], x1: spans[i][1] })) });
      };
      // Risky side: two juicy rows with trouble in between.
      sideRow(y + 45, risky, [addGate(Math.round(rng2.int(10, 15) * g)), mulGate('×2', H)]);
      const ex = (risky[0] + risky[1]) / 2 + rng2.int(-8, 8);
      if (hasFeature(level, 'archers') && rng2.chance(0.5)) {
        const hp = Math.round((10 + rng2.int(0, 5)) * g);
        enemies.push({ id: nextId++, kind: 'tower', x0: ex - TOWER_W / 2, x1: ex + TOWER_W / 2, y: y + 105, hp, start: hp, alive: true, period: 1.3, cd: 0.5, kills: 3 });
      } else {
        addSquad(ex, y + 100, Math.max(4, Math.round(rng2.int(8, 12) * (1 + f * 3 + d * 0.5))));
      }
      if (hasFeature(level, 'saws')) {
        const left = rng2.chance(0.5);
        const a = left ? risky[0] + 6 : (risky[0] + risky[1]) / 2 + 2;
        hazards.push({ id: nextId++, kind: 'saw', y: y + 140, a, b: a + 15, period: 2.2, phase: rng2.next() });
      }
      sideRow(y + 185, risky, [mulGate(k >= 2 && rng2.chance(0.4) ? '×3' : '×2', H), addGate(-Math.round(rng2.int(5, 9) * g))]);
      // Safe side: small but sure.
      const small = () => Math.round(rng2.int(3, 6) * g);
      sideRow(y + 70, safe, [addGate(small()), addGate(small() + 2)]);
      sideRow(y + 165, safe, [addGate(small()), addGate(-small())]);
      hint('fork', y);
      return len + 55;
    },
    giants(y0) {
      const k = since('giants');
      const giant = (x, y) => {
        const hp = Math.round((30 + rng2.int(0, 14)) * grow());
        enemies.push({ id: nextId++, kind: 'giant', x, y, hp, start: hp, alive: true });
      };
      const y = y0 + 25;
      giant(rng2.int(25, 75), y);
      if (k >= 2 && rng2.chance(0.4)) giant(rng2.int(20, 80), y + 32);
      hint('giants', y);
      return k >= 2 ? 100 : 72;
    },
    crushers(y0) {
      const k = since('crushers');
      const period = Math.max(1.9, 2.6 - k * 0.08);
      const lanes = [[0, 33], [33.5, 66.5], [67, 100]];
      const row = (y, open) => {
        let ph = rng2.next();
        lanes.forEach(([x0, x1], i) => {
          if (i === open) return;
          hazards.push({ id: nextId++, kind: 'crusher', y, x0, x1, depth: 7, period, phase: ph });
          ph += 0.5;
        });
      };
      hint('crushers', y0);
      const open = rng2.int(0, 2);
      row(y0, open);
      if (k >= 2 && rng2.chance(0.4)) {
        row(y0 + 40, (open + rng2.int(1, 2)) % 3);
        return 120;
      }
      return 85;
    },
  };

  const segUnlocked = SEGMENT_FEATURES.filter((f) => hasFeature(level, f));
  const firstSeg = Math.min(...SEGMENT_FEATURES.map((f) => FEATURES[f]));
  let featureP = segUnlocked.length ? Math.min(0.4, 0.16 + 0.025 * (level - firstSeg)) : 0;
  if (intro) featureP *= 0.5; // keep intro levels focused on the new thing
  const forcedSlots = intro && SEGMENT_FEATURES.includes(intro) ? [330, p.length * 0.42, p.length * 0.72] : [];
  let forcedK = 0;
  const ROOM = { fork: 360, bridge: 280 }; // road a segment needs before the boss
  // Things you have to shoot (v3: they can't be dodged for free) never come
  // straight off a bridge, where the crowd can't line up with them.
  const NEEDS_AIM = new Set(['giants', 'archers']);
  let lastSeg = null;
  const pickSegment = (y) => {
    const fits = (f) => y < p.length - (ROOM[f] || 220) && !(lastSeg === 'bridge' && NEEDS_AIM.has(f));
    if (forcedK < forcedSlots.length && y >= forcedSlots[forcedK] && fits(intro)) { forcedK += 1; return intro; }
    const pool = segUnlocked.filter((f) => f !== intro && fits(f));
    if (!pool.length || !rng2.chance(featureP)) return null;
    return rng2.weighted(pool.map((f) => [f, 1 + 0.15 * Math.min(4, since(f))]));
  };

  const addRow = (y, gates, layout) => {
    let spans;
    if (layout === 'pair') spans = [[1, 49], [51, 99]];
    else if (layout === 'triple') spans = [[1, 33], [34, 66], [67, 99]];
    else spans = rng.chance(0.5) ? [[1, 50]] : [[50, 99]];
    if (rng.chance(0.5)) gates.reverse();
    rows.push({
      id: nextId++,
      y,
      used: false,
      gates: gates.map((g, i) => ({ ...g, id: nextId++, x0: spans[i][0], x1: spans[i][1] })),
    });
    return spans;
  };

  // Shields and splitters dress up ordinary squads (from their levels on).
  const pVariant = (feat) => Math.min(0.3, 0.12 + 0.03 * since(feat)) * (intro && intro !== feat ? 0.5 : 1);
  const addSquad = (x, y, count) => {
    const e = { id: nextId++, kind: 'squad', x, y, count, start: count, alive: true };
    if (y > 300 && hasFeature(level, 'shields')
      && ((intro === 'shields' && (counts.shields || 0) < 4) || (intro !== 'shields' && rng2.chance(pVariant('shields'))))) {
      e.shield = e.shieldMax = Math.max(4, Math.round(count * 0.7));
      hint('shields', y);
    } else if (y > 300 && count >= 4 && hasFeature(level, 'splitters')
      && ((intro === 'splitters' && (counts.splitters || 0) < 4) || (intro !== 'splitters' && rng2.chance(pVariant('splitters'))))) {
      e.split = true;
      hint('splitters', y);
    }
    enemies.push(e);
  };
  const addWall = (x0, x1, y, hp) =>
    enemies.push({ id: nextId++, kind: 'wall', x0, x1, y, hp, start: hp, alive: true });

  // Opening: a friendly gate pair so the first decision comes fast.
  let y = 110;
  addRow(y, [addGate(rng.int(4, 7)), addGate(rng.int(8, 12))], 'pair');
  y += 110;

  let gap = 0; // segments since the last gate row
  while (y < p.length - 120) {
    f = y / p.length;
    const seg = gap >= 1 || y > 300 ? pickSegment(y) : null;
    lastSeg = seg;
    if (seg) {
      y += placers[seg](y + 10) + 10;
      gap += 1;
      continue;
    }
    let kind;
    if (gap >= 1 && rng.chance(0.75)) kind = 'gate';
    else kind = rng.weighted([
      ['squads', 2.5 + d * 0.3],
      ['wall', d >= 1 ? 0.9 : 0.5],
      ['mixed', d >= 1 ? 1.2 : 0.5],
    ]);
    if (gap === 0 && kind === 'gate') kind = 'squads';

    if (kind === 'gate') {
      const layout = rng.weighted([['pair', 7], ['single', 1.3], ['triple', d >= 1 ? 1.5 : 0.7]]);
      if (layout === 'pair') {
        addRow(y, rng.weighted(pairTemplates())(), 'pair');
      } else if (layout === 'single') {
        const spans = addRow(y, [rng.chance(0.8) ? addGate(pos() + 3) : mulGate('×2', H)], 'single');
        // Guard the open side with a squad so the free lane isn't free.
        addSquad(spans[0][0] < 10 ? 75 : 25, y - 40, squadCount());
      } else {
        addRow(y, [addGate(pos()), mulGate(rng.chance(0.3) ? '×2' : '÷2', H), addGate(neg())], 'triple');
      }
      gap = 0;
      y += rng.int(95, 120);
    } else if (kind === 'squads') {
      const n = rng.int(1, d >= 2 ? 3 : 2);
      for (let i = 0; i < n; i++) addSquad(rng.int(12, 88), y + rng.int(-12, 12), squadCount());
      gap += 1;
      y += rng.int(70, 90);
    } else if (kind === 'wall') {
      const w = rng.int(34, 52);
      const left = rng.chance(0.5);
      addWall(left ? 0 : 100 - w, left ? w : 100, y, Math.round((8 + rng.int(0, 6)) * grow()));
      gap += 1;
      y += rng.int(70, 85);
    } else {
      addSquad(rng.int(15, 40), y, squadCount());
      addSquad(rng.int(60, 85), y + 20, squadCount());
      gap += 1;
      y += rng.int(80, 95);
    }

    if (rng.chance(0.2)) {
      powerups.push({
        id: nextId++,
        kind: rng.chance(0.5) ? 'rapid' : 'spread',
        x: rng.int(15, 85),
        y: y - rng.int(30, 45),
        taken: false,
      });
    }
  }

  rows.sort((a, b) => a.y - b.y);
  const bossAttacks = hasFeature(level, 'bossAttacks');
  if (intro === 'bossAttacks') {
    hints.push({ y: p.length + 60, atBoss: true, title: HINTS.bossAttacks[0], sub: HINTS.bossAttacks[1], shown: false });
  }

  // ---- gamble gates: some gates become "?" (seeded: same level, same outcome).
  if (hasFeature(level, 'gamble')) {
    const k = since('gamble');
    const pGamble = intro === 'gamble' ? 0 : Math.min(0.25, 0.1 + 0.02 * k) * (intro ? 0.6 : 1);
    rows.forEach((row, i) => {
      if (i === 0 || row.fork) return;
      const forced = intro === 'gamble' && (i === 2 || i === 4 || i === 6);
      if (!forced && !rng2.chance(pGamble)) return;
      const big = Math.round(rng2.int(12, 20) * (1 + (row.y / p.length) * 1.5 + d * 0.35));
      const then = rng2.chance(0.6) ? addGate(big) : mulGate(k >= 3 && rng2.chance(0.4) ? '÷3' : '÷2', H);
      const j = rng2.int(0, row.gates.length - 1);
      const old = row.gates[j];
      row.gates[j] = { ...gambleGate(then), id: old.id, x0: old.x0, x1: old.x1 };
      hint('gamble', row.y);
    });
  }

  // ---- moving gates: a pass over the normal gate rows (never the opener).
  if (hasFeature(level, 'moving')) {
    const k = since('moving');
    const pMove = intro === 'moving' ? 0 : Math.min(0.4, 0.15 + 0.03 * k) * (intro ? 0.6 : 1);
    rows.forEach((row, i) => {
      if (i === 0 || row.fork) return;
      const forced = intro === 'moving' && (i === 1 || i === 3 || i === 5 || i === 7);
      if (!forced && !rng2.chance(pMove)) return;
      const n = row.gates.length;
      if (n === 1) {
        // A single gate slides across the road.
        const g = row.gates[0];
        g.bx0 = 32; g.bx1 = 68; g.x0 = 32; g.x1 = 68;
        row.move = { kind: 'slide', amp: 28, period: Math.max(2.4, 3.4 - 0.1 * k), phase: rng2.next() };
      } else if (n === 2 && ((k >= 2 && rng2.chance(0.35)) || (forced && i === 3))) {
        // A narrow pair slides together.
        row.gates[0].bx0 = 21; row.gates[0].bx1 = 49;
        row.gates[1].bx0 = 51; row.gates[1].bx1 = 79;
        for (const g of row.gates) { g.x0 = g.bx0; g.x1 = g.bx1; }
        row.move = { kind: 'slide', amp: 19, period: Math.max(2.6, 3.6 - 0.1 * k), phase: rng2.next() };
      } else if (n === 2 || k >= 1) {
        row.move = { kind: 'swap', period: Math.max(1.5, 2.2 - 0.05 * k) };
      } else {
        return;
      }
      hint('moving', row.y);
    });
  }

  // ---- weapon pickups (rocket / laser / magnet), from their level on.
  let magnetAt = -1;
  const busy = (yy, pad) => rows.some((r) => Math.abs(r.y - yy) < pad)
    || enemies.some((e) => Math.abs(e.y - yy) < pad) || hazards.some((h) => Math.abs(h.y - yy) < pad)
    || segments.some((g) => yy > g.y0 - pad && yy < g.y1 + pad) || powerups.some((q) => Math.abs(q.y - yy) < pad);
  if (hasFeature(level, 'weapons')) {
    const kinds = ['rocket', 'laser', 'magnet'];
    if (intro === 'weapons') {
      // Show each one off: the laser just before a gate row (so it visibly
      // shoots through), the magnet just before a coin trail.
      const place = (kind, y0) => {
        let yy = Math.round(y0);
        while (busy(yy, 14) && yy < p.length - 150) yy += 5;
        powerups.push({ id: nextId++, kind, x: rng2.int(25, 75), y: yy, taken: false });
        hint('weapons', yy);
        return yy;
      };
      place('rocket', 340);
      const gateRow = rows.find((r) => r.y > p.length * 0.4 && !r.fork) || rows[rows.length - 1];
      let ly = gateRow.y - 55;
      while (busy(ly, 12) && ly > gateRow.y - 90) ly -= 5;
      powerups.push({ id: nextId++, kind: 'laser', x: rng2.int(30, 70), y: ly, taken: false });
      magnetAt = place('magnet', p.length * 0.66);
    } else {
      const pw = Math.min(0.6, 0.35 + 0.04 * since('weapons')) * (intro ? 0.5 : 1);
      for (const pu of powerups) if (rng2.chance(pw)) pu.kind = rng2.pick(kinds);
    }
  }

  // ---- coins on the track: short trails in the empty stretches, and a line
  // down the middle of each bridge deck. Own random stream.
  const coins = [];
  const rng3 = createRng(hashSeed(seed, level, 'coins'));
  const taken = [];
  for (const r of rows) taken.push([r.y - 8, r.y + 8]);
  for (const e of enemies) taken.push([e.y - 12, e.y + 12]);
  for (const h of hazards) taken.push([h.y - 10, h.y + 10]);
  for (const q of powerups) taken.push([q.y - 8, q.y + 8]);
  for (const g of segments) taken.push([g.y0 - 15, g.y1 + 8]);
  taken.sort((a, b) => a[0] - b[0]);
  let free = 140;
  const trails = [];
  for (const [a, b] of taken) {
    if (a - free >= 50) trails.push([free, a]);
    free = Math.max(free, b);
  }
  if (p.length - 60 - free >= 50) trails.push([free, p.length - 60]);
  for (const [a, b] of trails) {
    if (a >= magnetAt && a - magnetAt < 20) {
      // A wide zigzag of coins right after the intro magnet: it pulls them all in.
      for (let yy = a + 10, i = 0; yy < Math.min(b, a + 70); yy += 6, i++) {
        coins.push({ id: nextId++, x: i % 2 ? 22 + (i % 3) * 4 : 78 - (i % 3) * 4, y: yy, taken: false });
      }
      continue;
    }
    if (!rng3.chance(0.6)) continue;
    const n = rng3.int(5, 7);
    const y0 = a + (b - a - (n - 1) * 5) / 2;
    const x0 = rng3.int(15, 85);
    const x1 = Math.max(12, Math.min(88, x0 + rng3.int(-25, 25)));
    for (let i = 0; i < n; i++) coins.push({ id: nextId++, x: Math.round(x0 + ((x1 - x0) * i) / (n - 1)), y: Math.round(y0 + i * 5), taken: false });
  }
  for (const g of segments) {
    if (g.kind !== 'bridge') continue;
    for (let yy = g.y0 + 8; yy < g.y1 - 4; yy += 9) coins.push({ id: nextId++, x: (g.x0 + g.x1) / 2, y: yy, taken: false });
  }
  coins.sort((a, b) => a.y - b.y);
  powerups.sort((a, b) => a.y - b.y);

  // ---- weapon moments (from the melee level on): some walls become fort
  // walls across the whole road (thick: a job for melee), and some lone
  // squads become warbands (big, and they don't share their size with
  // others in view: a job for the shield). Own random stream, so the rest of
  // the layout is unchanged.
  if (level >= WEAPON_MIX_FROM) {
    const rng4 = createRng(hashSeed(seed, level, 'weapons'));
    const k = level - WEAPON_MIX_FROM;
    for (const e of enemies) {
      if (e.kind === 'wall' && rng4.chance(Math.min(0.7, 0.45 + 0.03 * k))) {
        e.x0 = 0; e.x1 = 100; e.fort = true;
        e.hp = e.start = Math.round(e.hp * FORT_HP);
      } else if (e.kind === 'squad' && !e.split && !e.shield && e.y > 300
        && !enemies.some((o) => o !== e && o.kind === 'squad' && Math.abs(o.y - e.y) < 40)
        && rng4.chance(Math.min(0.45, 0.25 + 0.02 * k))) {
        e.warband = true;
        e.count = e.start = Math.round(e.count * WARBAND_SIZE);
      }
    }
  }

  // The ambush hint: at the first squad that isn't near another hint.
  if (level === AMBUSH_FROM) {
    const sq = enemies.filter((e) => e.kind === 'squad' && e.y > 250).sort((a, b) => a.y - b.y)
      .find((e) => hints.every((h) => Math.abs(h.y - e.y) > 140));
    if (sq) hints.push({ y: sq.y, title: AMBUSH_HINT[0], sub: AMBUSH_HINT[1], shown: false });
  }

  return {
    seed: String(seed),
    level,
    speed: p.speed,
    length: p.length,
    rows,
    enemies,
    powerups,
    hazards,
    segments,
    hints,
    coins,
    boss: { x: 50, y: p.length + 60, r: BOSS_R, hp: p.bossHp, maxHp: p.bossHp, dps: p.bossDps, attacks: bossAttacks, fighters: p.bossFighters },
  };
}
