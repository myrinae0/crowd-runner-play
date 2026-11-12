// Pixel text for the DOM screens (menu, pause, level end). Short labels
// (titles, buttons, numbers) are redrawn with the game's bitmap font as small
// canvases scaled up with crisp pixels; long help text stays in the system font
// so it remains easy to read. The original text goes into aria-label.

import { textMask } from './font.js';
import { raster, outline, ICONS, WEAPON_ICONS } from './sprites.js';
import { OUT, rgba } from './palette.js';

const SELECTOR = '.logo span, .logo .l1, h2, .big, .ghost, .stats b, .shop-head > span:first-child, .shop-name, .shop-name small, .buy, .coins, .vol-val, .shop-tab, .wkey';

function cssColor(el) {
  const m = getComputedStyle(el).color.match(/\d+(\.\d+)?/g) || ['255', '255', '255'];
  return [+m[0], +m[1], +m[2], 255];
}

function textCanvas(str, fill, px) {
  const m = textMask(str, 'big', 1);
  const c = document.createElement('canvas');
  c.width = m.w; c.height = m.h;
  const g = c.getContext('2d');
  const id = g.createImageData(m.w, m.h);
  const out = rgba(OUT);
  for (let i = 0; i < m.mask.length; i++) if (m.mask[i]) id.data.set(m.mask[i] === 2 ? fill : out, i * 4);
  g.putImageData(id, 0, 0);
  c.className = 'px-text';
  c.style.width = `${m.w * px}px`;
  c.style.height = `${m.h * px}px`;
  c.setAttribute('aria-hidden', 'true');
  return c;
}

// Replaces the direct text of each matching element with bitmap text, sized
// from the element's CSS font size (about 7 art pixels per glyph height).
export function pixelize(root = document) {
  for (const el of root.querySelectorAll(SELECTOR)) {
    const nodes = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
    if (!nodes.length) continue;
    const size = parseFloat(getComputedStyle(el).fontSize) || 16;
    const px = Math.max(2, Math.round(size / 6.5));
    const fill = cssColor(el);
    const label = el.textContent.trim().replace(/\s+/g, ' ');
    if (el.matches('button')) el.setAttribute('aria-label', label);
    for (const n of nodes) {
      const span = document.createElement('span');
      span.className = 'px-wrap';
      span.setAttribute('aria-label', n.textContent.trim());
      span.setAttribute('role', 'text');
      span.appendChild(textCanvas(n.textContent.trim(), fill, px));
      n.replaceWith(span);
    }
  }
}

function spriteUrl(sp) {
  const c = document.createElement('canvas');
  c.width = sp.w; c.height = sp.h;
  const g = c.getContext('2d');
  const id = g.createImageData(sp.w, sp.h);
  id.data.set(sp.rgba);
  g.putImageData(id, 0, 0);
  return `url(${c.toDataURL()})`;
}

// The pixel coin and the weapon icons as data URLs for CSS (var(--px-coin),
// --px-rifle, --px-shield, --px-melee, --px-lock).
export function installCssSprites() {
  const root = document.documentElement.style;
  root.setProperty('--px-coin', spriteUrl(raster(ICONS.coin)));
  // Each icon centred in a 10 x 10 box and outlined: 12 x 12, shown at 3x.
  for (const [k, rows] of Object.entries(WEAPON_ICONS)) {
    const w = rows[0].length, h = rows.length, ox = Math.floor((10 - w) / 2), oy = Math.floor((10 - h) / 2);
    const pad = Array.from({ length: 10 }, (_, y) => (y >= oy && y < oy + h ? '.'.repeat(ox) + rows[y - oy] + '.'.repeat(10 - ox - w) : '.'.repeat(10)));
    root.setProperty(`--px-${k}`, spriteUrl(outline(raster(pad, null, '#ffffff'))));
  }
}
