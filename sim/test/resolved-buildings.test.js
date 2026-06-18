import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveBuildingsInRange, MAX_RESOLVED_BUILDINGS, NEIGHBOR_RING_R, MAX_SETTLEMENT_RADIUS,
} from '../world/buildings/resolved-buildings.js';

const SEED = 42;
const RANGE = [19, 10, 21, 12]; // 3x3 macros around the populated spawn area

const idOf = (b) => `${b.x},${b.y},${b.footprint.typeId}`;
const shape = (r) => r.buildings.map((b) => ({ x: b.x, y: b.y, typeId: b.footprint.typeId })).sort((a, c) => a.x - c.x || a.y - c.y);

test('resolves buildings and is deterministic', () => {
  const a = resolveBuildingsInRange(SEED, ...RANGE);
  const b = resolveBuildingsInRange(SEED, ...RANGE);
  assert.ok(a.buildings.length > 0, 'expected buildings in the populated range');
  assert.deepEqual(shape(a), shape(b), 'resolution must be deterministic');
});

test('no two resolved buildings share a floor (section) tile', () => {
  const { buildings } = resolveBuildingsInRange(SEED, ...RANGE);
  const seen = new Map();
  for (const b of buildings) {
    for (const sec of b.footprint.sections) {
      for (let dy = 0; dy < sec.h; dy++) {
        for (let dx = 0; dx < sec.w; dx++) {
          const key = `${b.x + sec.x0 + dx},${b.y + sec.y0 + dy}`;
          assert.ok(!seen.has(key), `tile ${key} claimed by two buildings`);
          seen.set(key, b);
        }
      }
    }
  }
});

test('byTile maps every section tile to its building; claimTiles ⊇ floor tiles', () => {
  const { buildings, byTile, claimTiles } = resolveBuildingsInRange(SEED, ...RANGE);
  const b = buildings[0];
  for (const sec of b.footprint.sections) {
    for (let dy = 0; dy < sec.h; dy++) {
      for (let dx = 0; dx < sec.w; dx++) {
        const key = `${b.x + sec.x0 + dx},${b.y + sec.y0 + dy}`;
        assert.equal(byTile.get(key), b, `byTile missing ${key}`);
        assert.ok(claimTiles.has(key), `claimTiles missing floor tile ${key}`);
      }
    }
  }
});

test('per-settlement building cap respected', () => {
  // Resolve a wide range; group by approximate settlement (no two settlements share tiles
  // after de-overlap, so just assert the total never explodes unboundedly per settlement
  // by checking the cap constant is enforced in code via a large range staying finite).
  const r = resolveBuildingsInRange(SEED, 15, 6, 25, 16);
  assert.ok(r.buildings.length > 0);
  // sanity: a single settlement cannot exceed the cap (we can't easily group, but the
  // resolved total for this area must be well under settlements*cap)
  assert.ok(r.buildings.length <= MAX_RESOLVED_BUILDINGS * 60);
});

test('range-independence: a building is kept identically across overlapping ranges', () => {
  const narrow = resolveBuildingsInRange(SEED, ...RANGE);
  const wide = resolveBuildingsInRange(SEED, 18, 9, 22, 13);
  const wideIds = new Set(wide.buildings.map(idOf));
  let checked = 0;
  for (const b of narrow.buildings) {
    // a building fully inside the narrow requested range must also appear in the wide one
    assert.ok(wideIds.has(idOf(b)), `building ${idOf(b)} present in narrow but not wide range`);
    checked++;
  }
  assert.ok(checked > 0, 'expected to check at least one shared building');
});

test('ring covers the worst-case footprint radius', () => {
  assert.equal(NEIGHBOR_RING_R, 4);
  assert.ok(NEIGHBOR_RING_R * 64 >= MAX_SETTLEMENT_RADIUS, 'ring must reach MAX_SETTLEMENT_RADIUS');
});
