// Weapon modes (rifle, shield, melee) and what each upgrade level does.
// Pure: the sim, the bot, the renderer and the shop all read these numbers.
//
//   rifle   today's gun. The only mode that raises gates well. Power-up
//           pickups (rapid, spread, rocket, laser) only fire with the rifle;
//           their timers keep running in the other modes. Magnet works in all.
//   shield  fires at SHIELD_FIRE of the rifle's rate. Head-on clashes and
//           ambushes cost `clash` (about half) of what they would; blocks
//           about half the arrows; the boss bites less.
//   melee   no bullets. Slashes an arc just ahead of the crowd about once a
//           second when something is in reach, for a lot of damage. Can't
//           touch gates or anything out of reach.
//
// Switching takes `switchTime` seconds; nothing fires (and the shield doesn't
// block) until the new weapon is armed. The first move after a switch is
// stronger: the rifle's first volley does double damage, the shield's first
// clash costs nothing, and melee's first slash lunges twice as far.

export const WEAPONS = ['rifle', 'shield', 'melee'];
export const WEAPON_UNLOCK = { rifle: 1, shield: 3, melee: 5 };
export const weaponUnlocked = (level, w) => level >= WEAPON_UNLOCK[w];

// Shown once at the start of the level that unlocks the weapon.
export const WEAPON_HINTS = {
  shield: ['SHIELD UNLOCKED!', 'Tap the shield (or 2). Clashes cost half. Slow fire'],
  melee: ['MELEE UNLOCKED!', 'Tap the sword (or 3). Slash squads, giants, walls'],
};

// Tunables (see BALANCE.md for how they were picked).
export const WT = {
  switchTime: 1.0,     // seconds to arm a new weapon
  quickStep: 0.15,     // Quick draw: seconds off the switch per level
  boostTime: 2.0,      // Quick draw: seconds of boost after arming (level 1+)
  boostRate: 1.5,      // boost: rifle / shield fire-rate multiplier
  boostClash: 0.6,     // boost: shield clash losses multiplier
  boostSwing: 0.6,     // boost: melee cooldown multiplier
  shieldFire: 0.3,     // shield fire rate vs the rifle's
  shieldClash: 0.5,    // share of a clash (and of an ambush) the shield lets through
  blockStep: 0.05,     // Block: clash share off per level
  arrowBlock: 0.5,     // share of arrow hits the shield stops
  bossGuard: 0.6,      // boss bites and attacks cost this much behind a shield
  bashEvery: 2.6, bashEveryStep: 0.3, bashPush: 9, bashStun: 0.8, bashStunStep: 0.25, bashDmg: 4, bashDmgStep: 5,
  reflectDmg: 12,      // Reflect: tower damage per level for each blocked arrow
  rallyStep: 0.07,     // Rally: share of the blocked enemies that join, per level
  fortressT: 1.2, fortressTStep: 0.4, fortressCd: 9, fortressCdStep: 1,
  meleeCd: 1.0,        // seconds between slashes
  swingStep: 0.14,     // Swing speed: +14% slashes per level
  reach: 12,           // slash reach beyond the crowd's edge (world units)
  reachStep: 1.5,
  arcHalf: 55,         // half-angle of the slash (degrees)
  arcStep: 9,
  meleeBase: 6, meleeK: 7, // slash damage = base + k * sqrt(crowd)
  meleeBig: 2,         // slashes do double damage to giants and walls (heavy blows)
  meleeCap: 4000,
  bloodStep: 0.12,     // Bloodlust: +12% swing speed per stacked kill per level...
  bloodMax: 5,         // ...up to this many stacks
  bloodReset: 2.5,     // stacks drop after this long without a kill
  recruitStep: 0.06,   // Recruit: share of slashed squad units that join, per level
  whirlEvery: [0, 4, 3, 2], // Whirlwind level -> every Nth slash is a full circle
  slayerStep: 0.6,     // Giant slayer: x(1 + this * level) more vs giants, walls, boss
  ricoR: 26, ricoRStep: 6, // Ricochet: how far a bounce can reach
  tunerStep: 0.3,      // Gate tuner: +0.3 gate hits per shot per level
  magnetR: 6, magnetStep: 7, // Coin magnet: pull radius
  lastStand: 10,       // Last stand: soldiers left per level
};

// Everything the upgrades change, in one object (computed once per run).
export function weaponStats(u = {}) {
  const L = (k) => Math.max(0, u[k] | 0);
  const quick = L('quick');
  return {
    switchTime: Math.max(0.3, WT.switchTime - WT.quickStep * quick),
    boostTime: quick > 0 ? WT.boostTime : 0,
    clash: Math.max(0.15, WT.shieldClash - WT.blockStep * L('block')),
    bash: L('bash'),
    bashEvery: WT.bashEvery - WT.bashEveryStep * L('bash'),
    bashStun: WT.bashStun + WT.bashStunStep * L('bash'),
    bashDmg: WT.bashDmg + WT.bashDmgStep * L('bash'),
    reflect: L('reflect') * WT.reflectDmg,
    rally: WT.rallyStep * L('rally'),
    fortress: L('fortress'),
    fortressT: WT.fortressT + WT.fortressTStep * L('fortress'),
    fortressCd: WT.fortressCd - WT.fortressCdStep * L('fortress'),
    meleeCd: WT.meleeCd / (1 + WT.swingStep * L('swing')),
    reach: WT.reach + WT.reachStep * L('arc'),
    arcHalf: ((WT.arcHalf + WT.arcStep * L('arc')) * Math.PI) / 180,
    blood: WT.bloodStep * L('blood'),
    recruit: WT.recruitStep * L('recruit'),
    whirlEvery: WT.whirlEvery[Math.min(3, L('whirl'))],
    slayer: 1 + WT.slayerStep * L('slayer'), // vs the boss; giants and walls also get meleeBig
    bigHit: WT.meleeBig * (1 + WT.slayerStep * L('slayer')),
    pierce: 1 + L('pierce'),            // enemies one bullet can hit
    rico: L('rico'),                    // bounces after a kill
    ricoR: WT.ricoR + WT.ricoRStep * L('rico'),
    tuner: 1 + WT.tunerStep * L('tuner'), // gate hits per shot
    magnetR: L('magnet') > 0 ? WT.magnetR + WT.magnetStep * L('magnet') : 0,
    lastStand: WT.lastStand * L('last'),
  };
}

// Slash damage for a crowd of `count` (applied to every target in the arc).
export function meleeDamage(count) {
  return Math.round(WT.meleeBase + WT.meleeK * Math.sqrt(Math.min(Math.max(count, 0), WT.meleeCap)));
}

// Is a round target (centre ex, ey, radius er) inside a slash from a crowd at
// (cx, cy) with radius r? `reach` is how far past the crowd's edge it goes,
// `half` the half-angle (radians) around straight ahead (+y); full = a circle.
// Anything already touching the crowd is always hit.
export function inArc(cx, cy, r, reach, half, full, ex, ey, er) {
  const dx = ex - cx, dy = ey - cy;
  const lim = r + reach + er;
  const d2 = dx * dx + dy * dy;
  if (d2 > lim * lim) return false;
  if (full) return true;
  const d = Math.sqrt(d2);
  if (d <= r + er) return true;
  // Angle off straight ahead, widened by the target's own angular size.
  const ang = Math.atan2(Math.abs(dx), dy);
  return ang <= half + Math.asin(Math.min(1, er / d));
}

// The same for a flat target (wall / tower: x0..x1 at y, half-thickness hy).
export function rectInArc(cx, cy, r, reach, half, full, x0, x1, y, hy) {
  const nx = Math.max(x0, Math.min(cx, x1));
  const ny = Math.max(y - hy, Math.min(cy, y + hy));
  return inArc(cx, cy, r, reach, half, full, nx, ny, 0);
}

// Which weapon to request for a key / button index (0, 1, 2).
export const weaponForIndex = (i) => WEAPONS[i] || null;
