// Gate math. Pure functions; no rendering.
//
// Two kinds of gate:
//   add: { kind: 'add', value }          value is a signed integer (+5, -3, 0)
//        Each bullet hit adds +1, so -3 → -2 → -1 → +0 → +1 ...
//   mul: { kind: 'mul', step, hits, hitsPerStep }
//        step indexes MUL_LADDER (÷3 ÷2 ×1 ×2 ×3). Every `hitsPerStep` bullet
//        hits move it one notch right, up to ×2 (MUL_SHOT_CAP). Hits on a gate
//        already at ×2 or ×3 are absorbed and do nothing.
//
// Passing through a gate:
//   add: count + value, never below 0.
//   ×n:  count * n.
//   ÷n:  floor(count / n), but never below 1 if you had at least 1 soldier.
//   Results are capped at MAX_CROWD.

import { MUL_LADDER, MAX_CROWD, MUL_SHOT_CAP } from './config.js';

export function addGate(value) {
  return { kind: 'add', value: Math.trunc(value), lastHit: -1 };
}

export function mulGate(label, hitsPerStep = 6) {
  const step = MUL_LADDER.findIndex((m) => m.label === label);
  if (step < 0) throw new Error(`unknown multiplier gate ${label}`);
  return { kind: 'mul', step, hits: 0, hitsPerStep, lastHit: -1 };
}

export function hitGate(g, n = 1) {
  if (g.kind === 'add') {
    g.value += n;
  } else {
    const top = MUL_SHOT_CAP;
    if (g.step >= top) return g;
    g.hits += n;
    while (g.hits >= g.hitsPerStep && g.step < top) {
      g.hits -= g.hitsPerStep;
      g.step += 1;
    }
    if (g.step >= top) g.hits = 0;
  }
  return g;
}

export function applyGate(count, g) {
  let out;
  if (g.kind === 'add') {
    out = count + g.value;
  } else {
    const { mul, div } = MUL_LADDER[g.step];
    if (div > 1) out = count >= 1 ? Math.max(1, Math.floor(count / div)) : 0;
    else out = count * mul;
  }
  return Math.min(MAX_CROWD, Math.max(0, Math.floor(out)));
}

export function gateLabel(g) {
  if (g.kind === 'add') return g.value >= 0 ? `+${g.value}` : `−${-g.value}`;
  return MUL_LADDER[g.step].label;
}

// 'good' raises the crowd, 'neutral' leaves it, 'bad' lowers it.
export function gateMood(g) {
  if (g.kind === 'add') return g.value > 0 ? 'good' : g.value === 0 ? 'neutral' : 'bad';
  const { mul, div } = MUL_LADDER[g.step];
  return mul > 1 ? 'good' : div > 1 ? 'bad' : 'neutral';
}

// Fraction of the way to the next notch (mul gates only), for the progress pip.
export function gateProgress(g) {
  if (g.kind !== 'mul' || g.step >= MUL_SHOT_CAP) return 0;
  return g.hits / g.hitsPerStep;
}

// Predict a gate after n more hits without mutating it.
export function previewHits(g, n) {
  return hitGate({ ...g }, n);
}
