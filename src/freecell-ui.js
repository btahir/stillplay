import { createFreecell, loadFreecellReplay } from './freecell-core.js';
import { dailyDeal } from './shared.js';
import { SUITS, RANKS, PATHS, cardName, cardSvg } from './cards.js';

const same = (a, b) => a && b && a.type === b.type && a.index === b.index;
const locationName = ref => ref.type === 'column' ? `column ${ref.index + 1}` : ref.type === 'freecell' ? `free cell ${ref.index + 1}` : `${SUITS[ref.index]} foundation`;
const utcDeal = () => dailyDeal();

function injectStyles() {
  if (document.querySelector('link[data-freecell-styles]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./freecell.css', import.meta.url).href;
  link.dataset.freecellStyles = '';
  document.head.append(link);
}

export async function mountFreecell(container, { daily = false, onWin = () => {}, sound = () => {} } = {}) {
  injectStyles();
  const requestedDeal = Number(new URLSearchParams(location.search).get('deal'));
  let engine = await createFreecell({ deal: daily ? utcDeal() : Number.isInteger(requestedDeal) && requestedDeal >= 1 && requestedDeal <= 2147483647 ? requestedDeal : 1 });
  let selection = null;
  let openMenu = null;
  let message = 'Move all the cards to the foundations, ace to king.';
  let fidelity = 'crisp';
  let started = Date.now();
  let wonReported = false;
  let destroyed = false;
  let autofinishTimer = null;
  const host = document.createElement('div');
  host.className = 'freecell-root';
  container.replaceChildren(host);

  function getState() { return typeof engine.state === 'function' ? engine.state() : engine.getState(); }
  function playSound(name) { try { sound(name); } catch { /* Sound is optional. */ } }
  function cancelAuto() { if (autofinishTimer) clearTimeout(autofinishTimer); autofinishTimer = null; }
  function selectedCard(state) {
    if (!selection) return null;
    return selection.from.type === 'freecell' ? state.freecells[selection.from.index] : state.columns[selection.from.index].at(-selection.count);
  }
  function cardButton(id, ref, cardIndex = null, selected = false, top = null) {
    const key = `${ref.type}-${ref.index}-${cardIndex ?? 'top'}`;
    return `<button type="button" class="fc-card${selected ? ' fc-card-selected' : ''}" data-loc="${ref.type}" data-index="${ref.index}"${cardIndex !== null ? ` data-card-index="${cardIndex}"` : ''} data-focus-key="${key}" aria-label="${RANKS[id % 13]}, ${cardName(id)}, ${locationName(ref)}${cardIndex !== null ? `, card ${cardIndex + 1}` : ''}" aria-pressed="${selected}"${top !== null ? ` style="--fc-row:${top}"` : ''}>${cardSvg(id)}</button>`;
  }
  function render() {
    if (destroyed) return;
    const state = getState();
    const activeKey = host.contains(document.activeElement) ? document.activeElement?.dataset?.focusKey : null;
    const activeAction = host.contains(document.activeElement) ? document.activeElement?.dataset?.action : null;
    const elapsed = Math.floor((Date.now() - started) / 1000);
    const selectedId = selectedCard(state);
    const topSlots = state.freecells.map((id, index) => `<div class="fc-slot fc-freecell-slot">${id === null ? `<button type="button" class="fc-empty-slot" data-loc="freecell" data-index="${index}" data-focus-key="freecell-${index}-empty" aria-label="Empty free cell ${index + 1}"><span class="fc-slot-outline"></span></button>` : cardButton(id, { type: 'freecell', index }, null, same(selection?.from, { type: 'freecell', index }))}</div>`).join('');
    const foundations = state.foundations.map((rank, index) => `<div class="fc-slot fc-foundation-slot"><button type="button" class="fc-foundation${rank ? ' fc-foundation-filled' : ''}" data-loc="foundation" data-index="${index}" data-focus-key="foundation-${index}" aria-label="${rank ? `${RANKS[rank - 1]}, ` : ''}${SUITS[index]} foundation, ${rank ? cardName(index * 13 + rank - 1) : 'empty'}">${rank ? cardSvg(index * 13 + rank - 1) : `<svg class="fc-foundation-suit" viewBox="0 0 24 24" aria-hidden="true"><path d="${PATHS[index]}" fill="currentColor"/></svg>`}</button></div>`).join('');
    const columns = state.columns.map((cards, index) => `<div class="fc-column" style="--fc-rows:${Math.max(0, cards.length - 1)}" role="group" aria-label="Column ${index + 1}"><button type="button" class="fc-column-target" data-loc="column" data-index="${index}" data-focus-key="column-${index}-empty" aria-label="${cards.length ? `Move selected cards to column ${index + 1}` : `Empty column ${index + 1}`}"${cards.length ? ' tabindex="-1"' : ''}></button>${cards.map((id, row) => cardButton(id, { type: 'column', index }, row, same(selection?.from, { type: 'column', index }) && row >= cards.length - selection.count, row)).join('')}</div>`).join('');
    host.dataset.fidelity = fidelity;
    host.innerHTML = `<section class="fc-window" aria-label="FreeCell game"><div class="fc-titlebar"><span class="fc-title-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="2" y="3" width="13" height="18" rx="1" fill="#fff" stroke="#142b64"/><rect x="9" y="2" width="13" height="18" rx="1" fill="#fff" stroke="#142b64"/><path d="m15.5 5 4 6-4 6-4-6Z" fill="#b4232b"/></svg></span><span>FreeCell — Deal #${state.deal}</span><span class="fc-title-controls" aria-hidden="true"><i></i><i></i><i>×</i></span></div><div class="fc-menubar"><div class="fc-menu-wrap"><button type="button" class="fc-menu-trigger${openMenu === 'game' ? ' fc-menu-active' : ''}" data-action="menu-game" aria-expanded="${openMenu === 'game'}" aria-haspopup="menu"><u>G</u>ame</button>${openMenu === 'game' ? `<div class="fc-dropdown" role="menu"><button role="menuitem" type="button" data-action="new">New game <span>F2</span></button><button role="menuitem" type="button" data-action="deal">Select deal…</button><div class="fc-menu-separator"></div><button role="menuitem" type="button" data-action="undo"${state.moves ? '' : ' disabled'}>Undo <span>Ctrl+Z</span></button><button role="menuitem" type="button" data-action="hint">Hint <span>H</span></button><button role="menuitem" type="button" data-action="auto">Auto finish</button></div>` : ''}</div><div class="fc-menu-wrap"><button type="button" class="fc-menu-trigger${openMenu === 'help' ? ' fc-menu-active' : ''}" data-action="menu-help" aria-expanded="${openMenu === 'help'}" aria-haspopup="menu"><u>H</u>elp</button>${openMenu === 'help' ? `<div class="fc-dropdown" role="menu"><button role="menuitem" type="button" data-action="help">How to play <span>F1</span></button><button role="menuitem" type="button" data-action="about">About this version</button></div>` : ''}</div><span class="fc-menu-deal">${daily ? 'Daily deal' : 'Classic rules'}</span></div><div class="fc-felt"><div class="fc-cell-labels"><span>FREE CELLS</span><span>FOUNDATIONS</span></div><div class="fc-top-row"><div class="fc-freecells">${topSlots}</div><div class="fc-foundations">${foundations}</div></div><div class="fc-tableau">${columns}</div>${state.status === 'won' ? `<div class="fc-win-panel" role="status"><span class="fc-win-kicker">A clean table.</span><strong>You won deal #${state.deal}.</strong><p>${state.moves} moves · ${elapsed}s${daily ? ' · Daily challenge complete' : ''}</p><button type="button" class="fc-classic-button" data-action="new">${daily ? 'Play this deal again' : 'Play another deal'}</button></div>` : ''}</div><div class="fc-statusbar"><span>${selectedId !== null ? `Selected ${cardName(selectedId)}${selection.count > 1 ? ` + ${selection.count - 1}` : ''}` : `${state.moves} move${state.moves === 1 ? '' : 's'}`}</span><span>Deal #${state.deal}</span></div></section><div class="fc-below-game"><div class="fc-quick-actions"><button type="button" data-action="undo"${state.moves ? '' : ' disabled'}>Undo</button><span aria-hidden="true">·</span><button type="button" data-action="hint">Hint</button><span aria-hidden="true">·</span><button type="button" data-action="auto">Auto finish</button><span aria-hidden="true">·</span><button type="button" data-action="deal">Choose a deal</button></div><p class="fc-message" role="status" aria-live="polite">${message}</p></div><dialog class="fc-dialog" data-dialog="deal" aria-labelledby="fc-deal-title"><form method="dialog" class="fc-dialog-form"><h2 id="fc-deal-title">Select a deal</h2><p>Enter a deal number from 1 to 32,000.</p><label for="fc-deal-input">Deal number</label><input id="fc-deal-input" name="deal" type="number" min="1" max="32000" step="1" value="${state.deal}" required><p class="fc-dialog-error" data-deal-error aria-live="polite"></p><div class="fc-dialog-actions"><button class="fc-classic-button" type="button" data-action="cancel-dialog">Cancel</button><button class="fc-classic-button fc-default-button" type="submit">Deal</button></div></form></dialog><dialog class="fc-dialog" data-dialog="help" aria-labelledby="fc-help-title"><div class="fc-dialog-form"><h2 id="fc-help-title">How to play FreeCell</h2><p>Build each foundation from ace to king, following suit. Stack columns in descending order, alternating red and black.</p><p>Select a card, then its destination. Select any exposed card in a column to move its ordered group. Empty free cells and columns give you room to move longer groups.</p><p><strong>F2</strong> deals a new game. <strong>Ctrl+Z</strong> undoes. <strong>H</strong> suggests a move. Auto finish sends only safe cards to the foundations.</p><div class="fc-dialog-actions"><button type="button" class="fc-classic-button fc-default-button" data-action="cancel-dialog">Got it</button></div></div></dialog><dialog class="fc-dialog" data-dialog="about" aria-labelledby="fc-about-title"><div class="fc-dialog-form"><h2 id="fc-about-title">A familiar game, rebuilt</h2><p>This is our playable implementation of FreeCell with classic numbered deals. Its code and behavior have not yet been verified against the original Windows binary.</p><p>All card artwork is drawn for this project.</p><div class="fc-dialog-actions"><button type="button" class="fc-classic-button fc-default-button" data-action="cancel-dialog">Close</button></div></div></dialog>`;
    if (activeKey) host.querySelector(`[data-focus-key="${activeKey}"]`)?.focus({ preventScroll: true });
    else if (activeAction) host.querySelector(`[data-action="${activeAction}"]`)?.focus({ preventScroll: true });
    if (state.status === 'won' && !wonReported) {
      wonReported = true;
      playSound('win');
      onWin({ game: 'freecell', deal: state.deal, seed: state.deal, moves: state.moves, daily, elapsedSeconds: elapsed });
    }
  }

  function announce(text) { message = text; render(); }
  function applyMove(to) {
    if (!selection) return false;
    const ok = engine.move(selection.from, to, selection.count);
    if (ok) {
      selection = null;
      message = 'A little more room to think.';
      playSound(to.type === 'foundation' ? 'foundation' : 'card-place');
    } else {
      message = 'That move needs a different destination or more empty cells.';
      playSound('invalid');
    }
    render();
    return ok;
  }
  function selectLocation(button) {
    cancelAuto();
    openMenu = null;
    const state = getState();
    if (state.status === 'won') return;
    const ref = { type: button.dataset.loc, index: Number(button.dataset.index) };
    if (ref.type === 'foundation') { if (selection) applyMove(ref); return; }
    if (selection && !same(selection.from, ref)) { applyMove(ref); return; }
    const cardIndex = button.dataset.cardIndex !== undefined ? Number(button.dataset.cardIndex) : null;
    const count = ref.type === 'column' ? state.columns[ref.index].length - (cardIndex ?? state.columns[ref.index].length - 1) : 1;
    const id = ref.type === 'column' ? state.columns[ref.index][cardIndex ?? state.columns[ref.index].length - 1] : state.freecells[ref.index];
    if (id === null || id === undefined) { selection = null; render(); return; }
    if (selection && same(selection.from, ref) && selection.count === count) {
      selection = null;
      message = 'Selection cleared.';
    } else {
      selection = { from: ref, count };
      message = `Select a destination for ${cardName(id)}${count > 1 ? ` and the ${count - 1} card${count === 2 ? '' : 's'} below it` : ''}.`;
      playSound('card-pick');
    }
    render();
  }
  async function newGame(deal = null) {
    cancelAuto();
    const number = deal ?? (daily ? utcDeal() : Math.floor(Math.random() * 32000) + 1);
    if (deal !== null) daily = false;
    if (typeof engine.newGame === 'function') await engine.newGame(number);
    else engine = await createFreecell({ deal: number });
    selection = null;
    openMenu = null;
    started = Date.now();
    wonReported = false;
    message = daily ? 'The same daily deal for everyone. Take your time.' : 'A fresh deal. Every card is in view.';
    render();
  }
  function showDialog(name) {
    openMenu = null;
    render();
    const dialog = host.querySelector(`[data-dialog="${name}"]`);
    dialog.showModal();
    if (name === 'deal') { const input = dialog.querySelector('input'); input.focus(); input.select(); }
  }
  function autoFinish() {
    cancelAuto();
    selection = null;
    openMenu = null;
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
  function action(name) {
    if (name === 'menu-game' || name === 'menu-help') {
      openMenu = openMenu === name.slice(5) ? null : name.slice(5);
      render();
      if (openMenu) host.querySelector('.fc-dropdown button:not(:disabled)')?.focus();
      return;
    }
    if (name === 'cancel-dialog') { host.querySelector('dialog[open]')?.close(); return; }
    if (name === 'new') { newGame(); return; }
    if (name === 'deal' || name === 'help' || name === 'about') { showDialog(name); return; }
    cancelAuto();
    openMenu = null;
    if (name === 'undo') {
      if (engine.undo()) { selection = null; wonReported = false; message = 'One move back. A fresh possibility.'; playSound('undo'); }
      else message = 'You are at the beginning of this deal.';
      render();
    } else if (name === 'hint') {
      const hint = engine.hint();
      if (hint) {
        selection = { from: hint.from, count: hint.count ?? 1 };
        const id = selectedCard(getState());
        message = `Try moving ${cardName(id)}${selection.count > 1 ? ` and its group` : ''} to ${locationName(hint.to)}.`;
      } else { selection = null; message = 'No legal moves are available. Undo a move to try another route.'; }
      render();
    } else if (name === 'auto') autoFinish();
  }
  function click(event) {
    const button = event.target.closest('button');
    if (!button || !host.contains(button)) return;
    if (button.dataset.action) action(button.dataset.action);
    else if (button.dataset.loc) selectLocation(button);
  }
  function keydown(event) {
    if (destroyed || host.querySelector('dialog[open]') || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && openMenu) {
      event.preventDefault();
      const items = Array.from(host.querySelectorAll('.fc-dropdown button:not(:disabled)'));
      const current = items.indexOf(document.activeElement);
      items[(current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    }
    else if (event.key === 'F2') { event.preventDefault(); newGame(); }
    else if (event.key === 'F1') { event.preventDefault(); showDialog('help'); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); action('undo'); }
    else if (event.key.toLowerCase() === 'h' && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); action('hint'); }
    else if (event.key === 'Escape') { selection = null; openMenu = null; message = 'Selection cleared.'; render(); }
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
  render();

  return {
    destroy() { destroyed = true; cancelAuto(); document.removeEventListener('keydown', keydown); host.removeEventListener('click', click); host.removeEventListener('submit', submit); host.remove(); },
    exportReplay() { return typeof engine.replay === 'function' ? engine.replay() : engine.exportReplay(); },
    async loadReplay(replay) { cancelAuto(); engine = await loadFreecellReplay(replay); daily = false; selection = null; openMenu = null; started = Date.now(); wonReported = false; message = 'Replay loaded. Pick up where this deal left off.'; render(); },
    newGame,
    setFidelity(value) { fidelity = value === 'pixels' ? 'pixels' : 'crisp'; host.dataset.fidelity = fidelity; },
  };
}
