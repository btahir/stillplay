import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createFreecell, loadFreecellReplay } from '../src/freecell-core.js';

const id = card => 'CDHS'.indexOf(card.at(-1)) * 13 + 'A23456789TJQK'.indexOf(card[0]);
const classicDealOne = [
  'JD KD 2S 4C 3S 6D 6S',
  '2D KC KS 5C TD 8S 9C',
  '9H 9S 9D TS 4S 8D 2H',
  'JC 5S QD QH TH QS 6H',
  '5D AD JS 4H 8H 6C',
  '7H QC AS AC 2C 3D',
  '7C KH AH 4D JH 8C',
  '5H 3H 3C 7S 7D TC',
].map(column => column.split(' ').map(id));

function assertDeck(state) {
  const cards = [...state.columns.flat(), ...state.freecells.filter(card => card !== null)];
  state.foundations.forEach((rank, suit) => {
    assert.ok(Number.isInteger(rank) && rank >= 0 && rank <= 13);
    for (let i = 0; i < rank; i++) cards.push(suit * 13 + i);
  });
  assert.equal(cards.length, 52);
  assert.deepEqual(cards.sort((a, b) => a - b), Array.from({ length: 52 }, (_, i) => i));
}

test('classic deal #1 matches the complete documented board', async () => {
  const game = await createFreecell({ deal: 1 });
  assert.deepEqual(game.state().columns, classicDealOne);
  assert.deepEqual(game.state().freecells, [null, null, null, null]);
  assert.deepEqual(game.state().foundations, [0, 0, 0, 0]);
  assert.equal(game.state().status, 'playing');
  const snapshot = game.state();
  snapshot.columns[0][0] = -10;
  assert.equal(game.state().columns[0][0], id('JD'));
});

test('numbered deal fixtures #24 and #240 agree with published FreeCell Solver data', async () => {
  // Card layouts are factual fixtures, not copied implementation code.
  // Sources: fc-solve/source/t/t/board-gen.t and cpan/Freecell-Deal-MS/t/deal-ms.t.
  const fixtures = [
    [24, [
      '4C 2C 9C 8C QS 4S 2H', '5H QH 3C AC 3H 4H QD',
      'QC 9S 6H 9H 3S KS 3D', '5D 2S JC 5C JH 6D AS',
      '2D KD TH TC TD 8D', '7H JS KH TS KC 7C',
      'AH 5S 6S AD 8H JD', '7S 6C 7D 4D 8S 9D',
    ]],
    [240, [
      'JH 9C 5S KC 6S 2H AS', '5D 3D 9S 2S 3C AD 8C',
      '8S 5C KD QC 3H 4D 3S', '7S AC 9H 6C QH KS 4H',
      'KH JD 7D 4C 8H 6H', 'TS TC 4S 5H QD JS',
      '9D JC 2C QS TH 2D', 'AH 7C 6D 8D TD 7H',
    ]],
  ];
  const game = await createFreecell();
  for (const [deal, columns] of fixtures) {
    game.newGame(deal);
    assert.deepEqual(game.state().columns, columns.map(column => column.split(' ').map(id)));
  }
});

test('single-card rules, foundations, rejected moves, undo and replay', async () => {
  const game = await createFreecell();
  const initial = game.state();
  assert.equal(game.undo(), false);
  assert.equal(game.move('c0', 'c1'), false);
  assert.equal(game.move('c0', 'c0'), false);
  assert.equal(game.move('c6', 'c1'), false); // 8C cannot build on 9C.
  assert.equal(game.move('c5', 'f0'), true); // 3D exposes 2C.
  assert.equal(game.move('c5', 'f0'), false); // Occupied free cell.
  assert.equal(game.move('c5', 'f1'), true); // 2C exposes AC.
  assert.equal(game.move('c5', 'h1'), false); // Wrong foundation suit.
  assert.equal(game.move('c5', 'h0'), true);
  assert.equal(game.move('f1', 'h0'), true);
  assert.equal(game.move('h0', 'f1'), false); // Foundations are one-way.
  assert.equal(game.state().foundations[0], 2);
  assert.equal(game.state().moves, 4);
  assertDeck(game.state());
  assert.equal(game.undo(), true);
  assert.equal(game.state().foundations[0], 1);
  assert.equal(game.state().freecells[1], id('2C'));
  const loaded = await loadFreecellReplay(JSON.stringify(game.replay()));
  assert.deepEqual(loaded.state(), game.state());
  assert.deepEqual(loaded.replay(), game.replay());
  assert.equal(game.undo(), true);
  assert.equal(game.undo(), true);
  assert.equal(game.undo(), true);
  assert.equal(game.undo(), false);
  assert.deepEqual(game.state(), initial);
  game.newGame(11982);
  assert.equal(game.state().deal, 11982);
  assert.deepEqual(game.replay().actions, []);
  assert.equal(game.undo(), false);
});

test('invalid deal, replay and move data are rejected before mutation', async () => {
  const game = await createFreecell();
  for (const bad of [0, -1, 1.5, NaN, Infinity, 2147483648, '1']) {
    await assert.rejects(createFreecell({ deal: bad }), RangeError);
    assert.throws(() => game.newGame(bad), RangeError);
  }
  for (const bad of [null, {}, 'c8', 'f4', { type: 'column', index: 1.5 }]) {
    assert.equal(game.move(bad, 'f0'), false);
    assert.equal(game.move('c0', bad), false);
  }
  for (const count of [0, -1, 1.5, Infinity, 53, 4294967297]) assert.equal(game.move('c0', 'f0', count), false);
  await assert.rejects(loadFreecellReplay({ version: 2, game: 'freecell', deal: 1, actions: [] }));
  await assert.rejects(loadFreecellReplay({ version: 1, game: 'freecell', deal: 1, actions: [{ type: 'undo' }] }));
  await assert.rejects(loadFreecellReplay({ version: 1, game: 'freecell', deal: 1,
    actions: [{ type: 'move', from: 'c0', to: 'c1', count: 1 }] }));
  await assert.rejects(loadFreecellReplay({ version: 1, game: 'freecell', deal: 1, actions: [{ type: 'bogus' }] }));
  assert.equal(game.state().moves, 0);
});

test('3000 numbered deals preserve every card through legal hints, moves, undo and replay', async () => {
  const game = await createFreecell();
  for (let deal = 1; deal <= 3000; deal++) {
    const initial = game.newGame(deal);
    assert.deepEqual(initial.columns.map(column => column.length), [7, 7, 7, 7, 6, 6, 6, 6]);
    assertDeck(initial);
    for (let step = 0; step < 8; step++) {
      const before = game.state();
      const hint = game.hint();
      if (!hint) break;
      assert.equal(game.move(hint.from, hint.to, hint.count), true, `Deal ${deal}, hint ${step}`);
      assertDeck(game.state());
      assert.equal(game.undo(), true);
      assert.deepEqual(game.state(), before);
      assert.equal(game.move(hint.from, hint.to, hint.count), true);
    }
    if (deal % 100 === 0) {
      const loaded = await loadFreecellReplay(game.replay());
      assert.deepEqual(loaded.state(), game.state());
    }
    game.newGame(deal);
    assert.deepEqual(game.state(), initial);
  }
});

test('engines are isolated and automatic foundation moves replay', async () => {
  const left = await createFreecell();
  const right = await createFreecell({ deal: 11982 });
  const before = right.state();
  left.move('c5', 'f0');
  left.move('c5', 'f1');
  assert.equal(left.autoMove(), true); // AC
  for (let step = 0; step < 52 && left.state().foundations[0] < 2; step++) {
    assert.equal(left.autoMove(), true);
  }
  assert.equal(left.state().foundations[0], 2);
  assert.deepEqual(right.state(), before);
  assert.deepEqual((await loadFreecellReplay(left.replay())).state(), left.state());
});

test('C rules exercise supermove capacity, sequence order, and winning/undo boundaries', async t => {
  if (spawnSync('cc', ['--version']).status !== 0) { t.skip('Optional native C compiler unavailable'); return; }
  const directory = await mkdtemp(join(tmpdir(), 'stillplay-freecell-rules-'));
  const corePath = fileURLToPath(new URL('../cores/freecell.c', import.meta.url));
  // Include the same source to arrange hard-to-reach boundary positions without
  // adding a state mutation backdoor to the production WASM adapter.
  const source = `
#include <assert.h>
#include ${JSON.stringify(corePath)}
static void blank(void) {
  memset(&position, 0, sizeof(position));
  for (int i = 0; i < 4; ++i) position.freecells[i] = EMPTY;
  history_head = history_count = 0;
}
static int card(int rank, int suit) { return suit*13 + rank-1; }
static void occupied_columns(void) {
  for (int i = 2; i < 8; ++i) { position.columns[i][0] = card(13, 0); position.lengths[i] = 1; }
}
int main(void) {
  blank(); occupied_columns();
  position.columns[0][0] = card(8, 0);
  position.columns[0][1] = card(7, 1);
  position.columns[0][2] = card(6, 0);
  position.lengths[0] = 3;
  position.columns[1][0] = card(9, 2); position.lengths[1] = 1;
  /* All four freecells empty: five-card capacity with no empty columns. */
  assert(fc_capacity(1) == 5);
  assert(fc_can_move(COLUMN, 0, COLUMN, 1, 3));
  /* One free cell permits two, not three. */
  for (int i = 0; i < 3; ++i) position.freecells[i] = card(2+i, 3);
  assert(fc_capacity(1) == 2);
  assert(!fc_can_move(COLUMN, 0, COLUMN, 1, 3));
  /* One spare empty column doubles capacity. */
  position.lengths[7] = 0;
  assert(fc_capacity(1) == 4);
  assert(fc_move(COLUMN, 0, COLUMN, 1, 3));
  assert(position.lengths[0] == 0 && position.lengths[1] == 4);
  assert(fc_undo());
  /* An empty destination cannot also serve as a spare. */
  position.lengths[1] = 0; position.lengths[7] = 1;
  assert(fc_capacity(1) == 2);
  assert(!fc_can_move(COLUMN, 0, COLUMN, 1, 3));
  position.lengths[7] = 0;
  assert(fc_capacity(1) == 4);
  assert(fc_can_move(COLUMN, 0, COLUMN, 1, 3));
  /* Same-colour sequences and descending gaps are not movable. */
  position.columns[0][1] = card(7, 3);
  assert(!fc_can_move(COLUMN, 0, COLUMN, 1, 3));
  position.columns[0][1] = card(5, 1);
  assert(!fc_can_move(COLUMN, 0, COLUMN, 1, 3));
  blank();
  for (int i = 0; i < 4; ++i) position.foundations[i] = 13;
  position.foundations[3] = 12;
  position.freecells[0] = card(13, 3);
  assert(!fc_status());
  assert(fc_auto_move());
  assert(fc_status());
  assert(!fc_auto_move());
  assert(fc_undo());
  assert(!fc_status() && position.freecells[0] == card(13, 3));
  return 0;
}`;
  try {
    const sourcePath = join(directory, 'rules.c');
    const binaryPath = join(directory, 'rules');
    await writeFile(sourcePath, source);
    const build = spawnSync('cc', ['-std=c11', '-O2', '-fno-builtin', '-Wall', '-Wextra', '-Werror', sourcePath, '-o', binaryPath], { encoding: 'utf8' });
    assert.equal(build.status, 0, build.stderr);
    const run = spawnSync(binaryPath, [], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
