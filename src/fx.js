// Visual-only effects (particles, floating text, screen shake) driven by sim events.
// Uses Math.random freely: none of this feeds back into the simulation.

import { COLORS } from './render.js';

const MAX_PARTICLES = 260;

export function createFx() {
  const fx = { particles: [], texts: [], shake: 0 };

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
    fx.texts.push({ text: t, x, y, color, size, life, max: life });
    if (fx.texts.length > 12) fx.texts.shift();
  }

  function screenText(t, color, size = 42, sy = 0.4, life = 1.4) {
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
        case 'crowdLoss':
          fx.shake = Math.min(14, fx.shake + 3 + Math.min(8, e.n * 0.25));
          if (e.cause !== 'boss') text(`−${e.n}`, state.crowd.x, state.dist + 4, '#ff6b6b', 26, 0.8);
          burst(state.crowd.x, state.dist + 3, Math.min(14, 3 + e.n), COLORS.crowd, 20, 1.1);
          break;
        case 'powerup':
          screenText(e.kind === 'rapid' ? 'RAPID FIRE!' : 'SPREAD SHOT!', e.kind === 'rapid' ? '#ffb347' : '#c99bff', 30, 0.33, 1.1);
          burst(e.x, e.y, 16, '#ffffff', 20);
          break;
        case 'bossStart':
          screenText('BOSS FIGHT!', '#ff6b6b', 40, 0.3, 1.4);
          fx.shake = 8;
          break;
        case 'bossHit':
          if (Math.random() < 0.5) burst(e.x, e.y, 1, '#ffd0c8', 14, 1);
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
    for (const p of fx.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z = Math.max(0, p.z + p.vz * dt);
      p.vz -= 60 * dt;
    }
    fx.particles = fx.particles.filter((p) => p.life > 0);
    for (const t of fx.texts) t.life -= dt;
    fx.texts = fx.texts.filter((t) => t.life > 0 && t.text);
  };

  fx.clear = () => { fx.particles.length = 0; fx.texts.length = 0; fx.shake = 0; };
  return fx;
}
