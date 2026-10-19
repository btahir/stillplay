import { createSolitaire } from '../src/solitaire-core.js';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { chromium, expect } from '@playwright/test';
import { loadReplay } from '../src/minesweeper-core.js';
import { loadFreecellReplay } from '../src/freecell-core.js';
import { createSpider } from '../src/spider-core.js';
import { playSpider } from '../src/spider-solver.js';
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
  // ONLY=Spider runs just the scenarios whose name contains that text (handy while iterating).
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
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
  // Card games share src/card-table.js: drag and drop, taps, keyboard and motion.
  const pileCards = (target, pile) => target.locator(`[data-pile-id="${pile}"] .ct-card`);
  async function dragTo(target, from, to, steps = 8) {
    const a = await from.boundingBox();
    const b = await to.boundingBox();
    await target.mouse.move(a.x + a.width / 2, a.y + Math.min(14, a.height / 4));
    await target.mouse.down();
    for (let i = 1; i <= steps; i++) await target.mouse.move(a.x + a.width / 2 + (b.x - a.x) * i / steps, a.y + 14 + (b.y + 10 - a.y - 14) * i / steps);
    await target.mouse.up();
  }
  await check('FreeCell cards drag to a free cell and back through the shared card table', async () => {
    await page.goto(`${baseURL}/freecell?deal=1`);
    await expect(page.locator('.fc-card')).toHaveCount(52);
    await dragTo(page, page.locator('.fc-card[data-loc="column"][data-index="0"]').last(), page.locator('.fc-empty-slot[data-index="1"]'));
    await expect(page.locator('.fc-freecells .fc-card[data-loc="freecell"][data-index="1"]')).toHaveCount(1);
    await expect(page.locator('.fc-statusbar')).toContainText('1 move');
    await page.keyboard.press('Control+z');
    await expect(page.locator('.fc-freecells .fc-card')).toHaveCount(0);
  });
  await check('Solitaire deals and a legal drag scores, flips and snaps illegal drops back', async () => {
    await page.goto(`${baseURL}/solitaire?deal=7&draw=1`);
    await expect(page.locator('.solitaire-root .ct-card')).toHaveCount(52);
    await expect(pileCards(page, 's')).toHaveCount(24);
    for (let column = 0; column < 7; column++) await expect(pileCards(page, `t${column}`)).toHaveCount(column + 1);
    await expect(page.locator('.sol-title')).toHaveText('Solitaire — Deal #7');
    // Deal 7 starts with the ace of clubs on column 7: drag it home, which also turns the card beneath.
    await dragTo(page, pileCards(page, 't6').last(), page.locator('[data-pile-id="h0"]'));
    await expect(pileCards(page, 'h0')).toHaveCount(1);
    await expect(pileCards(page, 'h0').first()).toHaveAttribute('aria-label', /Ace of clubs/);
    await expect(pileCards(page, 't6').last()).not.toHaveClass(/ct-face-down/);
    await expect(page.locator('.sol-status-score')).toHaveText('Score: 15');
    // The queen of diamonds cannot go on the two of spades: it returns to where it was.
    const queen = pileCards(page, 't0').last();
    const before = await queen.boundingBox();
    await dragTo(page, queen, pileCards(page, 't2').last());
    await expect(pileCards(page, 't0')).toHaveCount(1);
    assert.deepEqual(await queen.boundingBox(), before, 'An illegal drop snaps back to the same place.');
    await expect(page.locator('.sol-message')).toContainText('Back where it was');
    // Tapping the stock turns one card.
    await pileCards(page, 's').last().click();
    await expect(pileCards(page, 'w')).toHaveCount(1);
    await expect(pileCards(page, 's')).toHaveCount(23);
  });
  await check('Solitaire plays from the keyboard and undoes through the core', async () => {
    await page.goto(`${baseURL}/solitaire?deal=7&draw=1`);
    await expect(page.locator('.solitaire-root .ct-card')).toHaveCount(52);
    await pileCards(page, 't1').last().focus();
    await page.keyboard.press('Enter');
    await expect(pileCards(page, 't1').last()).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.sol-message')).toContainText('Ace of diamonds');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('[data-pile-id="h0"] .sol-slot')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(pileCards(page, 'h0')).toHaveCount(1);
    await expect(pileCards(page, 't1')).toHaveCount(1);
    await expect(page.locator('.sol-status-moves')).toHaveText('1 move');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z');
    await expect(pileCards(page, 'h0')).toHaveCount(0);
    await expect(pileCards(page, 't1')).toHaveCount(2);
    await expect(pileCards(page, 't1').first()).toHaveClass(/ct-face-down/);
    // Escape puts a picked-up card back.
    await pileCards(page, 't0').last().focus();
    await page.keyboard.press('Space');
    await expect(pileCards(page, 't0').last()).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(pileCards(page, 't0').last()).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('h');
    await expect(page.locator('.sol-message')).toContainText('Try ');
  });
  await check('Solitaire finishes itself and reaches the win with reduced motion', async () => {
    // Find a deal that greedy hints bring to an all-face-up table, then open it as a replay link.
    const game = await createSolitaire({ seed: 1 });
    let replay = null;
    for (let seed = 1; seed < 400 && !replay; seed++) {
      game.newGame(seed, { draw: 1, scoring: 'standard', autoFlip: true });
      for (let step = 0; step < 400; step++) {
        const state = game.state();
        if (state.canAutoFinish) { replay = game.replay(); break; }
        const hint = game.hint();
        if (!hint || state.pass > 30) break;
        if (hint.action === 'move') game.move(hint.from, hint.to, hint.count); else game[hint.action]();
      }
    }
    assert.ok(replay, 'A deal that reaches the automatic finish exists.');
    await page.goto(`${baseURL}/solitaire#replay=${Buffer.from(JSON.stringify(replay)).toString('base64')}`);
    await expect(page.locator('.sol-message')).toContainText('Replay loaded');
    await expect(page.locator('.sol-quick-actions .sol-finish')).toBeVisible();
    await expect(page.locator('.sol-title')).toHaveText(`Solitaire — Deal #${replay.seed}`);
    await page.locator('.sol-quick-actions .sol-finish').click();
    await expect(page.locator('.sol-win')).toBeVisible();
    await expect(page.locator('.sol-win')).toContainText(`You won deal #${replay.seed}`);
    for (const slot of [0, 1, 2, 3]) await expect(pileCards(page, `h${slot}`)).toHaveCount(13);
    await expect(page.locator('#dialog[open]')).toBeVisible();
    await expect(page.locator('#dialog')).toContainText('Solitaire');
    await page.locator('#dialog-close').click();
  });
  await check('Solitaire win cascade plays with motion on and skips on a key press', async () => {
    const motion = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
    try {
      const live = await motion.newPage();
      live.on('pageerror', (error) => browserErrors.push(error.message));
      const game = await createSolitaire({ seed: 1 });
      let replay = null;
      for (let seed = 1; seed < 400 && !replay; seed++) {
        game.newGame(seed);
        for (let step = 0; step < 400 && !game.state().canAutoFinish; step++) {
          const hint = game.hint();
          if (!hint || game.state().pass > 30) break;
          if (hint.action === 'move') game.move(hint.from, hint.to, hint.count); else game[hint.action]();
        }
        if (game.state().canAutoFinish) { while (game.finishStep()); replay = game.replay(); }
      }
      // Undo the final card, then play it by double-click so the real UI wins.
      replay.actions.push({ type: 'undo' });
      await live.goto(`${baseURL}/solitaire#replay=${Buffer.from(JSON.stringify(replay)).toString('base64')}`);
      await expect(live.locator('.sol-message')).toContainText('Replay loaded');
      const last = live.locator('[data-pile-id^="t"] .ct-card, [data-pile-id="w"] .ct-card').last();
      await last.dblclick();
      await expect(live.locator('.ct-cascade')).toBeAttached();
      await live.waitForTimeout(700);
      await live.screenshot({ path: join(screenshots, 'solitaire-cascade.png') });
      await live.keyboard.press('Escape');
      await expect(live.locator('.sol-win')).toBeVisible();
    } finally { await motion.close(); }
  });
  await check('Solitaire fits a 320px phone and plays by touch', async () => {
    const phone = await browser.newContext({ viewport: { width: 320, height: 740 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    try {
      const touch = await phone.newPage();
      touch.on('pageerror', (error) => browserErrors.push(error.message));
      await touch.goto(`${baseURL}/solitaire?deal=7&draw=1`);
      await expect(touch.locator('.solitaire-root .ct-card')).toHaveCount(52);
      const fit = await touch.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth, right: document.querySelector('.sol-window').getBoundingClientRect().right }));
      assert.ok(fit.scroll <= fit.width + 1 && fit.right <= fit.width, `Solitaire overflows a 320px screen: ${JSON.stringify(fit)}`);
      await pileCards(touch, 's').last().tap();
      await expect(pileCards(touch, 'w')).toHaveCount(1);
      // A real touch drag: the ace of clubs to a foundation.
      const ace = await pileCards(touch, 't6').last().boundingBox();
      const home = await touch.locator('[data-pile-id="h2"]').boundingBox();
      const client = await phone.newCDPSession(touch);
      const point = (x, y) => [{ x, y, id: 1 }];
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(ace.x + ace.width / 2, ace.y + 10) });
      for (let i = 1; i <= 8; i++) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(ace.x + ace.width / 2 + (home.x + home.width / 2 - ace.x - ace.width / 2) * i / 8, ace.y + 10 + (home.y + 10 - ace.y - 10) * i / 8) });
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(pileCards(touch, 'h2')).toHaveCount(1);
      await touch.screenshot({ path: join(screenshots, 'solitaire-320.png'), fullPage: true });
    } finally { await phone.close(); }
  });
  await check('Daily Solitaire uses the shared daily deal', async () => {
    await page.goto(`${baseURL}/daily/solitaire`);
    await expect(page.locator('.solitaire-root .ct-card')).toHaveCount(52);
    const deal = await page.evaluate(async () => (await import('/src/shared.js')).dailyDeal());
    await expect(page.locator('.sol-title')).toHaveText(`Solitaire — Deal #${deal}`);
  });
  // Spider: a one-suit deal the simple player wins, replayed up to the moment each scenario needs.
  const spiderPath = playSpider(await createSpider({ seed: 2, suits: 1 }), { strategy: 'greedy', budget: 20000 }).path;
  const spiderLink = (actions, target = baseURL) => `${target}/spider#replay=${Buffer.from(JSON.stringify({ version: 1, game: 'spider', seed: 2, suits: 1, actions })).toString('base64')}`;
  async function spiderAt(count) {
    const model = await createSpider({ seed: 2, suits: 1 });
    for (const action of spiderPath.slice(0, count)) if (action.type === 'deal') model.deal(); else model.move(action.from, action.to, action.count);
    return model;
  }
  /** Plays one solver action through the real UI: a drag for a move, a click on the stock for a deal. */
  async function playSpiderAction(target, model, action) {
    if (action.type === 'deal') { await pileCards(target, 's').last().click(); return; }
    const length = model.state().columns[action.from].length;
    const destination = pileCards(target, `t${action.to}`);
    await dragTo(target, pileCards(target, `t${action.from}`).nth(length - action.count), (await destination.count()) ? destination.last() : target.locator(`[data-pile-id="t${action.to}"]`));
  }
  await check('Spider deals two decks, drags a legal run and snaps an illegal drop back', async () => {
    await page.goto(`${baseURL}/spider?deal=7&suits=1`);
    await expect(page.locator('.spider-root .ct-card')).toHaveCount(104);
    await expect(pileCards(page, 's')).toHaveCount(50);
    await expect(page.locator('.sp-title')).toHaveText('Spider Solitaire — Deal #7');
    await expect(page.locator('.sp-menu-mode')).toHaveText('One suit');
    const model = await createSpider({ seed: 7, suits: 1 });
    const legal = model.hints().find((hint) => hint.type === 'move');
    const before = model.state().columns.map((column) => column.length);
    await playSpiderAction(page, model, legal);
    await expect(pileCards(page, `t${legal.to}`)).toHaveCount(before[legal.to] + legal.count);
    await expect(pileCards(page, `t${legal.from}`)).toHaveCount(before[legal.from] - legal.count);
    await expect(page.locator('.sp-status-moves')).toHaveText('Moves: 1');
    await expect(page.locator('.sp-status-score')).toHaveText('Score: 499');
    model.move(legal.from, legal.to, legal.count);
    const columns = model.state().columns;
    let illegal = null;
    for (let a = 0; a < 10 && !illegal; a++) for (let b = 0; b < 10 && !illegal; b++) {
      if (a !== b && columns[a].length && columns[b].length && !model.canMove(a, b, 1)) illegal = { a, b };
    }
    await dragTo(page, pileCards(page, `t${illegal.a}`).last(), pileCards(page, `t${illegal.b}`).last());
    await expect(page.locator('.sp-message')).toContainText('Back where it was');
    await expect(pileCards(page, `t${illegal.a}`)).toHaveCount(columns[illegal.a].length);
    await expect(page.locator('.sp-status-moves')).toHaveText('Moves: 1');
  });
  await check('Spider deals a row from the stock by click and key, and undoes it', async () => {
    await page.goto(`${baseURL}/spider?deal=7&suits=1`);
    await expect(page.locator('.spider-root .ct-card')).toHaveCount(104);
    const before = await Promise.all(Array.from({ length: 10 }, (_, i) => pileCards(page, `t${i}`).count()));
    await pileCards(page, 's').last().click();
    await expect(pileCards(page, 's')).toHaveCount(40);
    for (let i = 0; i < 10; i++) await expect(pileCards(page, `t${i}`)).toHaveCount(before[i] + 1);
    await expect(page.locator('.sp-status-progress')).toContainText('4 deals left');
    await expect(pileCards(page, 't0').last()).toHaveAttribute('data-card', /\d+/);
    await page.keyboard.press('Control+z');
    await expect(pileCards(page, 's')).toHaveCount(50);
    await expect(page.locator('.sp-message')).toContainText('One step back');
    await page.keyboard.press('d');
    await expect(pileCards(page, 's')).toHaveCount(40);
    await expect(page.locator('.sp-status-moves')).toHaveText('Moves: 3');
  });
  await check('Spider explains politely why a row cannot be dealt onto an empty column', async () => {
    let index = 1, model = null;
    for (; index < spiderPath.length; index++) {
      model = await spiderAt(index);
      const state = model.state();
      if (state.stock && state.columns.some((column) => !column.length)) break;
    }
    assert.ok(model.state().columns.some((column) => !column.length), 'The test deal reaches an empty column.');
    await page.goto(spiderLink(spiderPath.slice(0, index)));
    await expect(page.locator('.sp-message')).toContainText('Replay loaded');
    const stock = model.state().stock;
    await expect(pileCards(page, 's')).toHaveCount(stock);
    await pileCards(page, 's').last().click();
    await expect(page.locator('.sp-message')).toContainText(/column needs a card/i);
    await expect(page.locator('.sp-needs-card')).not.toHaveCount(0);
    await expect(pileCards(page, 's')).toHaveCount(stock);
  });
  await check('Spider sends a finished king-to-ace run to the completed area', async () => {
    let index = 0;
    for (; index < spiderPath.length; index++) if ((await spiderAt(index + 1)).state().completed.length) break;
    const model = await spiderAt(index);
    await page.goto(spiderLink(spiderPath.slice(0, index)));
    await expect(page.locator('.sp-message')).toContainText('Replay loaded');
    await expect(pileCards(page, 'r0')).toHaveCount(0);
    await playSpiderAction(page, model, spiderPath[index]);
    await expect(pileCards(page, 'r0')).toHaveCount(13);
    await expect(pileCards(page, 'r0').last()).toHaveAttribute('data-card', '51');
    await expect(page.locator('.sp-status-progress')).toContainText('1 of 8 runs');
    await expect(page.locator('.sp-message')).toContainText('run of spades is complete');
    await expect(page.locator('.sp-status-score')).toHaveText(`Score: ${500 - (index + 1) + 100}`);
  });
  await check('Spider hints with M, highlighting a source and a destination', async () => {
    await page.goto(`${baseURL}/spider?deal=7&suits=1`);
    await expect(page.locator('.spider-root .ct-card')).toHaveCount(104);
    await page.keyboard.press('m');
    await expect(page.locator('.sp-message')).toContainText('Try ');
    assert.ok(await page.locator('.spider-root .ct-hint').count() >= 2, 'A hint marks both ends.');
    const first = await page.locator('.sp-message').textContent();
    await page.keyboard.press('m');
    const model = await createSpider({ seed: 7, suits: 1 });
    if (model.hints().length > 1) await expect(page.locator('.sp-message')).not.toHaveText(first);
  });
  await check('Spider reaches the win with reduced motion and reports it', async () => {
    const model = await spiderAt(spiderPath.length - 1);
    await page.goto(spiderLink(spiderPath.slice(0, -1)));
    await expect(page.locator('.sp-message')).toContainText('Replay loaded');
    await expect(page.locator('.sp-status-progress')).toContainText('7 of 8 runs');
    await playSpiderAction(page, model, spiderPath.at(-1));
    await expect(page.locator('.sp-win')).toBeVisible();
    await expect(page.locator('.sp-win')).toContainText('You won deal #2');
    for (let run = 0; run < 8; run++) await expect(pileCards(page, `r${run}`)).toHaveCount(13);
    await expect(page.locator('#dialog[open]')).toBeVisible();
    await expect(page.locator('#dialog')).toContainText('Spider Solitaire');
    await page.locator('#dialog-close').click();
  });
  await check('Spider win cascade plays with motion on and skips on a key press', async () => {
    const motion = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
    try {
      const live = await motion.newPage();
      live.on('pageerror', (error) => browserErrors.push(error.message));
      const model = await spiderAt(spiderPath.length - 1);
      await live.goto(spiderLink(spiderPath.slice(0, -1)));
      await expect(live.locator('.sp-message')).toContainText('Replay loaded');
      await playSpiderAction(live, model, spiderPath.at(-1));
      await expect(live.locator('.ct-cascade')).toBeAttached();
      await live.waitForTimeout(900);
      await live.screenshot({ path: join(screenshots, 'spider-cascade.png') });
      await live.keyboard.press('Escape');
      await expect(live.locator('.sp-win')).toBeVisible();
    } finally { await motion.close(); }
  });
  await check('Spider fits a 320px phone and plays by touch', async () => {
    const phone = await browser.newContext({ viewport: { width: 320, height: 700 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    try {
      const touch = await phone.newPage();
      touch.on('pageerror', (error) => browserErrors.push(error.message));
      await touch.goto(`${baseURL}/spider?deal=7&suits=1`);
      await expect(touch.locator('.spider-root .ct-card')).toHaveCount(104);
      const fit = await touch.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth, right: document.querySelector('.sp-window').getBoundingClientRect().right, stock: document.querySelector('[data-pile-id="s"]').getBoundingClientRect().right, felt: document.querySelector('.sp-felt').getBoundingClientRect().right }));
      assert.ok(fit.scroll <= fit.width + 1 && fit.right <= fit.width && fit.stock <= fit.felt, `Spider overflows a 320px screen: ${JSON.stringify(fit)}`);
      const model = await createSpider({ seed: 7, suits: 1 });
      const legal = model.hints().find((hint) => hint.type === 'move');
      const length = model.state().columns[legal.from].length;
      const lead = await pileCards(touch, `t${legal.from}`).nth(length - legal.count).boundingBox();
      await touch.touchscreen.tap(lead.x + lead.width / 2, lead.y + 3);
      const target = await pileCards(touch, `t${legal.to}`).last().boundingBox();
      await touch.touchscreen.tap(target.x + target.width / 2, target.y + target.height / 2);
      await expect(touch.locator('.sp-status-moves')).toHaveText('Moves: 1');
      const stock = await pileCards(touch, 's').last().boundingBox();
      await touch.touchscreen.tap(stock.x + stock.width / 2, stock.y + stock.height / 2);
      await expect(pileCards(touch, 's')).toHaveCount(40);
      await touch.screenshot({ path: join(screenshots, 'spider-320.png'), fullPage: true });
    } finally { await phone.close(); }
  });
  await check('Spider keeps a 30-card column inside the window on desktop and phone', async () => {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 375, height: 812 }]) {
      await page.setViewportSize(viewport);
      await page.goto(`${baseURL}/spider?deal=7&suits=1`);
      await expect(page.locator('.spider-root .ct-card')).toHaveCount(104);
      const fit = await page.evaluate(async () => {
        const { mountSpider } = await import('/src/spider-ui.js');
        const handle = await mountSpider(document.querySelector('#full-game'), {});
        const view = { s: [], r0: [], r1: [], r2: [], r3: [], r4: [], r5: [], r6: [], r7: [] };
        let uid = 0;
        const card = (faceUp, face) => ({ key: uid++, card: faceUp ? face : null, faceUp });
        view.t0 = [...Array.from({ length: 4 }, () => card(false)), ...Array.from({ length: 28 }, (_, i) => card(true, 51 - (i % 13)))];
        for (let column = 1; column < 10; column++) view[`t${column}`] = [card(false), card(false), card(true, 40 + column)];
        while (uid < 104) view.s.push(card(false));
        await handle.table.sync(view, { animate: false });
        const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
        const tops = [...document.querySelectorAll('[data-pile-id="t0"] .ct-card')].map((element) => element.getBoundingClientRect().top);
        const result = {
          count: tops.length,
          bottom: Math.max(...[...document.querySelectorAll('.sp-column .ct-card')].map((element) => element.getBoundingClientRect().bottom)),
          tableau: rect('.sp-tableau').bottom,
          felt: rect('.sp-felt').bottom,
          smallestFaceUpGap: Math.min(...tops.slice(5).map((top, i) => top - tops[i + 4])),
        };
        handle.destroy();
        return result;
      });
      assert.equal(fit.count, 32);
      assert.ok(fit.bottom <= fit.tableau + 0.5 && fit.bottom <= fit.felt, `A long column overflows at ${viewport.width}px: ${JSON.stringify(fit)}`);
      assert.ok(fit.smallestFaceUpGap >= 5, `Face-up cards stay apart at ${viewport.width}px: ${JSON.stringify(fit)}`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await check('Daily Spider uses the shared daily deal with one suit, and options remember the suits', async () => {
    await page.goto(`${baseURL}/daily/spider`);
    await expect(page.locator('.spider-root .ct-card')).toHaveCount(104);
    const deal = await page.evaluate(async () => (await import('/src/shared.js')).dailyDeal());
    await expect(page.locator('.sp-title')).toHaveText(`Spider Solitaire — Deal #${deal}`);
    await expect(page.locator('.sp-menu-mode')).toHaveText('Daily · One suit');
    await page.goto(`${baseURL}/spider?deal=9`);
    await expect(page.locator('.spider-root .ct-card')).toHaveCount(104);
    await page.locator('.sp-quick-actions [data-action="options"]').click();
    await page.locator('[data-dialog="options"] input[value="2"]').check();
    await page.locator('[data-dialog="options"] button[type="submit"]').click();
    await expect(page.locator('.sp-menu-mode')).toHaveText('Two suits');
    await expect(page.locator('.sp-title')).toHaveText('Spider Solitaire — Deal #9');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('stillplay-spider-options'))), { suits: 2 });
    await page.evaluate(() => localStorage.removeItem('stillplay-spider-options'));
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
