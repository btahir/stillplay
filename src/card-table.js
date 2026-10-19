/**
 * card-table.js — the shared interaction and motion layer for Stillplay card games.
 *
 * The game core owns the rules and the state. The table only draws cards, lets
 * people move them (drag, tap, keyboard) and animates whatever changed. Every
 * change goes: input → your callback asks the core → you call `table.sync(state)`.
 *
 * ── Setup ──────────────────────────────────────────────────────────────────
 *   const table = createCardTable(feltElement, {
 *     piles: [
 *       { id: 't0', element, fan: 'down', row: 1, label: 'Column 1' },
 *       { id: 'w', element, fan: 'right', row: 0, label: 'Waste' },
 *       ...
 *     ],
 *     canPick(pileId, index)        → false | true | count   may these cards lift?
 *                                     true lifts index..top; a number lifts that many from index.
 *     canDrop(from, toPileId)       → boolean                would the core accept it?
 *     drop(from, toPileId)          → boolean                apply it, then call table.sync()
 *     activate(pileId, index)       → void                   tap or Enter that is not a pick
 *                                                            (stock, empty slot); index -1 = empty pile
 *     autoMove(pileId, index)       → boolean                double-click / double-tap / Shift+Enter
 *     cardLabel(card, faceUp, pileId, index) → string        accessible name (sensible default)
 *     decorate(element, info)       → void                   add game classes/data attributes to a card
 *     announce(text)                → void                   where status messages go (default: own live region)
 *     sound(cue)                    → void                   card-pick, invalid, card-flip, card-deal, cascade-bounce
 *     cardClass: 'fc-card'          extra class on every card button
 *     renderFace(card), renderBack(card)   SVG markup (defaults: cards.js)
 *     messages: { pick(from), cancel(), illegal(from, toPileId) }  optional wording
 *   });
 *   `from` is always { pile, index, count }.
 *
 * Pile options:
 *   id, element (the pile container; cards are appended inside it), label,
 *   row (keyboard rows, top to bottom), fan: 'none' | 'down' | 'right',
 *   faceUpOffset / faceDownOffset: px number or (cardHeight, pile) => px   ('down' piles)
 *   fanOffset: px or (cardWidth) => px                                       ('right' piles)
 *   compress: true  squeeze a 'down' fan so it ends inside the table
 *   grow: true      writes --ct-extent on the pile element (height of the fan) for CSS
 *   depth: true     stacked piles show a little thickness
 *   target: element focused/clicked when the pile is empty (defaults to [data-ct-target] inside it)
 *
 * ── State ──────────────────────────────────────────────────────────────────
 *   table.sync({ t0: [12, { card: 40, faceUp: false }], w: { cards: [3, 4, 5], fan: 3 } }, options)
 *     A pile is an array of card ids (face up) or { card, faceUp, key } entries,
 *     bottom to top, or { cards, fan } where `fan` is how many top cards spread ('right' piles).
 *     `key` keeps identity when one deck has duplicates (Spider): default key = card.
 *     options.animate: true (default) | false | 'deal'
 *     options.from:    pile id or { x, y } in table pixels — where a 'deal' starts
 *     options.order:   keys in the order they should be dealt
 *   Returns a promise that settles when the motion ends. Undo is just a sync.
 *
 * ── Other methods ──────────────────────────────────────────────────────────
 *   table.deal(state, { from, order })  gather the cards, then deal them out
 *   table.select(from | null), table.selection()
 *   table.showHint(from, toPileId)      a short highlight on both ends
 *   table.shake(pileId, index)          gentle "no" on a card
 *   table.focusPile(pileId)             keyboard focus to a pile
 *   table.cascade({ piles, onBounce })  the bouncing-cards win ending; resolves when done or skipped
 *   table.clearCascade(), table.relayout(), table.announce(text), table.destroy()
 *   table.reducedMotion                 true when motion is reduced
 *
 * Keyboard (inside the table): Tab or ←/→ move between piles, ↑/↓ move within a
 * fanned pile and between rows, Enter/Space picks up and puts down, Shift+Enter
 * sends a card home (autoMove), Escape puts the cards back.
 * Everything honours prefers-reduced-motion. Motion uses transforms only.
 */
import { cardSvg, cardBackSvg, cardName } from './cards.js';

const EASE_MOVE = 'cubic-bezier(.2,.8,.25,1)';
const EASE_SNAP = 'cubic-bezier(.3,1.35,.55,1)';
const CARD_RATIO = 1.4;

function injectStyles() {
  if (document.querySelector('link[data-card-table-styles]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./card-table.css', import.meta.url).href;
  link.dataset.cardTableStyles = '';
  document.head.append(link);
}

const resolve = (value, ...args) => typeof value === 'function' ? value(...args) : value;

export function createCardTable(root, options = {}) {
  injectStyles();
  const opts = {
    cardClass: '',
    renderFace: cardSvg,
    renderBack: () => cardBackSvg(),
    canPick: () => false,
    canDrop: () => false,
    drop: () => false,
    activate: () => {},
    autoMove: () => false,
    decorate: null,
    announce: null,
    sound: () => {},
    messages: {},
    ...options,
  };
  root.classList.add('ct-root');

  const piles = new Map();
  let pileList = [];
  const cards = new Map();
  let held = null;
  let gesture = null;
  let lastTap = null;
  let suppressClickUntil = 0;
  let syncCount = 0;
  let destroyed = false;
  let cascadeRun = null;
  let liveRegion = null;
  let frame = 0;
  const lastSound = new Map();
  const faces = new Map();
  const motionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const reduced = () => (opts.reducedMotion ?? motionQuery.matches) === true;

  /* ── helpers ─────────────────────────────────────────────────────────── */
  function emit(cue, gap = 45) {
    const time = performance.now();
    if (time - (lastSound.get(cue) ?? -1e9) < gap) return;
    lastSound.set(cue, time);
    try { opts.sound(cue); } catch { /* Sound is optional. */ }
  }
  function say(text) {
    if (!text) return;
    if (opts.announce) { opts.announce(text); return; }
    if (!liveRegion) {
      liveRegion = document.createElement('p');
      liveRegion.className = 'ct-live';
      liveRegion.setAttribute('role', 'status');
      liveRegion.setAttribute('aria-live', 'polite');
      root.append(liveRegion);
    }
    liveRegion.textContent = text;
  }
  const faceMarkup = (card) => {
    if (!faces.has(card)) faces.set(card, opts.renderFace(card));
    return faces.get(card);
  };
  const pileLabel = (id) => piles.get(id)?.label ?? id;
  const entryLabel = (entry) => entry.faceUp ? cardName(entry.card) : 'a face-down card';
  function defaultCardLabel(card, faceUp, pileId, index) {
    return faceUp ? `${cardName(card)}, ${pileLabel(pileId)}` : `Face-down card, ${pileLabel(pileId)}${index >= 0 ? '' : ''}`;
  }
  const cardLabel = opts.cardLabel ?? defaultCardLabel;

  function definePiles(definitions) {
    for (const pile of piles.values()) pile.element.classList.remove('ct-pile');
    piles.clear();
    definitions.forEach((definition, order) => {
      const pile = {
        fan: 'none', row: 0, label: definition.id, faceUpOffset: 0.25, faceDownOffset: 0.1, fanOffset: 0.2,
        ...definition, order, entries: [], fanCount: null,
      };
      pile.target = definition.target ?? definition.element.querySelector('[data-ct-target]');
      pile.element.dataset.ctPile = pile.id;
      pile.element.classList.add('ct-pile');
      if (pile.target) pile.target.dataset.ctTarget = pile.id;
      piles.set(pile.id, pile);
    });
    pileList = [...piles.values()].sort((a, b) => a.row - b.row || a.order - b.order);
  }

  /* ── cards ───────────────────────────────────────────────────────────── */
  function createCard(item) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `ct-card ${opts.cardClass}`.trim();
    el.tabIndex = -1;
    const face = document.createElement('span');
    face.className = 'ct-face';
    el.append(face);
    const entry = { key: item.key, card: item.card, faceUp: item.faceUp, shown: null, el, face, pile: null, index: -1, x: 0, y: 0, move: null, flip: null };
    el.ctEntry = entry;
    return entry;
  }
  function paint(entry, faceUp) {
    entry.face.innerHTML = faceUp ? faceMarkup(entry.card) : opts.renderBack(entry.card);
    entry.shown = faceUp;
    entry.el.classList.toggle('ct-face-down', !faceUp);
  }
  function describe(entry) {
    const { el } = entry;
    el.dataset.pile = entry.pile;
    el.dataset.index = String(entry.index);
    if (entry.faceUp) el.dataset.card = String(entry.card); else delete el.dataset.card;
    el.setAttribute('aria-label', cardLabel(entry.card, entry.faceUp, entry.pile, entry.index));
    el.setAttribute('aria-pressed', String(isHeld(entry)));
    opts.decorate?.(el, { card: entry.card, faceUp: entry.faceUp, pile: entry.pile, index: entry.index, key: entry.key });
  }
  function isHeld(entry) {
    return Boolean(held && entry.pile === held.pile && entry.index >= held.index && entry.index < held.index + held.count);
  }

  function normalize(state) {
    const next = new Map();
    for (const [id, value] of Object.entries(state)) {
      const list = Array.isArray(value) ? value : value?.cards ?? [];
      next.set(id, {
        fan: Array.isArray(value) ? null : value?.fan ?? null,
        list: list.map((item) => typeof item === 'number'
          ? { card: item, faceUp: true, key: item }
          : { card: item.card, faceUp: item.faceUp !== false, key: item.key ?? item.card }),
      });
    }
    return next;
  }

  /* ── geometry ────────────────────────────────────────────────────────── */
  function measurePiles() {
    for (const pile of piles.values()) {
      const rect = pile.element.getBoundingClientRect();
      pile.ox = rect.left + pile.element.clientLeft;
      pile.oy = rect.top + pile.element.clientTop;
      pile.cardW = pile.element.clientWidth || rect.width;
      pile.cardH = pile.cardW * CARD_RATIO;
    }
  }
  function layoutPile(pile, rootRect) {
    const { entries, cardW: w, cardH: h } = pile;
    const spots = [];
    if (pile.fan === 'down') {
      const gaps = entries.map((entry) => entry.faceUp ? resolve(pile.faceUpOffset, h, pile) : resolve(pile.faceDownOffset, h, pile));
      const fraction = (value) => value < 1 ? value * h : value;
      let offsets = gaps.slice(0, -1).map(fraction);
      if (pile.compress && rootRect) {
        const available = rootRect.bottom - pile.oy - h - (pile.bottomGap ?? 6);
        const total = offsets.reduce((sum, value) => sum + value, 0);
        if (total > available && total > 0) {
          const scale = Math.max(0.35, available / total);
          offsets = offsets.map((value) => value * scale);
        }
      }
      let y = 0;
      entries.forEach((_, index) => { spots.push({ x: 0, y }); y += offsets[index] ?? 0; });
      pile.extent = (spots.at(-1)?.y ?? 0) + h;
    } else if (pile.fan === 'right') {
      const spread = pile.fanCount ?? entries.length;
      const step = (() => { const value = resolve(pile.fanOffset, w, pile); return value < 1 ? value * w : value; })();
      const first = Math.max(0, entries.length - spread);
      entries.forEach((_, index) => spots.push({ x: Math.max(0, index - first) * step, y: 0 }));
      pile.extent = h;
    } else {
      entries.forEach((_, index) => {
        const lift = pile.depth ? -Math.min(3, Math.floor(index / 8)) : 0;
        spots.push({ x: lift, y: lift });
      });
      pile.extent = h;
    }
    return spots;
  }

  function stopCardMotion(entry) {
    if (entry.move) { entry.move.cancel(); entry.move = null; }
  }

  /* ── sync: the heart of the table ────────────────────────────────────── */
  async function sync(state, { animate = true, from = null, order = null, stagger = 22, duration = null } = {}) {
    if (destroyed) return;
    syncCount += 1;
    clearCascade();
    clearHints();
    if (gesture?.dragging) endDrag(false, true);
    const next = normalize(state);
    const motion = animate !== false && !reduced() && root.isConnected;
    const deal = motion && animate === 'deal';
    const activeEntry = document.activeElement?.ctEntry;
    const activePile = activeEntry?.pile;
    const activeTarget = document.activeElement?.dataset?.ctTarget;

    // Read: where every card is on screen right now (including mid-animation or mid-drag).
    const first = new Map();
    if (motion) for (const [key, entry] of cards) first.set(key, entry.el.getBoundingClientRect());

    // Write: membership, order, faces and labels.
    const seen = new Set();
    for (const [id, { list, fan }] of next) {
      const pile = piles.get(id);
      if (!pile) continue;
      pile.fanCount = fan;
      pile.entries = list.map((item, index) => {
        let entry = cards.get(item.key);
        if (!entry) {
          entry = createCard(item);
          cards.set(item.key, entry);
          paint(entry, deal ? false : item.faceUp);
        }
        entry.card = item.card;
        entry.faceUp = item.faceUp;
        entry.pile = id;
        entry.index = index;
        seen.add(item.key);
        return entry;
      });
    }
    for (const [key, entry] of cards) {
      if (seen.has(key)) continue;
      stopCardMotion(entry);
      entry.el.remove();
      cards.delete(key);
    }
    if (held) {
      const pile = piles.get(held.pile);
      if (!pile || held.index + held.count > pile.entries.length || !pile.entries[held.index]?.faceUp) held = null;
    }
    for (const pile of piles.values()) {
      const children = [...pile.element.children].filter((child) => child.ctEntry);
      if (children.length !== pile.entries.length || children.some((child, i) => child !== pile.entries[i].el)) {
        for (const entry of pile.entries) pile.element.append(entry.el);
      }
      for (const entry of pile.entries) {
        entry.el.style.visibility = '';
        describe(entry);
        entry.el.classList.toggle('ct-selected', isHeld(entry));
      }
    }

    // Read pile widths, then write fan heights, then read pile origins.
    measurePiles();
    const rootRect = root.getBoundingClientRect();
    const spotsByPile = new Map();
    for (const pile of piles.values()) {
      spotsByPile.set(pile.id, layoutPile(pile, rootRect));
      if (pile.grow) pile.element.style.setProperty('--ct-extent', `${Math.ceil(pile.extent)}px`);
    }
    measurePiles();

    // Deal origin in viewport pixels.
    let origin = null;
    if (deal && from) {
      if (typeof from === 'string' && piles.has(from)) {
        const pile = piles.get(from);
        origin = { left: pile.ox, top: pile.oy };
      } else if (typeof from === 'object') origin = { left: rootRect.left + from.x, top: rootRect.top + from.y };
    }
    const dealIndex = new Map((order ?? []).map((key, index) => [key, index]));
    let dealCount = 0;

    // Write: resting transforms, then FLIP from the first positions.
    const promises = [];
    const movedPerPile = new Map();
    let z = 0;
    for (const pile of pileList) {
      const spots = spotsByPile.get(pile.id);
      pile.entries.forEach((entry, index) => {
        const { x, y } = spots[index];
        entry.x = x; entry.y = y;
        entry.el.style.transform = `translate(${x}px, ${y}px)`;
        let start = first.get(entry.key);
        let delay = 0;
        let length = duration;
        if (deal && origin && pile.id !== from) {
          start = { left: origin.left, top: origin.top };
          const position = dealIndex.has(entry.key) ? dealIndex.get(entry.key) : dealCount;
          dealCount += 1;
          delay = position * stagger;
          length = duration ?? 260;
          if (entry.shown) paint(entry, false);
        }
        const dx = start ? start.left - (pile.ox + x) : 0;
        const dy = start ? start.top - (pile.oy + y) : 0;
        const moving = motion && start && Math.abs(dx) + Math.abs(dy) > 0.5;
        if (moving) {
          stopCardMotion(entry);
          if (!deal) {
            const count = movedPerPile.get(pile.id) ?? 0;
            movedPerPile.set(pile.id, count + 1);
            delay = count * 18;
            length = duration ?? Math.min(340, 150 + Math.hypot(dx, dy) * 0.32);
          }
          z += 1;
          entry.el.style.zIndex = String(1000 + z);
          const animation = entry.el.animate(
            [{ transform: `translate(${x + dx}px, ${y + dy}px)` }, { transform: `translate(${x}px, ${y}px)` }],
            { duration: length, delay, easing: EASE_MOVE, fill: 'backwards' },
          );
          entry.move = animation;
          if (deal) setTimeout(() => { if (entry.move === animation) emit('card-deal', 40); }, delay);
          promises.push(animation.finished.then(() => {
            if (entry.move === animation) { entry.move = null; entry.el.style.zIndex = ''; }
          }, () => {}));
        } else if (!entry.move) entry.el.style.zIndex = '';
        // Faces.
        if (entry.shown !== entry.faceUp) {
          if (motion) promises.push(flip(entry, moving ? delay + (deal ? length - 70 : Math.min(60, length * 0.25)) : 70));
          else { cancelFlip(entry); paint(entry, entry.faceUp); }
        }
      });
    }

    updateTabStops();
    // Keyboard focus stays with the pile, not with a card that was carried away.
    if (activeEntry && activeEntry.pile !== activePile && piles.has(activePile)) focusTarget(piles.get(activePile))?.focus({ preventScroll: true });
    else if (activeEntry && cards.get(activeEntry.key) === activeEntry && document.activeElement !== activeEntry.el) activeEntry.el.focus({ preventScroll: true });
    else if (activeTarget && document.activeElement === document.body) piles.get(activeTarget)?.target?.focus({ preventScroll: true });
    updateDropHighlight();
    await Promise.all(promises);
  }

  function cancelFlip(entry) {
    if (!entry.flip) return;
    entry.flip.cancel();
    entry.flip = null;
  }
  function flip(entry, delay) {
    cancelFlip(entry);
    const out = entry.face.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0.02)' }],
      { duration: 85, delay, easing: 'cubic-bezier(.55,0,1,.45)', fill: 'forwards' });
    entry.flip = out;
    return out.finished.then(() => {
      if (entry.flip !== out) return;
      paint(entry, entry.faceUp);
      emit('card-flip', 60);
      const back = entry.face.animate([{ transform: 'scaleX(0.02)' }, { transform: 'scaleX(1)' }],
        { duration: 110, easing: 'cubic-bezier(0,.55,.45,1)' });
      out.cancel();
      entry.flip = back;
      return back.finished.then(() => { if (entry.flip === back) entry.flip = null; });
    }).catch(() => { if (entry.shown !== entry.faceUp && !entry.flip) paint(entry, entry.faceUp); });
  }

  /** Move every card to `from`, then deal `state` out of it. */
  async function deal(state, { from, order, stagger } = {}) {
    if (!reduced() && cards.size && root.isConnected) {
      measurePiles();
      const rootRect = root.getBoundingClientRect();
      const point = typeof from === 'string' && piles.has(from)
        ? { left: piles.get(from).ox, top: piles.get(from).oy }
        : { left: rootRect.left + (from?.x ?? 0), top: rootRect.top + (from?.y ?? 0) };
      held = null;
      const gathers = [];
      let index = 0;
      for (const pile of pileList) {
        for (const entry of pile.entries) {
          stopCardMotion(entry);
          cancelFlip(entry);
          const x = point.left - pile.ox, y = point.top - pile.oy;
          const animation = entry.el.animate([{ transform: entry.el.style.transform }, { transform: `translate(${x}px, ${y}px)` }],
            { duration: 240, delay: Math.min(index++ * 4, 160), easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' });
          entry.move = animation;
          gathers.push(animation.finished.catch(() => {}));
        }
      }
      await Promise.all(gathers);
      for (const entry of cards.values()) { if (entry.shown) paint(entry, false); }
    }
    return sync(state, { animate: 'deal', from, order, stagger });
  }

  function relayout() { return sync(currentState(), { animate: false }); }
  function currentState() {
    const state = {};
    for (const pile of piles.values()) {
      state[pile.id] = { cards: pile.entries.map((entry) => ({ card: entry.card, faceUp: entry.faceUp, key: entry.key })), fan: pile.fanCount };
    }
    return state;
  }

  /* ── selection, focus and keyboard ───────────────────────────────────── */
  function pickCount(pileId, index) {
    const pile = piles.get(pileId);
    if (!pile || index < 0 || index >= pile.entries.length) return 0;
    const answer = opts.canPick(pileId, index);
    if (!answer) return 0;
    const rest = pile.entries.length - index;
    return answer === true ? rest : Math.max(1, Math.min(rest, Number(answer)));
  }
  function setHeld(next, quiet = false) {
    held = next;
    for (const entry of cards.values()) {
      const on = isHeld(entry);
      entry.el.classList.toggle('ct-selected', on);
      entry.el.setAttribute('aria-pressed', String(on));
    }
    updateDropHighlight();
    if (!quiet && next) {
      const lead = piles.get(next.pile).entries[next.index];
      say(opts.messages.pick?.(next) ?? `${cardName(lead.card)}${next.count > 1 ? ` and ${next.count - 1} more` : ''} picked up. Choose where to put ${next.count > 1 ? 'them' : 'it'}.`);
    }
  }
  function cancelHeld() {
    if (!held) return;
    setHeld(null, true);
    say(opts.messages.cancel?.() ?? 'Put back.');
  }
  function tryDrop(from, toPile) {
    if (from.pile !== toPile && opts.canDrop(from, toPile)) {
      setHeld(null, true);
      const before = syncCount;
      const ok = opts.drop(from, toPile);
      if (ok && syncCount === before) relayoutAnimated();
      if (ok) return true;
    }
    return false;
  }
  function relayoutAnimated() { return sync(currentState()); }
  function refuse(from, toPile) {
    emit('invalid', 80);
    const lead = piles.get(from.pile)?.entries[from.index];
    if (lead) shake(from.pile, from.index);
    say(opts.messages.illegal?.(from, toPile) ?? `${lead ? cardName(lead.card) : 'That card'} can’t go on ${pileLabel(toPile)}.`);
  }
  function shake(pileId, index) {
    if (reduced()) return;
    const entry = piles.get(pileId)?.entries[index];
    if (!entry) return;
    entry.face.animate([{ translate: '0 0' }, { translate: '-4px 0' }, { translate: '4px 0' }, { translate: '-2px 0' }, { translate: '0 0' }],
      { duration: 260, easing: 'ease-in-out', composite: 'add' });
  }

  function focusTarget(pile) {
    return pile.entries.at(-1)?.el ?? pile.target ?? null;
  }
  function updateTabStops() {
    for (const pile of piles.values()) {
      const stop = focusTarget(pile);
      for (const entry of pile.entries) entry.el.tabIndex = entry.el === stop ? 0 : -1;
      if (pile.target) {
        pile.target.tabIndex = pile.target === stop ? 0 : -1;
        if (pile.target !== stop) pile.target.setAttribute('aria-hidden', 'true'); else pile.target.removeAttribute('aria-hidden');
      }
    }
  }
  function focusPile(pileId) {
    const pile = piles.get(pileId);
    const target = pile && focusTarget(pile);
    target?.focus({ preventScroll: false });
  }
  function currentFocus() {
    const active = document.activeElement;
    if (!active || !root.contains(active)) return null;
    if (active.ctEntry) return { pile: active.ctEntry.pile, index: active.ctEntry.index };
    if (active.dataset.ctTarget) return { pile: active.dataset.ctTarget, index: -1 };
    return null;
  }
  function moveFocus(key) {
    const current = currentFocus();
    if (!current) { if (pileList[0]) focusPile(pileList[0].id); return; }
    const pile = piles.get(current.pile);
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const row = pileList.filter((candidate) => candidate.row === pile.row);
      const at = row.indexOf(pile);
      focusPile(row[(at + (key === 'ArrowRight' ? 1 : -1) + row.length) % row.length].id);
      return;
    }
    if (pile.fan === 'down' && current.index >= 0) {
      const step = key === 'ArrowUp' ? -1 : 1;
      const neighbour = pile.entries[current.index + step];
      if (neighbour && neighbour.faceUp) { neighbour.el.focus(); return; }
    }
    const rows = [...new Set(pileList.map((candidate) => candidate.row))];
    const nextRow = rows[rows.indexOf(pile.row) + (key === 'ArrowUp' ? -1 : 1)];
    if (nextRow === undefined) return;
    const centre = (candidate) => candidate.element.getBoundingClientRect().left + candidate.element.getBoundingClientRect().width / 2;
    const here = centre(pile);
    const best = pileList.filter((candidate) => candidate.row === nextRow)
      .sort((a, b) => Math.abs(centre(a) - here) - Math.abs(centre(b) - here))[0];
    if (best) focusPile(best.id);
  }
  function choose(pileId, index, viaKeyboard) {
    // One activation (tap, click or Enter) on a pile or card.
    const pile = piles.get(pileId);
    if (!pile) return;
    const entry = index >= 0 ? pile.entries[index] : null;
    if (held) {
      if (held.pile === pileId) {
        const count = entry ? pickCount(pileId, index) : 0;
        if (entry && index !== held.index && count) setHeld({ pile: pileId, index, count });
        else cancelHeld();
        return;
      }
      const from = held;
      if (tryDrop(from, pileId)) {
        if (viaKeyboard) requestAnimationFrame(() => piles.get(pileId) && focusPile(pileId));
        return;
      }
      const count = entry ? pickCount(pileId, index) : 0;
      if (count && !viaKeyboard) { setHeld({ pile: pileId, index, count }); emit('card-pick'); return; }
      refuse(from, pileId);
      return;
    }
    const count = entry ? pickCount(pileId, index) : 0;
    if (count) { setHeld({ pile: pileId, index, count }); emit('card-pick'); return; }
    opts.activate(pileId, entry ? index : -1);
  }

  function updateDropHighlight(target = null) {
    let hover = target;
    if (!hover && held) {
      const focus = currentFocus();
      if (focus && focus.pile !== held.pile && opts.canDrop(held, focus.pile)) hover = focus.pile;
    }
    for (const pile of piles.values()) {
      const on = pile.id === hover;
      pile.element.classList.toggle('ct-drop-target', on);
      pile.entries.forEach((entry, index) => entry.el.classList.toggle('ct-drop-card', on && index === pile.entries.length - 1));
    }
  }

  function keydown(event) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (cascadeRun) { event.preventDefault(); cascadeRun.stop(); return; }
    const focus = currentFocus();
    if (!focus) return;
    if (event.key.startsWith('Arrow')) { event.preventDefault(); moveFocus(event.key); updateDropHighlight(); return; }
    if (event.key === 'Escape' && held) { event.preventDefault(); event.stopPropagation(); cancelHeld(); return; }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (event.repeat) return;
      if (event.shiftKey && focus.index >= 0) { autoMove(focus.pile, focus.index); return; }
      choose(focus.pile, focus.index, true);
    }
  }
  function autoMove(pileId, index) {
    setHeld(null, true);
    const before = syncCount;
    const ok = opts.autoMove(pileId, index);
    if (ok && syncCount === before) relayoutAnimated();
    return ok;
  }

  /* ── pointer input: drag and drop, taps, double taps ─────────────────── */
  function pointerdown(event) {
    if (destroyed || (event.pointerType === 'mouse' && event.button !== 0) || gesture) return;
    if (cascadeRun) { cascadeRun.stop(); event.preventDefault(); return; }
    const cardEl = event.target.closest?.('.ct-card');
    const pileEl = event.target.closest?.('[data-ct-pile]');
    if (!pileEl || !root.contains(pileEl)) return;
    const entry = cardEl?.ctEntry && cards.get(cardEl.ctEntry.key) === cardEl.ctEntry ? cardEl.ctEntry : null;
    const pileId = entry ? entry.pile : pileEl.dataset.ctPile;
    const index = entry ? entry.index : -1;
    const count = entry ? pickCount(pileId, index) : 0;
    gesture = {
      id: event.pointerId, type: event.pointerType || 'mouse', pile: pileId, index, count,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, dragging: false, target: null,
    };
    try { root.setPointerCapture(event.pointerId); } catch { /* Synthetic events may not capture. */ }
    if (count && event.pointerType !== 'mouse') event.preventDefault();
  }
  function pointermove(event) {
    if (!gesture || event.pointerId !== gesture.id) return;
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    if (!gesture.dragging) {
      const threshold = gesture.type === 'mouse' ? 4 : 8;
      if (!gesture.count || Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY) < threshold) return;
      startDrag();
    }
    if (!frame) frame = requestAnimationFrame(paintDrag);
  }
  function startDrag() {
    const pile = piles.get(gesture.pile);
    gesture.dragging = true;
    gesture.entries = pile.entries.slice(gesture.index, gesture.index + gesture.count);
    if (held && !(held.pile === gesture.pile && held.index === gesture.index)) setHeld(null, true);
    measurePiles();
    gesture.rootRect = root.getBoundingClientRect();
    gesture.from = { pile: gesture.pile, index: gesture.index, count: gesture.count };
    gesture.legal = new Set(pileList.filter((candidate) => candidate.id !== gesture.pile && opts.canDrop(gesture.from, candidate.id)).map((candidate) => candidate.id));
    gesture.zones = pileList.map((candidate) => {
      const extent = candidate.extent ?? candidate.cardH;
      const lastSpot = candidate.entries.at(-1);
      const right = candidate.ox + Math.max(candidate.cardW, (lastSpot?.x ?? 0) + candidate.cardW);
      return { id: candidate.id, left: candidate.ox, top: candidate.oy, right, bottom: candidate.oy + Math.max(candidate.cardH, extent) };
    });
    gesture.entries.forEach((entry, i) => {
      // Keep the card exactly where it is, even if it was mid-flight.
      const rect = entry.el.getBoundingClientRect();
      stopCardMotion(entry);
      entry.baseX = rect.left - pile.ox;
      entry.baseY = rect.top - pile.oy;
      entry.el.style.zIndex = String(5000 + i);
      entry.el.classList.add('ct-lifted');
    });
    root.classList.add('ct-dragging');
    for (const id of gesture.legal) piles.get(id).element.classList.add('ct-drop-legal');
    emit('card-pick');
  }
  function paintDrag() {
    frame = 0;
    if (!gesture?.dragging) return;
    const dx = gesture.x - gesture.startX, dy = gesture.y - gesture.startY;
    for (const entry of gesture.entries) entry.el.style.transform = `translate(${entry.baseX + dx}px, ${entry.baseY + dy}px)`;
    // Hit test: the legal pile the lifted card overlaps most; the pointer position breaks ties.
    const pile = piles.get(gesture.pile);
    const lead = gesture.entries[0];
    const left = pile.ox + lead.baseX + dx, top = pile.oy + lead.baseY + dy;
    const right = left + pile.cardW, bottom = top + pile.cardH;
    let best = null, bestArea = 0;
    for (const zone of gesture.zones) {
      if (!gesture.legal.has(zone.id)) continue;
      const w = Math.min(right, zone.right) - Math.max(left, zone.left);
      const h = Math.min(bottom, zone.bottom) - Math.max(top, zone.top);
      const inside = gesture.x >= zone.left && gesture.x <= zone.right && gesture.y >= zone.top && gesture.y <= zone.bottom;
      const area = w > 0 && h > 0 ? w * h + (inside ? 1e6 : 0) : 0;
      if (area > bestArea) { bestArea = area; best = zone.id; }
    }
    if (best !== gesture.target) { gesture.target = best; updateDropHighlight(best); }
  }
  function endDrag(commit, quiet = false) {
    const current = gesture;
    gesture = null;
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    root.classList.remove('ct-dragging');
    for (const pile of piles.values()) pile.element.classList.remove('ct-drop-legal');
    updateDropHighlight();
    if (!current?.dragging) return;
    for (const entry of current.entries) entry.el.classList.remove('ct-lifted');
    if (commit && current.target && tryDrop(current.from, current.target)) return;
    if (commit && !quiet) {
      emit('invalid', 80);
      say(opts.messages.illegal?.(current.from, current.target) ?? 'That card goes back where it was.');
    }
    // Snap back with a little spring.
    for (const entry of current.entries) {
      const from = entry.el.style.transform;
      entry.el.style.transform = `translate(${entry.x}px, ${entry.y}px)`;
      if (reduced() || quiet) { entry.el.style.zIndex = ''; continue; }
      const animation = entry.el.animate([{ transform: from }, { transform: entry.el.style.transform }], { duration: 300, easing: EASE_SNAP });
      entry.move = animation;
      animation.finished.then(() => { if (entry.move === animation) { entry.move = null; entry.el.style.zIndex = ''; } }, () => {});
    }
  }
  function pointerup(event) {
    if (!gesture || event.pointerId !== gesture.id) return;
    suppressClickUntil = performance.now() + 450;
    if (gesture.dragging) {
      gesture.x = event.clientX; gesture.y = event.clientY;
      paintDrag();
      endDrag(true);
      return;
    }
    const { pile, index } = gesture;
    gesture = null;
    tap(pile, index);
  }
  function pointercancel(event) {
    if (!gesture || event.pointerId !== gesture.id) return;
    endDrag(false, true);
  }
  function tap(pileId, index) {
    const time = performance.now();
    const key = `${pileId}:${index}`;
    const double = index >= 0 && lastTap && lastTap.key === key && time - lastTap.time < 360;
    lastTap = { key, time };
    if (double && piles.get(pileId)?.entries[index]?.faceUp) {
      const wasHeld = held;
      if (autoMove(pileId, index)) { lastTap = null; return; }
      if (wasHeld) { setHeld(wasHeld, true); }
    }
    choose(pileId, index, false);
  }
  function click(event) {
    // Pointer input is handled above. Clicks that arrive without a pointer
    // (screen readers, keyboard-activated buttons) still play the game.
    const inside = event.target.closest?.('[data-ct-pile]');
    if (!inside || !root.contains(inside)) return;
    event.preventDefault();
    if (performance.now() < suppressClickUntil || event.detail > 0) return;
    const entry = event.target.closest('.ct-card')?.ctEntry;
    choose(entry ? entry.pile : inside.dataset.ctPile, entry ? entry.index : -1, true);
  }
  function contextmenu(event) {
    if (event.target.closest?.('.ct-card') && root.contains(event.target)) event.preventDefault();
  }

  /* ── hints ───────────────────────────────────────────────────────────── */
  let hintTimer = 0;
  function clearHints() {
    clearTimeout(hintTimer);
    for (const el of root.querySelectorAll('.ct-hint')) el.classList.remove('ct-hint');
  }
  function showHint(from, toPile) {
    clearHints();
    const marked = [];
    const source = from && piles.get(from.pile);
    if (source) {
      const count = from.count ?? source.entries.length - from.index;
      source.entries.slice(from.index, from.index + count).forEach((entry) => marked.push(entry.el));
      if (from.index < 0 || !source.entries.length) marked.push(source.element);
    }
    const target = toPile && piles.get(toPile);
    if (target) marked.push(target.entries.at(-1)?.el ?? target.element);
    for (const el of marked) {
      el.classList.remove('ct-hint');
      void el.offsetWidth;
      el.classList.add('ct-hint');
    }
    hintTimer = setTimeout(clearHints, 1900);
  }

  /* ── the win cascade ─────────────────────────────────────────────────── */
  function clearCascade() {
    if (cascadeRun) cascadeRun.stop();
    root.querySelector(':scope > .ct-cascade')?.remove();
    for (const entry of cards.values()) entry.el.style.visibility = '';
  }
  async function sprite(card, w, h, scale) {
    const markup = faceMarkup(card).replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" `);
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
  /**
   * The classic ending: foundation cards leap off one by one and bounce along
   * the bottom of the table, leaving trails. Click, tap or press a key to skip.
   * Resolves true when it played (to the end or skipped), false when motion is reduced.
   */
  async function cascade({ piles: ids = [], onBounce = null, interval = 300 } = {}) {
    clearCascade();
    if (reduced() || !root.isConnected) return false;
    const rootRect = root.getBoundingClientRect();
    const width = rootRect.width, height = rootRect.height;
    measurePiles();
    const stacks = ids.map((id) => piles.get(id)?.entries.slice() ?? []);
    const queue = [];
    const tallest = Math.max(0, ...stacks.map((stack) => stack.length));
    for (let level = tallest - 1; level >= 0; level--) {
      stacks.forEach((stack, i) => { if (stack[level]) queue.push({ entry: stack[level], pile: piles.get(ids[i]) }); });
    }
    if (!queue.length) return false;
    const scale = Math.min(2, window.devicePixelRatio || 1);
    const canvas = document.createElement('canvas');
    canvas.className = 'ct-cascade';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    root.append(canvas);
    const context = canvas.getContext('2d');
    context.scale(scale, scale);
    const cardW = queue[0].pile.cardW, cardH = queue[0].pile.cardH;
    const sprites = new Map();
    try {
      await Promise.all([...new Set(queue.map((item) => item.entry.card))].map(async (card) => sprites.set(card, await sprite(card, cardW, cardH, scale))));
    } catch { canvas.remove(); return false; }
    if (!canvas.isConnected) return false;
    say('Every card is home. Press any key or tap to skip the celebration.');
    return new Promise((done) => {
      const unit = cardW / 70;
      const gravity = 0.36 * unit;
      const active = [];
      let next = 0, last = performance.now(), sinceLaunch = Infinity, stopped = false, raf = 0;
      const random = Math.random;
      function launch() {
        const { entry, pile } = queue[next++];
        entry.el.style.visibility = 'hidden';
        const direction = random() < 0.5 ? -1 : 1;
        active.push({
          card: entry.card,
          x: pile.ox - rootRect.left + entry.x, y: pile.oy - rootRect.top + entry.y,
          vx: direction * (2.2 + random() * 4.2) * unit, vy: -(random() * 6.5) * unit,
          restitution: 0.72 + random() * 0.12,
        });
        sinceLaunch = 0;
      }
      function step() {
        if (next < queue.length && (active.length === 0 || (sinceLaunch > interval / 16.67 && active.length < 3))) launch();
        sinceLaunch += 1;
        for (let i = active.length - 1; i >= 0; i--) {
          const card = active[i];
          card.vy += gravity;
          card.x += card.vx;
          card.y += card.vy;
          if (card.y + cardH > height) {
            card.y = height - cardH;
            card.vy = -card.vy * card.restitution;
            if (Math.abs(card.vy) > 1.5 * unit) { emit('cascade-bounce', 70); onBounce?.(); }
          }
          context.drawImage(sprites.get(card.card), card.x, card.y, cardW, cardH);
          if (card.x + cardW < 0 || card.x > width) active.splice(i, 1);
        }
      }
      function tick(time) {
        if (stopped) return;
        const steps = Math.max(1, Math.min(4, Math.round((time - last) / 16.67)));
        last = time;
        for (let i = 0; i < steps; i++) step();
        if (next >= queue.length && !active.length) { finish(); return; }
        raf = requestAnimationFrame(tick);
      }
      function finish() {
        if (stopped) return;
        stopped = true;
        cancelAnimationFrame(raf);
        canvas.removeEventListener('pointerdown', skip);
        window.removeEventListener('keydown', skip, true);
        if (cascadeRun === run) cascadeRun = null;
        done(true);
      }
      function skip(event) { event.preventDefault(); finish(); }
      const run = { stop: finish };
      cascadeRun = run;
      canvas.addEventListener('pointerdown', skip);
      window.addEventListener('keydown', skip, true);
      raf = requestAnimationFrame((time) => { last = time; tick(time); });
    });
  }

  /* ── lifecycle ───────────────────────────────────────────────────────── */
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    if (!cards.size || gesture?.dragging) return;
    measurePiles();
    const rootRect = root.getBoundingClientRect();
    for (const pile of piles.values()) {
      const spots = layoutPile(pile, rootRect);
      if (pile.grow) pile.element.style.setProperty('--ct-extent', `${Math.ceil(pile.extent)}px`);
      pile.entries.forEach((entry, index) => {
        if (entry.move) return;
        entry.x = spots[index].x; entry.y = spots[index].y;
        entry.el.style.transform = `translate(${entry.x}px, ${entry.y}px)`;
      });
    }
  }) : null;
  resizeObserver?.observe(root);

  root.addEventListener('pointerdown', pointerdown);
  root.addEventListener('pointermove', pointermove);
  root.addEventListener('pointerup', pointerup);
  root.addEventListener('pointercancel', pointercancel);
  root.addEventListener('lostpointercapture', pointercancel);
  root.addEventListener('click', click);
  root.addEventListener('keydown', keydown);
  root.addEventListener('contextmenu', contextmenu);
  root.addEventListener('focusin', () => updateDropHighlight());

  definePiles(opts.piles ?? []);

  return {
    sync,
    deal,
    definePiles,
    relayout,
    select(from) {
      if (!from) { setHeld(null, true); return; }
      const count = from.count ?? pickCount(from.pile, from.index);
      if (count) setHeld({ pile: from.pile, index: from.index, count }, true);
    },
    selection: () => held && { ...held },
    showHint,
    shake,
    focusPile,
    cascade,
    clearCascade,
    announce: say,
    get reducedMotion() { return reduced(); },
    get busy() { return [...cards.values()].some((entry) => entry.move || entry.flip); },
    destroy() {
      destroyed = true;
      clearCascade();
      resizeObserver?.disconnect();
      for (const entry of cards.values()) { stopCardMotion(entry); cancelFlip(entry); entry.el.remove(); }
      cards.clear();
      root.removeEventListener('pointerdown', pointerdown);
      root.removeEventListener('pointermove', pointermove);
      root.removeEventListener('pointerup', pointerup);
      root.removeEventListener('pointercancel', pointercancel);
      root.removeEventListener('lostpointercapture', pointercancel);
      root.removeEventListener('click', click);
      root.removeEventListener('keydown', keydown);
      root.removeEventListener('contextmenu', contextmenu);
      liveRegion?.remove();
    },
  };
}
