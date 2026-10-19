/**
 * The collection. Routing, the home page, the CLI and the sitemap all read this list.
 * A game is playable exactly when it has a `mount`; with `mount: null` the site shows it as coming soon.
 *
 * Mount contract: `mount(container, options)` resolves to a game handle.
 *   options: { daily, onWin(summary), sound(cue), showDialog(title, html), showToast(text),
 *              onStart?(), onLose?(summary), chrome: true }
 *   handle:  { destroy(), exportReplay(), loadReplay?(replay), newGame?(), setFidelity?('pixels' | 'crisp'),
 *              undo?(), canUndo?(), hint?(), state?(), shortcuts?: [[keys, label], ...] }
 * `summary` passed to onWin always has { game, seed, daily, elapsedSeconds } plus game-specific fields
 * (level, deal, moves, replay). Call onStart() whenever a fresh deal or board is ready; local stats count a
 * game as played on its first move after that. `chrome: true` means the site already shows New game,
 * Undo, Hint, Sound and the pixels/crisp toggle around the game, so a game need not draw its own.
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
    id: 'hearts', title: 'Hearts', path: '/hearts', icon: 'hearts', status: 'planned',
    tagline: 'Three rivals. Avoid the queen.',
    mount: null,
  },
  {
    id: 'pinball', title: '3D Pinball', path: null, icon: 'pinball', status: 'later',
    tagline: 'Later, with the right licence.',
    mount: null,
  },
];

export const gameById = (id) => games.find((game) => game.id === id);
export const playableGames = () => games.filter((game) => game.status === 'playable');
