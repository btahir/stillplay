import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { chromium, expect } from '@playwright/test';
import { loadReplay } from '../src/minesweeper-core.js';
import { loadFreecellReplay } from '../src/freecell-core.js';
import { createSolitaire } from '../src/solitaire-core.js';
import { createHearts } from '../src/hearts-core.js';
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
  // Hearts: the core plays the computer seats; the page replays their cards one at a time.
  const handCards = (target) => target.locator('[data-pile-id="h0"] .ct-card, [data-pile-id="h1"] .ct-card');
  const trickCards = (target) => target.locator('[data-pile-id^="p"] .ct-card');
  async function heartsReady(target, route) {
    await target.goto(`${baseURL}${route}`);
    await expect(target.locator('.hearts-root .ct-card')).toHaveCount(52);
    await expect(target.locator('.hz-pass')).toBeVisible();
  }
  async function passThree(target, picks = [0, 5, 11], tap = false) {
    const chosen = [];
    for (const index of picks) {
      const card = handCards(target).nth(index);
      chosen.push(Number(await card.getAttribute('data-card')));
      await (tap ? card.tap() : card.click());
    }
    await (tap ? target.locator('.hz-pass-button').tap() : target.locator('.hz-pass-button').click());
    return chosen;
  }
  await check('Hearts passes exactly three cards and highlights the three received', async () => {
    await heartsReady(page, '/hearts?deal=5');
    await expect(page.locator('.hz-title')).toHaveText('Hearts — Deal #5');
    await expect(handCards(page)).toHaveCount(13);
    await expect(page.locator('.hz-pass-button')).toBeDisabled();
    await expect(page.locator('.hz-pass-button')).toContainText('Pass left');
    await handCards(page).nth(0).click();
    await handCards(page).nth(0).click();
    await expect(page.locator('.hz-pass-count')).toHaveText('0 of 3 chosen');
    for (const index of [0, 1, 2]) await handCards(page).nth(index).click();
    await handCards(page).nth(3).click();
    await expect(page.locator('.hz-message')).toContainText('Three cards are chosen');
    await expect(page.locator('.hz-card[aria-pressed="true"]')).toHaveCount(3);
    await page.keyboard.press('h');
    await expect(page.locator('.hz-message')).toContainText('Try passing');
    await expect(page.locator('.hz-hint')).toHaveCount(3);
    for (const index of [0, 1, 2]) await handCards(page).nth(index).click();
    const passed = await passThree(page);
    const model = await createHearts({ seed: 5, difficulty: 1 });
    assert.ok(model.pass(passed));
    const expected = model.state();
    await expect(page.locator('.hz-received')).toHaveCount(3);
    const received = await page.locator('.hz-received').evaluateAll((cards) => cards.map((card) => Number(card.dataset.card)).sort((a, b) => a - b));
    assert.deepEqual(received, [...expected.received].sort((a, b) => a - b));
    await expect(page.locator('.hz-message')).toContainText('passed you');
    await expect(page.locator('.hz-felt.hz-playing')).toBeAttached({ timeout: 15000 });
    await expect(handCards(page)).toHaveCount(13);
    // Every computer card the core played before your turn is on the table.
    await expect(trickCards(page)).toHaveCount(expected.trick.length);
    assert.deepEqual(await page.locator('.hz-legal').evaluateAll((cards) => cards.map((card) => Number(card.dataset.card)).sort((a, b) => a - b)), [...expected.legal].sort((a, b) => a - b));
  });
  await check('Hearts refuses an illegal card with a reason and plays a legal one by keyboard', async () => {
    // Continues deal 5: East led the two of clubs.
    const illegal = page.locator('.hz-illegal').first();
    const before = await handCards(page).count();
    await illegal.click();
    await expect(page.locator('.hz-message')).toContainText('You must follow suit: play a club.');
    await expect(handCards(page)).toHaveCount(before);
    await page.keyboard.press('Control+z');
    await expect(page.locator('.hz-message')).toContainText('no undo');
    const legal = Number(await page.locator('.hz-legal').first().getAttribute('data-card'));
    await page.locator(`.hz-card[data-card="${legal}"]`).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator(`.hz-card[data-card="${legal}"]`)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-pile-id="p0"] .ct-card')).toHaveAttribute('data-card', String(legal));
    await expect(handCards(page)).toHaveCount(before - 1);
    await expect(page.locator('.hz-message')).toContainText(/takes the trick/, { timeout: 15000 });
    await expect(page.locator('.hz-felt.hz-playing')).toBeAttached({ timeout: 15000 });
  });
  await check('Hearts computer turns animate one card at a time and the trick sweeps to its winner', async () => {
    const motion = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
    try {
      const live = await motion.newPage();
      live.on('pageerror', (error) => browserErrors.push(error.message));
      await heartsReady(live, '/hearts?deal=5');
      await passThree(live);
      await expect(live.locator('.hz-felt.hz-playing')).toBeAttached({ timeout: 15000 });
      const legal = live.locator('.hz-legal').first();
      // Drag the card up onto the table.
      const box = await legal.boundingBox();
      await live.mouse.move(box.x + box.width / 2, box.y + 12);
      await live.mouse.down();
      for (let i = 1; i <= 8; i++) await live.mouse.move(box.x + box.width / 2, box.y + 12 - i * 22);
      await live.mouse.up();
      await expect(live.locator('[data-pile-id="p0"] .ct-card')).toHaveCount(1);
      // West plays first, then North, each on its own beat with a card in flight.
      await expect(live.locator('[data-pile-id="p1"] .ct-card')).toHaveCount(1, { timeout: 5000 });
      assert.equal(await live.locator('[data-pile-id="p2"] .ct-card').count(), 0, 'North waits for West.');
      await expect(live.locator('[data-pile-id="p2"] .ct-card')).toHaveCount(1, { timeout: 5000 });
      await expect(live.locator('.hz-winner')).toHaveCount(1);
      await live.waitForTimeout(250);
      await live.screenshot({ path: join(screenshots, 'hearts-trick.png') });
      await expect(trickCards(live)).toHaveCount(0, { timeout: 5000 });
      await expect(live.locator('.hz-message')).toContainText(/take/);
    } finally { await motion.close(); }
  });
  await check('Hearts plays a full hand to the summary and the score sheet', async () => {
    await heartsReady(page, '/hearts?deal=12');
    await passThree(page, [10, 11, 12]);
    for (let trick = 0; trick < 13; trick++) {
      await expect(page.locator('.hz-felt.hz-playing, .hz-panel:not([hidden])').first()).toBeAttached({ timeout: 15000 });
      if (await page.locator('.hz-panel:not([hidden])').count()) break;
      await page.locator('.hz-legal').first().click();
    }
    await expect(page.locator('.hz-panel')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.hz-panel [data-action="next-hand"]')).toBeFocused();
    await expect(handCards(page)).toHaveCount(0);
    await page.locator('.hz-panel [data-action="scores"]').click();
    const rows = page.locator('.hz-sheet-table tbody tr');
    await expect(rows).toHaveCount(1);
    const hand = await rows.first().locator('.hz-sheet-hand').evaluateAll((cells) => cells.map((cell) => Number(cell.textContent.replace('+', ''))));
    assert.ok([26, 78].includes(hand.reduce((sum, value) => sum + value, 0)), `A hand gives out 26 points (or 78 after a moon): ${hand}`);
    await page.locator('[data-dialog="scores"] [data-action="cancel-dialog"]').click();
    await page.locator('.hz-panel [data-action="next-hand"]').click();
    await expect(page.locator('.hz-status-hand')).toHaveText('Hand 2 · Pass right');
    await expect(page.locator('.hz-pass-button')).toContainText('Pass right');
    await expect(handCards(page)).toHaveCount(13);
  });
  await check('Hearts reaches game over from a replay and reports the win', async () => {
    const model = await createHearts({ seed: 39, difficulty: 1 });
    for (let state = model.state(); state.phase !== 'gameOver'; state = model.state()) {
      if (state.phase === 'pass') model.pass(model.hint().cards);
      else if (state.phase === 'play') model.play(model.hint().card);
      else model.nextHand();
    }
    assert.deepEqual(model.state().winners, [0]);
    const replay = model.replay();
    const last = replay.actions.pop();
    assert.equal(last.type, 'play');
    await page.goto(`${baseURL}/hearts#replay=${Buffer.from(JSON.stringify(replay)).toString('base64')}`);
    await expect(page.locator('.hz-message')).toContainText('Replay loaded');
    await expect(page.locator(`.hz-legal[data-card="${last.card}"]`)).toBeVisible();
    await page.locator(`.hz-card[data-card="${last.card}"]`).click();
    await expect(page.locator('.hz-panel')).toContainText('Game over', { timeout: 15000 });
    await expect(page.locator('.hz-panel strong')).toHaveText(`You win with ${model.state().scores[0]}.`);
    await expect(page.locator('#dialog[open]')).toBeVisible();
    await expect(page.locator('#dialog')).toContainText('Hearts');
    await page.locator('#dialog-close').click();
  });
  await check('Hearts fits a 320px phone and plays by touch', async () => {
    const phone = await browser.newContext({ viewport: { width: 320, height: 740 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    try {
      const touch = await phone.newPage();
      touch.on('pageerror', (error) => browserErrors.push(error.message));
      await heartsReady(touch, '/hearts?deal=5');
      const fit = await touch.evaluate(() => {
        const felt = document.querySelector('.hz-felt').getBoundingClientRect();
        const cards = [...document.querySelectorAll('.hearts-root .ct-card')].map((card) => card.getBoundingClientRect());
        const hand = [...document.querySelectorAll('[data-pile-id="h0"] .ct-card')].map((card) => card.getBoundingClientRect().left);
        return {
          scroll: document.documentElement.scrollWidth, width: innerWidth, right: document.querySelector('.hz-window').getBoundingClientRect().right,
          outside: cards.filter((card) => card.left < felt.left - 1 || card.right > felt.right + 1 || card.bottom > felt.bottom + 1).length,
          step: Math.min(...hand.slice(1).map((left, i) => left - hand[i])),
        };
      });
      assert.ok(fit.scroll <= fit.width + 1 && fit.right <= fit.width, `Hearts overflows a 320px screen: ${JSON.stringify(fit)}`);
      assert.equal(fit.outside, 0, 'Every card sits inside the table.');
      assert.ok(fit.step >= 24, `Hand cards stay tappable: ${fit.step}px apart.`);
      await passThree(touch, [0, 5, 11], true);
      await expect(touch.locator('.hz-felt.hz-playing')).toBeAttached({ timeout: 15000 });
      await touch.locator('.hz-legal').first().tap();
      await expect(touch.locator('[data-pile-id="p0"] .ct-card')).toHaveCount(1);
      await touch.screenshot({ path: join(screenshots, 'hearts-320.png'), fullPage: true });
    } finally { await phone.close(); }
  });
  await check('Daily Hearts uses the shared daily deal', async () => {
    await heartsReady(page, '/daily/hearts');
    const deal = await page.evaluate(async () => (await import('/src/shared.js')).dailyDeal());
    await expect(page.locator('.hz-title')).toHaveText(`Hearts — Deal #${deal}`);
    await expect(page.locator('.hz-menu-mode')).toContainText('Daily');
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
