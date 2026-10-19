# Solitaire (Klondike) core

`cores/solitaire.c` is original-authored rules code, compiled to the same
freestanding WebAssembly module for the browser and Node. It is **not a
matching decompilation** and has not been compared with an original
executable.

## Deals

Klondike has no famous numbered deals, so Stillplay documents its own:

1. Seed a 32-bit `mulberry32` generator with the deal number (1–2147483647).
2. Start from cards 0–51 in suit-major order (clubs, diamonds, hearts,
   spades; ace to king).
3. Fisher–Yates: for `i` from 51 down to 1, swap `deck[i]` with
   `deck[next() % (i + 1)]`.
4. Deal row by row, left to right: row 0 puts one card on each of the seven
   columns, row 1 on columns 1–6, and so on. The last card in each column is
   face up.
5. `deck[28..51]` becomes the stock; `deck[51]` is drawn first.

`tests/solitaire.test.mjs` re-implements these steps in JavaScript and checks
2,000 seeds against the C core. The daily deal is `dailyDeal()` from
`src/shared.js`, the same number for everyone.

## Rules and scoring

- Build down in alternating colours. Only kings (or king-led runs) go to an
  empty column. Any face-up run can move together.
- Foundations are four slots. Any ace starts an empty slot; then the slot
  takes the next card of that suit. A foundation card may come back to the
  tableau.
- Draw one or draw three. The waste fan (up to three cards) is part of the
  state, so the interface shows exactly what the classic did.
- Standard scoring: waste to tableau +5, waste to foundation +10, tableau to
  foundation +10, turning over a tableau card +5, foundation to tableau −15.
  Recycling the waste costs 100 points in draw one; in draw three the first
  three passes are free and each later pass costs 20. The score never goes
  below zero.
- Vegas scoring: −$52 to deal, +$5 for each card on a foundation and −$5 if
  one comes back. One pass through the stock in draw one, three in draw
  three. The cumulative bank is kept by the interface.
- Timed games (standard scoring): −2 points per 10 seconds and, for a win that
  took at least 30 seconds, a bonus of 700,000 ÷ seconds. The core applies
  these from a seconds value (`sol_timed_score`), so the rule is in C while
  the clock stays in the interface.

These values are the commonly documented Windows rules
([Klondike on Wikipedia](https://en.wikipedia.org/wiki/Klondike_(solitaire)),
retrieved 2026-10-18). The draw-three pass penalty is less well documented;
we follow the common "three free passes, then −20" description. None of this
has been checked against the original program.

## Helpers

- `sol_hint` returns a legal, sensible step: turn a card, uncover a
  face-down card, send a card home, play the waste, fill an empty column
  with a king, then turn the stock. It is not a solver.
- `sol_auto_move` sends one safe card home: aces and twos always, higher
  cards once both opposite-colour foundations hold the rank below.
- `sol_can_autofinish` is true once no card is face down and every stock
  card can still be reached (empty stock and waste, or draw one with
  unlimited passes). `sol_finish_step` then always reaches a win.
