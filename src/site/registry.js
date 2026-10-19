/**
 * The site's view of the collection: src/games.js plus site copy.
 * A game is playable exactly when its registry entry has a `mount` function, so the
 * shell needs no changes when another game becomes playable.
 */
import { games } from '../games.js';
import { copy, fallbackCopy } from './catalog.js';

function decorate(game, index) {
  const playable = typeof game.mount === 'function' && Boolean(game.path);
  return {
    ...fallbackCopy,
    ...copy[game.id],
    ...game,
    number: String(index + 1).padStart(2, '0'),
    playable,
    routable: Boolean(game.path),
    dailyPath: playable ? `/daily/${game.id}` : null,
    statusLabel: playable ? 'Ready to play' : game.status === 'later' ? 'Later' : 'Coming soon',
  };
}

export const siteGames = () => games.map(decorate);
export const playable = () => siteGames().filter((game) => game.playable);
export const findGame = (id) => siteGames().find((game) => game.id === id) || null;
export const findGameByPath = (path) => siteGames().find((game) => game.path === path) || null;
