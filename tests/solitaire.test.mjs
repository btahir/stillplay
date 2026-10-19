import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { createSolitaire, loadSolitaireReplay, parseLocation } from '../src/solitaire-core.js';
import { loadReplay, parseReplay } from '../src/shared.js';
import { runCLI } from '../scripts/xpc.mjs';

/* An independent JavaScript copy of the documented shuffle (mulberry32 +
 * Fisher-Yates, then a row-by-row deal) so the C core is checked against
 * the written algorithm, not against itself. */
function documentedDeal(seed) {
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    return (t ^ (t >>> 14)) >>> 0;
  };
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) {
    const j = random() % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const tableau = Array.from({ length: 7 }, () => []);
  let next = 0;
  for (let row = 0; row < 7; row++) for (let column = row; column < 7; column++) tableau[column].push(deck[next++]);
  return { tableau, stock: deck.slice(28) };
}

function foundationCards(state) {
  return state.foundations.flatMap((slot) => Array.from({ length: slot.rank }, (_, i) => slot.suit * 13 + i));
}

function assertInvariants(state, label = '') {
  const cards = [...state.tableau.flat(), ...state.stock, ...state.waste, ...foundationCards(state)];
  assert.equal(cards.length, 52, `${label} card count`);
  assert.deepEqual([...cards].sort((a, b) => a - b), Array.from({ length: 52 }, (_, i) => i), `${label} every card once`);
  assert.ok(state.stock.length + state.waste.length <= 24, `${label} stock and waste`);
  assert.ok(state.wasteFan >= 0 && state.wasteFan <= Math.min(state.draw, state.waste.length), `${label} waste fan`);
  if (state.waste.length) assert.ok(state.wasteFan >= 1, `${label} waste top visible`);
  const red = (card) => [1, 2].includes(Math.floor(card / 13));
  state.tableau.forEach((column, index) => {
    const hidden = state.hidden[index];
    assert.ok(hidden >= 0 && hidden <= column.length, `${label} hidden count`);
    if (state.autoFlip && column.length) assert.ok(hidden < column.length, `${label} top card of t${index} is face up`);
    for (let row = hidden + 1; row < column.length; row++) {
      const card = column[row], below = column[row - 1];
      assert.ok(card % 13 + 1 === below % 13 && red(card) !== red(below), `${label} t${index} face-up run is descending and alternating`);
    }
  });
  const suits = state.foundations.filter((slot) => slot.rank).map((slot) => slot.suit);
  assert.equal(new Set(suits).size, suits.length, `${label} each suit has one foundation`);
  state.foundations.forEach((slot) => assert.ok(slot.rank === 0 ? slot.suit === null : slot.suit >= 0 && slot.suit < 4));
  if (state.scoring === 'standard') assert.ok(state.score >= 0, `${label} standard score never negative`);
  if (state.maxPasses) assert.ok(state.pass <= state.maxPasses, `${label} pass limit`);
  assert.equal(state.status === 'won', state.foundations.every((slot) => slot.rank === 13));
}

const TARGETS = [...Array.from({ length: 7 }, (_, i) => `t${i}`), 'h0', 'h1', 'h2', 'h3'];
const SOURCES = [...Array.from({ length: 7 }, (_, i) => `t${i}`), 'w', 'h0', 'h1', 'h2', 'h3'];

/** Every legal action in the position, by asking the core. */
function legalActions(game, state = game.state()) {
  const list = [];
  for (const from of SOURCES) {
    const maxCount = from[0] === 't' ? state.tableau[Number(from[1])].length - state.hidden[Number(from[1])] : 1;
    for (let count = 1; count <= Math.max(1, maxCount); count++) {
      for (const to of TARGETS) if (game.canMove(from, to, count)) list.push({ type: 'move', from, to, count });
    }
  }
  if (state.canDraw) list.push({ type: 'draw' });
  if (state.canRecycle) list.push({ type: 'recycle' });
  for (let column = 0; column < 7; column++) {
    if (state.tableau[column].length && state.hidden[column] === state.tableau[column].length) list.push({ type: 'flip', column });
  }
  return list;
}

function apply(game, action) {
  if (action.type === 'move') return game.move(action.from, action.to, action.count);
  if (action.type === 'flip') return game.flip(action.column);
  return game[action.type]();
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

test('deals follow the documented seeded shuffle for 2000 seeds', async () => {
  const game = await createSolitaire();
  for (let seed = 1; seed <= 2000; seed++) {
    const state = game.newGame(seed);
    const expected = documentedDeal(seed);
    assert.deepEqual(state.tableau, expected.tableau, `seed ${seed}`);
    assert.deepEqual(state.stock, expected.stock, `seed ${seed}`);
    assert.deepEqual(state.hidden, [0, 1, 2, 3, 4, 5, 6]);
    assert.deepEqual(state.waste, []);
    assert.equal(state.score, 0);
    assertInvariants(state, `seed ${seed}`);
  }
  // A fixed fixture guards against accidental changes to the algorithm itself.
  const fixed = game.newGame(7);
  assert.deepEqual(fixed.tableau.map((column) => column.at(-1)), [24, 13, 40, 17, 48, 18, 0]);
  const vegas = game.newGame(7, { scoring: 'vegas', draw: 3 });
  assert.equal(vegas.score, -52);
  assert.equal(vegas.maxPasses, 3);
  assert.deepEqual(vegas.tableau, fixed.tableau, 'options never change the deal');
});

test('random legal play over 2000 seeds never reaches an illegal state', async () => {
  const game = await createSolitaire();
  const modes = [
    { draw: 1, scoring: 'standard' }, { draw: 3, scoring: 'standard' },
    { draw: 1, scoring: 'vegas' }, { draw: 3, scoring: 'vegas' },
    { draw: 3, scoring: 'none', autoFlip: false },
  ];
  let steps = 0;
  for (let seed = 1; seed <= 2000; seed++) {
    const mode = modes[seed % modes.length];
    game.newGame(seed, { autoFlip: true, ...mode });
    const random = rng(seed * 7919);
    for (let step = 0; step < 70; step++) {
      const before = game.state();
      const actions = legalActions(game, before);
      if (!actions.length) break;
      // Illegal probes must never change anything.
      const probe = { from: SOURCES[Math.floor(random() * SOURCES.length)], to: TARGETS[Math.floor(random() * TARGETS.length)], count: 1 + Math.floor(random() * 3) };
      if (!game.canMove(probe.from, probe.to, probe.count)) {
        assert.equal(game.move(probe.from, probe.to, probe.count), false);
        assert.deepEqual(game.state(), before);
      }
      // Prefer moves over turning the stock so games travel further.
      const moves = actions.filter((action) => action.type !== 'draw' && action.type !== 'recycle');
      const pool = moves.length && random() < 0.7 ? moves : actions;
      const action = pool[Math.floor(random() * pool.length)];
      assert.equal(apply(game, action), true, `seed ${seed} step ${step} ${JSON.stringify(action)}`);
      const after = game.state();
      assertInvariants(after, `seed ${seed} step ${step}`);
      assert.equal(after.moves, before.moves + 1);
      if (step % 15 === 7) {
        assert.equal(game.undo(), true);
        assert.deepEqual(game.state(), before, `undo restores seed ${seed} step ${step}`);
        assert.equal(apply(game, action), true);
      }
      steps++;
    }
    if (seed % 50 === 0) {
      const loaded = await loadSolitaireReplay(JSON.parse(JSON.stringify(game.replay())));
      assert.deepEqual(loaded.state(), game.state(), `replay of seed ${seed}`);
    }
  }
  assert.ok(steps > 100000, `exercised ${steps} steps`);
});

test('hints are always legal and greedy hint play wins and auto-finishes real deals', async () => {
  const game = await createSolitaire();
  let finished = 0;
  let won = 0;
  for (let seed = 1; seed <= 1500; seed++) {
    game.newGame(seed, { draw: 1, scoring: 'standard' });
    for (let step = 0; step < 400; step++) {
      const state = game.state();
      if (state.canAutoFinish) break;
      const hint = game.hint();
      if (!hint) break;
      const ok = hint.action === 'move' ? game.move(hint.from, hint.to, hint.count)
        : hint.action === 'flip' ? game.flip(hint.column) : game[hint.action]();
      assert.equal(ok, true, `seed ${seed} hint ${JSON.stringify(hint)}`);
      // Stop endless stock cycling: once a full pass adds nothing, give up.
      if (step > 0 && state.pass > 30) break;
    }
    if (game.state().canAutoFinish) {
      finished++;
      let guard = 0;
      while (game.finishStep()) { assert.ok(++guard < 500); assertInvariants(game.state()); }
      assert.equal(game.state().status, 'won', `seed ${seed} finishes`);
      won++;
      assert.equal(game.finishStep(), null);
      assert.equal(game.hint(), null);
      assert.equal(game.state().canDraw, false);
      const loaded = await loadSolitaireReplay(game.replay());
      assert.equal(loaded.state().status, 'won');
    }
  }
  assert.ok(finished >= 100, `greedy hints reached the automatic finish in ${finished} of 1500 deals`);
  assert.equal(won, finished);
  if (process.env.SOLITAIRE_STATS) console.log({ finished, won });
});

test('draw-three pass limits, recycle order and the waste fan', async () => {
  const game = await createSolitaire({ seed: 11, draw: 3, scoring: 'vegas' });
  const initialStock = game.state().stock;
  assert.equal(game.recycle(), false, 'nothing to recycle yet');
  for (let pass = 1; pass <= 3; pass++) {
    assert.equal(game.state().pass, pass);
    let draws = 0;
    while (game.draw()) {
      draws++;
      const state = game.state();
      assert.equal(state.wasteFan, Math.min(3, state.waste.length - (draws - 1) * 3));
    }
    assert.equal(draws, 8, '24 cards in threes');
    assert.equal(game.state().stock.length, 0);
    if (pass < 3) {
      assert.equal(game.recycle(), true);
      assert.deepEqual(game.state().stock, initialStock, 'recycling restores the original stock order');
      assert.equal(game.state().wasteFan, 0);
    }
  }
  assert.equal(game.state().canRecycle, false);
  assert.equal(game.recycle(), false, 'Vegas draw three allows three passes');
  assert.equal(game.stock(), null);
  assert.equal(game.state().score, -52, 'turning the stock never scores in Vegas');

  const one = await createSolitaire({ seed: 11, draw: 1, scoring: 'vegas' });
  while (one.draw());
  assert.equal(one.state().waste.length, 24);
  assert.equal(one.recycle(), false, 'Vegas draw one is a single pass');

  const standard = await createSolitaire({ seed: 11, draw: 3, scoring: 'standard' });
  for (let pass = 1; pass <= 6; pass++) { while (standard.draw()); assert.equal(standard.recycle(), true); }
  assert.equal(standard.state().pass, 7, 'standard scoring has unlimited passes');
  assert.equal(standard.state().score, 0, 'penalties never take the score below zero');
});

test('scoring rules, manual flips, undo of scores, and rejected input', async () => {
  // Find a seed where the waste top plays to the tableau after one draw.
  const game = await createSolitaire({ seed: 1, draw: 1 });
  let found = null;
  for (let seed = 1; seed < 500 && !found; seed++) {
    game.newGame(seed, { draw: 1, scoring: 'standard' });
    for (let draws = 0; draws < 24 && !found; draws++) {
      game.draw();
      for (let column = 0; column < 7; column++) if (game.canMove('w', `t${column}`)) { found = { seed, column }; break; }
    }
  }
  assert.ok(found);
  const before = game.state().score;
  assert.equal(game.move('w', `t${found.column}`), true);
  assert.equal(game.state().score, before + 5, 'waste to tableau scores 5');
  assert.equal(game.undo(), true);
  assert.equal(game.state().score, before, 'undo restores the score');

  for (const bad of [null, {}, 't7', 'h4', 'x', { type: 'tableau', index: 1.5 }, { type: 'stock' }]) {
    assert.equal(game.move(bad, 't0'), false);
    assert.equal(game.move('t6', bad), false);
  }
  for (const count of [0, -1, 1.5, Infinity, 53]) assert.equal(game.move('t6', 't0', count), false);
  assert.equal(game.move('w', 'w'), false);
  assert.equal(game.move('t0', 's'), false);
  assert.equal(game.flip(0), false);
  assert.equal(game.flip(9), false);
  assert.deepEqual(parseLocation('t3'), { type: 'tableau', index: 3 });
  assert.equal(parseLocation('t7'), null);

  // Manual flips: the core waits for an explicit flip that scores 5.
  const manual = await createSolitaire({ seed: 1, autoFlip: false });
  let flipped = false;
  for (let seed = 1; seed < 300 && !flipped; seed++) {
    manual.newGame(seed, { autoFlip: false, scoring: 'standard' });
    for (let from = 1; from < 7 && !flipped; from++) {
      for (let to = 0; to < 7; to++) {
        if (!manual.move(`t${from}`, `t${to}`)) continue;
        const state = manual.state();
        assert.equal(state.hidden[from], state.tableau[from].length, 'top stays face down');
        assert.equal(state.score, 0);
        assert.equal(manual.canMove(`t${to}`, `t${from}`), false, 'nothing builds on a face-down card');
        assert.equal(manual.flip(from), true);
        assert.equal(manual.state().score, 5);
        assert.equal(manual.flip(from), false);
        flipped = true;
        break;
      }
    }
  }
  assert.ok(flipped);
});

test('timed scoring: two points per ten seconds and the classic bonus', async () => {
  const game = await createSolitaire({ seed: 3 });
  assert.equal(game.timedScore(0), 0);
  assert.equal(game.timeBonus(29), 0);
  assert.equal(game.timeBonus(30), 23333);
  assert.equal(game.timeBonus(700), 1000);
  const vegas = await createSolitaire({ seed: 3, scoring: 'vegas' });
  assert.equal(vegas.timedScore(500), -52, 'time does not change Vegas scores');
  assert.equal(vegas.timeBonus(100), 0);
});

test('replays: shared loader, validation and exact reproduction', async () => {
  const game = await createSolitaire({ seed: 99, draw: 3, scoring: 'vegas' });
  game.draw(); game.draw(); game.undo(); game.draw();
  const hint = game.hint();
  if (hint?.action === 'move') game.move(hint.from, hint.to, hint.count);
  const replay = game.replay();
  assert.equal(replay.game, 'solitaire');
  assert.equal(replay.draw, 3);
  assert.equal(replay.scoring, 'vegas');
  assert.deepEqual(parseReplay(JSON.stringify(replay)), replay);
  assert.deepEqual((await loadReplay(JSON.stringify(replay))).state(), game.state());
  await assert.rejects(loadSolitaireReplay({ ...replay, version: 2 }));
  await assert.rejects(loadSolitaireReplay({ ...replay, seed: 0 }));
  await assert.rejects(loadSolitaireReplay({ ...replay, draw: 2 }));
  await assert.rejects(loadSolitaireReplay({ ...replay, scoring: 'golf' }));
  await assert.rejects(loadSolitaireReplay({ ...replay, actions: [{ type: 'undo' }] }));
  await assert.rejects(loadSolitaireReplay({ ...replay, actions: [{ type: 'move', from: 't0', to: 't0', count: 1 }] }));
  await assert.rejects(loadSolitaireReplay({ ...replay, actions: [{ type: 'finish' }] }));
  await assert.rejects(loadSolitaireReplay({ ...replay, actions: [{ type: 'teleport' }] }));
  for (const bad of [0, -1, 1.5, NaN, 2147483648, '1']) await assert.rejects(createSolitaire({ seed: bad }), RangeError);
  await assert.rejects(createSolitaire({ draw: 2 }), RangeError);
});

test('xpc solitaire commands keep state between calls', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stillplay-solitaire-cli-'));
  const run = async (args) => {
    let stdout = '';
    await runCLI(args, { cwd: directory, env: {}, stdin: Readable.from([]), stdout: { write: (chunk) => { stdout += chunk; } } });
    return stdout;
  };
  try {
    const dealt = JSON.parse(await run(['solitaire', 'new', '--seed', '7', '--draw', '3', '--scoring', 'vegas', '--json']));
    assert.equal(dealt.seed, 7); assert.equal(dealt.draw, 3); assert.equal(dealt.score, -52);
    const drawn = JSON.parse(await run(['solitaire', 'draw', '--json']));
    assert.equal(drawn.waste.length, 3); assert.equal(drawn.wasteFan, 3);
    const hint = JSON.parse(await run(['solitaire', 'hint', '--json']));
    assert.ok(hint && hint.action);
    const text = await run(['solitaire', 'state']);
    assert.match(text, /Solitaire deal 7 · draw 3/);
    assert.match(text, /t6: ## ## ## ## ## ##/);
    await assert.rejects(run(['solitaire', 'move', 't0', 't0']), /not legal/);
    await assert.rejects(run(['solitaire', 'new', '--draw', '2']), /Draw must be 1 or 3/);
    const undone = JSON.parse(await run(['solitaire', 'undo', '--json']));
    assert.equal(undone.waste.length, 0);
    const replay = JSON.parse(await run(['replay', 'export']));
    assert.deepEqual(replay.actions, [{ type: 'draw' }, { type: 'undo' }]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('C rules: exact scores, Vegas, safe auto-moves and the finishing sequence', async (t) => {
  if (spawnSync('cc', ['--version']).status !== 0) { t.skip('Optional native C compiler unavailable'); return; }
  const directory = await mkdtemp(join(tmpdir(), 'stillplay-solitaire-rules-'));
  const corePath = fileURLToPath(new URL('../cores/solitaire.c', import.meta.url));
  // Include the same source to arrange exact positions without adding a
  // state-editing backdoor to the production WASM adapter.
  const source = `
#include <assert.h>
#include ${JSON.stringify(corePath)}
static int card(int rank, int suit) { return suit * 13 + rank - 1; }
static void blank(int draw, int mode) {
  sol_new(1, draw, mode, 0);
  memset(&position, 0, sizeof(position));
  for (int i = 0; i < 4; ++i) position.foundation_suit[i] = -1;
  position.pass = 1;
  position.score = mode == SCORE_VEGAS ? -52 : 0;
  history_head = history_count = 0;
}
static void column(int c, int hidden, int n, const int *cards) {
  for (int i = 0; i < n; ++i) position.tableau[c][i] = (uint8_t)cards[i];
  position.lengths[c] = (uint8_t)n; position.hidden[c] = (uint8_t)hidden;
}
int main(void) {
  /* Standard: tableau to foundation +10, with the automatic flip +5. */
  blank(1, SCORE_STANDARD);
  { int c0[] = { card(9, 3), card(1, 0) }; column(0, 1, 2, c0); }
  assert(sol_move(TABLEAU, 0, FOUNDATION, 2, 1));
  assert(position.score == 15 && position.hidden[0] == 0 && position.foundation_suit[2] == 0);
  /* Foundation back to an empty column is only for kings; to a red 2 it is fine. */
  { int c1[] = { card(2, 1) }; column(1, 0, 1, c1); }
  assert(!sol_can_move(FOUNDATION, 2, TABLEAU, 3, 1));
  assert(sol_move(FOUNDATION, 2, TABLEAU, 1, 1));
  assert(position.score == 0 && position.foundation_suit[2] == -1);
  /* Waste to foundation +10, waste to tableau +5. */
  position.waste[0] = card(1, 1); position.waste[1] = card(8, 1); position.waste_length = 2; position.waste_fan = 1;
  assert(sol_move(WASTE, 0, TABLEAU, 0, 1));
  assert(position.score == 5 && position.waste_fan == 1);
  assert(sol_move(WASTE, 0, FOUNDATION, 0, 1));
  assert(position.score == 15 && position.waste_fan == 0);
  /* Draw one recycle: -100, never below zero. */
  position.waste[0] = card(5, 2); position.waste_length = 1; position.stock_length = 0;
  assert(sol_recycle() && position.score == 0 && position.pass == 2);
  /* Draw three: passes 2 and 3 are free, then -20 each. */
  blank(3, SCORE_STANDARD); position.score = 100;
  position.stock[0] = card(4, 2); position.stock_length = 1;
  for (int pass = 2; pass <= 5; ++pass) { assert(sol_draw()); assert(sol_recycle()); }
  assert(position.pass == 5 && position.score == 60);
  /* Vegas: +5 home, -5 back, pass limit. */
  blank(1, SCORE_VEGAS);
  { int c0[] = { card(1, 3) }; column(0, 0, 1, c0); }
  { int c1[] = { card(2, 2) }; column(1, 0, 1, c1); }
  assert(sol_move(TABLEAU, 0, FOUNDATION, 1, 1) && position.score == -47);
  assert(sol_undo() && position.score == -52);
  assert(sol_move(TABLEAU, 0, FOUNDATION, 1, 1));
  assert(!sol_can_move(FOUNDATION, 1, FOUNDATION, 0, 1));
  assert(sol_move(FOUNDATION, 1, TABLEAU, 1, 1) && position.score == -52);
  position.waste[0] = card(7, 0); position.waste_length = 1;
  assert(!sol_can_recycle());
  /* Building rules: alternate colours, one lower; kings alone go to empty columns. */
  blank(1, SCORE_STANDARD);
  { int c0[] = { card(8, 0), card(7, 2), card(6, 3) }; column(0, 0, 3, c0); }
  { int c1[] = { card(9, 3) }; column(1, 0, 1, c1); }
  { int c2[] = { card(10, 2) }; column(2, 0, 1, c2); }
  assert(!sol_can_move(TABLEAU, 0, TABLEAU, 1, 3)); /* 8C on 9S: same colour */
  assert(!sol_can_move(TABLEAU, 0, TABLEAU, 2, 3)); /* 8C on 10H: not one lower */
  position.tableau[1][0] = (uint8_t)card(9, 2); /* 9H */
  assert(sol_can_move(TABLEAU, 0, TABLEAU, 1, 3));
  assert(sol_can_move(TABLEAU, 0, TABLEAU, 1, 2) == 0); /* 7H on 9H is not a build */
  assert(sol_can_move(TABLEAU, 0, TABLEAU, 2, 0) == 0);
  assert(!sol_can_move(TABLEAU, 0, TABLEAU, 3, 3)); /* empty column needs a king */
  assert(!sol_can_move(TABLEAU, 0, TABLEAU, 1, 4));
  assert(!sol_can_move(TABLEAU, 0, FOUNDATION, 0, 2));
  /* Safe auto-moves wait for both opposite-colour foundations. */
  blank(1, SCORE_STANDARD);
  position.foundation_suit[0] = 0; position.foundation_rank[0] = 2; /* clubs to 2 */
  position.foundation_suit[1] = 1; position.foundation_rank[1] = 1; /* diamonds ace */
  { int c0[] = { card(3, 0) }; column(0, 0, 1, c0); }
  assert(!sol_auto_move()); /* 3C needs both red foundations at 2 */
  position.foundation_suit[2] = 2; position.foundation_rank[2] = 2;
  position.foundation_rank[1] = 2;
  assert(sol_auto_move() && position.foundation_rank[0] == 3);
  /* Finishing: all face up and an empty stock finishes every time. */
  blank(1, SCORE_STANDARD);
  for (int s = 0; s < 4; ++s) { position.foundation_suit[s] = (int8_t)s; position.foundation_rank[s] = 11; }
  { int c0[] = { card(13, 0), card(12, 1) }; column(0, 0, 2, c0); }
  { int c1[] = { card(13, 1), card(12, 0) }; column(1, 0, 2, c1); }
  { int c2[] = { card(13, 2), card(12, 3) }; column(2, 0, 2, c2); }
  { int c3[] = { card(13, 3), card(12, 2) }; column(3, 0, 2, c3); }
  assert(sol_can_autofinish());
  int steps = 0;
  while (sol_finish_step()) ++steps;
  assert(steps == 8 && sol_status() && !sol_can_autofinish());
  assert(sol_timed_score(100) == 80 - 20 + 7000);
  /* A face-down card blocks the automatic finish. */
  blank(1, SCORE_STANDARD);
  { int c0[] = { card(13, 0), card(12, 1) }; column(0, 1, 2, c0); }
  assert(!sol_can_autofinish());
  /* Draw three with stock left cannot promise a finish; draw one with unlimited passes can. */
  blank(3, SCORE_STANDARD); position.stock[0] = card(1, 0); position.stock_length = 1;
  assert(!sol_can_autofinish());
  blank(1, SCORE_STANDARD); position.stock[0] = card(1, 0); position.stock_length = 1;
  assert(sol_can_autofinish());
  /* Invalid configuration is refused. */
  assert(!sol_new(0, 1, 1, 0) && !sol_new(1, 2, 1, 0) && !sol_new(1, 1, 3, 0) && !sol_new(1, 1, 1, 2));
  return 0;
}`;
  try {
    const sourcePath = join(directory, 'rules.c');
    const binaryPath = join(directory, 'rules');
    await writeFile(sourcePath, source);
    const build = spawnSync('cc', ['-std=c11', '-O2', '-fno-builtin', '-Wall', '-Wextra', '-Werror', '-Wno-unused-function', sourcePath, '-o', binaryPath], { encoding: 'utf8' });
    assert.equal(build.status, 0, build.stderr);
    const result = spawnSync(binaryPath, [], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
