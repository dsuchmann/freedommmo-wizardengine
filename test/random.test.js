import test from 'node:test';
import assert from 'node:assert/strict';
import { pickIndex } from '../src/core/random.js';

test('pickIndex maps [0,1) to 0..n-1 unchanged', () => {
  assert.equal(pickIndex(0, 5), 0);
  assert.equal(pickIndex(0.19, 5), 0);
  assert.equal(pickIndex(0.2, 5), 1);
  assert.equal(pickIndex(0.999999, 5), 4);
});

test('pickIndex clamps r === 1.0 to n-1', () => {
  assert.equal(pickIndex(1.0, 5), 4);
  assert.equal(pickIndex(1.0, 1), 0);
});
