import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { runCLI } from '../scripts/xpc.mjs';
import { dailySeed, dailyDeal, parseReplay } from '../src/shared.js';
async function run(directory, args, input = '') {
  let stdout = '';
  try {
    await runCLI(args, { cwd: directory, env: {}, stdin: Readable.from([Buffer.from(input)]), stdout: { write: (chunk) => { stdout += chunk; } } });
    return { status: 0, stdout, stderr: '' };
  } catch (error) { return { status: 1, stdout, stderr: `xpc: ${error.message}` }; }
}
async function successful(directory, args, input) {
  const output = await run(directory, args, input);
  assert.equal(output.status, 0, output.stderr);
  return output.stdout;
}

test('Minesweeper state persists across CLI calls and exported replays restore it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stillplay-cli-'));
  try {
    const first = JSON.parse(await successful(directory, ['minesweeper', 'new', '--level', 'beginner', '--seed', '123', '--json']));
    assert.equal(first.seed, 123); assert.equal(first.status, 'ready');
    const clicked = JSON.parse(await successful(directory, ['minesweeper', 'click', '0', '0', '--json']));
    assert.equal(clicked.cells[0].revealed, true); assert.notEqual(clicked.status, 'lost');
    const replay = await successful(directory, ['replay', 'export']);
    assert.equal(JSON.parse(replay).game, 'minesweeper');
    const loaded = JSON.parse(await successful(directory, ['replay', 'load', '-', '--state', 'restored.json', '--json'], replay));
    assert.deepEqual(loaded, clicked);
    const before = await readFile(join(directory, '.stillplay-state.json'), 'utf8');
    const invalid = await run(directory, ['minesweeper', 'click', '100', '0', '--json']);
    assert.equal(invalid.status, 1); assert.match(invalid.stderr, /outside the board/);
    assert.equal(await readFile(join(directory, '.stillplay-state.json'), 'utf8'), before);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('FreeCell CLI deals, moves and undoes through persistent WASM state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stillplay-cli-'));
  try {
    const first = JSON.parse(await successful(directory, ['freecell', 'deal', '11982', '--json', '--state', 'cards.json']));
    assert.equal(first.deal, 11982); assert.equal(first.columns.length, 8);
    const moved = JSON.parse(await successful(directory, ['freecell', 'move', 'c0', 'f0', '--state', 'cards.json', '--json']));
    assert.equal(moved.freecells[0], first.columns[0].at(-1));
    const undone = JSON.parse(await successful(directory, ['freecell', 'undo', '--state', 'cards.json', '--json']));
    assert.deepEqual(undone.columns, first.columns); assert.deepEqual(undone.freecells, first.freecells);
    const hint = JSON.parse(await successful(directory, ['freecell', 'hint', '--state', 'cards.json', '--json']));
    assert.ok(hint === null || hint.from);
    const wrongGame = await run(directory, ['minesweeper', 'state', '--state', 'cards.json']);
    assert.equal(wrongGame.status, 1); assert.match(wrongGame.stderr, /saved game is freecell/);
    await writeFile(join(directory, 'invalid.json'), '{"version":99,"game":"freecell","actions":[]}');
    assert.equal((await run(directory, ['replay', 'load', 'invalid.json'])).status, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('replay envelope bounds and shared daily derivation reject malformed inputs', () => {
  assert.throws(() => parseReplay('not json'), /JSON/);
  assert.throws(() => parseReplay({ version: 2, game: 'minesweeper', actions: [] }), /version/);
  assert.throws(() => parseReplay({ version: 1, game: 'unknown', actions: [] }), /game/);
  assert.throws(() => parseReplay(' '.repeat(1024 * 1024 + 1)), /1 MiB/);
  assert.equal(dailySeed('2026-10-17'), dailySeed('2026-10-17'));
  assert.notEqual(dailySeed('2026-10-17'), dailySeed('2026-10-18'));
  assert.ok(dailyDeal('2026-10-17') >= 1 && dailyDeal('2026-10-17') <= 32000);
  assert.throws(() => dailySeed('2026-02-30'), /date/);
});
