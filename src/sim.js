// Deterministic game simulation. step() advances exactly one fixed tick (DT).
// No DOM, no Math.random, no clocks: same level + same inputs = same result.
//
// Render/audio feedback is published as plain objects in state.events; the
// caller drains that array after each frame.

import {
  DT, X_MIN, X_MAX, KEY_SPEED, BULLET_SPEED, BULLET_RANGE, SPREAD_VX,
  BUFF_TIME, RAPID_MULT, ENEMY_WAKE, ENEMY_MARCH, SOLDIER_DPS, MAX_STREAMS, STREAM_EVERY,
} from './config.js';
import { applyGate, hitGate, gateLabel, gateMood } from './gates.js';
import {
  circlesOverlap, circleRectOverlap, crossed, crowdRadius, squadRadius,
  resolveContact, bossTick,
} from './combat.js';
import { statsFromUpgrades } from './save.js';

const WALL_HALF = 2.5; // wall thickness / 2 (world units)
const MAX_EVENTS = 400;

export function createRun(levelDef, upgrades = {}) {
  const stats = statsFromUpgrades(upgrades);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  return {
    level: levelDef.level,
    seed: levelDef.seed,
    speed: levelDef.speed,
    length: levelDef.length,
    t: 0,
    tick: 0,
    dist: 0,
    phase: 'run', // run | boss | won | lost
    crowd: { x: 50, count: stats.startCrowd, peak: stats.startCrowd },
    stats,
    fireCd: 0,
    buffs: { rapid: 0, spread: 0 },
    bullets: [],
    rows: clone(levelDef.rows),
    enemies: clone(levelDef.enemies),
    powerups: clone(levelDef.powerups),
    boss: { ...clone(levelDef.boss), lossAcc: 0, lastHit: -1, alive: true },
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

export function volleyStreams(count) {
  return Math.min(MAX_STREAMS, 1 + Math.floor(count / STREAM_EVERY));
}

function fire(s) {
  const c = s.crowd;
  const r = crowdRadius(c.count);
  const y = s.dist + r * 0.5;
  const dmg = s.stats.damage;
  const n = volleyStreams(c.count);
  const spacing = Math.min(3.2, r * 0.45);
  for (let i = 0; i < n; i++) {
    const x = c.x + (i - (n - 1) / 2) * spacing;
    s.bullets.push({ x, y, vx: 0, vy: BULLET_SPEED, dmg });
  }
  if (s.buffs.spread > 0) {
    s.bullets.push({ x: c.x, y, vx: -SPREAD_VX, vy: BULLET_SPEED, dmg });
    s.bullets.push({ x: c.x, y, vx: SPREAD_VX, vy: BULLET_SPEED, dmg });
  }
  emit(s, { type: 'shot' });
}

function gateAt(row, x) {
  for (const g of row.gates) if (x >= g.x0 && x <= g.x1) return g;
  return null;
}

function killEnemyUnits(s, e, dmg) {
  if (e.kind === 'squad') {
    const k = Math.min(e.count, dmg);
    e.count -= k;
    s.kills += k;
    emit(s, { type: 'enemyHit', x: e.x, y: e.y, kind: 'squad' });
    if (e.count <= 0) {
      e.alive = false;
      s.coins += Math.ceil(e.start / 3);
      emit(s, { type: 'kill', x: e.x, y: e.y, n: e.start });
    }
  } else {
    e.hp -= dmg;
    emit(s, { type: 'enemyHit', x: (e.x0 + e.x1) / 2, y: e.y, kind: 'wall' });
    if (e.hp <= 0) {
      e.alive = false;
      s.coins += Math.ceil(e.start / 4);
      emit(s, { type: 'kill', x: (e.x0 + e.x1) / 2, y: e.y, n: e.start, wall: true });
    }
  }
}

function updateBullets(s) {
  const out = [];
  const b0 = s.boss;
  for (const b of s.bullets) {
    const prevY = b.y;
    b.x += b.vx * DT;
    b.y += b.vy * DT;
    if (b.y - s.dist > BULLET_RANGE || b.x < 0 || b.x > 100) continue;

    let hit = false;
    for (const row of s.rows) {
      if (row.used || !crossed(prevY, b.y, row.y)) continue;
      const g = gateAt(row, b.x);
      if (g) {
        const before = gateMood(g);
        hitGate(g, 1);
        g.lastHit = s.t;
        emit(s, { type: 'gateHit', x: b.x, y: row.y, flipped: before !== gateMood(g), mood: gateMood(g) });
        hit = true;
        break;
      }
    }
    if (!hit) {
      for (const e of s.enemies) {
        if (!e.alive) continue;
        if (e.kind === 'squad') {
          const r = squadRadius(e.count) + 0.8;
          const dx = b.x - e.x;
          const dy = b.y - e.y;
          if (dx * dx + dy * dy < r * r) { killEnemyUnits(s, e, b.dmg); hit = true; break; }
        } else if (b.x >= e.x0 && b.x <= e.x1 && prevY < e.y + WALL_HALF && b.y >= e.y - WALL_HALF) {
          killEnemyUnits(s, e, b.dmg); hit = true; break;
        }
      }
    }
    if (!hit && b0.alive && b.y >= b0.y - b0.r && Math.abs(b.x - b0.x) < b0.r) {
      b0.hp = Math.max(0, b0.hp - b.dmg);
      b0.lastHit = s.t;
      emit(s, { type: 'bossHit', x: b.x, y: b0.y - b0.r });
      hit = true;
    }
    if (!hit) out.push(b);
  }
  s.bullets = out;
}

function loseCrowd(s, n, x, y, cause) {
  if (n <= 0) return;
  s.crowd.count = Math.max(0, s.crowd.count - n);
  emit(s, { type: 'crowdLoss', n, x, y, cause });
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

  // --- buffs
  s.buffs.rapid = Math.max(0, s.buffs.rapid - DT);
  s.buffs.spread = Math.max(0, s.buffs.spread - DT);

  const r = crowdRadius(c.count);
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
      if (e.kind === 'squad' && e.y - s.dist < ENEMY_WAKE && e.y > s.dist) e.y -= ENEMY_MARCH * DT;
      let touch;
      if (e.kind === 'squad') touch = circlesOverlap(c.x, s.dist, r, e.x, e.y, squadRadius(e.count));
      else touch = circleRectOverlap(c.x, s.dist, r * 0.85, e.x0, e.y - WALL_HALF, e.x1, e.y + WALL_HALF);
      if (touch) {
        const enemyN = e.kind === 'squad' ? e.count : e.hp;
        const res = resolveContact(c.count, enemyN);
        e.alive = false;
        loseCrowd(s, res.lost, e.kind === 'squad' ? e.x : c.x, e.y, e.kind);
        emit(s, { type: 'kill', x: e.kind === 'squad' ? e.x : (e.x0 + e.x1) / 2, y: e.y, n: res.lost, wall: e.kind === 'wall', melee: true });
      } else if (e.y < s.dist - 40) {
        e.alive = false; // passed behind the crowd
      }
    }

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
      { soldierDps: SOLDIER_DPS, bossDps: b.dps });
    b.hp = f.bossHp;
    b.lossAcc = f.lossAcc;
    if (f.crowd < before) loseCrowd(s, before - f.crowd, c.x, s.dist + r, 'boss');
    if (s.tick % 6 === 0) b.lastHit = s.t;
  }

  // --- shooting
  if (c.count > 0) {
    const rate = s.stats.fireRate * (s.buffs.rapid > 0 ? RAPID_MULT : 1);
    s.fireCd -= DT;
    while (s.fireCd <= 0) {
      fire(s);
      s.fireCd += 1 / rate;
    }
  }
  updateBullets(s);

  // --- end conditions
  if (s.boss.alive && s.boss.hp <= 0 && c.count > 0) {
    s.boss.alive = false;
    s.phase = 'won';
    const reward = 15 + 5 * s.level + Math.floor(Math.min(c.count, 300) / 6);
    s.coins += reward;
    emit(s, { type: 'won', reward, x: s.boss.x, y: s.boss.y });
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
