import { test } from 'node:test';
import assert from 'node:assert/strict';
import { omitSetMap, mergePicks } from '../scripts/lib/field-curation.mjs';

test('omitSetMap maps species -> Set of omitted indices', () => {
  const m = omitSetMap({ omits: { 'hills/scots_pine': [21, 24], 'hills/rowan': [0, 1] } });
  assert.equal(m.get('hills/scots_pine').has(21), true);
  assert.equal(m.get('hills/scots_pine').has(22), false);
  assert.equal(m.get('hills/rowan').size, 2);
});

test('allowed = present minus omitted (the cull contract)', () => {
  const present = [0, 1, 2, 3, 4];
  const omit = omitSetMap({ omits: { 'b/s': [1, 3] } }).get('b/s');
  const allowed = present.filter((v) => !omit.has(v));
  assert.deepEqual(allowed, [0, 2, 4]);
});

test('mergePicks overwrites a species omit list from a dashboard export', () => {
  const cur = { omits: { 'b/s': [9] }, history: [], regenWorklist: [] };
  const next = mergePicks(cur, { decisions: { 'b/s': { omit: [1, 2] } } }, '2026-06-29T00:00:00Z');
  assert.deepEqual(next.omits['b/s'], [1, 2]);
});
