# FreeCell core

`cores/freecell.c` is our own rules code, written from scratch in C and compiled
to one freestanding WebAssembly module for the browser and Node
(`src/freecell-core.js`).

The classic numbered-deal algorithm was checked on 2026-10-17 against the current
official FreeCell Solver repository:

- [Board generator documentation](https://github.com/shlomif/fc-solve/blob/master/fc-solve/source/board_gen/README)
- [Documented CRT random-number algorithm](https://github.com/shlomif/fc-solve/blob/master/fc-solve/source/gen_ms_boards__rand.h)
- [Deck ordering and dealing algorithm](https://github.com/shlomif/fc-solve/blob/master/fc-solve/source/range_solvers_gen_ms_boards.h)
- [Published deal #24 fixture](https://github.com/shlomif/fc-solve/blob/master/fc-solve/source/t/t/board-gen.t)
- [Published deal #240 fixture](https://github.com/shlomif/fc-solve/blob/master/cpan/Freecell-Deal-MS/t/deal-ms.t)

No source from that project is copied into Stillplay. Our implementation uses
the described algorithm: 32-bit wrapping state, recurrence `s = 214013*s +
2531011`, output `(s >> 16) & 32767`, an initial rank-major deck in clubs,
diamonds, hearts, spades order, swap-removal of each drawn card, and dealing
left to right into eight columns. The tests include the complete known deal #1
and the published factual card layouts for deals #24 and #240.

The supported deal range is 1–2147483647; the classic 32,000 deals are a subset.
Extended 33-bit FreeCell Pro numbering is deliberately outside this range.
The adapter uses suit-major IDs: rank is `id % 13 + 1`, suit is `floor(id / 13)`;
suits 0–3 are clubs, diamonds, hearts, spades. Foundation values are top ranks
0–13, where 0 is empty. Columns run from covered top to playable bottom.

Moves support single cards, ordered descending alternating-colour sequences,
and supermoves with capacity `(emptyFreecells + 1) * 2^emptyColumns`. An empty
destination is excluded from the temporary empty columns. Foundations are
one-way; undo restores any move, including a foundation move. Up to the most
recent 4096 moves can be undone. `hint()` returns a legal move, not a solution
guarantee. `autoMove()` performs one conservatively safe foundation move.

Version 1 replays contain `{version:1, game:'freecell', deal, actions}`. Actions
are successful `move`, `undo`, or `autoMove` operations in order; rejected moves
are not recorded. Each move contains `from`, `to`, and `count`; locations are
`{type:'column'|'freecell'|'foundation', index}` with zero-based indexes.
Replay loading validates the range and each operation, and rejects invalid
logs instead of silently accepting partial state.
