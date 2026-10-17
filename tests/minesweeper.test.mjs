import test from 'node:test';
import assert from 'node:assert/strict';
import { createMinesweeper, loadReplay } from '../src/minesweeper-core.js';

function neighbors(state, index) {
  const x = index % state.width;
  const y = Math.floor(index / state.width);
  const result = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if ((dx || dy) && x + dx >= 0 && x + dx < state.width && y + dy >= 0 && y + dy < state.height) {
        result.push((y + dy) * state.width + x + dx);
      }
    }
  }
  return result;
}

function consistent(state) {
  assert.equal(state.cells.length, state.width * state.height);
  assert.equal(state.cells.filter((cell) => cell.mine).length, state.mines);
  assert.equal(state.cells.filter((cell) => cell.flagged).length, state.flags);
  assert.equal(state.cells.filter((cell) => cell.revealed && !cell.mine).length, state.revealed);
  state.cells.forEach((cell, i) => {
    assert.equal(cell.adjacent, neighbors(state, i).filter((j) => state.cells[j].mine).length);
  });
}

test('seed 1 follows the published MSVC rand stream with our documented placement policy', async () => {
  const game = await createMinesweeper({ seed: 1 });
  // First ten rand values: 41, 18467, 6334, 26500, 19169, 15724,
  // 11478, 29358, 26962, 24464. Each maps modulo 81, without collisions.
  // This fixture verifies our RNG/placement contract, not an original game board.
  assert.deepEqual(game.state().cells.flatMap((cell, i) => cell.mine ? [i] : []),
    [2, 10, 13, 16, 36, 41, 53, 57, 70, 80]);
});

test('3,000 seeded boards retain mine counts, neighbor counts, first-click safety and determinism', async () => {
  const first = await createMinesweeper();
  const second = await createMinesweeper();
  const levels = ['beginner', 'intermediate', 'expert'];
  for (let seed = 0; seed < 3000; seed++) {
    const level = levels[seed % levels.length];
    const initial = first.newGame({ level, seed });
    assert.deepEqual(initial, second.newGame({ level, seed }));
    const index = (seed * 37) % initial.cells.length;
    const x = index % initial.width;
    const y = Math.floor(index / initial.width);
    const played = first.reveal(x, y);
    assert.notEqual(played.status, 'lost');
    assert.equal(played.cells[index].mine, false);
    assert.equal(played.cells[index].revealed, true);
    consistent(played);
    assert.deepEqual(played, second.reveal(x, y));
  }
});

test('first-click relocation changes only two mine positions and preserves flags', async () => {
  const game = await createMinesweeper({ seed: 1 });
  const initial = game.state();
  const mine = initial.cells.findIndex((cell) => cell.mine);
  const safe = initial.cells.findIndex((cell) => !cell.mine);
  game.flag(safe % initial.width, Math.floor(safe / initial.width));
  const state = game.reveal(mine % initial.width, Math.floor(mine / initial.width));
  assert.equal(state.cells[mine].mine, false);
  assert.equal(state.cells[safe].mine, true);
  assert.equal(state.cells[safe].flagged, true);
  assert.equal(state.flags, 1);
  assert.equal(state.cells.filter((cell, i) => cell.mine !== initial.cells[i].mine).length, 2);
  consistent(state);
});

test('flood fill reveals a complete empty region and its numbered boundary', async () => {
  const game = await createMinesweeper({ seed: 43 });
  const initial = game.state();
  const start = initial.cells.findIndex((cell) => !cell.mine && cell.adjacent === 0);
  assert.ok(start >= 0);
  const expected = new Set([start]);
  const queue = [start];
  for (const index of queue) {
    if (initial.cells[index].adjacent) continue;
    for (const next of neighbors(initial, index)) {
      if (!expected.has(next)) { expected.add(next); queue.push(next); }
    }
  }
  const state = game.reveal(start % initial.width, Math.floor(start / initial.width));
  assert.deepEqual(state.cells.flatMap((cell, i) => cell.revealed ? [i] : []), [...expected].sort((a, b) => a - b));
  consistent(state);
});

test('flags prevent reveal and do not start play; coordinates outside the board are harmless', async () => {
  const game = await createMinesweeper();
  game.flag(3, 4);
  assert.equal(game.reveal(3, 4).status, 'ready');
  assert.equal(game.state().revealed, 0);
  const initial = game.state();
  for (const [x, y] of [[-1, 0], [9, 0], [0, 9], [NaN, 1], [0.5, 1]]) {
    game.reveal(x, y); game.flag(x, y); game.chord(x, y);
  }
  assert.deepEqual(game.state(), initial);
  game.flag(3, 4);
  assert.equal(game.state().flags, 0);
});

test('chording with correct flags opens adjacent cells; wrong flags can lose', async () => {
  for (const correct of [true, false]) {
    const game = await createMinesweeper({ seed: 147 });
    const initial = game.state();
    const index = initial.cells.findIndex((cell, i) => !cell.mine && cell.adjacent === 1 &&
      neighbors(initial, i).some((j) => !initial.cells[j].mine));
    const around = neighbors(initial, index);
    const x = index % initial.width;
    const y = Math.floor(index / initial.width);
    game.reveal(x, y);
    const flag = around.find((j) => initial.cells[j].mine === correct);
    game.flag(flag % initial.width, Math.floor(flag / initial.width));
    const state = game.chord(x, y);
    if (correct) {
      assert.notEqual(state.status, 'lost');
      for (const j of around.filter((j) => !initial.cells[j].mine)) assert.equal(state.cells[j].revealed, true);
    } else assert.equal(state.status, 'lost');
    consistent(state);
  }
});

test('opening all safe cells wins and finished games stay frozen', async () => {
  const game = await createMinesweeper({ level: 'expert', seed: 0xffff_ffff });
  let state = game.state();
  for (let i = 0; i < state.cells.length; i++) {
    if (!state.cells[i].mine) state = game.reveal(i % state.width, Math.floor(i / state.width));
  }
  assert.equal(state.status, 'won');
  assert.equal(state.revealed, state.width * state.height - state.mines);
  assert.equal(state.flags, state.mines);
  game.flag(0, 0); game.reveal(0, 0); game.chord(0, 0);
  assert.deepEqual(game.state(), state);
  consistent(state);
});

test('a later mine click loses and freezes further game changes', async () => {
  const game = await createMinesweeper({ seed: 1 });
  const initial = game.state();
  const safe = initial.cells.findIndex((cell) => !cell.mine && cell.adjacent > 0);
  game.reveal(safe % initial.width, Math.floor(safe / initial.width));
  const mine = initial.cells.findIndex((cell) => cell.mine);
  const lost = game.reveal(mine % initial.width, Math.floor(mine / initial.width));
  assert.equal(lost.status, 'lost');
  assert.equal(lost.cells.filter((cell) => cell.mine && cell.revealed).length, lost.mines);
  game.flag(8, 8); game.reveal(8, 8); game.chord(8, 8);
  assert.deepEqual(game.state(), lost);
  consistent(lost);
});

test('replay preserves deterministic states and event timestamps without leaking mutable arrays', async () => {
  const game = await createMinesweeper({ level: 'intermediate', seed: 147 });
  game.flag(0, 0); game.reveal(6, 7); game.chord(6, 7); game.flag(0, 0); game.reveal(0, 0);
  const replay = game.replay();
  const restored = await loadReplay(JSON.parse(JSON.stringify(replay)));
  assert.deepEqual(restored.state(), game.state());
  assert.deepEqual(restored.replay(), replay);
  replay.actions.length = 0;
  assert.equal(game.replay().actions.length, 5);
  const snapshot = game.state(); snapshot.cells[0].mine = !snapshot.cells[0].mine;
  assert.notDeepEqual(game.state(), snapshot);
});

test('replay input is fully validated before replacing the current game', async () => {
  const game = await createMinesweeper();
  game.reveal(3, 4);
  const before = game.state();
  const valid = game.replay();
  for (const value of [
    { ...valid, version: 2 },
    { ...valid, seed: -1 },
    { ...valid, actions: [{ type: 'reveal', x: 9, y: 0, t: 0 }] },
    { ...valid, actions: [{ type: 'flag', x: 0, y: 0, t: -1 }] },
    { ...valid, actions: [{ type: 'reveal', x: 0, y: 0, t: 10 }, { type: 'flag', x: 1, y: 1, t: 9 }] },
    { ...valid, actions: [{ type: 'explode', x: 0, y: 0, t: 0 }] },
  ]) {
    assert.throws(() => game.loadReplay(value));
    assert.deepEqual(game.state(), before);
  }
});

test('instances keep independent memory and invalid options are rejected', async () => {
  const first = await createMinesweeper({ seed: 15 });
  const second = await createMinesweeper({ seed: 15 });
  const initial = second.state();
  first.reveal(4, 4);
  assert.deepEqual(second.state(), initial);
  await assert.rejects(createMinesweeper({ seed: -1 }), RangeError);
  await assert.rejects(createMinesweeper({ seed: 1.5 }), RangeError);
  await assert.rejects(createMinesweeper({ level: 'impossible' }), RangeError);
});
