#!/usr/bin/env node
/**
 * Packs one mastered WAV per sound cue into a single audio sprite plus an offset map.
 *
 *   node scripts/build-audio.mjs <dir-with-one-wav-per-cue>
 *
 * Writes public/audio/sprite.webm (Opus, primary), public/audio/sprite.m4a (AAC, fetched only
 * when the browser cannot decode the WebM) and public/audio/sprite.json. Needs ffmpeg with libopus.
 * The mastered sources live outside the repo (see public/audio/CREDITS.md); the cue list comes from
 * src/audio.js so a missing or extra cue fails the build.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CUES, validateSpriteMap } from '../src/audio.js';

const SAMPLE_RATE = 48000;
const LEAD_IN = 0.1; // seconds of silence before the first cue (gives decoders room for priming)
const GAP = 0.12; // seconds of silence between cues, so a slightly misaligned decoder never bleeds cues together
const OPUS_KBPS = 40;
const AAC_KBPS = 64;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public/audio');
const source = process.argv[2];
if (!source || !existsSync(source)) {
  console.error('Usage: node scripts/build-audio.mjs <dir-with-one-wav-per-cue>');
  process.exit(1);
}

function decode(file) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}

const missing = CUES.filter((cue) => !existsSync(join(source, `${cue}.wav`)));
if (missing.length) throw new Error(`Missing sources for: ${missing.join(', ')}`);

// Lay the cues out end to end.
const clips = CUES.map((cue) => ({ cue, samples: decode(join(source, `${cue}.wav`)) }));
const gap = Math.round(GAP * SAMPLE_RATE);
const total = Math.round(LEAD_IN * SAMPLE_RATE) + clips.reduce((sum, c) => sum + c.samples.length + gap, 0);
const sprite = new Float32Array(total);
const cues = {};
let cursor = Math.round(LEAD_IN * SAMPLE_RATE);
for (const { cue, samples } of clips) {
  sprite.set(samples, cursor);
  cues[cue] = [+(cursor / SAMPLE_RATE).toFixed(4), +(samples.length / SAMPLE_RATE).toFixed(4)];
  cursor += samples.length + gap;
}

// Alignment marker: where the first cue first crosses 20 dB below its own peak.
const first = clips[0].samples;
const firstPeak = first.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const alignThreshold = firstPeak / 10;
const alignAt = (Math.round(LEAD_IN * SAMPLE_RATE) + first.findIndex((v) => Math.abs(v) >= alignThreshold)) / SAMPLE_RATE;

const work = mkdtempSync(join(tmpdir(), 'stillplay-audio-'));
try {
  const wav = join(work, 'sprite.wav');
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + total * 4, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(SAMPLE_RATE, 24); header.writeUInt32LE(SAMPLE_RATE * 4, 28);
  header.writeUInt16LE(4, 32); header.writeUInt16LE(32, 34); header.write('data', 36); header.writeUInt32LE(total * 4, 40);
  writeFileSync(wav, Buffer.concat([header, Buffer.from(sprite.buffer)]));

  const encoders = execFileSync('ffmpeg', ['-v', 'error', '-encoders']).toString();
  const aac = encoders.includes('aac_at') ? 'aac_at' : 'aac';
  const common = ['-v', 'error', '-y', '-i', wav, '-ac', '1', '-map_metadata', '-1', '-fflags', '+bitexact'];
  execFileSync('ffmpeg', [...common, '-c:a', 'libopus', '-b:a', `${OPUS_KBPS}k`, '-vbr', 'on', '-application', 'audio', '-frame_duration', '20', join(out, 'sprite.webm')]);
  execFileSync('ffmpeg', [...common, '-c:a', aac, '-b:a', `${AAC_KBPS}k`, '-movflags', '+faststart', join(out, 'sprite.m4a')]);
} finally {
  rmSync(work, { recursive: true, force: true });
}

const map = {
  version: 1,
  sampleRate: SAMPLE_RATE,
  sources: [{ src: 'sprite.webm', type: 'audio/webm; codecs="opus"' }, { src: 'sprite.m4a', type: 'audio/mp4; codecs="mp4a.40.2"' }],
  align: { at: +alignAt.toFixed(4), threshold: +alignThreshold.toFixed(4) },
  cues,
};
validateSpriteMap(map);
writeFileSync(join(out, 'sprite.json'), `${JSON.stringify(map, null, 1)}\n`);

// Report: sizes, and how far each encoded file's alignment marker moved (ffmpeg honours pre-skip/edit lists).
for (const file of ['sprite.webm', 'sprite.m4a']) {
  const decoded = decode(join(out, file));
  const found = decoded.findIndex((v) => Math.abs(v) >= alignThreshold) / SAMPLE_RATE;
  console.log(`${file}: ${(statSync(join(out, file)).size / 1024).toFixed(1)} KB, ${(decoded.length / SAMPLE_RATE).toFixed(2)} s, marker drift ${((found - alignAt) * 1000).toFixed(1)} ms`);
}
console.log(`sprite.json: ${CUES.length} cues, ${(total / SAMPLE_RATE).toFixed(2)} s, ${statSync(join(out, 'sprite.json')).size} bytes`);
JSON.parse(readFileSync(join(out, 'sprite.json'), 'utf8'));
