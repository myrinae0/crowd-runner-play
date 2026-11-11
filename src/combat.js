// Collision helpers and fight resolution. Pure functions.

export function circlesOverlap(ax, ay, ar, bx, by, br) {
  const dx = ax - bx;
  const dy = ay - by;
  const r = ar + br;
  return dx * dx + dy * dy < r * r;
}

// Circle vs axis-aligned rectangle [x0,x1] x [y0,y1].
export function circleRectOverlap(cx, cy, r, x0, y0, x1, y1) {
  const nx = Math.max(x0, Math.min(cx, x1));
  const ny = Math.max(y0, Math.min(cy, y1));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

// Did something moving from prevY to y cross the line at rowY this step?
export function crossed(prevY, y, rowY) {
  return prevY < rowY && y >= rowY;
}

// Crowd radius (world units) for a given count. Grows with sqrt, capped at the render cap.
export function crowdRadius(count) {
  return 2.5 + 1.15 * Math.sqrt(Math.min(Math.max(count, 1), 150));
}

export function squadRadius(count) {
  return 1.8 + 1.05 * Math.sqrt(Math.min(Math.max(count, 1), 80));
}

// Crowd touches an enemy group: both sides lose units 1:1.
export function resolveContact(crowd, enemy) {
  const lost = Math.min(crowd, enemy);
  return { crowd: crowd - lost, enemy: enemy - lost, lost };
}

// One tick of the boss melee.
// f = { crowd, bossHp, lossAcc }  p = { soldierDps, bossDps, maxFighters? }
// The crowd deals crowd * soldierDps damage per second; the boss removes
// bossDps soldiers per second (fractions accumulate in lossAcc).
export function bossTick(f, dt, p) {
  const out = { ...f };
  if (out.crowd <= 0 || out.bossHp <= 0) return out;
  // Only so many soldiers can reach the boss at once (p.maxFighters, v2 bosses).
  const fighters = Math.min(out.crowd, p.maxFighters ?? Infinity);
  out.bossHp = Math.max(0, out.bossHp - fighters * p.soldierDps * dt);
  out.lossAcc += p.bossDps * dt;
  const lost = Math.floor(out.lossAcc + 1e-9); // epsilon: 60 x (6/60) must be exactly 6
  out.lossAcc = Math.max(0, out.lossAcc - lost);
  out.crowd = Math.max(0, out.crowd - lost);
  return out;
}

// Run a melee to the end (no bullets). Used by tests and the bot's estimates.
export function simulateBossFight(crowd, bossHp, p, dt = 1 / 60, maxT = 120) {
  let f = { crowd, bossHp, lossAcc: 0 };
  let t = 0;
  while (f.crowd > 0 && f.bossHp > 0 && t < maxT) {
    f = bossTick(f, dt, p);
    t += dt;
  }
  return { win: f.bossHp <= 0 && f.crowd > 0, crowd: f.crowd, bossHp: f.bossHp, t };
}
