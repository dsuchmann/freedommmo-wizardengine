// sim/test/genesis.test.js — P2: deterministic settlement genesis over the climate oracle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { ensureGenesisSettlements, evaluateMacroCell, macroKeyOf, MACRO } from '../world/genesis.js';
import { REGION } from '../lod/aggregate.js';

function makeKernel(seed = 42) {
  return new Kernel({ seed });
}

// Land starts ~500 tiles from origin. Use known-good macro-cell coordinates.
// evaluateMacroCell(42, '8,0') hits at (552,0) — verified empirically.
const KNOWN_HIT_KEY = `${8 * MACRO},0`;   // region key mapping to macro-cell '8,0'

test('evaluateMacroCell is pure and finds candidates in land areas', () => {
  const c1 = evaluateMacroCell(42, '8,0');
  const c2 = evaluateMacroCell(42, '8,0');
  assert.ok(c1, 'candidate found in land macro-cell');
  assert.deepEqual(c1, c2, 'pure: same result twice');
  // Water macro-cell near origin: no candidate
  const w = evaluateMacroCell(42, '0,0');
  assert.equal(w, null, 'no candidate in ocean');
});

test('ensureGenesisSettlements places a settlement at a known-good macro-cell', () => {
  const k = makeKernel();
  ensureGenesisSettlements(k, KNOWN_HIT_KEY, 0);
  const settlements = [...k.graph.nodes.values()].filter(n => n.type === 'settlement');
  assert.ok(settlements.length > 0, 'settlement placed');
  const s = settlements[0];
  assert.ok(s.attrs.territory, 'settlement has territory');
  assert.ok(s.attrs.founderGroup, 'settlement has founder group');
  const group = k.graph.nodes.get(s.attrs.founderGroup);
  assert.ok(group, 'founder group exists');
  assert.equal(group.attrs.genesis, true, 'group marked as genesis');
  // Genesis group has R endowment
  assert.ok(group.R > 0, 'genesis group funded');
  // Provenance: ledger event exists
  assert.ok(k.ledger.events.some(e => e.type === 'genesis_group_founded'));
});

test('exactly-once: second call to same macro-cell is a no-op', () => {
  const k = makeKernel();
  ensureGenesisSettlements(k, KNOWN_HIT_KEY, 0);
  const countBefore = [...k.graph.nodes.values()].filter(n => n.type === 'settlement').length;
  const eventsBefore = k.ledger.events.length;
  // Second call — same macro-cell
  ensureGenesisSettlements(k, KNOWN_HIT_KEY, 0);
  // Also call with a different region key that maps to the same macro-cell
  ensureGenesisSettlements(k, `${8 * MACRO + 1},1`, 0);
  const countAfter = [...k.graph.nodes.values()].filter(n => n.type === 'settlement').length;
  assert.equal(countAfter, countBefore, 'no new settlements from repeat calls');
  assert.equal(k.ledger.events.length, eventsBefore, 'no new events');
});

test('visit-order independent: same settlements regardless of evaluation order', () => {
  const seed = 77;
  // Two macro-cells, both in land area
  const keys = [`${8 * MACRO},0`, `${9 * MACRO},0`];

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

test('different seeds produce different patterns', () => {
  const run = (seed) => {
    const k = makeKernel(seed);
    // Evaluate 4 known-land macro-cells
    for (const mk of ['8,0', '9,0', '10,0', '11,0']) {
      const [mx, my] = mk.split(',').map(Number);
      ensureGenesisSettlements(k, `${mx * MACRO},${my * MACRO}`, 0);
    }
    return [...k.graph.nodes.values()].filter(n => n.type === 'settlement')
      .map(n => `${n.x},${n.y}`).sort().join(';');
  };
  const a = run(42);
  const b = run(999);
  assert.ok(a.length > 0 || b.length > 0, 'at least one seed produces settlements');
  assert.notEqual(a, b, 'different seeds yield different settlement patterns');
});
