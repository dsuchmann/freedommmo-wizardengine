// sim/test/genesis-tiers.test.js — P2: TierManager hooks genesis; attention
// materializes settlements + roads. Checkpoint round-trip preserves frontier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../store/db.js';
import { bootWorld } from '../server/main.js';
import { checkpoint, loadKernel } from '../store/checkpoint.js';
import { TierManager } from '../lod/tiers.js';
import { REGION } from '../lod/aggregate.js';
import { MACRO } from '../world/genesis.js';

test('attention at a far land coordinate produces settlements via TierManager', () => {
  const db = openDb(':memory:');
  const kernel = bootWorld(db, { seed: 42, spawn: { x: 0, y: 0 } });
  // Use a tiny ring to minimize the number of macro-cells evaluated
  const tm = new TierManager(kernel, { fullR: 0, ringR: 1, demoteR: 2 });
  // Land macro-cell at mx=10: center tile = 10*4*16 + 8 = 648
  const landX = 10 * MACRO * REGION + REGION / 2;
  const landY = REGION / 2;
  tm.update([{ x: landX, y: landY }], kernel.tick);
  const settlements = [...kernel.graph.nodes.values()].filter(n => n.type === 'settlement');
  assert.ok(settlements.length > 0, 'TierManager attention produced at least one settlement');
  const groups = [...kernel.graph.nodes.values()].filter(n => n.type === 'group' && n.attrs.genesis);
  assert.ok(groups.length > 0, 'genesis groups exist');
});

test('genesisSettlements frontier survives checkpoint round-trip', () => {
  const db = openDb(':memory:');
  const kernel = bootWorld(db, { seed: 42, spawn: { x: 0, y: 0 } });
  const tm = new TierManager(kernel, { fullR: 0, ringR: 1, demoteR: 2 });
  const landX = 10 * MACRO * REGION + REGION / 2;
  tm.update([{ x: landX, y: REGION / 2 }], kernel.tick);
  const frontierBefore = new Set(kernel.genesisSettlements);
  assert.ok(frontierBefore.size > 0, 'frontier has entries');
  checkpoint(kernel, db);
  const kernel2 = loadKernel(db);
  assert.deepEqual(kernel2.genesisSettlements, frontierBefore, 'frontier round-tripped');
  // No duplicates on re-visit
  const tm2 = new TierManager(kernel2, { fullR: 0, ringR: 1, demoteR: 2 });
  const settlementsBefore = [...kernel2.graph.nodes.values()].filter(n => n.type === 'settlement').length;
  tm2.update([{ x: landX, y: REGION / 2 }], kernel2.tick);
  const settlementsAfter = [...kernel2.graph.nodes.values()].filter(n => n.type === 'settlement').length;
  assert.equal(settlementsAfter, settlementsBefore, 'no duplicate settlements after reload');
});
