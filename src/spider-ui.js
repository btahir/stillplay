/**
 * Spider Solitaire on the shared card table.
 *
 * The WASM core (src/spider-core.js) owns the rules; the card table owns input
 * and motion. This file turns core state into piles, runs the two-step
 * animations Spider needs (deal a row, then send a finished run home) and draws
 * the window chrome. Mount contract: see src/games.js.
 *
 * Piles: t0–t9 the columns, s the stock (bottom right, one back per deal left),
 * r0–r7 the completed runs (bottom left, out of keyboard navigation).
 */
import { createSpider, loadSpiderReplay } from './spider-core.js';
import { createCardTable } from './card-table.js';
import { dailyDeal } from './shared.js';
import { cardSvg, cardName, suitSvg, RANKS, NAMES, SUITS } from './cards.js';

const SETTINGS_KEY = 'stillplay-spider-options';
const COLUMNS = Array.from({ length: 10 }, (_, i) => `t${i}`);
const RUN_PILES = Array.from({ length: 8 }, (_, i) => `r${i}`);
const SUIT_CHOICES = [1, 2, 4];
const SUIT_WORDS = { 1: 'One suit', 2: 'Two suits', 4: 'Four suits' };
const COMPACT_WIDTH = 520; // matches the container query in spider.css
const CASCADE_CARDS = 24; // the kings, queens and jacks bounce; the rest stay put

const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const validDeal = (value) => Number.isInteger(value) && value >= 1 && value <= 2147483647;
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const rankOf = (card) => card % 13;
const suitOf = (card) => Math.floor(card / 13);

function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage is optional. */ }
}
function loadSettings() {
  const saved = readJSON(SETTINGS_KEY, {});
  return { suits: SUIT_CHOICES.includes(saved.suits) ? saved.suits : 1 };
}
function randomDeal() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] % 1000000 + 1;
}

function injectStyles() {
  if (document.querySelector('link[data-spider-styles]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./spider.css', import.meta.url).href;
  link.dataset.spiderStyles = '';
  document.head.append(link);
}

/*
 * Card faces. Each face carries two drawings: the shared full face, and a
 * compact face with a big rank and suit in the top band for very narrow
 * tables. CSS picks one; the compact one is hidden by an attribute so the
 * win cascade (which draws the SVG without our CSS) always shows the full face.
 */
function compactFace(card) {
  const suit = suitOf(card);
  const rank = RANKS[rankOf(card)];
  return '<g class="sp-face-compact" display="none">'
    + '<rect x=".6" y=".6" width="68.8" height="96.8" rx="3" fill="#fffefa" stroke="#6b6c63" stroke-width="1.6"/>'
    + `<text x="4" y="29" font-family="Arial,Helvetica,sans-serif" font-size="${rank === '10' ? 27 : 32}" font-weight="bold" letter-spacing="${rank === '10' ? -3 : 0}" fill="currentColor">${rank}</text>`
    + suitSvg(suit, 44, 6, 22)
    + suitSvg(suit, 17, 46, 36)
    + '</g>';
}
function faceSvg(card) {
  const full = cardSvg(card);
  const open = full.indexOf('>') + 1;
  const close = full.lastIndexOf('</svg>');
  return `${full.slice(0, open)}<g class="sp-face-full">${full.slice(open, close)}</g>${compactFace(card)}</svg>`;
}

const pileLabel = (id) => id === 's' ? 'the stock' : id[0] === 'r' ? `completed run ${Number(id[1]) + 1}` : `column ${Number(id.slice(1)) + 1}`;

const ICONS = {
  window: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="2.5" width="12" height="17" rx="1.2" fill="#2c6249" stroke="#fff" stroke-width=".8"/><rect x="9" y="4.5" width="12" height="17" rx="1.2" fill="#fff" stroke="#142b64"/><path d="M15 8.6c-1.9 2.4-4.4 4-4.4 6 0 1.4 1.5 2.1 3 1.2-.1.8-.4 1.3-1.2 1.7h5.2c-.8-.4-1.1-.9-1.2-1.7 1.5.9 3 .2 3-1.2 0-2-2.5-3.6-4.4-6Z" fill="#17201b"/></svg>',
};

function markup(daily) {
  const slot = (label, extra = '') => `<button type="button" class="sp-slot" data-ct-target aria-label="${label}">${extra}</button>`;
  return `<section class="sp-window" aria-label="Spider Solitaire game">
  <div class="sp-titlebar"><span class="sp-title-icon">${ICONS.window}</span><span class="sp-title">Spider Solitaire</span><span class="sp-title-controls" aria-hidden="true"><i></i><i></i><i>×</i></span></div>
  <div class="sp-menubar">
    <div class="sp-menu-wrap"><button type="button" class="sp-menu-trigger" data-action="menu-game" aria-expanded="false" aria-haspopup="menu"><u>G</u>ame</button>
      <div class="sp-dropdown" role="menu" data-menu="game" hidden>
        <button role="menuitem" type="button" data-action="new">New game <span>F2</span></button>
        <button role="menuitem" type="button" data-action="deal">Choose a deal…</button>
        <div class="sp-menu-separator" role="separator"></div>
        <button role="menuitem" type="button" data-action="undo">Undo <span>Ctrl+Z</span></button>
        <button role="menuitem" type="button" data-action="deal-row">Deal a new row <span>D</span></button>
        <button role="menuitem" type="button" data-action="hint">Show a move <span>M</span></button>
        <div class="sp-menu-separator" role="separator"></div>
        <button role="menuitem" type="button" data-action="options">Options…</button>
      </div></div>
    <div class="sp-menu-wrap"><button type="button" class="sp-menu-trigger" data-action="menu-help" aria-expanded="false" aria-haspopup="menu"><u>H</u>elp</button>
      <div class="sp-dropdown" role="menu" data-menu="help" hidden>
        <button role="menuitem" type="button" data-action="help">How to play <span>F1</span></button>
        <button role="menuitem" type="button" data-action="about">About this version</button>
      </div></div>
    <span class="sp-menu-mode">${daily ? 'Daily · One suit' : ''}</span>
  </div>
  <div class="sp-felt">
    <div class="sp-tableau">
      ${COLUMNS.map((id, i) => `<div class="sp-pile sp-column" data-pile-id="${id}">${slot(`Column ${i + 1}, empty. Any card or run can go here.`)}</div>`).join('')}
    </div>
    <div class="sp-bottom">
      <div class="sp-done-area" role="img" aria-label="No runs completed yet">
        <span class="sp-done-slot" aria-hidden="true"></span>
        ${RUN_PILES.map((id, i) => `<div class="sp-pile sp-done" data-pile-id="${id}" style="--sp-run:${i}"></div>`).join('')}
      </div>
      <div class="sp-pile sp-stock" data-pile-id="s">${slot('No deals left', '<span class="sp-stock-empty" aria-hidden="true"></span>')}</div>
    </div>
    <div class="sp-panel sp-stuck" role="status" hidden></div>
    <div class="sp-panel sp-win" role="status" hidden></div>
  </div>
  <div class="sp-statusbar"><span class="sp-status-progress">0 of 8 runs</span><span class="sp-status-score">Score: 500</span><span class="sp-status-moves">Moves: 0</span></div>
</section>
<div class="sp-below">
  <div class="sp-quick-actions">
    <button type="button" data-action="undo">Undo</button><span aria-hidden="true">·</span>
    <button type="button" data-action="hint">Hint</button><span aria-hidden="true">·</span>
    <button type="button" data-action="deal-row">Deal a row</button><span aria-hidden="true">·</span>
    <button type="button" data-action="options">Options</button><span aria-hidden="true">·</span>
    <button type="button" data-action="deal">Choose a deal</button>
  </div>
  <p class="sp-message" role="status" aria-live="polite"></p>
</div>
<dialog class="sp-dialog" data-dialog="deal" aria-labelledby="sp-deal-title"><form method="dialog" class="sp-dialog-form" data-form="deal">
  <h2 id="sp-deal-title">Choose a deal</h2><p>Every number is its own shuffle. Share one with a friend, with the same number of suits, and you both get the same cards.</p>
  <label for="sp-deal-input">Deal number</label><input id="sp-deal-input" name="deal" type="number" min="1" max="2147483647" step="1" required>
  <p class="sp-dialog-error" data-deal-error aria-live="polite"></p>
  <div class="sp-dialog-actions"><button class="sp-classic-button" type="button" data-action="cancel-dialog">Cancel</button><button class="sp-classic-button sp-default-button" type="submit">Deal</button></div>
</form></dialog>
<dialog class="sp-dialog" data-dialog="options" aria-labelledby="sp-options-title"><form method="dialog" class="sp-dialog-form" data-form="options">
  <h2 id="sp-options-title">Options</h2>
  <fieldset><legend>Difficulty</legend>
    <label><input type="radio" name="suits" value="1"> <span><strong>One suit</strong> · Beginner. Every card is a spade.</span></label>
    <label><input type="radio" name="suits" value="2"> <span><strong>Two suits</strong> · Intermediate. Spades and hearts.</span></label>
    <label><input type="radio" name="suits" value="4"> <span><strong>Four suits</strong> · Advanced. The full two decks.</span></label>
  </fieldset>
  <p class="sp-dialog-note" data-options-note>Changing the suits deals this number again with the new cards.</p>
  <div class="sp-dialog-actions"><button class="sp-classic-button" type="button" data-action="cancel-dialog">Cancel</button><button class="sp-classic-button sp-default-button" type="submit">OK</button></div>
</form></dialog>
<dialog class="sp-dialog" data-dialog="help" aria-labelledby="sp-help-title"><div class="sp-dialog-form">
  <h2 id="sp-help-title">How to play Spider Solitaire</h2>
  <p>Build each suit down from king to ace, inside the ten columns. When a column holds a full king-to-ace run of one suit, the run leaves the table. Clear all eight runs to win.</p>
  <p>Any card can go on a card one rank higher, whatever its suit. Only a run of one suit moves together, so building in suit keeps your options open. Any card or run can fill an empty column.</p>
  <p>When you run out of moves, click the stock in the bottom right to deal a new row: one card on every column. A row can only be dealt when no column is empty.</p>
  <p><strong>Keyboard:</strong> Tab or the arrow keys move between piles. Enter or Space picks cards up and puts them down. Shift+Enter makes the best move for a card. Escape puts it back. <strong>D</strong> deals a row, <strong>M</strong> shows a move (press again for the next one), <strong>F2</strong> starts a new game and <strong>Ctrl+Z</strong> undoes.</p>
  <div class="sp-dialog-actions"><button type="button" class="sp-classic-button sp-default-button" data-action="cancel-dialog">Got it</button></div>
</div></dialog>
<dialog class="sp-dialog" data-dialog="about" aria-labelledby="sp-about-title"><div class="sp-dialog-form">
  <h2 id="sp-about-title">A familiar game, rebuilt</h2>
  <p>This is our own Spider Solitaire, written in C and compiled to WebAssembly, with the classic scoring: 500 to start, one point off for every move, 100 back for every finished run. It has not been compared with the original Windows program, and deal numbers are our own.</p>
  <p>The cards, the table and the bouncing ending are all drawn for this project.</p>
  <div class="sp-dialog-actions"><button type="button" class="sp-classic-button sp-default-button" data-action="cancel-dialog">Close</button></div>
</div></dialog>`;
}

export async function mountSpider(container, { daily = false, onWin = () => {}, sound = () => {} } = {}) {
  injectStyles();
  const params = new URLSearchParams(location.search);
  const settings = loadSettings();
  const requestedSuits = Number(params.get('suits'));
  if (!daily && SUIT_CHOICES.includes(requestedSuits)) settings.suits = requestedSuits;
  const requestedDeal = Number(params.get('deal'));
  const firstDeal = daily ? dailyDeal() : validDeal(requestedDeal) ? requestedDeal : randomDeal();
  let engine = await createSpider({ seed: firstDeal, suits: daily ? 1 : settings.suits });

  let fidelity = 'crisp';
  let destroyed = false;
  let started = null;
  let finishedSeconds = null;
  let wonReported = false;
  let openMenu = null;
  let ticket = 0; // bumps on every action so a slow two-step animation never syncs a stale state
  let faces = new Map(); // uid → face id 0–51, fixed for a deal
  let runs = []; // completed runs, in order: { suit, uids (king first), column }
  let shown = new Map(); // uid → faceUp, as last drawn
  let needsCardTimer = 0;

  const host = document.createElement('div');
  host.className = 'spider-root';
  host.dataset.fidelity = fidelity;
  host.innerHTML = markup(daily);
  container.replaceChildren(host);
  const $ = (selector) => host.querySelector(selector);
  const felt = $('.sp-felt');
  const tableau = $('.sp-tableau');
  const messageEl = $('.sp-message');
  const winEl = $('.sp-win');
  const stuckEl = $('.sp-stuck');

  function playSound(name) { try { sound(name); } catch { /* Sound is optional. */ } }
  function announce(text) { messageEl.textContent = text; }
  const elapsed = () => finishedSeconds ?? (started ? Math.floor((Date.now() - started) / 1000) : 0);
  const compact = () => host.clientWidth <= COMPACT_WIDTH;

  /*
   * Column fanning. Face-down cards squeeze first, then face-up cards, so a
   * long column always ends above the stock row and nothing leaves the window.
   * Returns pixel gaps (always ≥ 1, which card-table reads as pixels).
   */
  function columnGaps(pile) {
    const h = pile.cardH;
    const entries = pile.entries;
    const covered = entries.slice(0, -1);
    const downGaps = covered.filter((entry) => !entry.faceUp).length;
    const upGaps = covered.length - downGaps;
    const bottom = tableau.getBoundingClientRect().bottom;
    const memo = `${entries.length}:${downGaps}:${pile.oy}:${h}:${bottom}`;
    if (pile.spiderGaps?.memo === memo) return pile.spiderGaps;
    let down = Math.max(3, h * 0.1);
    let up = h * (compact() ? 0.34 : 0.27);
    const available = bottom - pile.oy - h;
    const need = () => downGaps * down + upGaps * up;
    if (need() > available && downGaps) down = Math.max(Math.min(down, Math.max(2, h * 0.035)), (available - upGaps * up) / downGaps);
    if (need() > available && upGaps) up = (available - downGaps * down) / upGaps;
    if (need() > available && downGaps) down = Math.max(0, available - upGaps * up) / downGaps;
    pile.spiderGaps = { memo, down: Math.max(1, down), up: Math.max(1, up) };
    return pile.spiderGaps;
  }
  // The stock: one back per deal left, stepping left from the corner. The next deal is on top, at the right.
  function stockLayout(count, width) {
    const groups = Math.ceil(count / 10);
    const step = width * 0.2;
    return Array.from({ length: count }, (_, index) => ({ x: -(groups - 1 - Math.floor(index / 10)) * step, y: 0 }));
  }

  const pileElement = (id) => host.querySelector(`[data-pile-id="${id}"]`);
  const table = createCardTable(felt, {
    cardClass: 'sp-card',
    renderFace: faceSvg,
    piles: [
      ...COLUMNS.map((id) => ({
        id, element: pileElement(id), row: 0, label: pileLabel(id), fan: 'down',
        faceDownOffset: (height, pile) => columnGaps(pile).down,
        faceUpOffset: (height, pile) => columnGaps(pile).up,
      })),
      { id: 's', element: pileElement('s'), row: 1, label: 'the stock', layout: stockLayout },
      ...RUN_PILES.map((id) => ({ id, element: pileElement(id), row: 1, label: pileLabel(id), passive: true })),
    ],
    canPick(pile, index) {
      if (pile[0] !== 't') return false;
      const column = engine.state().columns[Number(pile.slice(1))];
      return column[index]?.faceUp && index >= column.length - engine.movableCount(Number(pile.slice(1)));
    },
    canDrop: (from, to) => from.pile[0] === 't' && to[0] === 't' && engine.canMove(Number(from.pile.slice(1)), Number(to.slice(1)), from.count),
    drop: (from, to) => performMove(Number(from.pile.slice(1)), Number(to.slice(1)), from.count),
    activate(pile, index) {
      if (pile === 's') { dealRow(); return; }
      if (pile[0] === 'r') { announce(`${plural(runs.length, 'run')} of 8 complete.`); return; }
      if (index < 0) announce('An empty column. Any card or run can go here.');
      else if (!engine.state().columns[Number(pile.slice(1))][index]?.faceUp) announce('That card is face down for now. Clear the cards above it to turn it over.');
      else announce('Only a run of one suit moves together. Move the cards on top of this one first.');
    },
    autoMove(pile, index) {
      if (pile[0] !== 't') return false;
      const from = Number(pile.slice(1));
      const column = engine.state().columns[from];
      const count = column.length - index;
      if (!column[index]?.faceUp || count > engine.movableCount(from)) return false;
      const to = bestTarget(from, count);
      return to === null ? false : performMove(from, to, count);
    },
    cardLabel(card, faceUp, pile, index) {
      if (pile === 's') {
        const left = engine.state().dealsLeft;
        return `Stock, ${plural(left, 'deal')} left. Deal a new row.`;
      }
      if (pile[0] === 'r') return `Completed run of ${SUITS[suitOf(card)]}`;
      if (!faceUp) return `Face-down card, ${pileLabel(pile)}`;
      return `${capital(cardName(card))}, ${pileLabel(pile)}, card ${index + 1}`;
    },
    announce,
    sound: playSound,
    messages: {
      pick: (from) => {
        const card = faceAt(from.pile, from.index);
        return `${capital(cardName(card))}${from.count > 1 ? ` and ${plural(from.count - 1, 'card')} on it` : ''}. Choose where it goes.`;
      },
      cancel: () => 'Put back.',
      illegal: (from, to) => {
        if (!to) return 'Back where it was.';
        const card = faceAt(from.pile, from.index);
        if (rankOf(card) === 12) return 'A king can only go to an empty column.';
        return `${capital(cardName(card))} needs ${rankOf(card) === 11 ? 'a king' : `a ${NAMES[rankOf(card) + 1]}`} or an empty column.`;
      },
    },
  });

  function faceAt(pile, index) {
    if (pile[0] !== 't') return null;
    const entry = engine.state().columns[Number(pile.slice(1))][index];
    return entry ? faces.get(entry.uid) : null;
  }
  /** Where a double-click sends a run: onto its own suit, then any higher card, then an empty column. */
  function bestTarget(from, count) {
    const state = engine.state();
    const lead = faces.get(state.columns[from][state.columns[from].length - count].uid);
    let best = null, bestScore = -1;
    state.columns.forEach((column, to) => {
      if (to === from || !engine.canMove(from, to, count)) return;
      const top = column.at(-1);
      const score = !top ? 1 : suitOf(faces.get(top.uid)) === suitOf(lead) ? 3 : 2;
      if (score > bestScore) { best = to; bestScore = score; }
    });
    return best;
  }

  /* ── state → piles ─────────────────────────────────────────────────────── */
  function readFaces(source) {
    const full = source.state({ reveal: true });
    const map = new Map();
    for (const column of full.columns) for (const entry of column) map.set(entry.uid, entry.card);
    for (const entry of full.stockCards) map.set(entry.uid, entry.card);
    return map;
  }
  function stockUids() { return engine.state({ reveal: true }).stockCards.map((entry) => entry.uid); }

  /**
   * Keeps `runs` in step with the core. Cards that are on neither the table
   * nor the stock have left in a run. New ones are grouped by the column the
   * run finished on, so the run can be shown there before it flies home.
   */
  function updateRuns(state, { kind = null, change = null, before = null } = {}) {
    const present = new Set(stockUids());
    for (const column of state.columns) for (const entry of column) present.add(entry.uid);
    const missing = new Set([...faces.keys()].filter((uid) => !present.has(uid)));
    runs = runs.filter((run) => run.uids.every((uid) => missing.has(uid)));
    const assigned = new Set(runs.flatMap((run) => run.uids));
    const fresh = [...missing].filter((uid) => !assigned.has(uid));
    if (!fresh.length) return [];
    const columns = change?.completed ?? [];
    const groups = new Map(columns.map((column) => [column, []]));
    const loose = [];
    for (const uid of fresh) {
      let column = null;
      if (kind === 'move' && columns.length === 1) column = columns[0];
      else if (kind === 'deal' && before) column = before.column.get(uid) ?? before.dealtTo.get(uid) ?? null;
      if (groups.has(column)) groups.get(column).push(uid); else loose.push(uid);
    }
    const made = [];
    for (const [column, uids] of groups) if (uids.length === 13) made.push({ column, uids });
    else loose.push(...uids);
    // Anything left (a loaded replay, an unusual layout): one card of each rank per suit.
    const bySuit = new Map();
    for (const uid of loose) {
      const suit = suitOf(faces.get(uid));
      if (!bySuit.has(suit)) bySuit.set(suit, []);
      bySuit.get(suit).push(uid);
    }
    for (const uids of bySuit.values()) {
      while (uids.length >= 13) {
        const run = [];
        for (let rank = 12; rank >= 0; rank--) {
          const at = uids.findIndex((uid) => rankOf(faces.get(uid)) === rank);
          if (at >= 0) run.push(...uids.splice(at, 1));
        }
        made.push({ column: null, uids: run });
      }
    }
    for (const run of made) {
      run.uids.sort((a, b) => rankOf(faces.get(b)) - rankOf(faces.get(a)));
      run.suit = suitOf(faces.get(run.uids[0]));
    }
    // Keep the core's order of completion.
    const ordered = [];
    for (const suit of state.completed.slice(runs.length)) {
      const at = made.findIndex((run) => run.suit === suit);
      if (at >= 0) ordered.push(...made.splice(at, 1));
    }
    ordered.push(...made);
    runs.push(...ordered);
    return ordered;
  }

  /** Card-table piles for a state. `hold` keeps fresh runs on their columns for one beat. */
  function piles(state, hold = []) {
    const result = {};
    state.columns.forEach((column, i) => {
      result[`t${i}`] = column.map((entry) => ({ key: entry.uid, card: entry.faceUp ? faces.get(entry.uid) : null, faceUp: entry.faceUp }));
    });
    for (const run of hold) {
      const column = result[`t${run.column}`];
      const under = column.at(-1);
      if (under && shown.get(under.key) === false) { under.faceUp = false; under.card = null; }
      column.push(...run.uids.map((uid) => ({ key: uid, card: faces.get(uid), faceUp: true })));
    }
    result.s = stockUids().map((uid) => ({ key: uid, card: null, faceUp: false }));
    RUN_PILES.forEach((id, i) => {
      const run = runs[i];
      result[id] = run && !hold.includes(run) ? run.uids.slice().reverse().map((uid) => ({ key: uid, card: faces.get(uid), faceUp: true })) : [];
    });
    return result;
  }
  function remember(view) {
    shown = new Map();
    for (const list of Object.values(view)) for (const item of list) shown.set(item.key, item.faceUp);
    return view;
  }
  const draw = (view, options = {}) => table.sync(remember(view), options);
  const dealOut = (view, options) => table.deal(remember(view), options);
  function snapshotBefore() {
    const state = engine.state();
    const column = new Map();
    state.columns.forEach((list, i) => list.forEach((entry) => column.set(entry.uid, i)));
    const stock = stockUids();
    const dealtTo = new Map();
    for (let i = 0; i < 10 && i < stock.length; i++) dealtTo.set(stock[stock.length - 1 - i], i);
    return { column, dealtTo, stock };
  }

  /* ── chrome ────────────────────────────────────────────────────────────── */
  function renderChrome(state = engine.state()) {
    if (destroyed) return;
    $('.sp-title').textContent = `Spider Solitaire — Deal #${state.seed}`;
    $('.sp-menu-mode').textContent = `${daily ? 'Daily · ' : ''}${SUIT_WORDS[state.suits]}`;
    for (const button of host.querySelectorAll('[data-action="undo"]')) button.disabled = !state.canUndo;
    for (const button of host.querySelectorAll('[data-action="deal-row"]')) button.disabled = state.stock === 0 || state.status === 'won';
    $('.sp-status-progress').textContent = `${state.completed.length} of 8 runs · ${state.dealsLeft ? plural(state.dealsLeft, 'deal') + ' left' : 'no deals left'}`;
    $('.sp-status-score').textContent = `Score: ${state.score.toLocaleString('en')}`;
    $('.sp-status-moves').textContent = `Moves: ${state.moves.toLocaleString('en')}`;
    $('.sp-done-area').setAttribute('aria-label', state.completed.length ? `${plural(state.completed.length, 'run')} of 8 complete` : 'No runs completed yet');
    $('.sp-done-area').classList.toggle('sp-done-some', state.completed.length > 0);
    const stock = pileElement('s');
    stock.classList.toggle('sp-stock-done', state.stock === 0);
  }

  function startClock() {
    if (!started && finishedSeconds === null) started = Date.now();
  }
  function resetClock() { started = null; finishedSeconds = null; }

  function hidePanels() {
    stuckEl.hidden = true;
    winEl.hidden = true;
  }

  /* ── actions ───────────────────────────────────────────────────────────── */
  function performMove(from, to, count) {
    const before = snapshotBefore();
    if (!engine.move(from, to, count)) { playSound('invalid'); return false; }
    startClock();
    playSound('card-place');
    after('move', before);
    return true;
  }

  function dealRow() {
    const state = engine.state();
    if (state.status === 'won') return;
    if (!state.canDeal) {
      playSound('invalid');
      if (state.stock === 0) {
        announce('No deals left. Every card is already on the table.');
        return;
      }
      const empty = state.columns.flatMap((column, i) => column.length ? [] : [i]);
      table.shake('s', state.stock - 1);
      markEmpty(empty);
      announce(empty.length === 1
        ? `Column ${empty[0] + 1} is empty. Put any card there first, then deal: every column needs a card before a new row.`
        : `Columns ${empty.slice(0, -1).map((i) => i + 1).join(', ')} and ${empty.at(-1) + 1} are empty. Every column needs a card before a new row can be dealt.`);
      return;
    }
    const before = snapshotBefore();
    engine.deal();
    startClock();
    const left = engine.state().dealsLeft;
    announce(left ? `A new row. ${plural(left, 'deal')} left.` : 'The last row is out. Every card is on the table now.');
    after('deal', before);
  }
  function markEmpty(columns) {
    clearTimeout(needsCardTimer);
    for (const id of COLUMNS) pileElement(id).classList.remove('sp-needs-card');
    if (!columns.length) return;
    void felt.offsetWidth;
    for (const i of columns) pileElement(`t${i}`).classList.add('sp-needs-card');
    needsCardTimer = setTimeout(() => { for (const id of COLUMNS) pileElement(id).classList.remove('sp-needs-card'); }, 1800);
  }

  /** After a move or a deal: animate it, then send any finished run home. */
  async function after(kind, before) {
    const mine = ++ticket;
    hidePanels();
    const state = engine.state();
    const change = engine.lastChange();
    const fresh = updateRuns(state, { kind, change, before });
    renderChrome(state);
    const dealt = kind === 'deal' ? before.stock.slice(-10).reverse() : null;
    const dealOptions = dealt ? { order: dealt, stagger: 42 } : {};
    const motion = !table.reducedMotion;
    const held = fresh.filter((run) => run.column !== null);
    if (held.length && motion) {
      await draw(piles(state, held), dealOptions);
      if (mine !== ticket || destroyed) return;
      await wait(140);
      if (mine !== ticket || destroyed) return;
      playSound('run-complete');
      announceRuns(fresh, state);
      await draw(piles(state), { order: held.flatMap((run) => run.uids.slice().reverse()), stagger: 26 });
    } else {
      const drawn = draw(piles(state), dealOptions);
      if (fresh.length) { playSound('run-complete'); announceRuns(fresh, state); }
      await drawn;
    }
    if (mine !== ticket || destroyed) return;
    settle(state);
  }
  function announceRuns(fresh, state) {
    const suit = SUITS[fresh[0].suit];
    announce(state.status === 'won'
      ? 'The eighth run is home.'
      : `A run of ${suit} is complete. ${plural(state.completed.length, 'run')} of 8 done, 100 points back.`);
  }
  function settle(state = engine.state()) {
    if (state.status === 'won') { celebrate(); return; }
    if (!state.hasMoves) showStuck(state);
  }
  function showStuck(state) {
    stuckEl.innerHTML = `<strong>No useful moves left.</strong><p>${state.canDeal ? 'Deal a new row, undo a few steps, or start again.' : 'Undo a few steps to try another way, or start a new game.'}</p><div class="sp-panel-actions">${state.canDeal ? '<button type="button" class="sp-classic-button sp-default-button" data-action="deal-row">Deal a row</button>' : ''}<button type="button" class="sp-classic-button${state.canDeal ? '' : ' sp-default-button'}" data-action="undo"${state.canUndo ? '' : ' disabled'}>Undo</button><button type="button" class="sp-classic-button" data-action="new">New game</button><button type="button" class="sp-text-button" data-action="dismiss">Keep looking</button></div>`;
    stuckEl.hidden = false;
    announce('No useful moves left. Undo, or start a new game.');
  }

  async function celebrate() {
    if (wonReported) return;
    wonReported = true;
    finishedSeconds = elapsed();
    const state = engine.state();
    const seconds = finishedSeconds;
    renderChrome(state);
    playSound('win');
    announce('All eight runs are home.');
    const mine = ticket;
    await table.cascade({ piles: RUN_PILES, limit: CASCADE_CARDS });
    if (destroyed || mine !== ticket || engine.state().status !== 'won') return;
    winEl.innerHTML = `<span class="sp-win-kicker">${daily ? 'Today’s deal, done.' : 'All eight runs are home.'}</span><strong>You won deal #${state.seed}.</strong><p>${SUIT_WORDS[state.suits]} · ${plural(state.moves, 'move')}${seconds ? ` · ${clock(seconds)}` : ''}<br>Final score ${state.score.toLocaleString('en')}</p><div class="sp-panel-actions sp-win-actions"><button type="button" class="sp-classic-button sp-default-button" data-action="new">Deal again</button><button type="button" class="sp-text-button" data-action="same">Replay this deal</button></div>`;
    winEl.hidden = false;
    winEl.querySelector('[data-action="new"]').focus({ preventScroll: true });
    announce(`You won deal #${state.seed} in ${plural(state.moves, 'move')}.`);
    onWin({ game: 'spider', seed: state.seed, deal: state.seed, suits: state.suits, score: state.score, moves: state.moves, daily, elapsedSeconds: seconds });
  }

  function dealOrder(state) {
    const order = [];
    for (let row = 0; row < 6; row++) state.columns.forEach((column) => { if (column[row]) order.push(column[row].uid); });
    return order;
  }
  async function newGame(deal = null, { keepDaily = false } = {}) {
    closeMenus();
    ticket += 1;
    const seed = deal ?? (daily ? dailyDeal() : randomDeal());
    if (deal !== null && !keepDaily) daily = false;
    const state = engine.newGame({ seed, suits: daily ? 1 : settings.suits });
    faces = readFaces(engine);
    runs = [];
    resetClock();
    wonReported = false;
    hidePanels();
    announce(daily ? 'Today’s deal, the same for everyone. The daily is always one suit.' : `A fresh deal, ${SUIT_WORDS[state.suits].toLowerCase()}. Good luck.`);
    renderChrome(state);
    playSound('new-game');
    await dealOut(piles(state), { from: 's', order: dealOrder(state), stagger: 18 });
  }
  function undo() {
    if (!engine.undo()) { announce('You are at the start of this deal.'); return; }
    ticket += 1;
    table.clearCascade();
    playSound('undo');
    hidePanels();
    if (wonReported) { wonReported = false; finishedSeconds = null; }
    const state = engine.state();
    updateRuns(state);
    renderChrome(state);
    announce(`One step back. Undo costs a point, like any move.`);
    draw(piles(state));
  }
  function hint() {
    const state = engine.state();
    if (state.status === 'won') return;
    const suggestion = engine.hint();
    if (!suggestion) { showStuck(state); return; }
    if (suggestion.type === 'deal') {
      table.showHint({ pile: 's', index: state.stock - 1, count: 1 }, null);
      announce('Nothing useful on the table. Deal a new row from the stock.');
      return;
    }
    const { from, to, count } = suggestion;
    const index = state.columns[from].length - count;
    table.showHint({ pile: `t${from}`, index, count }, `t${to}`);
    const lead = capital(cardName(faces.get(state.columns[from][index].uid)));
    const target = state.columns[to].at(-1);
    const where = target ? `the ${cardName(faces.get(target.uid))} in column ${to + 1}` : `empty column ${to + 1}`;
    announce(`Try ${lead}${count > 1 ? ` and ${plural(count - 1, 'card')} on it` : ''} onto ${where}. Press M again for another idea.`);
  }

  /* ── menus, dialogs and keys ───────────────────────────────────────────── */
  function closeMenus() {
    openMenu = null;
    for (const menu of host.querySelectorAll('.sp-dropdown')) menu.hidden = true;
    for (const trigger of host.querySelectorAll('.sp-menu-trigger')) { trigger.setAttribute('aria-expanded', 'false'); trigger.classList.remove('sp-menu-active'); }
  }
  function toggleMenu(name) {
    const next = openMenu === name ? null : name;
    closeMenus();
    if (!next) return;
    openMenu = next;
    const trigger = host.querySelector(`[data-action="menu-${name}"]`);
    trigger.setAttribute('aria-expanded', 'true');
    trigger.classList.add('sp-menu-active');
    const menu = host.querySelector(`[data-menu="${name}"]`);
    menu.hidden = false;
    menu.querySelector('button:not(:disabled)')?.focus();
  }
  function showDialog(name) {
    closeMenus();
    const dialog = host.querySelector(`[data-dialog="${name}"]`);
    if (name === 'deal') {
      dialog.querySelector('input').value = String(engine.state().seed);
      dialog.querySelector('[data-deal-error]').textContent = '';
    }
    if (name === 'options') {
      const form = dialog.querySelector('form');
      form.elements.suits.value = String(settings.suits);
      dialog.querySelector('[data-options-note]').textContent = daily
        ? 'Today’s daily is always one suit, so everyone plays the same cards. Your choice here applies to regular games.'
        : 'Changing the suits deals this number again with the new cards.';
    }
    dialog.showModal();
    if (name === 'deal') { const input = dialog.querySelector('input'); input.focus(); input.select(); }
  }
  function action(name) {
    if (name === 'menu-game' || name === 'menu-help') { toggleMenu(name.slice(5)); return; }
    if (name === 'cancel-dialog') { host.querySelector('dialog[open]')?.close(); return; }
    closeMenus();
    if (name === 'new') newGame();
    else if (name === 'same') newGame(engine.state().seed, { keepDaily: true });
    else if (['deal', 'options', 'help', 'about'].includes(name)) showDialog(name);
    else if (name === 'undo') undo();
    else if (name === 'hint') hint();
    else if (name === 'deal-row') dealRow();
    else if (name === 'dismiss') { stuckEl.hidden = true; announce('Take another look. Press M for a suggestion.'); }
  }
  function click(event) {
    const button = event.target.closest('[data-action]');
    if (button && host.contains(button)) { action(button.dataset.action); return; }
    if (openMenu && !event.target.closest('.sp-menu-wrap')) closeMenus();
  }
  function submit(event) {
    const form = event.target;
    event.preventDefault();
    if (form.dataset.form === 'deal') {
      const value = Number(form.elements.deal.value);
      if (!validDeal(value)) { form.querySelector('[data-deal-error]').textContent = 'Choose a whole number from 1 to 2,147,483,647.'; return; }
      form.closest('dialog').close();
      newGame(value);
    } else if (form.dataset.form === 'options') {
      const suits = Number(form.elements.suits.value);
      form.closest('dialog').close();
      if (!SUIT_CHOICES.includes(suits)) return;
      const changed = suits !== settings.suits;
      settings.suits = suits;
      writeJSON(SETTINGS_KEY, settings);
      if (daily) { announce(`Saved. Regular games will use ${SUIT_WORDS[suits].toLowerCase()}; today’s daily stays at one.`); return; }
      if (changed) newGame(engine.state().seed);
    }
  }
  function keydown(event) {
    if (destroyed || !host.isConnected || host.querySelector('dialog[open]') || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    if (openMenu && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const items = [...host.querySelectorAll(`[data-menu="${openMenu}"] button:not(:disabled)`)];
      const at = items.indexOf(document.activeElement);
      items[(at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      return;
    }
    const key = event.key.toLowerCase();
    if (event.key === 'F2') { event.preventDefault(); newGame(); }
    else if (event.key === 'F1') { event.preventDefault(); showDialog('help'); }
    else if ((event.ctrlKey || event.metaKey) && key === 'z' && !event.shiftKey) { event.preventDefault(); undo(); }
    else if (event.ctrlKey || event.metaKey || event.altKey) return;
    else if (key === 'm' || key === 'h') { event.preventDefault(); hint(); }
    else if (key === 'd') { event.preventDefault(); dealRow(); }
    else if (event.key === 'Escape' && openMenu) closeMenus();
  }
  host.addEventListener('click', click);
  host.addEventListener('submit', submit);
  document.addEventListener('keydown', keydown);

  faces = readFaces(engine);
  renderChrome();
  const initial = engine.state();
  announce(daily ? 'Today’s deal, the same for everyone. The daily is always one suit.' : 'Build each suit from king down to ace. Drag a card, or tap it and then its new place.');
  await dealOut(piles(initial), { from: 's', order: dealOrder(initial), stagger: 18 }).catch(() => {});

  return {
    destroy() {
      destroyed = true;
      ticket += 1;
      clearTimeout(needsCardTimer);
      document.removeEventListener('keydown', keydown);
      host.removeEventListener('click', click);
      host.removeEventListener('submit', submit);
      table.destroy();
      host.remove();
    },
    exportReplay() { return engine.replay(); },
    async loadReplay(replay) {
      const next = await loadSpiderReplay(replay);
      const fresh = await createSpider({ seed: replay.seed, suits: replay.suits });
      ticket += 1;
      engine = next;
      faces = readFaces(fresh);
      runs = [];
      daily = false;
      resetClock();
      wonReported = false;
      hidePanels();
      const state = engine.state();
      updateRuns(state);
      renderChrome(state);
      announce('Replay loaded. Pick up where this deal left off.');
      await draw(piles(state), { animate: false });
      settle(state);
    },
    newGame,
    setFidelity(value) {
      fidelity = value === 'pixels' ? 'pixels' : 'crisp';
      host.dataset.fidelity = fidelity;
      table.relayout();
    },
    table,
  };
}
