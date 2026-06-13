import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { ensureRegionBaseline } from '../world/spawn.js';
import { aggregateOf } from '../lod/aggregate.js';

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
