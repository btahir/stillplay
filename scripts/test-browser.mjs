import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { chromium, expect } from '@playwright/test';
import { loadReplay } from '../src/minesweeper-core.js';
import { loadFreecellReplay } from '../src/freecell-core.js';
import { existsSync } from 'node:fs';
import { server, createStaticServer } from './dev.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const screenshots = join(root, 'notes/screenshots');
await mkdir(screenshots, { recursive: true });
let ownServer = false;
let baseURL = process.env.BASE_URL;
if (!baseURL) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseURL = `http://127.0.0.1:${server.address().port}`;
  ownServer = true;
}
const results = { generatedAt: new Date().toISOString(), browser: null, tests: [], measurements: null, screenshots: [] };
let browser;
let page;
/** Run one scenario. A failure is recorded and the remaining scenarios still run. */
async function check(name, fn) {
  const started = performance.now();
  try {
    await fn();
    results.tests.push({ name, passed: true, durationMs: Math.round(performance.now() - started) });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.tests.push({ name, passed: false, durationMs: Math.round(performance.now() - started), error: String(error.message || error).split('\n').slice(0, 6).join('\n') });
    console.log(`FAIL ${name}\n  ${String(error.message || error).split('\n').slice(0, 6).join('\n  ')}`);
    if (page) await page.screenshot({ path: join(screenshots, `failed-${results.tests.length}.png`), fullPage: true }).catch(() => {});
  }
}
try {
  // Playwright's own headless shell (PLAYWRIGHT_BROWSERS_PATH); never a system Chrome.
  browser = await chromium.launch();
  results.browser = browser.version();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  // Sound stays off in every browser test.
  await context.addInitScript(() => { try { localStorage.setItem('stillplay-sound', 'false'); } catch { /* storage blocked */ } });
  page = await context.newPage();
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await check('Home boots a playable Minesweeper without a launch screen', async () => {
    await page.goto(`${baseURL}/?seed=42`);
    await expect(page.locator('[data-cell]')).toHaveCount(81);
    await expect(page.locator('.game-window[data-game="minesweeper"]')).toBeVisible();
    const boardReadyMs = await page.evaluate(() => performance.now());
    await page.waitForLoadState('networkidle');
    const measures = await page.evaluate((boardReady) => {
      const navigation = performance.getEntriesByType('navigation')[0];
      const resources = performance.getEntriesByType('resource').map((item) => ({ name: new URL(item.name).pathname, encodedBodySize: item.encodedBodySize, decodedBodySize: item.decodedBodySize, transferSize: item.transferSize }));
      return { boardReadyMs: boardReady, documentBytes: navigation.encodedBodySize, compressedPayloadBytes: navigation.encodedBodySize + resources.reduce((sum, item) => sum + item.encodedBodySize, 0), totalTransferBytes: navigation.transferSize + resources.reduce((sum, item) => sum + item.transferSize, 0), resources };
    }, boardReadyMs);
    results.measurements = { ...measures, note: 'Unthrottled local desktop browser. Board-ready time is observed at the playable-grid assertion; payload includes all initial resources through network idle. Not a measured midrange phone result.' };
    assert.ok(!measures.resources.some((resource) => resource.name === '/cores/freecell.wasm'), 'Home must lazy load the other game WASM.');
    assert.ok(!measures.resources.some((resource) => resource.name.startsWith('/src/secrets.js')), 'Below-the-fold extras must load on demand.');
    assert.equal(await page.evaluate(async () => (await navigator.serviceWorker?.getRegistrations?.() || []).length), 0, 'The dev server must never register a service worker.');
  });
  await check('Minesweeper supports flagging, keyboard reset, difficulty and drawing controls', async () => {
    const first = page.locator('[data-cell="0"]');
    await first.click({ button: 'right' });
    await expect(first).toHaveAttribute('aria-label', /^Flagged/);
    await expect(page.locator('.mine-counter')).toHaveAttribute('aria-label', '9 mines remaining');
    await first.click({ button: 'right' });
    await first.click();
    await expect(first).not.toHaveAttribute('aria-label', /^Covered|^Mine,/);
    await page.keyboard.press('F2');
    await expect(first).toHaveAttribute('aria-label', /^Covered/);
    await page.locator('#mine-game-toggle').click();
    await page.locator('[data-level="intermediate"]').click();
    await expect(page.locator('[data-cell]')).toHaveCount(256);
    await page.locator('#mine-game-toggle').click();
    await page.locator('[data-level="beginner"]').click();
    await expect(page.locator('[data-cell]')).toHaveCount(81);
    await page.locator('.flag-mode').click();
    await first.click();
    await expect(first).toHaveAttribute('aria-label', /^Flagged/);
    await page.locator('.flag-mode').click();
    const drawing = page.locator('[data-command="fidelity"]');
    await drawing.click();
    await expect(drawing).toHaveAttribute('aria-pressed', 'true');
    await expect(drawing).toContainText('Crisp');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('stillplay-fidelity'))), 'crisp');
    await drawing.click();
    await expect(drawing).toContainText('Original pixels');
  });
  await check('A scripted Minesweeper win runs through the real UI', async () => {
    await page.goto(`${baseURL}/minesweeper?seed=42`);
    await expect(page.locator('[data-cell]')).toHaveCount(81);
    const safe = await page.evaluate(async () => {
      const { createMinesweeper } = await import('/src/minesweeper-core.js');
      const model = await createMinesweeper({ seed: 42 });
      model.reveal(0, 0);
      return model.state().cells.flatMap((cell, index) => cell.mine ? [] : [index]);
    });
    await page.evaluate(() => localStorage.removeItem('stillplay-stats-v1'));
    await page.locator('[data-cell="0"]').click();
    for (const index of safe) {
      const cell = page.locator(`[data-cell="${index}"]`);
      if ((await cell.getAttribute('aria-label')).startsWith('Covered')) await cell.click();
    }
    await expect(page.locator('.mine-status')).toHaveText('Field cleared. Nicely done.');
    assert.ok(await page.evaluate(() => Number(JSON.parse(localStorage.getItem('stillplay-best-beginner'))) >= 0));
    await expect(page.locator('#dialog.dialog-win[open]')).toBeVisible();
    await expect(page.locator('#dialog-title')).toHaveText('A little victory');
    await expect(page.locator('.share-preview')).toContainText('seed=42');
    const stats = await page.evaluate(() => JSON.parse(localStorage.getItem('stillplay-stats-v1')).minesweeper);
    assert.equal(stats.won, 1);
    assert.equal(stats.played, 1);
    await page.locator('#dialog-close').click();
  });
  await check('Browser replay produces exactly the same states in Node WASM', async () => {
    const evidence = await page.evaluate(async () => {
      const mines = await import('/src/minesweeper-core.js');
      const cards = await import('/src/freecell-core.js');
      const mine = await mines.createMinesweeper({ seed: 770, level: 'expert' });
      mine.reveal(7, 7); mine.flag(0, 0); mine.reveal(15, 8);
      const freecell = await cards.createFreecell({ deal: 11982 });
      freecell.move('c0', 'f0'); freecell.move('c1', 'f1'); freecell.undo();
      return { mines: { replay: mine.replay(), state: mine.state() }, cards: { replay: freecell.replay(), state: freecell.state() } };
    });
    assert.deepEqual((await loadReplay(evidence.mines.replay)).state(), evidence.mines.state);
    assert.deepEqual((await loadFreecellReplay(evidence.cards.replay)).state(), evidence.cards.state);
  });
  await check('Minesweeper imports, exports and opens replay links through the page', async () => {
    const sample = await loadReplay({ version: 1, game: 'minesweeper', level: 'beginner', seed: 42, actions: [{ type: 'reveal', x: 0, y: 0, t: 0 }] });
    const flagIndex = sample.state().cells.findIndex((cell) => !cell.revealed);
    sample.flag(flagIndex % 9, Math.floor(flagIndex / 9));
    const replay = sample.replay();
    await page.goto(`${baseURL}/minesweeper`);
    await expect(page.locator('[data-cell]')).toHaveCount(81);
    await page.locator('#replay-input').setInputFiles({ name: 'test-replay.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(replay)) });
    await expect(page.locator(`[data-cell="${flagIndex}"]`)).toHaveAttribute('aria-label', /^Flagged/);
    const downloaded = page.waitForEvent('download');
    await page.locator('#export-replay').click();
    const file = await downloaded;
    assert.deepEqual(JSON.parse(await readFile(await file.path(), 'utf8')), replay);
    const encoded = Buffer.from(JSON.stringify(replay)).toString('base64');
    await page.goto(`${baseURL}/minesweeper#replay=${encoded}`);
    await expect(page.locator(`[data-cell="${flagIndex}"]`)).toHaveAttribute('aria-label', /^Flagged/);
  });
  await check('FreeCell deals, moves to a free cell, undoes, and selects deal 11982', async () => {
    await page.goto(`${baseURL}/freecell`);
    await expect(page.locator('.fc-card')).toHaveCount(52);
    await page.locator('.fc-card[data-loc="column"][data-index="0"]').last().click();
    await page.locator('.fc-empty-slot[data-loc="freecell"][data-index="0"]').click();
    await expect(page.locator('.fc-freecells .fc-card')).toHaveCount(1);
    await expect(page.locator('.fc-statusbar')).toContainText('1 move');
    await page.locator('.fc-quick-actions [data-action="undo"]').click();
    await expect(page.locator('.fc-freecells .fc-card')).toHaveCount(0);
    await page.getByRole('button', { name: 'Choose a deal', exact: true }).click();
    await page.locator('#fc-deal-input').fill('11982');
    await page.locator('[data-dialog="deal"] button[type="submit"]').click();
    await expect(page.locator('.fc-titlebar')).toContainText('Deal #11982');
    await page.locator('.fc-quick-actions [data-action="hint"]').click();
    await expect(page.locator('.fc-message')).toContainText('Try moving');
    await page.goto(`${baseURL}/freecell?deal=11982`);
    await expect(page.locator('.fc-titlebar')).toContainText('Deal #11982');
  });
  await check('Daily pages export the shared deterministic daily seeds and deals', async () => {
    await page.goto(`${baseURL}/daily/minesweeper`);
    await expect(page.locator('[data-cell]')).toHaveCount(81);
    let downloading = page.waitForEvent('download');
    await page.locator('#export-replay').click();
    const mines = JSON.parse(await readFile(await (await downloading).path(), 'utf8'));
    const seed = await page.evaluate(async () => (await import('/src/shared.js')).dailySeed());
    assert.equal(mines.seed, seed);
    await page.goto(`${baseURL}/daily/freecell`);
    await expect(page.locator('.fc-card')).toHaveCount(52);
    downloading = page.waitForEvent('download');
    await page.locator('#export-replay').click();
    const cards = JSON.parse(await readFile(await (await downloading).path(), 'utf8'));
    const deal = await page.evaluate(async () => (await import('/src/shared.js')).dailyDeal());
    assert.equal(cards.deal, deal);
  });
  await check('Touch reveals, flag mode and long press work on a phone', async () => {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    try {
      const touch = await phone.newPage();
      await touch.goto(`${baseURL}/minesweeper?seed=42`);
      await expect(touch.locator('[data-cell]')).toHaveCount(81);
      await touch.locator('[data-cell="0"]').tap();
      await expect(touch.locator('[data-cell="0"]')).not.toHaveAttribute('aria-label', /^Covered|^Mine,/);
      await touch.locator('.flag-mode').tap();
      const covered = touch.locator('[data-cell][aria-label^="Covered"]').first();
      const flagCell = await covered.getAttribute('data-cell');
      await covered.tap();
      await expect(touch.locator(`[data-cell="${flagCell}"]`)).toHaveAttribute('aria-label', /^Flagged/);
      await touch.locator('.flag-mode').tap();
      const longTarget = touch.locator('[data-cell][aria-label^="Covered"]').first();
      const longCell = await longTarget.getAttribute('data-cell');
      const box = await longTarget.boundingBox();
      const client = await phone.newCDPSession(touch);
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
      await new Promise((done) => setTimeout(done, 520));
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(touch.locator(`[data-cell="${longCell}"]`)).toHaveAttribute('aria-label', /^Flagged/);
    } finally { await phone.close(); }
  });
  await check('The hero switches games in place and remembers the choice', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${baseURL}/`);
    await page.evaluate(() => localStorage.removeItem('stillplay-hero-game'));
    await page.reload();
    await expect(page.locator('#hero-panel [data-cell]')).toHaveCount(81);
    const freecellTab = page.getByRole('tab', { name: 'FreeCell' });
    await freecellTab.click();
    await expect(page.locator('#hero-panel .fc-card')).toHaveCount(52);
    await expect(page.locator('#hero-panel [data-cell]')).toHaveCount(0);
    await expect(freecellTab).toHaveAttribute('aria-selected', 'true');
    await page.reload();
    await expect(page.locator('#hero-panel .fc-card')).toHaveCount(52);
    await page.getByRole('tab', { name: 'FreeCell' }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#hero-panel [data-cell]')).toHaveCount(81);
    await expect(page.getByRole('tab', { name: 'Minesweeper' })).toHaveAttribute('aria-selected', 'true');
  });
  await check('Stats open from the chrome and survive broken storage', async () => {
    await page.goto(`${baseURL}/minesweeper?seed=42`);
    await page.evaluate(() => localStorage.setItem('stillplay-stats-v1', '{not json'));
    await page.reload();
    await expect(page.locator('[data-cell]')).toHaveCount(81);
    await page.locator('body').press('s');
    await expect(page.locator('#dialog.dialog-stats[open]')).toBeVisible();
    await expect(page.locator('.stat-row dd').first()).toHaveText('0');
    await page.keyboard.press('Escape');
    await page.locator('[data-cell="40"]').click();
    await page.locator('[data-command="stats"]').click();
    await expect(page.locator('.stat-row dd').first()).toHaveText('1');
    await page.locator('#dialog-close').click();
    await page.evaluate(() => localStorage.removeItem('stillplay-stats-v1'));
  });
  await check('Game chrome toggles sound, shortcuts and focus mode', async () => {
    await page.goto(`${baseURL}/freecell`);
    await expect(page.locator('.fc-card')).toHaveCount(52);
    const sound = page.locator('[data-command="sound"]');
    await expect(sound).toHaveAttribute('aria-pressed', 'false');
    await sound.click();
    await expect(sound).toHaveAttribute('aria-pressed', 'true');
    assert.equal(await page.evaluate(() => localStorage.getItem('stillplay-sound')), 'true');
    await sound.click();
    await expect(sound).toHaveAttribute('aria-pressed', 'false');
    assert.equal(await page.evaluate(() => localStorage.getItem('stillplay-sound')), 'false');
    await page.locator('body').press('?');
    await expect(page.locator('#dialog.dialog-keys[open]')).toBeVisible();
    await expect(page.locator('.key-list kbd').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#dialog[open]')).toHaveCount(0);
    await page.locator('[data-command="focus"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-focus', 'on');
    await expect(page.locator('.site-header')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).not.toHaveAttribute('data-focus', 'on');
    await expect(page.locator('.site-header')).toBeVisible();
    await page.locator('[data-command="new"]').click();
    await expect(page.locator('.fc-card')).toHaveCount(52);
  });
  await check('Routing keeps one document, moves focus and covers every page', async () => {
    await page.goto(`${baseURL}/`);
    await expect(page.locator('[data-cell]').first()).toBeAttached();
    await page.evaluate(() => { window.sameDocument = true; });
    await page.locator('.site-nav [data-nav="secrets"]').click();
    await expect(page).toHaveTitle(/Small games\. Good secrets\./);
    await expect(page.locator('main h1')).toBeFocused();
    await expect(page.locator('.site-nav [data-nav="secrets"]')).toHaveAttribute('aria-current', 'page');
    assert.equal(await page.evaluate(() => window.sameDocument), true, 'Navigation must not reload the page.');
    await page.goBack();
    await expect(page.locator('[data-cell]').first()).toBeAttached();
    await page.goto(`${baseURL}/daily`);
    const playable = await page.evaluate(async () => (await import('/src/games.js')).games.filter((game) => typeof game.mount === 'function').length);
    await expect(page.locator('.daily-row')).toHaveCount(playable);
    await page.goto(`${baseURL}/about`);
    await expect(page.locator('.article')).toContainText('Not affiliated with or endorsed by Microsoft');
    await page.goto(`${baseURL}/scoreboard`);
    await expect(page.locator('.score-card').first()).toBeVisible();
    await page.goto(`${baseURL}/nowhere-at-all`);
    await expect(page.locator('main h1')).toHaveText('Nothing hiding here.');
    const soon = await page.evaluate(async () => (await import('/src/games.js')).games.find((game) => !game.mount && game.path)?.path ?? null);
    if (soon) {
      await page.goto(`${baseURL}${soon}`);
      await expect(page.locator('.soon h1')).toBeVisible();
      await expect(page).toHaveTitle(/coming soon/);
    }
  });
  await check('The built site installs, carries per-page metadata and plays offline', async () => {
    if (!existsSync(join(root, 'dist/sw.js'))) throw new Error('dist/ is missing: run scripts/build.mjs first.');
    const distServer = createStaticServer({ dist: true });
    distServer.listen(0, '127.0.0.1');
    await once(distServer, 'listening');
    const distURL = `http://127.0.0.1:${distServer.address().port}`;
    const offline = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'allow' });
    await offline.addInitScript(() => { try { localStorage.setItem('stillplay-sound', 'false'); } catch { /* storage blocked */ } });
    try {
      const html = await (await fetch(`${distURL}/freecell`)).text();
      assert.match(html, /<title>Play FreeCell online — Stillplay<\/title>/);
      assert.match(html, /og:image" content="[^"]+\/og\/freecell\.png"/);
      assert.match(html, /"@type":"VideoGame"/);
      assert.match(await (await fetch(`${distURL}/sitemap.xml`)).text(), /\/daily\/freecell<\/loc>/);
      const manifest = await (await fetch(`${distURL}/manifest.webmanifest`)).json();
      assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
      assert.equal((await fetch(`${distURL}/og/freecell.png`)).headers.get('content-type'), 'image/png');
      const tab = await offline.newPage();
      await tab.goto(`${distURL}/?seed=42`);
      await expect(tab.locator('[data-cell]')).toHaveCount(81);
      await tab.evaluate(async () => {
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) await new Promise((done) => navigator.serviceWorker.addEventListener('controllerchange', done, { once: true }));
      });
      await offline.setOffline(true);
      await tab.reload();
      await expect(tab.locator('[data-cell]')).toHaveCount(81);
      await tab.locator('.game-card-link[href="/freecell"]').click();
      await expect(tab.locator('.fc-card')).toHaveCount(52);
      await tab.goto(`${distURL}/daily/minesweeper`);
      await expect(tab.locator('[data-cell]')).toHaveCount(81);
      await expect(tab).toHaveTitle(/Daily Minesweeper/);
    } finally {
      await offline.close();
      await new Promise((done) => distServer.close(done));
    }
  });
  await check('Game artwork agrees with our approved screenshot baselines', async () => {
    const goldens = join(root, 'tests/golden');
    await mkdir(goldens, { recursive: true });
    for (const [game, route, selector] of [['minesweeper', '/minesweeper?seed=42', '.game-window'], ['freecell', '/freecell?deal=1', '.fc-window']]) {
      await page.goto(`${baseURL}${route}`);
      await expect(page.locator(game === 'minesweeper' ? '[data-cell]' : '.fc-card')).toHaveCount(game === 'minesweeper' ? 81 : 52);
      await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; document.activeElement?.blur(); return document.fonts.ready; });
      await page.mouse.move(0, 0);
      const current = await page.locator(selector).screenshot({ animations: 'disabled', caret: 'hide' });
      const path = join(goldens, `${game}.png`);
      if (process.env.UPDATE_GOLDENS === '1') {
        await writeFile(path, current);
        console.log(`Updated ${game} baseline; inspect it before approving the change.`);
      } else {
        let baseline;
        try { baseline = await readFile(path); }
        catch { throw new Error(`Missing ${game} screenshot baseline. Generate it explicitly with UPDATE_GOLDENS=1 pnpm test:browser, inspect and approve the image, then run the default comparison.`); }
        if (!current.equals(baseline)) {
          await writeFile(join(screenshots, `${game}-golden-current.png`), current);
          throw new Error(`${game} artwork differs from its approved baseline. See notes/screenshots/${game}-golden-current.png; do not replace the baseline without inspecting the change.`);
        }
      }
    }
  });
  await check('Four visual checkpoints fit desktop and phone in both themes', async () => {
    for (const [label, viewport] of Object.entries({ desktop: { width: 1440, height: 1000 }, phone: { width: 390, height: 844 } })) {
      await page.setViewportSize(viewport);
      for (const theme of ['light', 'dark']) {
        await page.goto(`${baseURL}/?seed=42`);
        await expect(page.locator('[data-cell]')).toHaveCount(81);
        await page.evaluate((selected) => { localStorage.setItem('stillplay-theme', selected); document.documentElement.dataset.theme = selected; }, theme);
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: join(screenshots, `${label}-${theme}.png`), fullPage: true, animations: 'disabled' });
        results.screenshots.push(`notes/screenshots/${label}-${theme}.png`);
        const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
        assert.ok(dimensions.scroll <= dimensions.width + 1, `${label} ${theme} has horizontal overflow: ${JSON.stringify(dimensions)}`);
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => localStorage.setItem('stillplay-theme', 'light'));
    for (const [name, route] of Object.entries({ home: '/', freecell: '/freecell', daily: '/daily', about: '/about', scoreboard: '/scoreboard', secret: '/secrets/first-click' })) {
      await page.goto(`${baseURL}${route}`);
      if (name === 'home') await expect(page.locator('[data-cell]').first()).toBeAttached();
      if (name === 'secret') await expect(page.locator('[data-board-diagram] svg')).toBeAttached();
      if (name === 'freecell') await expect(page.locator('.fc-card')).toHaveCount(52);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: join(screenshots, `${name}.png`), animations: 'disabled' });
    }
    await page.goto(`${baseURL}/#your-copy`);
    await page.locator('.drop-zone').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(screenshots, 'resources.png'), animations: 'disabled' });
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto(`${baseURL}/?seed=42`);
    await expect(page.locator('[data-cell]')).toHaveCount(81);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(screenshots, 'phone-small.png'), fullPage: true, animations: 'disabled' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Small 320px phones must also fit without horizontal overflow.');
  });
  await check('No uncaught browser exceptions', async () => assert.deepEqual(browserErrors, []));
  await context.close();
  const failed = results.tests.filter((test) => !test.passed);
  console.log(`${results.tests.length - failed.length}/${results.tests.length} browser scenarios passed.`);
  if (failed.length) process.exitCode = 1;
} catch (error) {
  results.error = error.stack || String(error);
  if (page) await page.screenshot({ path: join(screenshots, 'failed.png'), fullPage: true }).catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (ownServer) await new Promise((resolveClose) => server.close(resolveClose));
  await writeFile(join(root, 'notes/browser-results.json'), JSON.stringify(results, null, 2));
}
