/**
 * A simple Spider player built only on the public adapter API.
 *
 *   strategy 'greedy': always play the best-ranked hint that reaches a new
 *   position (deal when nothing else is left). No backtracking.
 *   strategy 'search': depth-first search over the same ranked hints, undoing
 *   dead ends, until it wins or spends `budget` actions.
 *
 * Neither is optimal; they exist to measure deals and test the core at scale.
 */
import { createSpider } from './spider-core.js';

const MAX_DEPTH = 3000; // stays inside the core's 4096-step undo history

export function playSpider(game, { strategy = 'greedy', budget = 20000 } = {}) {
  const visited = new Set([game.positionKey()]);
  const path = [];
  let actions = 0;

  const apply = option => (option.type === 'deal' ? game.deal() : game.move(option.from, option.to, option.count));

  if (strategy === 'greedy') {
    while (!game.isWon() && actions < budget) {
      let progressed = false;
      for (const option of game.hints()) {
        if (!apply(option)) throw new Error('A ranked hint was not a legal action');
        actions++;
        const key = game.positionKey();
        if (!visited.has(key)) { visited.add(key); path.push(option); progressed = true; break; }
        game.undo();
      }
      if (!progressed) break;
    }
    return { won: game.isWon(), actions, path };
  }

  const stack = [{ options: game.hints(), next: 0 }];
  while (stack.length && !game.isWon()) {
    const frame = stack[stack.length - 1];
    if (actions >= budget) break;
    if (frame.next >= frame.options.length || path.length >= MAX_DEPTH) {
      stack.pop();
      if (path.length) { game.undo(); path.pop(); }
      continue;
    }
    const option = frame.options[frame.next++];
    if (!apply(option)) throw new Error('A ranked hint was not a legal action');
    actions++;
    const key = game.positionKey();
    if (visited.has(key)) { game.undo(); continue; }
    visited.add(key);
    path.push(option);
    stack.push({ options: game.hints(), next: 0 });
  }
  return { won: game.isWon(), actions, path };
}

/** Plays a fresh deal without touching any game the caller holds. */
export async function solveSpider({ seed = 1, suits = 1, strategy = 'search', budget = 20000 } = {}) {
  const game = await createSpider({ seed, suits });
  return playSpider(game, { strategy, budget });
}
