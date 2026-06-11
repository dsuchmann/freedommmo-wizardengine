import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';

function makeKernel() {
  // bounded world: seeds landing outside fail to establish, keeping tests finite
  const k = new Kernel({ seed: 42, phi: 4, bounds: { x0: 0, y0: 0, w: 12, h: 12 } });
  return k;
}

test('spawnBaseline + runTo: lone grass accrues time from ambient', () => {
  const k = makeKernel();
  let g;
  k.graph.boot(() => { g = k.addLiving({ species: 'grass', x: 5, y: 5, R: 500, body: 10, tick: 0 }); });
  k.runTo(1000);
  const n = k.materialized(g.id);
  assert.ok(n.R > 500, 'reserve should grow: demand 0.225 (seedling) > burn 0.18');
});

test('stale events are dropped after re-rate', () => {
  const k = makeKernel();
  let g;
  k.graph.boot(() => { g = k.addLiving({ species: 'grass', x: 5, y: 5, R: 500, body: 10, tick: 0 }); });
  const verBefore = k.graph.nodes.get(g.id).ver;
  k.reRateTileOf(g.id, 0);
  assert.ok(k.graph.nodes.get(g.id).ver > verBefore);
  // queue still drains without throwing
  k.runTo(1000);
});

test('overcrowded tile starves: rationing drives r negative and death fires', () => {
  const k = makeKernel();
  k.graph.boot(() => {
    // 200 mature grass on ONE tile: share = φ/N = 0.02 < burn 0.05 → starvation
    for (let i = 0; i < 200; i++) {
      k.addLiving({ species: 'grass', x: 5.5, y: 5.5, R: 200, body: 20, tick: 0, age: 20 * 86400 });
    }
  });
  k.runTo(60 * 86400);
  // With honest seeding enabled, offspring on uncrowded tiles boost total alive above
  // the initial 200; verify starvation by checking deaths and corpses, not total count.
  const corpses = [...k.graph.nodes.values()].filter(n => n.type === 'corpse');
  assert.ok(corpses.length > 0, 'starved grass leaves corpses');
  assert.ok(k.ledger.events.some(e => e.type === 'death'), 'death events recorded');
});

test('conservation identity holds through starvation', () => {
  const k = makeKernel();
  k.graph.boot(() => {
    for (let i = 0; i < 200; i++) {
      k.addLiving({ species: 'grass', x: 5.5, y: 5.5, R: 200, body: 20, tick: 0, age: 20 * 86400 });
    }
  });
  const start = k.stocks(0);
  k.runTo(60 * 86400);
  const end = k.stocks(60 * 86400);
  const t = k.ledger.totals;
  const lhs = end - start;
  const rhs = t.captured - t.burned - t.decayed - t.transferLoss;
  assert.ok(Math.abs(lhs - rhs) < 1e-3, `lhs ${lhs} rhs ${rhs}`);
});

test('heap compaction: size stays bounded after long overcrowded run', () => {
  const k = makeKernel();
  k.graph.boot(() => {
    for (let i = 0; i < 200; i++) {
      k.addLiving({ species: 'grass', x: 5.5, y: 5.5, R: 200, body: 20, tick: 0, age: 20 * 86400 });
    }
  });
  k.runTo(60 * 86400);
  const heapSz = k.scheduler.heap.size;
  const nodeSz = k.graph.nodes.size;
  assert.ok(
    heapSz <= Math.max(4096, 8 * nodeSz),
    `heap size ${heapSz} should be <= max(4096, 8 * ${nodeSz}=${8 * nodeSz})`
  );
});

test('heap compaction is deterministic: mid-run compact yields identical results', () => {
  const T = 60 * 86400;

  // Kernel A: normal run
  const kA = makeKernel();
  kA.graph.boot(() => {
    for (let i = 0; i < 50; i++) {
      kA.addLiving({ species: 'grass', x: 5.5, y: 5.5, R: 200, body: 20, tick: 0, age: 20 * 86400 });
    }
  });
  kA.runTo(T);

  // Kernel B: same params, compact explicitly at midpoint
  const kB = makeKernel();
  kB.graph.boot(() => {
    for (let i = 0; i < 50; i++) {
      kB.addLiving({ species: 'grass', x: 5.5, y: 5.5, R: 200, body: 20, tick: 0, age: 20 * 86400 });
    }
  });
  kB.runTo(T / 2);
  kB.scheduler.compact(e => {
    const n = kB.graph.nodes.get(e.nodeId);
    return n != null && (e.ver === -1 || e.ver === n.ver);
  });
  kB.runTo(T);

  assert.equal(
    kA.ledger.events.length,
    kB.ledger.events.length,
    `event counts differ: A=${kA.ledger.events.length} B=${kB.ledger.events.length}`
  );
  assert.equal(kA.graph.nodes.size, kB.graph.nodes.size, 'node counts differ');
  assert.ok(
    Math.abs(kA.stocks(T) - kB.stocks(T)) < 1e-9,
    `stocks differ: A=${kA.stocks(T)} B=${kB.stocks(T)}`
  );
});
