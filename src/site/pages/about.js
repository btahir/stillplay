/** /about: why this exists, how it is built, and what is and is not yet proven. */
import { playable } from '../registry.js';
import { escape } from '../ui/dom.js';

function list(titles) {
  if (titles.length <= 1) return titles.join('');
  return `${titles.slice(0, -1).join(', ')} and ${titles.at(-1)}`;
}

export function render(main) {
  const ready = playable().map((game) => game.title);
  main.innerHTML = `<article class="article">
    <p class="eyebrow">A small collection with a long memory</p>
    <h1>Some things are<br><em>worth keeping.</em></h1>
    <p class="lede">A field of grey squares. A green table. Five minutes that quietly become twenty.</p>
    <p>Stillplay brings back the small games that came with Windows XP, so you can play them in a browser tab without installing anything. ${escape(list(ready))} ${ready.length === 1 ? 'is' : 'are'} ready today. The rest follow one at a time, each once it plays well and its rules pass their tests.</p>
    <p>There are no accounts and no server keeping score. Your stats, streaks and settings stay in this browser. After your first visit the games also work offline, and you can add Stillplay to your home screen like an app.</p>

    <h2>Every day, a shared game.</h2>
    <p>Each game has a daily board or deal, worked out from the date, so everyone in the world gets the same one. Solve it on consecutive days to build a streak. When you win, you can share your time, or a replay link that lets a friend watch your game move by move.</p>

    <h2>The art is ours.</h2>
    <p>Every card, tile, icon and sound on this site was made for Stillplay, drawn in code. We ship no Microsoft bitmaps, icons, sounds, executables or other original assets. “Original pixels” mode is our own artwork drawn at the old resolution; “Crisp” draws the same artwork for modern screens.</p>
    <p>If you still have your own copy of a game, the resource inspector on the home page can read its bitmaps entirely inside your browser. Nothing is uploaded.</p>

    <h2>Reconstruction is the long goal.</h2>
    <p>The rules of each game are written from scratch in C and compiled to WebAssembly. The same code runs in your browser and in our command-line tools, which is how we test it. The longer aim is to rebuild each game function by function and show, with byte-level comparisons, that it matches the original program.</p>
    <p>That comparison needs original executables and the matching compiler, and it has not started. Until it has, we make no claim that these games behave exactly like the originals. The <a href="/scoreboard">scoreboard</a> records what is known and leaves the unknowns blank. AI tools help us write code, documentation and tests; they do not count as evidence. Only the comparisons do.</p>

    <h2>Open, and small on purpose.</h2>
    <p>The project is open source under the MIT licence. Fonts keep their own licences. Stillplay is a working name.</p>
    <p class="source-note">Not affiliated with or endorsed by Microsoft. Windows XP, Minesweeper, FreeCell and the other product names are used only to identify the games this independent project studies.</p>
  </article>`;
}
