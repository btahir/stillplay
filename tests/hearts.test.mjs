import test from 'node:test';
import assert from 'node:assert/strict';
import { createHearts, loadHeartsReplay } from '../src/hearts-core.js';
import { loadReplay } from '../src/shared.js';

/** Deterministic test randomness (mulberry32). */
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const suit = card => Math.floor(card / 13);
const power = card => (card % 13 + 12) % 13;
const points = card => (card === 50 ? 13 : suit(card) === 2 ? 1 : 0);
const TWO_CLUBS = 1;
const sorted = cards => [...cards].sort((a, b) => a - b);
const pick = (rng, list) => list[Math.floor(rng() * list.length)];

/** Independent statement of the rules, used to audit every card the core accepts or plays. */
function legalCards(hand, trick, tricksPlayed, heartsBroken) {
  if (!trick.length) {
    if (tricksPlayed === 0) return hand.filter(card => card === TWO_CLUBS);
    const nonHearts = hand.filter(card => suit(card) !== 2);
    return heartsBroken || !nonHearts.length ? hand : nonHearts;
  }
  const follow = hand.filter(card => suit(card) === suit(trick[0].card));
  if (follow.length) return follow;
  if (tricksPlayed === 0) {
    const safe = hand.filter(card => points(card) === 0);
    if (safe.length) return safe;
  }
  return hand;
}

/**
 * Replays a finished hand from its public log, checking legality of every
 * card, trick winners, trick points and the 26-point total.
 */
function auditHand(tricks, expectedPoints) {
  assert.equal(tricks.length, 13);
  const hands = [[], [], [], []];
  tricks.forEach(trick => trick.plays.forEach(play => hands[play.seat].push(play.card)));
  hands.forEach(hand => assert.equal(hand.length, 13, 'each seat plays 13 cards'));
  assert.deepEqual(sorted(hands.flat()), Array.from({ length: 52 }, (_, i) => i), 'all 52 cards are played once');
  assert.ok(hands[tricks[0].leader].includes(TWO_CLUBS), 'the holder of the two of clubs leads');
  let heartsBroken = false, leader = tricks[0].leader;
  const taken = [0, 0, 0, 0];
  tricks.forEach((trick, number) => {
    assert.equal(trick.leader, leader);
    const seen = [];
    trick.plays.forEach((play, index) => {
      assert.equal(play.seat, (leader + index) % 4, 'play goes clockwise');
      const legal = legalCards(hands[play.seat], seen, number, heartsBroken);
      assert.ok(legal.includes(play.card), `illegal card ${play.card} by seat ${play.seat} on trick ${number}`);
      hands[play.seat].splice(hands[play.seat].indexOf(play.card), 1);
      seen.push(play);
    });
    if (seen.some(play => suit(play.card) === 2)) heartsBroken = true;
    const led = suit(seen[0].card);
    const winner = seen.filter(play => suit(play.card) === led).reduce((a, b) => (power(b.card) > power(a.card) ? b : a)).seat;
    const trickPoints = seen.reduce((sum, play) => sum + points(play.card), 0);
    assert.equal(trick.winner, winner, 'highest card of the led suit wins');
    assert.equal(trick.points, trickPoints);
    taken[winner] += trickPoints;
    leader = winner;
  });
  assert.equal(taken.reduce((a, b) => a + b), 26, '26 points in every hand');
  const moon = taken.indexOf(26);
  const scored = moon < 0 ? taken : taken.map((_, seat) => (seat === moon ? 0 : 26));
  if (expectedPoints) assert.deepEqual(expectedPoints, scored);
  return { taken, scored, moon: moon < 0 ? null : moon };
}

function checkTotals(state) {
  const totals = [0, 0, 0, 0];
  state.history.forEach(hand => hand.forEach((value, seat) => { totals[seat] += value; }));
  assert.deepEqual(state.scores, totals, 'scores are the sum of the hand history');
  state.history.forEach(hand => {
    const sum = hand.reduce((a, b) => a + b);
    assert.ok(sum === 26 || sum === 78, 'a hand scores 26 points, or 78 after a moon shot');
  });
  const over = state.scores.some(score => score >= 100);
  if (state.phase === 'gameOver') {
    assert.ok(over);
    const best = Math.min(...state.scores);
    assert.deepEqual(state.winners, [0, 1, 2, 3].filter(seat => state.scores[seat] === best));
  } else assert.ok(!over, 'the game ends as soon as someone reaches 100');
}

test('the deal gives 13 distinct cards to each seat and hides the rivals', async () => {
  for (let seed = 0; seed < 200; seed++) {
    const game = await createHearts({ seed });
    const state = game.state({ reveal: true });
    assert.equal(state.phase, 'pass');
    assert.equal(state.passDirection, 'left');
    assert.equal(state.passTo, 1);
    assert.deepEqual(state.handSizes, [13, 13, 13, 13]);
    assert.deepEqual(sorted(state.hands.flat()), Array.from({ length: 52 }, (_, i) => i));
    assert.deepEqual(sorted(state.cards), sorted(state.hands[0]));
    const hidden = game.state();
    assert.equal(hidden.hands, undefined);
    assert.equal(hidden.passedBy, undefined);
    assert.deepEqual(hidden.legal, []);
    assert.equal(hidden.turn, null);
  }
});

test('passing: three of your cards, simultaneous exchange, left/right/across/hold rotation', async () => {
  const directions = [];
  const game = await createHearts({ seed: 11, difficulty: 1 });
  const rng = random(11);
  for (let hand = 0; hand < 8 && game.state().phase !== 'gameOver'; hand++) {
    let state = game.state({ reveal: true });
    directions.push(state.passDirection);
    assert.equal(state.handNumber, hand);
    if (state.passDirection !== 'hold') {
      assert.equal(state.phase, 'pass');
      const mine = state.cards;
      assert.equal(game.pass([mine[0], mine[0], mine[1]]), false, 'duplicates are rejected');
      assert.equal(game.pass([mine[0], mine[1]]), false, 'exactly three cards');
      const foreign = state.hands[1][0];
      assert.equal(game.pass([mine[0], mine[1], foreign]), false, 'only your own cards');
      assert.equal(game.play(mine[0]), false, 'no play during the pass');
      const hint = game.hint();
      assert.equal(hint.type, 'pass');
      assert.equal(new Set(hint.cards).size, 3);
      assert.ok(hint.cards.every(card => mine.includes(card)));
      const before = game.state({ reveal: true });
      assert.equal(game.pass(hint.cards), true);
      assert.equal(game.pass(hint.cards), false, 'only one pass per hand');
      state = game.state({ reveal: true });
      const target = state.passTo;
      const source = (4 - target) % 4;
      assert.deepEqual(state.passed, sorted(hint.cards).sort((a, b) => (suit(a) - suit(b)) || power(a) - power(b)));
      assert.deepEqual(state.passedBy[0], state.passed);
      assert.deepEqual(state.received, state.passedBy[source]);
      // Every seat's starting hand is its old hand minus what it gave plus what it got.
      const start = [0, 1, 2, 3].map(seat => sorted([...state.hands[seat], ...state.tricks.concat(state.trick.length ? [{ plays: state.trick }] : []).flatMap(t => t.plays).filter(play => play.seat === seat).map(play => play.card)]));
      for (let seat = 0; seat < 4; seat++) {
        const giver = [0, 1, 2, 3].find(other => [1, 3, 2][hand % 4] === (seat - other + 4) % 4);
        const expected = sorted([...before.hands[seat].filter(card => !state.passedBy[seat].includes(card)), ...state.passedBy[giver]]);
        assert.deepEqual(start[seat], expected, `exchange for seat ${seat}`);
      }
    } else {
      assert.equal(state.phase, 'play');
      assert.deepEqual(state.passed, []);
      assert.deepEqual(state.received, []);
    }
    while (game.state().phase === 'play') {
      const legal = game.state().legal;
      // Mostly play the hint so the game lasts at least eight hands.
      assert.equal(game.play(rng() < 0.8 ? game.hint().card : pick(rng, legal)), true);
    }
    const finished = game.state().phase === 'handOver';
    assert.equal(game.nextHand(), finished);
  }
  assert.deepEqual(directions.slice(0, 8), ['left', 'right', 'across', 'hold', 'left', 'right', 'across', 'hold']);
});

test('a human playing random legal cards against both levels: 2,000 games audited card by card', async () => {
  let hands = 0, humanPlays = 0, rejected = 0, moons = 0;
  for (let seed = 1; seed <= 2000; seed++) {
    const rng = random(seed * 7919);
    const game = await createHearts({ seed, difficulty: seed % 2 });
    for (;;) {
      const state = game.state();
      if (state.phase === 'gameOver') { checkTotals(state); break; }
      if (state.phase === 'pass') {
        assert.equal(game.pass(state.cards.filter(() => true).sort(() => rng() - 0.5).slice(0, 3)), true);
        continue;
      }
      if (state.phase === 'handOver') {
        const audit = auditHand(state.tricks, state.lastHand.points);
        assert.equal(state.lastHand.moon, audit.moon);
        if (audit.moon !== null) moons++;
        assert.deepEqual(state.cards, []);
        checkTotals(state);
        hands++;
        assert.equal(game.nextHand(), true);
        continue;
      }
      assert.equal(state.turn, 0, 'control returns to you only on your turn');
      const expected = legalCards(state.cards, state.trick, state.tricksPlayed, state.heartsBroken);
      assert.deepEqual(sorted(state.legal), sorted(expected), 'legal cards match the rules');
      const illegal = state.cards.filter(card => !expected.includes(card));
      if (illegal.length) { assert.equal(game.play(pick(rng, illegal)), false); rejected++; }
      const hint = game.hint();
      assert.equal(hint.type, 'play');
      assert.ok(expected.includes(hint.card), 'hints are legal');
      assert.equal(game.play(pick(rng, expected)), true);
      humanPlays++;
    }
    // The finished game can do nothing else.
    assert.equal(game.nextHand(), false);
    assert.equal(game.hint(), null);
  }
  assert.ok(hands > 12000, `${hands} hands audited`);
  assert.ok(humanPlays > 150000 && rejected > 10000);
});

test('determinism, hints that do not disturb the game, and replay round-trips', async () => {
  for (let seed = 1; seed <= 150; seed++) {
    const difficulty = seed % 2;
    const run = async useHints => {
      const rng = random(seed);
      const game = await createHearts({ seed, difficulty });
      for (let step = 0; step < 200; step++) {
        const state = game.state();
        if (useHints) { game.hint(); game.hint(); }
        if (state.phase === 'pass') game.pass(state.cards.slice(0, 3));
        else if (state.phase === 'play') game.play(pick(rng, state.legal));
        else if (state.phase === 'handOver') game.nextHand();
        else break;
      }
      return game;
    };
    const plain = await run(false);
    const hinted = await run(true);
    assert.deepEqual(hinted.state({ reveal: true }), plain.state({ reveal: true }), `seed ${seed}`);
    const replayed = await loadHeartsReplay(JSON.stringify(plain.replay()));
    assert.deepEqual(replayed.state({ reveal: true }), plain.state({ reveal: true }));
    const shared = await loadReplay(plain.replay());
    assert.deepEqual(shared.state(), plain.state());
  }
  const replay = (await createHearts({ seed: 5 })).replay();
  await assert.rejects(loadHeartsReplay({ ...replay, actions: [{ type: 'play', card: 1 }] }), /index 0/);
  await assert.rejects(loadHeartsReplay({ ...replay, actions: [{ type: 'nextHand' }] }), /index 0/);
  await assert.rejects(loadHeartsReplay({ ...replay, actions: [{ type: 'pass', cards: [1, 2] }] }), /index 0/);
  await assert.rejects(loadHeartsReplay({ ...replay, difficulty: 2 }), RangeError);
  await assert.rejects(loadHeartsReplay({ ...replay, players: ['human', 'human', 'random', 'random'] }), RangeError);
  await assert.rejects(createHearts({ seed: -1 }), RangeError);
});

async function simulate(players, games) {
  const wins = [0, 0, 0, 0], totals = [0, 0, 0, 0], moons = [0, 0, 0, 0];
  let hands = 0;
  for (let seed = 1; seed <= games; seed++) {
    const game = await createHearts({ seed, players });
    for (;;) {
      const state = game.state();
      if (state.phase === 'handOver' || state.phase === 'gameOver') {
        const audit = auditHand(state.tricks, state.lastHand.points);
        if (audit.moon !== null) moons[audit.moon]++;
      }
      if (state.phase === 'gameOver') {
        checkTotals(state);
        state.winners.forEach(seat => { wins[seat] += 1 / state.winners.length; });
        state.history.forEach(hand => { hand.forEach((value, seat) => { totals[seat] += value; }); hands++; });
        break;
      }
      assert.equal(game.nextHand(), true);
    }
  }
  const percent = value => `${(100 * value).toFixed(1)}%`;
  return {
    winRate: wins.map(win => win / games),
    perHand: totals.map(total => total / hands),
    moons,
    summary: `wins ${wins.map(win => percent(win / games)).join(' / ')} · points per hand ${totals.map(total => (total / hands).toFixed(2)).join(' / ')} · moons ${moons.join(' / ')} · ${hands} hands`,
  };
}

test('computer strength over thousands of audited games', async t => {
  const GAMES = 1000;
  const vsRandom = await simulate(['standard', 'random', 'random', 'random'], GAMES);
  t.diagnostic(`standard (seat 0) vs 3 random: ${vsRandom.summary}`);
  assert.ok(vsRandom.winRate[0] > 0.85);
  assert.ok(vsRandom.perHand[0] < vsRandom.perHand[1] / 2);

  const randomVs = await simulate(['random', 'standard', 'standard', 'standard'], GAMES);
  t.diagnostic(`random (seat 0) vs 3 standard: ${randomVs.summary}`);
  assert.ok(randomVs.winRate[0] < 0.05);

  const casualVsRandom = await simulate(['casual', 'random', 'random', 'random'], GAMES);
  t.diagnostic(`casual (seat 0) vs 3 random: ${casualVsRandom.summary}`);
  assert.ok(casualVsRandom.winRate[0] > 0.7);

  const vsCasual = await simulate(['standard', 'casual', 'casual', 'casual'], GAMES);
  t.diagnostic(`standard (seat 0) vs 3 casual: ${vsCasual.summary}`);
  assert.ok(vsCasual.winRate[0] > 0.35, 'standard is clearly stronger than casual');

  const mirror = await simulate(['standard', 'standard', 'standard', 'standard'], GAMES);
  t.diagnostic(`4 standard: ${mirror.summary}`);
  mirror.winRate.forEach(rate => assert.ok(rate > 0.18 && rate < 0.32, 'equal players win about equally'));
  assert.ok(mirror.moons.reduce((a, b) => a + b) > 0, 'standard players sometimes shoot the moon');
});
