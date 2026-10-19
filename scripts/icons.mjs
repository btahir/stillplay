/**
 * Generate the installable app icons from the Stillplay brand mark (the same SVG as favicon.svg).
 *   node scripts/icons.mjs
 * Writes public/icons/{icon-192,icon-512,icon-maskable-512,apple-touch-icon}.png.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPngs } from './lib/render-png.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public/icons');
const PAPER = '#f7f5ef';
const GREEN = '#2c6249';

/** The brand mark on a 32-unit grid: three filled squares and one outlined. */
function mark(colour) {
  return `<path d="M2 2h12v12H2zM18 2h12v12H18zM2 18h12v12H2z" fill="${colour}"/><path d="M19 19h10v10H19z" fill="none" stroke="${colour}" stroke-width="2"/>`;
}

function page(size, { background, colour, inset, radius = 0 }) {
  const markSize = size * (1 - inset * 2);
  return `<!doctype html><html><body style="margin:0;background:transparent">
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
<rect width="${size}" height="${size}" rx="${radius}" fill="${background}"/>
<g transform="translate(${size * inset} ${size * inset}) scale(${markSize / 32})">${mark(colour)}</g>
</svg></body></html>`;
}

const jobs = [
  // "any" icons: rounded paper tile, like the favicon.
  { out: join(out, 'icon-192.png'), width: 192, height: 192, transparent: true, html: page(192, { background: PAPER, colour: GREEN, inset: 0.2, radius: 192 * 0.18 }) },
  { out: join(out, 'icon-512.png'), width: 512, height: 512, transparent: true, html: page(512, { background: PAPER, colour: GREEN, inset: 0.2, radius: 512 * 0.18 }) },
  // Maskable: full bleed, mark inside the 80% safe zone.
  { out: join(out, 'icon-maskable-512.png'), width: 512, height: 512, html: page(512, { background: GREEN, colour: PAPER, inset: 0.29 }) },
  // iOS rounds the corners itself.
  { out: join(out, 'apple-touch-icon.png'), width: 180, height: 180, html: page(180, { background: PAPER, colour: GREEN, inset: 0.22 }) },
];

if (!(await renderPngs(jobs, { baseDir: join(root, '.cache') }))) {
  console.error('Playwright with its Chromium headless shell is required to render icons.');
  process.exit(1);
}
console.log(`Wrote ${jobs.length} icons to public/icons/.`);
