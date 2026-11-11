// Tunable constants shared by the simulation, generator and renderer.
// World units: the track is TRACK_W wide (x from 0 to 100). y grows forward.

export const DT = 1 / 60;            // fixed simulation step (seconds)
export const TRACK_W = 100;
export const X_MIN = 6;              // crowd centre clamp
export const X_MAX = 94;
export const KEY_SPEED = 75;         // units/s when steering with keys
export const MAX_CROWD = 9999;
export const RENDER_CAP = 150;       // max soldier sprites drawn for the crowd

export const BULLET_SPEED = 120;     // units/s
export const BULLET_RANGE = 115;     // how far ahead of the crowd a bullet lives
export const SPREAD_VX = 38;         // sideways speed of spread-shot bullets

export const BUFF_TIME = 6;          // power-up duration (seconds)
export const RAPID_MULT = 1.8;       // fire-rate multiplier while "rapid" is active

export const ENEMY_WAKE = 150;       // squads start marching when this close
export const ENEMY_MARCH = 7;        // squad marching speed toward the crowd (units/s)

export const BOSS_R = 14;
export const SOLDIER_DPS = 0.6;      // boss HP each soldier removes per second in melee

// Multiplier gate ladder. Bullets move a multiplier gate one notch to the right
// every `hitsPerStep` hits: ÷3 → ÷2 → ×1 → ×2. Shooting stops at ×2
// (MUL_SHOT_CAP); ×3 gates only exist when the level spawns them.
export const MUL_LADDER = [
  { label: '÷3', mul: 1, div: 3 },
  { label: '÷2', mul: 1, div: 2 },
  { label: '×1', mul: 1, div: 1 },
  { label: '×2', mul: 2, div: 1 },
  { label: '×3', mul: 3, div: 1 },
];
export const MUL_SHOT_CAP = 3; // index of ×2 in MUL_LADDER
export const MAX_STREAMS = 3;  // parallel bullet streams at most (1 + 1 per 40 soldiers)
export const STREAM_EVERY = 40;

// ---- v2 mechanics -------------------------------------------------------
// Level on which each mechanic first appears. On that level it is the only new
// thing, its first appearance shows a short hint, and it is guaranteed to show
// up. Later levels mix it in with the others.
export const FEATURES = {
  moving: 2,      // gates that slide or swap values
  gamble: 3,      // "?" gates
  bridge: 4,      // narrow bridges (and the squeeze move)
  saws: 5,        // sweeping saw blades
  bossAttacks: 6, // boss throws boulders and stomps
  archers: 7,     // archer towers that shoot back
  weapons: 8,     // rocket / laser / magnet pickups
  crushers: 9,    // crushers that slam down
  fork: 10,       // fork in the road
  giants: 11,     // giant enemies
  shields: 12,    // shielded squads
  splitters: 13,  // squads that split when hit
};
export const SQUEEZE_LEVEL = FEATURES.bridge; // the squeeze pad shows from here on

export const SQUEEZE_SHRINK = 0.5;   // packed crowd radius = normal * (1 - this)
export const SQUEEZE_RATE = 7;       // how fast the crowd packs / spreads (1/s)
export const SQUEEZE_FIRE = 0.6;     // fire-rate multiplier while packed (and 1 stream)

export const HINT_AHEAD = 150;       // hints show when the thing is this far ahead

export const SAW_R = 5.5;            // saw blade radius (world units)
export const SAW_RATE = 0.9;         // share of the touching soldiers lost per second
export const CRUSH_RATE = 3.2;       // same for a crusher that is down
export const FALL_RATE = 2.6;        // same for soldiers hanging off a bridge
export const MIN_LOSS_RATE = 4;      // touching a hazard always costs at least this many soldiers/s

export const ARROW_FLIGHT = 1.15;    // seconds an arrow is in the air
export const ARROW_R = 3;            // arrow hit radius at the landing point
export const TOWER_RANGE = 130;      // towers shoot when the crowd is this close
export const TOWER_W = 9;            // tower footprint width

export const GAMBLE_REVEAL = 30;     // "?" gates reveal when the crowd is this close

export const COIN_R = 1.6;           // pickup radius of a track coin
export const MAGNET_R = 55;          // magnet pulls coins this close
export const ROCKET_EVERY = 0.4;     // seconds between rockets
export const ROCKET_SPLASH = 10;     // rocket blast radius
export const ROCKET_DMG = 4;         // rocket damage = bullet damage * this

// ---- v3: army penalties -------------------------------------------------
// From AMBUSH_FROM on, enemy squads are sized as a share of the player's crowd
// when they come into view (never smaller than their level-based size), and
// any enemy that gets past the crowd alive "ambushes" it for AMBUSH_MULT times
// its remaining strength. Bosses are unchanged.
export const AMBUSH_FROM = 3;
export const AMBUSH_MULT = 2;
export const SCALE_SHARE_MIN = 0.15;  // squad size as a share of the crowd at AMBUSH_FROM...
export const SCALE_SHARE_MAX = 0.5;   // ...rising to this by SCALE_FULL_LEVEL
export const SCALE_FULL_LEVEL = 12;
export const SCALE_FREE = 100;        // the first this-many soldiers don't count toward the share
export const SCALE_VIEW = 175;        // squads are sized when this close (the view distance)
export const AMBUSH_WARN = 25;        // warning arrow when a squad this close will slip past
