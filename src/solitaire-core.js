/**
 * Browser and Node adapter for the original-authored Klondike WASM core.
 *
 * Locations are objects `{ type, index }` or short strings:
 *   t0..t6 tableau columns, w the waste, h0..h3 foundation slots, s the stock.
 * State lists cards bottom to top as suit-major ids (rank = id % 13 + 1).
 */
const KINDS = ['tableau', 'waste', 'foundation', 'stock'];
const SCORING = ['none', 'standard', 'vegas'];
const ACTIONS = ['move', 'draw', 'recycle', 'flip'];
const MANUAL_FLIP = 1;
const wasmURL = new URL('../cores/solitaire.wasm', import.meta.url);
let compiled;

async function wasmModule() {
  if (!compiled) {
    compiled = (async () => {
      let bytes;
      if (wasmURL.protocol === 'file:') {
        const { readFile } = await import('node:fs/promises');
        bytes = await readFile(wasmURL);
      } else {
        const response = await fetch(wasmURL);
        if (!response.ok) throw new Error(`Solitaire core failed to load (${response.status})`);
        bytes = await response.arrayBuffer();
      }
      return WebAssembly.compile(bytes);
    })().catch((error) => { compiled = undefined; throw error; });
  }
  return compiled;
}

function validSeed(seed) {
  if (!Number.isInteger(seed) || seed < 1 || seed > 2147483647) {
    throw new RangeError('Solitaire deal must be an integer from 1 to 2147483647');
  }
  return seed;
}

function validOptions({ draw = 1, scoring = 'standard', autoFlip = true } = {}) {
  if (draw !== 1 && draw !== 3) throw new RangeError('Solitaire draw must be 1 or 3');
  if (!SCORING.includes(scoring)) throw new RangeError('Solitaire scoring must be standard, vegas or none');
  if (typeof autoFlip !== 'boolean') throw new RangeError('autoFlip must be true or false');
  return { draw, scoring, autoFlip };
}

/** Parse 't3', 'w', 'h1', 's' or { type, index } into a checked location. */
export function parseLocation(value) {
  if (typeof value === 'string') {
    const match = /^(?:([th])([0-9])|(w)|(s))$/.exec(value);
    if (!match) return null;
    if (match[3]) value = { type: 'waste', index: 0 };
    else if (match[4]) value = { type: 'stock', index: 0 };
    else value = { type: match[1] === 't' ? 'tableau' : 'foundation', index: Number(match[2]) };
  }
  if (!value || typeof value !== 'object' || !KINDS.includes(value.type)) return null;
  const index = value.index ?? 0;
  const size = { tableau: 7, waste: 1, foundation: 4, stock: 1 }[value.type];
  if (!Number.isInteger(index) || index < 0 || index >= size) return null;
  return { type: value.type, index };
}

function copy(value) { return JSON.parse(JSON.stringify(value)); }

export async function createSolitaire({ seed = 1, ...options } = {}) {
  validSeed(seed);
  let config = validOptions(options);
  const instance = await WebAssembly.instantiate(await wasmModule(), {});
  const core = instance.exports;
  let actions = [];

  function start(nextSeed) {
    core.sol_new(nextSeed, config.draw, SCORING.indexOf(config.scoring), config.autoFlip ? 0 : MANUAL_FLIP);
    actions = [];
  }
  start(seed);

  function log(action) { actions.push(action); return true; }

  const api = {
    /** Deal again. Options left out keep their current values. */
    newGame(nextSeed = 1, nextOptions = {}) {
      validSeed(nextSeed);
      config = validOptions({ ...config, ...nextOptions });
      start(nextSeed);
      return api.state();
    },
    options() { return { ...config }; },
    state() {
      const tableau = Array.from({ length: 7 }, (_, column) =>
        Array.from({ length: core.sol_column_length(column) }, (_, index) => core.sol_column_card(column, index)));
      return {
        seed: core.sol_seed(),
        draw: core.sol_draw_count(),
        scoring: SCORING[core.sol_scoring()],
        autoFlip: !(core.sol_options() & MANUAL_FLIP),
        status: core.sol_status() ? 'won' : 'playing',
        moves: core.sol_moves(),
        score: core.sol_score(),
        pass: core.sol_pass(),
        maxPasses: core.sol_max_passes(),
        stock: Array.from({ length: core.sol_stock_length() }, (_, index) => core.sol_stock_card(index)),
        waste: Array.from({ length: core.sol_waste_length() }, (_, index) => core.sol_waste_card(index)),
        wasteFan: core.sol_waste_fan(),
        foundations: Array.from({ length: 4 }, (_, slot) => {
          const suit = core.sol_foundation_suit(slot);
          return { suit: suit < 0 ? null : suit, rank: core.sol_foundation_rank(slot) };
        }),
        tableau,
        hidden: Array.from({ length: 7 }, (_, column) => core.sol_column_hidden(column)),
        canDraw: Boolean(core.sol_can_draw()),
        canRecycle: Boolean(core.sol_can_recycle()),
        canAutoFinish: Boolean(core.sol_can_autofinish()),
      };
    },
    canMove(from, to, count = 1) {
      from = parseLocation(from);
      to = parseLocation(to);
      if (!from || !to || !Number.isInteger(count) || count < 1 || count > 52) return false;
      return Boolean(core.sol_can_move(KINDS.indexOf(from.type), from.index, KINDS.indexOf(to.type), to.index, count));
    },
    move(from, to, count = 1) {
      if (!api.canMove(from, to, count)) return false;
      from = parseLocation(from);
      to = parseLocation(to);
      core.sol_move(KINDS.indexOf(from.type), from.index, KINDS.indexOf(to.type), to.index, count);
      return log({ type: 'move', from, to, count });
    },
    draw() { return core.sol_draw() ? log({ type: 'draw' }) : false; },
    recycle() { return core.sol_recycle() ? log({ type: 'recycle' }) : false; },
    /** Click on the stock: draw if there are cards, otherwise turn the waste over. */
    stock() {
      if (api.draw()) return 'draw';
      if (api.recycle()) return 'recycle';
      return null;
    },
    flip(column) {
      if (!Number.isInteger(column) || !core.sol_flip(column)) return false;
      return log({ type: 'flip', column });
    },
    undo() { return core.sol_undo() ? log({ type: 'undo' }) : false; },
    /** A sensible legal next step: { action, from?, to?, count?, column? } or null. */
    hint() {
      if (!core.sol_hint()) return null;
      const action = ACTIONS[core.sol_hint_part(0)];
      if (action === 'draw' || action === 'recycle') return { action };
      if (action === 'flip') return { action, column: core.sol_hint_part(2) };
      return {
        action,
        from: { type: KINDS[core.sol_hint_part(1)], index: core.sol_hint_part(2) },
        to: { type: KINDS[core.sol_hint_part(3)], index: core.sol_hint_part(4) },
        count: core.sol_hint_part(5),
      };
    },
    /** Send one safe card to a foundation. */
    autoMove() { return core.sol_auto_move() ? log({ type: 'autoMove' }) : false; },
    /** One step of the automatic finish; returns 'move' | 'draw' | 'recycle' | null. */
    finishStep() {
      const step = core.sol_finish_step();
      if (!step) return null;
      log({ type: 'finish' });
      return ACTIONS[step - 1];
    },
    /** Score shown for a timed game after `seconds` (standard scoring adds the win bonus). */
    timedScore(seconds) { return core.sol_timed_score(Math.max(0, Math.floor(seconds))); },
    timeBonus(seconds) { return core.sol_time_bonus(Math.max(0, Math.floor(seconds))); },
    replay() {
      return { version: 1, game: 'solitaire', seed: core.sol_seed(), ...config, actions: copy(actions) };
    },
  };
  api.getState = api.state;
  api.exportReplay = api.replay;
  return api;
}

export async function loadSolitaireReplay(input) {
  const replay = typeof input === 'string' ? JSON.parse(input) : input;
  if (!replay || replay.version !== 1 || replay.game !== 'solitaire' || !Array.isArray(replay.actions)) {
    throw new TypeError('Unsupported Solitaire replay');
  }
  validSeed(replay.seed);
  const options = validOptions({ draw: replay.draw, scoring: replay.scoring, autoFlip: replay.autoFlip });
  if (replay.actions.length > 100000) throw new RangeError('Replay exceeds 100000 actions');
  const game = await createSolitaire({ seed: replay.seed, ...options });
  for (let index = 0; index < replay.actions.length; index++) {
    const action = replay.actions[index];
    let applied = false;
    if (action && action.type === 'move') applied = game.move(action.from, action.to, action.count ?? 1);
    else if (action && action.type === 'draw') applied = game.draw();
    else if (action && action.type === 'recycle') applied = game.recycle();
    else if (action && action.type === 'flip') applied = game.flip(action.column);
    else if (action && action.type === 'undo') applied = game.undo();
    else if (action && action.type === 'autoMove') applied = game.autoMove();
    else if (action && action.type === 'finish') applied = game.finishStep() !== null;
    if (!applied) throw new Error(`Invalid Solitaire replay action at index ${index}`);
  }
  return game;
}
