/**
 * Sound cues. Games call `sound(cue)` with one of these names and never touch audio directly.
 * Sound is OFF by default. Nothing is downloaded until the player turns it on: then one small
 * audio sprite (public/audio/sprite.webm, ~100 KB) is fetched and decoded once, and every cue
 * plays from that shared buffer through Web Audio.
 */
export const CUES = [
  // shared
  'ui-tap', 'toggle-on', 'toggle-off', 'new-game', 'invalid', 'win', 'lose', 'undo',
  // minesweeper
  'reveal', 'reveal-cascade', 'flag', 'unflag', 'explode', 'chord',
  // cards
  'card-pick', 'card-place', 'card-flip', 'card-deal', 'card-shuffle', 'foundation', 'stock-recycle', 'cascade-bounce',
  // spider + hearts
  'run-complete', 'trick-take', 'hearts-broken', 'queen-of-spades', 'shoot-the-moon',
];

const STORAGE_KEY = 'stillplay-sound';
const SPRITE_BASE = '/audio/';
const MASTER_GAIN = 0.9;
const LATE_PLAY_WINDOW_MS = 400; // a cue asked for while the sprite loads still plays if loading finishes this soon

/*
 * Per-cue playback rules.
 *   voices: how many copies of the cue may ring at once (the oldest is faded out beyond that)
 *   gap:    minimum seconds between two starts of the same cue (stops machine-gun stacking)
 *   pitch:  random playback-rate spread, ± fraction (tonal cues stay nearly in tune)
 *   gain:   random level spread, ± dB
 */
const DEFAULT_SETTINGS = { voices: 3, gap: 0.03, pitch: 0.04, gain: 1.5 };
const SETTINGS = {
  'reveal': { voices: 4, gap: 0.02 },
  'card-deal': { voices: 6, gap: 0.025 },
  'cascade-bounce': { voices: 6, gap: 0.03, pitch: 0.08 },
  'card-shuffle': { voices: 1, gap: 0.3, pitch: 0.03 },
  'new-game': { voices: 1, gap: 0.15 },
  'explode': { voices: 1, gap: 0.5, pitch: 0.03 },
  'foundation': { pitch: 0.006 },
  'run-complete': { voices: 2, gap: 0.2, pitch: 0.006 },
  'hearts-broken': { voices: 1, gap: 0.3, pitch: 0.01 },
  'queen-of-spades': { voices: 1, gap: 0.3, pitch: 0.004 },
  'win': { voices: 1, gap: 0.6, pitch: 0.004, gain: 0.5 },
  'lose': { voices: 1, gap: 0.6, pitch: 0.004, gain: 0.5 },
  'shoot-the-moon': { voices: 1, gap: 0.6, pitch: 0.004, gain: 0.5 },
};

/** Playback rules for one cue (defaults merged with any override). */
export function cueSettings(cue) {
  return { ...DEFAULT_SETTINGS, ...SETTINGS[cue] };
}

/** Random rate and linear gain for one play. `random` returns [0, 1). */
export function variation(cue, random = Math.random) {
  const { pitch, gain } = cueSettings(cue);
  const rate = 1 + (random() * 2 - 1) * pitch;
  const db = (random() * 2 - 1) * gain;
  return { rate, gain: 10 ** (db / 20) };
}

/**
 * Checks a sprite offset map (public/audio/sprite.json). Throws with a readable message when a cue
 * is missing or unknown, an entry is not a finite [start, duration] pair, or two cues overlap.
 */
export function validateSpriteMap(map, cues = CUES) {
  if (!map || typeof map !== 'object') throw new Error('Sprite map must be an object.');
  if (!Array.isArray(map.sources) || !map.sources.length) throw new Error('Sprite map needs at least one source.');
  for (const source of map.sources) {
    if (typeof source?.src !== 'string' || !/^[\w.-]+$/.test(source.src)) throw new Error('Sprite source must be a plain file name.');
  }
  if (!map.align || !Number.isFinite(map.align.at) || !(map.align.threshold > 0)) throw new Error('Sprite map needs an alignment marker.');
  const entries = map.cues || {};
  const missing = cues.filter((cue) => !(cue in entries));
  if (missing.length) throw new Error(`Sprite map is missing: ${missing.join(', ')}`);
  const unknown = Object.keys(entries).filter((cue) => !cues.includes(cue));
  if (unknown.length) throw new Error(`Sprite map has unknown cues: ${unknown.join(', ')}`);
  const spans = cues.map((cue) => {
    const entry = entries[cue];
    if (!Array.isArray(entry) || entry.length !== 2 || !entry.every(Number.isFinite)) throw new Error(`Cue ${cue} must be [start, duration].`);
    const [start, duration] = entry;
    if (start < 0 || duration <= 0) throw new Error(`Cue ${cue} has a negative start or empty duration.`);
    return { cue, start, end: start + duration };
  }).sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i++) {
    if (spans[i].start < spans[i - 1].end) throw new Error(`Cues ${spans[i - 1].cue} and ${spans[i].cue} overlap.`);
  }
  return true;
}

export function soundEnabled() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'false') === true; } catch { return false; }
}

export function setSoundEnabled(enabled) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Boolean(enabled))); } catch { /* storage is optional */ }
  if (enabled) preloadSounds();
}

/* ---------- Web Audio engine (browser only; every step fails silently) ---------- */

let context = null;
let master = null;
let buffer = null;
let map = null;
let shift = 0; // seconds the decoder moved the audio (codec priming), measured against the marker
let loading = null;
let pending = null;
const voices = new Map(); // cue -> [{ source, gain, endsAt }]
const lastStart = new Map(); // cue -> context time

function ensureContext() {
  if (context) return context;
  const Context = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!Context) return null;
  // Game sounds mix with other audio and respect the iPhone silent switch.
  try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch { /* optional API */ }
  context = new Context({ latencyHint: 'interactive' });
  master = context.createGain();
  master.gain.value = MASTER_GAIN;
  // A gentle safety limiter for the rare moment many cues land together.
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.knee.value = 6;
  limiter.ratio.value = 8;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.15;
  master.connect(limiter).connect(context.destination);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) context.suspend().catch(() => {});
  });
  return context;
}

function resume() {
  if (context && context.state !== 'running' && !document.hidden) context.resume().catch(() => {});
}

function decode(bytes) {
  // Older Safari only supports the callback form of decodeAudioData.
  return new Promise((resolve, reject) => {
    const result = context.decodeAudioData(bytes, resolve, reject);
    if (result && typeof result.then === 'function') result.then(resolve, reject);
  });
}

function playability(type) {
  try {
    const answer = new Audio().canPlayType(type);
    return answer === 'probably' ? 2 : answer === 'maybe' ? 1 : 0;
  } catch { return 0; }
}

/** Finds how far the decoder shifted the audio, using the first cue's onset as a marker. */
function measureShift(decoded, align) {
  const data = decoded.getChannelData(0);
  const limit = Math.min(data.length, Math.round((align.at + 0.2) * decoded.sampleRate));
  for (let i = 0; i < limit; i++) {
    if (Math.abs(data[i]) >= align.threshold) {
      const delta = i / decoded.sampleRate - align.at;
      return Math.abs(delta) <= 0.1 ? delta : 0;
    }
  }
  return 0;
}

async function loadSprite() {
  const response = await fetch(`${SPRITE_BASE}sprite.json`);
  if (!response.ok) throw new Error('Sprite map unavailable');
  const nextMap = await response.json();
  validateSpriteMap(nextMap);
  // Try the formats this browser says it can play first; keep the file order as the tie-break.
  const sources = nextMap.sources
    .map((source, order) => ({ ...source, order, score: playability(source.type) }))
    .sort((a, b) => b.score - a.score || a.order - b.order);
  for (const source of sources) {
    try {
      const bytes = await (await fetch(SPRITE_BASE + source.src)).arrayBuffer();
      const decoded = await decode(bytes);
      shift = measureShift(decoded, nextMap.align);
      map = nextMap;
      buffer = decoded;
      return true;
    } catch { /* try the next format */ }
  }
  throw new Error('No playable sprite');
}

/**
 * Creates the audio context and fetches + decodes the sprite once. Call it from the sound toggle's
 * click handler so the context starts inside a user gesture. Resolves true when sounds are ready.
 */
export function preloadSounds() {
  try {
    if (!ensureContext()) return Promise.resolve(false);
    resume();
    loading ??= loadSprite().then(() => {
      if (pending && performance.now() - pending.at <= LATE_PLAY_WINDOW_MS && soundEnabled()) start(pending.cue);
      pending = null;
      return true;
    }).catch(() => {
      loading = null; // allow a later retry, e.g. after the network comes back
      pending = null;
      return false;
    });
    return loading;
  } catch {
    return Promise.resolve(false);
  }
}

function start(cue) {
  const entry = map?.cues[cue];
  if (!entry || !buffer) return;
  const now = context.currentTime;
  const settings = cueSettings(cue);
  if (now - (lastStart.get(cue) ?? -Infinity) < settings.gap) return;
  lastStart.set(cue, now);

  const active = (voices.get(cue) || []).filter((voice) => voice.endsAt > now);
  while (active.length >= settings.voices) {
    const oldest = active.shift();
    oldest.gain.gain.setTargetAtTime(0, now, 0.006);
    try { oldest.source.stop(now + 0.04); } catch { /* already stopped */ }
  }

  const { rate, gain } = variation(cue);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  const level = context.createGain();
  level.gain.value = gain;
  source.connect(level).connect(master);
  const [offset, duration] = entry;
  source.start(now, Math.max(0, offset + shift), duration);
  const voice = { source, gain: level, endsAt: now + duration / rate };
  source.onended = () => {
    level.disconnect();
    const list = voices.get(cue);
    if (list) voices.set(cue, list.filter((v) => v !== voice));
  };
  active.push(voice);
  voices.set(cue, active);
}

/** Plays one cue if sound is on. Never throws; silent when audio is unavailable. */
export function play(cue = 'ui-tap') {
  if (!soundEnabled()) return;
  try {
    if (!ensureContext()) return;
    resume();
    if (!buffer) {
      pending = { cue, at: performance.now() };
      preloadSounds();
      return;
    }
    start(cue);
  } catch { /* sound is optional */ }
}

// A returning player with sound on: warm up on their first interaction, so the first cue is not lost.
if (typeof window !== 'undefined' && soundEnabled()) {
  const warm = () => {
    window.removeEventListener('pointerdown', warm, true);
    window.removeEventListener('keydown', warm, true);
    preloadSounds();
  };
  window.addEventListener('pointerdown', warm, true);
  window.addEventListener('keydown', warm, true);
}
