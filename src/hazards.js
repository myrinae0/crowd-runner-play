// Pure geometry and timing for the v2 track features (saws, crushers, bridges,
// forks, moving gates). Everything is a function of the object and the sim time,
// so the simulation, the renderer and the bot all agree on where things are.

const TAU = Math.PI * 2;

// ---- saws: a blade sliding back and forth along a rail across the road.
// h = { kind: 'saw', y, a, b, period, phase }   a..b = range of the blade centre.
export function sawX(h, t) {
  return h.a + (h.b - h.a) * (0.5 - 0.5 * Math.cos(TAU * (t / h.period + h.phase)));
}

// ---- crushers: a block over [x0, x1] that waits, slams down, rests, lifts.
// h = { kind: 'crusher', y, x0, x1, depth, period, phase }
// Cycle (fractions of the period): up 0-0.5, slam 0.5-0.56, down 0.56-0.8, lift 0.8-1.
export function crusherCycle(h, t) {
  const u = t / h.period + h.phase;
  return u - Math.floor(u);
}

// 1 = fully up, 0 = on the ground.
export function crusherLift(h, t) {
  const u = crusherCycle(h, t);
  if (u < 0.5) return 1;
  if (u < 0.56) return 1 - (u - 0.5) / 0.06;
  if (u < 0.8) return 0;
  return (u - 0.8) / 0.2;
}

export function crusherDangerous(h, t) {
  return crusherLift(h, t) < 0.3;
}

// About to slam (for the warning wobble), 0..1.
export function crusherWarn(h, t) {
  const u = crusherCycle(h, t);
  return u >= 0.32 && u < 0.5 ? (u - 0.32) / 0.18 : 0;
}

// ---- overlap helpers

// Fraction of the segment [cx - r, cx + r] that lies inside [x0, x1].
export function chordOverlapFrac(cx, r, x0, x1) {
  if (r <= 0) return cx >= x0 && cx <= x1 ? 1 : 0;
  const lo = Math.max(cx - r, x0);
  const hi = Math.min(cx + r, x1);
  return hi > lo ? (hi - lo) / (2 * r) : 0;
}

// Area of the part of a disc of radius r beyond a line at signed distance h
// from its centre (h > 0: the line is h away and the cap is on the far side).
function capArea(h, r) {
  if (h >= r) return 0;
  if (h <= -r) return Math.PI * r * r;
  return r * r * Math.acos(h / r) - h * Math.sqrt(r * r - h * h);
}

// Fraction of a disc (centre cx, radius r) that lies outside the strip [x0, x1].
export function discOutsideFrac(cx, r, x0, x1) {
  if (r <= 0) return cx >= x0 && cx <= x1 ? 0 : 1;
  const out = capArea(cx - x0, r) + capArea(x1 - cx, r);
  return Math.min(1, out / (Math.PI * r * r));
}

// ---- road segments (bridges and forks)
// segments: [{ kind: 'bridge', y0, y1, x0, x1 } | { kind: 'fork', y0, y1, d0, d1, ... }]
export function segmentAt(segments, kind, y) {
  for (const g of segments) if (g.kind === kind && y >= g.y0 && y <= g.y1) return g;
  return null;
}

// ---- moving gates
// row.move = { kind: 'slide', amp, period, phase }  the whole row slides sideways
//          | { kind: 'swap', period }               the gates trade contents every period
// Each gate keeps its base span in bx0/bx1.

export function slideOffset(move, t) {
  return move.amp * Math.sin(TAU * (t / move.period + move.phase));
}

// Number of swaps that have happened by time t (swaps happen at t = period, 2*period, ...).
export function swapCount(move, t) {
  return Math.floor(t / move.period + 1e-9);
}

// Time since the last swap (for the flip animation), or a large number before the first.
export function sinceSwap(move, t) {
  const n = swapCount(move, t);
  return n > 0 ? t - n * move.period : 99;
}

// Where gate i of a sliding row is at time t.
export function slideSpan(row, g, t) {
  const o = slideOffset(row.move, t);
  return [g.bx0 + o, g.bx1 + o];
}
