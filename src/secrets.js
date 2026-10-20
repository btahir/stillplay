// Game cores load only when a secret's live demo needs them.

// All illustrations are our own SVG, drawn for Stillplay.
const svg = (body) => `<svg viewBox="0 0 240 150" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;
const tile = (x, y, number = '') => `<g transform="translate(${x} ${y})"><path fill="#c9ccc3" d="M0 0h24v24H0z"/><path stroke="#f9faf2" stroke-width="2" d="M1 23V1h22"/><path stroke="#858d7f" stroke-width="2" d="M1 23h22V1"/>${number ? `<text x="12" y="17" text-anchor="middle" font-size="16" font-family="monospace" font-weight="bold" fill="#3b6187">${number}</text>` : ''}</g>`;
const firstArt = svg(`<g transform="translate(44 20)">${Array.from({ length: 20 }, (_, i) => tile((i % 5) * 26, Math.floor(i / 5) * 26, [2, 7, 11].includes(i) ? '1' : '')).join('')}<circle cx="64" cy="64" r="5" fill="#354c39"/><path d="M64 64V18H116" stroke="#2c6249" stroke-width="2" stroke-dasharray="3 3"/><path d="m110 12 7 6-7 6" stroke="#2c6249" stroke-width="2"/><rect x="53" y="53" width="22" height="22" stroke="#2c6249" stroke-width="2"/></g>`);
const xyzzyArt = svg(`<path d="M36 37h169v79H36z" stroke="#adb5a5"/><path d="M36 37h169v12H36z" fill="#7e8d7c"/><rect x="40" y="41" width="3" height="3" fill="#f8f9f2"/>${[...'XYZZY'].map((letter, i) => `<g transform="translate(${49 + i * 29} 66)"><rect width="25" height="31" rx="2" fill="#d4d7cc" stroke="#9aa490"/><path d="M3 27h19" stroke="#a4ad9c"/><text x="12.5" y="20" text-anchor="middle" fill="#354c39" font-family="monospace" font-size="17">${letter}</text></g>`).join('')}<path d="M69 123h106" stroke="#a4ad9c"/><rect x="159" y="109" width="5" height="5" fill="#2c6249"/>`);
const hardArt = svg(`<g transform="translate(57 29) rotate(-12 28 42)"><rect width="57" height="85" fill="#e1e4d8" stroke="#a9b39e"/><text x="8" y="20" fill="#5a6e54" font-family="Georgia" font-size="17">A</text></g><g transform="translate(89 23)"><rect width="57" height="85" fill="#f9faf2" stroke="#a9b39e"/><path d="m29 32 9 13-9 13-9-13z" fill="#9b5c49"/><text x="8" y="20" fill="#9b5c49" font-family="Georgia" font-size="17">Q</text></g><g transform="translate(123 29) rotate(12 28 42)"><rect width="57" height="85" fill="#e1e4d8" stroke="#a9b39e"/><text x="8" y="20" fill="#5a6e54" font-family="Georgia" font-size="17">K</text></g><path d="M55 122h130" stroke="#adb5a5"/><text x="120" y="141" text-anchor="middle" fill="#64765e" letter-spacing="3" font-family="monospace" font-size="12">11982</text>`);
const numberArt = svg(`<text x="35" y="64" fill="#2c6249" font-family="Georgia" font-size="39">1</text><path d="M62 55h26m-6-5 6 5-6 5" stroke="#8e9b83"/><g transform="translate(99 27)"><rect x="7" y="-5" width="47" height="70" fill="#d7ddce" stroke="#a2ad98"/><rect x="3" y="-2" width="47" height="70" fill="#e4e8dd" stroke="#a2ad98"/><rect width="47" height="70" fill="#f9faf2" stroke="#a2ad98"/><text x="23.5" y="42" text-anchor="middle" fill="#64765e" font-family="Georgia" font-size="24">52</text></g><path d="M163 55h26m-6-5 6 5-6 5" stroke="#8e9b83"/><g fill="#879c7b">${Array.from({ length: 8 }, (_, i) => `<rect x="${53 + i * 17}" y="111" width="11" height="19"/>`).join('')}</g><text x="203" y="65" fill="#2c6249" font-family="Georgia" font-size="39">8</text>`);

export const secrets = [
  { slug: 'first-click', number: '01', title: 'Your first click gets a second chance.',
    description: 'Watch a mine move. A small kindness, written into our rules.', art: firstArt },
  { slug: 'xyzzy', number: '02', title: 'Five letters. One very small secret.',
    description: 'The story of XYZZY, and the pixel that gave the game away.', art: xyzzyArt },
  { slug: 'deal-11982', number: '03', title: 'The curious case of deal #11982.',
    description: 'The FreeCell deal with a reputation that outlived the desktop.', art: hardArt },
  { slug: 'deal-numbers', number: '04', title: 'A whole deck, inside one number.',
    description: 'How a repeatable shuffle turns a deal into something you can share.', art: numberArt },
];

const linkBack = '<p style="margin-top:42px"><a class="text-link" href="/secrets">All the little secrets <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" width="12" height="12" aria-hidden="true"><path d="M3 13 13 3M4 3h9v9"/></svg></a></p>';

const articles = {
  'first-click': `
    <p class="lede">A first move should be an invitation. In our Minesweeper, even a click on a mine gets one.</p>
    <p>The board is already there before you touch it: 81 cells, ten mines, one deterministic seed. If the first cell you reveal contains a mine, our core moves that mine to the first empty cell in row order. Then it counts the neighboring mines again.</p>
    <p>You get a safe first cell. You do not get a guaranteed empty opening, or a guarantee that every later move can be solved without guessing.</p>
    <h2>Make the mine move.</h2>
    <p>This inspection view deliberately shows every mine. The outlined cell starts with a mine in it. Press the button to send that exact click through the WebAssembly core used by the game.</p>
    <div class="demo" data-first-demo>
      <form data-seed-form style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:center">
        <label for="inspection-seed">Board seed</label>
        <input id="inspection-seed" name="seed" type="number" min="0" max="4294967295" step="1" value="1" required style="width:130px;padding:9px;border:1px solid var(--line);background:var(--white);color:var(--ink)">
        <button type="submit">Load seed</button>
      </form>
      <div data-board-diagram style="width:252px;max-width:100%"></div>
      <p data-click-result aria-live="polite" style="text-align:center;max-width:440px"></p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center"><button data-first-reveal>Reveal marked cell</button><button data-first-reset>Reset inspection</button></div>
      <p>Inspection view · all mine locations visible · our actual game engine</p>
    </div>
    <h2>Two positions change. Ten mines remain.</h2>
    <p>The clicked cell loses its mine; another cell gains one. The total stays the same. This policy is deterministic, so a replay records the original seed and the click, rather than saving a second board.</p>
    <pre><code>// Excerpt from our cores/minesweeper.c
cells[index] &amp;= ~MINE;
for (int target = 0; target &lt; board_width * board_height; ++target) {
    if (target != index &amp;&amp; !(cells[target] &amp; MINE)) {
        cells[target] |= MINE;
        break;
    }
}
count_neighbors();</code></pre>
    <p class="source-note">Source: our <code>ms_reveal</code> function in <code>cores/minesweeper.c</code>. We test first-click safety, mine totals and neighbor counts across 3,000 seeds.</p>`,
  xyzzy: `
    <p class="lede">The smallest hint imaginable: a single pixel, quietly telling you what lay beneath the cursor.</p>
    <div class="notice">A story from old cheat guides. Our Minesweeper does not include the XYZZY cheat.</div>
    <p>Old Minesweeper cheat guides describe typing <code>XYZZY</code>, followed by additional keys, to enable a tiny black-or-white indicator at the corner of the screen. The accounts differ on the final key sequence and which versions display the pixel.</p>
    <p>We are happy to leave the details to the old guides. The fun part is the mechanism: ordinary keyboard input can quietly change a hidden piece of state.</p>
    <h2>A tiny input latch.</h2>
    <p>Try typing <code>XYZZY</code> below, or use the five letter keys. This illustrative latch opens after those letters alone. Once it opens, switch the sample cell to see the enlarged indicator change.</p>
    <div class="demo" data-latch-demo>
      <p style="font-size:9px;letter-spacing:1.4px;text-transform:uppercase">Illustrative mechanism · not part of our game</p>
      <label for="latch-input">Type the five-letter word</label>
      <input id="latch-input" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="64" placeholder="Type here" style="width:200px;padding:12px;border:1px solid var(--line);background:var(--white);color:var(--ink);text-align:center;letter-spacing:5px">
      <div style="display:flex;gap:7px">${[...'XYZZY'].map((letter) => `<button data-latch-key="${letter}" aria-label="Type ${letter}" style="min-width:37px;padding:10px">${letter}</button>`).join('')}</div>
      <div style="display:flex;gap:18px;align-items:center;padding:18px 0">
        <div data-latch-pixel aria-hidden="true" style="height:38px;width:38px;background:#bbc3b1;border:1px solid #809174"></div>
        <p data-latch-state role="status">Waiting for five letters.</p>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center"><button data-sample-cell disabled>Sample cell: safe</button><button data-latch-reset>Reset latch</button></div>
      <p>The indicator is enlarged for this demo. It does not inspect your game.</p>
    </div>
    <h2>Why the story stuck.</h2>
    <p>The guides never quite agreed on the keys, the corner or the versions. What they shared was the delight of a game keeping a secret in plain sight, one pixel wide, for anyone patient enough to type a strange word.</p>
    <p class="source-note">Documentary reading: the <a href="https://www.digitpress.com/eastereggs/pcminesweeper.htm" target="_blank" rel="noopener noreferrer">Digital Press Minesweeper Easter egg account</a> and a <a href="https://gamefaqs.gamespot.com/pc/562694-minesweeper/faqs/26661" target="_blank" rel="noopener noreferrer">2003 Minesweeper FAQ</a>.</p>`,
  'deal-11982': `
    <p class="lede">Most deal numbers are a way to meet the same puzzle again. This one became a story people kept passing around.</p>
    <div class="notice">A result from the FreeCell community, not from this project. We have not run an exhaustive solver on this deal.</div>
    <div class="demo" style="padding-top:45px;padding-bottom:45px">
      <div style="font-family:Georgia,serif;font-size:clamp(60px,15vw,100px);letter-spacing:-4px;color:var(--green);line-height:1">11982</div>
      <p style="letter-spacing:2px;text-transform:uppercase;font-size:9px">One number. A very long conversation.</p>
    </div>
    <h2>The deal that stayed behind.</h2>
    <p>Michael Keller's <a href="https://www.solitairelaboratory.com/fcfaq.html" target="_blank" rel="noopener noreferrer">FreeCell FAQ at Solitaire Laboratory</a> documents the effort to solve the original set of 32,000 numbered deals. It identifies #11982 as the exceptional unsolvable deal under the standard rules, after sustained human and computer searches.</p>
    <p>That is a documented historical result. Showing the number in our interface does not repeat the search behind it; that took solvers, spare machines and a lot of patience.</p>
    <h2>Why the rules matter.</h2>
    <p>Four free cells, eight columns, alternating colors. Change the available storage or the building rules and you change the puzzle. A solver's conclusion belongs to a precise starting layout and a precise set of legal moves.</p>
    <p>Our FreeCell lets you explore the deal with undo and hints. It does not declare the position impossible, and a hint is a legal move suggestion rather than a promise of a solution.</p>
    <p><a class="text-link" href="/freecell?deal=11982">Open deal #11982 <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" width="12" height="12" aria-hidden="true"><path d="M3 13 13 3M4 3h9v9"/></svg></a></p>
    <h2>A number worth keeping.</h2>
    <p>Whatever the outcome of one attempt, numbered deals make the conversation possible. Two people can start from the same arrangement, compare decisions, and discuss a puzzle across years and machines.</p>
    <p class="source-note">Documentary source: Michael Keller, <a href="https://www.solitairelaboratory.com/fcfaq.html" target="_blank" rel="noopener noreferrer">FreeCell FAQ</a>, section “The Microsoft 32,000.” Our engine and deal numbering are our own code.</p>`,
  'deal-numbers': `
    <p class="lede">You do not need to send someone 52 cards. Sometimes one number will do.</p>
    <p>A deal number is a seed. Put it through the same number generator, start with the same ordered deck, and select cards in the same order: the whole layout returns.</p>
    <h2>Deal a number.</h2>
    <p>These are the first eight cards from our actual FreeCell engine, one for each column. Deal #1 starts with the familiar jack of diamonds, two of diamonds, nine of hearts.</p>
    <div class="demo" data-deal-demo>
      <form data-deal-form style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:center">
        <label for="secret-deal">Deal number</label>
        <input id="secret-deal" name="deal" type="number" min="1" max="2147483647" step="1" value="1" required style="width:130px;padding:9px;border:1px solid var(--line);background:var(--white);color:var(--ink)">
        <button type="submit">Deal cards</button>
      </form>
      <div data-deal-cards style="width:100%;max-width:580px"></div>
      <p data-deal-result role="status" style="text-align:center"></p>
      <a class="text-link" data-play-deal href="/freecell?deal=1">Play this deal <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" width="12" height="12" aria-hidden="true"><path d="M3 13 13 3M4 3h9v9"/></svg></a>
    </div>
    <h2>A very small machine.</h2>
    <p>Our C core uses the documented 32-bit Microsoft CRT recurrence. The arithmetic wraps at 32 bits; the generator then takes 15 bits for each draw. This snippet comes from our implementation.</p>
    <pre><code>// Excerpt from our cores/freecell.c
random = random * 214013U + 2531011U;
int remaining = 52 - draw;
int selected = ((random &gt;&gt; 16) &amp; 0x7fffU) % remaining;
int original_id = deck[selected];
int card = (original_id % 4) * 13 + original_id / 4;
int column = draw % 8;</code></pre>
    <p>After each selection, the last available card replaces the selected card in the working deck. Cards are dealt across the eight columns in turn. The starting deck order and this removal step matter just as much as the random-number formula.</p>
    <h2>Repeatable is something we can test.</h2>
    <p>The browser and the command-line player load the same WebAssembly module. Give both the same number and they produce the same arrangement. Our tests also check published deal fixtures.</p>
    <p class="source-note">Source: our <code>fc_new</code> in <code>cores/freecell.c</code>. Background: <a href="https://www.solitairelaboratory.com/fcfaq.html" target="_blank" rel="noopener noreferrer">Solitaire Laboratory's explanation of numbered deals</a>.</p>`,
};

function boardSVG(state, target, moved = -1) {
  const size = 25;
  const body = state.cells.map((cell, index) => {
    const x = (index % state.width) * size;
    const y = Math.floor(index / state.width) * size;
    const marked = index === target || index === moved;
    return `<g transform="translate(${x} ${y})"><rect x="1" y="1" width="23" height="23" fill="${cell.revealed ? '#fffef9' : '#d2d7c9'}" stroke="${marked ? '#2c6249' : '#aab59f'}" stroke-width="${marked ? '2' : '.6'}"/>${cell.mine ? '<circle cx="12.5" cy="12.5" r="4" fill="#526b47"/>' : cell.revealed && cell.adjacent ? `<text x="12.5" y="18" text-anchor="middle" font-size="16" font-weight="bold" font-family="monospace" fill="#3b6187">${cell.adjacent}</text>` : ''}</g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${state.width * size} ${state.height * size}" width="100%" role="img" aria-label="Seed ${state.seed} inspection diagram. All ten mines are visible. The outlined cell is ${state.cells[target].revealed ? 'revealed and safe' : 'the mined first click target'}.">${body}</svg>`;
}

const suitNames = ['clubs', 'diamonds', 'hearts', 'spades'];
const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const suitPaths = [
  '<circle cx="0" cy="-5" r="4"/><circle cx="-4" cy="1" r="4"/><circle cx="4" cy="1" r="4"/><path d="M-3 8 0 0 3 8z"/>',
  '<path d="m0-10 7 10-7 10-7-10z"/>',
  '<path d="M0 8C-13 0-9-10-3-7L0-4 3-7C9-10 13 0 0 8Z"/>',
  '<path d="M0-10C-4-6-10 0-6 4-3 7 0 2 0 2S3 7 6 4C10 0 4-6 0-10Z"/><path d="m-3 10 3-9 3 9z"/>',
];

function cardsSVG(cards, deal) {
  const labels = cards.map((id) => `${ranks[id % 13]} of ${suitNames[Math.floor(id / 13)]}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 536 100" width="100%" role="img" aria-label="Deal ${deal}, first row: ${labels.join(', ')}.">${cards.map((id, i) => {
    const suit = Math.floor(id / 13);
    const color = suit === 1 || suit === 2 ? '#a35746' : '#344c38';
    return `<g transform="translate(${i * 67 + 1} 3)"><rect width="61" height="86" rx="3" fill="#fffef9" stroke="#b1bba7"/><text x="8" y="22" fill="${color}" font-family="Georgia,serif" font-size="18">${ranks[id % 13]}</text><g transform="translate(31 49)" fill="${color}">${suitPaths[suit]}</g><text x="30" y="97" text-anchor="middle" fill="var(--muted)" font-family="sans-serif" font-size="8">${i + 1}</text></g>`;
  }).join('')}</svg>`;
}

export async function renderSecret(slug, container, { showToast = () => {} } = {}) {
  const secret = secrets.find((item) => item.slug === slug);
  if (!secret) {
    container.innerHTML = '<article class="article"><p class="eyebrow">Secrets</p><h1>A secret for another day.</h1><p>That page is not in the collection.</p><a class="text-link" href="/secrets">Explore the secrets</a></article>';
    return () => {};
  }
  container.innerHTML = `<article class="article"><p class="eyebrow">Little secrets · ${secret.number}</p><h1>${secret.title}</h1>${articles[slug]}${linkBack}</article>`;
  const controller = new AbortController();
  const on = (element, type, listener) => element.addEventListener(type, listener, { signal: controller.signal });
  const find = (selector) => container.querySelector(selector);

  if (slug === 'first-click') {
    const { createMinesweeper } = await import('./minesweeper-core.js');
    const game = await createMinesweeper({ seed: 1 });
    let target;
    function reset() {
      const seed = Number(find('#inspection-seed').value);
      if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
        showToast('Enter a seed from 0 to 4294967295.');
        return;
      }
      const state = game.newGame({ level: 'beginner', seed });
      target = state.cells.findIndex((cell) => cell.mine);
      find('[data-board-diagram]').innerHTML = boardSVG(state, target);
      find('[data-click-result]').textContent = `Before the click: column ${target % state.width + 1}, row ${Math.floor(target / state.width) + 1} contains a mine.`;
      find('[data-first-reveal]').disabled = false;
    }
    on(find('[data-seed-form]'), 'submit', (event) => { event.preventDefault(); reset(); });
    on(find('[data-first-reset]'), 'click', reset);
    on(find('[data-first-reveal]'), 'click', () => {
      const before = game.state();
      const after = game.reveal(target % before.width, Math.floor(target / before.width));
      const moved = after.cells.findIndex((cell, index) => cell.mine && !before.cells[index].mine);
      find('[data-board-diagram]').innerHTML = boardSVG(after, target, moved);
      find('[data-click-result]').textContent = `Safe. The mine moved to column ${moved % after.width + 1}, row ${Math.floor(moved / after.width) + 1}. The board still contains ${after.mines} mines.`;
      find('[data-first-reveal]').disabled = true;
    });
    reset();
  }

  if (slug === 'xyzzy') {
    const input = find('#latch-input');
    const sample = find('[data-sample-cell]');
    let enabled = false;
    let mine = false;
    function refresh() {
      find('[data-latch-pixel]').style.background = enabled ? mine ? '#20291e' : '#fffef9' : '#bbc3b1';
      find('[data-latch-state]').textContent = enabled ? `Latch open. Sample cell: ${mine ? 'mine · black indicator' : 'safe · white indicator'}.` : `Waiting for five letters. ${input.value.length ? `${Math.min(input.value.length, 5)} entered.` : ''}`;
      sample.disabled = !enabled;
      sample.textContent = `Sample cell: ${mine ? 'mine' : 'safe'}`;
    }
    function check() {
      if (input.value.toUpperCase().endsWith('XYZZY')) enabled = true;
      refresh();
    }
    on(input, 'input', check);
    container.querySelectorAll('[data-latch-key]').forEach((button) => on(button, 'click', () => {
      input.value = (input.value + button.dataset.latchKey).slice(-64);
      check();
    }));
    on(sample, 'click', () => { mine = !mine; refresh(); });
    on(find('[data-latch-reset]'), 'click', () => { enabled = false; mine = false; input.value = ''; refresh(); });
    refresh();
  }

  if (slug === 'deal-numbers') {
    const { createFreecell } = await import('./freecell-core.js');
    const game = await createFreecell({ deal: 1 });
    function deal() {
      const number = Number(find('#secret-deal').value);
      if (!Number.isInteger(number) || number < 1 || number > 2147483647) {
        showToast('Enter a deal number from 1 to 2147483647.');
        return;
      }
      const state = game.newGame(number);
      find('[data-deal-cards]').innerHTML = cardsSVG(state.columns.map((column) => column[0]), number);
      find('[data-deal-result]').textContent = `Deal #${number} · first row of eight columns · 52 cards in the complete layout.`;
      find('[data-play-deal]').href = `/freecell?deal=${number}`;
    }
    on(find('[data-deal-form]'), 'submit', (event) => { event.preventDefault(); deal(); });
    deal();
  }

  return () => controller.abort();
}
