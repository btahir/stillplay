# Hearts core

`cores/hearts.c` is our own rules and computer players, written from scratch in C
and compiled to one freestanding WebAssembly module for the browser and Node
(`src/hearts-core.js`). Deals come from our own seeded shuffle.

## Rules implemented

- Four seats: 0 is you (south), 1 west, 2 north, 3 east. Play runs 0 → 1 → 2 → 3.
- Each hand deals 13 cards per seat (Fisher–Yates over PCG32; the stream
  continues hand to hand, so a seed fixes every deal of the game).
- Passing rotates left, right, across, hold. Left means seat + 1. All four
  seats choose before any card moves.
- The two of clubs leads the first trick. Players must follow suit. On the first
  trick nobody may play a heart or the queen of spades unless they hold nothing
  else (then any card is allowed).
- Hearts cannot be led until a heart has been played, unless the leader holds
  only hearts. The queen of spades does not break hearts.
- The highest card of the led suit wins; aces are high. Each heart is 1 point,
  the queen of spades 13.
- Taking all 26 points shoots the moon: 0 for the shooter, 26 for everyone else.
- After a hand, the game ends if anyone has 100 or more. The lowest total wins;
  ties share the win. There is no undo, as in the classic game.

## Adapter

```js
import { createHearts, loadHeartsReplay } from './hearts-core.js';
const game = await createHearts({ seed: 1, difficulty: 1 }); // 0 casual, 1 standard
// Optional: players: ['human' | kind, kind, kind, kind], kind = 'random' | 'casual' | 'standard'.

game.state({ reveal = false })
// { seed, difficulty, players, phase: 'pass' | 'play' | 'handOver' | 'gameOver',
//   handNumber, passDirection: 'left' | 'right' | 'across' | 'hold', passTo,
//   turn,                     // seat to play, or null
//   cards,                    // your hand, sorted by suit then rank (ace high)
//   legal,                    // cards you may play now ([] when it is not your turn)
//   handSizes, heartsBroken, tricksPlayed,
//   trick: [{ seat, card }],  // the trick in progress
//   tricks: [{ leader, plays: [{ seat, card }], winner, points }], // finished tricks this hand
//   passed, received,         // your pass this hand and what you were given
//   handPoints, scores, history: [[4 numbers] per finished hand],
//   lastHand: { points, moon } | null, winners,
//   hands?, passedBy? }       // only with reveal
game.pass([a, b, c]) · game.play(card) · game.canPlay(card) · game.nextHand()
game.hint()   // { type: 'pass', cards } | { type: 'play', card } | null
game.replay() · game.newGame({ seed, difficulty, players })
```

Computer seats play inside the core. When `pass`, `play` or `nextHand`
returns, every computer card up to your next decision is already played. To
animate, diff `tricks` and `trick` against the previous state and play the new
cards in order; a finished trick stays in `tricks` with its winner. Without
`reveal`, state contains your hand and public information only.

## Computer players

They are fair: each decision reads only its own hand and public information
(cards played, suits a seat failed to follow, points taken, its own pass). This
is a property of the code (`choose_*` in `cores/hearts.c`), not something the
tests can prove.

- **Standard** passes the queen of spades and the ace or king of spades unless it
  holds four or more low spades, keeps low spades, gives away high hearts, and
  empties short clubs or diamonds. In play it leads low cards in suits where
  higher cards are still out, leads low spades to flush the queen, ducks under
  the current winner with its highest losing card, plays high on the first trick,
  and when void dumps the queen, then the ace or king of spades, then high hearts.
  If one rival has taken every point so far, it stops feeding them, tries to take
  a heart itself and leads a heart nobody can beat. With a very strong hand (five
  or more hearts headed by ace-king-queen, six sure winners and seven cards
  queen or higher) it tries to shoot
  the moon and drops the attempt once anyone else takes a point. It never uses
  randomness, so hints for you come from the same judgement.
- **Casual** passes high cards and the queen with some noise, ducks when it can,
  dumps the queen and hearts, and plays a random legal card 15% of the time
  after the first trick.
- **Random** plays and passes uniformly at random (measurement only).

Measured on 2026-10-18 over 1,000 games per row (seeds 1–1000, every card audited
against an independent rule check; tests/hearts.test.mjs):

| Seat 0 | Seats 1–3 | Seat 0 wins | Points per hand (seat 0 / others) |
| --- | --- | --- | --- |
| standard | random | 96.7% | 1.61 / 8.2–8.4 |
| random | standard | 0.3% | 15.31 / 4.0–4.3 |
| casual | random | 91.5% | 2.42 / 8.1–8.2 |
| standard | casual | 54.9% | 4.82 / 6.9–7.6 |
| standard | standard | 24.2% (others 24.3–26.7%) | 6.69 / 6.55–6.67 |

Four standard players shoot the moon in about 1% of hands. Strength against
people is unmeasured.

## Replays

`{ version: 1, game: 'hearts', seed, difficulty, players, actions }`, with
actions `{ type: 'pass', cards: [a, b, c] }`, `{ type: 'play', card }` and
`{ type: 'nextHand' }`. Computer play is deterministic for a given seed and
action list, so only your decisions are stored. `players` may be omitted; it
then follows `difficulty`.
