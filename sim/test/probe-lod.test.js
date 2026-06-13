// sim/test/probe-lod.test.js — Plan C probe (spec §4.2–4.3, §5.1).
// "A war between distant civilizations happens for real while the player is in C":
// here, a distant meadow lives a real statistical year — populations shift, dead mass
// accumulates, the ledger records it — and walking there materializes real individuals
// that honor every aggregate truth. Same seed+ledger → bit-identical world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { spawnStart, ensureRegionBaseline } from '../world/spawn.js';
import { aggregateOf, REGION } from '../lod/aggregate.js';
import { TierManager } from '../lod/tiers.js';
import { openDb } from '../store/db.js';
import { checkpoint, loadKernel } from '../store/checkpoint.js';

const DAY = 86400;
const BOUNDS = { x0: 0, y0: 0, w: 160, h: 160 };
const START = { x0: 0, y0: 0, w: 16, h: 16 };

/** Pre-populate all regions in a rect with lazy baselines (replaces the old spawnWorld aggregate loop). */
function ensureAllBaselines(k, rect, tick) {
  const r0x = Math.floor(rect.x0 / REGION), r1x = Math.ceil((rect.x0 + rect.w) / REGION);
  const r0y = Math.floor(rect.y0 / REGION), r1y = Math.ceil((rect.y0 + rect.h) / REGION);
  for (let ry = r0y; ry < r1y; ry++) for (let rx = r0x; rx < r1x; rx++) {
    ensureRegionBaseline(k, `${rx},${ry}`, tick);
  }
}

function canonicalDump(k) {
  const nodes = [...k.graph.nodes.values()].sort((a, b) => a.id - b.id)
    .map(n => [n.id, n.type, n.x, n.y, n.R, n.r, n.lastTick, JSON.stringify(n.attrs)]);
  return JSON.stringify({ tick: k.tick, nodes, totals: k.ledger.totals, deltas: k.deltas.list,
    events: k.ledger.events.length });
}

function journey(seed) {
  const k = new Kernel({ seed });
  spawnStart(k, START);
  ensureAllBaselines(k, BOUNDS, 0);
  // small radii keep the probe fast (fewer individuals to full-sim for a year); semantics identical
  const tm = new TierManager(k, { fullR: 0, ringR: 1, demoteR: 2 });
  tm.update([{ x: 8, y: 8 }], 0);            // player starts at home
  k.runTo(180 * DAY);                        // half a year at home
  tm.update([{ x: 8, y: 8 }], k.tick);
  k.runTo(360 * DAY);                        // a full year total
  tm.update([{ x: 152, y: 152 }], k.tick);   // travel to the far corner: promote there, demote home
  k.runTo(390 * DAY);
  return { k, tm };
}

test('probe LOD: a distant region lives a real year, arrival materializes real history', () => {
  const { k } = journey(42);
  // home was demoted, destination promoted
  assert.ok(aggregateOf(k, '0,0'), 'home region now statistical');
  assert.equal(aggregateOf(k, '9,9'), undefined, 'destination now individual');
  const there = [...k.graph.nodes.values()].filter(n => n.R != null && n.x >= 144 && n.y >= 144);
  assert.ok(there.length > 0, 'real individuals at the destination');
  // promotion/demotion are auditable ledger events (spec §4.3)
  assert.ok(k.ledger.events.some(e => e.type === 'promote' && e.attrs.region === '9,9'));
  assert.ok(k.ledger.events.some(e => e.type === 'demote' && e.attrs.region === '0,0'));
  // the year was real: statistical deaths happened somewhere and were recorded
  assert.ok(k.ledger.events.some(e => e.type === 'agg_deaths'), 'aggregate-level deaths are ledger truth');
});

test('probe LOD: conservation identity holds across tiers and transitions', () => {
  const seedK = new Kernel({ seed: 42 });
  spawnStart(seedK, START);
  ensureAllBaselines(seedK, BOUNDS, 0);
  const start = seedK.stocks(0);
  const f0 = (t => t.captured - t.burned - t.decayed - t.transferLoss)(seedK.ledger.totals);
  const { k } = journey(42);
  const end = k.stocks(k.tick);
  const f1 = (t => t.captured - t.burned - t.decayed - t.transferLoss)(k.ledger.totals);
  const scale = Math.max(Math.abs(k.ledger.totals.captured), 1);
  assert.ok(Math.abs((end - start) - (f1 - f0)) / scale < 1e-9,
    `Δstocks=${end - start} Δflows=${f1 - f0}`);
});

test('probe LOD: the journey is bit-identical on replay (world equation)', () => {
  assert.equal(canonicalDump(journey(42).k), canonicalDump(journey(42).k));
});

test('probe LOD: checkpoint mid-journey resumes bit-identically', () => {
  // run A: straight through
  const a = journey(42);
  // run B: same journey, but checkpoint+reload right after the travel promotion
  const k = new Kernel({ seed: 42 });
  spawnStart(k, START);
  ensureAllBaselines(k, BOUNDS, 0);
  const tm = new TierManager(k, { fullR: 0, ringR: 1, demoteR: 2 });   // must mirror journey()
  tm.update([{ x: 8, y: 8 }], 0);
  k.runTo(180 * DAY);
  tm.update([{ x: 8, y: 8 }], k.tick);
  k.runTo(360 * DAY);
  tm.update([{ x: 152, y: 152 }], k.tick);
  const db = openDb(':memory:');
  checkpoint(k, db);
  const k2 = loadKernel(db);
  k2.runTo(390 * DAY);
  assert.equal(canonicalDump(k2), canonicalDump(a.k));
});

test('probe LOD: a 1600×1600-tile statistical world runs a year cheaply', () => {
  const big = { x0: 0, y0: 0, w: 1600, h: 1600 };       // 10k regions ≈ 1.4M expected entities
  const k = new Kernel({ seed: 42 });
  ensureAllBaselines(k, big, 0);
  const aggs = [...k.graph.nodes.values()].filter(n => n.type === 'aggregate').length;
  assert.equal(aggs, 10000);
  const t0 = process.hrtime.bigint();
  k.runTo(360 * DAY);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 120_000, `statistical year took ${ms}ms`);   // generous CI bound
  assert.ok([...k.graph.nodes.values()].some(n => n.type === 'aggregate'), 'world still populated');
});
