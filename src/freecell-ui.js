import { createFreecell, loadFreecellReplay } from './freecell-core.js';
import { createCardTable } from './card-table.js';
import { dailyDeal } from './shared.js';
import { SUITS, RANKS, PATHS, cardName } from './cards.js';

const locationName = ref => ref.type === 'column' ? `column ${ref.index + 1}` : ref.type === 'freecell' ? `free cell ${ref.index + 1}` : `${SUITS[ref.index]} foundation`;
const utcDeal = () => dailyDeal();
const KIND = { c: 'column', f: 'freecell', h: 'foundation' };
const toRef = pile => ({ type: KIND[pile[0]], index: Number(pile.slice(1)) });
const toPile = ref => `${ref.type[0] === 'c' ? 'c' : ref.type[0] === 'f' ? 'f' : 'h'}${ref.index}`;
const red = card => [1, 2].includes(Math.floor(card / 13));
const buildsOn = (card, below) => card % 13 + 1 === below % 13 && red(card) !== red(below);

function injectStyles() {
  if (document.querySelector('link[data-freecell-styles]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./freecell.css', import.meta.url).href;
  link.dataset.freecellStyles = '';
  document.head.append(link);
}

/* The window is drawn once; cards live in the shared card table and only move. */
function frame(daily) {
  const freecells = [0, 1, 2, 3].map(index => `<div class="fc-slot fc-freecell-slot" data-fc-pile="f${index}"><button type="button" class="fc-empty-slot" data-ct-target data-loc="freecell" data-index="${index}" aria-label="Empty free cell ${index + 1}"><span class="fc-slot-outline"></span></button></div>`).join('');
  const foundations = [0, 1, 2, 3].map(index => `<div class="fc-slot fc-foundation-slot" data-fc-pile="h${index}"><button type="button" class="fc-foundation" data-ct-target data-loc="foundation" data-index="${index}" aria-label="${SUITS[index]} foundation, empty"><svg class="fc-foundation-suit" viewBox="0 0 24 24" aria-hidden="true"><path d="${PATHS[index]}" fill="currentColor"/></svg></button></div>`).join('');
  const columns = [0, 1, 2, 3, 4, 5, 6, 7].map(index => `<div class="fc-column" data-fc-pile="c${index}" role="group" aria-label="Column ${index + 1}"><button type="button" class="fc-column-target" data-ct-target data-loc="column" data-index="${index}" aria-label="Empty column ${index + 1}"></button></div>`).join('');
  return `<section class="fc-window" aria-label="FreeCell game"><div class="fc-titlebar"><span class="fc-title-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="2" y="3" width="13" height="18" rx="1" fill="#fff" stroke="#142b64"/><rect x="9" y="2" width="13" height="18" rx="1" fill="#fff" stroke="#142b64"/><path d="m15.5 5 4 6-4 6-4-6Z" fill="#b4232b"/></svg></span><span class="fc-title-text">FreeCell</span><span class="fc-title-controls" aria-hidden="true"><i></i><i></i><i>×</i></span></div>`
    + `<div class="fc-menubar"><div class="fc-menu-wrap"><button type="button" class="fc-menu-trigger" data-action="menu-game" aria-expanded="false" aria-haspopup="menu"><u>G</u>ame</button><div class="fc-dropdown" role="menu" data-menu="game" hidden><button role="menuitem" type="button" data-action="new">New game <span>F2</span></button><button role="menuitem" type="button" data-action="deal">Select deal…</button><div class="fc-menu-separator"></div><button role="menuitem" type="button" data-action="undo">Undo <span>Ctrl+Z</span></button><button role="menuitem" type="button" data-action="hint">Hint <span>H</span></button><button role="menuitem" type="button" data-action="auto">Auto finish</button></div></div>`
    + `<div class="fc-menu-wrap"><button type="button" class="fc-menu-trigger" data-action="menu-help" aria-expanded="false" aria-haspopup="menu"><u>H</u>elp</button><div class="fc-dropdown" role="menu" data-menu="help" hidden><button role="menuitem" type="button" data-action="help">How to play <span>F1</span></button><button role="menuitem" type="button" data-action="about">About this version</button></div></div><span class="fc-menu-deal">${daily ? 'Daily deal' : 'Classic rules'}</span></div>`
    + `<div class="fc-felt"><div class="fc-cell-labels"><span>FREE CELLS</span><span>FOUNDATIONS</span></div><div class="fc-top-row"><div class="fc-freecells">${freecells}</div><div class="fc-foundations">${foundations}</div></div><div class="fc-tableau">${columns}</div><div class="fc-win-panel" role="status" hidden></div></div>`
    + `<div class="fc-statusbar"><span class="fc-status-left">0 moves</span><span class="fc-status-deal">Deal #1</span></div></section>`
    + `<div class="fc-below-game"><div class="fc-quick-actions"><button type="button" data-action="undo">Undo</button><span aria-hidden="true">·</span><button type="button" data-action="hint">Hint</button><span aria-hidden="true">·</span><button type="button" data-action="auto">Auto finish</button><span aria-hidden="true">·</span><button type="button" data-action="deal">Choose a deal</button></div><p class="fc-message" role="status" aria-live="polite"></p></div>`
    + `<dialog class="fc-dialog" data-dialog="deal" aria-labelledby="fc-deal-title"><form method="dialog" class="fc-dialog-form"><h2 id="fc-deal-title">Select a deal</h2><p>Enter a deal number from 1 to 32,000.</p><label for="fc-deal-input">Deal number</label><input id="fc-deal-input" name="deal" type="number" min="1" max="32000" step="1" required><p class="fc-dialog-error" data-deal-error aria-live="polite"></p><div class="fc-dialog-actions"><button class="fc-classic-button" type="button" data-action="cancel-dialog">Cancel</button><button class="fc-classic-button fc-default-button" type="submit">Deal</button></div></form></dialog>`
    + `<dialog class="fc-dialog" data-dialog="help" aria-labelledby="fc-help-title"><div class="fc-dialog-form"><h2 id="fc-help-title">How to play FreeCell</h2><p>Build each foundation from ace to king, following suit. Stack columns in descending order, alternating red and black.</p><p>Drag a card or an ordered run, or select it and then its destination. Double-click a card to send it home, or to a free cell. Empty free cells and columns let you move longer runs.</p><p>With the keyboard, Tab or the arrow keys move between piles, Enter picks up and puts down, and Escape puts cards back. <strong>F2</strong> deals a new game. <strong>Ctrl+Z</strong> undoes. <strong>H</strong> suggests a move. Auto finish sends only safe cards to the foundations.</p><div class="fc-dialog-actions"><button type="button" class="fc-classic-button fc-default-button" data-action="cancel-dialog">Got it</button></div></div></dialog>`
    + `<dialog class="fc-dialog" data-dialog="about" aria-labelledby="fc-about-title"><div class="fc-dialog-form"><h2 id="fc-about-title">A familiar game, rebuilt</h2><p>This is our playable implementation of FreeCell with classic numbered deals. Its code and behavior have not yet been verified against the original Windows binary.</p><p>All card artwork is drawn for this project.</p><div class="fc-dialog-actions"><button type="button" class="fc-classic-button fc-default-button" data-action="cancel-dialog">Close</button></div></div></dialog>`;
}

export async function mountFreecell(container, { daily = false, onWin = () => {}, sound = () => {} } = {}) {
  injectStyles();
  const requestedDeal = Number(new URLSearchParams(location.search).get('deal'));
  let engine = await createFreecell({ deal: daily ? utcDeal() : Number.isInteger(requestedDeal) && requestedDeal >= 1 && requestedDeal <= 2147483647 ? requestedDeal : 1 });
  let openMenu = null;
  let message = 'Move all the cards to the foundations, ace to king.';
  let fidelity = 'crisp';
  let started = Date.now();
  let wonReported = false;
  let destroyed = false;
  let autofinishTimer = null;
  const host = document.createElement('div');
  host.className = 'freecell-root';
  host.dataset.fidelity = fidelity;
  host.innerHTML = frame(daily);
  container.replaceChildren(host);
  const felt = host.querySelector('.fc-felt');

  function getState() { return typeof engine.state === 'function' ? engine.state() : engine.getState(); }
  function playSound(name) { try { sound(name); } catch { /* Sound is optional. */ } }
  function cancelAuto() { if (autofinishTimer) clearTimeout(autofinishTimer); autofinishTimer = null; }
  const rowOffset = () => parseFloat(getComputedStyle(host).getPropertyValue('--fc-row-offset')) || 23;

  const table = createCardTable(felt, {
    cardClass: 'fc-card',
    piles: [
      ...[0, 1, 2, 3].map(index => ({ id: `f${index}`, element: host.querySelector(`[data-fc-pile="f${index}"]`), row: 0, label: `free cell ${index + 1}` })),
      ...[0, 1, 2, 3].map(index => ({ id: `h${index}`, element: host.querySelector(`[data-fc-pile="h${index}"]`), row: 0, label: `the ${SUITS[index]} foundation` })),
      ...[0, 1, 2, 3, 4, 5, 6, 7].map(index => ({ id: `c${index}`, element: host.querySelector(`[data-fc-pile="c${index}"]`), row: 1, label: `column ${index + 1}`, fan: 'down', grow: true, faceUpOffset: rowOffset })),
    ],
    canPick(pile, index) {
      const state = getState();
      if (pile[0] === 'f') return true;
      if (pile[0] !== 'c') return false;
      const cards = state.columns[Number(pile.slice(1))];
      for (let row = index + 1; row < cards.length; row++) if (!buildsOn(cards[row], cards[row - 1])) return false;
      return true;
    },
    canDrop: (from, to) => engine.canMove(from.pile, to, from.count),
    drop: (from, to) => applyMove({ from: toRef(from.pile), count: from.count }, toRef(to)),
    activate(pile, index) {
      if (getState().status === 'won') return;
      if (pile[0] === 'c' && index >= 0) announce('Only an ordered run, descending in alternating colours, moves together.');
      else announce(pile[0] === 'h' ? 'Foundations build up from the ace, one suit each.' : 'Select a card first, then its destination.');
    },
    autoMove(pile, index) {
      const state = getState();
      const ref = toRef(pile);
      const cards = ref.type === 'column' ? state.columns[ref.index] : ref.type === 'freecell' ? [state.freecells[ref.index]] : [];
      if (ref.type === 'foundation' || index !== cards.length - 1) return false;
      const card = cards[index];
      const home = { type: 'foundation', index: Math.floor(card / 13) };
      if (engine.canMove(ref, home, 1)) return applyMove({ from: ref, count: 1 }, home);
      if (ref.type === 'freecell') return false;
      const free = state.freecells.findIndex(cell => cell === null);
      return free >= 0 ? applyMove({ from: ref, count: 1 }, { type: 'freecell', index: free }) : false;
    },
    cardLabel: (id, faceUp, pile, index) => `${RANKS[id % 13]}, ${cardName(id)}, ${locationName(toRef(pile))}${pile[0] === 'c' ? `, card ${index + 1}` : ''}`,
    decorate(el, info) {
      const ref = toRef(info.pile);
      el.dataset.loc = ref.type;
      el.dataset.index = String(ref.index);
      if (ref.type === 'column') el.dataset.cardIndex = String(info.index); else delete el.dataset.cardIndex;
      el.dataset.focusKey = `${ref.type}-${ref.index}-${ref.type === 'column' ? info.index : 'top'}`;
    },
    announce,
    sound: playSound,
    messages: {
      pick: from => {
        const id = cardAt(from.pile, from.index);
        return `Select a destination for ${cardName(id)}${from.count > 1 ? ` and the ${from.count - 1} card${from.count === 2 ? '' : 's'} below it` : ''}.`;
      },
      cancel: () => 'Selection cleared.',
      illegal: () => 'That move needs a different destination or more empty cells.',
    },
  });

  function cardAt(pile, index) {
    const state = getState();
    const ref = toRef(pile);
    if (ref.type === 'column') return state.columns[ref.index][index];
    if (ref.type === 'freecell') return state.freecells[ref.index];
    return ref.index * 13 + index;
  }
  function pileState(state) {
    const piles = {};
    state.freecells.forEach((id, index) => { piles[`f${index}`] = id === null ? [] : [id]; });
    state.foundations.forEach((rank, index) => { piles[`h${index}`] = Array.from({ length: rank }, (_, r) => index * 13 + r); });
    state.columns.forEach((cards, index) => { piles[`c${index}`] = cards; });
    return piles;
  }
  function dealOrder(state) {
    const order = [];
    for (let row = 0; row < 7; row++) state.columns.forEach(cards => { if (cards[row] !== undefined) order.push(cards[row]); });
    return order;
  }
  function dealPoint() {
    const width = felt.clientWidth, height = felt.clientHeight;
    const card = host.querySelector('.fc-column')?.clientWidth ?? 60;
    return { x: width / 2 - card / 2, y: height + 8 };
  }

  function renderChrome(state = getState()) {
    if (destroyed) return;
    const elapsed = Math.floor((Date.now() - started) / 1000);
    host.dataset.fidelity = fidelity;
    host.querySelector('.fc-title-text').textContent = `FreeCell — Deal #${state.deal}`;
    host.querySelector('.fc-menu-deal').textContent = daily ? 'Daily deal' : 'Classic rules';
    for (const button of host.querySelectorAll('[data-action="undo"]')) button.disabled = !state.moves;
    host.querySelector('.fc-status-left').textContent = `${state.moves} move${state.moves === 1 ? '' : 's'}`;
    host.querySelector('.fc-status-deal').textContent = `Deal #${state.deal}`;
    state.foundations.forEach((rank, index) => host.querySelector(`.fc-foundation[data-index="${index}"]`)
      .setAttribute('aria-label', `${SUITS[index]} foundation, ${rank ? cardName(index * 13 + rank - 1) : 'empty'}`));
    const panel = host.querySelector('.fc-win-panel');
    if (state.status === 'won') {
      panel.innerHTML = `<span class="fc-win-kicker">A clean table.</span><strong>You won deal #${state.deal}.</strong><p>${state.moves} moves · ${elapsed}s${daily ? ' · Daily challenge complete' : ''}</p><button type="button" class="fc-classic-button" data-action="new">${daily ? 'Play this deal again' : 'Play another deal'}</button>`;
      panel.hidden = false;
    } else panel.hidden = true;
    host.querySelector('.fc-message').textContent = message;
    if (state.status === 'won' && !wonReported) {
      wonReported = true;
      playSound('win');
      onWin({ game: 'freecell', deal: state.deal, seed: state.deal, moves: state.moves, daily, elapsedSeconds: elapsed });
    }
  }
  function render(animate = true) {
    if (destroyed) return Promise.resolve();
    const state = getState();
    const motion = table.sync(pileState(state), { animate });
    renderChrome(state);
    return motion;
  }

  function announce(text) { message = text; host.querySelector('.fc-message').textContent = text; }
  function applyMove(selection, to) {
    cancelAuto();
    const ok = engine.move(selection.from, to, selection.count);
    if (ok) {
      message = 'A little more room to think.';
      playSound(to.type === 'foundation' ? 'foundation' : 'card-place');
    } else {
      message = 'That move needs a different destination or more empty cells.';
      playSound('invalid');
    }
    render();
    return ok;
  }
  async function newGame(deal = null) {
    cancelAuto();
    const number = deal ?? (daily ? utcDeal() : Math.floor(Math.random() * 32000) + 1);
    if (deal !== null) daily = false;
    if (typeof engine.newGame === 'function') await engine.newGame(number);
    else engine = await createFreecell({ deal: number });
    table.select(null);
    closeMenus();
    started = Date.now();
    wonReported = false;
    message = daily ? 'The same daily deal for everyone. Take your time.' : 'A fresh deal. Every card is in view.';
    const state = getState();
    renderChrome(state);
    await table.deal(pileState(state), { from: dealPoint(), order: dealOrder(state), stagger: 14 });
  }
  function showDialog(name) {
    closeMenus();
    const dialog = host.querySelector(`[data-dialog="${name}"]`);
    if (name === 'deal') {
      dialog.querySelector('input').value = String(getState().deal);
      dialog.querySelector('[data-deal-error]').textContent = '';
    }
    dialog.showModal();
    if (name === 'deal') { const input = dialog.querySelector('input'); input.focus(); input.select(); }
  }
  function autoFinish() {
    cancelAuto();
    table.select(null);
    closeMenus();
    let moved = 0;
    const step = () => {
      if (destroyed) return;
      if (engine.autoMove()) {
        moved += 1;
        message = 'Moving safe cards to the foundations…';
        playSound('foundation');
        render();
        autofinishTimer = setTimeout(step, fidelity === 'pixels' ? 90 : 150);
      } else {
        autofinishTimer = null;
        announce(getState().status === 'won' ? 'Every card found its place.' : moved ? 'Safe cards are home. Your next move.' : 'No safe foundation moves yet. Free up a card first.');
      }
    };
    step();
  }
  function closeMenus() {
    openMenu = null;
    for (const menu of host.querySelectorAll('.fc-dropdown')) menu.hidden = true;
    for (const trigger of host.querySelectorAll('.fc-menu-trigger')) { trigger.setAttribute('aria-expanded', 'false'); trigger.classList.remove('fc-menu-active'); }
  }
  function action(name) {
    if (name === 'menu-game' || name === 'menu-help') {
      const next = openMenu === name.slice(5) ? null : name.slice(5);
      closeMenus();
      if (next) {
        openMenu = next;
        const trigger = host.querySelector(`[data-action="${name}"]`);
        trigger.setAttribute('aria-expanded', 'true');
        trigger.classList.add('fc-menu-active');
        const menu = host.querySelector(`[data-menu="${next}"]`);
        menu.hidden = false;
        menu.querySelector('button:not(:disabled)')?.focus();
      }
      return;
    }
    if (name === 'cancel-dialog') { host.querySelector('dialog[open]')?.close(); return; }
    if (name === 'new') { newGame(); return; }
    if (name === 'deal' || name === 'help' || name === 'about') { showDialog(name); return; }
    cancelAuto();
    closeMenus();
    if (name === 'undo') {
      if (engine.undo()) { table.select(null); wonReported = false; message = 'One move back. A fresh possibility.'; playSound('undo'); }
      else message = 'You are at the beginning of this deal.';
      render();
    } else if (name === 'hint') {
      const hint = engine.hint();
      if (hint) {
        const from = toPile(hint.from);
        const length = hint.from.type === 'column' ? getState().columns[hint.from.index].length : 1;
        const index = hint.from.type === 'column' ? length - (hint.count ?? 1) : 0;
        const id = cardAt(from, index);
        table.select(null);
        table.showHint({ pile: from, index, count: hint.count ?? 1 }, toPile(hint.to));
        announce(`Try moving ${cardName(id)}${hint.count > 1 ? ' and its group' : ''} to ${locationName(hint.to)}.`);
      } else { table.select(null); announce('No legal moves are available. Undo a move to try another route.'); }
    } else if (name === 'auto') autoFinish();
  }
  function click(event) {
    const button = event.target.closest('[data-action]');
    if (button && host.contains(button)) { action(button.dataset.action); return; }
    if (openMenu && !event.target.closest('.fc-menu-wrap')) closeMenus();
  }
  function keydown(event) {
    if (destroyed || host.querySelector('dialog[open]') || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && openMenu) {
      event.preventDefault();
      const items = Array.from(host.querySelectorAll(`[data-menu="${openMenu}"] button:not(:disabled)`));
      const current = items.indexOf(document.activeElement);
      items[(current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    }
    else if (event.key === 'F2') { event.preventDefault(); newGame(); }
    else if (event.key === 'F1') { event.preventDefault(); showDialog('help'); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); action('undo'); }
    else if (event.key.toLowerCase() === 'h' && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); action('hint'); }
    else if (event.key === 'Escape') { table.select(null); closeMenus(); announce('Selection cleared.'); }
  }
  function submit(event) {
    if (!event.target.matches('.fc-dialog-form')) return;
    event.preventDefault();
    const value = Number(event.target.elements.deal.value);
    if (!Number.isInteger(value) || value < 1 || value > 32000) {
      event.target.querySelector('[data-deal-error]').textContent = 'Choose a whole number from 1 to 32,000.';
      return;
    }
    event.target.closest('dialog').close();
    newGame(value);
  }
  host.addEventListener('click', click);
  host.addEventListener('submit', submit);
  document.addEventListener('keydown', keydown);
  renderChrome();
  const first = getState();
  await table.deal(pileState(first), { from: dealPoint(), order: dealOrder(first), stagger: 14 });

  return {
    destroy() { destroyed = true; cancelAuto(); table.destroy(); document.removeEventListener('keydown', keydown); host.removeEventListener('click', click); host.removeEventListener('submit', submit); host.remove(); },
    exportReplay() { return typeof engine.replay === 'function' ? engine.replay() : engine.exportReplay(); },
    async loadReplay(replay) { cancelAuto(); engine = await loadFreecellReplay(replay); daily = false; table.select(null); closeMenus(); started = Date.now(); wonReported = false; message = 'Replay loaded. Pick up where this deal left off.'; render(false); },
    newGame,
    setFidelity(value) { fidelity = value === 'pixels' ? 'pixels' : 'crisp'; host.dataset.fidelity = fidelity; table.relayout(); },
    table,
  };
}
