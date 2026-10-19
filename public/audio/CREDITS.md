# Sound credits

Every sound in `sprite.webm` / `sprite.m4a` was made for Stillplay. None of them comes from Windows or any other Microsoft product, and none copies an original game sound.

There are two sources:

- **Generated** with [Mirelo SFX 2.0](https://fal.ai/models/mirelo-ai/sfx2.0/text-to-audio) (`mirelo-ai/sfx2.0/text-to-audio`), a text-to-sound model, called through fal's paid API on 2026-10-18. Each cue was generated as several candidates. We picked one by measurement, then trimmed it, high-passed it, faded it and level-matched it to the other cues.
- **Synthesised** by our own code: decaying sine partials tuned like a marimba, a bell, a wood block or glass, plus a few milliseconds of filtered noise for the strike. These are exact pitches with no third-party input.

## Licence

As far as we can tell, the terms below let these sounds ship in an MIT-licensed open-source project. This is a reading of the terms, not legal advice.

- Mirelo Terms of Service (last updated 2026-10-09). §7.3: any intellectual property rights that arise in an output "vest exclusively" in the user. Paid users may use the services and outputs commercially (§2.2), and outputs may be used outside the service (§7.6). The non-commercial limit and the attribution duty in §7.5 apply to free-plan output only. Ours came through a paid account, and we credit Mirelo here anyway. §6.3 says other users may get the same or similar output.
- fal Terms of Service (last updated 2026-09-08). fal claims no ownership of output content and gives no warranty that it is original (§4(c)). Third-party models may carry extra terms (§14), and the model page labels this one "Commercial use".
- AI-generated audio may not qualify for copyright protection at all. Where it does, the rights are ours to release under this repository's MIT licence. The synthesised cues are original code output under the same licence.

## Cues

| Cue | Source | Prompt or recipe |
|---|---|---|
| `ui-tap` | Synthesised | Modal wood click, 1.65 kHz |
| `toggle-on` | Synthesised | Two wood clicks, 1.35 then 1.9 kHz |
| `toggle-off` | Synthesised | Two wood clicks, 1.8 then 1.25 kHz |
| `new-game` | Generated | A small stack of wooden game tiles gently squared on a felt table followed by one soft wooden knock, tidy and calm, close-mic, dry studio foley, isolated, quiet |
| `invalid` | Generated | Two quick soft muted knocks on a small hollow wooden box, close-mic foley, dry, isolated |
| `win` | Synthesised | Marimba C5 E5 G5 to C6 with a soft C7 bell |
| `lose` | Synthesised | Marimba A4 to E4 |
| `undo` | Generated | A single playing card slid backwards across a felt table, one soft quick papery swish, close-mic foley, dry, isolated |
| `reveal` | Generated | A single small wooden domino tile tapped down on a wooden table, one short warm tock, close-mic foley, dry, isolated |
| `reveal-cascade` | Generated | A quick soft ripple of a dozen small wooden tiles flipping over one after another on a felt table, brief, close-mic, dry studio foley, isolated, quiet |
| `flag` | Generated | A small wooden peg pressed snugly into a hole in a wooden board, one short soft click, close-mic foley, dry, isolated |
| `unflag` | Generated | A small wooden peg pulled out of a hole in a wooden board, one short soft hollow pop, close-mic foley, dry, isolated |
| `explode` | Generated | A small paper bag bursting under a thick blanket, one muffled soft pop with a short low thump, gentle, close-mic foley, dry, isolated |
| `chord` | Generated | Three quick soft clicks of small wooden tiles lifted in rapid succession, close-mic, dry studio foley, isolated, quiet |
| `card-pick` | Generated | A single playing card peeled off a table and lifted, one quick soft crisp paper sound, close-mic foley, dry, isolated |
| `card-place` | Generated | A single playing card set down flat onto a green felt card table, one soft papery tap, close-mic, dry studio foley, isolated, quiet |
| `card-flip` | Generated | A single playing card flipped face up on a table, one crisp soft paper flick, close-mic, dry studio foley, isolated, quiet |
| `card-deal` | Generated | A single playing card dealt and sliding across a felt card table, one quick soft swish, close-mic, dry studio foley, isolated, quiet |
| `card-shuffle` | Generated | A quick riffle shuffle of a deck of playing cards, crisp fluttering cards, about one second long, close-mic foley, dry, isolated |
| `foundation` | Generated + synthesised | Generated card tap ("A playing card placed neatly onto a squared stack of cards with a crisp soft tap, satisfying, close-mic, dry studio foley, isolated, quiet") layered with a synthesised marimba C6 tock |
| `stock-recycle` | Generated | A small deck of playing cards tapped twice on a table to square it, two crisp quick taps, close-mic foley, dry, isolated |
| `cascade-bounce` | Generated | A single playing card bouncing lightly once on a felt table, a tiny soft paper flutter, close-mic, dry studio foley, isolated, quiet |
| `run-complete` | Generated + synthesised | Generated card sweep ("A run of playing cards swept together into one neat stack with a soft swish and a gentle final tap, satisfying, close-mic, dry studio foley, isolated, quiet") layered with a synthesised marimba G5 to C6 |
| `trick-take` | Generated | Four playing cards gathered from a felt table into a small pile with one soft quick swish, close-mic, dry studio foley, isolated, quiet |
| `hearts-broken` | Synthesised | Glass tink (2.35 kHz, inharmonic partials) with a tiny crack |
| `queen-of-spades` | Synthesised | Low marimba D4 + F4 |
| `shoot-the-moon` | Synthesised | Bell arpeggio C5 to C7 into a marimba C major chord |

Shared negative prompt for generated cues: "music, voice, speech, reverb, echo, room tone, hiss, hum, noise, background ambience, distortion, loud, harsh" (second-round prompts also exclude "rumble").

## Format

One sprite holds all cues back to back, with 0.12 s of silence between them. `sprite.json` maps each cue to `[start, duration]` in seconds.

- `sprite.webm` is Opus at 40 kbps VBR, mono, 48 kHz, about 149 KB. It decodes through Web Audio `decodeAudioData` in Chrome, Edge, Firefox and Safari 17.4+ on macOS and iOS.
- `sprite.m4a` is AAC-LC at 64 kbps, mono. The engine fetches it only when the WebM will not decode, for example on older Safari.
- Nothing is downloaded until the player turns sound on.

To rebuild, put one mastered WAV per cue, named `<cue>.wav`, in a folder and run `node scripts/build-audio.mjs <folder>` (needs ffmpeg with libopus). The mastered sources are kept outside the repository.
