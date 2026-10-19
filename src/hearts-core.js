/**
 * Browser and Node adapter for the original-authored Hearts WASM core.
 *
 * Seats: 0 is you (south), 1 west, 2 north, 3 east; play runs 0 → 1 → 2 → 3.
 * Cards are the shared ids 0–51 from src/cards.js (aces high in play).
 * The computer seats play automatically inside the core: after pass(), play()
 * or nextHand() returns, every computer card up to your next decision has
 * been played. Animate them from state().tricks / state().trick, in order.
 * See docs/hearts-core.md.
 */
const wasmURL = new URL('../cores/hearts.wasm', import.meta.url);
const KINDS = ['human', 'random', 'casual', 'standard'];
const PHASES = ['pass', 'play', 'handOver', 'gameOver'];
const DIRECTIONS = ['left', 'right', 'across', 'hold'];
const MAX_ACTIONS = 10000;
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
        if (!response.ok) throw new Error(`Hearts core failed to load (${response.status})`);
        bytes = await response.arrayBuffer();
      }
      return WebAssembly.compile(bytes);
    })().catch(error => { compiled = undefined; throw error; });
  }
  return compiled;
}

function defaultPlayers(difficulty) {
  const opponent = difficulty === 0 ? 'casual' : 'standard';
  return ['human', opponent, opponent, opponent];
}

function validOptions(seed, difficulty, players) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError('Hearts seed must be an unsigned 32-bit integer');
  }
  if (difficulty !== 0 && difficulty !== 1) throw new RangeError('Hearts difficulty must be 0 (casual) or 1 (standard)');
  if (!Array.isArray(players) || players.length !== 4 ||
      players.some((kind, seat) => !KINDS.includes(kind) || (seat > 0 && kind === 'human'))) {
    throw new RangeError('Hearts players must be four of human|random|casual|standard; only seat 0 may be human');
  }
}

const sortKey = card => Math.floor(card / 13) * 13 + (card % 13 + 12) % 13;
const byHand = (a, b) => sortKey(a) - sortKey(b);

export async function createHearts({ seed = 1, difficulty = 1, players } = {}) {
  players = players ? [...players] : defaultPlayers(difficulty);
  validOptions(seed, difficulty, players);
  const instance = await WebAssembly.instantiate(await wasmModule(), {});
  const core = instance.exports;
  let actions = [];

  function start(nextSeed, nextDifficulty, nextPlayers) {
    core.hz_new(nextSeed >>> 0, nextDifficulty);
    const defaults = defaultPlayers(nextDifficulty);
    if (nextPlayers.some((kind, seat) => kind !== defaults[seat])) {
      core.hz_configure(...nextPlayers.map(kind => KINDS.indexOf(kind)));
    }
    players = nextPlayers;
    actions = [];
  }

  const cardsWhere = predicate => Array.from({ length: 52 }, (_, card) => card).filter(predicate).sort(byHand);

  function tricks() {
    const result = [];
    const logged = core.hz_log_count();
    for (let start = 0; start < logged; start += 4) {
      const plays = [];
      for (let index = start; index < Math.min(start + 4, logged); index++) {
        plays.push({ seat: core.hz_log_seat(index), card: core.hz_log_card(index) });
      }
      const number = start / 4;
      const complete = plays.length === 4;
      result.push({
        leader: plays[0].seat,
        plays,
        winner: complete ? core.hz_trick_winner(number) : null,
        points: complete ? core.hz_trick_points(number) : null,
      });
    }
    return result;
  }

  start(seed, difficulty, players);

  const api = {
    newGame(options = {}) {
      const nextSeed = options.seed ?? 1;
      const nextDifficulty = options.difficulty ?? core.hz_difficulty();
      const nextPlayers = options.players ? [...options.players] : defaultPlayers(nextDifficulty);
      validOptions(nextSeed, nextDifficulty, nextPlayers);
      start(nextSeed, nextDifficulty, nextPlayers);
      return api.state();
    },

    state({ reveal = false } = {}) {
      const phase = PHASES[core.hz_phase()];
      const direction = DIRECTIONS[core.hz_pass_direction()];
      const turn = core.hz_turn();
      const all = tricks();
      const open = all.length && all.at(-1).winner === null ? all.pop() : null;
      const historyCount = core.hz_history_count();
      const scores = [0, 1, 2, 3].map(seat => core.hz_score(seat));
      const best = Math.min(...scores);
      const moon = core.hz_moon();
      const state = {
        seed: core.hz_seed() >>> 0,
        difficulty: core.hz_difficulty(),
        players: [...players],
        phase,
        handNumber: core.hz_hand_number(),
        passDirection: direction,
        passTo: direction === 'hold' ? null : [1, 3, 2][DIRECTIONS.indexOf(direction)],
        turn: turn < 0 ? null : turn,
        heartsBroken: core.hz_hearts_broken() === 1,
        tricksPlayed: core.hz_tricks_done(),
        cards: cardsWhere(card => core.hz_holds(0, card)),
        handSizes: [0, 1, 2, 3].map(seat => core.hz_hand_size(seat)),
        trick: open ? open.plays : [],
        tricks: all,
        legal: phase === 'play' && turn === 0 ? cardsWhere(card => core.hz_can_play(card)) : [],
        passed: cardsWhere(card => core.hz_passed(0, card)),
        received: cardsWhere(card => core.hz_received(0, card)),
        handPoints: [0, 1, 2, 3].map(seat => core.hz_hand_points(seat)),
        scores,
        history: Array.from({ length: historyCount }, (_, hand) => [0, 1, 2, 3].map(seat => core.hz_history(hand, seat))),
        lastHand: historyCount ? { points: [0, 1, 2, 3].map(seat => core.hz_last_points(seat)), moon: moon < 0 ? null : moon } : null,
        winners: phase === 'gameOver' ? [0, 1, 2, 3].filter(seat => scores[seat] === best) : [],
      };
      if (reveal) {
        state.hands = [0, 1, 2, 3].map(seat => cardsWhere(card => core.hz_holds(seat, card)));
        state.passedBy = [0, 1, 2, 3].map(seat => cardsWhere(card => core.hz_passed(seat, card)));
      }
      return state;
    },

    /** Pass three cards (pass phase only). */
    pass(cards) {
      if (!Array.isArray(cards) || cards.length !== 3 || !cards.every(Number.isInteger)) return false;
      if (!core.hz_pass(cards[0], cards[1], cards[2])) return false;
      actions.push({ type: 'pass', cards: [...cards] });
      return true;
    },

    canPlay(card) { return Number.isInteger(card) && core.hz_can_play(card) === 1; },

    play(card) {
      if (!Number.isInteger(card) || !core.hz_play(card)) return false;
      actions.push({ type: 'play', card });
      return true;
    },

    /** Deal the next hand after a hand is over (not after the game is over). */
    nextHand() {
      if (!core.hz_next_hand()) return false;
      actions.push({ type: 'nextHand' });
      return true;
    },

    /** The standard computer player's choice for you. Never changes the game. */
    hint() {
      const phase = PHASES[core.hz_phase()];
      if (phase === 'pass' && players[0] === 'human') {
        return { type: 'pass', cards: [0, 1, 2].map(index => core.hz_hint_pass(index)).sort(byHand) };
      }
      const card = core.hz_hint_play();
      return card < 0 || players[0] !== 'human' ? null : { type: 'play', card };
    },

    replay() {
      return {
        version: 1, game: 'hearts', seed: core.hz_seed() >>> 0, difficulty: core.hz_difficulty(),
        players: [...players], actions: JSON.parse(JSON.stringify(actions)),
      };
    },
  };
  api.getState = api.state;
  api.exportReplay = api.replay;
  return api;
}

export async function loadHeartsReplay(input) {
  const replay = typeof input === 'string' ? JSON.parse(input) : input;
  if (!replay || replay.version !== 1 || replay.game !== 'hearts' || !Array.isArray(replay.actions)) {
    throw new TypeError('Unsupported Hearts replay');
  }
  const players = replay.players ?? defaultPlayers(replay.difficulty);
  validOptions(replay.seed, replay.difficulty, players);
  if (replay.actions.length > MAX_ACTIONS) throw new RangeError(`Replay exceeds ${MAX_ACTIONS} actions`);
  const game = await createHearts({ seed: replay.seed, difficulty: replay.difficulty, players });
  replay.actions.forEach((action, index) => {
    let applied = false;
    if (action && action.type === 'pass') applied = game.pass(action.cards);
    else if (action && action.type === 'play') applied = game.play(action.card);
    else if (action && action.type === 'nextHand') applied = game.nextHand();
    if (!applied) throw new Error(`Invalid Hearts replay action at index ${index}`);
  });
  return game;
}
