/** /about: why this exists, how it is made, and where your data lives. */
import { playable, siteGames } from '../registry.js';
import { escape } from '../ui/dom.js';

function list(titles) {
  if (titles.length <= 1) return titles.join('');
  return `${titles.slice(0, -1).join(', ')} and ${titles.at(-1)}`;
}

export function render(main) {
  const ready = playable().map((game) => game.title);
  const coming = siteGames().length - ready.length;
  main.innerHTML = `<article class="article">
    <p class="eyebrow">A small collection with a long memory</p>
    <h1>Some things are<br><em>worth keeping.</em></h1>
    <p class="lede">A field of grey squares. A green table. Five minutes that quietly become twenty.</p>
    <p>Stillplay is a homage to the small games that came with Windows XP. They sat on almost every computer for years, and plenty of us learned to use a mouse on them. Here you can play ${escape(list(ready))} again in a browser tab, with nothing to install.${coming ? ` ${coming === 1 ? 'One more follows' : 'The rest follow'} once ${coming === 1 ? 'it plays' : 'each plays'} well.` : ''}</p>

    <h2>Every day, a shared game.</h2>
    <p>Each game has a daily board or deal, worked out from the date, so everyone in the world gets the same one. Solve it on consecutive days to build a streak. When you win, you can share your time, or a replay link that lets a friend watch your game move by move.</p>

    <h2>Made from scratch.</h2>
    <p>Everything here is our own work. The rules of each game are written in C and compiled to WebAssembly, and the same code runs in your browser and in a small command-line player we use for testing. Every card, tile and icon is drawn in code, and the sounds were made for this project. We ship no Microsoft bitmaps, icons, sounds or executables.</p>
    <p>“Original pixels” mode draws our artwork at the old resolution, for the period feel. “Crisp” draws the same artwork for modern screens.</p>

    <h2>Yours, and offline.</h2>
    <p>There are no accounts, no ads and no server keeping score. Your stats, streaks and settings stay in this browser. After your first visit the games work offline, and you can add Stillplay to your home screen like an app.</p>

    <h2>Open, and small on purpose.</h2>
    <p>The project is open source under the MIT licence. Fonts keep their own licences. The source is on <a href="https://github.com/btahir/stillplay">GitHub</a>, and the site is hosted on <a href="https://shiptiffin.com/?ref=stillplay">ShipTiffin</a>.</p>
    <p class="source-note">An independent fan project, not affiliated with or endorsed by Microsoft. Windows XP, Minesweeper, FreeCell and the other product names are used only to identify the games this project pays tribute to.</p>
  </article>`;
}
