// Low-res buffer size and the perspective used to draw it (pure).
//
// The scene is drawn into a small buffer (about 200-250 art pixels wide) and
// blown up by a whole number of device pixels, so every art pixel is the same
// size on screen. The camera looks down the track at a horizon (SNES "Mode 7"
// style): the floor is projected row by row.

export const MARGIN = 4;     // spare art pixels round the buffer, for screen shake
export const K = 150;        // perspective strength (smaller = stronger)
export const VIEW = 175;     // how far ahead (world units) game objects are drawn
export const FAR = 700;      // scenery is drawn this far (beyond VIEW, into the haze)
export const HUD_H = 22;     // top bar height (art px)

// Whole-number device pixels per art pixel for a device-pixel canvas size.
export function pickScale(bw, bh) {
  const S = Math.max(1, Math.min(Math.round(bh / 450), Math.floor(bw / 170)));
  return { S, LW: Math.ceil(bw / S), LH: Math.ceil(bh / S) };
}

// Projection for an LW x LH buffer (plus MARGIN on every side).
export function makeView(LW, LH) {
  const M = MARGIN;
  const hz = M + Math.round(LH * 0.17);
  const baseY = M + Math.round(LH * 0.82);
  const trackW = Math.min(LW * 0.78, LH * 0.5);
  const ppu = trackW / 100;
  const cx = M + LW / 2;
  const span = baseY - hz;
  const bottom = M * 2 + LH;
  const sB = (bottom - hz) / span;
  const nearD = K / sB - K - 2;
  return { M, LW, LH, W: LW + 2 * M, H: LH + 2 * M, hz, baseY, span, ppu, cx, nearD, K };
}

// World (x across 0..100, d ahead of the crowd) -> buffer pixel and scale.
export function project(v, x, d) {
  const s = v.K / (v.K + Math.max(d, -v.K * 0.6));
  return { x: v.cx + (x - 50) * v.ppu * s, y: v.hz + v.span * s, s };
}

// Distance ahead for a buffer row y (inverse of project).
export function rowDist(v, y) {
  const s = (y + 0.5 - v.hz) / v.span;
  return v.K / s - v.K;
}
