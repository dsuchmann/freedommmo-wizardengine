// sim/test/aggregate.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { REGION, regionKeyOf, regionOrigin, aggregateOf, createAggregate, AGG_STEP } from '../lod/aggregate.js';
import { spawnWorld, spawnRegionAggregate } from '../world/spawn.js';

test('region helpers: 16-tile regions, stable keys', () => {
  assert.equal(REGION, 16);
  assert.equal(regionKeyOf(0, 0), '0,0');
  assert.equal(regionKeyOf(15.9, 15.9), '0,0');
  assert.equal(regionKeyOf(16, 0), '1,0');
  assert.deepEqual(regionOrigin('2,3'), [32, 48]);
});

test('createAggregate places the node at region center and schedules agg_step', () => {
  const k = new Kernel({ seed: 7 });
  let agg;
  k.graph.boot(() => {
    agg = createAggregate(k, '1,1', { grass: { count: 10, sumR: 5000, sumBody: 300, ageSum: 10 * 20 * 86400, detritusE: 0 } }, 0, null);
  });
  assert.equal(agg.type, 'aggregate');
  assert.equal(agg.x, 24); assert.equal(agg.y, 24);
  assert.equal(agg.R, null);                       // never captures flux, never re-rated
  assert.equal(aggregateOf(k, '1,1'), agg);
  assert.equal(aggregateOf(k, '0,0'), undefined);
  assert.ok(k.scheduler.heap.a.some(e => e.nodeId === agg.id && e.kind === 'agg_step' && e.tick === AGG_STEP));
});

test('spawnRegionAggregate is deterministic and mass matches expected densities', () => {
  const a = new Kernel({ seed: 42 }), b = new Kernel({ seed: 42 });
  a.graph.boot(() => spawnRegionAggregate(a, 3, 5));
  b.graph.boot(() => spawnRegionAggregate(b, 3, 5));
  const pa = aggregateOf(a, '3,5').attrs.pops, pb = aggregateOf(b, '3,5').attrs.pops;
  assert.deepEqual(pa, pb);                          // bit-identical from seed
  // grass density 0.5 over 256 tiles → count near 128 (stochastic rounding ±1)
  assert.ok(Math.abs(pa.grass.count - 128) <= 1);
  assert.ok(pa.grass.sumR > 0 && pa.grass.sumBody > 0 && pa.grass.ageSum > 0);
});

test('spawnWorld: individuals inside fullRect, aggregates outside, all baseline provenance', () => {
  const k = new Kernel({ seed: 42, bounds: { x0: 0, y0: 0, w: 64, h: 32 } });
  spawnWorld(k, { x0: 0, y0: 0, w: 64, h: 32 }, { x0: 0, y0: 0, w: 16, h: 16 });
  assert.equal(aggregateOf(k, '0,0'), undefined);    // start region is individual
  assert.ok(aggregateOf(k, '1,0'));                  // everything else statistical
  assert.ok(aggregateOf(k, '3,1'));
  const individuals = [...k.graph.nodes.values()].filter(n => n.R != null);
  assert.ok(individuals.length > 0);
  assert.ok(individuals.every(n => n.x < 16 && n.y < 16));
});

test('nested boot scopes stay baseline (re-entrant)', () => {
  const k = new Kernel({ seed: 1 });
  k.graph.boot(() => {
    k.graph.boot(() => {});
    // still inside outer boot — must not throw provenance
    k.graph.createNode({ type: 'group', tick: 0, attrs: {} });
  });
  assert.ok([...k.graph.nodes.values()].some(n => n.type === 'group'));
});
