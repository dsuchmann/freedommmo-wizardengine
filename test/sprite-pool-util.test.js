import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coalesceDirty, lowerBound } from '../src/render/sprite-pool-util.js';

test('coalesceDirty: empty set yields no ranges', () => {
  assert.deepEqual(coalesceDirty([], 4), []);
});

test('coalesceDirty: single index yields one 1-length range', () => {
  assert.deepEqual(coalesceDirty([7], 4), [{ start: 7, count: 1 }]);
});

test('coalesceDirty: adjacent and near indices merge within gap', () => {
  // gap=4: indices closer than gap merge into one range
  assert.deepEqual(coalesceDirty([3, 4, 6, 9], 4), [{ start: 3, count: 7 }]);
});

test('coalesceDirty: far indices split into separate ranges', () => {
  assert.deepEqual(coalesceDirty([1, 2, 50, 51], 4),
    [{ start: 1, count: 2 }, { start: 50, count: 2 }]);
});

test('coalesceDirty: unsorted input is handled', () => {
  assert.deepEqual(coalesceDirty([50, 1, 51, 2], 4),
    [{ start: 1, count: 2 }, { start: 50, count: 2 }]);
});

test('lowerBound: finds first index with value >= needle', () => {
  const a = new Float32Array([1, 3, 3, 7, 9]);
  assert.equal(lowerBound(a, 5, 0), 3);
  assert.equal(lowerBound(a, 3, 5), 1);
  assert.equal(lowerBound(a, 0, 5), 0);
  assert.equal(lowerBound(a, 99, 5), 5);
});

test('lowerBound: respects explicit length (ignores tail garbage)', () => {
  const a = new Float32Array([1, 3, 9, 777, 777]);
  assert.equal(lowerBound(a, 5, 3), 2);
});
