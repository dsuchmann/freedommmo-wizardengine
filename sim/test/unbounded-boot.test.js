import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { openDb } from '../store/db.js';
import { checkpoint, loadKernel } from '../store/checkpoint.js';
import { findLandStart, ensureRegionBaseline } from '../world/spawn.js';
import { findSettlementSite } from '../society/suitability.js';
import { tileCost } from '../world/routing.js';
import { bootWorld } from '../server/main.js';

test('checkpoint round-trips the touched frontier (no bounds meta)', () => {
  const db = openDb(':memory:');
  const kernel = new Kernel({ seed: 42 });
  ensureRegionBaseline(kernel, '100,100', 0);
  ensureRegionBaseline(kernel, '-5,7', 0);
  checkpoint(kernel, db);
  const loaded = loadKernel(db);
  assert.deepEqual([...loaded.touched].sort(), [...kernel.touched].sort());
  assert.equal(db.prepare('SELECT value FROM meta WHERE key=?').get('bounds'), undefined);
});

test('ocean-spawn regression: old default coords resolve to a land start', () => {
  const start = findLandStart({ x: 0, y: 0 });
  assert.ok(start, 'land start found near 0,0');
  let land = 0, total = 0;
  for (let y = start.y0; y < start.y0 + start.h; y++) for (let x = start.x0; x < start.x0 + start.w; x++) {
    total++; if (tileCost(x, y) !== Infinity) land++;
  }
  assert.ok(land / total >= 0.6, `start rect is mostly land (${(land / total).toFixed(2)})`);
  const kernel = new Kernel({ seed: 42 });
  const site = findSettlementSite(kernel, start);
  assert.ok(site && site.score > 0, 'positive suitability inside the start rect');
});

test('findLandStart is deterministic', () => {
  assert.deepEqual(findLandStart({ x: 12345, y: -9876 }), findLandStart({ x: 12345, y: -9876 }));
});

test('bootWorld boots a fresh unbounded world on land', () => {
  const db = openDb(':memory:');
  const kernel = bootWorld(db, { seed: 42, spawn: { x: 0, y: 0 } });
  assert.ok(kernel.graph.nodes.size > 0, 'start area spawned individuals');
  const living = [...kernel.graph.nodes.values()].filter(n => n.R != null && n.x != null);
  assert.ok(living.length > 0, 'living entities exist');
  const onLand = living.filter(n => tileCost(Math.round(n.x), Math.round(n.y)) !== Infinity);
  assert.ok(onLand.length / living.length >= 0.5, `majority on land (${onLand.length}/${living.length})`);
});
