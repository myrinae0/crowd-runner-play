// Upgrades, costs and the localStorage save. Storage is injectable for tests.

export const SAVE_KEY = 'crowd-runner-save-v1';

// Volume sliders: 0-100 per channel, 80 is the level the game was tuned at
// (the same number as DEFAULT_VOL in audio.js, which save.js doesn't import).
export const DEFAULT_VOL = 80;

// Every upgrade, flat by key (the save stores levels by key). `tab` puts it
// in the shop: one tab per weapon plus General. crowd, rate and dmg are the
// original three (rate and dmg are the rifle's; older saves keep their levels).
// What each level does is in weaponStats() (src/weapons.js) and
// statsFromUpgrades() below; `info` is the shop's one-line description.
export const UPGRADES = {
  crowd: { name: 'Starting crowd', tab: 'general', base: 12, growth: 1.42, max: 30, info: 'More soldiers at the start' },
  magnet: { name: 'Coin magnet', tab: 'general', base: 25, growth: 1.6, max: 5, info: 'Pulls coins in from further' },
  last: { name: 'Last stand', tab: 'general', base: 120, growth: 2.2, max: 3, info: 'Once a run, a wipeout leaves you soldiers' },
  quick: { name: 'Quick draw', tab: 'general', base: 45, growth: 1.75, max: 4, info: 'Faster switching, then a short boost' },
  rate: { name: 'Fire rate', tab: 'rifle', base: 18, growth: 1.45, max: 20, info: 'Shots per second' },
  dmg: { name: 'Bullet damage', tab: 'rifle', base: 30, growth: 1.7, max: 10, info: 'Damage per bullet' },
  pierce: { name: 'Pierce', tab: 'rifle', base: 60, growth: 1.9, max: 3, info: 'Bullets go through enemies' },
  rico: { name: 'Ricochet', tab: 'rifle', base: 70, growth: 1.9, max: 3, info: 'A kill bounces the bullet on' },
  tuner: { name: 'Gate tuner', tab: 'rifle', base: 40, growth: 1.7, max: 4, info: 'Shots raise gates faster' },
  block: { name: 'Block', tab: 'shield', base: 35, growth: 1.6, max: 5, info: 'Fewer losses in clashes' },
  bash: { name: 'Bash', tab: 'shield', base: 40, growth: 1.7, max: 4, info: 'Shove squads back and stun them' },
  reflect: { name: 'Reflect', tab: 'shield', base: 45, growth: 1.75, max: 3, info: 'Blocked arrows fly back at the tower' },
  rally: { name: 'Rally', tab: 'shield', base: 60, growth: 1.8, max: 4, info: 'Some blocked enemies join you' },
  fortress: { name: 'Fortress', tab: 'shield', base: 50, growth: 1.8, max: 3, info: 'Squeeze: immune to saws and arrows' },
  swing: { name: 'Swing speed', tab: 'melee', base: 35, growth: 1.6, max: 5, info: 'Slash more often' },
  arc: { name: 'Arc width', tab: 'melee', base: 35, growth: 1.65, max: 4, info: 'Wider, longer slashes' },
  blood: { name: 'Bloodlust', tab: 'melee', base: 45, growth: 1.75, max: 4, info: 'Kills speed up the next slash' },
  recruit: { name: 'Recruit', tab: 'melee', base: 60, growth: 1.8, max: 4, info: 'Some slashed enemies join you' },
  whirl: { name: 'Whirlwind', tab: 'melee', base: 70, growth: 1.9, max: 3, info: 'Some slashes spin a full circle' },
  slayer: { name: 'Giant slayer', tab: 'melee', base: 40, growth: 1.7, max: 5, info: 'Big damage to giants, walls, boss' },
};
export const UPGRADE_TABS = ['general', 'rifle', 'shield', 'melee'];
export const TAB_NAMES = { general: 'General', rifle: 'Rifle', shield: 'Shield', melee: 'Melee' };
export const tabKeys = (tab) => Object.keys(UPGRADES).filter((k) => UPGRADES[k].tab === tab);
const zeroUpgrades = () => Object.fromEntries(Object.keys(UPGRADES).map((k) => [k, 0]));

export function defaultSave() {
  // Sound effects and music are on for new players. `muted` is the sound
  // effects switch (its name predates the music); `music` is the music switch.
  // `sfxVol` and `musicVol` are the volume sliders (0-100); the switches don't
  // change them.
  return {
    v: 1, coins: 0, level: 1, best: 1, upgrades: zeroUpgrades(),
    muted: false, music: true, sfxVol: DEFAULT_VOL, musicVol: DEFAULT_VOL,
  };
}

export function statsFromUpgrades(u = {}) {
  const crowd = u.crowd | 0;
  const rate = u.rate | 0;
  const dmg = u.dmg | 0;
  return {
    startCrowd: 6 + crowd * 3,
    fireRate: 5 + rate * 0.5, // volleys per second
    damage: 1 + dmg,
  };
}

export function upgradeCost(key, lvl) {
  const u = UPGRADES[key];
  return Math.round(u.base * Math.pow(u.growth, lvl));
}

// Returns a new save with the upgrade bought, or null if it can't be bought.
export function buyUpgrade(save, key) {
  const u = UPGRADES[key];
  if (!u) return null;
  const lvl = save.upgrades[key] | 0;
  if (lvl >= u.max) return null;
  const cost = upgradeCost(key, lvl);
  if (save.coins < cost) return null;
  return { ...save, coins: save.coins - cost, upgrades: { ...save.upgrades, [key]: lvl + 1 } };
}

// Merge whatever is stored with defaults; ignore junk.
export function sanitize(raw) {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const int = (v, lo, hi, def) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : def);
  const u = raw.upgrades && typeof raw.upgrades === 'object' ? raw.upgrades : {};
  return {
    v: 1,
    coins: int(raw.coins, 0, 1e9, 0),
    level: int(raw.level, 1, 9999, 1),
    best: int(raw.best, 1, 9999, 1),
    // Every known upgrade, clamped to its max; unknown keys are dropped and
    // missing ones (saves from before the weapons) start at 0.
    upgrades: Object.fromEntries(Object.keys(UPGRADES).map((k) => [k, int(u[k], 0, UPGRADES[k].max, 0)])),
    ...soundPrefs(raw, d),
    sfxVol: vol(raw.sfxVol),
    musicVol: vol(raw.musicVol),
  };
}

// A slider value: a whole number 0-100; anything else (missing in saves from
// before the sliders, junk) is the default.
export function vol(v) {
  return Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : DEFAULT_VOL;
}

// A save from before the music existed has no `music` field. The old game
// defaulted to muted and wrote `muted: true` into every save, so an old mute
// is not a real choice: those saves get sound and music on once. Saves that
// have a `music` field keep both choices.
export function soundPrefs(raw, d = defaultSave()) {
  if (typeof raw.music !== 'boolean') return { muted: d.muted, music: d.music };
  const muted = typeof raw.muted === 'boolean' ? raw.muted : d.muted;
  return { muted, music: raw.music };
}

export function loadSave(storage) {
  try {
    const s = storage && storage.getItem(SAVE_KEY);
    return sanitize(s ? JSON.parse(s) : null);
  } catch {
    return defaultSave();
  }
}

export function writeSave(storage, save) {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

// Bank a finished run. won=true advances the level.
export function recordRun(save, { won, coins }) {
  const level = won ? save.level + 1 : save.level;
  return { ...save, coins: save.coins + Math.max(0, coins | 0), level, best: Math.max(save.best, level) };
}
