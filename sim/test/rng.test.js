import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mix, rand, randRange } from '../kernel/rng.js';

test('mix is deterministic and sensitive to every argument', () => {
  assert.equal(mix(1, 2, 3), mix(1, 2, 3));
  assert.notEqual(mix(1, 2, 3), mix(1, 2, 4));
  assert.notEqual(mix(1, 2, 3), mix(2, 1, 3));
});

test('rand returns [0,1) and is call-order independent', () => {
  const a = rand(42, 7, 1000);
  rand(42, 999, 5);           // unrelated draw in between
  const b = rand(42, 7, 1000);
  assert.equal(a, b);
  assert.ok(a >= 0 && a < 1);
});

test('rand distributes roughly uniformly', () => {
  let sum = 0;
  for (let i = 0; i < 10000; i++) sum += rand(1, i, 0);
  const mean = sum / 10000;
  assert.ok(Math.abs(mean - 0.5) < 0.02, `mean ${mean}`);
});

test('randRange maps to [lo,hi)', () => {
  const v = randRange(42, 1, 2, 10, 20);
  assert.ok(v >= 10 && v < 20);
});
