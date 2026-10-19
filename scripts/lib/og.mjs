/**
 * Open Graph cards (1200 × 630), drawn as HTML + inline SVG and rendered to PNG at build time.
 * The art reuses the collection miniatures from src/site/minis.js and the site's own stylesheet,
 * so the cards always match the product.
 */
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

const MARK = '<svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true"><path d="M2 2h12v12H2zM18 2h12v12H18zM2 18h12v12H2z" fill="currentColor"/><path d="M19 19h10v10H19z" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

function scoreboardArt() {
  const bars = Array.from({ length: 22 }, (_, index) => `<rect x="${20 + index * 19}" y="40" width="14" height="70" fill="${index % 7 === 3 ? '#2c6249' : '#dcded3'}"/>`).join('');
  return `<svg viewBox="0 0 460 150" class="mini"><text x="20" y="30" font-family="Georgia, serif" font-size="22" fill="#282e29">— %</text>${bars}<text x="20" y="138" font-family="Grotesk, sans-serif" font-size="13" fill="#62695e">Unknowns stay blank.</text></svg>`;
}

export function ogHtml(meta, { css, root, art }) {
  const fonts = pathToFileURL(join(root, 'public/fonts')).href;
  const { kicker = '', heading = '', accent = '' } = meta.og || {};
  return `<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>
${css.replaceAll("url('/fonts/", `url('${fonts}/`)}
html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: var(--paper); }
.og { box-sizing: border-box; width: 1200px; height: 630px; padding: 64px 72px; display: grid; grid-template-columns: 1fr 470px; gap: 56px; align-items: stretch; }
.og-left { display: flex; flex-direction: column; min-width: 0; }
.og-brand { display: flex; align-items: center; gap: 14px; font-family: var(--sans); font-weight: 500; font-size: 38px; letter-spacing: -.05em; color: var(--ink); }
.og-brand svg { color: var(--green); }
.og-brand span { color: var(--green); margin-left: -12px; }
.og-kicker { margin: auto 0 18px; font-family: var(--sans); font-size: 20px; font-weight: 500; letter-spacing: .14em; text-transform: uppercase; color: var(--green); }
.og h1 { margin: 0; font-size: ${heading.length + accent.length > 34 ? 64 : 80}px; line-height: 1.02; letter-spacing: -.035em; }
.og h1 em { display: block; }
.og-foot { margin: 34px 0 0; padding-top: 22px; border-top: 2px solid var(--line); font-family: var(--sans); font-size: 21px; color: var(--muted); }
.og-art { align-self: center; aspect-ratio: 240 / 150; background: var(--card); display: grid; place-items: center; overflow: hidden; }
.og-art .mini, .og-art svg { width: 100%; height: auto; display: block; }
.og-art.is-secret svg { width: 80%; }
</style></head><body><div class="og">
<div class="og-left">
  <div class="og-brand">${MARK}stillplay<span>.</span></div>
  <p class="og-kicker">${escape(kicker)}</p>
  <h1>${escape(heading)}${accent ? `<em>${escape(accent)}</em>` : ''}</h1>
  <p class="og-foot">Free to play in your browser. No installs, no accounts.</p>
</div>
<div class="og-art${art.secret ? ' is-secret' : ''}">${art.svg === 'scoreboard' ? scoreboardArt() : art.svg}</div>
</div></body></html>`;
}
