import { createSolitaire, loadSolitaireReplay } from './solitaire-core.js';
import { createCardTable } from './card-table.js';
import { dailyDeal } from './shared.js';
import { cardName } from './cards.js';

const SETTINGS_KEY = 'stillplay-solitaire-options';
const BANK_KEY = 'stillplay-solitaire-bank';
const DEFAULTS = { draw: 1, scoring: 'standard', timed: true, cumulative: false, autoFlip: true, autoPlay: false };
const FOUNDATIONS = ['h0', 'h1', 'h2', 'h3'];
const COLUMNS = ['t0', 't1', 't2', 't3', 't4', 't5', 't6'];

const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const money = (value) => `${value < 0 ? '−' : ''}$${Math.abs(value)}`;
const validDeal = (value) => Number.isInteger(value) && value >= 1 && value <= 2147483647;

function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage is optional. */ }
}
function loadSettings() {
  const saved = readJSON(SETTINGS_KEY, {});
  const settings = { ...DEFAULTS };
  if (saved.draw === 1 || saved.draw === 3) settings.draw = saved.draw;
  if (['standard', 'vegas', 'none'].includes(saved.scoring)) settings.scoring = saved.scoring;
  for (const key of ['timed', 'cumulative', 'autoFlip', 'autoPlay']) if (typeof saved[key] === 'boolean') settings[key] = saved[key];
  return settings;
}
function randomDeal() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] % 1000000 + 1;
}

/** The keyboard and mouse sheet the site shows for this game (the shell reads it from the handle). */
const SHORTCUTS = [['Click or drag', 'Move a card'], ['Double-click · Shift + Enter', 'Send a card home'], ['D', 'Turn the stock'], ['Ctrl / ⌘ + Z', 'Undo'], ['H', 'Hint'], ['F', 'Finish when every card is face up'], ['Arrow keys · Enter', 'Pick up and put down'], ['F2', 'New deal'], ['F1', 'How to play']];

function injectStyles() {
  if (document.querySelector('link[data-solitaire-styles]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./solitaire.css', import.meta.url).href;
  link.dataset.solitaireStyles = '';
  document.head.append(link);
}

const pileLabel = (id) => id === 's' ? 'the stock' : id === 'w' ? 'the waste' : id[0] === 'h' ? `foundation ${Number(id[1]) + 1}` : `column ${Number(id[1]) + 1}`;

const ICONS = {
  window: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="2.5" width="12" height="17" rx="1.2" fill="#2c6249" stroke="#fff" stroke-width=".8"/><rect x="9" y="4.5" width="12" height="17" rx="1.2" fill="#fff" stroke="#142b64"/><path d="M15 9.2c-1.2-1.6-3.6-.4-2.6 1.6.6 1.1 2.6 2.6 2.6 2.6s2-1.5 2.6-2.6c1-2-1.4-3.2-2.6-1.6Z" fill="#b4232b"/></svg>',
  recycle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.5 12a6.5 6.5 0 1 1-2-4.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M17.3 3.6v4.3H13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  done: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m7.6 16.4 8.8-8.8" stroke="currentColor" stroke-width="1.6"/></svg>',
};

function markup(daily, chrome) {
  const slot = (label, extra = '') => `<button type="button" class="sol-slot" data-ct-target aria-label="${label}">${extra}</button>`;
  return `<section class="sol-window" aria-label="Solitaire game">
  <div class="sol-titlebar"><span class="sol-title-icon">${ICONS.window}</span><span class="sol-title">Solitaire</span><span class="sol-title-controls" aria-hidden="true"><i></i><i></i><i>×</i></span></div>
  <div class="sol-menubar">
    <div class="sol-menu-wrap"><button type="button" class="sol-menu-trigger" data-action="menu-game" aria-expanded="false" aria-haspopup="menu"><u>G</u>ame</button>
      <div class="sol-dropdown" role="menu" data-menu="game" hidden>
        <button role="menuitem" type="button" data-action="new">Deal <span>F2</span></button>
        <button role="menuitem" type="button" data-action="deal">Choose a deal…</button>
        <div class="sol-menu-separator" role="separator"></div>
        <button role="menuitem" type="button" data-action="undo">Undo <span>Ctrl+Z</span></button>
        <button role="menuitem" type="button" data-action="hint">Hint <span>H</span></button>
        <button role="menuitem" type="button" data-action="finish">Finish for me <span>F</span></button>
        <div class="sol-menu-separator" role="separator"></div>
        <button role="menuitem" type="button" data-action="options">Options…</button>
      </div></div>
    <div class="sol-menu-wrap"><button type="button" class="sol-menu-trigger" data-action="menu-help" aria-expanded="false" aria-haspopup="menu"><u>H</u>elp</button>
      <div class="sol-dropdown" role="menu" data-menu="help" hidden>
        <button role="menuitem" type="button" data-action="help">How to play <span>F1</span></button>
        <button role="menuitem" type="button" data-action="about">About this version</button>
      </div></div>
    <span class="sol-menu-mode">${daily ? 'Daily deal' : ''}</span>
  </div>
  <div class="sol-felt">
    <div class="sol-row sol-top">
      <div class="sol-pile sol-stock" data-pile-id="s">${slot('Stock is empty', `<span class="sol-stock-icon">${ICONS.recycle}</span>`)}</div>
      <div class="sol-pile sol-waste" data-pile-id="w">${slot('Waste, empty')}</div>
      <div class="sol-spacer" aria-hidden="true"></div>
      ${FOUNDATIONS.map((id, i) => `<div class="sol-pile sol-foundation" data-pile-id="${id}">${slot(`Foundation ${i + 1}, empty`, '<span class="sol-ace" aria-hidden="true">A</span>')}</div>`).join('')}
    </div>
    <div class="sol-row sol-tableau">
      ${COLUMNS.map((id, i) => `<div class="sol-pile sol-column" data-pile-id="${id}">${slot(`Column ${i + 1}, empty. Kings only.`)}</div>`).join('')}
    </div>
    <div class="sol-win" role="status" hidden></div>
  </div>
  <div class="sol-statusbar"><span class="sol-status-moves">0 moves</span><span class="sol-status-score">Score: 0</span><span class="sol-status-time">Time: 0:00</span></div>
</section>
<div class="sol-below">
  <div class="sol-quick-actions">
    ${chrome ? '' : `<button type="button" data-action="undo">Undo</button><span aria-hidden="true">·</span>
    <button type="button" data-action="hint">Hint</button><span aria-hidden="true">·</span>`}
    <button type="button" data-action="finish" class="sol-finish" hidden>Finish for me</button><span aria-hidden="true" class="sol-finish-dot" hidden>·</span>
    <button type="button" data-action="options">Options</button><span aria-hidden="true">·</span>
    <button type="button" data-action="deal">Choose a deal</button>
  </div>
  <p class="sol-message" role="status" aria-live="polite"></p>
</div>
<dialog class="sol-dialog" data-dialog="deal" aria-labelledby="sol-deal-title"><form method="dialog" class="sol-dialog-form" data-form="deal">
  <h2 id="sol-deal-title">Choose a deal</h2><p>Every number is its own shuffle. Share one with a friend and you both get the same cards.</p>
  <label for="sol-deal-input">Deal number</label><input id="sol-deal-input" name="deal" type="number" min="1" max="2147483647" step="1" required>
  <p class="sol-dialog-error" data-deal-error aria-live="polite"></p>
  <div class="sol-dialog-actions"><button class="sol-classic-button" type="button" data-action="cancel-dialog">Cancel</button><button class="sol-classic-button sol-default-button" type="submit">Deal</button></div>
</form></dialog>
<dialog class="sol-dialog" data-dialog="options" aria-labelledby="sol-options-title"><form method="dialog" class="sol-dialog-form" data-form="options">
  <h2 id="sol-options-title">Options</h2>
  <div class="sol-option-groups">
    <fieldset><legend>Draw</legend>
      <label><input type="radio" name="draw" value="1"> Draw one</label>
      <label><input type="radio" name="draw" value="3"> Draw three</label></fieldset>
    <fieldset><legend>Scoring</legend>
      <label><input type="radio" name="scoring" value="standard"> Standard</label>
      <label><input type="radio" name="scoring" value="vegas"> Vegas</label>
      <label><input type="radio" name="scoring" value="none"> None</label></fieldset>
  </div>
  <label class="sol-check"><input type="checkbox" name="timed"> Timed game</label>
  <label class="sol-check"><input type="checkbox" name="cumulative"> Keep a running Vegas total</label>
  <label class="sol-check"><input type="checkbox" name="autoFlip"> Turn cards over automatically</label>
  <label class="sol-check"><input type="checkbox" name="autoPlay"> Send safe cards home automatically</label>
  <p class="sol-dialog-note">Changing draw, scoring or turning deals these cards again.</p>
  <div class="sol-dialog-actions"><button class="sol-classic-button" type="button" data-action="cancel-dialog">Cancel</button><button class="sol-classic-button sol-default-button" type="submit">OK</button></div>
</form></dialog>
<dialog class="sol-dialog" data-dialog="help" aria-labelledby="sol-help-title"><div class="sol-dialog-form">
  <h2 id="sol-help-title">How to play Solitaire</h2>
  <p>Build four foundations, one per suit, from ace up to king. On the table, stack cards downward in alternating colours. Only a king can start an empty column.</p>
  <p>Drag a card or a run of cards, or tap it and then tap where it should go. Double-click or double-tap a card to send it to a foundation. Click the stock to turn more cards.</p>
  <p><strong>Keyboard:</strong> Tab or the arrow keys move between piles. Enter or Space picks cards up and puts them down. Shift+Enter sends a card home. Escape puts it back. <strong>D</strong> draws, <strong>H</strong> hints, <strong>F</strong> finishes when every card is face up, <strong>F2</strong> deals and <strong>Ctrl+Z</strong> undoes.</p>
  <div class="sol-dialog-actions"><button type="button" class="sol-classic-button sol-default-button" data-action="cancel-dialog">Got it</button></div>
</div></dialog>
<dialog class="sol-dialog" data-dialog="about" aria-labelledby="sol-about-title"><div class="sol-dialog-form">
  <h2 id="sol-about-title">A familiar game, rebuilt</h2>
  <p>This is our own Klondike, written in C and compiled to WebAssembly, with the scoring people remember: standard, Vegas and timed. It has not been compared with the original Windows program.</p>
  <p>The cards, the table and the bouncing ending are all drawn for this project.</p>
  <div class="sol-dialog-actions"><button type="button" class="sol-classic-button sol-default-button" data-action="cancel-dialog">Close</button></div>
</div></dialog>`;
}

export async function mountSolitaire(container, { daily = false, onWin = () => {}, onStart = () => {}, sound = () => {}, chrome = false } = {}) {
  injectStyles();
  const params = new URLSearchParams(location.search);
  const settings = loadSettings();
  const requestedDraw = Number(params.get('draw'));
  if (!daily && (requestedDraw === 1 || requestedDraw === 3)) settings.draw = requestedDraw;
  const requestedDeal = Number(params.get('deal'));
  const firstDeal = daily ? dailyDeal() : validDeal(requestedDeal) ? requestedDeal : randomDeal();
  let engine = await createSolitaire({ seed: firstDeal, draw: settings.draw, scoring: settings.scoring, autoFlip: settings.autoFlip });

  let fidelity = 'crisp';
  let destroyed = false;
  let started = null;
  let finishedSeconds = null;
  let ticker = null;
  let wonReported = false;
  let openMenu = null;
  let running = null; // timer for finish/auto-play sequences
  let bankStart = settings.cumulative && settings.scoring === 'vegas' ? readJSON(BANK_KEY, 0) : 0;
  let message = daily ? 'Today’s deal, the same for everyone. Take your time.' : 'Build each suit from ace to king. Drag a card, or tap it and then its new place.';

  const host = document.createElement('div');
  host.className = 'solitaire-root';
  host.dataset.fidelity = fidelity;
  host.innerHTML = markup(daily, chrome);
  container.replaceChildren(host);
  const $ = (selector) => host.querySelector(selector);
  const felt = $('.sol-felt');
  const messageEl = $('.sol-message');
  const winEl = $('.sol-win');

  function playSound(name) { try { sound(name); } catch { /* Sound is optional. */ } }
  function announce(text) { message = text; messageEl.textContent = text; }
  const elapsed = () => finishedSeconds ?? (started ? Math.floor((Date.now() - started) / 1000) : 0);

  const pileElement = (id) => host.querySelector(`[data-pile-id="${id}"]`);
  const table = createCardTable(felt, {
    cardClass: 'sol-card',
    piles: [
      { id: 's', element: pileElement('s'), row: 0, label: 'the stock', depth: true },
      { id: 'w', element: pileElement('w'), row: 0, label: 'the waste', fan: 'right', fanOffset: 0.2 },
      ...FOUNDATIONS.map((id) => ({ id, element: pileElement(id), row: 0, label: pileLabel(id) })),
      ...COLUMNS.map((id) => ({
        id, element: pileElement(id), row: 1, label: pileLabel(id), fan: 'down', compress: true,
        faceDownOffset: (height) => Math.max(4, height * 0.1), faceUpOffset: (height) => Math.max(12, height * 0.27),
      })),
    ],
    canPick(pile, index) {
      const state = engine.state();
      if (pile[0] === 't') return index >= state.hidden[Number(pile[1])];
      if (pile === 'w') return index === state.waste.length - 1;
      if (pile[0] === 'h') return index === state.foundations[Number(pile[1])].rank - 1;
      return false;
    },
    canDrop: (from, to) => engine.canMove(from.pile, to, from.count),
    drop: (from, to) => performMove(from.pile, to, from.count),
    activate(pile, index) {
      if (pile === 's') { turnStock(); return; }
      const state = engine.state();
      if (pile[0] === 't' && engine.state().tableau[Number(pile[1])].length && !state.autoFlip) {
        const column = Number(pile[1]);
        if (engine.flip(column)) { startClock(); after(); return; }
      }
      if (index < 0) announce(pile[0] === 't' ? 'An empty column waits for a king.' : pile[0] === 'h' ? 'Foundations start with an ace.' : 'The waste is empty. Click the stock to turn cards.');
      else announce('That card is face down for now.');
    },
    autoMove(pile, index) {
      const state = engine.state();
      const top = pile === 'w' ? state.waste.length - 1 : pile[0] === 't' ? state.tableau[Number(pile[1])].length - 1 : -2;
      if (index !== top) return false;
      const slot = FOUNDATIONS.find((id) => engine.canMove(pile, id, 1));
      return slot ? performMove(pile, slot, 1) : false;
    },
    cardLabel(card, faceUp, pile, index) {
      if (pile === 's') return `Stock, ${plural(engine.state().stock.length, 'card')}. Draw ${engine.state().draw === 3 ? 'three' : 'one'}.`;
      if (!faceUp) return `Face-down card, ${pileLabel(pile)}`;
      return `${capital(cardName(card))}, ${pileLabel(pile)}${pile[0] === 't' ? `, card ${index + 1}` : ''}`;
    },
    announce,
    sound: playSound,
    messages: {
      pick: (from) => {
        const card = cardAt(from.pile, from.index);
        return `${capital(cardName(card))}${from.count > 1 ? ` and ${plural(from.count - 1, 'card')} on it` : ''}. Choose where it goes.`;
      },
      cancel: () => 'Put back.',
      illegal: (from, to) => to ? `${capital(cardName(cardAt(from.pile, from.index)))} can’t go on ${pileLabel(to)}.` : 'Back where it was.',
    },
  });

  function cardAt(pile, index) {
    const state = engine.state();
    if (pile === 'w') return state.waste[index];
    if (pile === 's') return state.stock[index];
    if (pile[0] === 'h') { const slot = state.foundations[Number(pile[1])]; return slot.suit * 13 + index; }
    return state.tableau[Number(pile[1])][index];
  }

  function pileState(state) {
    const piles = {
      s: state.stock.map((card) => ({ card, faceUp: false })),
      w: { cards: state.waste, fan: Math.max(1, state.wasteFan) },
    };
    state.foundations.forEach((slot, i) => { piles[`h${i}`] = Array.from({ length: slot.rank }, (_, rank) => slot.suit * 13 + rank); });
    state.tableau.forEach((column, i) => { piles[`t${i}`] = column.map((card, row) => ({ card, faceUp: row >= state.hidden[i] })); });
    return piles;
  }
  function dealOrder(state) {
    const order = [];
    for (let row = 0; row < 7; row++) for (let column = row; column < 7; column++) order.push(state.tableau[column][row]);
    return order;
  }

  function score(state) {
    if (state.scoring === 'none') return null;
    if (state.scoring === 'vegas') return bankStart + state.score;
    return settings.timed ? engine.timedScore(elapsed()) : state.score;
  }
  function renderChrome(state = engine.state()) {
    if (destroyed) return;
    $('.sol-title').textContent = `Solitaire — Deal #${state.seed}`;
    $('.sol-menu-mode').textContent = `${daily ? 'Daily · ' : ''}Draw ${state.draw === 3 ? 'three' : 'one'} · ${capital(state.scoring)}`;
    for (const button of host.querySelectorAll('[data-action="undo"]')) button.disabled = state.moves === 0;
    for (const button of host.querySelectorAll('[data-action="finish"]')) button.disabled = !state.canAutoFinish;
    $('.sol-quick-actions .sol-finish').hidden = !state.canAutoFinish;
    $('.sol-finish-dot').hidden = !state.canAutoFinish;
    $('.sol-status-moves').textContent = plural(state.moves, 'move');
    const value = score(state);
    const scoreEl = $('.sol-status-score');
    scoreEl.hidden = value === null;
    if (value !== null) scoreEl.textContent = `Score: ${state.scoring === 'vegas' ? money(value) : value.toLocaleString('en')}`;
    const timeEl = $('.sol-status-time');
    timeEl.hidden = !settings.timed;
    timeEl.textContent = `Time: ${clock(elapsed())}`;
    const stock = pileElement('s');
    const exhausted = !state.stock.length && !state.canRecycle;
    stock.classList.toggle('sol-stock-done', exhausted);
    stock.querySelector('.sol-stock-icon').innerHTML = exhausted ? ICONS.done : ICONS.recycle;
    stock.querySelector('.sol-slot').setAttribute('aria-label', exhausted ? 'Stock is finished for this game' : state.waste.length ? 'Stock is empty. Turn the waste over.' : 'Stock is empty');
    if (state.scoring === 'vegas' && settings.cumulative) writeJSON(BANK_KEY, bankStart + state.score);
  }
  function update(animate = true) {
    const state = engine.state();
    renderChrome(state);
    return table.sync(pileState(state), { animate });
  }

  function startClock() {
    if (started || finishedSeconds !== null) return;
    started = Date.now();
    ticker = setInterval(() => { if (!destroyed) renderChrome(); }, 1000);
  }
  function stopClock() {
    finishedSeconds = elapsed();
    clearInterval(ticker);
    ticker = null;
  }
  function resetClock() {
    clearInterval(ticker);
    ticker = null;
    started = null;
    finishedSeconds = null;
  }
  function stopRunning() { if (running) clearTimeout(running); running = null; }

  function performMove(from, to, count) {
    stopRunning();
    const before = engine.state();
    const length = from === 'w' ? before.waste.length : from[0] === 't' ? before.tableau[Number(from[1])].length : before.foundations[Number(from[1])].rank;
    const card = cardAt(from, length - count);
    if (!engine.move(from, to, count)) { playSound('invalid'); return false; }
    startClock();
    playSound(to[0] === 'h' ? 'foundation' : 'card-place');
    // Replace the "choose where it goes" prompt left by the first click of a double-click.
    announce(to[0] === 'h' ? `${capital(cardName(card))} goes home.` : `${capital(cardName(card))}${count > 1 ? ` and ${plural(count - 1, 'card')} on it` : ''} to ${pileLabel(to)}.`);
    after();
    return true;
  }
  function turnStock() {
    stopRunning();
    const turned = engine.stock();
    if (!turned) {
      table.shake('s', -1);
      playSound('invalid');
      announce('The stock is finished for this game.');
      return;
    }
    startClock();
    if (turned === 'recycle') {
      playSound('stock-recycle');
      const state = engine.state();
      announce(state.maxPasses ? `Pass ${state.pass} of ${state.maxPasses}.` : 'The waste goes back to the stock.');
    }
    after();
  }
  function after() {
    const state = engine.state();
    const sync = update();
    if (state.status === 'won') { celebrate(sync); return; }
    if (state.canAutoFinish) announce('Every card is face up. Press F or choose Finish for me.');
    if (settings.autoPlay) running = setTimeout(autoPlayStep, 170);
  }
  function autoPlayStep() {
    running = null;
    if (destroyed || !engine.autoMove()) return;
    playSound('foundation');
    after();
  }
  function finish() {
    stopRunning();
    if (!engine.state().canAutoFinish) { announce('Finish for me works once every card is face up.'); return; }
    startClock();
    announce('Sending every card home…');
    const step = () => {
      running = null;
      if (destroyed) return;
      const done = engine.finishStep();
      if (!done) return;
      if (done === 'move') playSound('foundation');
      if (done === 'recycle') playSound('stock-recycle');
      const state = engine.state();
      if (state.status === 'won') { celebrate(update()); return; }
      if (table.reducedMotion) step();
      else { update(); running = setTimeout(step, done === 'move' ? 95 : 140); }
    };
    step();
  }
  async function celebrate(syncPromise) {
    if (wonReported) return;
    wonReported = true;
    stopClock();
    const state = engine.state();
    const seconds = finishedSeconds;
    const bonus = state.scoring === 'standard' && settings.timed ? engine.timeBonus(seconds) : 0;
    const final = score(state);
    renderChrome(state);
    playSound('win');
    announce('Every card is home.');
    await syncPromise;
    if (destroyed || engine.state().status !== 'won') return;
    await table.cascade({ piles: FOUNDATIONS });
    if (destroyed || engine.state().status !== 'won') return;
    const summary = {
      game: 'solitaire', seed: state.seed, deal: state.seed, daily, elapsedSeconds: seconds, moves: state.moves, score: final, bonus,
      draw: state.draw, scoring: state.scoring, variant: `draw ${state.draw === 3 ? 'three' : 'one'}`, params: { deal: state.seed, draw: state.draw },
    };
    announce(`You won deal #${state.seed} in ${plural(state.moves, 'move')}.`);
    // In the site shell the win dialog is the one result screen.
    if (chrome) { onWin(summary); return; }
    const scoreLine = final === null ? '' : state.scoring === 'vegas' ? ` · ${money(final)}` : ` · ${final.toLocaleString('en')} points`;
    winEl.innerHTML = `<span class="sol-win-kicker">${daily ? 'Today’s deal, done.' : 'Every card is home.'}</span><strong>You won deal #${state.seed}.</strong><p>${plural(state.moves, 'move')} · ${clock(seconds)}${scoreLine}${bonus ? `<br>Includes a time bonus of ${bonus.toLocaleString('en')}.` : ''}</p><div class="sol-win-actions"><button type="button" class="sol-classic-button sol-default-button" data-action="new">Deal again</button><button type="button" class="sol-text-button" data-action="same">Replay this deal</button></div>`;
    winEl.hidden = false;
    winEl.querySelector('[data-action="new"]').focus({ preventScroll: true });
    onWin(summary);
  }

  async function newGame(deal = null, { keepDaily = false } = {}) {
    stopRunning();
    closeMenus();
    const seed = deal ?? (daily ? dailyDeal() : randomDeal());
    if (deal !== null && !keepDaily) daily = false;
    if (settings.scoring === 'vegas' && settings.cumulative) bankStart = readJSON(BANK_KEY, 0);
    else bankStart = 0;
    const state = engine.newGame(seed, { draw: settings.draw, scoring: settings.scoring, autoFlip: settings.autoFlip });
    resetClock();
    wonReported = false;
    winEl.hidden = true;
    announce(daily ? 'Today’s deal, the same for everyone. Take your time.' : 'A fresh deal. Good luck.');
    renderChrome(state);
    onStart();
    playSound('card-shuffle');
    await table.deal(pileState(state), { from: 's', order: dealOrder(state), stagger: 26 });
  }
  /** Take back one move. Returns whether there was a move to take back. */
  function undo() {
    stopRunning();
    if (!engine.undo()) { announce('You are at the start of this deal.'); return false; }
    playSound('undo');
    if (wonReported) { wonReported = false; finishedSeconds = null; winEl.hidden = true; if (started) ticker = setInterval(() => renderChrome(), 1000); }
    announce('One step back.');
    update();
    return true;
  }
  function hint() {
    const suggestion = engine.hint();
    const state = engine.state();
    if (!suggestion) { announce('No moves left to suggest. Undo, or try a new deal.'); return false; }
    if (suggestion.action === 'draw' || suggestion.action === 'recycle') {
      table.showHint({ pile: 's', index: Math.max(0, state.stock.length - 1), count: 1 }, null);
      announce(suggestion.action === 'draw' ? 'Try turning the stock.' : 'Try turning the waste back over.');
      return true;
    }
    if (suggestion.action === 'flip') {
      const id = `t${suggestion.column}`;
      table.showHint({ pile: id, index: state.tableau[suggestion.column].length - 1, count: 1 }, null);
      announce(`Turn over the top card of ${pileLabel(id)}.`);
      return true;
    }
    const from = suggestion.from.type === 'waste' ? 'w' : `${suggestion.from.type[0] === 't' ? 't' : 'h'}${suggestion.from.index}`;
    const to = `${suggestion.to.type === 'tableau' ? 't' : 'h'}${suggestion.to.index}`;
    const length = from === 'w' ? state.waste.length : from[0] === 't' ? state.tableau[suggestion.from.index].length : state.foundations[suggestion.from.index].rank;
    const index = length - suggestion.count;
    table.showHint({ pile: from, index, count: suggestion.count }, to);
    announce(`Try ${cardName(cardAt(from, index))}${suggestion.count > 1 ? ' and the cards on it' : ''} on ${to[0] === 'h' ? 'a foundation' : pileLabel(to)}.`);
    return true;
  }

  /* Menus, dialogs and keys. */
  function closeMenus() {
    openMenu = null;
    for (const menu of host.querySelectorAll('.sol-dropdown')) menu.hidden = true;
    for (const trigger of host.querySelectorAll('.sol-menu-trigger')) { trigger.setAttribute('aria-expanded', 'false'); trigger.classList.remove('sol-menu-active'); }
  }
  function toggleMenu(name) {
    const next = openMenu === name ? null : name;
    closeMenus();
    if (!next) return;
    openMenu = next;
    const trigger = host.querySelector(`[data-action="menu-${name}"]`);
    trigger.setAttribute('aria-expanded', 'true');
    trigger.classList.add('sol-menu-active');
    const menu = host.querySelector(`[data-menu="${name}"]`);
    menu.hidden = false;
    menu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
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
      form.elements.draw.value = String(settings.draw);
      form.elements.scoring.value = settings.scoring;
      for (const key of ['timed', 'cumulative', 'autoFlip', 'autoPlay']) form.elements[key].checked = settings[key];
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
    else if (name === 'deal' || name === 'options' || name === 'help' || name === 'about') showDialog(name);
    else if (name === 'undo') undo();
    else if (name === 'hint') hint();
    else if (name === 'finish') finish();
  }
  function click(event) {
    const button = event.target.closest('[data-action]');
    if (button && host.contains(button)) { action(button.dataset.action); return; }
    if (openMenu && !event.target.closest('.sol-menu-wrap')) closeMenus();
  }
  function submit(event) {
    const form = event.target;
    if (form.dataset.form === 'deal') {
      event.preventDefault();
      const value = Number(form.elements.deal.value);
      if (!validDeal(value)) { form.querySelector('[data-deal-error]').textContent = 'Choose a whole number from 1 to 2,147,483,647.'; return; }
      form.closest('dialog').close();
      newGame(value);
    } else if (form.dataset.form === 'options') {
      event.preventDefault();
      const next = {
        draw: Number(form.elements.draw.value) === 3 ? 3 : 1,
        scoring: form.elements.scoring.value,
        timed: form.elements.timed.checked,
        cumulative: form.elements.cumulative.checked,
        autoFlip: form.elements.autoFlip.checked,
        autoPlay: form.elements.autoPlay.checked,
      };
      const redeal = next.draw !== settings.draw || next.scoring !== settings.scoring || next.autoFlip !== settings.autoFlip;
      if (!next.cumulative) writeJSON(BANK_KEY, 0);
      Object.assign(settings, next);
      writeJSON(SETTINGS_KEY, settings);
      form.closest('dialog').close();
      if (redeal) newGame(engine.state().seed, { keepDaily: true });
      else { bankStart = settings.cumulative && settings.scoring === 'vegas' ? bankStart : 0; renderChrome(); }
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
    else if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key === 'z') { event.preventDefault(); undo(); }
    else if (event.ctrlKey || event.metaKey || event.altKey) return;
    else if (key === 'h') { event.preventDefault(); hint(); }
    else if (key === 'f' && engine.state().canAutoFinish) { event.preventDefault(); finish(); }
    else if (key === 'd') { event.preventDefault(); turnStock(); }
    else if (event.key === 'Escape' && openMenu) { closeMenus(); }
  }
  host.addEventListener('click', click);
  host.addEventListener('submit', submit);
  document.addEventListener('keydown', keydown);

  renderChrome();
  onStart();
  const initial = engine.state();
  await table.deal(pileState(initial), { from: 's', order: dealOrder(initial), stagger: 26 }).catch(() => {});
  if (!destroyed) announce(message);

  return {
    destroy() {
      destroyed = true;
      stopRunning();
      clearInterval(ticker);
      document.removeEventListener('keydown', keydown);
      host.removeEventListener('click', click);
      host.removeEventListener('submit', submit);
      table.destroy();
      host.remove();
    },
    exportReplay() { return engine.replay(); },
    async loadReplay(replay) {
      stopRunning();
      engine = await loadSolitaireReplay(replay);
      const state = engine.state();
      Object.assign(settings, { draw: state.draw, scoring: state.scoring, autoFlip: state.autoFlip });
      daily = false;
      resetClock();
      wonReported = false;
      winEl.hidden = true;
      bankStart = 0;
      announce(chrome ? '' : 'Replay loaded. Pick up where this deal left off.');
      await update(false);
      if (state.status === 'won') celebrate(Promise.resolve());
    },
    newGame,
    undo,
    canUndo: () => engine.state().moves > 0,
    hint,
    state: () => engine.state(),
    shortcuts: SHORTCUTS,
    setFidelity(value) {
      fidelity = value === 'pixels' ? 'pixels' : 'crisp';
      host.dataset.fidelity = fidelity;
      table.relayout();
    },
    table,
  };
}
