/** Line icons drawn for Stillplay. 20 × 20 grid, 1.5 stroke, currentColor. */

const paths = {
  new: '<path d="M16 10a6 6 0 1 1-1.8-4.3"/><path d="M16 3.5v3.2h-3.2"/>',
  undo: '<path d="M7.5 6 4 9.5 7.5 13"/><path d="M4.5 9.5H12a4 4 0 0 1 0 8h-2"/>',
  hint: '<path d="M7.5 14.5h5M8.3 17h3.4"/><path d="M10 3a4.6 4.6 0 0 0-2.8 8.3c.6.5.9 1.1.9 1.9v.3h3.8v-.3c0-.8.3-1.4.9-1.9A4.6 4.6 0 0 0 10 3Z"/>',
  daily: '<rect x="3" y="4.5" width="14" height="12.5" rx="1"/><path d="M3 8.5h14M7 2.5v4M13 2.5v4"/><path d="m7.5 12.6 1.7 1.6 3.3-3.4"/>',
  soundOn: '<path d="M3.5 7.5h3L10.5 4v12l-4-3.5h-3z"/><path d="M13.3 7.3a3.8 3.8 0 0 1 0 5.4M15.4 5.2a6.8 6.8 0 0 1 0 9.6"/>',
  soundOff: '<path d="M3.5 7.5h3L10.5 4v12l-4-3.5h-3z"/><path d="m13.5 8 4 4M17.5 8l-4 4"/>',
  pixels: '<path d="M3 3h4.5v4.5H3zM12.5 3H17v4.5h-4.5zM7.5 7.5H12.5V12.5H7.5zM3 12.5h4.5V17H3zM12.5 12.5H17V17h-4.5z"/>',
  crisp: '<path d="M4 16 16 4"/><path d="M4 4h12v12H4z"/>',
  stats: '<path d="M3.5 16.5h13"/><path d="M5.5 16.5V11M10 16.5V5.5M14.5 16.5v-8"/>',
  focus: '<path d="M3 7.5V3h4.5M12.5 3H17v4.5M17 12.5V17h-4.5M7.5 17H3v-4.5"/>',
  unfocus: '<path d="M7.5 3v4.5H3M17 7.5h-4.5V3M12.5 17v-4.5H17M3 12.5h4.5V17"/>',
  keyboard: '<rect x="2.5" y="5" width="15" height="10" rx="1"/><path d="M5.5 8h.01M8.5 8h.01M11.5 8h.01M14.5 8h.01M6.5 12h7"/>',
  share: '<path d="M10 12.5V3M6.5 6.2 10 2.8l3.5 3.4"/><path d="M6 9H4.5v8h11V9H14"/>',
  copy: '<rect x="6.5" y="6.5" width="10" height="10" rx="1"/><path d="M13.5 6.5v-3h-10v10h3"/>',
  link: '<path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.9.9"/><path d="M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l.9-.9"/>',
  download: '<path d="M10 3v10M6.5 9.5 10 13l3.5-3.5M4 16.5h12"/>',
  upload: '<path d="M10 13V3M6.5 6.5 10 3l3.5 3.5M4 16.5h12"/>',
  image: '<rect x="3" y="4" width="14" height="12" rx="1"/><path d="m3.5 14 4-4 3 3 2-2 4 4"/><circle cx="13" cy="7.5" r="1"/>',
  arrow: '<path d="M5 15 15 5M7 5h8v8"/>',
  arrowRight: '<path d="M3.5 10h13M11.5 5l5 5-5 5"/>',
  close: '<path d="m5 5 10 10M15 5 5 15"/>',
  check: '<path d="m4 10.5 4 4 8-9"/>',
  moon: '<path d="M16.5 12.2A7 7 0 0 1 7.8 3.5a7 7 0 1 0 8.7 8.7Z"/>',
  sun: '<circle cx="10" cy="10" r="3.3"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4"/>',
  streak: '<path d="M10 17.5c-3 0-5-2-5-4.8 0-3.4 3.2-5 3.2-8.7 2.3 1.4 3.6 3.4 3.6 5.4.8-.5 1.3-1.4 1.4-2.4 1.6 1.4 1.8 3.4 1.8 5.4 0 2.9-2 5.1-5 5.1Z"/>',
  lock: '<rect x="4" y="9" width="12" height="8.5" rx="1"/><path d="M6.8 9V6.2a3.2 3.2 0 0 1 6.4 0V9M10 12.3v2"/>',
};

export function icon(name, { size = 18, className = 'icon' } = {}) {
  return `<svg class="${className}" viewBox="0 0 20 20" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name] || ''}</svg>`;
}

/** Game glyphs: one per registry `icon` key. 34 × 34 grid. */
const glyphs = {
  mine: '<g stroke="currentColor" stroke-width="1.3"><path d="M17 3v28M3 17h28M7 7l20 20M7 27 27 7"/><circle cx="17" cy="17" r="9" fill="currentColor"/></g><path d="M12 11h4v4h-4z" fill="var(--paper)"/>',
  freecell: '<rect x="4" y="5" width="18" height="25" rx="1.5" transform="rotate(-9 13 17)" fill="var(--paper)" stroke="currentColor" stroke-width="1.3"/><rect x="12" y="3" width="18" height="25" rx="1.5" fill="var(--paper)" stroke="currentColor" stroke-width="1.3"/><path d="m21 9 4.5 6.5L21 22l-4.5-6.5z" fill="currentColor"/>',
  solitaire: '<rect x="6" y="3" width="22" height="28" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M17 9.5c-3.4 4-6.5 5.8-6.5 8.6 0 2 2.6 3.2 5 1.2l-1 4.2h5l-1-4.2c2.4 2 5 .8 5-1.2 0-2.8-3.1-4.6-6.5-8.6Z" fill="currentColor"/>',
  spider: '<path d="M10 3h20v26H10" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="4" y="7" width="20" height="25" rx="1.5" fill="var(--paper)" stroke="currentColor" stroke-width="1.3"/><g stroke="currentColor" stroke-width="1.2" fill="none"><path d="M10 14l-3-2.5M18 14l3-2.5M10 18H6.5M18 18h3.5M10 22l-3 2.5M18 22l3 2.5"/></g><ellipse cx="14" cy="18" rx="3.3" ry="4.6" fill="currentColor"/>',
  hearts: '<rect x="6" y="3" width="22" height="28" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M17 24.5C7.5 18 10 10.5 17 14.5 24 10.5 26.5 18 17 24.5Z" fill="currentColor"/>',
};

export function gameGlyph(name, className = 'game-glyph') {
  return `<svg class="${className}" viewBox="0 0 34 34" aria-hidden="true" focusable="false">${glyphs[name] || glyphs.solitaire}</svg>`;
}
