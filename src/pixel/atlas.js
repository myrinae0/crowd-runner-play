// Kenney tile source rects, distance bands and the sprite edge check. Pure (no
// canvas), so tests can verify every frame the renderer uses.
//
// Why sprites got cut off in the mockup: Tiny Town's tall trees are TWO tiles
// stacked (the crown is tile 3 or 4, the trunk tile 15 or 16 below it), and the
// round "bush" (5) is the top of a hedge, but the mockup drew single 16x16
// tiles, so it showed a crown with no trunk or a trunk with no crown. Here every
// multi-tile object is one source rect covering all of its tiles, single-tile
// objects are only used when they are complete, and checkFrame() proves it:
// no opaque pixel may touch the edge of a source rect, except the bottom edge
// of things that stand on the ground, or an edge listed in `allow` whose
// pixels are all outline colour (a closed outline that happens to sit on the
// tile edge). Code-drawn sprites get a 1 px transparent border in the atlas.

export const SHEETS = {
  town: { src: 'assets/pixel/tiny-town.png', cols: 12, w: 192, h: 176 },
  battle: { src: 'assets/pixel/tiny-battle.png', cols: 18, w: 288, h: 176 },
};

export const OUTLINE_RGB = [0x3f, 0x26, 0x31];

const T = 16;
export function tileRect(sheet, id, wTiles = 1, hTiles = 1) {
  const cols = SHEETS[sheet].cols;
  return { sheet, x: (id % cols) * T, y: Math.floor(id / cols) * T, w: wTiles * T, h: hTiles * T };
}

// Sprites cut from the Kenney sheets. `ground`: stands on the ground (its
// bottom edge may be opaque). `allow`: other edges that may hold outline pixels.
export const KENNEY = {
  // (Kenney's 2 px outline reaches the tile edge on top of these trees; the
  // check allows that only where every edge pixel is outline colour.)
  treeGreen: { ...tileRect('town', 28), ground: true, allow: 't' },
  treeOrange: { ...tileRect('town', 27), ground: true, allow: 't' },
  // Two-tile trees: crown (row 0) and trunk (row 1) as ONE rect.
  treeTallGreen: { ...tileRect('town', 4, 1, 2), allow: 'tlr' },
  treeTallOrange: { ...tileRect('town', 3, 1, 2), allow: 'tlr' },
  mushrooms: { ...tileRect('town', 29), allow: 'lr' },
  sign: tileRect('town', 83),
  flagRed: { ...tileRect('battle', 70), ground: true, allow: 't' },
  flagBlue: { ...tileRect('battle', 52), ground: true, allow: 't' },
};

// Tiles used as repeating floor textures (they are meant to touch their edges).
export const FLOOR_TILES = {
  grass: [tileRect('town', 0), tileRect('town', 1), tileRect('town', 2)],
  roadL: tileRect('town', 24),
  road: tileRect('town', 25),
  roadR: tileRect('town', 26),
  water: tileRect('battle', 37),
};

// ---- distance bands --------------------------------------------------------
// Sprites are never scaled by fractional amounts. Things in the distance use
// smaller hand-made frames (L near, M mid, S far); big things (giants, the
// boss, scenery near the camera) pick an integer scale or a pre-drawn size.
export const BAND_L = 0.78; // projection scale s at or above which the L frames are used
export const BAND_M = 0.48;
export function bandFor(s) {
  return s >= BAND_L ? 'L' : s >= BAND_M ? 'M' : 'S';
}

// Integer scale (1..max) for an art sprite `artPx` tall that should look
// `wantPx` tall: the largest whole multiple that doesn't exceed it by much.
export function intScale(wantPx, artPx, max = 4) {
  return Math.max(1, Math.min(max, Math.floor(wantPx / artPx + 0.25)));
}

// Picks the largest pre-drawn size not bigger than `want` (or the smallest).
export function pickSize(sizes, want) {
  let best = sizes[0];
  for (const s of sizes) if (s <= want + 0.5 && s > best) best = s;
  return best;
}

// ---- edge check ---------------------------------------------------------------
// img: { width, rgba } (whole sheet). Returns the list of problems (empty if
// the frame is whole): which edge has opaque pixels and how many.
export function checkFrame(img, rect, opts = {}) {
  const { ground = false, allow = '' } = { ...rect, ...opts };
  const px = (x, y) => (((rect.y + y) * img.width) + rect.x + x) * 4;
  const problems = [];
  const edges = {
    t: Array.from({ length: rect.w }, (_, x) => [x, 0]),
    b: Array.from({ length: rect.w }, (_, x) => [x, rect.h - 1]),
    l: Array.from({ length: rect.h }, (_, y) => [0, y]),
    r: Array.from({ length: rect.h }, (_, y) => [rect.w - 1, y]),
  };
  for (const [edge, pts] of Object.entries(edges)) {
    if (edge === 'b' && ground) continue;
    let opaque = 0, nonOutline = 0;
    for (const [x, y] of pts) {
      const q = px(x, y);
      if (img.rgba[q + 3] < 16) continue;
      opaque += 1;
      if (img.rgba[q] !== OUTLINE_RGB[0] || img.rgba[q + 1] !== OUTLINE_RGB[1] || img.rgba[q + 2] !== OUTLINE_RGB[2]) nonOutline += 1;
    }
    if (!opaque) continue;
    if (allow.includes(edge) && !nonOutline) continue;
    problems.push(`${edge}: ${opaque} opaque px`);
  }
  // A frame that is entirely empty is a wrong rect too.
  let any = false;
  for (let y = 0; y < rect.h && !any; y++) for (let x = 0; x < rect.w; x++) if (img.rgba[px(x, y) + 3] > 16) { any = true; break; }
  if (!any) problems.push('empty');
  return problems;
}

// Shelf-packs sprites ({ name: { w, h } }) into an atlas `width` wide, each
// with a 1 px clear border: returns { frames: { name: { x, y, w, h } }, height }
// where w and h include the border (the rect drawn from the atlas).
export function packFrames(sizes, width = 256) {
  const names = Object.keys(sizes).sort((a, b) => sizes[b].h - sizes[a].h || (a < b ? -1 : 1));
  const frames = {};
  let x = 0, y = 0, rowH = 0;
  for (const n of names) {
    const w = sizes[n].w + 2, h = sizes[n].h + 2;
    if (x + w > width) { x = 0; y += rowH; rowH = 0; }
    frames[n] = { x, y, w, h };
    x += w;
    rowH = Math.max(rowH, h);
  }
  return { frames, height: y + rowH };
}

// Copies sprites ({ name: { w, h, rgba } }) into an RGBA atlas image laid out
// by packFrames. Pure, so tests can run checkFrame over the real atlas.
export function buildAtlasImage(sprites, width = 256) {
  const { frames, height } = packFrames(sprites, width);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (const [n, sp] of Object.entries(sprites)) {
    const f = frames[n];
    for (let y = 0; y < sp.h; y++) rgba.set(sp.rgba.subarray(y * sp.w * 4, (y + 1) * sp.w * 4), ((f.y + 1 + y) * width + f.x + 1) * 4);
  }
  return { width, height, rgba, frames };
}
