/**
 * The collection. Routing, the home page, the CLI and the sitemap all read this list.
 *
 * Mount contract: `mount(container, options)` resolves to a game handle.
 *   options: { daily, onWin(summary), sound(cue), showDialog(title, html), showToast(text) }
 *   handle:  { destroy(), exportReplay(), newGame?(), setFidelity?('pixels' | 'crisp') }
 * `summary` passed to onWin always has { game, seed, daily, elapsedSeconds } plus game-specific fields.
 * Sound cue names live in src/audio.js.
 */
export const games = [
  {
    id: 'minesweeper', title: 'Minesweeper', path: '/minesweeper', icon: 'mine', status: 'playable',
    tagline: 'Ten mines. Countless memories.',
    mount: () => import('./minesweeper-ui.js').then((m) => m.mountMinesweeper),
  },
  {
    id: 'freecell', title: 'FreeCell', path: '/freecell', icon: 'freecell', status: 'playable',
    tagline: 'Every deal, a possibility.',
    mount: () => import('./freecell-ui.js').then((m) => m.mountFreecell),
  },
  {
    id: 'solitaire', title: 'Solitaire', path: '/solitaire', icon: 'solitaire', status: 'playable',
    tagline: 'Draw one or draw three. Then the cascade.',
    mount: () => import('./solitaire-ui.js').then((m) => m.mountSolitaire),
  },
  {
    id: 'spider', title: 'Spider Solitaire', path: '/spider', icon: 'spider', status: 'planned',
    tagline: 'One suit, two suits, or all four.',
    mount: null,
  },
  {
    id: 'hearts', title: 'Hearts', path: '/hearts', icon: 'hearts', status: 'playable',
    tagline: 'Three rivals. Avoid the queen.',
    mount: () => import('./hearts-ui.js').then((m) => m.mountHearts),
  },
  {
    id: 'pinball', title: '3D Pinball', path: null, icon: 'pinball', status: 'later',
    tagline: 'Later, with the right licence.',
    mount: null,
  },
];

export const gameById = (id) => games.find((game) => game.id === id);
export const playableGames = () => games.filter((game) => game.status === 'playable');
