// sim/test/genesis-tiers.test.js — P3: TierManager hooks chronicle-driven genesis;
// attention materializes settlements/ruins + chronicle events.
// Checkpoint round-trip preserves frontier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../store/db.js';
import { bootWorld } from '../server/main.js';
import { checkpoint, loadKernel } from '../store/checkpoint.js';
import { TierManager } from '../lod/tiers.js';
import { REGION } from '../lod/aggregate.js';
import { MACRO } from '../world/genesis.js';

test('attention at a far land coordinate produces settlements or chronicle events via TierManager', () => {
  const db = openDb(':memory:');
  const kernel = bootWorld(db, { seed: 42, spawn: { x: 0, y: 0 } });
  const tm = new TierManager(kernel, { fullR: 0, ringR: 1, demoteR: 2 });
  // Use known-good land coordinates — macro-cell 9,-2 has active+candidate at seed=42
  const landX = 9 * MACRO * REGION + REGION / 2;
  const landY = -2 * MACRO * REGION + REGION / 2;
  tm.update([{ x: landX, y: landY }], kernel.tick);
  const settlements = [...kernel.graph.nodes.values()].filter(n => n.type === 'settlement');
  const chronicleEvents = kernel.ledger.events.filter(e => e.type.startsWith('chronicle_'));
  // Chronicle-driven: we may get active settlements, ruins, or just chronicle events
  assert.ok(settlements.length > 0 || chronicleEvents.length > 0,
    `TierManager attention produced settlements (${settlements.length}) or chronicle events (${chronicleEvents.length})`);
});

test('genesisSettlements frontier survives checkpoint round-trip', () => {
  const db = openDb(':memory:');
  const kernel = bootWorld(db, { seed: 42, spawn: { x: 0, y: 0 } });
  const tm = new TierManager(kernel, { fullR: 0, ringR: 1, demoteR: 2 });
  const landX = 9 * MACRO * REGION + REGION / 2;
  const landY = -2 * MACRO * REGION + REGION / 2;
  tm.update([{ x: landX, y: landY }], kernel.tick);
  const frontierBefore = new Set(kernel.genesisSettlements);
  assert.ok(frontierBefore.size > 0, 'frontier has entries');
  checkpoint(kernel, db);
  const kernel2 = loadKernel(db);
  assert.deepEqual(kernel2.genesisSettlements, frontierBefore, 'frontier round-tripped');
  // No duplicates on re-visit
  const tm2 = new TierManager(kernel2, { fullR: 0, ringR: 1, demoteR: 2 });
  const settlementsBefore = [...kernel2.graph.nodes.values()].filter(n => n.type === 'settlement').length;
  tm2.update([{ x: landX, y: landY }], kernel2.tick);
  const settlementsAfter = [...kernel2.graph.nodes.values()].filter(n => n.type === 'settlement').length;
  assert.equal(settlementsAfter, settlementsBefore, 'no duplicate settlements after reload');
});
