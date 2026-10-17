/** Browser and Node adapter for the exact same original-authored WASM core. */
const kinds = ['column', 'freecell', 'foundation'];
const wasmURL = new URL('../cores/freecell.wasm', import.meta.url);
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
        if (!response.ok) throw new Error(`FreeCell core failed to load (${response.status})`);
        bytes = await response.arrayBuffer();
      }
      return WebAssembly.compile(bytes);
    })().catch(error => { compiled = undefined; throw error; });
  }
  return compiled;
}

function validDeal(deal) {
  if (!Number.isInteger(deal) || deal < 1 || deal > 2147483647) {
    throw new RangeError('FreeCell deal must be an integer from 1 to 2147483647');
  }
  return deal;
}

function location(value) {
  if (typeof value === 'string' && /^[cfh][0-7]$/.test(value)) {
    value = { type: { c: 'column', f: 'freecell', h: 'foundation' }[value[0]], index: Number(value[1]) };
  }
  if (!value || !kinds.includes(value.type) || !Number.isInteger(value.index) ||
      value.index < 0 || value.index >= (value.type === 'column' ? 8 : 4)) return null;
  return { type: value.type, index: value.index };
}

function copy(value) { return JSON.parse(JSON.stringify(value)); }

export async function createFreecell({ deal = 1 } = {}) {
  validDeal(deal);
  const instance = await WebAssembly.instantiate(await wasmModule(), {});
  const core = instance.exports;
  let actions = [];
  core.fc_new(deal);

  const api = {
    newGame(nextDeal = 1) {
      validDeal(nextDeal);
      core.fc_new(nextDeal);
      actions = [];
      return api.state();
    },
    state() {
      return {
        deal: core.fc_deal(),
        status: core.fc_status() ? 'won' : 'playing',
        columns: Array.from({ length: 8 }, (_, col) =>
          Array.from({ length: core.fc_column_length(col) }, (_, index) => core.fc_column_card(col, index))),
        freecells: Array.from({ length: 4 }, (_, index) => {
          const card = core.fc_freecell(index);
          return card < 0 ? null : card;
        }),
        foundations: Array.from({ length: 4 }, (_, index) => core.fc_foundation(index)),
        moves: core.fc_moves(),
      };
    },
    move(from, to, count = 1) {
      from = location(from);
      to = location(to);
      if (!from || !to || !Number.isInteger(count) || count < 1 || count > 52) return false;
      if (!core.fc_move(kinds.indexOf(from.type), from.index, kinds.indexOf(to.type), to.index, count)) return false;
      actions.push({ type: 'move', from, to, count });
      return true;
    },
    undo() {
      if (!core.fc_undo()) return false;
      actions.push({ type: 'undo' });
      return true;
    },
    hint() {
      if (!core.fc_hint(0)) return null;
      return {
        from: { type: kinds[core.fc_hint_part(0)], index: core.fc_hint_part(1) },
        to: { type: kinds[core.fc_hint_part(2)], index: core.fc_hint_part(3) },
        count: core.fc_hint_part(4),
      };
    },
    autoMove() {
      if (!core.fc_auto_move()) return false;
      actions.push({ type: 'autoMove' });
      return true;
    },
    replay() { return { version: 1, game: 'freecell', deal: core.fc_deal(), actions: copy(actions) }; },
  };
  api.getState = api.state;
  api.exportReplay = api.replay;
  return api;
}

export async function loadFreecellReplay(input) {
  const replay = typeof input === 'string' ? JSON.parse(input) : input;
  if (!replay || replay.version !== 1 || replay.game !== 'freecell' || !Array.isArray(replay.actions)) {
    throw new TypeError('Unsupported FreeCell replay');
  }
  validDeal(replay.deal);
  if (replay.actions.length > 100000) throw new RangeError('Replay exceeds 100000 actions');
  const game = await createFreecell({ deal: replay.deal });
  for (let index = 0; index < replay.actions.length; index++) {
    const action = replay.actions[index];
    let applied = false;
    if (action && action.type === 'move') applied = game.move(action.from, action.to, action.count ?? 1);
    else if (action && action.type === 'undo') applied = game.undo();
    else if (action && action.type === 'autoMove') applied = game.autoMove();
    if (!applied) throw new Error(`Invalid FreeCell replay action at index ${index}`);
  }
  return game;
}
