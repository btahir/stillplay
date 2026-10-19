import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { chromium, expect } from '@playwright/test';
import { loadReplay } from '../src/minesweeper-core.js';
import { loadFreecellReplay } from '../src/freecell-core.js';
import { server } from './dev.mjs';

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
async function check(name, fn) {
  const started = performance.now();
  await fn();
  results.tests.push({ name, passed: true, durationMs: Math.round(performance.now() - started) });
  console.log(`PASS ${name}`);
}
try {
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  results.browser = browser.version();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
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
    await page.locator('.fidelity-toggle').click();
    await expect(page.locator('.fidelity-toggle')).toHaveText('Crisp drawing');
    await page.locator('.fidelity-toggle').click();
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
    await page.locator('[data-cell="0"]').click();
    for (const index of safe) {
      const cell = page.locator(`[data-cell="${index}"]`);
      if ((await cell.getAttribute('aria-label')).startsWith('Covered')) await cell.click();
    }
    await expect(page.locator('.mine-status')).toHaveText('Field cleared. Nicely done.');
    assert.ok(await page.evaluate(() => Number(JSON.parse(localStorage.getItem('stillplay-best-beginner'))) >= 0));
    if (await page.locator('#dialog[open]').count()) await page.locator('#dialog-close').click();
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
    await page.getByRole('link', { name: 'Save replay', exact: true }).click();
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
    await page.getByRole('link', { name: 'Save replay', exact: true }).click();
    const mines = JSON.parse(await readFile(await (await downloading).path(), 'utf8'));
    const seed = await page.evaluate(async () => (await import('/src/shared.js')).dailySeed());
    assert.equal(mines.seed, seed);
    await page.goto(`${baseURL}/daily/freecell`);
    await expect(page.locator('.fc-card')).toHaveCount(52);
    downloading = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Save replay', exact: true }).click();
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
    for (const [name, route] of Object.entries({ home: '/', freecell: '/freecell', scoreboard: '/scoreboard', secret: '/secrets/first-click' })) {
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
  assert.deepEqual(browserErrors, [], 'No uncaught browser exceptions.');
  await context.close();
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
