// sim/test/aggregate.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { REGION, regionKeyOf, regionOrigin, aggregateOf, createAggregate, AGG_STEP } from '../lod/aggregate.js';
import { spawnStart, spawnRegionAggregate, ensureRegionBaseline } from '../world/spawn.js';

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

test('spawnStart: individuals inside start rect, ensureRegionBaseline aggregates outside', () => {
  const k = new Kernel({ seed: 42 });
  spawnStart(k, { x0: 0, y0: 0, w: 16, h: 16 });
  ensureRegionBaseline(k, '1,0', 0);
  ensureRegionBaseline(k, '3,1', 0);
  assert.equal(aggregateOf(k, '0,0'), undefined);    // start region is individual
  assert.ok(aggregateOf(k, '1,0'));                  // lazily materialized statistical
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

function flows(k) {
  const t = k.ledger.totals;
  return t.captured - t.burned - t.decayed - t.transferLoss;
}

test('agg_step: conservation identity holds exactly over a statistical year', () => {
  const k = new Kernel({ seed: 42 });
  for (let ry = 0; ry < 4; ry++) for (let rx = 0; rx < 4; rx++) ensureRegionBaseline(k, `${rx},${ry}`, 0);
  const start = k.stocks(0), f0 = flows(k);
  k.runTo(360 * 86400);
  const end = k.stocks(k.tick), f1 = flows(k);
  const scale = Math.max(Math.abs(k.ledger.totals.captured), 1);
  assert.ok(Math.abs((end - start) - (f1 - f0)) / scale < 1e-9,
    `conservation: Δstocks=${end - start} Δflows=${f1 - f0}`);
});

test('agg_step: populations persist without explosion or instant extinction', () => {
  const k = new Kernel({ seed: 42 });
  for (let ry = 0; ry < 4; ry++) for (let rx = 0; rx < 4; rx++) ensureRegionBaseline(k, `${rx},${ry}`, 0);
  const count = kk => [...kk.graph.nodes.values()].filter(n => n.type === 'aggregate')
    .reduce((s, n) => s + (n.attrs.pops.grass?.count ?? 0), 0);
  const c0 = count(k);
  k.runTo(360 * 86400);
  const c1 = count(k);
  assert.ok(c1 > 0, 'grass must not go extinct in a year');
  // Region-pooled flux carries ~25× the baseline density before starvation bites
  // (baseline spawns well below carrying capacity); the bound catches unbounded growth.
  assert.ok(c1 < c0 * 50, `grass must not explode (was ${c0}, now ${c1})`);
});

test('agg_step is deterministic (two runs, identical pops)', () => {
  const run = () => {
    const k = new Kernel({ seed: 99 });
    for (let ry = 0; ry < 2; ry++) for (let rx = 0; rx < 2; rx++) ensureRegionBaseline(k, `${rx},${ry}`, 0);
    k.runTo(200 * 86400);
    return JSON.stringify([...k.graph.nodes.values()].filter(n => n.type === 'aggregate')
      .sort((a, b) => a.id - b.id).map(n => n.attrs));
  };
  assert.equal(run(), run());
});

test('stocks() counts aggregate mass', () => {
  const k = new Kernel({ seed: 7 });
  k.graph.boot(() => createAggregate(k, '0,0',
    { grass: { count: 4, sumR: 1000, sumBody: 100, ageSum: 4 * 86400 * 20, detritusE: 50 } }, 0, null));
  assert.equal(k.stocks(0), 1150);
});
