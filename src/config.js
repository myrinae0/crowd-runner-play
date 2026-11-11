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
