import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpider, loadSpiderReplay } from '../src/spider-core.js';
import { playSpider } from '../src/spider-solver.js';
import { loadReplay } from '../src/shared.js';

/** Deterministic test randomness (mulberry32). */
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rank = card => card % 13;
const suit = card => Math.floor(card / 13);

function assertInvariants(game) {
  const state = game.state({ reveal: true });
  const uids = [...state.columns.flat(), ...state.stockCards].map(card => card.uid);
  assert.equal(uids.length + 13 * state.completed.length, 104, 'card conservation');
  assert.equal(new Set(uids).size, uids.length, 'every physical card appears once');
  assert.ok(uids.every(uid => Number.isInteger(uid) && uid >= 0 && uid < 104));
  assert.equal(state.stock % 10, 0);
  assert.equal(state.dealsLeft, state.stock / 10);
  assert.equal(state.score, 500 - state.moves + 100 * state.completed.length, 'classic score');
  assert.equal(state.status, state.completed.length === 8 ? 'won' : 'playing');
  for (const column of state.columns) {
    const firstUp = column.findIndex(card => card.faceUp);
    if (column.length) {
      assert.ok(column.at(-1).faceUp, 'the top card of a column is always face up');
      assert.ok(column.slice(firstUp).every(card => card.faceUp), 'face-down cards sit under face-up cards');
    }
    // A finished king-to-ace run is always collected automatically.
    if (column.length >= 13) {
      const top = column.slice(-13);
      const complete = top.every((card, i) => card.faceUp && suit(card.card) === suit(top[0].card) && rank(card.card) === 12 - i);
      assert.ok(!complete, 'complete runs never stay on the table');
    }
  }
  // Public state hides face-down cards.
  const hidden = game.state();
  hidden.columns.flat().forEach(card => assert.equal(card.card === null, !card.faceUp));
  assert.equal(hidden.stockCards, undefined);
  return state;
}

function faceCounts(state) {
  const counts = new Map();
  for (const card of [...state.columns.flat(), ...state.stockCards]) counts.set(card.card, (counts.get(card.card) || 0) + 1);
  return counts;
}

test('the classic deal: 54 cards in ten columns, 50 in the stock, tops face up', async () => {
  const game = await createSpider({ seed: 42, suits: 4 });
  const state = assertInvariants(game);
  assert.deepEqual(state.columns.map(column => column.length), [6, 6, 6, 6, 5, 5, 5, 5, 5, 5]);
  assert.deepEqual(state.columns.map(column => column.filter(card => card.faceUp).length), Array(10).fill(1));
  assert.equal(state.stock, 50);
  assert.equal(state.dealsLeft, 5);
  assert.equal(state.score, 500);
  assert.equal(state.moves, 0);
  assert.deepEqual(state.completed, []);
  assert.equal(state.canUndo, false);
  assert.equal(state.canDeal, true);
});

test('each suit count uses the right faces: 1 suit spades, 2 suits spades and hearts, 4 suits two decks', async () => {
  for (const [suits, expected] of [
    [1, Array.from({ length: 13 }, (_, r) => [39 + r, 8])],
    [2, [...Array.from({ length: 13 }, (_, r) => [26 + r, 4]), ...Array.from({ length: 13 }, (_, r) => [39 + r, 4])]],
    [4, Array.from({ length: 52 }, (_, card) => [card, 2])],
  ]) {
    for (let seed = 0; seed < 50; seed++) {
      const game = await createSpider({ seed, suits });
      const counts = faceCounts(game.state({ reveal: true }));
      assert.deepEqual([...counts.entries()].sort((a, b) => a[0] - b[0]), expected, `suits ${suits} seed ${seed}`);
    }
  }
});

test('deals are deterministic per seed and suit count, and vary across seeds', async () => {
  const layouts = new Set();
  for (let seed = 0; seed < 300; seed++) {
    const first = (await createSpider({ seed, suits: 2 })).state({ reveal: true });
    const second = (await createSpider({ seed, suits: 2 })).state({ reveal: true });
    assert.deepEqual(first, second);
    layouts.add(JSON.stringify(first.columns));
  }
  assert.equal(layouts.size, 300);
  const max = (await createSpider({ seed: 0xffffffff, suits: 1 })).state();
  assert.equal(max.seed, 0xffffffff);
  await assert.rejects(createSpider({ seed: -1 }), RangeError);
  await assert.rejects(createSpider({ seed: 1.5 }), RangeError);
  await assert.rejects(createSpider({ suits: 3 }), RangeError);
});

test('move rules: same-suit runs only, one rank lower, empty columns take anything; undo costs a point', async () => {
  let found = 0;
  for (let seed = 1; seed < 400 && found < 50; seed++) {
    const game = await createSpider({ seed, suits: 4 });
    const state = game.state();
    for (let from = 0; from < 10; from++) {
      for (let to = 0; to < 10; to++) {
        const moving = state.columns[from].at(-1).card;
        const target = state.columns[to].at(-1).card;
        const legal = from !== to && rank(target) === rank(moving) + 1;
        assert.equal(game.canMove(from, to, 1), legal);
        assert.equal(game.canMove(from, to, 2), false, 'only one card is face up after the deal');
        assert.equal(game.canMove(from, to, 0), false);
      }
    }
    const hint = game.hints().find(option => option.type === 'move');
    if (!hint) continue;
    found++;
    const before = game.state({ reveal: true });
    assert.equal(game.move(hint.from, hint.to, hint.count), true);
    const after = game.state({ reveal: true });
    assert.equal(after.moves, 1);
    assert.equal(after.score, 499);
    assert.equal(after.columns[hint.to].length, before.columns[hint.to].length + hint.count);
    assert.deepEqual(game.lastChange().flipped, [hint.from], 'the exposed card flips');
    assert.ok(after.columns[hint.from].at(-1).faceUp);
    assert.equal(game.undo(), true);
    const undone = game.state({ reveal: true });
    assert.deepEqual(undone.columns, before.columns);
    assert.equal(undone.moves, 2);
    assert.equal(undone.score, 498);
    assert.equal(game.undo(), false);
    assert.equal(game.move('c' + hint.from, 'c' + hint.to), true, 'count defaults to the longest fitting run');
    assert.equal(game.move(hint.from, 10, 1), false);
    assert.equal(game.move('x', hint.to, 1), false);
  }
  assert.equal(found, 50);
});

test('a row can only be dealt while every column has a card', async () => {
  const game = await createSpider({ seed: 5, suits: 1 });
  for (let deal = 0; deal < 5; deal++) {
    const before = game.state();
    assert.equal(game.deal(), true);
    const after = game.state();
    assert.equal(after.stock, before.stock - 10);
    after.columns.forEach((column, index) => {
      assert.ok(column.length === before.columns[index].length + 1 || after.completed.length > before.completed.length);
      assert.ok(column.at(-1).faceUp);
    });
  }
  assert.equal(game.canDeal(), false);
  assert.equal(game.deal(), false);
  // Empty a column through the solver, then check the block.
  for (let seed = 1; seed < 200; seed++) {
    const play = await createSpider({ seed, suits: 1 });
    for (let step = 0; step < 400; step++) {
      const state = play.state();
      if (state.columns.some(column => column.length === 0) && state.stock > 0) {
        assert.equal(state.canDeal, false);
        assert.equal(play.deal(), false);
        assert.ok(play.hints().every(option => option.type === 'move'));
        return;
      }
      const option = play.hints()[0];
      if (!option) break;
      if (option.type === 'deal') play.deal(); else play.move(option.from, option.to, option.count);
    }
  }
  assert.fail('no position with an empty column was reached');
});

test('random play over 1,500 deals keeps every invariant; replays and undo round-trip', async () => {
  let steps = 0, completions = 0, flips = 0;
  for (let seed = 1; seed <= 1500; seed++) {
    const suits = [1, 2, 4][seed % 3];
    const rng = random(seed);
    const game = await createSpider({ seed, suits });
    for (let step = 0; step < 40; step++) {
      const options = game.hints();
      const roll = rng();
      let ok;
      if (roll < 0.08 && game.canUndo()) ok = game.undo();
      else if (roll < 0.15) {
        // Random raw attempt: must agree with canMove.
        const from = Math.floor(rng() * 10), to = Math.floor(rng() * 10), count = 1 + Math.floor(rng() * 4);
        const legal = game.canMove(from, to, count);
        ok = game.move(from, to, count);
        assert.equal(ok, legal);
        if (!ok) continue;
      } else if (options.length) {
        const option = options[Math.floor(rng() * Math.min(options.length, 4))];
        if (option.type === 'move') assert.equal(game.canMove(option.from, option.to, option.count), true, 'hints are legal');
        ok = option.type === 'deal' ? game.deal() : game.move(option.from, option.to, option.count);
        assert.equal(ok, true);
      } else break;
      const change = game.lastChange();
      flips += change.flipped.length;
      completions += change.completed.length;
      steps++;
      assertInvariants(game);
    }
    const replayed = await loadSpiderReplay(JSON.stringify(game.replay()));
    assert.deepEqual(replayed.state({ reveal: true }), game.state({ reveal: true }), `replay seed ${seed}`);
  }
  assert.ok(steps > 40000, `random play covered ${steps} steps`);
  assert.ok(flips > 1000);
});

test('the hint cycles through the ranked list and resets after any action', async () => {
  const game = await createSpider({ seed: 9, suits: 1 });
  const list = game.hints();
  assert.ok(list.length > 1);
  const seen = Array.from({ length: list.length + 1 }, () => game.hint());
  assert.deepEqual(seen.slice(0, list.length), list);
  assert.deepEqual(seen[list.length], list[0], 'wraps round');
  assert.equal(list.at(-1).type, 'deal', 'dealing is the last suggestion');
  game.move(list[0].from, list[0].to, list[0].count);
  assert.deepEqual(game.hint(), game.hints()[0]);
});

test('replay loading rejects tampered logs and goes through shared.js', async () => {
  const game = await createSpider({ seed: 77, suits: 2 });
  const option = game.hints()[0];
  game.move(option.from, option.to, option.count);
  game.deal();
  game.undo();
  const replay = game.replay();
  assert.deepEqual(replay.actions.map(action => action.type), ['move', 'deal', 'undo']);
  const viaShared = await loadReplay(JSON.stringify(replay));
  assert.deepEqual(viaShared.state(), game.state());
  await assert.rejects(loadSpiderReplay({ ...replay, suits: 3 }), RangeError);
  await assert.rejects(loadSpiderReplay({ ...replay, game: 'freecell' }), TypeError);
  await assert.rejects(loadSpiderReplay({ ...replay, actions: [{ type: 'undo' }] }), /index 0/);
  await assert.rejects(loadSpiderReplay({ ...replay, actions: [{ type: 'move', from: 0, to: 1 }] }), /index 0/);
  await assert.rejects(loadSpiderReplay({ ...replay, actions: [{ type: 'teleport' }] }), /index 0/);
});

test('solver: a simple strategy wins most one-suit deals and its wins replay to a won game', async t => {
  let greedyWins = 0, searchWins = 0;
  const GREEDY = 300, SEARCH = 100;
  for (let seed = 1; seed <= GREEDY; seed++) {
    const game = await createSpider({ seed, suits: 1 });
    const result = playSpider(game, { strategy: 'greedy', budget: 20000 });
    greedyWins += result.won;
    if (result.won && seed <= 40) {
      const state = game.state();
      assert.equal(state.status, 'won');
      assert.deepEqual(state.columns.flat(), []);
      assert.deepEqual(state.completed, Array(8).fill(3));
      assert.equal(state.score, 500 - state.moves + 800);
      const replayed = await loadSpiderReplay(game.replay());
      assert.equal(replayed.state().status, 'won');
      assert.equal(replayed.hint(), null);
      assert.equal(replayed.hasMoves(), false);
      assert.equal(replayed.move(0, 1, 1), false);
      assert.equal(replayed.deal(), false);
    }
  }
  for (let seed = 1; seed <= SEARCH; seed++) {
    searchWins += playSpider(await createSpider({ seed, suits: 1 }), { strategy: 'search', budget: 20000 }).won;
  }
  t.diagnostic(`one-suit greedy ${greedyWins}/${GREEDY} (${(100 * greedyWins / GREEDY).toFixed(1)}%)`);
  t.diagnostic(`one-suit search ${searchWins}/${SEARCH} (${(100 * searchWins / SEARCH).toFixed(1)}%)`);
  assert.ok(greedyWins / GREEDY > 0.35);
  assert.ok(searchWins / SEARCH > 0.65);
});
