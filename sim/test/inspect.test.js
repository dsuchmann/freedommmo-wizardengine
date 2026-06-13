// sim/test/inspect.test.js — P4 Task 2: inspect endpoint for causal queries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { ensureGenesisSettlements, MACRO } from '../world/genesis.js';
import { narrate } from '../story/narrator.js';

/** Boot a kernel with known-good settlements at seed=42. */
function bootWithSettlements() {
  const k = new Kernel({ seed: 42 });
  const macroKeys = ['9,-2', '12,0', '13,1'];
  for (const mk of macroKeys) {
    const [mx, my] = mk.split(',').map(Number);
    ensureGenesisSettlements(k, `${mx * MACRO},${my * MACRO}`, 0);
  }
  return k;
}

test('narrate returns structured context for a settlement', () => {
  const k = bootWithSettlements();
  const settlement = [...k.graph.nodes.values()].find(n => n.type === 'settlement');
  assert.ok(settlement, 'need a settlement');
  const result = narrate(k, settlement.id);
  assert.ok(result, 'narrate should return a result');
  assert.ok(result.summary, 'result has summary');
  assert.ok(Array.isArray(result.events), 'result has events array');
  assert.ok(result.events.length > 0, 'events should be non-empty');
  assert.equal(result.node.id, settlement.id);
  assert.equal(result.node.type, 'settlement');
});

test('narrate returns null for nonexistent node', () => {
  const k = new Kernel({ seed: 42 });
  const result = narrate(k, 999999);
  assert.equal(result, null);
});
