/**
 * Sound cues. Games call `sound(cue)` with one of these names and never touch audio directly.
 * Sound is OFF by default and only starts after the player turns it on.
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

export function soundEnabled() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'false') === true; } catch { return false; }
}

export function setSoundEnabled(enabled) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Boolean(enabled))); } catch { /* storage is optional */ }
}

/** Placeholder until the sampled engine lands: a short sine blip per cue. */
let context;
export function play(cue = 'ui-tap') {
  if (!soundEnabled()) return;
  try {
    context ??= new (window.AudioContext || window.webkitAudioContext)();
    const osc = context.createOscillator();
    const gain = context.createGain();
    const freq = { lose: 120, explode: 90, flag: 540, invalid: 200, win: 880 }[cue] ?? 740;
    osc.frequency.setValueAtTime(freq, context.currentTime);
    gain.gain.setValueAtTime(0.035, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.09);
    osc.connect(gain).connect(context.destination);
    osc.start();
    osc.stop(context.currentTime + 0.1);
  } catch { /* sound is optional */ }
}
