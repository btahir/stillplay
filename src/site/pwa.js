/**
 * Offline support. The service worker exists only in built output (scripts/build.mjs writes
 * /sw.js and a `stillplay-build` meta tag). The dev server never registers one, and removes
 * any worker left over from a build preview, so development always sees fresh files.
 */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const build = document.querySelector('meta[name="stillplay-build"]')?.content;
  if (!build) {
    navigator.serviceWorker.getRegistrations?.().then((registrations) => {
      for (const registration of registrations) registration.unregister();
    }).catch(() => {});
    return;
  }
  // When a new build takes over, the next in-app navigation does a full load so old and new
  // modules never mix. A game in progress is never interrupted.
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) document.documentElement.dataset.stale = 'true';
  });
  const start = () => navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => { /* offline play is a bonus */ });
  // Wait until the page has settled so caching never competes with the first game.
  if (document.readyState === 'complete') setTimeout(start, 1500);
  else window.addEventListener('load', () => setTimeout(start, 1500), { once: true });
}
