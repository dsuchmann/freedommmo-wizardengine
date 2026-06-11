import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';

function makeKernel() {
  const k = new Kernel({ seed: 42, phi: 4 });
  return k;
}

test('spawnBaseline + runTo: lone grass accrues time from ambient', () => {
  const k = makeKernel();
  let g;
  k.graph.boot(() => { g = k.addLiving({ species: 'grass', x: 5, y: 5, R: 500, body: 10, tick: 0 }); });
  k.runTo(1000);
  const n = k.materialized(g.id);
  assert.ok(n.R > 500, 'reserve should grow: demand 0.15 (seedling) > burn 0.03');
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
  const alive = [...k.graph.nodes.values()].filter(n => n.type === 'grass');
  assert.ok(alive.length < 200, `some grass must starve (alive: ${alive.length})`);
  const corpses = [...k.graph.nodes.values()].filter(n => n.type === 'corpse');
  assert.ok(corpses.length > 0, 'starved grass leaves corpses');
  assert.ok(k.ledger.events.some(e => e.type === 'death'));
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
