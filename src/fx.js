// Visual-only effects (particles, floating text, screen shake) driven by sim events.
// Uses Math.random freely: none of this feeds back into the simulation.

import { COLORS } from './render.js';

const MAX_PARTICLES = 260;
const POWER_TEXT = {
  rapid: ['RAPID FIRE!', '#ffb347'],
  spread: ['SPREAD SHOT!', '#c99bff'],
  rocket: ['ROCKETS!', '#ff8a7a'],
  laser: ['LASER! Shoots through gates', '#8ff0ff'],
  magnet: ['MAGNET!', '#ff9ad5'],
};
const WEAPON_TEXT = { rifle: ['RIFLE', '#ffe066'], shield: ['SHIELD', '#c0dcff'], melee: ['MELEE', '#ffb3a8'] };
// Losses that drip in over time (hazards); their "−N" texts are merged.
const DRAINS = new Set(['saw', 'crusher', 'fall']);

export function createFx() {
  const fx = { particles: [], texts: [], shake: 0, hint: null, flash: 0 }; // flash: red screen-edge glow (s)
  const lossTexts = {};
  const coinRun = { n: 0, text: null }; // "+N" for a run of coins // cause -> live "−N" text, so steady drains show one growing number

  function burst(x, y, n, color, speed = 18, size = 1.1) {
    for (let i = 0; i < n && fx.particles.length < MAX_PARTICLES; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.8);
      const life = 0.35 + Math.random() * 0.35;
      fx.particles.push({
        x, y, z: 2, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 10 + Math.random() * 18,
        life, max: life, color, size: size * (0.6 + Math.random() * 0.8),
      });
    }
  }

  function text(t, x, y, color, size = 26, life = 0.9) {
    const o = { text: t, x, y, color, size, life, max: life };
    fx.texts.push(o);
    if (fx.texts.length > 12) fx.texts.shift();
    return o;
  }

  function screenText(t, color, size = 42, sy = 0.4, life = 1.4) {
    // Stack below any banner still showing, so two at once stay readable.
    while (fx.texts.some((o) => o.screen && o.life > 0.3 && Math.abs(o.sy - sy) < 0.045)) sy += 0.06;
    fx.texts.push({ text: t, color, size, life, max: life, screen: true, sy, x: 0, y: 0 });
  }

  fx.consume = (events, state) => {
    for (const e of events) {
      switch (e.type) {
        case 'gate': {
          const col = e.mood === 'good' ? '#7fdcff' : e.mood === 'bad' ? '#ff6b6b' : '#e3e7ec';
          text(e.label, e.x, e.y + 4, col, 34, 1.0);
          burst(e.x, state.dist + 6, 14, col, 22);
          break;
        }
        case 'gateHit':
          burst(e.x, e.y, 2, e.flipped ? '#ffffff' : COLORS.bullet, 10, 0.7);
          if (e.flipped) text(e.mood === 'good' ? 'FLIP!' : '', e.x, e.y, '#fff', 20, 0.6);
          break;
        case 'enemyHit':
          burst(e.x, e.y, 2, COLORS.enemy, 12, 0.8);
          break;
        case 'kill':
          burst(e.x, e.y, Math.min(24, 6 + e.n), e.wall ? '#c9534c' : COLORS.enemy, 26, 1.3);
          break;
        case 'crowdLoss': {
          const drainy = DRAINS.has(e.cause);
          fx.shake = Math.min(drainy ? 6 : 14, fx.shake + (drainy ? 1 : 3) + Math.min(8, e.n * 0.25));
          if (e.cause !== 'boss' && e.cause !== 'ambush') {
            const live = lossTexts[e.cause];
            if (drainy && live && live.life > 0.25 && fx.texts.includes(live)) {
              live.n += e.n;
              live.text = `−${live.n}`;
              live.life = Math.max(live.life, 0.6);
            } else {
              const t = text(`−${e.n}`, state.crowd.x, state.dist + 4, '#ff6b6b', 26, 0.8);
              t.n = e.n;
              lossTexts[e.cause] = t;
            }
          }
          const col = e.cause === 'saw' || e.cause === 'crusher' ? '#ff5a4a' : COLORS.crowd;
          burst(e.x ?? state.crowd.x, (e.y ?? state.dist) + 3, Math.min(14, 3 + e.n), col, 20, 1.1);
          break;
        }
        case 'gambleReveal': {
          const good = e.mood === 'good';
          text(good ? `${e.label}!` : e.label, e.x, e.y + 2, good ? '#ffe066' : '#ff6b6b', 34, 1.0);
          burst(e.x, e.y, 18, good ? '#ffd23f' : '#9aa3ad', 24, 1.1);
          break;
        }
        case 'bossPhase2':
          screenText('BOSS IS ANGRY!', '#ff6b6b', 32, 0.36, 1.4);
          fx.shake = Math.max(fx.shake, 9);
          break;
        case 'bossSlam':
          fx.shake = Math.max(fx.shake, 11);
          burst(e.x, e.y + 8, 16, '#d9c7a8', 30, 1.3);
          break;
        case 'boulderLand':
          fx.shake = Math.max(fx.shake, 7);
          burst(e.x, e.y + 2, 14, '#8a735a', 26, 1.2);
          break;
        case 'shieldHit':
          burst(e.x, e.y, 2, '#cfe3f7', 12, 0.8);
          break;
        case 'shieldBreak':
          text('SHIELD DOWN', e.x, e.y, '#bfe0ff', 20, 0.8);
          burst(e.x, e.y, 18, '#a9c8e8', 26, 1.2);
          break;
        case 'split':
          text('SPLIT!', e.x, e.y, '#d6a8ff', 22, 0.8);
          burst(e.x, e.y, 14, '#a24bf0', 24, 1.1);
          break;
        case 'boom':
          burst(e.x, e.y, 22, '#ffb02e', 34, 1.4);
          burst(e.x, e.y, 10, '#ffffff', 22, 1);
          fx.shake = Math.max(fx.shake, 3);
          break;
        case 'coin':
          burst(e.x, e.y, 4, COLORS.coin, 14, 0.8);
          coinRun.n += 1;
          if (coinRun.text && coinRun.text.life > 0.2 && fx.texts.includes(coinRun.text)) {
            coinRun.text.text = `+${coinRun.n}`;
            coinRun.text.life = Math.max(coinRun.text.life, 0.6);
          } else {
            coinRun.n = 1;
            coinRun.text = text('+1', state.crowd.x + 8, state.dist + 6, COLORS.coin, 20, 0.7);
          }
          break;
        case 'arrowLand':
          if (!e.hit) burst(e.x, e.y, 6, '#b9b2a6', 14, 0.9);
          break;
        case 'ambush':
          text(`AMBUSH −${e.n}`, state.crowd.x, state.dist + 2, '#ff4d4d', 30, 1.2);
          burst(e.x, state.dist - 4, Math.min(24, 8 + e.n), '#ff3b30', 28, 1.3);
          fx.flash = 0.6;
          fx.shake = Math.min(14, fx.shake + 6);
          break;
        case 'hint':
          fx.hint = { title: e.title, sub: e.sub, life: 3.2, max: 3.2 };
          break;
        case 'powerup':
          screenText(...POWER_TEXT[e.kind], 30, 0.33, 1.1);
          burst(e.x, e.y, 16, '#ffffff', 20);
          break;
        case 'bossStart':
          screenText('BOSS FIGHT!', '#ff6b6b', 40, 0.3, 1.4);
          fx.shake = 8;
          break;
        case 'bossHit':
          if (Math.random() < 0.5) burst(e.x, e.y, 1, '#ffd0c8', 14, 1);
          break;
        case 'weaponSwitch':
          burst(state.crowd.x, state.dist + 3, 6, '#ffffff', 12, 0.7);
          break;
        case 'weaponReady': {
          const [label, col] = WEAPON_TEXT[e.w] || ['', '#fff'];
          text(e.boost ? `${label} BOOST!` : label, state.crowd.x, state.dist + 8, col, 22, 0.8);
          break;
        }
        case 'slash':
          if (e.hits) {
            burst(e.x, e.y + 4, e.whirl ? 14 : 8, '#e8f6ff', e.whirl ? 30 : 22, 1);
            fx.shake = Math.max(fx.shake, e.whirl ? 4 : 2);
          }
          if (e.whirl) text('WHIRLWIND!', e.x, e.y + 6, '#cdeefc', 22, 0.7);
          else if (e.lunge && e.hits) text('LUNGE!', e.x, e.y + 6, '#cdeefc', 20, 0.6);
          break;
        case 'whoosh':
          break; // an empty swing: the arc (render) and a soft sound only
        case 'shieldBlock':
          burst(e.x, e.y, e.arrow ? 6 : 10, '#c0dcff', 18, 0.9);
          if (e.arrow) text('BLOCK', e.x, e.y + 2, '#c0dcff', 18, 0.6);
          else if (e.n > 0) text(`BLOCKED ${e.n}`, e.x, e.y + 2, '#c0dcff', 18, 0.7);
          break;
        case 'bash':
          text('BASH!', e.x, e.y, '#ffe066', 20, 0.6);
          burst(e.x, e.y, 10, '#ffe066', 24, 1);
          fx.shake = Math.max(fx.shake, 4);
          break;
        case 'reflect':
          burst(e.x, e.y, 4, '#6fb0ff', 14, 0.8);
          break;
        case 'ricochet':
          burst(e.x, e.y, 3, '#ffffff', 16, 0.6);
          break;
        case 'join':
          text(`${e.via === 'rally' ? 'RALLY' : 'RECRUIT'} +${e.n}`, state.crowd.x, state.dist + 6, '#7fdcff', 22, 0.9);
          burst(e.x ?? state.crowd.x, e.y ?? state.dist, 8, COLORS.crowd, 18, 1);
          break;
        case 'fortress':
          screenText('FORTRESS!', '#ffd23f', 30, 0.36, 1.0);
          break;
        case 'lastStand':
          screenText('LAST STAND!', '#ff6b6b', 36, 0.4, 1.6);
          fx.shake = Math.max(fx.shake, 10);
          fx.flash = 0.6;
          break;
        case 'won':
          burst(e.x, e.y, 40, COLORS.enemy, 40, 1.8);
          burst(e.x, e.y, 30, COLORS.coin, 34, 1.4);
          fx.shake = 10;
          break;
        default:
          break;
      }
    }
  };

  fx.update = (dt) => {
    fx.shake = Math.max(0, fx.shake - dt * 30);
    fx.flash = Math.max(0, fx.flash - dt);
    for (const p of fx.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z = Math.max(0, p.z + p.vz * dt);
      p.vz -= 60 * dt;
    }
    fx.particles = fx.particles.filter((p) => p.life > 0);
    for (const t of fx.texts) t.life -= dt;
    if (fx.hint) { fx.hint.life -= dt; if (fx.hint.life <= 0) fx.hint = null; }
    fx.texts = fx.texts.filter((t) => t.life > 0 && t.text);
  };

  fx.clear = () => { fx.particles.length = 0; fx.texts.length = 0; fx.shake = 0; fx.hint = null; fx.flash = 0; };
  return fx;
}
