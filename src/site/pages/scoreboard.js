/** /scoreboard: the honest state of the reconstruction, read from scoreboard/<id>.json. */
import { siteGames } from '../registry.js';
import { escape } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openDialog } from '../ui/dialog.js';

const statusLabel = (record) => ({ 'awaiting-original': 'Awaiting original', 'partial-inventory': 'Partial inventory', matched: 'Byte-matched', 'matching-in-progress': 'Matching in progress' })[record.status] || 'Verification pending';
const mappedFunctions = (record) => (record.functions?.length ? record.functions : record.implementationFunctions || []);

function card(record) {
  const functions = mappedFunctions(record);
  return `<article class="score-card">
    <header><h2>${escape(record.title || record.game)}</h2><span class="status">${escape(statusLabel(record))}</span></header>
    <div class="big-match">${record.matchPercent === null || record.matchPercent === undefined ? '—' : `${escape(record.matchPercent)}%`}<small>${record.matchPercent === null || record.matchPercent === undefined ? 'Byte-match percentage not yet established' : 'Byte-matched against the original'}</small></div>
    <div class="score-stats"><div><strong>${escape(record.matchedFunctions ?? 0)} / ${escape(record.totalFunctions ?? '?')}</strong><span>Functions verified / original total</span></div><div><strong>${escape(record.matchedBytes ?? 0)} / ${escape(record.totalBytes ?? '?')}</strong><span>Bytes matched / original total</span></div></div>
    <p>Original function addresses, sizes and the function map become available once the original binary is inspected. Unverified functions never count as matches.</p>
    <p class="instrument-foot">${record.functions?.length ? 'Original function map' : 'Current C implementation'} · ${functions.length} functions</p>
    <div class="function-strip" aria-label="Functions in source order">${functions.map((fn, index) => `<button type="button" data-function="${index}" data-function-game="${escape(record.game)}" aria-label="Inspect ${escape(fn.name)}" class="${fn.status === 'matched' ? 'is-matched' : ''}"${fn.size ? ` style="flex:${Number(fn.size) || 1}"` : ''} title="${escape(fn.name)} · ${escape(fn.status)}"></button>`).join('')}</div>
    <details><summary>Inspect the current evidence</summary>
      <p class="instrument-foot">Byte comparison: ${record.functions?.some((fn) => fn.evidence?.kind === 'byte-comparison') ? 'recorded for mapped functions' : 'not run'}<br>Differential comparison: ${record.functions?.some((fn) => fn.evidence?.kind === 'original-differential') ? 'recorded for identified functions' : 'not run'}<br>Original SHA-256: ${escape(record.binaries?.original?.sha256 || 'not supplied')}<br>Build commit: ${record.buildCommit ? escape(record.buildCommit) : 'not recorded in this snapshot'}</p>
      <p class="instrument-foot"><a class="text-link" href="/cores/${escape(record.game)}.c">Our C source ${icon('arrow', { size: 12 })}</a> <a class="text-link" href="/scoreboard/${escape(record.game)}.json">Scoreboard JSON ${icon('arrow', { size: 12 })}</a></p>
    </details>
  </article>`;
}

export function render(main) {
  let alive = true;
  main.innerHTML = `<section class="page-intro wrap">
      <p class="eyebrow">Trust is a number you can check</p>
      <h1>The code<br><em>keeps score.</em></h1>
      <p>Rebuilding the original games is the long-term goal. A working game is a start; a byte-identical function is proof. Here is exactly what can be checked today.</p>
      <div class="notice">The games are playable, written from scratch. No original executable has been supplied yet, so byte matching and side-by-side comparison have not run.</div>
    </section>
    <section class="scoreboard-grid wrap" aria-busy="true"><p class="loading-game">Reading the records…</p></section>
    <section class="section wrap proof-grid">
      <div class="proof-copy"><p class="section-kicker">How we will know</p><h2>Three questions.<br>Three kinds of evidence.</h2></div>
      <div class="evidence-list">
        <p class="notice"><strong>01 · Do the rules hold?</strong><br>Seeded invariants, known deals, replay tests and browser tests exercise our implementation.</p>
        <p class="notice"><strong>02 · Does it behave like the original?</strong><br>Feed the same inputs to both programs and compare the state after every move. Waiting on original binaries.</p>
        <p class="notice"><strong>03 · Is the machine code identical?</strong><br>Compile with the original toolchain and compare every function’s bytes. Waiting on the originals and the matching compiler.</p>
      </div>
    </section>`;
  const grid = main.querySelector('.scoreboard-grid');
  // Only games with a committed record (catalog `scoreboard: true`); the rest would just 404.
  const ids = siteGames().filter((game) => game.routable && game.scoreboard).map((game) => game.id);
  Promise.all(ids.map((id) => fetch(`/scoreboard/${id}.json`).then((response) => (response.ok ? response.json() : null)).catch(() => null))).then((all) => {
    if (!alive) return;
    const records = all.filter(Boolean);
    grid.removeAttribute('aria-busy');
    if (!records.length) { grid.innerHTML = '<p class="notice">The scoreboard records could not be loaded. Try again in a moment.</p>'; return; }
    grid.innerHTML = records.map(card).join('') + `<p class="score-date">Snapshot: ${escape(records[0].updatedAt || 'unknown')} · Percentages stay blank until there is an original to compare.</p>`;
    grid.addEventListener('click', (event) => {
      const button = event.target.closest('[data-function]');
      if (!button) return;
      const record = records.find((item) => item.game === button.dataset.functionGame);
      const fn = mappedFunctions(record)[Number(button.dataset.function)];
      openDialog({ title: fn.name, html: `<p>${escape(fn.status)}${fn.status === 'own-implementation' ? ' · original verification pending' : ''}</p><p>${fn.source ? `Source: ${escape(fn.source)}:${escape(fn.line)}<br>` : ''}Original address: ${escape(fn.address || 'unknown')}<br>Original size: ${fn.size ? `${escape(fn.size)} bytes` : 'unknown'}<br>Byte similarity: ${fn.similarity === undefined ? 'not run' : `${escape(fn.similarity)}%`}</p>` });
    });
  });
  return () => { alive = false; };
}
