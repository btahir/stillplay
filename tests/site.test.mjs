import test from 'node:test';
import assert from 'node:assert/strict';

// A Map-backed stand-in for the browser's localStorage.
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const { games } = await import('../src/games.js');
const { siteGames, playable } = await import('../src/site/registry.js');
const { pageMeta, allPaths, jsonLd } = await import('../src/site/meta.js');
const stats = await import('../src/site/play/stats.js');
const { drawMini } = await import('../src/site/minis.js');
const { shareText } = await import('../src/site/play/win.js');
const { match } = await import('../src/site/router.js').catch(() => ({ match: null }));

test('a game is playable exactly when the registry gives it a mount', () => {
  for (const game of siteGames()) assert.equal(game.playable, typeof games.find((entry) => entry.id === game.id).mount === 'function' && Boolean(game.path));
  assert.ok(playable().length >= 1);
  assert.ok(siteGames().every((game) => game.number && game.loading));
});

test('every page has a title, a description and Open Graph copy', async () => {
  const { secrets } = await import('../src/secrets.js');
  const paths = allPaths({ secrets });
  assert.equal(new Set(paths).size, paths.length, 'paths are unique');
  const fixedPages = paths.filter((path) => !/^\/(daily|secrets)\/./.test(path) && !siteGames().some((game) => game.path === path));
  assert.deepEqual(fixedPages, ['/', '/daily', '/secrets', '/about']);
  for (const path of paths) {
    const meta = pageMeta(path, { secrets });
    assert.ok(meta, path);
    assert.match(meta.title, /Stillplay/);
    assert.ok(meta.description.length > 40, `${path} description`);
    assert.ok(meta.og.heading, `${path} og heading`);
  }
  for (const game of playable()) {
    assert.ok(paths.includes(game.path) && paths.includes(`/daily/${game.id}`));
    assert.equal(jsonLd(game.path, 'https://example.org', pageMeta(game.path))['@type'], 'VideoGame');
  }
  assert.equal(jsonLd('/', 'https://example.org', pageMeta('/'))['@type'], 'WebApplication');
  assert.equal(pageMeta('/nowhere'), null);
});

test('stats count plays, wins, best times and daily streaks', () => {
  store.clear();
  stats.recordStart('minesweeper');
  stats.recordStart('minesweeper');
  let result = stats.recordWin('minesweeper', { level: 'beginner', elapsedSeconds: 40 });
  assert.equal(result.played, 2);
  assert.equal(result.won, 1);
  assert.equal(result.winRate, 50);
  result = stats.recordWin('minesweeper', { level: 'beginner', elapsedSeconds: 31 }, { countedStart: false });
  assert.equal(result.played, 3);
  assert.equal(result.best.beginner, 31);
  assert.equal(result.bestTime, 31);

  const day = (offset) => { const date = new Date(); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10); };
  stats.recordWin('freecell', { daily: true, elapsedSeconds: 90 }, { countedStart: false, date: day(-3) });
  stats.recordWin('freecell', { daily: true, elapsedSeconds: 80 }, { countedStart: false, date: day(-2) });
  result = stats.recordWin('freecell', { daily: true, elapsedSeconds: 70 }, { countedStart: false, date: day(-1) });
  assert.equal(result.daily.current, 3);
  // Winning the same daily twice does not extend the streak.
  result = stats.recordWin('freecell', { daily: true, elapsedSeconds: 60 }, { countedStart: false, date: day(-1) });
  assert.equal(result.daily.current, 3);
  assert.equal(result.daily.results[day(-1)], 60);
  assert.equal(stats.getStats('freecell').currentStreak, 3, 'a streak from yesterday is still alive today');
  // A missed day resets the streak but keeps the best.
  result = stats.recordWin('freecell', { daily: true, elapsedSeconds: 50 }, { countedStart: false, date: day(1) });
  assert.equal(result.daily.current, 1);
  assert.equal(result.bestStreak, 3);
});

test('stats shrug off broken or hostile storage', () => {
  store.set('stillplay-stats-v1', '{broken');
  assert.equal(stats.getStats('minesweeper').played, 0);
  store.set('stillplay-stats-v1', JSON.stringify({ minesweeper: { played: -4, won: 'lots', best: { beginner: 'fast', expert: 99 }, daily: { last: 'yesterday', current: 2.5, results: { nope: 1, '2026-01-01': 12 } } } }));
  const clean = stats.getStats('minesweeper');
  assert.equal(clean.played, 0);
  assert.equal(clean.won, 0);
  assert.deepEqual(clean.best, { expert: 99 });
  assert.equal(clean.daily.last, null);
  assert.deepEqual(Object.keys(clean.daily.results), ['2026-01-01']);
  globalThis.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.doesNotThrow(() => stats.recordStart('minesweeper'));
  globalThis.localStorage.setItem = (key, value) => store.set(key, String(value));
});

test('every registry game has a code-drawn miniature', () => {
  for (const game of games) {
    const svg = drawMini(game.id, { still: true });
    assert.match(svg, /^<svg class="mini"/);
    assert.doesNotMatch(svg, /animateMotion/);
  }
});

test('share text names the game, the time and the streak', () => {
  const game = siteGames().find((entry) => entry.id === 'minesweeper');
  const text = shareText(game, { game: 'minesweeper', level: 'expert', elapsedSeconds: 125, daily: true, flags: 0 }, { currentStreak: 4 });
  assert.match(text, /Daily Minesweeper/);
  assert.match(text, /Cleared in 2:05 · Expert · no flags/);
  assert.match(shareText({ title: 'FreeCell' }, { game: 'freecell', deal: 11982, moves: 90, elapsedSeconds: 300 }), /Solved in 5:00 · Deal #11982 · 90 moves/);
  assert.match(shareText({ title: 'Spider Solitaire' }, { game: 'spider', deal: 7, variant: 'two suits', moves: 120, elapsedSeconds: 600 }), /Solved in 10:00 · Two suits · Deal #7/);
  assert.match(shareText({ title: 'Hearts' }, { game: 'hearts', deal: 3, scores: [47, 102, 63, 88], hands: 9, elapsedSeconds: 900 }), /Won 47 to 63 in 9 hands · Deal #3/);
  assert.match(text, /Daily streak: 4 days/);
});

test('routes resolve from the registry', { skip: !match && 'router needs a DOM' }, () => {
  assert.equal(match('/').name, 'home');
  for (const game of siteGames().filter((entry) => entry.path)) assert.equal(match(game.path).name, game.playable ? 'game' : 'soon');
  for (const game of playable()) {
    assert.equal(match(`/daily/${game.id}`).name, 'game');
    assert.equal(match(`/daily/${game.id}`).params.daily, true);
  }
  assert.equal(match('/daily').name, 'daily');
  assert.equal(match('/about').name, 'about');
  assert.equal(match('/secrets/xyzzy').params.slug, 'xyzzy');
  assert.equal(match('/missing').name, 'not-found');
  assert.equal(match('/freecell/').name, 'game');
});
