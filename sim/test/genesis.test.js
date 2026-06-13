// sim/test/genesis.test.js — P3: chronicle-driven settlement genesis.
// Updated from P2: known-good macro-cells adjusted for chronicle pipeline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { ensureGenesisSettlements, evaluateMacroCell, macroKeyOf, MACRO } from '../world/genesis.js';
import { REGION } from '../lod/aggregate.js';

function makeKernel(seed = 42) {
  return new Kernel({ seed });
}

// Known-good macro-cell: 9,-2 produces active+candidate at seed=42
const KNOWN_ACTIVE_MK = '9,-2';
const KNOWN_ACTIVE_KEY = `${9 * MACRO},${-2 * MACRO}`;

test('evaluateMacroCell is pure and finds candidates in land areas', () => {
  const c1 = evaluateMacroCell(42, '8,0');
  const c2 = evaluateMacroCell(42, '8,0');
  assert.ok(c1, 'candidate found in land macro-cell');
  assert.deepEqual(c1, c2, 'pure: same result twice');
  const w = evaluateMacroCell(42, '0,0');
  assert.equal(w, null, 'no candidate in ocean');
});

test('ensureGenesisSettlements places a settlement at a known-good macro-cell', () => {
  const k = makeKernel();
  ensureGenesisSettlements(k, KNOWN_ACTIVE_KEY, 0);
  const settlements = [...k.graph.nodes.values()].filter(n => n.type === 'settlement');
  assert.ok(settlements.length > 0, 'settlement placed');
  const s = settlements[0];
  assert.ok(s.attrs.territory, 'settlement has territory');
  // Chronicle-driven: active settlements have founder groups
  if (s.attrs.state === 'active') {
    assert.ok(s.attrs.founderGroup, 'active settlement has founder group');
    const group = k.graph.nodes.get(s.attrs.founderGroup);
    assert.ok(group, 'founder group exists');
    assert.equal(group.attrs.genesis, true, 'group marked as genesis');
    assert.ok(group.R > 0, 'genesis group funded');
  }
  // Provenance: chronicle events emitted
  assert.ok(k.ledger.events.some(e => e.type.startsWith('chronicle_')), 'chronicle events emitted');
});

test('exactly-once: second call to same macro-cell is a no-op', () => {
  const k = makeKernel();
  ensureGenesisSettlements(k, KNOWN_ACTIVE_KEY, 0);
  const countBefore = k.graph.nodes.size;
  const eventsBefore = k.ledger.events.length;
  ensureGenesisSettlements(k, KNOWN_ACTIVE_KEY, 0);
  ensureGenesisSettlements(k, `${9 * MACRO + 1},${-2 * MACRO + 1}`, 0);
  assert.equal(k.graph.nodes.size, countBefore, 'no new nodes from repeat calls');
  assert.equal(k.ledger.events.length, eventsBefore, 'no new events');
});

test('visit-order independent: same settlements regardless of evaluation order', () => {
  const seed = 42;
  // Two macro-cells known to produce chronicle results
  const keys = [KNOWN_ACTIVE_KEY, `${12 * MACRO},0`];

  const k1 = makeKernel(seed);
  for (const key of keys) ensureGenesisSettlements(k1, key, 0);

  const k2 = makeKernel(seed);
  for (const key of [...keys].reverse()) ensureGenesisSettlements(k2, key, 0);

  const sett1 = [...k1.graph.nodes.values()].filter(n => n.type === 'settlement')
    .map(n => `${n.x},${n.y}`).sort();
  const sett2 = [...k2.graph.nodes.values()].filter(n => n.type === 'settlement')
    .map(n => `${n.x},${n.y}`).sort();
  assert.deepEqual(sett1, sett2, 'same settlement positions regardless of visit order');
});

test('different seeds produce different chronicle outcomes', () => {
  const run = (seed) => {
    const k = makeKernel(seed);
    // Evaluate several land macro-cells
    for (const mk of ['9,-2', '12,0', '13,1', '13,2']) {
      const [mx, my] = mk.split(',').map(Number);
      ensureGenesisSettlements(k, `${mx * MACRO},${my * MACRO}`, 0);
    }
    return k.ledger.events.filter(e => e.type.startsWith('chronicle_'))
      .map(e => `${e.attrs.macroCell}:${e.type}`).sort().join(';');
  };
  const a = run(42);
  const b = run(999);
  assert.ok(a.length > 0 || b.length > 0, 'at least one seed produces chronicle events');
  assert.notEqual(a, b, 'different seeds yield different chronicle patterns');
});
