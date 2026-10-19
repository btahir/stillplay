/**
 * Stillplay site entry. The shell lives in src/site/:
 *   router.js         routes every URL from the game registry (src/games.js)
 *   pages/*.js        one module per page; rarely used pages load on demand
 *   play/stage.js     mounts a game with its controls (new, undo, hint, sound, stats, focus)
 *   play/stats.js     local statistics and daily streaks
 *   ui/*.js           dialog, toast, theme, icons and small DOM helpers
 */
import { setupDialog } from './site/ui/dialog.js';
import { setupTheme } from './site/ui/theme.js';
import { startRouter } from './site/router.js';
import { registerServiceWorker } from './site/pwa.js';

setupTheme();
setupDialog();
startRouter(document.querySelector('main'));
registerServiceWorker();
