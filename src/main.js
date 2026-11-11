// Wires the sim, renderer, input, audio and the DOM screens together.
//
// Debug URL params (handy for screenshots and tuning):
//   ?demo=1        autopilot plays (attract mode); progress is not saved
//   ?level=N       play level N
//   ?seed=abc      base seed for level generation (default "chimaek")
//   ?t=SECONDS     fast-forward the sim this many seconds before the first frame
//   ?boss=1        fast-forward to the boss fight (plus ?t seconds into it)
//   ?freeze=1      stop the sim after fast-forwarding (static frame)
//   ?nosave=1      don't read or write localStorage

import { DT } from './config.js';
import { generateLevel, DEFAULT_SEED } from './level.js';
import { createRun, step } from './sim.js';
import { botInput } from './bot.js';
import { createRenderer } from './render.js';
import { createFx } from './fx.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import {
  UPGRADES, loadSave, writeSave, buyUpgrade, upgradeCost, statsFromUpgrades, recordRun, defaultSave,
} from './save.js';

const params = new URLSearchParams(location.search);
const DEMO = params.get('demo') === '1';
const NOSAVE = DEMO || params.get('nosave') === '1';
const SEED = params.get('seed') || DEFAULT_SEED;
const FF_T = parseFloat(params.get('t') || '0') || 0;
const FF_BOSS = params.get('boss') === '1';
const FREEZE = params.get('freeze') === '1';

const storage = (() => {
  if (NOSAVE) return null;
  try { return window.localStorage; } catch { return null; }
})();

let save = storage ? loadSave(storage) : defaultSave();
if (params.get('level')) save.level = Math.max(1, parseInt(params.get('level'), 10) || 1);

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const renderer = createRenderer(canvas);
const fx = createFx();
const audio = createAudio();
audio.setMuted(save.muted);
const input = createInput(canvas, () => renderer.size.ppu);

let mode = 'menu'; // menu | play | paused | end
let state = null;
let endTimer = 0;
let banked = false;
let frozen = false;
let acc = 0;
let last = performance.now();

function persist() {
  if (storage) writeSave(storage, save);
}

function startLevel() {
  const def = generateLevel(SEED, save.level);
  state = createRun(def, save.upgrades);
  fx.clear();
  input.reset();
  banked = false;
  endTimer = 0;
  acc = 0;
  mode = 'play';
  showScreen(null);
  audio.unlock();
}

function bank() {
  if (banked) return;
  banked = true;
  const won = state.phase === 'won';
  save = recordRun(save, { won, coins: state.coins });
  persist();
}

// ---------- screens ----------
function showScreen(id) {
  for (const el of document.querySelectorAll('.screen')) el.classList.toggle('hidden', el.id !== id);
  $('pauseBtn').classList.toggle('hidden', id !== null || DEMO);
}

function renderShop(container) {
  const stats = statsFromUpgrades(save.upgrades);
  const fmt = {
    crowd: (s) => `${s.startCrowd} soldiers`,
    rate: (s) => `${s.fireRate.toFixed(2)} shots/s`,
    dmg: (s) => `${s.damage} dmg`,
  };
  container.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'shop-head';
  head.innerHTML = `<span>Upgrades</span><span class="coins"><i class="coin"></i>${save.coins}</span>`;
  container.appendChild(head);
  for (const key of Object.keys(UPGRADES)) {
    const u = UPGRADES[key];
    const lvl = save.upgrades[key];
    const maxed = lvl >= u.max;
    const cost = upgradeCost(key, lvl);
    const next = statsFromUpgrades({ ...save.upgrades, [key]: lvl + 1 });
    const row = document.createElement('div');
    row.className = 'shop-row';
    row.innerHTML = `
      <div class="shop-info">
        <div class="shop-name">${u.name} <small>Lv ${lvl}</small></div>
        <div class="shop-effect">${fmt[key](stats)}${maxed ? '' : ` → <b>${fmt[key](next)}</b>`}</div>
      </div>`;
    const btn = document.createElement('button');
    btn.className = 'buy';
    btn.disabled = maxed || save.coins < cost;
    btn.innerHTML = maxed ? 'MAX' : `<i class="coin"></i>${cost}`;
    btn.addEventListener('click', () => {
      const s2 = buyUpgrade(save, key);
      if (s2) { save = s2; persist(); refreshScreens(); }
    });
    row.appendChild(btn);
    container.appendChild(row);
  }
}

function refreshScreens() {
  for (const el of document.querySelectorAll('.shop')) renderShop(el);
  for (const el of document.querySelectorAll('.lvl-num')) el.textContent = save.level;
  for (const el of document.querySelectorAll('.sound-toggle')) {
    el.textContent = audio.muted ? 'Sound: off' : 'Sound: on';
    el.setAttribute('aria-pressed', String(!audio.muted));
  }
}

function showEnd() {
  const won = state.phase === 'won';
  $('end-title').textContent = won ? `Level ${state.level} clear!` : 'Crowd wiped out';
  $('end-title').className = won ? 'win' : 'lose';
  $('end-stats').innerHTML = won
    ? `<span>Crowd left <b>${state.crowd.count}</b></span><span>Biggest crowd <b>${state.crowd.peak}</b></span><span>Coins <b>+${state.coins}</b></span>`
    : `<span>Reached <b>${Math.round(Math.min(1, state.dist / state.boss.y) * 100)}%</b></span><span>Biggest crowd <b>${state.crowd.peak}</b></span><span>Coins kept <b>+${state.coins}</b></span>`;
  $('end-go').textContent = won ? `Next: level ${save.level}` : `Retry level ${save.level}`;
  refreshScreens();
  mode = 'end';
  showScreen('screen-end');
}

function pause() {
  if (mode !== 'play') return;
  mode = 'paused';
  refreshScreens();
  showScreen('screen-pause');
}
function resume() {
  if (mode !== 'paused') return;
  mode = 'play';
  last = performance.now();
  acc = 0;
  showScreen(null);
}

function toggleSound() {
  audio.setMuted(!audio.muted);
  save.muted = audio.muted;
  persist();
  refreshScreens();
}

$('start-go').addEventListener('click', startLevel);
$('end-go').addEventListener('click', startLevel);
$('end-menu').addEventListener('click', () => { mode = 'menu'; refreshScreens(); showScreen('screen-start'); });
$('pauseBtn').addEventListener('click', pause);
$('pause-resume').addEventListener('click', resume);
$('pause-quit').addEventListener('click', () => { mode = 'menu'; refreshScreens(); showScreen('screen-start'); });
for (const el of document.querySelectorAll('.sound-toggle')) el.addEventListener('click', toggleSound);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' || e.code === 'KeyP') { if (mode === 'play') pause(); else if (mode === 'paused') resume(); }
  if ((e.code === 'Enter' || e.code === 'Space') && (mode === 'menu' || mode === 'end')) { e.preventDefault(); startLevel(); }
});
window.addEventListener('resize', () => renderer.resize());

// ---------- loop ----------
function inputFor(s) {
  return DEMO ? botInput(s) : input.take();
}

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (state && (mode === 'play' || mode === 'end') && !frozen) {
    if (state.phase === 'run' || state.phase === 'boss') {
      acc += dt;
      let n = 0;
      while (acc >= DT && n < 6) {
        step(state, inputFor(state));
        acc -= DT;
        n += 1;
      }
      if (n === 6) acc = 0; // fell behind; drop time rather than spiral
    } else if (mode === 'play') {
      bank();
      endTimer += dt;
      if (endTimer > 1.3) {
        if (DEMO) startLevel();
        else showEnd();
      }
    }
  }
  if (state && state.events.length) {
    fx.consume(state.events, state);
    audio.play(state.events);
    state.events.length = 0;
  }
  fx.update(mode === 'paused' ? 0 : dt);
  if (state) renderer.draw(state, fx, { hidden: mode === 'menu', bankedCoins: banked ? save.coins - state.coins : save.coins });
  requestAnimationFrame(frame);
}

// Read-only hook for debugging and automated checks.
window.crowdRunner = {
  get state() { return state; },
  get mode() { return mode; },
  get save() { return save; },
  // Average ms per frame over n frames, split into sim / fx / draw. Advances the game.
  bench(n = 120) {
    const ms = { sim: 0, fx: 0, draw: 0 };
    for (let i = 0; i < n; i++) {
      let t = performance.now();
      if (state.phase === 'run' || state.phase === 'boss') step(state, inputFor(state));
      ms.sim += performance.now() - t;
      t = performance.now();
      fx.consume(state.events, state);
      state.events.length = 0;
      fx.update(DT);
      ms.fx += performance.now() - t;
      t = performance.now();
      renderer.draw(state, fx, {});
      ms.draw += performance.now() - t;
    }
    for (const k of Object.keys(ms)) ms[k] = +(ms[k] / n).toFixed(2);
    return ms;
  },
};

function boot() {
  refreshScreens();
  if (DEMO || FF_T > 0 || FF_BOSS) {
    startLevel();
    if (FF_BOSS) {
      let guard = 0;
      while (state.phase === 'run' && guard++ < 60 * 300) step(state, inputFor(state));
    }
    const n = Math.round(FF_T / DT);
    for (let i = 0; i < n && (state.phase === 'run' || state.phase === 'boss'); i++) {
      step(state, inputFor(state));
      // Keep only the last second of events so the frame shows fresh effects.
      if (state.events.length > 200 || n - i > 60) state.events.length = 0;
    }
    if (FREEZE) frozen = true;
    if (FREEZE && (state.phase === 'won' || state.phase === 'lost')) { bank(); showEnd(); }
  } else {
    // Menu backdrop: a static peek at the level.
    state = createRun(generateLevel(SEED, save.level), save.upgrades);
    showScreen('screen-start');
  }
  requestAnimationFrame(frame);
}

boot();
