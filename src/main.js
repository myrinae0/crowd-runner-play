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
//   ?feature=NAME  play the level that introduces a mechanic (saws, bridge, ...;
//                  see FEATURES in config.js) and fast-forward to its first
//                  appearance (unless ?t is given); ?after=S tunes how far past
//                  the hint to stop (default 2.5 s)
//   ?bench=N       after fast-forwarding, time N frames; result in the page title
//   ?ups=C,R,D     play with these upgrade levels (crowd, rate, damage); not saved
//   ?wups=k:v,...  set any upgrade levels by key (e.g. wups=swing:3,whirl:2); not saved
//   ?weapon=W      start the run with weapon W (rifle, shield, melee) in hand
//   ?policy=P      demo autopilot's weapon policy (switch by default; rifle, shield, melee)
//   ?coins=N       start with N coins (shop screenshots); not saved
//   ?shop=TAB      open the shop on this tab (general, rifle, shield, melee)
//   ?x=N           (screenshots) start the crowd at x=N (0..100); without
//                  ?demo it then holds that line, so enemies slip past
//   ?perf=1        record round-start timings (startLevel parts and the first
//                  frames after it) in crowdRunner.perf

import { DT, FEATURES, SQUEEZE_LEVEL } from './config.js';
import { generateLevel, DEFAULT_SEED } from './level.js';
import { createRun, step } from './sim.js';
import { botInput } from './bot.js';
import { createRenderer } from './render.js';
import { createFx } from './fx.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { pixelize, installCssSprites } from './pixel/dom.js';
import {
  UPGRADES, UPGRADE_TABS, TAB_NAMES, tabKeys, loadSave, writeSave, buyUpgrade, upgradeCost, statsFromUpgrades, recordRun, defaultSave,
} from './save.js';
import { WEAPONS, WEAPON_UNLOCK, weaponUnlocked, weaponStats } from './weapons.js';

const params = new URLSearchParams(location.search);
const DEMO = params.get('demo') === '1';
const UPS = params.get('ups') ? params.get('ups').split(',').map((v) => parseInt(v, 10) || 0) : null;
const WUPS = params.get('wups') ? Object.fromEntries(params.get('wups').split(',').map((kv) => kv.split(':')).map(([k, v]) => [k, parseInt(v, 10) || 0])) : null;
const START_WEAPON = WEAPONS.includes(params.get('weapon')) ? params.get('weapon') : null;
const POLICY = ['rifle', 'shield', 'melee', 'switch'].includes(params.get('policy')) ? params.get('policy') : 'switch';
const COINS = params.get('coins') ? parseInt(params.get('coins'), 10) || 0 : null;
const NOSAVE = DEMO || !!UPS || !!WUPS || COINS !== null || params.get('nosave') === '1';
const SEED = params.get('seed') || DEFAULT_SEED;
const FF_T = parseFloat(params.get('t') || '0') || 0;
const FF_BOSS = params.get('boss') === '1';
const FREEZE = params.get('freeze') === '1';
const FEATURE = FEATURES[params.get('feature')] ? params.get('feature') : null;
const FF_AFTER = parseFloat(params.get('after') || '2.5');

const storage = (() => {
  if (NOSAVE) return null;
  try { return window.localStorage; } catch { return null; }
})();

let save = storage ? loadSave(storage) : defaultSave();
if (params.get('level')) save.level = Math.max(1, parseInt(params.get('level'), 10) || 1);
if (FEATURE) save.level = FEATURES[FEATURE];
if (UPS) save.upgrades = { ...save.upgrades, crowd: UPS[0] || 0, rate: UPS[1] || 0, dmg: UPS[2] || 0 };
if (WUPS) for (const [k, v] of Object.entries(WUPS)) if (UPGRADES[k]) save.upgrades[k] = Math.max(0, Math.min(UPGRADES[k].max, v));
if (COINS !== null) save.coins = COINS;

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const renderer = createRenderer(canvas);
const fx = createFx();
const audio = createAudio();
audio.setMuted(save.muted);
audio.setMusic(save.music);
audio.setSfxVolume(save.sfxVol);
audio.setMusicVolume(save.musicVol);
// Browsers start audio only from a user gesture: unlock on the first tap or key
// (pointerup / touchend count as a gesture on phones, pointerdown doesn't).
for (const ev of ['pointerdown', 'pointerup', 'touchend', 'keydown']) {
  window.addEventListener(ev, () => audio.unlock(), { capture: true, passive: true });
}
const input = createInput(canvas, () => renderer.size.ppu, (x, y) => mode === 'play' && renderer.hitPad(x, y));

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

// Demo mode plays with upgrades a typical player would have by that level.
function demoUpgrades(lv) {
  const u = { crowd: Math.min(30, lv - 1), rate: Math.min(20, lv - 1), dmg: Math.min(10, Math.floor(lv / 3)) };
  return WUPS ? { ...u, ...WUPS } : u;
}

// ?perf=1: round-start timings. Each start records how long startLevel's parts
// took, then per-frame gaps and work for the next frames (and some later
// "steady" frames to compare against).
const PERF = params.get('perf') === '1' ? { starts: [] } : null;
let perfRec = null;

// ---------- smooth round starts ----------
// Round starts used to hitch: the click handler generated the level, the first
// play frame was the first time the HUD's fonts and the sim/bot code ran (cold
// glyph caches and JIT), and a slow first frame made the loop catch up with
// several sim steps at once. So: the next level is generated ahead of time
// while a screen is showing, everything is warmed up once while the menu is
// idle, and the first frames after a start never catch up.
let nextDef = null; // { key, def } generated ahead for the level about to be played
const defKey = () => `${SEED}|${save.level}`;
function levelDef() {
  if (!nextDef || nextDef.key !== defKey()) nextDef = { key: defKey(), def: generateLevel(SEED, save.level) };
  return nextDef.def; // createRun deep-copies it, so it can be reused for retries
}
const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 300 }) : setTimeout(fn, 50));
// The run itself is also built ahead (createRun deep-copies the level); it's
// only used if the level and upgrades still match when the round starts.
let nextRun = null; // { key, run }
const runKey = () => `${defKey()}|${JSON.stringify(DEMO ? demoUpgrades(save.level) : save.upgrades)}`;
function freshRun() {
  const key = runKey();
  const ready = nextRun && nextRun.key === key ? nextRun.run : null;
  nextRun = null;
  return ready || createRun(levelDef(), DEMO ? demoUpgrades(save.level) : save.upgrades);
}
function prepareNext() {
  idle(() => {
    levelDef();
    if (!nextRun || nextRun.key !== runKey()) nextRun = { key: runKey(), run: createRun(levelDef(), DEMO ? demoUpgrades(save.level) : save.upgrades) };
    renderer.prepare(nextRun.run);
  });
}

// Run the sim, bot, effects and a full HUD frame once on a throwaway copy, then
// redraw the real frame. Done once, while the menu is idle.
let warmed = false;
function warmUp() {
  if (warmed || !state) return;
  warmed = true;
  // In two idle slices: sim + bot + effects first, then one full frame.
  const t0 = performance.now();
  const ghost = createRun(levelDef(), demoUpgrades(Math.max(save.level, 6)));
  for (let i = 0; i < 90; i++) step(ghost, botInput(ghost));
  ghost.events.push({ type: 'hint', title: 'WARM', sub: 'up' }, { type: 'powerup', kind: 'rapid', x: 50, y: ghost.dist });
  if (PERF) PERF.warmSim = performance.now() - t0;
  idle(() => {
    const t1 = performance.now();
    prepareNext();
    fx.consume(ghost.events, ghost);
    fx.update(DT);
    ghost.buffs.rapid = 1;
    renderer.draw(ghost, fx, { bankedCoins: 0, pad: true });
    fx.clear();
    // The real level's first frame with its HUD too, so the pixel text it
    // needs (level, coins, counts, gate labels) is already cached at the start.
    renderer.draw(state, fx, { bankedCoins: save.coins, pad: state.level >= SQUEEZE_LEVEL });
    drawNow(); // the real frame goes on top before anything is shown
    if (PERF) PERF.warmDraw = performance.now() - t1;
  });
}

let settle = 0; // frames after a start that don't try to catch up on lost time

function startLevel() {
  const t0 = performance.now();
  const def = levelDef();
  const t1 = performance.now();
  state = freshRun();
  if (START_WEAPON && weaponUnlocked(state.level, START_WEAPON)) state.weapon.cur = START_WEAPON;
  pendingWeapon = null;
  const t2 = performance.now();
  fx.clear();
  input.reset();
  banked = false;
  endTimer = 0;
  acc = 0;
  settle = 3;
  mode = 'play';
  showScreen(null);
  const t3 = performance.now();
  audio.unlock();
  const t4 = performance.now();
  if (PERF) {
    perfRec = { level: save.level, gen: t1 - t0, run: t2 - t1, dom: t3 - t2, audio: t4 - t3, total: t4 - t0, at: t0, frames: [] };
    PERF.starts.push(perfRec);
  }
}

function bank() {
  if (banked) return;
  banked = true;
  const won = state.phase === 'won';
  save = recordRun(save, { won, coins: state.coins });
  persist();
  prepareNext(); // build the next round while the result shows
}

// ---------- screens ----------
function showScreen(id) {
  for (const el of document.querySelectorAll('.screen')) el.classList.toggle('hidden', el.id !== id);
  $('pauseBtn').classList.toggle('hidden', id !== null || DEMO);
  $('muteBtn').classList.toggle('hidden', id !== null || DEMO);
  barKey = ''; // re-sync the weapon bar on the next frame
}

// ---------- shop: one tab per weapon plus General ----------
// What one upgrade level means, for the shop's "now -> next" line.
const pct = (v) => `${Math.round(v * 100)}%`;
const SHOP_FMT = {
  crowd: (s) => `${s.startCrowd} soldiers`,
  magnet: (s, w) => (w.magnetR ? `pulls coins ${w.magnetR} away` : 'off'),
  last: (s, w) => (w.lastStand ? `${w.lastStand} soldiers survive` : 'off'),
  quick: (s, w) => `${w.switchTime.toFixed(2)} s switch${w.boostTime ? ', 2 s boost' : ''}`,
  rate: (s) => `${s.fireRate.toFixed(2)} shots/s`,
  dmg: (s) => `${s.damage} dmg`,
  pierce: (s, w) => (w.pierce > 1 ? `hits ${w.pierce} enemies` : 'off'),
  rico: (s, w) => (w.rico ? `${w.rico} bounce${w.rico > 1 ? 's' : ''}` : 'off'),
  tuner: (s, w) => `${w.tuner.toFixed(1)} gate hits/shot`,
  block: (s, w) => `clashes cost ${pct(w.clash)}`,
  bash: (s, w) => (w.bash ? `every ${w.bashEvery.toFixed(1)} s` : 'off'),
  reflect: (s, w) => (w.reflect ? `${w.reflect} dmg back` : 'off'),
  rally: (s, w) => (w.rally ? `${pct(w.rally)} join` : 'off'),
  fortress: (s, w) => (w.fortress ? `${w.fortressT.toFixed(1)} s, every ${w.fortressCd} s` : 'off'),
  swing: (s, w) => `${(1 / w.meleeCd).toFixed(2)} slashes/s`,
  arc: (s, w) => `${Math.round((w.arcHalf * 360) / Math.PI)}° wide, reach ${w.reach}`,
  blood: (s, w) => (w.blood ? `+${pct(w.blood)} speed per kill` : 'off'),
  recruit: (s, w) => (w.recruit ? `${pct(w.recruit)} join` : 'off'),
  whirl: (s, w) => (w.whirlEvery ? `every ${w.whirlEvery}${w.whirlEvery === 2 ? 'nd' : w.whirlEvery === 3 ? 'rd' : 'th'} slash` : 'off'),
  slayer: (s, w) => `x${w.bigHit.toFixed(1)} giants/walls, x${w.slayer.toFixed(1)} boss`,
};
let shopTab = UPGRADE_TABS.includes(params.get('shop')) ? params.get('shop') : 'general';
const TAB_WEAPON = { rifle: 'rifle', shield: 'shield', melee: 'melee' };

function renderShop(container) {
  const stats = statsFromUpgrades(save.upgrades);
  const ws = weaponStats(save.upgrades);
  const reached = Math.max(save.level, save.best);
  container.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'shop-head';
  head.innerHTML = `<span>Upgrades</span><span class="coins"><i class="coin"></i>${save.coins}</span>`;
  container.appendChild(head);
  const tabs = document.createElement('div');
  tabs.className = 'shop-tabs';
  tabs.setAttribute('role', 'tablist');
  for (const t of UPGRADE_TABS) {
    const b = document.createElement('button');
    const locked = TAB_WEAPON[t] && !weaponUnlocked(reached, TAB_WEAPON[t]);
    b.className = `shop-tab${t === shopTab ? ' sel' : ''}${locked ? ' dim' : ''}`;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(t === shopTab));
    b.textContent = TAB_NAMES[t];
    b.addEventListener('click', () => { shopTab = t; refreshScreens(); });
    tabs.appendChild(b);
  }
  container.appendChild(tabs);
  const w = TAB_WEAPON[shopTab];
  const locked = w && !weaponUnlocked(reached, w);
  if (locked) {
    const note = document.createElement('p');
    note.className = 'shop-note';
    note.textContent = `The ${TAB_NAMES[shopTab].toLowerCase()} unlocks on level ${WEAPON_UNLOCK[w]}.`;
    container.appendChild(note);
  }
  for (const key of tabKeys(shopTab)) {
    const u = UPGRADES[key];
    const lvl = save.upgrades[key] | 0;
    const maxed = lvl >= u.max;
    const cost = upgradeCost(key, lvl);
    const nextU = { ...save.upgrades, [key]: lvl + 1 };
    const now = SHOP_FMT[key](stats, ws);
    const next = SHOP_FMT[key](statsFromUpgrades(nextU), weaponStats(nextU));
    const row = document.createElement('div');
    row.className = 'shop-row';
    row.innerHTML = `
      <div class="shop-info">
        <div class="shop-name">${u.name} <small>Lv ${lvl}</small></div>
        <div class="shop-desc">${u.info}</div>
        <div class="shop-effect">${now}${maxed ? '' : ` → <b>${next}</b>`}</div>
      </div>`;
    const btn = document.createElement('button');
    btn.className = 'buy';
    btn.disabled = maxed || locked || save.coins < cost;
    btn.innerHTML = maxed ? 'MAX' : `<i class="coin"></i>${cost}`;
    btn.addEventListener('click', () => {
      const s2 = buyUpgrade(save, key);
      if (s2) { save = s2; persist(); refreshScreens(); prepareNext(); }
    });
    row.appendChild(btn);
    container.appendChild(row);
  }
}

// ---------- weapon bar (bottom left) ----------
// Buttons and keys 1 / 2 / 3 queue a switch for the next sim step; switching
// never steers or squeezes (the buttons are outside the canvas, so their
// touches never reach the drag / squeeze input).
let pendingWeapon = null;
let barKey = '';
let barRect = null;
const bar = $('weaponBar');
const barBtns = [...bar.querySelectorAll('.wbtn')];
function requestWeapon(w) {
  if (mode !== 'play' || !state || DEMO) return;
  if (!weaponUnlocked(state.level, w)) return;
  pendingWeapon = w;
}
for (const b of barBtns) {
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); requestWeapon(b.dataset.w); });
  b.addEventListener('click', (e) => e.preventDefault());
}
// Shown from the level that unlocks the shield (the rifle alone needs no
// buttons); weapons not unlocked yet show a padlock.
function updateBar() {
  const show = !!state && mode === 'play' && state.level >= WEAPON_UNLOCK.shield && (state.phase === 'run' || state.phase === 'boss');
  const w = state && state.weapon;
  const arm = show ? Math.round((1 - w.armT / state.ws.switchTime) * 20) : 0;
  const key = show ? `${state.level}|${w.cur}|${w.armT > 0 ? arm : 'r'}` : 'hidden';
  if (key === barKey) return;
  barKey = key;
  bar.classList.toggle('hidden', !show);
  if (!show) { barRect = null; return; }
  for (const b of barBtns) {
    const k = b.dataset.w;
    const locked = !weaponUnlocked(state.level, k);
    const on = w.cur === k;
    b.classList.toggle('locked', locked);
    b.classList.toggle('on', on && w.armT <= 0);
    b.classList.toggle('arming', on && w.armT > 0);
    b.style.setProperty('--arm', on && w.armT > 0 ? String(arm / 20) : '0');
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', `${k[0].toUpperCase()}${k.slice(1)}${locked ? ` (unlocks on level ${WEAPON_UNLOCK[k]})` : ` (key ${WEAPONS.indexOf(k) + 1})`}`);
  }
  if (!barRect) {
    const r = bar.getBoundingClientRect();
    const c = canvas.getBoundingClientRect();
    barRect = { right: r.right - c.left + 6, top: r.top - c.top - 4 };
  }
}

function refreshScreens() {
  for (const el of document.querySelectorAll('.shop')) renderShop(el);
  $('start-go').textContent = `Play level ${save.level}`;
  for (const el of document.querySelectorAll('.sound-toggle')) {
    el.textContent = audio.muted ? 'Sound: off' : 'Sound: on';
    el.setAttribute('aria-pressed', String(!audio.muted));
  }
  for (const el of document.querySelectorAll('.music-toggle')) {
    el.textContent = audio.music ? 'Music: on' : 'Music: off';
    el.setAttribute('aria-pressed', String(audio.music));
  }
  refreshVolumes();
  const silent = audio.muted && !audio.music;
  $('muteBtn').classList.toggle('off', silent);
  $('muteBtn').setAttribute('aria-pressed', String(silent));
  $('muteBtn').setAttribute('aria-label', silent ? 'Turn sound and music on' : 'Mute sound and music');
  pixelize(); // titles, buttons and numbers in the bitmap font
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
  prepareNext();
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

function setSound(sfx, music) {
  audio.setMuted(!sfx);
  audio.setMusic(music);
  audio.unlock(); // these run from a tap, so the context may start here
  save.muted = !sfx;
  save.music = music;
  persist();
  refreshScreens();
}
const toggleSound = () => setSound(audio.muted, audio.music);
const toggleMusic = () => setSound(!audio.muted, !audio.music);
// HUD button: mutes both; the next tap brings back what was on before.
let beforeMute = null;
function toggleAll() {
  if (!audio.muted || audio.music) {
    beforeMute = { sfx: !audio.muted, music: audio.music };
    setSound(false, false);
  } else {
    const b = beforeMute || { sfx: true, music: true };
    beforeMute = null;
    setSound(b.sfx, b.music);
  }
}

// ---------- volume sliders (menu and pause screen) ----------
// Each slider sits next to its switch. The switch doesn't change the slider
// value; a slider for a switched-off channel is greyed but still moves.
const volOf = (ch) => (ch === 'sfx' ? audio.sfxVol : audio.musicVol);
const volOn = (ch) => (ch === 'sfx' ? !audio.muted : audio.music);
function refreshVolumes() {
  for (const el of document.querySelectorAll('.vol')) {
    const ch = el.dataset.ch;
    const v = volOf(ch);
    const on = volOn(ch);
    if (+el.value !== v) el.value = String(v);
    el.style.setProperty('--v', String(v / 100));
    el.classList.toggle('off', !on);
    el.setAttribute('aria-valuetext', `${v}%${on ? '' : ', switched off'}`);
    const out = el.parentElement.querySelector('.vol-val');
    if (out && out.dataset.v !== `${v}`) {
      out.dataset.v = `${v}`;
      out.textContent = `${v}%`;
      pixelize(el.parentElement);
    }
  }
}
function setVolume(ch, v) {
  if (ch === 'sfx') { audio.setSfxVolume(v); save.sfxVol = audio.sfxVol; } else { audio.setMusicVolume(v); save.musicVol = audio.musicVol; }
  audio.unlock(); // from a gesture, so the context may start here
  refreshVolumes();
}
for (const el of document.querySelectorAll('.vol')) {
  const ch = el.dataset.ch;
  el.addEventListener('input', () => setVolume(ch, +el.value));
  // Released (or a key step): save, and let the player hear the new level.
  el.addEventListener('change', () => {
    setVolume(ch, +el.value);
    persist();
    if (ch === 'sfx') audio.preview();
  });
  // Keep slider gestures and keys to the slider: arrow keys would otherwise
  // steer (and the steering handler's preventDefault would stop the slider),
  // and Space / Enter would start a run. Escape and P still pause / resume.
  el.addEventListener('keydown', (e) => { if (e.code !== 'Escape' && e.code !== 'KeyP') e.stopPropagation(); });
  for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'click']) {
    el.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
  }
}

// Which music fits what is on screen (cheap; called every frame).
function musicScene() {
  if (mode === 'paused') return 'paused';
  if (mode === 'play' && state) return state.phase === 'boss' ? 'boss' : state.phase === 'run' ? 'run' : null;
  return 'menu';
}

$('start-go').addEventListener('click', startLevel);
$('end-go').addEventListener('click', startLevel);
$('end-menu').addEventListener('click', () => { mode = 'menu'; refreshScreens(); showScreen('screen-start'); prepareNext(); });
$('pauseBtn').addEventListener('click', pause);
$('pause-resume').addEventListener('click', resume);
$('pause-quit').addEventListener('click', () => { mode = 'menu'; refreshScreens(); showScreen('screen-start'); prepareNext(); });
for (const el of document.querySelectorAll('.sound-toggle')) el.addEventListener('click', toggleSound);
for (const el of document.querySelectorAll('.music-toggle')) el.addEventListener('click', toggleMusic);
$('muteBtn').addEventListener('click', toggleAll);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { pause(); audio.sleep(); } else audio.wake();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' || e.code === 'KeyP') { if (mode === 'play') pause(); else if (mode === 'paused') resume(); }
  const wi = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code) >= 0 ? ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code) : ['Numpad1', 'Numpad2', 'Numpad3'].indexOf(e.code);
  if (wi >= 0 && mode === 'play') { e.preventDefault(); requestWeapon(WEAPONS[wi]); }
  if ((e.code === 'Enter' || e.code === 'Space') && (mode === 'menu' || mode === 'end')) { e.preventDefault(); startLevel(); }
});
// Redraw straight away after a real resize, so the cleared canvas is never
// shown as a blank (all-green) frame before the next animation frame.
let resizeCount = 0;
function onResize() {
  barRect = null;
  barKey = '';
  if (!renderer.resize()) return;
  resizeCount += 1;
  drawNow();
}
window.addEventListener('resize', onResize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
if (window.ResizeObserver) new ResizeObserver(onResize).observe(canvas);

// ---------- loop ----------
function inputFor(s) {
  if (DEMO) return botInput(s, POLICY);
  const inp = input.take();
  if (pendingWeapon) { inp.weapon = pendingWeapon; pendingWeapon = null; }
  return inp;
}

function drawNow() {
  if (state) {
    renderer.draw(state, fx, {
      hidden: mode === 'menu',
      bankedCoins: banked ? save.coins - state.coins : save.coins,
      pad: state.level >= SQUEEZE_LEVEL && (state.phase === 'run' || state.phase === 'boss'),
      bar: mode === 'play' ? barRect : null,
    });
  }
}

function frame(now) {
  // Schedule first, so an error in one frame can't stop the game loop.
  requestAnimationFrame(frame);
  let dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (settle > 0 && mode === 'play') {
    // Just started: run at most one step per frame instead of catching up on
    // the time the start itself took (which would make things jump).
    settle -= 1;
    dt = Math.min(dt, DT);
  }

  const pf = perfRec && perfRec.frames.length < 400 ? { gap: now - (perfRec.prev ?? perfRec.at), dt, steps: 0 } : null;
  let pt = pf ? performance.now() : 0;
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
      if (pf) pf.steps = n;
    } else if (mode === 'play') {
      bank();
      endTimer += dt;
      if (endTimer > 1.3) {
        if (DEMO) startLevel();
        else showEnd();
      }
    }
  }
  if (pf) { const t = performance.now(); pf.sim = t - pt; pt = t; }
  if (state && state.events.length) {
    fx.consume(state.events, state);
    audio.play(state.events);
    state.events.length = 0;
  }
  audio.setScene(musicScene());
  updateBar();
  fx.update(mode === 'paused' ? 0 : dt);
  if (pf) { const t = performance.now(); pf.fx = t - pt; pt = t; }
  drawNow();
  if (pf) {
    pf.draw = performance.now() - pt;
    perfRec.frames.push(pf);
    perfRec.prev = now;
  }
  if (debugEl) debugTick(now);
}

// ?debug=1: small overlay with fps, canvas size and resize count.
const debugEl = params.get('debug') === '1' ? document.createElement('div') : null;
let dbgFrames = 0, dbgSince = performance.now(), dbgMaxGap = 0, dbgPrev = performance.now();
function debugTick(now) {
  dbgFrames += 1;
  dbgMaxGap = Math.max(dbgMaxGap, now - dbgPrev);
  dbgPrev = now;
  if (now - dbgSince < 500) return;
  const fps = Math.round(dbgFrames * 1000 / (now - dbgSince));
  debugEl.textContent = `fps ${fps} · worst ${Math.round(dbgMaxGap)}ms · resizes ${resizeCount} · ${canvas.width}x${canvas.height} · dpr ${window.devicePixelRatio}`;
  dbgFrames = 0; dbgSince = now; dbgMaxGap = 0;
}
if (debugEl) {
  debugEl.style.cssText = 'position:fixed;left:4px;bottom:4px;z-index:9;font:11px monospace;color:#fff;background:rgba(0,0,0,.6);padding:2px 5px;border-radius:4px;pointer-events:none';
  document.body.appendChild(debugEl);
}

// Read-only hook for debugging and automated checks.
window.crowdRunner = {
  perf: PERF,
  fx,
  start: () => startLevel(),
  get state() { return state; },
  get mode() { return mode; },
  get save() { return save; },
  audio,
  // Advance the sim one step at a time until cond(state) is true (or n steps):
  // for screenshots of a precise moment. Events are kept for the next frame.
  stepUntil(cond, n = 6000) {
    for (let i = 0; i < n && (state.phase === 'run' || state.phase === 'boss'); i++) {
      step(state, inputFor(state));
      if (state.events.length > 300) state.events.length = 0;
      if (cond(state)) return true;
    }
    return false;
  },
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
  installCssSprites();
  refreshScreens();
  if (DEMO || FF_T > 0 || FF_BOSS || FEATURE) {
    startLevel();
    if (params.get('x')) state.crowd.x = Math.max(6, Math.min(94, parseFloat(params.get('x')) || 50));
    if (FEATURE && !(FF_T > 0) && !FF_BOSS) {
      // Run until the mechanic's hint shows, then a little longer.
      let guard = 0;
      const seen = () => state.hints.some((h) => h.shown && !h.weapon) || (state.phase !== 'run' && state.phase !== 'boss');
      while (!seen() && guard++ < 60 * 300) { step(state, inputFor(state)); state.events.length = 0; }
      const n = Math.round(FF_AFTER / DT);
      for (let i = 0; i < n && (state.phase === 'run' || state.phase === 'boss'); i++) {
        step(state, inputFor(state));
        if (n - i > 60) state.events.length = 0;
      }
      // Keep the hint panel on screen for the screenshot.
      const h = state.hints.find((x) => x.shown && !x.weapon);
      if (h) state.events.push({ type: 'hint', title: h.title, sub: h.sub });
    }
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
    if (params.get('bench')) {
      // ?bench=N: time N frames (sim / effects / draw) and show it in the title.
      const r = window.crowdRunner.bench(parseInt(params.get('bench'), 10) || 120);
      document.title = `bench sim ${r.sim} fx ${r.fx} draw ${r.draw} ms`;
    }
    if (FREEZE) frozen = true;
    if (FREEZE && (state.phase === 'won' || state.phase === 'lost')) { bank(); showEnd(); }
  } else {
    // Menu backdrop: a static peek at the level.
    state = createRun(levelDef(), save.upgrades);
    showScreen('screen-start');
    // Warm everything up once the menu has painted (skipped with ?nowarm=1, for timing comparisons).
    if (params.get('nowarm') !== '1') requestAnimationFrame(() => idle(warmUp));
  }
  requestAnimationFrame(frame);
}

// The pixel art (Kenney sheets, atlas, floor textures) loads first; it is small.
renderer.ready.catch((e) => console.error(e)).then(boot);
