/**
 * Page titles, descriptions and Open Graph copy. The router uses it for document.title
 * and scripts/build.mjs uses it to write per-route HTML, OG images, the sitemap and JSON-LD.
 * Pure data and string work only: it must run in Node as well as the browser.
 */
import { siteGames } from './registry.js';

export const SITE_NAME = 'Stillplay';
export const TAGLINE = 'A little time, well wasted.';
const suffix = ` — ${SITE_NAME}`;

const fixed = {
  '/': {
    title: `${SITE_NAME} — A little time, well wasted.`,
    description: 'The games that came with Windows XP, back in your browser. Minesweeper, FreeCell and more. No installs, no accounts, a shared daily challenge.',
    og: { kicker: 'Good games never get old', heading: 'A little time.', accent: 'Well wasted.', art: 'home' },
  },
  '/daily': {
    title: `Today’s daily games${suffix}`,
    description: 'One shared board and one shared deal each day, the same for everyone. Keep your streak going.',
    og: { kicker: 'Daily challenge', heading: 'Same game.', accent: 'Everyone, today.', art: 'daily' },
  },
  '/about': {
    title: `About${suffix}`,
    description: 'Why Stillplay exists, how the games are made, and where they run: a small homage to the games that came with Windows XP.',
    og: { kicker: 'About the project', heading: 'Some things are', accent: 'worth keeping.', art: 'home' },
  },
  '/secrets': {
    title: `Small games. Good secrets.${suffix}`,
    description: 'Interactive notes on the rules, numbered deals and small details behind the classic games.',
    og: { kicker: 'Worth another look', heading: 'Small games.', accent: 'Good secrets.', art: 'secrets' },
  },
};

function gamePage(game, daily) {
  if (!game.playable) {
    return {
      title: `${game.title}, coming soon${suffix}`,
      description: `${game.title} is on its way to Stillplay. ${game.tagline}`,
      og: { kicker: 'Coming soon', heading: game.title, accent: game.tagline, art: game.id },
    };
  }
  if (daily) {
    return {
      title: `Daily ${game.title}${suffix}`,
      description: `Today’s ${game.title} ${game.dailyNoun}, the same for everyone. It changes at midnight UTC.`,
      og: { kicker: 'Daily challenge', heading: `Daily ${game.title}`, accent: 'Same for everyone.', art: game.id },
      game,
    };
  }
  return {
    title: `Play ${game.title} online${suffix}`,
    description: game.description || `${game.title} in your browser. ${game.tagline}`,
    og: { kicker: 'Free to play in your browser', heading: game.title, accent: game.tagline, art: game.id },
    game,
  };
}

/** Metadata for one path, or null when the path is not a known page. */
export function pageMeta(path, { secrets = [] } = {}) {
  if (fixed[path]) return fixed[path];
  const games = siteGames();
  const game = games.find((item) => item.path === path);
  if (game) return gamePage(game, false);
  const daily = path.match(/^\/daily\/([\w-]+)$/);
  if (daily) {
    const dailyGame = games.find((item) => item.id === daily[1] && item.playable);
    if (dailyGame) return gamePage(dailyGame, true);
  }
  const secret = path.match(/^\/secrets\/([\w-]+)$/);
  if (secret) {
    const entry = secrets.find((item) => item.slug === secret[1]);
    if (entry) {
      return {
        title: `${entry.title.replace(/\.$/, '')}${suffix}`,
        description: entry.description,
        og: { kicker: `Secret ${entry.number}`, heading: entry.title, accent: '', art: 'secrets' },
      };
    }
  }
  return null;
}

/** Every page the build writes, in sitemap order. */
export function allPaths({ secrets = [] } = {}) {
  const games = siteGames();
  return [
    '/',
    ...games.filter((game) => game.playable).map((game) => game.path),
    '/daily',
    ...games.filter((game) => game.playable).map((game) => game.dailyPath),
    ...games.filter((game) => !game.playable && game.routable).map((game) => game.path),
    '/secrets',
    ...secrets.map((secret) => `/secrets/${secret.slug}`),
    '/about',
  ];
}

/** Structured data for search engines. */
export function jsonLd(path, origin, meta) {
  const url = new URL(path, origin).href;
  if (path === '/') {
    return {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: SITE_NAME,
      url,
      description: meta.description,
      applicationCategory: 'GameApplication',
      operatingSystem: 'Any (runs in a web browser)',
      browserRequirements: 'Requires JavaScript and WebAssembly',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    };
  }
  if (meta.game) {
    return {
      '@context': 'https://schema.org',
      '@type': 'VideoGame',
      name: meta.game.title,
      url,
      description: meta.description,
      genre: meta.game.genre,
      gamePlatform: 'Web browser',
      applicationCategory: 'Game',
      operatingSystem: 'Any (runs in a web browser)',
      playMode: 'SinglePlayer',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      publisher: { '@type': 'Organization', name: SITE_NAME },
    };
  }
  return null;
}
