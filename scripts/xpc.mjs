#!/usr/bin/env node
import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadReplay, formatReplay } from '../src/shared.js';

const HELP = `Stillplay headless CLI — the browser's WebAssembly cores, in Node.

  xpc minesweeper new --level beginner|intermediate|expert --seed N [--json]
  xpc minesweeper click|flag|chord X Y [--json]
  xpc minesweeper state [--json]
  xpc freecell deal N [--json]
  xpc freecell move FROM TO [COUNT] [--json]
  xpc freecell undo|hint|auto|state [--json]
  xpc solitaire new [--seed N] [--draw 1|3] [--scoring standard|vegas|none] [--manual-flip] [--json]
  xpc solitaire move FROM TO [COUNT] [--json]
  xpc solitaire draw|undo|hint|auto|finish|state [--json]
  xpc solitaire flip COLUMN [--json]
  xpc replay export [FILE]
  xpc replay load FILE|- [--json]

Coordinates and card locations are zero-based. FreeCell locations: c0..c7
(columns), f0..f3 (free cells), h0..h3 (foundations). Solitaire locations: t0..t6
(tableau), w (waste), h0..h3 (foundations); draw turns the stock, or turns the
waste back over when the stock is empty. Use --state FILE on any
command; the default is .stillplay-state.json in the current directory.
A replay contains seeds and actions, not executable code. Nothing is uploaded.
`;

function parseArgs(args) {
  const positional = [], options = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--json' || arg === '--help' || arg === '-h' || arg === '--manual-flip') options[arg === '-h' ? 'help' : arg.slice(2)] = true;
    else if (['--level', '--seed', '--state', '--count', '--draw', '--scoring'].includes(arg)) {
      if (args[index + 1] === undefined || args[index + 1].startsWith('--')) throw new Error(`${arg} requires a value.`);
      options[arg.slice(2)] = args[++index];
    } else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    else positional.push(arg);
  }
  return { positional, options };
}
function integer(value, label, min = 0, max = 0xffffffff) {
  if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  return Number(value);
}
async function save(file, game) {
  const data = formatReplay(game.replay());
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  try { await writeFile(temporary, data, { mode: 0o600 }); await rename(temporary, file); }
  finally { await unlink(temporary).catch(() => {}); }
}
async function restore(file, expected) {
  let data;
  try { data = await readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') throw new Error('No saved game. Start with minesweeper new or freecell deal.'); throw error; }
  const game = await loadReplay(data);
  if (expected && game.replay().game !== expected) throw new Error(`The saved game is ${game.replay().game}; choose a different --state file or start a new ${expected} game.`);
  return game;
}
function formatState(state, kind) {
  if (kind === 'minesweeper') {
    const rows = [];
    for (let y = 0; y < state.height; y++) rows.push(state.cells.slice(y * state.width, (y + 1) * state.width).map((cell) => cell.flagged ? 'F' : !cell.revealed ? '#' : cell.mine ? '*' : cell.adjacent || '.').join(' '));
    return `Minesweeper ${state.level} · seed ${state.seed} · ${state.status}\n${rows.join('\n')}\n${state.flags} flags · ${state.revealed} revealed`;
  }
  if (kind === 'solitaire') return formatSolitaire(state);
  const card = (id) => id == null ? '--' : `${['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'][id % 13]}${['C', 'D', 'H', 'S'][Math.floor(id / 13)]}`;
  return `FreeCell deal ${state.deal} · ${state.status}\nFree cells: ${state.freecells.map(card).join(' ')}\nFoundation ranks: ${state.foundations.join(' ')}\n${state.columns.map((column, index) => `c${index}: ${column.map(card).join(' ')}`).join('\n')}\n${state.moves} moves`;
}
function formatSolitaire(state) {
  const card = (id) => `${['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'][id % 13]}${['C', 'D', 'H', 'S'][Math.floor(id / 13)]}`;
  const score = state.scoring === 'vegas' ? `$${state.score}` : state.scoring === 'none' ? 'not scored' : `${state.score} points`;
  const foundations = state.foundations.map((slot) => slot.rank ? card(slot.suit * 13 + slot.rank - 1) : '--').join(' ');
  const waste = state.waste.slice(-Math.max(1, state.wasteFan)).map(card).join(' ') || '--';
  const passes = state.maxPasses ? `pass ${state.pass} of ${state.maxPasses}` : `pass ${state.pass}`;
  const columns = state.tableau.map((column, index) => `t${index}: ${column.map((id, row) => row < state.hidden[index] ? '##' : card(id)).join(' ')}`);
  return `Solitaire deal ${state.seed} · draw ${state.draw} · ${state.status}\nStock: ${state.stock.length} cards · ${passes} · Waste: ${waste}\nFoundations: ${foundations}\n${columns.join('\n')}\n${state.moves} moves · ${score}${state.canAutoFinish ? ' · ready to finish' : ''}`;
}

export async function runCLI(argv = process.argv.slice(2), context = {}) {
  const stdout = context.stdout || process.stdout;
  const stdin = context.stdin || process.stdin;
  const cwd = context.cwd || process.cwd();
  const env = context.env || process.env;
  const filePath = (value) => resolve(cwd, value);
  const { positional: args, options } = parseArgs(argv);
  if (options.help || !args.length) { stdout.write(HELP); return; }
  const [kind, command, ...params] = args;
  const stateFile = filePath(options.state || env.XPC_STATE || '.stillplay-state.json');
  let game, result, mutated = false;
  if (kind === 'minesweeper') {
    if (command === 'new') {
      if (params.length) throw new Error('Unexpected arguments to minesweeper new.');
      const { createMinesweeper } = await import('../src/minesweeper-core.js');
      game = await createMinesweeper({ level: options.level || 'beginner', seed: integer(options.seed ?? '1', 'Seed') });
      mutated = true;
    } else {
      game = await restore(stateFile, kind);
      if (['click', 'flag', 'chord'].includes(command)) {
        if (params.length !== 2) throw new Error(`${command} requires X and Y coordinates.`);
        const x = integer(params[0], 'X coordinate'), y = integer(params[1], 'Y coordinate');
        const state = game.state();
        if (x >= state.width || y >= state.height) throw new Error('Coordinates are outside the board.');
        const before = JSON.stringify(game.replay());
        game[command === 'click' ? 'reveal' : command](x, y);
        mutated = JSON.stringify(game.replay()) !== before;
      } else if (command !== 'state' || params.length) throw new Error('Unknown Minesweeper command. Use --help for commands.');
    }
  } else if (kind === 'freecell') {
    if (command === 'deal') {
      if (params.length !== 1) throw new Error('freecell deal requires one deal number.');
      const { createFreecell } = await import('../src/freecell-core.js');
      game = await createFreecell({ deal: integer(params[0], 'Deal', 1, 2147483647) });
      mutated = true;
    } else {
      game = await restore(stateFile, kind);
      if (command === 'move') {
        if (params.length < 2 || params.length > 3) throw new Error('freecell move requires FROM TO and optional COUNT.');
        const count = integer(options.count ?? params[2] ?? '1', 'Card count', 1, 52);
        if (!game.move(params[0], params[1], count)) throw new Error('That move is not legal.');
        mutated = true;
      } else if (command === 'undo' || command === 'auto') {
        if (params.length) throw new Error(`freecell ${command} accepts no positional arguments.`);
        if (!game[command === 'auto' ? 'autoMove' : command]()) throw new Error(command === 'undo' ? 'There is no move to undo.' : 'No automatic foundation move is available.');
        mutated = true;
      } else if (command === 'hint') {
        if (params.length) throw new Error('freecell hint accepts no positional arguments.');
        result = game.hint();
      } else if (command !== 'state' || params.length) throw new Error('Unknown FreeCell command. Use --help for commands.');
    }
  } else if (kind === 'solitaire') {
    if (command === 'new') {
      if (params.length) throw new Error('solitaire new takes options only, for example --seed 7 --draw 3.');
      const { createSolitaire } = await import('../src/solitaire-core.js');
      const draw = integer(options.draw ?? '1', 'Draw', 1, 3);
      if (draw === 2) throw new Error('Draw must be 1 or 3.');
      const scoring = options.scoring || 'standard';
      if (!['standard', 'vegas', 'none'].includes(scoring)) throw new Error('Scoring must be standard, vegas or none.');
      game = await createSolitaire({ seed: integer(options.seed ?? '1', 'Seed', 1, 2147483647), draw, scoring, autoFlip: !options['manual-flip'] });
      mutated = true;
    } else {
      game = await restore(stateFile, kind);
      if (command === 'move') {
        if (params.length < 2 || params.length > 3) throw new Error('solitaire move requires FROM TO and optional COUNT.');
        const count = integer(options.count ?? params[2] ?? '1', 'Card count', 1, 52);
        if (!game.move(params[0], params[1], count)) throw new Error('That move is not legal.');
        mutated = true;
      } else if (command === 'flip') {
        if (params.length !== 1) throw new Error('solitaire flip requires one column number.');
        if (!game.flip(integer(params[0], 'Column', 0, 6))) throw new Error('That column has no face-down card to turn over.');
        mutated = true;
      } else if (['draw', 'undo', 'auto', 'finish'].includes(command)) {
        if (params.length) throw new Error(`solitaire ${command} accepts no positional arguments.`);
        const ok = command === 'draw' ? game.stock() : command === 'undo' ? game.undo() : command === 'auto' ? game.autoMove() : game.finishStep();
        if (!ok) throw new Error({ draw: 'The stock and waste are both finished for this game.', undo: 'There is no move to undo.', auto: 'No safe foundation move is available.', finish: 'The game cannot finish itself yet.' }[command]);
        mutated = true;
      } else if (command === 'hint') {
        if (params.length) throw new Error('solitaire hint accepts no positional arguments.');
        result = game.hint();
      } else if (command !== 'state' || params.length) throw new Error('Unknown Solitaire command. Use --help for commands.');
    }
  } else if (kind === 'replay') {
    if (command === 'export') {
      if (params.length > 1) throw new Error('replay export accepts at most one output file.');
      game = await restore(stateFile);
      const replay = formatReplay(game.replay());
      if (params[0]) { await writeFile(filePath(params[0]), replay, { mode: 0o600 }); stdout.write(options.json ? `${JSON.stringify({ exported: filePath(params[0]) })}\n` : `Exported ${filePath(params[0])}\n`); }
      else stdout.write(replay);
      return;
    }
    if (command !== 'load' || params.length !== 1) throw new Error('Use replay load FILE|- or replay export [FILE].');
    let replayText;
    if (params[0] === '-') {
      const chunks = []; let length = 0;
      for await (const chunk of stdin) { length += chunk.length; if (length > 1024 * 1024) throw new Error('Replay exceeds the 1 MiB limit.'); chunks.push(chunk); }
      replayText = Buffer.concat(chunks).toString('utf8');
    } else replayText = await readFile(filePath(params[0]), 'utf8');
    game = await loadReplay(replayText);
    mutated = true;
  } else throw new Error(`Unknown game or command: ${kind}. Use --help for commands.`);
  if (mutated) await save(stateFile, game);
  const output = command === 'hint' ? result : game.state();
  stdout.write(options.json ? `${JSON.stringify(output)}\n` : command === 'hint' ? `${output ? JSON.stringify(output) : 'No legal move found.'}\n` : `${formatState(output, game.replay().game)}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCLI().catch((error) => { process.stderr.write(`xpc: ${error.message}\n`); process.exitCode = 1; });
}
