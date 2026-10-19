/** Versioned replay interchange shared by the browser and headless CLI. */
export const REPLAY_VERSION = 1;
export const MAX_REPLAY_BYTES = 1024 * 1024;
export const REPLAY_GAMES = ['minesweeper', 'freecell', 'spider', 'hearts'];

export function parseReplay(input) {
  let replay = input;
  if (typeof input === 'string') {
    if (new TextEncoder().encode(input).byteLength > MAX_REPLAY_BYTES) throw new Error('Replay exceeds the 1 MiB limit.');
    try { replay = JSON.parse(input); } catch { throw new Error('Replay must be valid JSON.'); }
  }
  if (!replay || typeof replay !== 'object' || Array.isArray(replay) || replay.version !== REPLAY_VERSION) throw new Error('Unsupported replay version; expected version 1.');
  if (!REPLAY_GAMES.includes(replay.game)) throw new Error('Unsupported replay game.');
  if (!Array.isArray(replay.actions) || replay.actions.length > 100000) throw new Error('Replay must contain at most 100,000 actions.');
  if (new TextEncoder().encode(JSON.stringify(replay)).byteLength > MAX_REPLAY_BYTES) throw new Error('Replay exceeds the 1 MiB limit.');
  return replay;
}

/** Replays are always validated and played through the same WASM core as the UI. */
export async function loadReplay(input) {
  const replay = parseReplay(input);
  if (replay.game === 'minesweeper') {
    const { loadReplay: loadMinesweeperReplay } = await import('./minesweeper-core.js');
    return loadMinesweeperReplay(replay);
  }
  if (replay.game === 'spider') {
    const { loadSpiderReplay } = await import('./spider-core.js');
    return loadSpiderReplay(replay);
  }
  if (replay.game === 'hearts') {
    const { loadHeartsReplay } = await import('./hearts-core.js');
    return loadHeartsReplay(replay);
  }
  const { loadFreecellReplay } = await import('./freecell-core.js');
  return loadFreecellReplay(replay);
}

export function formatReplay(input) {
  return `${JSON.stringify(parseReplay(input), null, 2)}\n`;
}

/** One shared daily challenge globally, changing at 00:00 UTC. */
export function dailySeed(date = new Date().toISOString().slice(0, 10)) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('Daily date must be a valid YYYY-MM-DD date.');
  let hash = 2166136261;
  for (const character of `stillplay:${date}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return hash;
}

export function dailyDeal(date) { return dailySeed(date) % 32000 + 1; }
