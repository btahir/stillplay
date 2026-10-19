/**
 * The game stage: a game mounted from the registry, wrapped in the shell's chrome
 * (new game, undo, hint, daily, sound, drawing mode, stats, focus mode, shortcuts).
 *
 * Mount contract (see src/games.js): the shell passes
 *   { daily, onWin, onStart, onLose, sound, showDialog, showToast, chrome: true }
 * and uses whatever the handle offers: newGame, undo, canUndo, hint, setFidelity, loadReplay,
 * exportReplay, state, shortcuts. Missing methods simply hide their buttons.
 */
import * as audio from '../../audio.js';
import { icon } from '../ui/icons.js';
import { escape, readStore, writeStore } from '../ui/dom.js';
import { showDialog } from '../ui/dialog.js';
import { showToast } from '../ui/toast.js';
import { recordStart, recordWin } from './stats.js';

const FIDELITY_KEY = 'stillplay-fidelity';
let activeStage = null;

function button(command, iconName, label, { tip = label, pressed, hidden = false, extraClass = '' } = {}) {
  return `<button type="button" class="chrome-button ${extraClass}" data-command="${command}"${pressed === undefined ? '' : ` aria-pressed="${pressed}"`}${hidden ? ' hidden' : ''} data-tip="${escape(tip)}">${icon(iconName)}<span class="chrome-label">${escape(label)}</span></button>`;
}

function chromeHTML(game, { daily, variant }) {
  const sound = audio.soundEnabled();
  const left = [
    button('new', 'new', 'New game', { tip: 'New game · F2' }),
    button('undo', 'undo', 'Undo', { tip: 'Undo · Ctrl Z', hidden: true }),
    button('hint', 'hint', 'Hint', { tip: 'Hint · H', hidden: true }),
  ];
  if (variant === 'page') {
    left.push(`<a class="chrome-button" href="${daily ? game.path : game.dailyPath}" data-tip="${daily ? 'Back to a regular game' : 'Today’s shared challenge'}">${icon('daily')}<span class="chrome-label">${daily ? 'Regular game' : 'Daily'}</span></a>`);
  }
  const right = [
    button('sound', sound ? 'soundOn' : 'soundOff', 'Sound', { tip: 'Sound · M', pressed: sound }),
    button('fidelity', 'pixels', 'Pixels', { tip: 'Original pixels or crisp drawing · P', pressed: false, hidden: true }),
    button('stats', 'stats', 'Stats', { tip: 'Your stats · S' }),
  ];
  if (variant === 'page') {
    right.push(button('focus', 'focus', 'Focus', { tip: 'Focus mode · Z', pressed: false }));
    right.push(button('keys', 'keyboard', 'Shortcuts', { tip: 'Keyboard shortcuts · ?' }));
  } else {
    right.push(`<a class="chrome-button" href="${game.path}" data-tip="Open the full ${escape(game.title)} page">${icon('arrow')}<span class="chrome-label">Full page</span></a>`);
  }
  return `<div class="chrome" role="group" aria-label="${escape(game.title)} controls"><div class="chrome-group">${left.join('')}</div><div class="chrome-group">${right.join('')}</div></div>`;
}

/**
 * Mount `game` (a registry entry from site/registry.js) into `container`.
 * Resolves to { handle, destroy }.
 */
export async function mountStage(container, game, { daily = false, variant = 'page', gameElementId = 'full-game', onWinShown } = {}) {
  activeStage?.destroy();
  const controller = new AbortController();
  const { signal } = controller;
  let handle = null;
  let destroyed = false;
  let session = { counted: false };

  container.innerHTML = `<div class="stage" data-variant="${variant}" data-game="${game.id}">${chromeHTML(game, { daily, variant })}<div class="stage-surface"><div class="stage-game" id="${gameElementId}"><div class="loading-game" role="status">${escape(game.loading)}</div></div></div></div>`;
  const stage = container.querySelector('.stage');
  const gameElement = stage.querySelector('.stage-game');
  const find = (command) => stage.querySelector(`[data-command="${command}"]`);

  // ---- play statistics -------------------------------------------------------
  // A game counts as played on its first interaction after a fresh deal.
  function rearm() { session = { counted: false }; }
  function noteInteraction() {
    if (!handle || destroyed) return;
    const state = typeof handle.state === 'function' ? safe(() => handle.state()) : null;
    if (state && state.status === 'ready') rearm();
    if (!session.counted) {
      session.counted = true;
      recordStart(game.id);
    }
  }
  gameElement.addEventListener('pointerdown', noteInteraction, { signal, capture: true });
  gameElement.addEventListener('keydown', (event) => {
    if (['Enter', ' ', 'f', 'F'].includes(event.key) || (event.key.length === 1 && !event.ctrlKey && !event.metaKey)) noteInteraction();
  }, { signal, capture: true });

  function onWin(summary = {}) {
    if (destroyed) return;
    const stats = recordWin(game.id, summary, { countedStart: session.counted });
    rearm();
    import('./win.js').then(({ showWin }) => {
      if (destroyed) return;
      showWin({ game, summary, stats, handle });
      onWinShown?.(summary);
    }).catch(() => showToast('Nicely done.'));
  }

  // ---- sound and drawing mode -----------------------------------------------
  function play(cue) {
    try { audio.play(cue); } catch { /* sound is optional */ }
  }
  function renderSound() {
    const on = audio.soundEnabled();
    const control = find('sound');
    control.setAttribute('aria-pressed', String(on));
    control.querySelector('svg').outerHTML = icon(on ? 'soundOn' : 'soundOff');
    control.querySelector('.chrome-label').textContent = on ? 'Sound on' : 'Sound off';
  }
  function toggleSound() {
    const on = !audio.soundEnabled();
    audio.setSoundEnabled(on);
    if (on) {
      try { audio.preloadSounds?.(); } catch { /* optional */ }
      play('toggle-on');
    }
    renderSound();
    showToast(on ? 'Sound on.' : 'Sound off.');
  }

  let fidelity = readStore(FIDELITY_KEY, 'pixels') === 'crisp' ? 'crisp' : 'pixels';
  function renderFidelity() {
    const control = find('fidelity');
    control.setAttribute('aria-pressed', String(fidelity === 'crisp'));
    control.querySelector('svg').outerHTML = icon(fidelity === 'pixels' ? 'pixels' : 'crisp');
    control.querySelector('.chrome-label').textContent = fidelity === 'pixels' ? 'Original pixels' : 'Crisp';
  }
  function setFidelity(next) {
    fidelity = next;
    writeStore(FIDELITY_KEY, fidelity);
    try { handle?.setFidelity?.(fidelity); } catch { /* optional */ }
    renderFidelity();
  }

  // ---- focus mode ------------------------------------------------------------
  function setFocus(on) {
    const root = document.documentElement;
    if (on === (root.dataset.focus === 'on')) return;
    if (on) root.dataset.focus = 'on';
    else delete root.dataset.focus;
    const control = find('focus');
    if (control) {
      control.setAttribute('aria-pressed', String(on));
      control.querySelector('svg').outerHTML = icon(on ? 'unfocus' : 'focus');
      control.querySelector('.chrome-label').textContent = on ? 'Leave focus' : 'Focus';
    }
    if (on && document.fullscreenEnabled && !document.fullscreenElement) {
      root.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => { /* CSS focus mode still applies */ });
    }
    if (!on && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    window.dispatchEvent(new Event('resize'));
  }
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && document.documentElement.dataset.focus === 'on') setFocus(false);
  }, { signal });

  // ---- commands --------------------------------------------------------------
  async function command(name) {
    if (!handle) return;
    if (name === 'new') {
      rearm();
      await handle.newGame?.();
      play('new-game');
    } else if (name === 'undo') {
      if (handle.undo?.() === false) showToast('Nothing to undo yet.');
    } else if (name === 'hint') handle.hint?.();
    else if (name === 'sound') toggleSound();
    else if (name === 'fidelity') setFidelity(fidelity === 'pixels' ? 'crisp' : 'pixels');
    else if (name === 'stats') (await import('./win.js')).showStats(game);
    else if (name === 'focus') setFocus(document.documentElement.dataset.focus !== 'on');
    else if (name === 'keys') (await import('./win.js')).showShortcuts(game, handle);
    refresh();
  }
  stage.querySelector('.chrome').addEventListener('click', (event) => {
    const control = event.target.closest('[data-command]');
    if (control) command(control.dataset.command);
  }, { signal });

  function refresh() {
    if (!handle) return;
    const undo = find('undo');
    if (typeof handle.canUndo === 'function') undo.disabled = !safe(() => handle.canUndo());
  }
  // Games change their own state on clicks, drags and keys (Ctrl+Z included); re-read undo after each.
  const refreshSoon = () => queueMicrotask(refresh);
  gameElement.addEventListener('click', refreshSoon, { signal });
  gameElement.addEventListener('pointerup', refreshSoon, { signal });
  window.addEventListener('keyup', refreshSoon, { signal });

  // Shell shortcuts run after the game's own handlers and never steal a key the game used.
  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'F2') { rearm(); return; }
    if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable) return;
    if (document.querySelector('dialog[open]')) return;
    const key = event.key.toLowerCase();
    if (event.key === 'Escape' && document.documentElement.dataset.focus === 'on') setFocus(false);
    else if (event.key === '?') command('keys');
    else if (key === 'm') command('sound');
    else if (key === 's') command('stats');
    else if (key === 'z' && variant === 'page') command('focus');
    else if (key === 'p' && handle?.setFidelity) command('fidelity');
    else return;
    event.preventDefault();
  }, { signal });

  const api = {
    get handle() { return handle; },
    element: stage,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      controller.abort();
      setFocus(false);
      try { handle?.destroy?.(); } catch (error) { console.error(error); }
      if (activeStage === api) activeStage = null;
    },
  };
  activeStage = api;

  // ---- mount the game --------------------------------------------------------
  const mount = await game.mount();
  if (destroyed) return api;
  handle = await mount(gameElement, {
    daily,
    onWin,
    onStart: rearm,
    onLose: () => {},
    sound: play,
    showDialog,
    showToast,
    chrome: true,
  });
  if (destroyed) { try { handle?.destroy?.(); } catch { /* already gone */ } return api; }
  find('undo').hidden = typeof handle.undo !== 'function';
  find('hint').hidden = typeof handle.hint !== 'function';
  if (typeof handle.setFidelity === 'function') {
    find('fidelity').hidden = false;
    setFidelity(fidelity);
  }
  stage.dataset.ready = 'true';
  renderSound();
  refresh();
  return api;
}

function safe(fn) {
  try { return fn(); } catch { return null; }
}
