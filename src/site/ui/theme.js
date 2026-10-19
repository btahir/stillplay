/**
 * Light and dark themes. With no saved choice the site follows the system setting.
 * The inline script in index.html applies the theme before first paint.
 */
import { icon } from './icons.js';

const KEY = 'stillplay-theme';
const system = matchMedia('(prefers-color-scheme: dark)');
const THEME_COLORS = { light: '#f7f5ef', dark: '#171d19' };

function saved() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export const currentTheme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

function apply(theme) {
  document.documentElement.dataset.theme = theme;
  // Keep the browser chrome in step with an explicit choice.
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.content = THEME_COLORS[theme];
  const button = document.querySelector('#theme-toggle');
  if (button) {
    const next = theme === 'dark' ? 'light' : 'dark';
    button.setAttribute('aria-label', `Switch to ${next} theme`);
    button.title = `Switch to ${next} theme`;
    button.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon', { size: 18 });
  }
}

export function setupTheme() {
  apply(saved() === 'dark' || saved() === 'light' ? saved() : system.matches ? 'dark' : 'light');
  document.querySelector('#theme-toggle')?.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch { /* the choice lasts for this visit */ }
    const swap = () => apply(next);
    if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.documentElement.dataset.transition = 'theme';
      document.startViewTransition(swap).finished.finally(() => delete document.documentElement.dataset.transition);
    } else swap();
  });
  system.addEventListener('change', (event) => {
    if (!saved()) apply(event.matches ? 'dark' : 'light');
  });
}
