// Deterministic game simulation. step() advances exactly one fixed tick (DT).
// No DOM, no Math.random, no clocks: same level + same inputs = same result.
//
// Render/audio feedback is published as plain objects in state.events; the
// caller drains that array after each frame.

import {
  DT, X_MIN, X_MAX, KEY_SPEED, BULLET_SPEED, BULLET_RANGE, SPREAD_VX,
  BUFF_TIME, RAPID_MULT, ENEMY_WAKE, ENEMY_MARCH, SOLDIER_DPS, MAX_STREAMS, STREAM_EVERY,
  HINT_AHEAD, SAW_R, SAW_RATE, CRUSH_RATE, MIN_LOSS_RATE, FALL_RATE,
  ARROW_FLIGHT, ARROW_R, TOWER_RANGE, GAMBLE_REVEAL,
  COIN_R, MAGNET_R, ROCKET_EVERY, ROCKET_SPLASH, ROCKET_DMG,
  AMBUSH_FROM, AMBUSH_MULT, SCALE_SHARE_MIN, SCALE_SHARE_MAX, SCALE_FULL_LEVEL, SCALE_VIEW, SCALE_FREE, SQUEEZE_SHRINK, SQUEEZE_RATE, SQUEEZE_FIRE,
} from './config.js';
import {
  sawX, crusherDangerous, chordOverlapFrac, discOutsideFrac, segmentAt, slideOffset, swapCount,
} from './hazards.js';

// Gate fields that travel with a gate's value when a swapping row rotates.
const GATE_CONTENT = ['kind', 'value', 'step', 'hits', 'hitsPerStep', 'lastHit', 'hidden', 'then', 'revealed'];

const GIANT_R = 6;          // giants are one big unit
const GIANT_MARCH = 4.5;    // and slower than squads
const GIANT_CONTACT = 0.75; // touching one costs this many soldiers per HP left
const SPLIT_VX = 16;        // splitter halves peel apart this fast...
const SPLIT_T = 0.7;        // ...for this long
const BRIDGE_PULL = 45; // units/s: a crowd that misses the deck is dragged onto it
const FORK_PULL = 50;   // units/s: the divider nudges the crowd onto its side
import { applyGate, hitGate, gateLabel, gateMood, revealGamble } from './gates.js';
import {
  circlesOverlap, circleRectOverlap, crossed, crowdRadius, squadRadius,
  resolveContact, bossTick,
} from './combat.js';
import { statsFromUpgrades } from './save.js';
import { hashSeed } from './rng.js';
import {
  WEAPONS, WEAPON_UNLOCK, WEAPON_HINTS, WT, weaponStats, weaponUnlocked, meleeDamage, meleeShare, bashDamage, inArc, rectInArc,
} from './weapons.js';
import { MAX_CROWD } from './config.js';
import { WARBAND_SHARE } from './level.js';

// Boss attacks (v2): telegraph seconds, gap between attacks, share of the
// soldiers under an attack that it removes.
export const BOSS_ATK = {
  first: 1.6,
  gap: [2.7, 1.6],        // phase 1, phase 2 (below 50% HP)
  tele: [1.05, 0.8],
  boulderW: 18,
  boulderHit: 0.3,
  stompHit: 0.22,
};

const WALL_HALF = 2.5; // wall thickness / 2 (world units)
const MAX_EVENTS = 400;

export function createRun(levelDef, upgrades = {}) {
  const stats = statsFromUpgrades(upgrades);
  const ws = weaponStats(upgrades);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const hints = clone(levelDef.hints || []);
  // A weapon's unlock level opens with its hint card (early, before anything else).
  for (const w of WEAPONS) {
    if (WEAPON_HINTS[w] && levelDef.level === WEAPON_UNLOCK[w]) {
      hints.push({ y: 160, title: WEAPON_HINTS[w][0], sub: WEAPON_HINTS[w][1], shown: false, weapon: w });
    }
  }
  return {
    level: levelDef.level,
    seed: levelDef.seed,
    speed: levelDef.speed,
    length: levelDef.length,
    t: 0,
    tick: 0,
    dist: 0,
    phase: 'run', // run | boss | won | lost
    // squeeze: 0 = spread out (normal), 1 = packed tight; packed is the held input.
    crowd: { x: 50, count: stats.startCrowd, peak: stats.startCrowd, squeeze: 0, packed: false },
    stats,
    ws, // weapon numbers from the upgrades (src/weapons.js)
    // Weapon mode. cur is the selected weapon; it is armed once armT reaches 0
    // (nothing fires until then). first: the first move after a switch is
    // stronger. boost: Quick draw's boost after arming. readyT: when the
    // current weapon was armed. swing*/blood*: melee.
    // bashCd: shield bash. fortT/fortCd: Fortress. lastStand: still unused.
    weapon: {
      cur: 'rifle', armT: 0, since: -99, readyT: -99, first: false, boost: 0, swingCd: 0, swingN: 0, blood: 0, bloodT: 0,
      slash: null, bashCd: 0, fortT: 0, fortCd: 0, lastStand: ws.lastStand > 0, tuneAcc: 0,
    },
    fireCd: 0,
    buffs: { rapid: 0, spread: 0, rocket: 0, laser: 0, magnet: 0 },
    rocketCd: 0,
    coinItems: clone(levelDef.coins || []), // coins lying on the track
    bullets: [],
    rows: clone(levelDef.rows),
    enemies: clone(levelDef.enemies),
    powerups: clone(levelDef.powerups),
    hazards: clone(levelDef.hazards || []),
    segments: clone(levelDef.segments || []),
    fork: null, // { id, side: 'left' | 'right' } once the crowd enters a fork
    hints,
    loss: {}, // fractional soldier losses per cause (hazards drain gradually)
    nextId: 1000000, // ids for things spawned during the run (splitter halves)
    arrows: [], // arrows in flight from archer towers
    boss: { ...clone(levelDef.boss), lossAcc: 0, lastHit: -1, alive: true, phase2: false, nextAtk: -1, atkN: 0 },
    bossAtks: [], // live boss attacks: { kind: 'boulder' | 'stomp', x0, x1, t0, tHit, done }
    coins: 0,
    kills: 0,
    events: [],
  };
}

export function progress(s) {
  return Math.min(1, s.dist / (s.boss.y - 15));
}

function emit(s, e) {
  if (s.events.length < MAX_EVENTS) s.events.push(e);
}

export function volleyStreams(count, packed = false) {
  if (packed) return 1;
  return Math.min(MAX_STREAMS, 1 + Math.floor(count / STREAM_EVERY));
}

// The weapon that is armed right now (null while switching).
export const armedWeapon = (s) => (s.weapon.armT > 0 ? null : s.weapon.cur);
// Share of a clash / ambush the shield lets through (Block, Quick draw boost).
export const clashShare = (s) => s.ws.clash * (s.weapon.boost > 0 ? WT.boostClash : 1);

// Volleys per second right now. Pickup buffs (rapid) only work with the rifle;
// the shield fires at a fraction of the rifle's rate.
export function fireRateOf(s) {
  const arm = armedWeapon(s);
  const rifle = arm !== 'shield';
  let r = s.stats.fireRate * (s.buffs.rapid > 0 && rifle ? RAPID_MULT : 1) * (s.crowd.packed ? SQUEEZE_FIRE : 1);
  if (arm === 'shield') r *= WT.shieldFire;
  if (s.weapon.boost > 0 && arm !== 'melee') r *= WT.boostRate;
  return r;
}

// Bullets all have the same fields (one hidden class): p = enemies it can
// still hit (Pierce), rico = bounces left (Ricochet), tune = rifle shot (Gate
// tuner), seen = ids of the enemies it already went through (null until then).
const bullet = (x, y, vx, vy, dmg, laser, p, rico, tune) => ({ x, y, vx, vy, dmg, laser, p, rico, tune, seen: null, rocket: false, reflect: false });

function fire(s) {
  const c = s.crowd;
  const r = crowdR(s);
  const y = s.dist + r * 0.5;
  const rifle = armedWeapon(s) === 'rifle';
  let dmg = s.stats.damage;
  if (rifle && s.weapon.first) { dmg *= 2; s.weapon.first = false; } // first volley after a switch
  const n = volleyStreams(c.count, c.packed);
  const spacing = Math.min(3.2, r * 0.45);
  const laser = rifle && s.buffs.laser > 0; // laser shots fly through gates
  const p = rifle ? s.ws.pierce : 1;
  const rico = rifle ? s.ws.rico : 0;
  for (let i = 0; i < n; i++) {
    const x = c.x + (i - (n - 1) / 2) * spacing;
    s.bullets.push(bullet(x, y, 0, BULLET_SPEED, dmg, laser, p, rico, rifle));
  }
  if (rifle && s.buffs.spread > 0) {
    s.bullets.push(bullet(c.x, y, -SPREAD_VX, BULLET_SPEED, dmg, laser, p, rico, rifle));
    s.bullets.push(bullet(c.x, y, SPREAD_VX, BULLET_SPEED, dmg, laser, p, rico, rifle));
  }
  emit(s, { type: 'shot' });
}

function gateAt(row, x) {
  for (const g of row.gates) if (x >= g.x0 && x <= g.x1) return g;
  return null;
}

// v3: squads are sized from the crowd they're about to meet.
export function squadShare(level) {
  if (level < AMBUSH_FROM) return 0;
  const k = Math.min(1, (level - AMBUSH_FROM) / (SCALE_FULL_LEVEL - AMBUSH_FROM));
  return SCALE_SHARE_MIN + (SCALE_SHARE_MAX - SCALE_SHARE_MIN) * k;
}

// Size a squad as it comes into view: a share of the crowd right now, but never
// smaller than the level made it. Squads arriving together split that share,
// so a group adds up to about one share (four squads at once each sized off
// the whole crowd would be an unwinnable wipe). Shields grow with it.
// Deterministic: it only depends on the sim state.
export function scaledSize(s, e) {
  let group = 0;
  for (const o of s.enemies) {
    if (o.alive && o.kind === 'squad' && !o.splitChild && o.y > s.dist && o.y - s.dist < SCALE_VIEW + 60) group += 1;
  }
  const counted = Math.max(0, s.crowd.count - SCALE_FREE); // small crowds keep v2-sized squads
  // Warbands (level.js) take a bigger share and don't split it with others.
  if (e.warband) return Math.round(counted * squadShare(s.level) * WARBAND_SHARE);
  return Math.round((counted * squadShare(s.level)) / Math.max(1, group));
}

function scaleSquad(s, e) {
  e.scaled = true;
  if (e.splitChild) return;
  const want = scaledSize(s, e);
  if (want <= e.count) return;
  e.base = e.base ?? e.count;
  if (e.shield > 0) e.shield = e.shieldMax = Math.max(e.shieldMax || 0, Math.round(want * 0.7));
  e.count = want;
  e.start = want;
}

// What an enemy that gets past the crowd costs (0 before AMBUSH_FROM).
export function ambushCost(s, e) {
  if (s.level < AMBUSH_FROM) return 0;
  return AMBUSH_MULT * contactCost(e);
}

// Enemies with a centre point (squads, giants) vs flat ones (walls, towers).
export const enemyX = (e) => (e.x !== undefined ? e.x : (e.x0 + e.x1) / 2);
export const enemyRadius = (e) => (e.kind === 'giant' ? GIANT_R : squadRadius(e.count));
// How many soldiers touching it would cost.
export function contactCost(e) {
  if (e.kind === 'squad') return e.count;
  if (e.kind === 'giant') return Math.ceil(e.hp * GIANT_CONTACT);
  return e.hp;
}

// Damage an enemy. Returns how many squad units died (0 for others); check
// e.alive to see whether it was destroyed.
function killEnemyUnits(s, e, dmg) {
  if (e.kind === 'squad') {
    if (e.shield > 0) {
      // Shielded squads: the shield soaks up hits until it breaks.
      e.shield = Math.max(0, e.shield - dmg);
      e.lastHit = s.t;
      emit(s, { type: 'shieldHit', x: e.x, y: e.y - squadRadius(e.count) });
      if (e.shield === 0) emit(s, { type: 'shieldBreak', x: e.x, y: e.y });
      return 0;
    }
    const k = Math.min(e.count, dmg);
    e.count -= k;
    s.kills += k;
    emit(s, { type: 'enemyHit', x: e.x, y: e.y, kind: 'squad' });
    if (e.count <= 0) {
      e.alive = false;
      // Scaled-up squads pay their level-based coins plus a little for the extra.
      const base = e.base ?? e.start;
      s.coins += Math.ceil(base / 3) + Math.floor((e.start - base) / 30);
      emit(s, { type: 'kill', x: e.x, y: e.y, n: e.start });
    } else if (e.split && e.count >= 2) {
      // Splitters: the first hit breaks them into two squads that peel apart.
      e.split = false;
      e.wasSplit = true;
      const half = Math.floor(e.count / 2);
      e.count -= half;
      const side = e.x < 50 ? 1 : -1; // the bigger gap gets the faster one
      e.vx = -side * SPLIT_VX; e.vxT = SPLIT_T;
      s.enemies.push({ id: s.nextId++, kind: 'squad', x: e.x, y: e.y, count: half, start: half, alive: true, vx: side * SPLIT_VX, vxT: SPLIT_T, splitChild: true });
      e.start = e.count;
      emit(s, { type: 'split', x: e.x, y: e.y });
    }
    return k;
  } else if (e.kind === 'giant') {
    e.hp -= dmg;
    e.lastHit = s.t;
    emit(s, { type: 'enemyHit', x: e.x, y: e.y, kind: 'giant' });
    if (e.hp <= 0) {
      e.alive = false;
      s.kills += 1;
      s.coins += Math.ceil(e.start / 3);
      emit(s, { type: 'kill', x: e.x, y: e.y, n: 30, kind: 'giant' });
    }
  } else {
    e.hp -= dmg;
    e.lastHit = s.t;
    emit(s, { type: 'enemyHit', x: (e.x0 + e.x1) / 2, y: e.y, kind: e.kind });
    if (e.hp <= 0) {
      e.alive = false;
      s.coins += Math.ceil(e.start / (e.kind === 'tower' ? 3 : 4));
      emit(s, { type: 'kill', x: (e.x0 + e.x1) / 2, y: e.y, n: e.start, wall: true, kind: e.kind });
    }
  }
  return 0;
}

// Soldiers joining the crowd (Rally, Recruit).
function addCrowd(s, n, via, x, y) {
  if (n <= 0) return;
  const c = s.crowd;
  c.count = Math.min(MAX_CROWD, c.count + n);
  c.peak = Math.max(c.peak, c.count);
  emit(s, { type: 'join', n, via, x, y });
}

// Gate hits for one rifle shot (Gate tuner adds fractions that add up).
function tunedHits(s, b) {
  if (!b.tune) return 1;
  const w = s.weapon;
  w.tuneAcc += s.ws.tuner;
  const n = Math.floor(w.tuneAcc + 1e-9);
  w.tuneAcc -= n;
  return n;
}

// Ricochet: a bullet that killed `e` flies on to the nearest enemy ahead.
function bounce(s, b, e) {
  const ex = enemyX(e);
  let best = null, bd = s.ws.ricoR * s.ws.ricoR;
  for (const o of s.enemies) {
    if (!o.alive || o === e || o.y <= s.dist) continue;
    const dx = enemyX(o) - ex, dy = o.y - e.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bd) { bd = d2; best = o; }
  }
  if (!best) return false;
  const dx = enemyX(best) - ex, dy = best.y - e.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  b.x = ex; b.y = e.y;
  b.vx = (dx / d) * BULLET_SPEED; b.vy = (dy / d) * BULLET_SPEED;
  b.rico -= 1;
  (b.seen || (b.seen = [])).push(e.id);
  emit(s, { type: 'ricochet', x: ex, y: e.y });
  return true;
}

// Rocket blast: hurts every enemy within ROCKET_SPLASH of the impact.
function explode(s, x, y, dmg) {
  emit(s, { type: 'boom', x, y });
  for (const e of s.enemies) {
    if (!e.alive) continue;
    const ex = enemyX(e);
    const half = e.x !== undefined ? enemyRadius(e) : (e.x1 - e.x0) / 2;
    const dx = Math.max(0, Math.abs(ex - x) - half);
    const dy = Math.max(0, Math.abs(e.y - y) - (e.x !== undefined ? half : WALL_HALF));
    if (dx * dx + dy * dy <= ROCKET_SPLASH * ROCKET_SPLASH) killEnemyUnits(s, e, dmg);
  }
  const b = s.boss;
  if (b.alive && Math.abs(b.y - y) < b.r + ROCKET_SPLASH && Math.abs(b.x - x) < b.r + ROCKET_SPLASH) {
    b.hp = Math.max(0, b.hp - dmg);
    b.lastHit = s.t;
  }
}

function updateBullets(s) {
  const out = [];
  const b0 = s.boss;
  for (const b of s.bullets) {
    const prevY = b.y;
    b.x += b.vx * DT;
    b.y += b.vy * DT;
    if (b.y - s.dist > BULLET_RANGE || b.y < s.dist - 5 || b.x < 0 || b.x > 100) continue;
    if (s.segments.length && b.x > 46 && b.x < 54) {
      const fk = segmentAt(s.segments, 'fork', b.y);
      if (fk && b.x >= fk.d0 && b.x <= fk.d1) continue; // the hedge stops it
    }

    let hit = false;
    for (const row of s.rows) {
      if (b.laser) break;
      if (row.used || !crossed(prevY, b.y, row.y)) continue;
      const g = gateAt(row, b.x);
      if (g) {
        const before = gateMood(g);
        hitGate(g, tunedHits(s, b));
        g.lastHit = s.t;
        emit(s, { type: 'gateHit', x: b.x, y: row.y, flipped: before !== gateMood(g), mood: gateMood(g) });
        hit = true;
        break;
      }
    }
    let pass = false; // went through (Pierce) or bounced on (Ricochet)
    if (!hit) {
      for (const e of s.enemies) {
        if (!e.alive || (b.seen && b.seen.includes(e.id))) continue;
        let touch;
        if (e.kind === 'squad' || e.kind === 'giant') {
          const r = enemyRadius(e) + 0.8;
          const dx = b.x - e.x;
          const dy = b.y - e.y;
          touch = dx * dx + dy * dy < r * r;
        } else {
          touch = b.x >= e.x0 && b.x <= e.x1 && Math.min(prevY, b.y) < e.y + WALL_HALF && Math.max(prevY, b.y) >= e.y - WALL_HALF;
        }
        if (!touch) continue;
        if (b.rocket) { hit = true; break; }
        killEnemyUnits(s, e, b.dmg);
        if (!e.alive && b.rico > 0 && bounce(s, b, e)) { pass = true; break; }
        if (b.p > 1) { b.p -= 1; (b.seen || (b.seen = [])).push(e.id); pass = true; break; }
        hit = true; break;
      }
    }
    if (!hit && !pass && b0.alive && b.y >= b0.y - b0.r && Math.abs(b.x - b0.x) < b0.r) {
      if (!b.rocket) {
        b0.hp = Math.max(0, b0.hp - b.dmg);
        b0.lastHit = s.t;
        emit(s, { type: 'bossHit', x: b.x, y: b0.y - b0.r });
      }
      hit = true;
    }
    if (hit && b.rocket) explode(s, b.x, b.y, b.dmg);
    if (!hit) out.push(b);
  }
  s.bullets = out;
}

function loseCrowd(s, n, x, y, cause) {
  if (n <= 0) return;
  n = Math.min(n, s.crowd.count);
  s.crowd.count -= n;
  emit(s, { type: 'crowdLoss', n, x, y, cause });
}

// The crowd's radius right now (it shrinks while packed).
export function crowdR(s) {
  return crowdRadius(s.crowd.count) * (1 - SQUEEZE_SHRINK * (s.crowd.squeeze || 0));
}

// Continuous losses: `frac` of the crowd is touching something that removes
// `rate` of the touching soldiers per second (at least a few per second).
function drain(s, cause, frac, rate) {
  if (frac <= 0 || s.crowd.count <= 0) return;
  const perSec = Math.max(MIN_LOSS_RATE * Math.min(1, frac * 3), s.crowd.count * frac * rate);
  const acc = (s.loss[cause] || 0) + perSec * DT;
  const n = Math.floor(acc);
  s.loss[cause] = acc - n;
  if (n > 0) loseCrowd(s, n, s.crowd.x, s.dist, cause);
}

function updateHazards(s, r) {
  const c = s.crowd;
  for (const h of s.hazards) {
    const dy = h.y - s.dist;
    if (h.kind === 'saw') {
      if (Math.abs(dy) >= r || s.weapon.fortT > 0) continue; // Fortress: saws can't hurt
      const w = Math.sqrt(r * r - dy * dy); // half-width of the crowd at the blade's row
      const x = sawX(h, s.t);
      const frac = chordOverlapFrac(c.x, w, x - SAW_R, x + SAW_R);
      if (frac > 0) { drain(s, 'saw', frac, SAW_RATE); h.lastHit = s.t; }
    } else if (h.kind === 'crusher') {
      if (Math.abs(dy) >= r + h.depth / 2 || !crusherDangerous(h, s.t)) continue;
      const frac = chordOverlapFrac(c.x, r, h.x0, h.x1);
      if (frac > 0) { drain(s, 'crusher', frac, CRUSH_RATE); h.lastHit = s.t; }
    }
  }
}

// Fork in the road: the side the crowd's centre is on when it reaches the
// divider is the side it takes; it can't cross until the paths rejoin.
function updateFork(s, r) {
  const fk = segmentAt(s.segments, 'fork', s.dist);
  if (!fk) return;
  const c = s.crowd;
  const mid = (fk.d0 + fk.d1) / 2;
  if (!s.fork || s.fork.id !== fk.id) {
    s.fork = { id: fk.id, side: c.x < mid ? 'left' : 'right', edge: c.x };
    emit(s, { type: 'forkTaken', side: s.fork.side, risky: s.fork.side === fk.risky });
  }
  // The allowed edge starts where the crowd entered and closes in to keep most
  // of the crowd off the hedge; steering can't push past it.
  const f = s.fork;
  if (f.side === 'left') {
    const lim = fk.d0 - r * 0.7;
    f.edge = Math.max(lim, Math.min(f.edge, mid) - FORK_PULL * DT);
    c.x = Math.min(c.x, f.edge);
  } else {
    const lim = fk.d1 + r * 0.7;
    f.edge = Math.min(lim, Math.max(f.edge, mid) + FORK_PULL * DT);
    c.x = Math.max(c.x, f.edge);
  }
}

// Narrow bridge: the deck is [x0, x1]; soldiers hanging over the edge fall off.
function updateBridge(s, r) {
  const br = segmentAt(s.segments, 'bridge', s.dist);
  if (!br) return;
  const c = s.crowd;
  // The crowd's centre can't be over thin air: drag it back onto the deck.
  if (c.x < br.x0) c.x = Math.min(br.x0, c.x + BRIDGE_PULL * DT);
  else if (c.x > br.x1) c.x = Math.max(br.x1, c.x - BRIDGE_PULL * DT);
  drain(s, 'fall', discOutsideFrac(c.x, r, br.x0, br.x1), FALL_RATE);
}

// Archer towers shoot at where the crowd is now; the arrow lands where the
// crowd will be in ARROW_FLIGHT seconds if it keeps going straight. Steer away.
function updateTowers(s) {
  const c = s.crowd;
  for (const e of s.enemies) {
    if (e.kind !== 'tower' || !e.alive) continue;
    const dy = e.y - s.dist;
    if (dy < 14 || dy > TOWER_RANGE) continue;
    e.cd -= DT;
    if (e.cd > 0) continue;
    e.cd += e.period;
    const top = (e.x0 + e.x1) / 2;
    s.arrows.push({
      id: s.tick * 8 + s.arrows.length, x0: top, y0: e.y, tx: c.x, ty: s.dist + s.speed * ARROW_FLIGHT,
      t0: s.t, t1: s.t + ARROW_FLIGHT, kills: e.kills, src: e.id,
    });
    emit(s, { type: 'arrowFire', x: top, y: e.y });
  }
}

export function arrowLoss(count, base) {
  return Math.min(count, base + Math.round(count * 0.05));
}

function updateArrows(s, r) {
  if (!s.arrows.length) return;
  const c = s.crowd;
  let keep = 0;
  for (const a of s.arrows) {
    if (s.t < a.t1 - 1e-9) { s.arrows[keep++] = a; continue; }
    const hit = Math.abs(c.x - a.tx) < r * 0.9 + ARROW_R && Math.abs(s.dist - a.ty) < r + ARROW_R;
    emit(s, { type: 'arrowLand', x: a.tx, y: a.ty, hit });
    if (!hit) continue;
    // Fortress stops every arrow; a shield stops about half (decided by the
    // arrow's id, so runs stay deterministic) and Reflect sends them back.
    const fort = s.weapon.fortT > 0;
    if (fort || (armedWeapon(s) === 'shield' && hashSeed(s.seed, s.level, 'arrow', a.id) / 4294967296 < WT.arrowBlock)) {
      emit(s, { type: 'shieldBlock', x: a.tx, y: a.ty, n: 0, arrow: true, fort });
      if (s.ws.reflect > 0) reflectArrow(s, a, r);
    } else {
      // Melee has no answer at range: arrows hit it harder.
      const n = arrowLoss(c.count, a.kills);
      loseCrowd(s, armedWeapon(s) === 'melee' ? Math.min(c.count, Math.ceil(n * WT.meleeExposed)) : n, a.tx, a.ty, 'arrow');
    }
  }
  s.arrows.length = keep;
}

// Reflect: a blocked arrow flies back at its tower (through gates).
function reflectArrow(s, a, r) {
  const tw = s.enemies.find((e) => e.id === a.src && e.alive);
  if (!tw) return;
  const x0 = s.crowd.x, y0 = s.dist + r * 0.5;
  const tx = (tw.x0 + tw.x1) / 2;
  const dx = tx - x0, dy = tw.y - y0;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  const b = bullet(x0, y0, (dx / d) * BULLET_SPEED, (dy / d) * BULLET_SPEED, s.ws.reflect, true, 1, 0, false);
  b.reflect = true;
  s.bullets.push(b);
  emit(s, { type: 'reflect', x: x0, y: y0 });
}

// Moving gates: sliding rows follow slideOffset(); swapping rows rotate their
// gates' contents (value, hits, ...) one place every period.
function updateRowMotion(s) {
  for (const row of s.rows) {
    const m = row.move;
    if (!m || row.used || row.y - s.dist > 400) continue;
    if (m.kind === 'slide') {
      const o = slideOffset(m, s.t);
      for (const g of row.gates) { g.x0 = g.bx0 + o; g.x1 = g.bx1 + o; }
    } else if (m.kind === 'swap') {
      const n = swapCount(m, s.t);
      while ((row.swaps || 0) < n) {
        rotateContents(row.gates);
        row.swaps = (row.swaps || 0) + 1;
        if (row.y - s.dist < 200) emit(s, { type: 'gateSwap', y: row.y });
      }
    }
  }
}

// "?" gates reveal what they are when the crowd gets close.
function updateGambles(s) {
  for (const row of s.rows) {
    if (row.used || row.y - s.dist > GAMBLE_REVEAL) continue;
    for (const g of row.gates) {
      if (g.kind !== 'gamble') continue;
      revealGamble(g);
      emit(s, { type: 'gambleReveal', x: (g.x0 + g.x1) / 2, y: row.y, label: gateLabel(g), mood: gateMood(g) });
    }
  }
}

function rotateContents(gates) {
  const contents = gates.map((g) => {
    const o = {};
    for (const k of GATE_CONTENT) if (k in g) { o[k] = g[k]; delete g[k]; }
    return o;
  });
  gates.forEach((g, i) => Object.assign(g, contents[(i + gates.length - 1) % gates.length]));
}

// Boss attacks: boulders thrown down a lane and stomps that shake one side of
// the road. Each is telegraphed on the ground first; steer out of it.
// Choices come from a hash of (seed, level, attack number): no Math.random.
function updateBossAttacks(s, r) {
  const b = s.boss;
  if (!b.attacks || !b.alive) return;
  const c = s.crowd;
  if (!b.phase2 && b.hp < b.maxHp * 0.5) {
    b.phase2 = true;
    emit(s, { type: 'bossPhase2' });
  }
  const ph = b.phase2 ? 1 : 0;
  if (b.nextAtk < 0) b.nextAtk = s.t + BOSS_ATK.first;
  if (s.t >= b.nextAtk) {
    const roll = hashSeed(s.seed, s.level, 'atk', b.atkN) / 4294967296;
    const roll2 = hashSeed(s.seed, s.level, 'atk2', b.atkN) / 4294967296;
    b.atkN += 1;
    const tHit = s.t + BOSS_ATK.tele[ph];
    const add = (kind, x0, x1) => s.bossAtks.push({ kind, x0, x1, t0: s.t, tHit, done: false });
    if (roll < 0.6) {
      const w = BOSS_ATK.boulderW;
      const x = Math.max(8 + w / 2 - 8, Math.min(92 - w / 2 + 8, c.x));
      add('boulder', x - w / 2, x + w / 2);
      if (b.phase2) {
        // A second boulder in another lane, so there are fewer safe spots.
        const x2 = x < 50 ? Math.min(92, x + 30 + roll2 * 20) : Math.max(8, x - 30 - roll2 * 20);
        add('boulder', x2 - w / 2, x2 + w / 2);
      }
    } else if (c.x < 50) add('stomp', 0, 54);
    else add('stomp', 46, 100);
    emit(s, { type: 'bossWindup', kind: s.bossAtks[s.bossAtks.length - 1].kind });
    for (const h of s.hints) if (h.atBoss && !h.shown) { h.shown = true; emit(s, { type: 'hint', title: h.title, sub: h.sub }); }
    b.nextAtk = s.t + BOSS_ATK.gap[ph];
  }
  let keep = 0;
  for (const a of s.bossAtks) {
    if (!a.done && s.t >= a.tHit) {
      a.done = true;
      const frac = chordOverlapFrac(c.x, r, a.x0, a.x1);
      const share = a.kind === 'boulder' ? BOSS_ATK.boulderHit : BOSS_ATK.stompHit;
      emit(s, { type: a.kind === 'boulder' ? 'boulderLand' : 'bossSlam', x: (a.x0 + a.x1) / 2, y: s.dist, hit: frac > 0 });
      const guard = armedWeapon(s) === 'shield' ? WT.bossGuard : 1;
      if (frac > 0) loseCrowd(s, Math.max(2, Math.ceil(c.count * frac * share * guard)), c.x, s.dist, a.kind);
    }
    if (s.t < a.tHit + 0.8) s.bossAtks[keep++] = a; // kept a moment for the animation
  }
  s.bossAtks.length = keep;
}

// Coins on the track: walk over them (+1 each). The magnet pulls nearby ones in.
function updateCoins(s, r) {
  const c = s.crowd;
  // Pull radius: the magnet pickup, or the Coin magnet upgrade's (smaller).
  const R = Math.max(s.buffs.magnet > 0 ? MAGNET_R : 0, s.ws.magnetR);
  for (const k of s.coinItems) {
    if (k.taken) continue;
    const dy = k.y - s.dist;
    if (dy > MAGNET_R + 5) break; // coins are sorted by y
    if (dy < -r - 10) continue;
    let dx = k.x - c.x;
    if (R > 0 && dx * dx + dy * dy < R * R) {
      // Fly toward the crowd (pulled = drawn as flying).
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const v = Math.min(d, 110 * DT);
      k.x -= (dx / d) * v;
      k.y -= (dy / d) * v;
      k.pulled = true;
      dx = k.x - c.x;
    }
    const ddy = k.y - s.dist;
    if (dx * dx + ddy * ddy < (r + COIN_R) * (r + COIN_R)) {
      k.taken = true;
      s.coins += 1;
      s.coinsPicked = (s.coinsPicked || 0) + 1;
      emit(s, { type: 'coin', x: k.x, y: k.y });
    }
  }
}

function updateHints(s) {
  for (const h of s.hints) {
    if (h.shown || h.atBoss || h.y - s.dist > HINT_AHEAD) continue;
    h.shown = true;
    emit(s, { type: 'hint', title: h.title, sub: h.sub });
  }
}

// ---- weapon modes --------------------------------------------------------
// Switching: the requested weapon is selected at once and armed after
// ws.switchTime. Switching never steers or squeezes.
function updateWeapon(s, want, squeezeOn) {
  const w = s.weapon, ws = s.ws;
  if (want && want !== w.cur && WEAPONS.includes(want) && weaponUnlocked(s.level, want)) {
    w.cur = want;
    w.armT = ws.switchTime;
    w.since = s.t;
    w.boost = 0;
    w.first = false;
    emit(s, { type: 'weaponSwitch', w: want });
  }
  if (w.armT > 0) {
    w.armT = Math.max(0, w.armT - DT);
    if (w.armT === 0) {
      w.first = true; // the first move after a switch is stronger
      w.readyT = s.t;
      w.boost = ws.boostTime;
      w.swingCd = 0;
      emit(s, { type: 'weaponReady', w: w.cur, boost: ws.boostTime > 0 });
    }
  } else if (w.boost > 0) {
    w.boost = Math.max(0, w.boost - DT);
  }
  if (w.fortT > 0) w.fortT = Math.max(0, w.fortT - DT);
  if (w.fortCd > 0) w.fortCd = Math.max(0, w.fortCd - DT);
  // Fortress: squeezing with the shield up makes the crowd immune to saws and
  // arrows for a moment (then it needs to recharge).
  if (squeezeOn && ws.fortress > 0 && w.fortCd <= 0 && armedWeapon(s) === 'shield') {
    w.fortT = ws.fortressT;
    w.fortCd = ws.fortressCd;
    emit(s, { type: 'fortress', t: ws.fortressT });
  }
}

// Melee: while melee is armed the crowd swings on a steady rhythm (one swing
// per cooldown), whether or not anything is in reach. A swing hits every
// enemy in the arc (and the boss) for meleeDamage(crowd) x meleeShare(e)
// (heavy vs giants and walls, light vs ordinary squads); one that hits
// nothing is just a whoosh. The lunge (double reach) after a switch is held
// for the first swing with a target in reach, or LUNGE_HOLD s after arming.
const MELEE_SLACK = 8;
export const LUNGE_HOLD = 3;
function slashHits(s, e, r, reach, half, full) {
  if (e.x !== undefined) return inArc(s.crowd.x, s.dist, r, reach, half, full, e.x, e.y, enemyRadius(e));
  return rectInArc(s.crowd.x, s.dist, r, reach, half, full, e.x0, e.x1, e.y, WALL_HALF);
}
// Seconds to the next swing: Swing speed, Bloodlust stacks, Quick draw boost.
// Never faster than WT.meleeMinCd, however they stack.
const swingCdOf = (w, ws) => Math.max(WT.meleeMinCd, (ws.meleeCd / (1 + ws.blood * w.blood)) * (w.boost > 0 ? WT.boostSwing : 1));
function updateMelee(s, r) {
  const w = s.weapon, ws = s.ws, c = s.crowd;
  if (w.bloodT > 0) { w.bloodT -= DT; if (w.bloodT <= 0) w.blood = 0; }
  w.swingCd -= DT;
  if (w.swingCd > 1e-9) return; // exactly one swing per cooldown
  if (w.first && s.t - w.readyT >= LUNGE_HOLD) w.first = false; // the held lunge lapses
  const whirl = ws.whirlEvery > 0 && (w.swingN + 1) % ws.whirlEvery === 0;
  const reach = ws.reach * (w.first ? 2 : 1);
  const half = ws.arcHalf;
  const far = r + reach + MELEE_SLACK + 6;
  // One pass: is anything in reach? (An empty swing stops here.)
  let any = false;
  for (const e of s.enemies) {
    if (!e.alive || Math.abs(e.y - s.dist) > far) continue;
    if (slashHits(s, e, r, reach, half, whirl)) { any = true; break; }
  }
  const b = s.boss;
  const bossIn = b.alive && b.y - b.r - s.dist <= r + reach;
  if (!any && !bossIn) {
    // Empty swing: the arc and a light whoosh; no damage, no Bloodlust change,
    // and the lunge (if any) stays held. It still counts toward Whirlwind.
    w.swingCd = swingCdOf(w, ws);
    w.swingN += 1;
    w.slash = { t: s.t, whirl, reach: ws.reach, half, lunge: false, x: c.x };
    emit(s, { type: 'whoosh', x: c.x, y: s.dist + r, whirl });
    return;
  }
  const dmg = meleeDamage(c.count);
  let kills = 0, units = 0, hits = 0;
  // (s.enemies.length is read each time: splitter halves this slash makes are hit too)
  for (let i = 0; i < s.enemies.length; i++) {
    const e = s.enemies[i];
    if (!e.alive || Math.abs(e.y - s.dist) > far || !slashHits(s, e, r, reach, half, whirl)) continue;
    hits += 1;
    const big = e.kind === 'giant' || e.kind === 'wall';
    const k = killEnemyUnits(s, e, Math.round(dmg * (big ? ws.bigHit : meleeShare(e)))); // light vs ordinary squads
    if (e.kind === 'squad') units += k;
    if (!e.alive) kills += 1;
  }
  if (bossIn) {
    hits += 1;
    b.hp = Math.max(0, b.hp - dmg * ws.slayer);
    b.lastHit = s.t;
    emit(s, { type: 'bossHit', x: c.x, y: b.y - b.r });
  }
  if (ws.recruit > 0) addCrowd(s, Math.floor(units * ws.recruit), 'recruit', c.x, s.dist + r);
  if (kills > 0) { w.blood = Math.min(WT.bloodMax, w.blood + kills); w.bloodT = WT.bloodReset; } else w.blood = 0;
  w.swingCd = swingCdOf(w, ws);
  w.swingN += 1;
  w.slash = { t: s.t, whirl, reach, half, lunge: w.first, x: c.x };
  emit(s, { type: 'slash', x: c.x, y: s.dist + r, whirl, lunge: w.first, hits });
  w.first = false;
}

// Bash (shield upgrade): shove the squad or giant about to hit the crowd back,
// stun it and knock a few out.
function updateBash(s, r) {
  const w = s.weapon, ws = s.ws, c = s.crowd;
  if (w.bashCd > 0) { w.bashCd -= DT; return; }
  let best = null;
  for (const e of s.enemies) {
    if (!e.alive || e.x === undefined) continue;
    const er = enemyRadius(e);
    const dy = e.y - s.dist;
    if (dy <= 0 || dy > r + er + 6 || Math.abs(e.x - c.x) >= r + er) continue;
    if (!best || e.y < best.y) best = e;
  }
  if (!best) return;
  best.y += WT.bashPush;
  best.stun = ws.bashStun;
  killEnemyUnits(s, best, bashDamage(c.count, ws.bash));
  w.bashCd = ws.bashEvery;
  emit(s, { type: 'bash', x: best.x, y: best.y });
}

export function step(s, input = {}) {
  if (s.phase !== 'run' && s.phase !== 'boss') return s;
  if (s.events.length > MAX_EVENTS) s.events.length = 0;
  s.tick += 1;
  s.t = s.tick * DT;
  const c = s.crowd;

  // --- steering
  const dx = (input.dx || 0) + (input.axis || 0) * KEY_SPEED * DT;
  c.x = Math.min(X_MAX, Math.max(X_MIN, c.x + dx));
  if (s.phase === 'run') updateFork(s, crowdR(s));

  updateRowMotion(s);
  updateGambles(s);

  // --- squeeze (hold to pack the crowd tight)
  const packed = !!input.squeeze;
  const squeezeOn = packed && !c.packed;
  if (packed !== c.packed) {
    c.packed = packed;
    emit(s, { type: 'squeeze', on: packed });
  }
  const sq = packed ? 1 : 0;
  c.squeeze += Math.max(-SQUEEZE_RATE * DT, Math.min(SQUEEZE_RATE * DT, sq - c.squeeze));

  // --- weapon switching
  updateWeapon(s, input.weapon, squeezeOn);

  // --- buffs
  for (const k in s.buffs) s.buffs[k] = Math.max(0, s.buffs[k] - DT);

  const r = crowdR(s);
  const prevDist = s.dist;

  if (s.phase === 'run') {
    s.dist += s.speed * DT;
    // Stop at the boss and start the fight.
    const stopAt = s.boss.y - r * 0.75 - 3; // crowd front presses against the boss
    if (s.dist >= stopAt) {
      s.dist = stopAt;
      s.phase = 'boss';
      emit(s, { type: 'bossStart' });
    }

    updateHints(s);

    // Gates
    for (const row of s.rows) {
      if (row.used || !crossed(prevDist, s.dist, row.y)) continue;
      row.used = true;
      const g = gateAt(row, c.x);
      if (g) {
        const before = c.count;
        c.count = applyGate(c.count, g);
        c.peak = Math.max(c.peak, c.count);
        emit(s, { type: 'gate', x: c.x, y: row.y, label: gateLabel(g), mood: gateMood(g), before, after: c.count });
      }
    }

    // Enemies march and collide
    for (const e of s.enemies) {
      if (!e.alive) continue;
      const round = e.kind === 'squad' || e.kind === 'giant';
      if (e.kind === 'squad' && !e.scaled && e.y - s.dist < SCALE_VIEW && s.level >= AMBUSH_FROM) scaleSquad(s, e);
      if (e.stun > 0) e.stun -= DT; // bashed: stands still for a moment
      else if (round && e.y - s.dist < ENEMY_WAKE && e.y > s.dist
        && !segmentAt(s.segments, 'bridge', e.y - 1)) { // squads don't wade into the water
        e.y -= (e.kind === 'giant' ? GIANT_MARCH : ENEMY_MARCH) * DT;
      }
      if (e.vxT > 0) {
        e.vxT -= DT;
        e.x = Math.min(96, Math.max(4, e.x + e.vx * DT));
      }
      let touch;
      if (round) touch = circlesOverlap(c.x, s.dist, r, e.x, e.y, enemyRadius(e));
      else touch = circleRectOverlap(c.x, s.dist, r * 0.85, e.x0, e.y - WALL_HALF, e.x1, e.y + WALL_HALF);
      if (touch) {
        const cost = contactCost(e);
        let price = cost, joined = 0;
        if (armedWeapon(s) === 'shield') {
          // The shield takes most of the clash; the first one after a switch is free.
          price = s.weapon.first ? 0 : Math.ceil(cost * clashShare(s));
          s.weapon.first = false;
          emit(s, { type: 'shieldBlock', x: enemyX(e), y: e.y, n: cost - price });
          if (e.kind === 'squad') joined = Math.floor((cost - price) * s.ws.rally); // Rally
        }
        const res = resolveContact(c.count, price);
        e.alive = false;
        loseCrowd(s, res.lost, round ? e.x : c.x, e.y, e.kind);
        emit(s, { type: 'kill', x: enemyX(e), y: e.y, n: res.lost, wall: !round, kind: e.kind, melee: true });
        if (joined > 0 && c.count > 0) addCrowd(s, joined, 'rally', enemyX(e), e.y);
      } else if (round && e.y < s.dist - r - enemyRadius(e)) {
        // Got past the crowd alive: it hits from behind, twice as hard
        // (a raised shield halves that too).
        e.alive = false;
        const amb = ambushCost(s, e);
        const arm = armedWeapon(s);
        const n = Math.min(c.count, arm === 'shield' ? Math.ceil(amb * clashShare(s)) : arm === 'melee' ? Math.ceil(amb * WT.meleeExposed) : amb);
        if (n > 0) {
          emit(s, { type: 'ambush', n, x: e.x, y: e.y, kind: e.kind });
          loseCrowd(s, n, e.x, s.dist, 'ambush');
        }
      } else if (e.y < s.dist - 40) {
        e.alive = false; // walls and towers just stay behind
      }
    }

    updateHazards(s, r);
    updateBridge(s, r);
    updateTowers(s);

    updateCoins(s, r);

    // Power-ups
    for (const p of s.powerups) {
      if (p.taken) continue;
      if (circlesOverlap(c.x, s.dist, r, p.x, p.y, 4)) {
        p.taken = true;
        s.buffs[p.kind] = BUFF_TIME;
        emit(s, { type: 'powerup', kind: p.kind, x: p.x, y: p.y });
      }
    }
  } else {
    // --- boss melee
    const b = s.boss;
    const before = c.count;
    const f = bossTick({ crowd: c.count, bossHp: b.hp, lossAcc: b.lossAcc }, DT,
      { soldierDps: SOLDIER_DPS, bossDps: b.dps * (armedWeapon(s) === 'shield' ? WT.bossGuard : 1), maxFighters: b.fighters });
    b.hp = f.bossHp;
    b.lossAcc = f.lossAcc;
    if (f.crowd < before) loseCrowd(s, before - f.crowd, c.x, s.dist + r, 'boss');
    updateBossAttacks(s, r);
    if (s.tick % 6 === 0) b.lastHit = s.t;
  }

  updateArrows(s, crowdR(s));

  // --- shooting (rifle, or the shield's slow fire), slashing, bashing
  const arm = armedWeapon(s);
  if (c.count > 0 && (arm === 'rifle' || arm === 'shield')) {
    const rate = fireRateOf(s);
    s.fireCd -= DT;
    while (s.fireCd <= 0) {
      fire(s);
      s.fireCd += 1 / rate;
    }
  } else {
    s.fireCd = Math.max(0, s.fireCd - DT); // fires as soon as a gun is armed
  }
  if (c.count > 0 && arm === 'rifle' && s.buffs.rocket > 0) {
    s.rocketCd -= DT;
    if (s.rocketCd <= 0) {
      s.rocketCd += ROCKET_EVERY;
      const rk = bullet(c.x, s.dist + crowdR(s) * 0.5, 0, BULLET_SPEED * 0.75, s.stats.damage * ROCKET_DMG, false, 1, 0, false);
      rk.rocket = true;
      s.bullets.push(rk);
      emit(s, { type: 'rocket' });
    }
  } else {
    s.rocketCd = 0;
  }
  if (c.count > 0 && arm === 'melee') updateMelee(s, crowdR(s));
  if (c.count > 0 && arm === 'shield' && s.ws.bash > 0) updateBash(s, crowdR(s));
  updateBullets(s);

  // --- end conditions
  if (s.boss.alive && s.boss.hp <= 0 && c.count > 0) {
    s.boss.alive = false;
    s.phase = 'won';
    const reward = 15 + 5 * s.level + Math.floor(Math.min(c.count, 300) / 6);
    s.coins += reward;
    emit(s, { type: 'won', reward, x: s.boss.x, y: s.boss.y });
  } else if (c.count <= 0 && s.weapon.lastStand) {
    // Last stand: once a run, a wipeout leaves a few soldiers standing.
    s.weapon.lastStand = false;
    c.count = s.ws.lastStand;
    emit(s, { type: 'lastStand', n: c.count, x: c.x, y: s.dist });
  } else if (c.count <= 0) {
    s.phase = 'lost';
    emit(s, { type: 'lost' });
  }
  return s;
}

export function runFor(s, seconds, inputFn) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n && (s.phase === 'run' || s.phase === 'boss'); i++) {
    step(s, inputFn ? inputFn(s) : {});
  }
  return s;
}
