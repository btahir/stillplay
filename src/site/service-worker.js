/**
 * Stillplay service worker. scripts/build.mjs copies this file to dist/sw.js and fills in
 * BUILD (a content hash) and PRECACHE (every file the games need offline).
 *
 *   HTML pages      network first, falling back to the cached page or the app shell
 *   static assets   cache first (they are versioned by the build hash)
 *   scoreboard JSON network first
 * Old caches are deleted when a new build activates.
 */
const BUILD = '__STILLPLAY_BUILD__';
const PRECACHE = ['__STILLPLAY_PRECACHE__'];
const STATIC_CACHE = `stillplay-static-${BUILD}`;
const PAGE_CACHE = `stillplay-pages-${BUILD}`;
const SHELL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(PRECACHE);
    const pages = await caches.open(PAGE_CACHE);
    await pages.add(SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([STATIC_CACHE, PAGE_CACHE]);
    for (const name of await caches.keys()) {
      if (name.startsWith('stillplay-') && !keep.has(name)) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

async function networkFirstPage(request) {
  const cache = await caches.open(PAGE_CACHE);
  const url = new URL(request.url);
  const key = url.origin + url.pathname;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(key, response.clone());
    return response;
  } catch {
    return (await cache.match(key)) || (await cache.match(SHELL)) || new Response('<h1>Offline</h1><p>Open Stillplay once while online to play offline.</p>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw new Error('offline');
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') { event.respondWith(networkFirstPage(request)); return; }
  if (url.pathname.startsWith('/scoreboard/')) { event.respondWith(networkFirst(request)); return; }
  if (/^\/(src|cores|fonts|icons)\//.test(url.pathname) || /\.(js|css|wasm|woff2|png|svg|webmanifest)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});
