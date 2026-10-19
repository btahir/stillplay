/**
 * Dialogs loaded on demand: the win dialog with sharing, the stats sheet and the shortcut sheet.
 */
import { escape, download, formatTime, formatDate, todayUTC } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openDialog } from '../ui/dialog.js';
import { showToast } from '../ui/toast.js';
import { getStats, recentDailies } from './stats.js';

const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * A link that reproduces the exact game. Games list their own URL parameters on the win
 * summary (`params`, e.g. { deal, suits }); older summaries fall back to deal or seed plus level.
 */
export function gameLink(game, summary) {
  if (summary.daily) return new URL(game.dailyPath, location.origin);
  const url = new URL(game.path, location.origin);
  if (summary.params && typeof summary.params === 'object') {
    for (const [key, value] of Object.entries(summary.params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    return url;
  }
  if (summary.deal !== undefined) url.searchParams.set('deal', summary.deal);
  else if (summary.seed !== undefined) url.searchParams.set('seed', summary.seed);
  if (summary.level) url.searchParams.set('level', summary.level);
  return url;
}

function detail(summary) {
  const parts = [];
  if (summary.level) parts.push(capitalise(summary.level));
  else if (typeof summary.variant === 'string') parts.push(capitalise(summary.variant));
  if (summary.deal !== undefined && !summary.daily) parts.push(`Deal #${summary.deal}`);
  if (Number.isInteger(summary.moves)) parts.push(`${summary.moves} moves`);
  if (summary.game === 'minesweeper' && summary.flags === 0) parts.push('no flags');
  return parts;
}

export function shareText(game, summary, stats) {
  const heading = summary.daily ? `Daily ${game.title} · ${formatDate(todayUTC(), { day: 'numeric', month: 'short' })}` : game.title;
  const lines = [`Stillplay · ${heading}`];
  const result = [`Solved in ${formatTime(summary.elapsedSeconds)}`, ...detail(summary)].join(' · ');
  lines.push(result);
  if (summary.daily && stats?.currentStreak > 1) lines.push(`Daily streak: ${stats.currentStreak} days`);
  return lines.join('\n');
}

function encodeReplay(replay) {
  const bytes = new TextEncoder().encode(JSON.stringify(replay));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function copy(text, done, failed) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(done);
    return true;
  } catch {
    showToast(failed);
    return false;
  }
}

/** Seven small squares: which of the last seven dailies were solved. */
function week(game) {
  const days = recentDailies(game.id);
  const label = `Daily ${game.title}, last seven days: ${days.filter((day) => day.solved).length} solved`;
  return `<ol class="week" aria-label="${escape(label)}">${days.map((day) => `<li class="${day.solved ? 'is-solved' : ''}${day.today ? ' is-today' : ''}"><i>${day.solved ? icon('check', { size: 14 }) : ''}</i><span>${escape(formatDate(day.date, { weekday: 'narrow' }))}</span></li>`).join('')}</ol>`;
}

function statCells(stats, { daily }) {
  const cells = [
    ['Played', stats.played],
    ['Win rate', stats.winRate === null ? '—' : `${stats.winRate}%`],
    daily ? ['Streak', stats.currentStreak] : ['Won', stats.won],
    ['Best time', formatTime(stats.bestTime)],
  ];
  return `<dl class="stat-row">${cells.map(([label, value]) => `<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>`;
}

/** A 1200 × 630 PNG result card, drawn from SVG on a canvas. */
async function shareCard(game, summary, stats) {
  const text = shareText(game, summary, stats).split('\n');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="#f7f5ef"/>
<g fill="#2c6249" transform="translate(80 72)"><path d="M0 0h22v22H0zM30 0h22v22H30zM0 30h22v22H0z"/><path d="M31 31h20v20H31z" fill="none" stroke="#2c6249" stroke-width="2"/></g>
<text x="152" y="113" font-family="Georgia, serif" font-size="40" fill="#2c6249">stillplay.</text>
<text x="80" y="290" font-family="Georgia, serif" font-size="92" letter-spacing="-3" fill="#282e29">A little victory.</text>
<text x="80" y="380" font-family="Helvetica, Arial, sans-serif" font-size="34" fill="#2c6249">${escape(text[1].replace('Stillplay · ', ''))}</text>
<text x="80" y="432" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="#62695e">${escape(text[0].replace('Stillplay · ', ''))}${text[2] ? ` · ${escape(text[2])}` : ''}</text>
<path d="M80 520h1040" stroke="#dcded3" stroke-width="2"/>
<text x="80" y="566" font-family="Helvetica, Arial, sans-serif" font-size="24" fill="#62695e">${escape(gameLink(game, summary).host)}${escape(gameLink(game, summary).pathname)}</text>
</svg>`;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 630;
  canvas.getContext('2d').drawImage(image, 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export function showWin({ game, summary, stats, handle, onAgain }) {
  const replay = summary.replay || (() => { try { return handle?.exportReplay?.(); } catch { return null; } })();
  const link = gameLink(game, summary).href;
  const text = shareText(game, summary, stats);
  const streak = summary.daily && stats.currentStreak
    ? `<p class="win-streak">${icon('streak', { size: 16 })}<span>${stats.currentStreak === 1 ? 'Day one of a new streak.' : `${stats.currentStreak} days in a row.`}${stats.bestStreak > stats.currentStreak ? ` Best: ${stats.bestStreak}.` : stats.currentStreak > 1 ? ' Your best yet.' : ''}</span></p>`
    : '';
  const facts = detail(summary);
  openDialog({
    title: summary.daily ? 'Today’s daily, solved' : 'A little victory',
    className: 'dialog-win',
    html: `
      <div class="win-hero">
        <p class="win-kicker">${escape(summary.daily ? `Daily ${game.title}` : game.title)}</p>
        <p class="win-time"><span class="sr-only">Time: </span>${escape(formatTime(summary.elapsedSeconds))}</p>
        ${facts.length ? `<p class="win-facts">${escape(facts.join(' · '))}</p>` : ''}
        ${streak}
      </div>
      ${statCells(stats, { daily: summary.daily })}
      ${summary.daily ? week(game) : ''}
      <div class="share-preview" aria-label="Share text">${escape(text)}<br><span>${escape(link)}</span></div>
      <div class="dialog-actions">
        <button type="button" class="button button-primary" data-share autofocus>${icon('share', { size: 16 })}Share result</button>
        ${typeof handle?.newGame === 'function' ? `<button type="button" class="button win-again" data-again>${icon('new', { size: 16 })}${summary.daily ? 'Play again' : 'New game'}</button>` : ''}
        <button type="button" class="button" data-copy-replay ${replay ? '' : 'hidden'}>${icon('link', { size: 16 })}Copy replay link</button>
        <button type="button" class="button" data-save-replay ${replay ? '' : 'hidden'}>${icon('download', { size: 16 })}Save replay</button>
        <button type="button" class="button" data-save-card>${icon('image', { size: 16 })}Save image</button>
      </div>`,
    onOpen(dialog) {
      dialog.querySelector('[data-share]').onclick = async () => {
        const data = { title: `Stillplay · ${game.title}`, text, url: link };
        if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
          try { await navigator.share(data); return; } catch (error) { if (error?.name === 'AbortError') return; }
        }
        copy(`${text}\n${link}`, 'Result copied. Paste it anywhere.', 'Select the text above to copy it.');
      };
      dialog.querySelector('[data-copy-replay]').onclick = () => copy(`${link}#replay=${encodeReplay(replay)}`, 'Replay link copied.', 'Save the replay file to share this game.');
      dialog.querySelector('[data-save-replay]').onclick = () => download(`stillplay-${game.id}-replay.json`, JSON.stringify(replay, null, 2));
      const again = dialog.querySelector('[data-again]');
      if (again) again.onclick = () => { dialog.close(); onAgain?.(); };
      dialog.querySelector('[data-save-card]').onclick = async () => {
        try { download(`stillplay-${game.id}.png`, await shareCard(game, summary, stats)); } catch { showToast('The image could not be drawn here.'); }
      };
    },
  });
}

export function showStats(game) {
  const stats = getStats(game.id);
  const variants = Object.entries(stats.best);
  const today = stats.daily.results[todayUTC()];
  openDialog({
    title: `${game.title} stats`,
    className: 'dialog-stats',
    html: `
      ${statCells(stats, { daily: false })}
      <div class="stat-streaks">
        <div>${icon('streak', { size: 18 })}<strong>${stats.currentStreak}</strong><span>Current daily streak</span></div>
        <div>${icon('daily', { size: 18 })}<strong>${stats.bestStreak}</strong><span>Best daily streak</span></div>
      </div>
      ${week(game)}
      <p class="stat-today">${today === undefined ? `Today’s daily ${escape(game.dailyNoun)} is waiting.` : `Today’s daily: solved${today === null ? '' : ` in ${escape(formatTime(today))}`}.`}${game.dailyPath ? ` <a class="text-link" href="${game.dailyPath}">${today === undefined ? 'Play it' : 'Play it again'} ${icon('arrow', { size: 12 })}</a>` : ''}</p>
      ${variants.length > 1 ? `<table class="stat-table"><caption>Best times</caption><tbody>${variants.map(([variant, time]) => `<tr><th scope="row">${escape(variant === 'default' ? 'Any' : capitalise(variant))}</th><td>${escape(formatTime(time))}</td></tr>`).join('')}</tbody></table>` : ''}
      <p class="dialog-note">${icon('lock', { size: 14 })}Kept on this device only. No account, nothing sent anywhere.</p>`,
  });
}

const SHELL_KEYS = [['?', 'This list'], ['M', 'Sound on or off'], ['S', 'Your stats'], ['Z', 'Focus mode'], ['P', 'Original pixels or crisp'], ['Esc', 'Leave focus mode']];

/** The shell's own keys, minus any the game has claimed (the game's meaning wins on its page). */
export function shellKeys(claimed = new Set()) {
  return SHELL_KEYS.filter(([key]) => !claimed.has(key.toLowerCase()));
}

export function showShortcuts(game, handle, claimed = new Set()) {
  const own = Array.isArray(handle?.shortcuts) ? handle.shortcuts : game.shortcuts;
  const shell = shellKeys(claimed);
  const clicksOnly = SHELL_KEYS.filter(([key]) => claimed.has(key.toLowerCase())).map(([, label]) => label.toLowerCase());
  const isKey = (token) => /^([A-Z0-9?]|F\d{1,2}|Esc|Enter|Space|Tab|Shift|Ctrl.*|⌘.*|Arrow keys)$/.test(token);
  const keyMarkup = (token) => token.split(' + ').map((part) => (isKey(part) ? `<kbd>${escape(part)}</kbd>` : `<span>${escape(part)}</span>`)).join(' + ');
  const list = (rows) => `<dl class="key-list">${rows.map(([keys, label]) => `<div><dt>${keys.split(/ · | or /).map(keyMarkup).join('<span class="key-or">or</span>')}</dt><dd>${escape(label)}</dd></div>`).join('')}</dl>`;
  openDialog({
    title: 'Keyboard shortcuts',
    className: 'dialog-keys',
    html: `${own.length ? `<h3>${escape(game.title)}</h3>${list(own)}` : ''}<h3>Everywhere</h3>${list(shell)}${clicksOnly.length ? `<p class="dialog-note">In ${escape(game.title)}, ${escape(clicksOnly.join(' and '))} ${clicksOnly.length > 1 ? 'are' : 'is'} on the toolbar only.</p>` : ''}`,
  });
}
