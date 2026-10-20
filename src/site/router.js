/**
 * Client-side routing for a static site. Every route is a real URL that the server
 * answers with index.html, so links, reloads and shared URLs all work.
 *
 * A page module exports `render(main, context)` and may return a cleanup function.
 * Pages draw their layout synchronously and finish slow work (like mounting a game) afterwards,
 * so view transitions never wait on the network.
 */
import { siteGames } from './registry.js';
import { pageMeta } from './meta.js';
import { escape, prefersReducedMotion } from './ui/dom.js';
// Every page loads on demand; the built HTML modulepreloads the one its route needs.
const lazy = {
  home: () => import('./pages/home.js'),
  game: () => import('./pages/game.js'),
  daily: () => import('./pages/daily.js'),
  about: () => import('./pages/about.js'),
  secrets: () => import('./pages/secrets.js'),
  soon: () => import('./pages/coming-soon.js'),
  notFound: () => import('./pages/not-found.js'),
};

/** Resolve a pathname to { load, params }. */
export function match(pathname) {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return { name: 'home', load: lazy.home, params: {} };
  const games = siteGames();
  const game = games.find((item) => item.path === path);
  if (game) return game.playable ? { name: 'game', load: lazy.game, params: { game, daily: false } } : { name: 'soon', load: lazy.soon, params: { game } };
  if (path === '/daily') return { name: 'daily', load: lazy.daily, params: {} };
  const daily = path.match(/^\/daily\/([\w-]+)$/);
  if (daily) {
    const dailyGame = games.find((item) => item.id === daily[1] && item.playable);
    if (dailyGame) return { name: 'game', load: lazy.game, params: { game: dailyGame, daily: true } };
  }
  if (path === '/about') return { name: 'about', load: lazy.about, params: {} };
  if (path === '/secrets') return { name: 'secrets', load: lazy.secrets, params: {} };
  const secret = path.match(/^\/secrets\/([\w-]+)$/);
  if (secret) return { name: 'secret', load: lazy.secrets, params: { slug: secret[1] } };
  return { name: 'not-found', load: lazy.notFound, params: {} };
}

let main;
let cleanup = null;
let routeId = 0;

function setTitle(path) {
  const meta = pageMeta(path.replace(/\/+$/, '') || '/');
  if (meta) document.title = meta.title;
  else document.title = 'A small detour — Stillplay';
}

const NAV_FOR_ROUTE = { game: 'games', soon: 'games', daily: 'daily', secrets: 'secrets', secret: 'secrets', about: 'about' };

function markNav(routeName, params) {
  const current = params?.daily ? 'daily' : NAV_FOR_ROUTE[routeName];
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

const KEEP = 'h1, h2, .hero-lede, .play-title p, .page-intro > p, .lede';

function keepPainted(previous) {
  const fresh = [...main.querySelectorAll(KEEP)];
  previous.forEach((old, index) => {
    const now = fresh[index];
    if (now && now.outerHTML === old.outerHTML) now.replaceWith(old);
  });
}

function runCleanup() {
  const previous = cleanup;
  cleanup = null;
  try { previous?.(); } catch (error) { console.error(error); }
}

function showError(error) {
  console.error(error);
  main.innerHTML = `<article class="article"><p class="eyebrow">Something went sideways</p><h1>A brief pause.</h1><p>${escape(error?.message || 'This page could not be drawn.')}</p><p><button type="button" class="button" data-reload>Try again</button></p></article>`;
  main.querySelector('[data-reload]').onclick = () => location.reload();
}

function moveFocus() {
  const heading = main.querySelector('h1');
  const target = heading || main;
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
}

function scrollForHash(hash) {
  if (!hash) return false;
  const target = document.getElementById(decodeURIComponent(hash.slice(1)));
  if (!target) return false;
  target.scrollIntoView({ block: 'start', behavior: 'auto' });
  return true;
}

async function render({ initial = false, scroll = 'top' } = {}) {
  const id = ++routeId;
  const route = match(location.pathname);
  let module;
  try {
    module = await route.load();
  } catch (error) {
    if (id === routeId) showError(error);
    return;
  }
  if (id !== routeId) return;

  // The built HTML carries a prerendered first screen. Keep its already-painted text nodes
  // when the fresh render produces the same markup, so nothing visibly repaints.
  const prerendered = initial ? [...main.querySelectorAll(KEEP)] : [];
  const swap = () => {
    runCleanup();
    setTitle(location.pathname);
    document.documentElement.dataset.route = route.name;
    markNav(route.name, route.params);
    try {
      cleanup = module.render(main, { ...route.params, path: location.pathname, navigate, onError: showError }) || null;
    } catch (error) {
      showError(error);
    }
    if (prerendered.length) keepPainted(prerendered);
    if (scroll === 'top' && !scrollForHash(location.hash)) window.scrollTo(0, 0);
  };

  if (!initial && document.startViewTransition && !prefersReducedMotion()) {
    const transition = document.startViewTransition(swap);
    await transition.updateCallbackDone.catch(() => {});
  } else swap();

  if (initial) {
    // Respect a deep link like /#collection on the first load.
    if (location.hash) requestAnimationFrame(() => scrollForHash(location.hash));
  } else moveFocus();
}

export function navigate(url, { replace = false } = {}) {
  const next = new URL(url, location.href);
  if (next.origin !== location.origin || document.documentElement.dataset.stale === 'true') { location.assign(next.href); return; }
  const samePage = next.pathname === location.pathname && next.search === location.search;
  history[replace ? 'replaceState' : 'pushState']({}, '', next.pathname + next.search + next.hash);
  if (samePage && next.hash) { scrollForHash(next.hash); return; }
  render();
}

const FILE_LIKE = /\.[a-z0-9]{1,12}$/i;

function interceptClicks(event) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target.closest('a[href]');
  if (!link || link.target || link.hasAttribute('download') || link.dataset.native !== undefined) return;
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin || FILE_LIKE.test(url.pathname)) return;
  // Same document, only a hash change: let the browser scroll.
  if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
  event.preventDefault();
  navigate(url.href);
}

export function startRouter(mainElement) {
  main = mainElement;
  document.addEventListener('click', interceptClicks);
  window.addEventListener('popstate', () => render());
  if ('scrollRestoration' in history) history.scrollRestoration = 'auto';
  return render({ initial: true, scroll: 'none' });
}
