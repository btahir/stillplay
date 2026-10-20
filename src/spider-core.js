/**
 * Browser and Node adapter for our Spider Solitaire WASM core.
 *
 * Columns are numbered 0–9 (the CLI also accepts c0–c9). Cards in state are
 * objects { uid, card, faceUp }: `uid` 0–103 is stable for the physical card
 * (use it as a DOM key), `card` is the shared face id 0–51 from src/cards.js,
 * or null while the card is face down (pass { reveal: true } to see it).
 * See docs/spider-core.md.
 */
const wasmURL = new URL('../cores/spider.wasm', import.meta.url);
const SUITS = [1, 2, 4];
const MAX_ACTIONS = 100000;
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
        if (!response.ok) throw new Error(`Spider core failed to load (${response.status})`);
        bytes = await response.arrayBuffer();
      }
      return WebAssembly.compile(bytes);
    })().catch(error => { compiled = undefined; throw error; });
  }
  return compiled;
}

function validOptions(seed, suits) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError('Spider seed must be an unsigned 32-bit integer');
  }
  if (!SUITS.includes(suits)) throw new RangeError('Spider suits must be 1, 2 or 4');
}

/** Accepts 0–9, '0'–'9' or 'c0'–'c9'. Returns null for anything else. */
function column(value) {
  if (typeof value === 'string' && /^c?\d$/.test(value)) value = Number(value.replace('c', ''));
  return Number.isInteger(value) && value >= 0 && value < 10 ? value : null;
}

function copy(value) { return JSON.parse(JSON.stringify(value)); }

export async function createSpider({ seed = 1, suits = 1 } = {}) {
  validOptions(seed, suits);
  const instance = await WebAssembly.instantiate(await wasmModule(), {});
  const core = instance.exports;
  let actions = [];
  let hintCursor = 0;
  let hintMoves = -1;
  core.sp_new(seed >>> 0, suits);

  function hintAt(index) {
    const from = core.sp_hint_part(index, 0);
    if (from === -1) return { type: 'deal' };
    return { type: 'move', from, to: core.sp_hint_part(index, 1), count: core.sp_hint_part(index, 2) };
  }

  /** Longest legal count for from → to, or 0. Used when a caller omits count. */
  function fittingCount(from, to) {
    for (let count = core.sp_run_length(from); count > 0; count--) {
      if (core.sp_can_move(from, to, count)) return count;
    }
    return 0;
  }

  const api = {
    newGame(options = {}) {
      const nextSeed = options.seed ?? 1;
      const nextSuits = options.suits ?? core.sp_suits();
      validOptions(nextSeed, nextSuits);
      core.sp_new(nextSeed >>> 0, nextSuits);
      actions = [];
      hintMoves = -1;
      return api.state();
    },

    state({ reveal = false } = {}) {
      const columns = Array.from({ length: 10 }, (_, col) => {
        const down = core.sp_column_down(col);
        return Array.from({ length: core.sp_column_length(col) }, (_, index) => {
          const uid = core.sp_column_card(col, index);
          const faceUp = index >= down;
          return { uid, card: faceUp || reveal ? core.sp_card_face(uid) : null, faceUp };
        });
      });
      const stock = core.sp_stock();
      const state = {
        seed: core.sp_seed() >>> 0,
        suits: core.sp_suits(),
        status: core.sp_status() ? 'won' : 'playing',
        score: core.sp_score(),
        moves: core.sp_moves(),
        columns,
        stock,
        dealsLeft: stock / 10,
        completed: Array.from({ length: core.sp_completed() }, (_, index) => core.sp_completed_suit(index)),
        canDeal: core.sp_can_deal() === 1,
        canUndo: core.sp_can_undo() === 1,
        hasMoves: core.sp_has_moves() === 1,
      };
      if (reveal) {
        state.stockCards = Array.from({ length: stock }, (_, index) => {
          const uid = core.sp_stock_card(index);
          return { uid, card: core.sp_card_face(uid), faceUp: false };
        });
      }
      return state;
    },

    /** Cards that can be picked up from the top of a column (a same-suit run). */
    movableCount(col) {
      col = column(col);
      return col === null ? 0 : core.sp_run_length(col);
    },

    canMove(from, to, count) {
      from = column(from); to = column(to);
      if (from === null || to === null) return false;
      if (count === undefined) return fittingCount(from, to) > 0;
      return Number.isInteger(count) && core.sp_can_move(from, to, count) === 1;
    },

    /** Moves `count` cards; without count, the longest run that fits. */
    move(from, to, count) {
      from = column(from); to = column(to);
      if (from === null || to === null) return false;
      if (count === undefined) count = fittingCount(from, to);
      if (!Number.isInteger(count) || count < 1 || !core.sp_move(from, to, count)) return false;
      actions.push({ type: 'move', from, to, count });
      return true;
    },

    canDeal() { return core.sp_can_deal() === 1; },

    deal() {
      if (!core.sp_deal()) return false;
      actions.push({ type: 'deal' });
      return true;
    },

    canUndo() { return core.sp_can_undo() === 1; },

    undo() {
      if (!core.sp_undo()) return false;
      actions.push({ type: 'undo' });
      return true;
    },

    /** What the last successful action changed, for animation and sound. */
    lastChange() {
      const bits = mask => Array.from({ length: 10 }, (_, col) => col).filter(col => mask & (1 << col));
      return { flipped: bits(core.sp_last_flips()), completed: bits(core.sp_last_completed()) };
    },

    /** All useful moves, best first. A deal (when allowed) is always last. */
    hints() {
      const count = core.sp_hints();
      return Array.from({ length: count }, (_, index) => hintAt(index));
    },

    /** The classic hint: each call shows the next suggestion, wrapping round. */
    hint() {
      const count = core.sp_hints();
      if (!count) return null;
      if (hintMoves !== core.sp_moves()) { hintMoves = core.sp_moves(); hintCursor = 0; }
      const hint = hintAt(hintCursor % count);
      hintCursor = (hintCursor + 1) % count;
      return hint;
    },

    /** False when no useful move and no deal remain. */
    hasMoves() { return core.sp_has_moves() === 1; },

    /** Position key for loop detection (faces and layout, not score). */
    positionKey() { return (core.sp_hash(0) >>> 0) * 2097152 + (core.sp_hash(0x9e3779b9) & 0x1fffff); },

    isWon() { return core.sp_status() === 1; },

    replay() {
      return { version: 1, game: 'spider', seed: core.sp_seed() >>> 0, suits: core.sp_suits(), actions: copy(actions) };
    },
  };
  api.getState = api.state;
  api.exportReplay = api.replay;
  return api;
}

export async function loadSpiderReplay(input) {
  const replay = typeof input === 'string' ? JSON.parse(input) : input;
  if (!replay || replay.version !== 1 || replay.game !== 'spider' || !Array.isArray(replay.actions)) {
    throw new TypeError('Unsupported Spider replay');
  }
  validOptions(replay.seed, replay.suits);
  if (replay.actions.length > MAX_ACTIONS) throw new RangeError(`Replay exceeds ${MAX_ACTIONS} actions`);
  const game = await createSpider({ seed: replay.seed, suits: replay.suits });
  replay.actions.forEach((action, index) => {
    let applied = false;
    if (action && action.type === 'move') {
      applied = Number.isInteger(action.count) && game.move(action.from, action.to, action.count);
    } else if (action && action.type === 'deal') applied = game.deal();
    else if (action && action.type === 'undo') applied = game.undo();
    if (!applied) throw new Error(`Invalid Spider replay action at index ${index}`);
  });
  return game;
}
