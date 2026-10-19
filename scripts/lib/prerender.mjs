/**
 * Prerender each route's first screen into its HTML file, so text paints with the CSS and
 * crawlers see real content. The client router renders the same markup on boot and takes over.
 * Game stages are saved in their loading state; the game itself always mounts in the browser.
 * Returns the number of pages prerendered, or 0 when Playwright is unavailable.
 */
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function prerender(dist, paths, createStaticServer) {
  let chromium;
  try { ({ chromium } = await import('@playwright/test')); } catch { return 0; }
  const server = createStaticServer({ dist: true });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  let count = 0;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const page = await context.newPage();
    // Keep the HTML stable: never run the games while snapshotting.
    await page.route('**/*.wasm', () => { /* left pending on purpose */ });
    for (const path of paths) {
      await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelector('main h1'), null, { timeout: 15000 });
      const html = await page.evaluate(() => {
        const main = document.querySelector('main').cloneNode(true);
        for (const game of main.querySelectorAll('.stage-game')) {
          const loading = game.querySelector('.loading-game');
          game.replaceChildren(...(loading ? [loading] : []));
        }
        main.querySelector('.stage')?.removeAttribute('data-ready');
        for (const art of main.querySelectorAll('[data-mini]')) art.replaceChildren();
        main.querySelector('[data-secrets]')?.replaceChildren();
        for (const element of main.querySelectorAll('[tabindex="-1"]')) if (element.tagName === 'H1') element.removeAttribute('tabindex');
        return main.innerHTML.trim();
      });
      const file = path === '/' ? join(dist, 'index.html') : join(dist, path, 'index.html');
      const source = await readFile(file, 'utf8');
      await writeFile(file, source.replace('<main id="main"></main>', `<main id="main">${html}</main>`));
      count += 1;
    }
    await context.close();
  } catch (error) {
    console.warn(`Prerendering stopped: ${error.message.split('\n')[0]}`);
  } finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
  }
  return count;
}
