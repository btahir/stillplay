/** /daily: today's shared challenges, with your streaks. */
import { playable } from '../registry.js';
import { getStats } from '../play/stats.js';
import { escape, formatDate, formatTime, todayUTC } from '../ui/dom.js';
import { icon, gameGlyph } from '../ui/icons.js';
import { untilReset } from './home.js';

export function render(main) {
  const today = todayUTC();
  const rows = playable().map((game) => {
    const stats = getStats(game.id);
    const result = stats.daily.results[today];
    const solved = result !== undefined;
    return `<li class="daily-row${solved ? ' is-solved' : ''}">
      ${gameGlyph(game.icon, 'daily-glyph')}
      <div class="daily-row-text"><h2><a href="${game.dailyPath}">Daily ${escape(game.title)}</a></h2><p>${solved ? `Solved today${result === null ? '' : ` in ${escape(formatTime(result))}`}. Nicely done.` : `Today’s ${escape(game.dailyNoun)} is waiting.`}</p></div>
      <dl class="daily-row-stats"><div><dt>Streak</dt><dd>${stats.currentStreak}</dd></div><div><dt>Best</dt><dd>${stats.bestStreak}</dd></div></dl>
      <a class="button${solved ? '' : ' button-primary'}" href="${game.dailyPath}" tabindex="-1" aria-hidden="true">${solved ? 'Play again' : 'Play'} ${icon('arrowRight', { size: 16 })}</a>
    </li>`;
  }).join('');
  main.innerHTML = `<section class="page-intro wrap">
    <p class="eyebrow">${escape(formatDate(today, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</p>
    <h1>Same game.<br><em>Everyone, today.</em></h1>
    <p>Each game gets one shared board or deal a day, the same for every player in the world. Solve it on consecutive days to build a streak. New ones arrive in ${untilReset()}, at midnight UTC.</p>
  </section>
  <section class="wrap"><ul class="daily-rows">${rows}</ul>
  <p class="dialog-note">${icon('lock', { size: 14 })}Streaks are kept on this device only.</p></section>`;
}
