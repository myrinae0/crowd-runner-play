// Procedural level generator. Same (seed, level) always gives the same layout.

import { createRng, hashSeed } from './rng.js';
import { addGate, mulGate } from './gates.js';
import { BOSS_R } from './config.js';

export const DEFAULT_SEED = 'chimaek';

export function levelParams(level) {
  const d = Math.max(0, level - 1);
  const speed = 28 + Math.min(10, d * 0.8);
  const duration = 46 + Math.min(24, d * 3); // seconds of running before the boss
  return {
    speed,
    duration,
    length: Math.round(speed * duration),
    hitsPerStep: Math.min(14, 8 + Math.floor(d / 2)),
    bossHp: Math.round(220 * Math.pow(1.32, d)),
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
  let nextId = 1;

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

  const addSquad = (x, y, count) =>
    enemies.push({ id: nextId++, kind: 'squad', x, y, count, start: count, alive: true });
  const addWall = (x0, x1, y, hp) =>
    enemies.push({ id: nextId++, kind: 'wall', x0, x1, y, hp, start: hp, alive: true });

  // Opening: a friendly gate pair so the first decision comes fast.
  let y = 110;
  addRow(y, [addGate(rng.int(4, 7)), addGate(rng.int(8, 12))], 'pair');
  y += 110;

  let gap = 0; // segments since the last gate row
  while (y < p.length - 120) {
    f = y / p.length;
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

  return {
    seed: String(seed),
    level,
    speed: p.speed,
    length: p.length,
    rows,
    enemies,
    powerups,
    boss: { x: 50, y: p.length + 60, r: BOSS_R, hp: p.bossHp, maxHp: p.bossHp, dps: p.bossDps },
  };
}
