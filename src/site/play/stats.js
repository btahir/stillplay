/**
 * Local game statistics. Everything lives in one localStorage entry on this device.
 * Storage can be blocked, full or hand-edited, so every read is sanitised and every write may fail quietly.
 */
import { readStore, writeStore, todayUTC } from '../ui/dom.js';

const KEY = 'stillplay-stats-v1';
const KEEP_DAILY_RESULTS = 120;

const count = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);
const seconds = (value) => (Number.isFinite(value) && value >= 0 ? Math.round(value) : null);
const isDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

function previousDay(date) {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

function clean(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const best = {};
  for (const [variant, time] of Object.entries(source.best && typeof source.best === 'object' ? source.best : {})) {
    if (seconds(time) !== null) best[variant] = seconds(time);
  }
  const daily = source.daily && typeof source.daily === 'object' ? source.daily : {};
  const results = {};
  for (const [date, time] of Object.entries(daily.results && typeof daily.results === 'object' ? daily.results : {})) {
    if (isDate(date)) results[date] = seconds(time);
  }
  const won = count(source.won);
  return {
    played: Math.max(count(source.played), won),
    won,
    best,
    daily: { last: isDate(daily.last) ? daily.last : null, current: count(daily.current), best: count(daily.best), results },
  };
}

function readAll() {
  const all = readStore(KEY, {});
  return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
}

function update(id, change) {
  const all = readAll();
  const next = clean(all[id]);
  change(next);
  all[id] = next;
  writeStore(KEY, all);
  return summarise(next);
}

function summarise(stats, today = todayUTC()) {
  const alive = stats.daily.last === today || stats.daily.last === previousDay(today);
  const times = Object.values(stats.best);
  return {
    ...stats,
    winRate: stats.played ? Math.round((stats.won / stats.played) * 100) : null,
    bestTime: times.length ? Math.min(...times) : null,
    currentStreak: alive ? stats.daily.current : 0,
    bestStreak: Math.max(stats.daily.best, alive ? stats.daily.current : 0),
    playedToday: stats.daily.results[today] !== undefined,
  };
}

export function getStats(id) {
  return summarise(clean(readAll()[id]));
}

export function recordStart(id) {
  return update(id, (stats) => { stats.played += 1; });
}

/** Record a win. `summary` comes from the game's onWin callback. */
export function recordWin(id, summary = {}, { countedStart = true, date = todayUTC() } = {}) {
  return update(id, (stats) => {
    if (!countedStart) stats.played += 1;
    stats.won += 1;
    const time = seconds(summary.elapsedSeconds);
    const variant = typeof summary.level === 'string' ? summary.level : typeof summary.variant === 'string' ? summary.variant : 'default';
    if (time !== null && (stats.best[variant] === undefined || time < stats.best[variant])) stats.best[variant] = time;
    if (summary.daily) {
      const already = stats.daily.results[date] !== undefined;
      if (!already) {
        stats.daily.current = stats.daily.last === previousDay(date) ? stats.daily.current + 1 : 1;
        stats.daily.last = date;
        stats.daily.best = Math.max(stats.daily.best, stats.daily.current);
      }
      const previous = stats.daily.results[date];
      stats.daily.results[date] = previous === null || previous === undefined || (time !== null && time < previous) ? time : previous;
      const dates = Object.keys(stats.daily.results).sort();
      for (const old of dates.slice(0, Math.max(0, dates.length - KEEP_DAILY_RESULTS))) delete stats.daily.results[old];
    }
  });
}

/** The time of today's daily win, `null` for a win without a time, or `undefined` when not solved. */
export function dailyResult(id, date = todayUTC()) {
  return getStats(id).daily.results[date];
}

/** The last `days` daily results, oldest first: [{ date, solved, today }]. */
export function recentDailies(id, days = 7, today = todayUTC()) {
  const results = getStats(id).daily.results;
  const list = [];
  let date = today;
  for (let index = 0; index < days; index += 1) {
    list.unshift({ date, solved: results[date] !== undefined, today: date === today });
    date = previousDay(date);
  }
  return list;
}
