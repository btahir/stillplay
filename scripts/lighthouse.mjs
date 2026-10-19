import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';
import { server } from './dev.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'notes/lighthouse');
await mkdir(output, { recursive: true });
let ownServer = false;
let baseURL = process.env.BASE_URL;
if (!baseURL) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseURL = `http://127.0.0.1:${server.address().port}`;
  ownServer = true;
}
const routeArgs = process.argv.flatMap((argument, index, all) => argument === '--route' && all[index + 1] ? [all[index + 1]] : []);
const routes = routeArgs.length ? routeArgs : ['/', '/freecell'];
if (routes.some((route) => !['/', '/freecell'].includes(route))) throw new Error('Supported Lighthouse routes: / and /freecell.');
const summary = { generatedAt: new Date().toISOString(), note: 'One local Lighthouse run per route. Simulated mobile throttling; not a real midrange phone measurement.', pages: [] };
if (routeArgs.length) {
  try { summary.pages = JSON.parse(await readFile(join(output, 'summary.json'), 'utf8')).pages.filter((page) => !routes.includes(page.route)); }
  catch { /* A first single-route audit starts a new summary. */ }
}
/** Use Playwright's installed headless shell; never download a browser. */
async function findChrome() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), 'Library/Caches/ms-playwright');
  try {
    const shell = (await readdir(base)).filter((name) => name.startsWith('chromium_headless_shell-')).sort().at(-1);
    if (shell) {
      const folder = (await readdir(join(base, shell))).find((name) => name.startsWith('chrome-headless-shell'));
      if (folder) return join(base, shell, folder, 'chrome-headless-shell');
    }
  } catch { /* fall through */ }
  return '/usr/bin/chromium';
}
let chrome;
try {
  chrome = await chromeLauncher.launch({ chromePath: process.env.CHROME_PATH || await findChrome(), chromeFlags: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage'], logLevel: 'error', ignoreDefaultFlags: false });
  for (const route of routes) {
    const result = await lighthouse(`${baseURL}${route}`, {
      port: chrome.port,
      output: ['json', 'html'],
      onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
      logLevel: 'error',
    });
    if (!result?.lhr) throw new Error(`Lighthouse did not return a report for ${route}`);
    const name = route === '/' ? 'home' : route.slice(1);
    await writeFile(join(output, `${name}.json`), result.report[0]);
    await writeFile(join(output, `${name}.html`), result.report[1]);
    const page = {
      route,
      auditedAt: new Date().toISOString(),
      scores: Object.fromEntries(Object.entries(result.lhr.categories).map(([key, category]) => [key, category.score === null ? null : Math.round(category.score * 100)])),
      firstContentfulPaintMs: result.lhr.audits['first-contentful-paint']?.numericValue ?? null,
      largestContentfulPaintMs: result.lhr.audits['largest-contentful-paint']?.numericValue ?? null,
      totalTransferBytes: result.lhr.audits['total-byte-weight']?.numericValue ?? null,
      failedAudits: Object.entries(result.lhr.audits).filter(([, audit]) => audit.score !== null && audit.score < 1 && ['binary', 'numeric'].includes(audit.scoreDisplayMode)).map(([id, audit]) => ({ id, title: audit.title, score: audit.score, description: audit.description })),
    };
    summary.pages.push(page);
    console.log(`${route}: ${Object.entries(page.scores).map(([key, score]) => `${key} ${score}`).join(' · ')}; FCP ${Math.round(page.firstContentfulPaintMs)}ms.`);
  }
  await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2));
} finally {
  if (chrome) await chrome.kill();
  if (ownServer) await new Promise((resolveClose) => server.close(resolveClose));
}
