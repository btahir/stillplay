import test from 'node:test';
import assert from 'node:assert/strict';
import { dropZone, pickDropTarget } from '../src/card-table.js';

// A Solitaire-sized table: cards 80 × 112, columns 92 px apart, top row at y 0, tableau at y 140.
const W = 80, H = 112;
const pile = (id, x, y, { extent = H, fan = 'none' } = {}) => ({ id, ...dropZone({ left: x, top: y, right: x + W, bottom: y + extent, cardW: W, cardH: H, fan }) });
const card = (x, y) => ({ left: x, top: y, right: x + W, bottom: y + H });

test('drop zones reach a little past the pile, and half a card below a fanned column', () => {
  const foundation = pile('h0', 300, 0);
  assert.ok(foundation.left < 300 && foundation.right > 380 && foundation.top < 0 && foundation.bottom > H);
  assert.ok(foundation.bottom - H < H * 0.2, 'top-row zones stay clear of the tableau below');
  const column = pile('t0', 0, 140, { extent: 200, fan: 'down' });
  assert.equal(column.bottom, 140 + 200 + H * 0.5);
});

test('the pile under the pointer wins, even when the card overlaps another legal pile more', () => {
  const zones = [pile('t0', 0, 140, { fan: 'down' }), pile('t1', 92, 140, { fan: 'down' })];
  // The card sits mostly over t0, but the hand that carries it is over t1.
  assert.equal(pickDropTarget(card(30, 150), { x: 100, y: 160 }, zones), 't1');
});

test('with the pointer outside every zone, the largest overlap wins', () => {
  const zones = [pile('t0', 0, 140, { fan: 'down' }), pile('t1', 92, 140, { fan: 'down' })];
  assert.equal(pickDropTarget(card(60, 150), { x: 70, y: 90 }, zones), 't1');
  assert.equal(pickDropTarget(card(20, 150), { x: 70, y: 90 }, zones), 't0');
});

test('a card let go just below or beside its target still lands', () => {
  // Grabbed near its top edge and released 15% of a card below a one-card column.
  const column = pile('t0', 0, 140, { fan: 'down' });
  const pointer = { x: 40, y: 140 + H * 1.15 };
  assert.equal(pickDropTarget(card(0, pointer.y - H * 0.1), pointer, [column]), 't0');
  // Released over the gap just right of a foundation.
  const foundation = pile('h1', 392, 0);
  assert.equal(pickDropTarget(card(400, 10), { x: 392 + W + 6, y: 50 }, [foundation]), 'h1');
});

test('a pointer right over a pile that cannot take the card sends it back, even if it overlaps a legal one', () => {
  // A run let go over the waste hangs down over column 2, which could take it.
  const waste = { ...pile('w', 92, 0), legal: false };
  const column = pile('t1', 92, 140, { fan: 'down' });
  assert.equal(pickDropTarget(card(92, 40), { x: 130, y: 50 }, [waste, column]), null);
  // Its own pile counts too: a card nudged within its column goes back rather than next door.
  const own = { ...pile('t0', 0, 140, { fan: 'down' }), legal: false };
  const next = pile('t1', 92, 140, { fan: 'down' });
  assert.equal(pickDropTarget(card(40, 150), { x: 70, y: 160 }, [own, next]), null);
  // The padding of a legal zone still beats the core of an illegal neighbour under the pointer.
  assert.equal(pickDropTarget(card(80, 150), { x: 86, y: 160 }, [own, next]), 't1');
});

test('a card nowhere near a legal pile has no target', () => {
  assert.equal(pickDropTarget(card(600, 400), { x: 640, y: 450 }, [pile('t0', 0, 140, { fan: 'down' })]), null);
  assert.equal(pickDropTarget(card(0, 0), { x: 10, y: 10 }, []), null);
});
