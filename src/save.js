// Upgrades, costs and the localStorage save. Storage is injectable for tests.

export const SAVE_KEY = 'crowd-runner-save-v1';

export const UPGRADES = {
  crowd: { name: 'Starting crowd', base: 12, growth: 1.42, max: 30 },
  rate: { name: 'Fire rate', base: 18, growth: 1.45, max: 20 },
  dmg: { name: 'Bullet damage', base: 30, growth: 1.7, max: 10 },
};

export function defaultSave() {
  // Sound effects and music are on for new players. `muted` is the sound
  // effects switch (its name predates the music); `music` is the music switch.
  return { v: 1, coins: 0, level: 1, best: 1, upgrades: { crowd: 0, rate: 0, dmg: 0 }, muted: false, music: true };
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
    upgrades: {
      crowd: int(u.crowd, 0, UPGRADES.crowd.max, 0),
      rate: int(u.rate, 0, UPGRADES.rate.max, 0),
      dmg: int(u.dmg, 0, UPGRADES.dmg.max, 0),
    },
    ...soundPrefs(raw, d),
  };
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
