# Replay format, version 1

Stillplay runs the same original-authored C WebAssembly modules in the browser and in Node. A replay records the initial game configuration and input actions. It contains no program code, original executable, or Microsoft assets. This format proves reproducibility in this implementation; it does not establish equivalence with an original Windows game.

Replays use UTF-8 JSON, `version: 1`, and `game: "minesweeper"`, `"freecell"` or `"solitaire"`. The shared `src/shared.js` loader accepts a JSON string or object, enforces a 1 MiB envelope and at most 100,000 actions, then validates and plays every action through the corresponding WASM core. Unknown versions and malformed actions fail with an error. JSON fields such as a claimed score or winner are never trusted as a result: derive results by replaying.

## Minesweeper

```json
{
  "version": 1,
  "game": "minesweeper",
  "level": "beginner",
  "seed": 123,
  "actions": [
    { "type": "reveal", "x": 0, "y": 0, "t": 0 },
    { "type": "flag", "x": 3, "y": 4, "t": 1200 },
    { "type": "chord", "x": 1, "y": 1, "t": 2200 }
  ]
}
```

`level` is `beginner` (9 × 9, 10 mines), `intermediate` (16 × 16, 40 mines), or `expert` (30 × 16, 99 mines). `seed` is an unsigned 32-bit integer, including zero. `x` and `y` are zero-based board coordinates. `t` is a nonnegative safe integer representing elapsed milliseconds; timestamps must be nondecreasing. Times are informational and do not change board logic. They are client-provided values and cannot authenticate a speed record.

Actions record valid input attempts, including inputs with no resulting board change. First-click relocation and flood reveal are deterministic for a given seed and action sequence. The generator uses a CRT-style RNG, but its boards have not been compared with owner-supplied original binaries. No claim of original seed equivalence is made.

## FreeCell

```json
{
  "version": 1,
  "game": "freecell",
  "deal": 11982,
  "actions": [
    {
      "type": "move",
      "from": { "type": "column", "index": 0 },
      "to": { "type": "freecell", "index": 0 },
      "count": 1
    },
    { "type": "undo" },
    { "type": "autoMove" }
  ]
}
```

`deal` is an integer from 1 through 2,147,483,647. The familiar original range is 1–32,000. Locations use zero-based indices: `column` 0–7, `freecell` 0–3, or `foundation` 0–3. The CLI also accepts `c0`–`c7`, `f0`–`f3`, and `h0`–`h3`. Foundation indices follow clubs, diamonds, hearts, spades. `count` is the number of cards moved; omitting it means one. Multi-card moves must be descending and alternate color, and must fit the available temporary spaces.

Only successful moves, undos, and automatic foundation actions are logged. A replay with an illegal action is rejected, including an undo with no history. Hints do not modify the state and are not logged. Cards in state JSON are suit-major integers: clubs 0–12, diamonds 13–25, hearts 26–38, and spades 39–51, with ace through king in each suit. Foundation state values are top ranks/counts 0–13, not card IDs. The deal algorithm is independently implemented; verification against owner-supplied originals remains pending.

## Solitaire (Klondike)

```json
{
  "version": 1,
  "game": "solitaire",
  "seed": 7,
  "draw": 3,
  "scoring": "vegas",
  "autoFlip": true,
  "actions": [
    { "type": "draw" },
    { "type": "move", "from": { "type": "waste", "index": 0 }, "to": { "type": "tableau", "index": 2 }, "count": 1 },
    { "type": "move", "from": { "type": "tableau", "index": 6 }, "to": { "type": "foundation", "index": 0 }, "count": 1 },
    { "type": "recycle" },
    { "type": "flip", "column": 3 },
    { "type": "undo" },
    { "type": "autoMove" },
    { "type": "finish" }
  ]
}
```

`seed` is an integer from 1 through 2,147,483,647 and fully determines the deal (see `docs/solitaire-core.md`). `draw` is 1 or 3. `scoring` is `standard`, `vegas` or `none`. `autoFlip` (default `true`) turns a column's new top card face up as part of the move that uncovered it; with `false`, the face-down card waits for an explicit `flip` action. Options never change the deal itself.

Locations are `tableau` 0–6, `waste` 0, and `foundation` 0–3; the CLI also accepts `t0`–`t6`, `w` and `h0`–`h3`. Foundations are four slots: any ace may start an empty slot, then the slot follows that suit. `count` applies to tableau-to-tableau moves of a face-up run; every other move carries one card. Moves out of a foundation go to the tableau only.

Action types:

- `draw` turns one or three cards from the stock to the waste.
- `recycle` turns the waste back over into the stock when the stock is empty. Vegas allows one pass in draw one and three passes in draw three; standard and unscored games are unlimited.
- `move`, `flip` and `undo` as described above. `undo` takes back one action, including a draw or a recycle, and restores the score.
- `autoMove` sends one card that is safe to a foundation (waste first, then columns left to right).
- `finish` is one step of the automatic finish, which is available once no card is face down and the remaining stock can be reached. Each step plays the lowest card that can go home, otherwise turns the stock.

Only actions that succeeded are logged; a replay with an illegal action is rejected. Hints are not logged. The score is derived by replaying, never trusted from the file. Timed-game penalties and the cumulative Vegas bank depend on wall-clock time and on earlier games, so they live in the interface, not in the replay.

## CLI

Run from the project root after building the WASM modules:

```sh
pnpm xpc minesweeper new --level expert --seed 42 --json
pnpm xpc minesweeper click 3 4 --json
pnpm xpc minesweeper flag 5 6
pnpm xpc minesweeper chord 3 4
pnpm xpc replay export game.replay.json
pnpm xpc replay load game.replay.json --state another-game.json --json

pnpm xpc freecell deal 11982 --state cards.json --json
pnpm xpc freecell move c0 f0 --state cards.json --json
pnpm xpc freecell hint --state cards.json --json
pnpm xpc freecell undo --state cards.json
pnpm xpc freecell auto --state cards.json

pnpm xpc solitaire new --seed 7 --draw 3 --scoring vegas --state klondike.json --json
pnpm xpc solitaire draw --state klondike.json
pnpm xpc solitaire move w t2 --state klondike.json --json
pnpm xpc solitaire move t3 t5 2 --state klondike.json
pnpm xpc solitaire hint --state klondike.json --json
pnpm xpc solitaire finish --state klondike.json
```

Every command accepts `--state FILE`. The default is `.stillplay-state.json` in the current directory, or the `XPC_STATE` environment variable when set. State is saved as replay JSON, through an atomic file replacement, after each input. This is one active game per state file. `minesweeper state`, `freecell state` and `solitaire state` report it. Solitaire text output prints face-down cards as `##`; its JSON includes them, like the Minesweeper debug view. Commands with `--json` emit one JSON value. Errors go to stderr and return exit code 1. `replay export` without a filename emits replay JSON; `replay load -` reads a replay from stdin. Nothing is uploaded.

State JSON exposes the complete Minesweeper board, including unrevealed mines, for debugging and agent development. This CLI is not a hidden-information tournament interface. Public agent submission and anti-cheat policy are future work.

## Daily challenge

`dailySeed(YYYY-MM-DD)` hashes `stillplay:YYYY-MM-DD` using unsigned FNV-1a. Dates are UTC and the shared challenge changes at midnight UTC. The FreeCell daily deal is `dailySeed(date) % 32000 + 1`. All clients running this version derive the same seed/deal without a server. This mapping is not an original-game feature.

## Local executable inspection

`inspectExecutable(arrayBuffer)` from `src/pe-resources.js` reads PE headers and resource directories, computes SHA-256 with browser Web Crypto, and wraps supported `RT_BITMAP` DIBs in BMP headers. It never executes the program and contains no network calls. Files and extracted art stay in browser memory; no original binaries or assets are saved in the repository. The caller should also avoid analytics or persistence of the supplied file.

The return value contains `metadata`, `sha256`, `resources`, `bitmaps`, `warnings`, and candidate `minesweeper` strip mappings. Tiles are recognized as 16 × 16 strips, faces as 26 × 26, and digits as 13 × 23, in either orientation. Each candidate reports its `id`, `bmp`, `cellWidth`, `cellHeight`, `direction`, and `count`. Dimension matching does not establish frame ordering or resource identity. `minesweeper.verified` remains false; an imported-resource preview is not an authenticated original skin. The playable Original pixels mode must keep using our own art until a mapping is verified with the owner's binaries.

The parser bounds-checks PE structures, resource subdirectories, and file-backed RVAs; it rejects cycles, excessive nesting, oversized resource trees, unsupported compression, and truncated bitmap palettes/pixels. Linker versions are metadata, not proof of a matching compiler. SHA-256 identifies a supplied file, not its provenance.
