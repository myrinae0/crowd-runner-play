// Shared pixel-art palette. Colours follow Kenney's Tiny Battle / Tiny Town
// packs (CC0) so code-drawn sprites sit next to the tile art without clashing.

export const OUT = '#3f2631'; // Kenney outline colour

export const PAL = {
  k: OUT,
  r: '#e84537', // warning red
  // skin
  s: '#f7c282', S: '#e19a65',
  // greys (guns, steel)
  g: '#c0cbdc', G: '#8b9bb4', x: '#5a6988',
  // browns (boots, wood, trunks)
  w: '#bd6c4a', W: '#7a4434', o: '#eaa56c',
  // greens (trees, hedges)
  e: '#84c669', E: '#479f4a', n: '#2f6e3c',
  // oranges / gold
  y: '#ffd23f', Y: '#e09e12', v: '#fff3a6', c: '#fdbe53', C: '#e38628',
  // whites
  '#': '#ffffff', '+': '#d7e1ee',
  // shadow (drawn semi-transparent)
  '~': 'rgba(43,29,43,0.32)',
};

// Team colours replace the letters L (light), M (mid) and D (dark).
export const TEAMS = {
  // O: outline for soldiers (team-tinted, so a dense crowd reads as its
  // colour instead of a dark mass).
  blue: { L: '#00c6f4', M: '#009adc', D: '#0077c5', O: '#14306a' },
  red: { L: '#ff7571', M: '#e84537', D: '#aa2c23', O: '#5a1414' },
  purple: { L: '#d29bff', M: '#a24bf0', D: '#6a2aa8', O: '#331060' },
};

// Parses '#rgb', '#rrggbb' or 'rgba(r,g,b,a)' into [r, g, b, a] (0-255).
export function rgba(col) {
  if (col[0] === '#') {
    const h = col.length === 4 ? col.slice(1).split('').map((c) => c + c).join('') : col.slice(1);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 255];
  }
  const m = col.match(/rgba?\(([^)]+)\)/);
  const p = m[1].split(',').map((v) => parseFloat(v));
  return [p[0], p[1], p[2], Math.round((p[3] ?? 1) * 255)];
}

// Packs a colour into the 32-bit little-endian RGBA layout ImageData uses.
export function rgba32(col) {
  const [r, g, b, a] = Array.isArray(col) ? col : rgba(col);
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}
