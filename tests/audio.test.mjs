import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { CUES, cueSettings, play, preloadSounds, soundEnabled, validateSpriteMap, variation } from '../src/audio.js';

const spriteUrl = new URL('../public/audio/sprite.json', import.meta.url);
const map = JSON.parse(readFileSync(spriteUrl, 'utf8'));
const clone = () => structuredClone(map);

// Short interface cues must stay short; nothing may run longer than a short win sting.
const SHORT_CUES = ['ui-tap', 'toggle-on', 'toggle-off', 'reveal', 'flag', 'unflag', 'invalid', 'undo',
  'card-pick', 'card-place', 'card-flip', 'card-deal', 'cascade-bounce'];

test('cue names are unique kebab-case words', () => {
  assert.equal(new Set(CUES).size, CUES.length);
  for (const cue of CUES) assert.match(cue, /^[a-z]+(-[a-z]+)*$/);
});

test('the committed sprite map covers every cue exactly once without overlaps', () => {
  assert.equal(validateSpriteMap(map), true);
  assert.deepEqual(Object.keys(map.cues).sort(), [...CUES].sort());
});

test('cue lengths stay in their budgets', () => {
  for (const cue of SHORT_CUES) {
    const [, duration] = map.cues[cue];
    assert.ok(duration >= 0.04 && duration <= 0.25, `${cue} is ${duration}s`);
  }
  for (const cue of CUES) assert.ok(map.cues[cue][1] <= 2.6, `${cue} is too long`);
});

test('sprite files exist and stay small', () => {
  const sizes = map.sources.map(({ src }) => statSync(new URL(`../public/audio/${src}`, import.meta.url)).size);
  assert.ok(sizes[0] <= 155 * 1024, `primary sprite is ${sizes[0]} bytes`);
  for (const size of sizes) assert.ok(size > 10 * 1024);
});

test('validateSpriteMap rejects broken maps', () => {
  const missing = clone(); delete missing.cues.win;
  assert.throws(() => validateSpriteMap(missing), /missing: win/);
  const unknown = clone(); unknown.cues.kazoo = [30, 0.1];
  assert.throws(() => validateSpriteMap(unknown), /unknown cues: kazoo/);
  const overlap = clone(); overlap.cues['toggle-on'] = [map.cues['ui-tap'][0] + 0.01, 0.1];
  assert.throws(() => validateSpriteMap(overlap), /overlap/);
  const nan = clone(); nan.cues.reveal = [Number.NaN, 0.1];
  assert.throws(() => validateSpriteMap(nan), /\[start, duration\]/);
  const empty = clone(); empty.cues.reveal = [map.cues.reveal[0], 0];
  assert.throws(() => validateSpriteMap(empty), /empty duration/);
  const path = clone(); path.sources[0].src = '../secret.webm';
  assert.throws(() => validateSpriteMap(path), /plain file name/);
  assert.throws(() => validateSpriteMap(null), /object/);
});

test('every cue has sane playback rules and bounded variation', () => {
  for (const cue of CUES) {
    const s = cueSettings(cue);
    assert.ok(Number.isInteger(s.voices) && s.voices >= 1 && s.voices <= 8, cue);
    assert.ok(s.gap >= 0 && s.gap <= 1, cue);
    assert.ok(s.pitch >= 0 && s.pitch <= 0.1, cue);
    for (const r of [0, 0.5, 0.999999]) {
      const v = variation(cue, () => r);
      assert.ok(Math.abs(v.rate - 1) <= s.pitch + 1e-9, `${cue} rate ${v.rate}`);
      assert.ok(v.gain > 0 && v.gain <= 10 ** (s.gain / 20) + 1e-9, `${cue} gain ${v.gain}`);
    }
  }
  // Tonal stings stay nearly in tune (within 8 cents).
  for (const cue of ['win', 'lose', 'shoot-the-moon', 'queen-of-spades']) assert.ok(cueSettings(cue).pitch <= 0.005, cue);
});

test('the engine stays silent and safe outside a browser', async () => {
  assert.equal(soundEnabled(), false);
  assert.doesNotThrow(() => play('win'));
  assert.equal(await preloadSounds(), false);
});
