/**
 * A game's own page: title, the game in its chrome, then how to play and replay tools.
 * Works for every playable registry entry, regular or daily.
 */
import { parseReplay } from '../../shared.js';
import { mountStage } from '../play/stage.js';
import { escape, download, formatDate, todayUTC } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { showToast } from '../ui/toast.js';

function decodeReplay(encoded) {
  const binary = atob(decodeURIComponent(encoded));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return parseReplay(new TextDecoder().decode(bytes));
}

export function render(main, { game, daily }) {
  const controller = new AbortController();
  const { signal } = controller;
  let stage = null;
  const today = todayUTC();

  main.innerHTML = `
  <section class="play-head wrap">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/#collection">Games</a><span aria-hidden="true">/</span>${daily ? `<a href="${game.path}">${escape(game.title)}</a><span aria-hidden="true">/</span><span aria-current="page">Daily</span>` : `<span aria-current="page">${escape(game.title)}</span>`}</nav>
    <div class="play-title">
      <h1>${daily ? `Daily ${escape(game.title)}` : escape(game.title)}<em>.</em></h1>
      <p>${daily ? `${escape(formatDate(today, { weekday: 'long', day: 'numeric', month: 'long' }))}. The same ${escape(game.dailyNoun)} for everyone, all day. A new one at midnight UTC.` : escape(game.intro)}</p>
    </div>
  </section>
  <section class="play-area" aria-label="${escape(game.title)}" data-game-stage="${game.id}"></section>
  <section class="play-notes wrap">
    <div class="howto">
      <p class="section-kicker">How to play</p>
      ${game.howTo.map((paragraph) => `<p>${escape(paragraph)}</p>`).join('')}
      <p class="howto-small">Press <kbd>?</kbd> for keyboard shortcuts. The rules run on our own C code, compiled to WebAssembly; the same module powers the browser and the command line. Matching the original program is a separate job, and <a class="text-link" href="/scoreboard">it is tracked in the open</a>.</p>
    </div>
    <aside class="replay-tools" aria-label="Replays">
      <p class="section-kicker">Replays</p>
      <p>Every move is recorded. Save a game to a small file, or load one to see it again, move by move.</p>
      <div class="replay-buttons">
        <button type="button" class="button" id="export-replay">${icon('download', { size: 16 })}Save replay</button>
        <button type="button" class="button" id="import-replay">${icon('upload', { size: 16 })}Load replay</button>
        <input id="replay-input" type="file" accept=".json,application/json" hidden>
      </div>
      <p class="replay-daily"><a class="text-link" href="${daily ? game.path : game.dailyPath}">${daily ? `Play a regular game of ${escape(game.title)}` : `Try today’s daily ${escape(game.dailyNoun)}`} ${icon('arrow', { size: 12 })}</a></p>
    </aside>
  </section>`;

  const area = main.querySelector('.play-area');
  const ready = mountStage(area, game, { daily, variant: 'page', gameElementId: 'full-game' }).then(async (mounted) => {
    stage = mounted;
    if (signal.aborted) { stage.destroy(); return; }
    if (location.hash.startsWith('#replay=')) {
      try {
        const replay = decodeReplay(location.hash.slice(8));
        if (replay.game !== game.id) throw new Error(`Open ${replay.game} to load this replay.`);
        await stage.handle.loadReplay(replay);
        showToast('Replay loaded. Pick up where it left off.');
      } catch {
        showToast('This replay link could not be read.');
      }
    }
  }).catch((error) => {
    area.innerHTML = `<div class="wrap loading-game" role="alert">${escape(game.title)} could not start here. ${escape(error.message || '')}</div>`;
    console.error(error);
  });

  main.querySelector('#export-replay').addEventListener('click', async () => {
    await ready;
    try {
      download(`stillplay-${game.id}-replay.json`, JSON.stringify(stage.handle.exportReplay(), null, 2));
    } catch { showToast('There is no replay to save yet.'); }
  }, { signal });
  const input = main.querySelector('#replay-input');
  main.querySelector('#import-replay').addEventListener('click', () => input.click(), { signal });
  input.addEventListener('change', async () => {
    try {
      const file = input.files[0];
      if (!file) return;
      if (file.size > 1024 * 1024) throw new Error('Replay exceeds the 1 MiB limit.');
      const replay = parseReplay(await file.text());
      if (replay.game !== game.id) throw new Error(`Open ${replay.game} to load this replay.`);
      await ready;
      if (typeof stage?.handle?.loadReplay !== 'function') throw new Error('This game cannot load replays yet.');
      await stage.handle.loadReplay(replay);
      showToast('Replay restored through the game core.');
    } catch (error) {
      showToast(error.message);
    } finally {
      input.value = '';
    }
  }, { signal });

  return () => {
    controller.abort();
    stage?.destroy();
  };
}
