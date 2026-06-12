// sim/test/sim-world-state.test.js — kernel truth → per-placement render instruction, via Plan D taxonomy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SimWorldState } from '../../src/sim/sim-world-state.js';

test('living wired entity maps through spineStateOf/visualStateOf', () => {
  const s = new SimWorldState();
  s.update({
    entities: new Map([[7, { id: 7, placement: 'f4:3,4:0', field: 'f4', stage: 'mature', bufferDays: 1, ageTicks: 0, senescenceStartTicks: 1e12 }]]),
    deltas: [],
  });
  assert.deepEqual(s.overrideFor('f4:3,4:0'), { visual: 'wilting', removed: false, entityId: 7, entityType: 'flora' });
});

test('taken placement is suppressed even with no entity present', () => {
  const s = new SimWorldState();
  s.update({ entities: new Map(), deltas: [{ target: 'placement:f3:1,1:0', kind: 'taken' }] });
  assert.deepEqual(s.overrideFor('f3:1,1:0'), { visual: null, removed: true, entityId: null });
});

test('unknown placement → no override (baseline renders untouched)', () => {
  const s = new SimWorldState();
  s.update({ entities: new Map(), deltas: [] });
  assert.equal(s.overrideFor('f4:9,9:9'), null);
});
