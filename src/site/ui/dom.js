/** Small DOM and storage helpers shared by the site shell. */

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape any value for safe use inside HTML text or attributes. */
export function escape(value) {
  return String(value).replace(/[&<>"']/g, (character) => ENTITIES[character]);
}

/** Read JSON from localStorage. Storage can be missing, full or blocked; never throw. */
export function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Save generated data as a file without a server round trip. */
export function download(name, data, type = 'application/json') {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Today's shared daily date (UTC), matching dailySeed() in src/shared.js. */
export const todayUTC = () => new Date().toISOString().slice(0, 10);

export function formatDate(isoDate, options = { day: 'numeric', month: 'long' }) {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', ...options });
}

/** 75 -> "1:15"; 9 -> "0:09". */
export function formatTime(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}
