// Sound effect recipes and the pure rules around them: which sim event makes
// which sound, how often a sound may repeat, and how many may play at once.
// Nothing here touches WebAudio, so it all runs under `bun test`.
//
// A recipe is a list of layers. Each layer is one oscillator (or a white-noise
// source) with a pitch path, a volume envelope and an optional filter:
//   w      wave: 'square' | 'pulse25' | 'pulse12' | 'triangle' | 'sawtooth' | 'sine' | 'noise'
//   f      [start, end] Hz, an exponential slide (a single number = steady pitch)
//   arp    Hz list stepped every `step` seconds (chiptune arpeggio; overrides f)
//   vib    [rate Hz, depth as a fraction of the pitch]
//   dur    seconds; at: start delay in seconds
//   v      peak volume; a: attack seconds; hold: true keeps the level up until
//          the last 30% (for notes and jingles) instead of decaying at once
//   filt   { t: 'lowpass' | 'highpass' | 'bandpass', f: [start, end] Hz, q }
// Recipe fields: prio (0 = filler, 3 = must play), gap (min ms between two
// starts of this sound), jit (random pitch spread, fraction).

export const RECIPES = {
  // ---- your crowd firing and hitting things (frequent: quiet, rate-limited) ----
  shot: { prio: 0, gap: 75, jit: 0.06, layers: [{ w: 'pulse12', f: [1500, 620], dur: 0.045, v: 0.07 }] },
  rocket: {
    prio: 0, gap: 90, layers: [
      { w: 'noise', dur: 0.24, v: 0.126, a: 0.03, filt: { t: 'bandpass', f: [700, 3200], q: 2 } },
      { w: 'sawtooth', f: [180, 520], dur: 0.2, v: 0.042 },
    ],
  },
  hit: { prio: 0, gap: 70, jit: 0.1, layers: [{ w: 'noise', dur: 0.03, v: 0.07, filt: { t: 'highpass', f: 2600 } }] },
  hitBig: {
    prio: 0, gap: 90, jit: 0.05, layers: [
      { w: 'square', f: [170, 90], dur: 0.06, v: 0.084 },
      { w: 'noise', dur: 0.04, v: 0.07, filt: { t: 'lowpass', f: 900 } },
    ],
  },
  hitWall: {
    prio: 0, gap: 80, jit: 0.04, layers: [
      { w: 'square', f: [560, 500], dur: 0.03, v: 0.056 },
      { w: 'noise', dur: 0.025, v: 0.07, filt: { t: 'bandpass', f: 2400, q: 3 } },
    ],
  },
  shieldHit: {
    prio: 0, gap: 90, jit: 0.04, layers: [
      { w: 'triangle', f: [1900, 1750], dur: 0.08, v: 0.098 },
      { w: 'square', f: 2850, dur: 0.025, v: 0.035 },
    ],
  },
  shieldBreak: {
    prio: 2, gap: 120, layers: [
      { w: 'noise', dur: 0.35, v: 0.2, filt: { t: 'bandpass', f: [5000, 1400], q: 1.5 } },
      { w: 'square', arp: [1568, 1175, 880, 659], step: 0.045, dur: 0.2, v: 0.084 },
    ],
  },
  bossHit: {
    prio: 1, gap: 75, jit: 0.05, layers: [
      { w: 'square', f: [130, 80], dur: 0.06, v: 0.084 },
      { w: 'noise', dur: 0.05, v: 0.084, filt: { t: 'lowpass', f: 700 } },
    ],
  },
  gateTickGood: { prio: 0, gap: 110, jit: 0.03, layers: [{ w: 'triangle', f: 1320, dur: 0.03, v: 0.042 }] },
  gateTickBad: { prio: 0, gap: 110, jit: 0.03, layers: [{ w: 'triangle', f: 700, dur: 0.03, v: 0.042 }] },

  // ---- enemies going down ----
  kill: {
    prio: 1, gap: 55, jit: 0.08, layers: [
      { w: 'square', f: [440, 90], dur: 0.09, v: 0.098 },
      { w: 'noise', dur: 0.07, v: 0.084, filt: { t: 'lowpass', f: [1600, 300] } },
    ],
  },
  clash: {
    prio: 1, gap: 85, jit: 0.06, layers: [
      { w: 'noise', dur: 0.07, v: 0.1, filt: { t: 'bandpass', f: 1800, q: 1.2 } },
      { w: 'square', f: [240, 110], dur: 0.08, v: 0.07 },
    ],
  },
  killGiant: {
    prio: 2, gap: 150, layers: [
      { w: 'noise', dur: 0.55, v: 0.3, filt: { t: 'lowpass', f: [1300, 90] } },
      { w: 'square', f: [120, 35], dur: 0.45, v: 0.12 },
      { w: 'triangle', f: [80, 30], dur: 0.5, v: 0.25 },
    ],
  },
  killWall: {
    prio: 2, gap: 150, layers: [
      { w: 'noise', dur: 0.45, v: 0.26, filt: { t: 'lowpass', f: [1000, 140] } },
      { w: 'square', arp: [196, 147, 110], step: 0.06, dur: 0.2, v: 0.098 },
    ],
  },
  split: { prio: 1, gap: 90, layers: [{ w: 'square', arp: [520, 780], step: 0.04, vib: [30, 0.03], dur: 0.1, v: 0.084 }] },
  boom: {
    prio: 1, gap: 70, jit: 0.06, layers: [
      { w: 'noise', dur: 0.38, v: 0.26, filt: { t: 'lowpass', f: [1700, 120] } },
      { w: 'triangle', f: [130, 40], dur: 0.32, v: 0.2 },
    ],
  },

  // ---- gates ----
  gateGood: {
    prio: 2, gap: 120, layers: [
      { w: 'pulse25', arp: [523, 659, 784, 1047, 1319], step: 0.045, dur: 0.27, v: 0.1, hold: true },
      { w: 'triangle', f: [262, 523], dur: 0.2, v: 0.1 },
    ],
  },
  gateBad: {
    prio: 2, gap: 120, layers: [
      { w: 'sawtooth', f: [330, 110], dur: 0.3, v: 0.126, filt: { t: 'lowpass', f: 1300 } },
      { w: 'square', arp: [311, 233], step: 0.08, dur: 0.18, v: 0.07 },
    ],
  },
  gateNeutral: { prio: 2, gap: 120, layers: [{ w: 'triangle', f: 440, dur: 0.12, v: 0.112 }] },
  gateFlip: { prio: 2, gap: 100, layers: [{ w: 'square', arp: [523, 659, 784, 1047], step: 0.035, dur: 0.16, v: 0.098, hold: true }] },
  gateSwap: { prio: 1, gap: 300, layers: [{ w: 'square', arp: [660, 440, 660, 440], step: 0.05, dur: 0.2, v: 0.07 }] },
  gambleGood: {
    prio: 2, gap: 150, layers: [
      { w: 'pulse25', arp: [784, 988, 1175, 1568], step: 0.06, dur: 0.3, v: 0.1, hold: true },
      { w: 'triangle', f: 1568, at: 0.24, dur: 0.26, v: 0.098 },
    ],
  },
  gambleBad: {
    prio: 2, gap: 150, layers: [
      { w: 'sawtooth', f: [233, 104], vib: [6, 0.04], dur: 0.45, v: 0.126, hold: true, filt: { t: 'lowpass', f: 900 } },
    ],
  },
  fork: { prio: 2, gap: 200, layers: [{ w: 'triangle', arp: [392, 523], step: 0.06, dur: 0.14, v: 0.112 }] },
  forkRisky: { prio: 2, gap: 200, layers: [{ w: 'square', arp: [392, 370, 392, 370], step: 0.05, dur: 0.2, v: 0.07 }] },

  // ---- hazards hurting your crowd ----
  hurt: { prio: 1, gap: 120, jit: 0.05, layers: [{ w: 'square', f: [210, 120], dur: 0.1, v: 0.084 }] },
  // The boss chewing through your crowd (steady while in contact: sparse, soft).
  bossBite: {
    prio: 1, gap: 240, jit: 0.08, layers: [
      { w: 'noise', dur: 0.09, v: 0.112, filt: { t: 'lowpass', f: [1400, 300] } },
      { w: 'square', f: [150, 90], dur: 0.08, v: 0.049 },
    ],
  },
  saw: {
    prio: 1, gap: 120, jit: 0.04, layers: [
      { w: 'sawtooth', f: 880, vib: [42, 0.12], dur: 0.14, v: 0.07 },
      { w: 'noise', dur: 0.12, v: 0.084, filt: { t: 'bandpass', f: 3400, q: 2 } },
    ],
  },
  crush: {
    prio: 2, gap: 220, layers: [
      { w: 'noise', dur: 0.3, v: 0.3, filt: { t: 'lowpass', f: [800, 80] } },
      { w: 'square', f: [95, 40], dur: 0.24, v: 0.1 },
    ],
  },
  splash: {
    prio: 2, gap: 240, jit: 0.05, layers: [
      { w: 'noise', dur: 0.45, v: 0.22, a: 0.012, filt: { t: 'bandpass', f: [1500, 380], q: 1 } },
      { w: 'sine', f: [700, 160], dur: 0.18, v: 0.098 },
    ],
  },
  arrowFire: {
    prio: 0, gap: 90, jit: 0.05, layers: [
      { w: 'triangle', f: [1500, 480], dur: 0.12, v: 0.07 },
      { w: 'noise', dur: 0.05, v: 0.042, filt: { t: 'highpass', f: 4000 } },
    ],
  },
  arrowHit: {
    prio: 1, gap: 80, jit: 0.05, layers: [
      { w: 'noise', dur: 0.06, v: 0.1, filt: { t: 'bandpass', f: 1500, q: 1.5 } },
      { w: 'square', f: [300, 150], dur: 0.07, v: 0.07 },
    ],
  },
  arrowMiss: { prio: 0, gap: 80, jit: 0.08, layers: [{ w: 'noise', dur: 0.04, v: 0.07, filt: { t: 'lowpass', f: 900 } }] },
  ambush: {
    prio: 3, gap: 300, layers: [
      { w: 'square', arp: [880, 660, 880, 660], step: 0.07, dur: 0.3, v: 0.112, hold: true },
      { w: 'sawtooth', f: [160, 100], dur: 0.3, v: 0.098, filt: { t: 'lowpass', f: 1200 } },
    ],
  },

  // ---- the boss ----
  bossRoar: {
    prio: 3, gap: 500, layers: [
      { w: 'sawtooth', f: [120, 70], vib: [9, 0.08], dur: 0.9, v: 0.16, a: 0.04, hold: true, filt: { t: 'lowpass', f: [1500, 450] } },
      { w: 'noise', dur: 0.8, v: 0.14, a: 0.05, filt: { t: 'lowpass', f: [700, 200] } },
    ],
  },
  bossPhase2: {
    prio: 3, gap: 500, layers: [
      { w: 'sawtooth', f: [90, 170], vib: [12, 0.1], dur: 0.75, v: 0.15, a: 0.03, hold: true, filt: { t: 'lowpass', f: 1600 } },
      { w: 'square', f: [45, 62], dur: 0.7, v: 0.112, hold: true },
      { w: 'noise', dur: 0.6, v: 0.12, a: 0.04, filt: { t: 'lowpass', f: [500, 1200] } },
    ],
  },
  windup: { prio: 2, gap: 300, layers: [{ w: 'square', f: [200, 800], vib: [14, 0.05], dur: 0.45, v: 0.07, a: 0.05, hold: true }] },
  bossSlam: {
    prio: 3, gap: 200, layers: [
      { w: 'noise', dur: 0.6, v: 0.36, filt: { t: 'lowpass', f: [900, 60] } },
      { w: 'sine', f: [85, 30], dur: 0.55, v: 0.4 },
      { w: 'square', f: [62, 35], dur: 0.3, v: 0.126 },
    ],
  },
  boulder: {
    prio: 2, gap: 160, jit: 0.06, layers: [
      { w: 'noise', dur: 0.45, v: 0.28, filt: { t: 'lowpass', f: [520, 80] } },
      { w: 'triangle', f: [95, 40], dur: 0.4, v: 0.28 },
    ],
  },

  // ---- weapon modes ----
  // Switching: a click-clack as the new weapon comes out, a bright ping when it is armed.
  weaponSwitch: {
    prio: 2, gap: 120, layers: [
      { w: 'square', arp: [330, 494], step: 0.035, dur: 0.08, v: 0.07 },
      { w: 'noise', dur: 0.04, v: 0.07, filt: { t: 'bandpass', f: 2200, q: 2 } },
    ],
  },
  weaponReady: { prio: 2, gap: 150, layers: [{ w: 'pulse25', arp: [784, 1175], step: 0.05, dur: 0.13, v: 0.09, hold: true }] },
  // Melee: a noise swoosh sweeping up, with a falling blade edge.
  slash: {
    prio: 1, gap: 90, jit: 0.05, layers: [
      { w: 'noise', dur: 0.14, v: 0.17, a: 0.015, filt: { t: 'bandpass', f: [700, 4200], q: 1.4 } },
      { w: 'sawtooth', f: [1100, 380], dur: 0.08, v: 0.045, filt: { t: 'lowpass', f: 3000 } },
    ],
  },
  // Whirlwind: a longer swoosh that rises and falls with a spinning wobble.
  whirl: {
    prio: 2, gap: 150, layers: [
      { w: 'noise', dur: 0.32, v: 0.2, a: 0.03, filt: { t: 'bandpass', f: [500, 3600], q: 1.2 } },
      { w: 'square', f: [260, 520], vib: [18, 0.08], dur: 0.28, v: 0.05 },
    ],
  },
  // Shield: a metal clang (clashes and blocked arrows).
  shieldBlock: {
    prio: 1, gap: 90, jit: 0.04, layers: [
      { w: 'triangle', f: [2300, 2050], dur: 0.12, v: 0.09 },
      { w: 'square', f: [620, 560], dur: 0.05, v: 0.06 },
      { w: 'noise', dur: 0.04, v: 0.07, filt: { t: 'highpass', f: 3500 } },
    ],
  },
  bash: {
    prio: 1, gap: 150, layers: [
      { w: 'triangle', f: [150, 55], dur: 0.16, v: 0.22 },
      { w: 'noise', dur: 0.1, v: 0.12, filt: { t: 'lowpass', f: [1400, 200] } },
    ],
  },
  reflect: { prio: 1, gap: 110, layers: [{ w: 'triangle', f: [700, 2100], dur: 0.1, v: 0.08 }] },
  ricochet: { prio: 0, gap: 90, jit: 0.08, layers: [{ w: 'triangle', f: [1900, 2800], dur: 0.06, v: 0.05 }] },
  // Soldiers joining (Rally, Recruit): a little rising fanfare.
  join: { prio: 1, gap: 200, layers: [{ w: 'pulse25', arp: [523, 659, 784], step: 0.04, dur: 0.14, v: 0.08, hold: true }] },
  fortress: {
    prio: 2, gap: 400, layers: [
      { w: 'square', arp: [392, 523, 659, 784], step: 0.05, dur: 0.24, v: 0.08, hold: true },
      { w: 'triangle', f: [196, 392], dur: 0.3, v: 0.12 },
    ],
  },
  lastStand: {
    prio: 3, gap: 1000, layers: [
      { w: 'square', arp: [220, 330, 440, 659], step: 0.08, dur: 0.42, v: 0.1, hold: true },
      { w: 'sawtooth', f: [110, 220], dur: 0.4, v: 0.08, filt: { t: 'lowpass', f: 1500 } },
    ],
  },

  // ---- pickups and UI ----
  coin: { prio: 0, gap: 45, layers: [{ w: 'pulse25', arp: [988, 1319], step: 0.05, dur: 0.14, v: 0.063, hold: true }] },
  powerup: {
    prio: 2, gap: 150, layers: [
      { w: 'pulse25', arp: [523, 659, 784, 1047, 1319, 1568, 2093], step: 0.035, dur: 0.28, v: 0.126, hold: true },
      { w: 'triangle', f: [262, 1047], dur: 0.3, v: 0.112 },
    ],
  },
  hint: { prio: 2, gap: 400, layers: [{ w: 'triangle', arp: [880, 1319], step: 0.08, dur: 0.22, v: 0.112, hold: true }] },
  squeezeOn: { prio: 1, gap: 80, layers: [{ w: 'triangle', f: [330, 520], dur: 0.06, v: 0.084 }] },
  squeezeOff: { prio: 1, gap: 80, layers: [{ w: 'triangle', f: [520, 330], dur: 0.06, v: 0.056 }] },
  win: {
    prio: 3, gap: 1000, layers: [
      { w: 'pulse25', arp: [523, 659, 784, 1047, 784, 1047, 1047], step: 0.1, dur: 0.85, v: 0.11, hold: true },
      { w: 'triangle', arp: [131, 165, 196, 262, 262], step: 0.15, dur: 0.85, v: 0.16, hold: true },
      { w: 'noise', at: 0.4, dur: 0.06, v: 0.07, filt: { t: 'highpass', f: 6000 } },
      { w: 'noise', at: 0.6, dur: 0.06, v: 0.07, filt: { t: 'highpass', f: 6000 } },
    ],
  },
  lose: {
    prio: 3, gap: 1000, layers: [
      { w: 'square', arp: [392, 370, 349, 330], step: 0.2, vib: [6, 0.015], dur: 0.95, v: 0.112, hold: true },
      { w: 'triangle', arp: [98, 92, 87, 82], step: 0.2, dur: 0.95, v: 0.16, hold: true },
    ],
  },
};

// Events that make no sound on purpose (another event already covers them, or
// they are bookkeeping). Everything else the sim emits must map to a recipe.
export const SILENT = new Set(['crowdLoss:arrow', 'crowdLoss:boulder', 'crowdLoss:stomp', 'crowdLoss:ambush',
  'crowdLoss:squad', 'crowdLoss:giant', 'crowdLoss:wall', 'crowdLoss:tower']);

const LOSS = { saw: 'saw', crusher: 'crush', fall: 'splash', boss: 'bossBite' };
const HIT = { squad: 'hit', giant: 'hitBig', wall: 'hitWall', tower: 'hitWall' };

// Sim event -> recipe name, or null for silence.
export function soundFor(e) {
  switch (e.type) {
    case 'shot': return 'shot';
    case 'rocket': return 'rocket';
    case 'enemyHit': return HIT[e.kind] || 'hit';
    case 'shieldHit': return 'shieldHit';
    case 'shieldBreak': return 'shieldBreak';
    case 'bossHit': return 'bossHit';
    case 'gateHit':
      if (e.flipped) return 'gateFlip';
      return e.mood === 'bad' ? 'gateTickBad' : 'gateTickGood';
    case 'kill':
      if (e.kind === 'giant') return 'killGiant';
      if (e.melee) return 'clash';
      if (e.wall) return 'killWall';
      return 'kill';
    case 'split': return 'split';
    case 'boom': return 'boom';
    case 'gate': return e.mood === 'good' ? 'gateGood' : e.mood === 'bad' ? 'gateBad' : 'gateNeutral';
    case 'gateSwap': return 'gateSwap';
    case 'gambleReveal': return e.mood === 'good' ? 'gambleGood' : 'gambleBad';
    case 'forkTaken': return e.risky ? 'forkRisky' : 'fork';
    case 'crowdLoss': {
      const key = `crowdLoss:${e.cause}`;
      if (SILENT.has(key)) return null;
      return LOSS[e.cause] || 'hurt';
    }
    case 'arrowFire': return 'arrowFire';
    case 'arrowLand': return e.hit ? 'arrowHit' : 'arrowMiss';
    case 'ambush': return 'ambush';
    case 'bossStart': return 'bossRoar';
    case 'bossPhase2': return 'bossPhase2';
    case 'bossWindup': return 'windup';
    case 'bossSlam': return 'bossSlam';
    case 'boulderLand': return 'boulder';
    case 'coin': return 'coin';
    case 'powerup': return 'powerup';
    case 'hint': return 'hint';
    case 'squeeze': return e.on ? 'squeezeOn' : 'squeezeOff';
    case 'weaponSwitch': return 'weaponSwitch';
    case 'weaponReady': return 'weaponReady';
    case 'slash': return e.whirl ? 'whirl' : 'slash';
    case 'shieldBlock': return 'shieldBlock';
    case 'bash': return 'bash';
    case 'reflect': return 'reflect';
    case 'ricochet': return 'ricochet';
    case 'join': return 'join';
    case 'fortress': return 'fortress';
    case 'lastStand': return 'lastStand';
    case 'won': return 'win';
    case 'lost': return 'lose';
    default: return null;
  }
}

// Per-sound minimum gap between starts (recipe.gap, in ms).
export function createLimiter(recipes = RECIPES) {
  const last = new Map();
  return {
    allow(name, nowMs) {
      const r = recipes[name];
      if (!r) return false;
      const prev = last.get(name);
      if (prev !== undefined && nowMs - prev < (r.gap || 0)) return false;
      last.set(name, nowMs);
      return true;
    },
    reset() { last.clear(); },
  };
}

// At most `max` sounds at once. When full, a new sound takes the slot of the
// oldest sound with a lower priority (which is stopped); otherwise it is dropped.
// Times are in seconds on the audio clock.
export function createVoicePool(max = 10) {
  const voices = []; // { end, prio, start, stop }
  function prune(now) {
    for (let i = voices.length - 1; i >= 0; i--) if (voices[i].end <= now) voices.splice(i, 1);
  }
  return {
    get size() { return voices.length; },
    max,
    // Returns the new voice if a sound of this priority may start now, else null.
    admit(now, dur, prio, stop = null) {
      prune(now);
      if (voices.length >= max) {
        let victim = -1;
        for (let i = 0; i < voices.length; i++) {
          const v = voices[i];
          if (v.prio < prio && (victim < 0 || v.prio < voices[victim].prio
            || (v.prio === voices[victim].prio && v.start < voices[victim].start))) victim = i;
        }
        if (victim < 0) return null;
        const [v] = voices.splice(victim, 1);
        if (v.stop) { try { v.stop(now); } catch { /* already stopped */ } }
      }
      const voice = { end: now + dur, prio, start: now, stop };
      voices.push(voice);
      return voice;
    },
    clear() { voices.length = 0; },
  };
}

// Length of a recipe in seconds (the latest layer end).
export function recipeDur(r) {
  let d = 0;
  for (const l of r.layers) d = Math.max(d, (l.at || 0) + l.dur);
  return d;
}

// Frequency path of a layer, sampled `rate` times a second (for
// setValueCurveAtTime): slide, arpeggio steps and vibrato, all baked in.
export function freqCurve(l, rate = 400) {
  const n = Math.max(2, Math.ceil(l.dur * rate) + 1);
  const out = new Float32Array(n);
  const f = Array.isArray(l.f) ? l.f : [l.f ?? 440, l.f ?? 440];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * l.dur;
    let hz;
    if (l.arp) hz = l.arp[Math.min(l.arp.length - 1, Math.floor(t / l.step))];
    else hz = f[0] * Math.pow(f[1] / f[0], t / l.dur);
    if (l.vib) hz *= 1 + l.vib[1] * Math.sin(2 * Math.PI * l.vib[0] * t);
    out[i] = Math.max(20, Math.min(20000, hz));
  }
  return out;
}

// Fourier terms of a pulse wave with the given duty (for createPeriodicWave).
export function pulseTerms(duty, n = 32) {
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let k = 1; k < n; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
  return { real, imag };
}
