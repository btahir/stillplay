# Spider Solitaire core

`cores/spider.c` is our own rules code, written from scratch in C and compiled
to one freestanding WebAssembly module for the browser and Node
(`src/spider-core.js`). Deals come from our own seeded shuffle, so seed numbers
are Stillplay's own.

## Rules implemented

- Two decks, 104 cards. 1 suit uses only spades, 2 suits spades and hearts,
  4 suits two full decks.
- Shuffle: Fisher–Yates driven by PCG32 (`seed` is any unsigned 32-bit integer,
  the stream depends on the suit count). The first 54 cards are dealt row by row
  into ten columns (columns 0–3 get six, 4–9 get five); only the top card of each
  column is face up. The other 50 form the stock: five deals of ten.
- A face-up, same-suit, descending run at the top of a column moves as a unit
  onto a card one rank higher of any suit, or onto an empty column. The newly
  exposed card turns face up.
- A row can be dealt only while every column holds a card (the classic rule).
  With fewer than ten cards on the table and stock remaining, the game is stuck.
- A king-to-ace run of one suit leaves the table automatically, after a move or a
  deal (a deal can complete several at once). Eight runs win.
- Score: `500 − actions + 100 × completed runs`. Every move, deal and undo is an
  action. Undo restores the previous layout, including face-down cards and any
  completed run, and costs a point like any action. The score can go below zero.
  This follows the commonly described classic rule; the undo cost is our choice.
- Undo goes back up to 4,096 actions (compact 126-byte snapshots).

## Adapter

```js
import { createSpider, loadSpiderReplay } from './spider-core.js';
const game = await createSpider({ seed: 1, suits: 1 }); // suits 1 | 2 | 4

game.state({ reveal = false })
// { seed, suits, status: 'playing' | 'won', score, moves,
//   columns: [[{ uid, card, faceUp }]],   // 10 columns, index 0 = covered bottom
//   stock, dealsLeft, completed: [suit],   // suit of each finished run, in order
//   canDeal, canUndo, hasMoves,
//   stockCards? }                          // only with reveal
game.move(from, to, count?)   // columns 0-9 or 'c0'-'c9'; count defaults to the longest fitting run
game.canMove(from, to, count?) · game.movableCount(column)
game.deal() · game.canDeal() · game.undo() · game.canUndo()
game.hint()      // cycles: each call returns the next suggestion, wrapping; resets after any action
game.hints()     // the whole ranked list: { type: 'move', from, to, count } | { type: 'deal' }
game.hasMoves()  // false when no useful move and no deal remain
game.lastChange()// { flipped: [columns], completed: [columns] } for the last action
game.isWon() · game.positionKey() · game.replay() · game.newGame({ seed, suits })
```

`uid` (0–103) identifies the physical card for the whole game; use it as the DOM
key so animations follow a card. `card` is the shared face id from
`src/cards.js`, or `null` while face down. Mutating methods return `true` or
`false`; nothing throws on an illegal move.

## Hints and the simple player

Hints score every legal move: completing a run, building on the same suit,
turning a face-down card, emptying a column, and (lowest) filling an empty
column so a row can be dealt. Pointless moves are left out: a whole column into
an empty one, or a run moved from one natural parent to another that is no
better. A deal, when allowed, is always the last suggestion. A hint is legal; it
is not a promise that the deal stays winnable.

`src/spider-solver.js` plays on top of the public adapter. `greedy` always takes
the best-ranked hint that reaches a new position; `search` is a depth-first
search over the same list with undo. An action budget counts every move, deal
and undo the player tries. Measured on 2026-10-18 (the test suite repeats a
smaller sample: greedy on seeds 1–300, search on 1–100):

| Deal set | Strategy | Won |
| --- | --- | --- |
| 1 suit, seeds 1–1000 | greedy, 20,000 actions | 433 (43.3%) |
| 1 suit, seeds 1–1000 | search, 20,000 actions | 775 (77.5%) |
| 1 suit, seeds 1–200 | search, 100,000 actions | 160 (80%) |
| 2 suits, seeds 1–100 | search, 20,000 actions | 8 (8%) |
| 4 suits, seeds 1–100 | search, 20,000 actions | 0 |

These measure our simple player, not how many deals can be won.

## Replays

`{ version: 1, game: 'spider', seed, suits, actions }`, where each action is
`{ type: 'move', from, to, count }`, `{ type: 'deal' }` or `{ type: 'undo' }`.
Only successful actions are logged; loading rejects any action the core refuses.
