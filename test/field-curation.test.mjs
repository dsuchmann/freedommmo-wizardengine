// test/field-curation.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePicks, omitSetMap } from '../scripts/lib/field-curation.mjs';

const empty = { field: 'f6', omits: {}, history: [], regenWorklist: [] };

test('mergePicks records omits, reasons, notes, and a regen worklist', () => {
  const picks = { field: 'f6', decisions: {
    'forest/oak': { omit: [3, 17], tags: { '3': 'perspective' }, notes: { '3': 'top-down', '12': 'keep — best' } },
  } };
  const next = mergePicks(empty, picks, '2026-06-25T00:00:00Z');
  assert.deepEqual(next.omits['forest/oak'], [3, 17]);
  assert.equal(next.history.length, 1);
  const w = next.regenWorklist.find(e => e.replaces === 3);
  assert.equal(w.reason, 'perspective');
  assert.equal(w.note, 'top-down');
  const w17 = next.regenWorklist.find(e => e.replaces === 17);
  assert.equal(w17.reason, 'unspecified'); // omitted but untagged
});

test('mergePicks REPLACES a species omit-set (un-omit is reversible)', () => {
  const once = mergePicks(empty, { field: 'f6', decisions: { 'forest/oak': { omit: [3, 17] } } }, 't1');
  const twice = mergePicks(once, { field: 'f6', decisions: { 'forest/oak': { omit: [3] } } }, 't2'); // un-omit 17
  assert.deepEqual(twice.omits['forest/oak'], [3]);
  assert.equal(twice.regenWorklist.filter(e => e.replaces === 17).length, 0);
  assert.equal(twice.history.length, 2);
});

test('mergePicks drops a species when its omit-set clears to empty', () => {
  const once = mergePicks(empty, { field: 'f6', decisions: { 'forest/oak': { omit: [3] } } }, 't1');
  const cleared = mergePicks(once, { field: 'f6', decisions: { 'forest/oak': { omit: [] } } }, 't2');
  assert.ok(!('forest/oak' in cleared.omits));
});

test('mergePicks preserves prior reasons for species not in the new picks', () => {
  const a = mergePicks(empty, { field: 'f6', decisions: { 'forest/oak': { omit: [3], tags: { '3': 'scale' } } } }, 't1');
  const b = mergePicks(a, { field: 'f6', decisions: { 'desert/date_palm': { omit: [1] } } }, 't2');
  assert.equal(b.regenWorklist.find(e => e.species === 'oak' && e.replaces === 3).reason, 'scale');
});

test('omitSetMap returns per-species Sets from the effective omits', () => {
  const cur = mergePicks(empty, { field: 'f6', decisions: { 'forest/oak': { omit: [3, 17] } } }, 't1');
  const m = omitSetMap(cur);
  assert.ok(m.get('forest/oak').has(3) && m.get('forest/oak').has(17));
});
