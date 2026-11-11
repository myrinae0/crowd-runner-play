// Small seeded PRNG (mulberry32) plus helpers. Deterministic across platforms.

export function hashSeed(...parts) {
  // FNV-1a over the string form of all parts -> uint32
  let h = 0x811c9dc5;
  const str = parts.join('|');
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function createRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), // inclusive
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    weighted(items) {
      // items: [[value, weight], ...]
      let total = 0;
      for (const [, w] of items) total += w;
      let r = next() * total;
      for (const [v, w] of items) {
        r -= w;
        if (r < 0) return v;
      }
      return items[items.length - 1][0];
    },
  };
}
