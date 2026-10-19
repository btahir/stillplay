/**
 * Home: play first. The hero boots straight into a playable game (no splash), with a
 * switcher across every playable game. Below: today's dailies, the collection, secrets,
 * and, last and quietest, the reconstruction story and the local .exe inspector.
 */
import { siteGames, playable, findGame } from '../registry.js';
import { mountStage } from '../play/stage.js';
import { getStats } from '../play/stats.js';
import { escape, readStore, writeStore, formatDate, formatTime, todayUTC, prefersReducedMotion } from '../ui/dom.js';
import { icon, gameGlyph } from '../ui/icons.js';

const HERO_KEY = 'stillplay-hero-game';

export function untilReset(now = new Date()) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const minutes = Math.max(1, Math.round((next - now.getTime()) / 60000));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

function heroChoice(games) {
  const fromQuery = new URLSearchParams(location.search).get('game');
  const wanted = fromQuery || readStore(HERO_KEY, null);
  return games.find((game) => game.id === wanted) || games[0];
}

function switcher(games, current) {
  if (games.length < 2) return '';
  return `<div class="switcher" role="tablist" aria-label="Choose a game to play">${games.map((game) => `<button type="button" role="tab" id="tab-${game.id}" class="switcher-tab" data-game="${game.id}" aria-selected="${game.id === current.id}" aria-controls="hero-panel" tabindex="${game.id === current.id ? 0 : -1}">${gameGlyph(game.icon, 'switcher-glyph')}<span>${escape(game.title)}</span></button>`).join('')}</div>`;
}

function dailyCard(game) {
  const stats = getStats(game.id);
  const result = stats.daily.results[todayUTC()];
  const solved = result !== undefined;
  return `<a class="daily-card${solved ? ' is-solved' : ''}" href="${game.dailyPath}">
    ${gameGlyph(game.icon, 'daily-glyph')}
    <span class="daily-card-text"><strong>Daily ${escape(game.title)}</strong><small>${solved ? `Solved${result === null ? '' : ` in ${escape(formatTime(result))}`}` : `Today’s ${escape(game.dailyNoun)} is waiting`}</small></span>
    <span class="daily-card-meta">${stats.currentStreak ? `<span class="streak" title="Current daily streak">${icon('streak', { size: 14 })}${stats.currentStreak}</span>` : ''}${solved ? icon('check', { size: 18, className: 'icon daily-check' }) : icon('arrowRight', { size: 18, className: 'icon daily-arrow' })}</span>
  </a>`;
}

function collectionCard(game) {
  const actions = game.playable
    ? `<div class="game-card-actions"><a class="text-link" href="${game.dailyPath}">Daily ${icon('arrow', { size: 12 })}</a></div>`
    : `<p class="game-card-status">${escape(game.statusLabel)}</p>`;
  const title = game.routable
    ? `<a class="game-card-link" href="${game.path}">${escape(game.title)}</a>`
    : escape(game.title);
  return `<article class="game-card${game.playable ? '' : ' is-future'}" data-game="${game.id}">
    <div class="game-card-art" data-mini="${game.id}" aria-hidden="true"></div>
    <div class="game-card-body">
      <p class="game-card-number">${game.number}</p>
      <h3>${title}</h3>
      <p class="game-card-tagline">${escape(game.tagline)}</p>
      ${actions}
    </div>
  </article>`;
}

/** Run `task` once `element` comes near the viewport. */
function whenNear(element, task, signal) {
  if (!('IntersectionObserver' in window)) { task(); return; }
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) { observer.disconnect(); if (!signal.aborted) task(); }
  }, { rootMargin: '200px 0px' });
  observer.observe(element);
  signal.addEventListener('abort', () => observer.disconnect());
}

const statusLabel = (record) => ({ 'awaiting-original': 'Awaiting original', 'partial-inventory': 'Partial inventory', matched: 'Byte-matched', 'matching-in-progress': 'Matching in progress' })[record.status] || 'Verification pending';

export function render(main) {
  const controller = new AbortController();
  const { signal } = controller;
  const games = playable();
  let current = heroChoice(games);
  let stage = null;
  const all = siteGames();
  const today = todayUTC();

  main.innerHTML = `
  <section class="hero wrap">
    <div class="hero-copy">
      <p class="eyebrow">Good games never get old</p>
      <h1>A little time.<br><em>Well wasted.</em></h1>
      <p class="hero-lede">The games that came with Windows XP, back in your browser. No installs, no accounts, nothing to sign up for. Just play.</p>
      <p class="hero-note">${icon('lock', { size: 15 })}Everything stays on your device.</p>
    </div>
    <div class="hero-play">
      ${switcher(games, current)}
      <div class="hero-stage" id="hero-panel" ${games.length > 1 ? `role="tabpanel" aria-labelledby="tab-${current.id}"` : `aria-label="Play ${escape(current.title)}"`}></div>
      <p class="stage-caption"><span data-caption-number>${current.number} / ${String(all.length).padStart(2, '0')} · ${escape(current.title)}</span><span data-caption-tagline>${escape(current.tagline)}</span></p>
    </div>
  </section>

  <section class="dailies wrap" id="daily" aria-labelledby="daily-heading">
    <div class="section-heading">
      <div><p class="section-kicker">${escape(formatDate(today, { weekday: 'long', day: 'numeric', month: 'long' }))}</p><h2 id="daily-heading">Today’s dailies</h2></div>
      <p class="section-aside">The same games for everyone, all day. New ones in <span data-reset>${untilReset()}</span>.</p>
    </div>
    <div class="daily-list">${games.map(dailyCard).join('')}</div>
  </section>

  <section class="collection wrap" id="collection" aria-labelledby="collection-heading">
    <div class="section-heading">
      <div><p class="section-kicker">The collection</p><h2 id="collection-heading">Five old friends.</h2></div>
      <p class="section-aside">${games.length === all.length ? 'All five ready to play, each with a daily of its own.' : `${games.length} to play now. The rest are on their way, one at a time.`}</p>
    </div>
    <div class="game-grid">${all.map(collectionCard).join('')}</div>
  </section>

  <section class="secrets-teaser wrap" aria-labelledby="secrets-heading">
    <div class="section-heading">
      <div><p class="section-kicker">There’s more beneath the surface</p><h2 id="secrets-heading">Small games. Good secrets.</h2></div>
      <a class="text-link" href="/secrets">All the secrets ${icon('arrow', { size: 12 })}</a>
    </div>
    <div class="secrets-grid" data-secrets></div>
  </section>

  <section class="proof wrap" aria-labelledby="proof-heading">
    <div class="proof-copy">
      <p class="section-kicker">Rebuilt in the open</p>
      <h2 id="proof-heading">A working game is a start. Proof takes longer.</h2>
      <p>The long-term goal is to rebuild each game function by function and compare it, byte for byte, with the original. That comparison has not started yet, so the numbers stay blank until there is something real to count.</p>
      <a class="text-link" href="/scoreboard">See where things stand ${icon('arrow', { size: 12 })}</a>
    </div>
    <div class="proof-instrument" data-proof>
      <div class="instrument-label"><span>Byte-match verification</span><span>Wave 01</span></div>
      ${games.map((game) => `<div class="instrument-row" data-record="${game.id}"><strong>${escape(game.title)}</strong><span>Awaiting original</span><span class="unknown">—</span></div>`).join('')}
    </div>
  </section>

  <section class="copy-section wrap" id="your-copy" aria-labelledby="copy-heading">
    <div>
      <p class="section-kicker">Bring a little history</p>
      <h2 id="copy-heading">Still have your old copy?</h2>
      <p>Open a game’s original .exe to look at its bitmaps. The file is read in this tab and never leaves your device. Turning those bitmaps into an original skin is still being checked.</p>
    </div>
    <div>
      <button type="button" class="drop-zone" id="drop-zone">${icon('upload', { size: 22 })}<strong>Drop a game .exe here, or browse</strong><small>Read in your browser. Never uploaded.</small></button>
      <input id="exe-input" type="file" accept=".exe" hidden>
    </div>
  </section>`;

  const panel = main.querySelector('#hero-panel');

  async function play(game, { animate = false } = {}) {
    current = game;
    writeStore(HERO_KEY, game.id);
    for (const tab of main.querySelectorAll('.switcher-tab')) {
      const selected = tab.dataset.game === game.id;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    if (main.querySelector('.switcher')) panel.setAttribute('aria-labelledby', `tab-${game.id}`);
    panel.dataset.game = game.id;
    main.querySelector('[data-caption-number]').textContent = `${game.number} / ${String(all.length).padStart(2, '0')} · ${game.title}`;
    main.querySelector('[data-caption-tagline]').textContent = game.tagline;
    const mountNext = () => mountStage(panel, game, { variant: 'hero', gameElementId: 'hero-game' });
    if (animate && document.startViewTransition && !prefersReducedMotion()) {
      await game.mount().catch(() => {}); // fetch the module first so the swap is quick
      if (signal.aborted || current !== game) return;
      document.documentElement.dataset.transition = 'game-switch';
      const transition = document.startViewTransition(() => Promise.race([mountNext().then((next) => { stage = next; }), new Promise((done) => setTimeout(done, 400))]));
      transition.finished.finally(() => delete document.documentElement.dataset.transition);
      await transition.updateCallbackDone.catch(() => {});
    } else {
      stage = await mountNext();
    }
    if (signal.aborted) stage?.destroy();
  }

  const tabs = main.querySelector('.switcher');
  tabs?.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-game]');
    if (!tab || tab.dataset.game === current.id) return;
    play(findGame(tab.dataset.game), { animate: true }).catch(console.error);
  }, { signal });
  tabs?.addEventListener('keydown', (event) => {
    const list = [...tabs.querySelectorAll('[role="tab"]')];
    const index = list.indexOf(document.activeElement);
    if (index < 0) return;
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: list.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const tab = list[(next + list.length) % list.length];
    tab.focus();
    tab.click();
  }, { signal });

  play(current).catch((error) => {
    panel.innerHTML = `<div class="loading-game" role="alert">This game could not start here. ${escape(error.message || '')}</div>`;
    console.error(error);
  });

  // Below-the-fold sections load their extras only when they come close.
  whenNear(main.querySelector('.game-grid'), () => {
    import('../minis.js').then(({ drawMini }) => {
      for (const art of main.querySelectorAll('[data-mini]')) art.innerHTML = drawMini(art.dataset.mini);
    }).catch(() => {});
  }, signal);
  whenNear(main.querySelector('[data-secrets]'), () => {
    import('../../secrets.js').then(({ secrets }) => {
      main.querySelector('[data-secrets]').innerHTML = secrets.slice(0, 3).map(secretCard).join('');
    }).catch(() => {});
  }, signal);
  whenNear(main.querySelector('[data-proof]'), () => {
    Promise.all(games.map((game) => (game.scoreboard ? fetch(`/scoreboard/${game.id}.json`) : Promise.resolve({ ok: false })).then((response) => (response.ok ? response.json() : null)).catch(() => null)))
      .then((records) => {
        records.forEach((record, index) => {
          const row = main.querySelector(`[data-record="${games[index].id}"]`);
          if (!row || !record) return;
          row.children[1].textContent = statusLabel(record);
          row.children[2].textContent = record.matchPercent === null || record.matchPercent === undefined ? '—' : `${record.matchPercent}%`;
        });
      });
  }, signal);

  const zone = main.querySelector('#drop-zone');
  const input = main.querySelector('#exe-input');
  const inspect = (file) => import('../inspector.js').then(({ inspectFile }) => inspectFile(file, zone)).catch(console.error);
  zone.addEventListener('click', () => input.click(), { signal });
  input.addEventListener('change', () => { inspect(input.files[0]); input.value = ''; }, { signal });
  zone.addEventListener('dragover', (event) => { event.preventDefault(); zone.classList.add('drag-over'); }, { signal });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'), { signal });
  zone.addEventListener('drop', (event) => { event.preventDefault(); zone.classList.remove('drag-over'); inspect(event.dataTransfer.files[0]); }, { signal });

  return () => {
    controller.abort();
    stage?.destroy();
  };
}

export function secretCard(secret) {
  return `<a class="secret-link" href="/secrets/${secret.slug}"><div class="secret-art">${secret.art}</div><span class="secret-number">Secret ${escape(secret.number)}</span><h3>${escape(secret.title)}</h3><p>${escape(secret.description)}</p></a>`;
}
