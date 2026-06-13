import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { ensureRegionBaseline } from '../world/spawn.js';
import { aggregateOf, REGION } from '../lod/aggregate.js';
import { TierManager } from '../lod/tiers.js';

test('ensureRegionBaseline creates a region aggregate exactly once', () => {
  const kernel = new Kernel({ seed: 42 });
  const key = '3000,-2000';
  ensureRegionBaseline(kernel, key, 0);
  const agg = aggregateOf(kernel, key);
  assert.ok(agg, 'aggregate exists after first ensure');
  const nodeCount = kernel.graph.nodes.size;
  ensureRegionBaseline(kernel, key, 100);
  assert.equal(kernel.graph.nodes.size, nodeCount);
  assert.ok(kernel.touched.has(key));
});

test('baseline is pure f(seed, region) — visit order does not matter', () => {
  const a = new Kernel({ seed: 7 }), b = new Kernel({ seed: 7 });
  ensureRegionBaseline(a, '10,10', 0); ensureRegionBaseline(a, '-10,-10', 0);
  ensureRegionBaseline(b, '-10,-10', 0); ensureRegionBaseline(b, '10,10', 0);
  for (const key of ['10,10', '-10,-10']) {
    const pa = aggregateOf(a, key)?.attrs.pops ?? null;
    const pb = aggregateOf(b, key)?.attrs.pops ?? null;
    assert.deepEqual(pa, pb, `pops identical for ${key} across visit orders`);
  }
});

test('different seeds give different worlds', () => {
  const a = new Kernel({ seed: 7 }), b = new Kernel({ seed: 8 });
  let differs = false;
  for (let i = 0; i < 20 && !differs; i++) {
    const key = `${i * 13},${-i * 7}`;
    ensureRegionBaseline(a, key, 0); ensureRegionBaseline(b, key, 0);
    const pa = JSON.stringify(aggregateOf(a, key)?.attrs.pops ?? null);
    const pb = JSON.stringify(aggregateOf(b, key)?.attrs.pops ?? null);
    if (pa !== pb) differs = true;
  }
  assert.ok(differs, 'some region differs between seeds');
});

test('attention anywhere materializes a living world (±50k tiles)', () => {
  const kernel = new Kernel({ seed: 42 });
  const tm = new TierManager(kernel);
  const center = { x: 50_000, y: -50_000 };
  tm.update([center], 0);
  const near = kernel.graph.nodesNear(center.x, center.y, REGION * 2).filter(n => n.R != null);
  assert.ok(near.length > 0, `expected living entities near ${center.x},${center.y}, got 0`);
  // Second kernel visits (0,0) first then center — baselines are identical (test 2),
  // but promoted individual positions differ (agg.id-seeded jitter) so we check counts
  // are close rather than identical.
  const k2 = new Kernel({ seed: 42 });
  const tm2 = new TierManager(k2);
  tm2.update([{ x: 0, y: 0 }], 0);
  tm2.update([center], 0);
  const near2 = k2.graph.nodesNear(center.x, center.y, REGION * 2).filter(n => n.R != null);
  assert.ok(near2.length > 0, 'entities near center after visiting elsewhere first');
  assert.ok(Math.abs(near2.length - near.length) / near.length < 0.05,
    `entity counts near center within 5%: ${near.length} vs ${near2.length}`);
});
