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
  xpc spider new [--suits 1|2|4] [--seed N] [--json]
  xpc spider move FROM TO [COUNT] [--json]
  xpc spider deal|undo|hint|state [--json]
  xpc spider play [--budget N] [--json]
  xpc hearts new [--seed N] [--difficulty 0|1] [--json]
  xpc hearts pass CARD CARD CARD [--json]
  xpc hearts play CARD [--json]
  xpc hearts next|hint|state [--json]
  xpc replay export [FILE]
  xpc replay load FILE|- [--json]

Coordinates and card locations are zero-based. FreeCell locations: c0..c7
(columns), f0..f3 (free cells), h0..h3 (foundations). Solitaire locations: t0..t6
(tableau), w (waste), h0..h3 (foundations); draw turns the stock, or turns the
waste back over when the stock is empty. Spider columns: c0..c9;
COUNT defaults to the longest run that fits; spider play lets the simple
built-in player continue. Hearts cards: QS, 10H (or TH), 2C, AD; you are
seat 0 and the computer seats play by themselves. Use --state FILE on any
command; the default is .stillplay-state.json in the current directory.
A replay contains seeds and actions, not executable code. Nothing is uploaded.
`;

function parseArgs(args) {
  const positional = [], options = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--json' || arg === '--help' || arg === '-h' || arg === '--manual-flip') options[arg === '-h' ? 'help' : arg.slice(2)] = true;
    else if (['--level', '--seed', '--state', '--count', '--draw', '--scoring', '--suits', '--difficulty', '--budget'].includes(arg)) {
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
  catch (error) { if (error.code === 'ENOENT') throw new Error('No saved game. Start with minesweeper new, freecell deal, spider new or hearts new.'); throw error; }
  const game = await loadReplay(data);
  if (expected && game.replay().game !== expected) throw new Error(`The saved game is ${game.replay().game}; choose a different --state file or start a new ${expected} game.`);
  return game;
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
function formatState(state, kind) {
  if (kind === 'minesweeper') {
    const rows = [];
    for (let y = 0; y < state.height; y++) rows.push(state.cells.slice(y * state.width, (y + 1) * state.width).map((cell) => cell.flagged ? 'F' : !cell.revealed ? '#' : cell.mine ? '*' : cell.adjacent || '.').join(' '));
    return `Minesweeper ${state.level} · seed ${state.seed} · ${state.status}\n${rows.join('\n')}\n${state.flags} flags · ${state.revealed} revealed`;
  }
  if (kind === 'solitaire') return formatSolitaire(state);
  const card = (id) => id == null ? '--' : `${['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'][id % 13]}${['C', 'D', 'H', 'S'][Math.floor(id / 13)]}`;
  if (kind === 'spider') {
    const columns = state.columns.map((column, index) => `c${index}: ${column.map((item) => item.faceUp ? card(item.card) : '##').join(' ')}`);
    return `Spider ${state.suits} suit${state.suits > 1 ? 's' : ''} · seed ${state.seed} · ${state.status} · score ${state.score} · ${state.moves} moves\nStock: ${state.dealsLeft} deal${state.dealsLeft === 1 ? '' : 's'} left · completed runs: ${state.completed.length}\n${columns.join('\n')}${state.status === 'playing' && !state.hasMoves ? '\nNo useful moves left.' : ''}`;
  }
  if (kind === 'hearts') {
    const seats = ['You', 'West', 'North', 'East'];
    const plays = (list) => list.map((play) => `${seats[play.seat]} ${card(play.card)}`).join(' · ') || '—';
    const lines = [`Hearts · seed ${state.seed} · hand ${state.handNumber + 1} · pass ${state.passDirection} · ${state.phase}`,
      `Scores: ${state.scores.map((score, seat) => `${seats[seat]} ${score}`).join(' · ')}`,
      `This hand: ${state.handPoints.map((points, seat) => `${seats[seat]} ${points}`).join(' · ')}${state.heartsBroken ? ' · hearts broken' : ''}`];
    if (state.tricks.length) lines.push(`Last trick: ${plays(state.tricks.at(-1).plays)} → ${seats[state.tricks.at(-1).winner]}`);
    if (state.phase === 'play') lines.push(`Trick: ${plays(state.trick)}`);
    lines.push(`Your cards: ${state.cards.map(card).join(' ') || '—'}`);
    if (state.received.length) lines.push(`Received: ${state.received.map(card).join(' ')}`);
    if (state.legal.length) lines.push(`You can play: ${state.legal.map(card).join(' ')}`);
    if (state.phase === 'pass') lines.push(`Choose three cards to pass ${state.passDirection}.`);
    if (state.phase === 'handOver') lines.push(`Hand over${state.lastHand.moon !== null ? ` · ${seats[state.lastHand.moon]} shot the moon` : ''}. Run hearts next.`);
    if (state.phase === 'gameOver') lines.push(`Game over. Winner: ${state.winners.map((seat) => seats[seat]).join(', ')}.`);
    return lines.join('\n');
  }
  return `FreeCell deal ${state.deal} · ${state.status}\nFree cells: ${state.freecells.map(card).join(' ')}\nFoundation ranks: ${state.foundations.join(' ')}\n${state.columns.map((column, index) => `c${index}: ${column.map(card).join(' ')}`).join('\n')}\n${state.moves} moves`;
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
  } else if (kind === 'spider') {
    if (command === 'new') {
      if (params.length) throw new Error('Unexpected arguments to spider new.');
      const { createSpider } = await import('../src/spider-core.js');
      const suits = integer(options.suits ?? '1', 'Suits', 1, 4);
      if (![1, 2, 4].includes(suits)) throw new Error('Suits must be 1, 2 or 4.');
      game = await createSpider({ suits, seed: integer(options.seed ?? '1', 'Seed') });
      mutated = true;
    } else {
      game = await restore(stateFile, kind);
      if (command === 'move') {
        if (params.length < 2 || params.length > 3) throw new Error('spider move requires FROM TO and optional COUNT.');
        const [from, to] = params.map((value) => {
          if (!/^c?\d$/.test(value)) throw new Error('Spider columns are c0 to c9.');
          return Number(value.replace('c', ''));
        });
        const countText = options.count ?? params[2];
        const count = countText === undefined ? undefined : integer(countText, 'Card count', 1, 13);
        if (!game.move(from, to, count)) throw new Error('That move is not legal.');
        mutated = true;
      } else if (command === 'deal' || command === 'undo') {
        if (params.length) throw new Error(`spider ${command} accepts no positional arguments.`);
        if (!game[command]()) throw new Error(command === 'undo' ? 'There is no move to undo.' : 'You can deal only while every column has a card and the stock is not empty.');
        mutated = true;
      } else if (command === 'hint') {
        if (params.length) throw new Error('spider hint accepts no positional arguments.');
        result = game.hints()[0] ?? null;
      } else if (command === 'play') {
        if (params.length) throw new Error('spider play accepts no positional arguments.');
        const { playSpider } = await import('../src/spider-solver.js');
        playSpider(game, { strategy: 'greedy', budget: integer(options.budget ?? '20000', 'Budget', 1, 90000) });
        mutated = true;
      } else if (command !== 'state' || params.length) throw new Error('Unknown Spider command. Use --help for commands.');
    }
  } else if (kind === 'hearts') {
    const parseCard = (value) => {
      const match = /^(10|[2-9TJQKA])([CDHS])$/i.exec(value);
      if (!match) throw new Error(`Unknown card ${value}. Use forms like QS, 10H, TH or 2C.`);
      const rank = match[1].toUpperCase() === 'T' ? 9 : ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].indexOf(match[1].toUpperCase());
      return 'CDHS'.indexOf(match[2].toUpperCase()) * 13 + rank;
    };
    if (command === 'new') {
      if (params.length) throw new Error('Unexpected arguments to hearts new.');
      const { createHearts } = await import('../src/hearts-core.js');
      game = await createHearts({ seed: integer(options.seed ?? '1', 'Seed'), difficulty: integer(options.difficulty ?? '1', 'Difficulty', 0, 1) });
      mutated = true;
    } else {
      game = await restore(stateFile, kind);
      if (command === 'pass') {
        if (params.length !== 3) throw new Error('hearts pass requires three cards.');
        if (!game.pass(params.map(parseCard))) throw new Error('You can pass three different cards from your hand during the passing phase.');
        mutated = true;
      } else if (command === 'play') {
        if (params.length !== 1) throw new Error('hearts play requires one card.');
        if (!game.play(parseCard(params[0]))) throw new Error('That card cannot be played now.');
        mutated = true;
      } else if (command === 'next') {
        if (params.length) throw new Error('hearts next accepts no positional arguments.');
        if (!game.nextHand()) throw new Error('The next hand starts only after a hand is over.');
        mutated = true;
      } else if (command === 'hint') {
        if (params.length) throw new Error('hearts hint accepts no positional arguments.');
        result = game.hint();
      } else if (command !== 'state' || params.length) throw new Error('Unknown Hearts command. Use --help for commands.');
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
