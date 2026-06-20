import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveBuildingsInRange, relocateBuilding, MAX_RELOCATE_RADIUS,
  buildingTouchesWater, buildingSpansCliff,
} from '../world/buildings/resolved-buildings.js';
import { classifyBiomeNoStream } from '../../src/world/biomes.js';

const SEED = 42;
const RANGE = [19, 10, 21, 12];
const WATER = new Set(['ocean', 'deep_ocean', 'lake', 'river', 'shallow_water']);

// Find a water tile that is genuinely RELOCATABLE at the current MAX_RELOCATE_RADIUS —
// i.e. on water, not a cliff, and with a valid site reachable by relocateBuilding. Validating
// with relocateBuilding (a 4×4 probe, the larger fixture) keeps the test robust to the radius
// value: it always picks a near-shore tile rather than an arbitrary one stranded far from land.
// Fully deterministic (SEED-42 geography scanned in fixed order).
function findWaterTile() {
  const fp = { boundingBox: { x0: 0, y0: 0, w: 4, h: 4 }, sections: [{ x0: 0, y0: 0, w: 4, h: 4 }] };
  for (let y = 440; y <= 600; y++) {
    for (let x = 500; x <= 620; x++) {
      const b = { x, y, footprint: fp };
      if (buildingTouchesWater(b) && !buildingSpansCliff(b) && relocateBuilding(b, new Set())) return { x, y };
    }
  }
  return null;
}

test('relocateBuilding moves a water-blocked building onto valid ground', () => {
  const wet = findWaterTile();
  assert.ok(wet, 'expected to find a water tile near spawn');
  const fp = { boundingBox: { x0: 0, y0: 0, w: 4, h: 4 }, sections: [{ x0: 0, y0: 0, w: 4, h: 4 }] };
  const b = { x: wet.x, y: wet.y, footprint: fp };
  assert.ok(buildingTouchesWater(b), 'fixture should start on water');
  const at = relocateBuilding(b, new Set());
  assert.ok(at, 'expected a valid relocation within MAX_RELOCATE_RADIUS');
  const moved = { x: at.x, y: at.y, footprint: fp };
  assert.ok(!buildingTouchesWater(moved) && !buildingSpansCliff(moved), 'relocated site must be valid');
  const dist = Math.max(Math.abs(at.x - b.x), Math.abs(at.y - b.y));
  assert.ok(dist >= 1 && dist <= MAX_RELOCATE_RADIUS, 'relocation within the search radius');
});

test('relocateBuilding is deterministic', () => {
  const wet = findWaterTile();
  const fp = { boundingBox: { x0: 0, y0: 0, w: 4, h: 4 }, sections: [{ x0: 0, y0: 0, w: 4, h: 4 }] };
  const b = { x: wet.x, y: wet.y, footprint: fp };
  assert.deepEqual(relocateBuilding(b, new Set()), relocateBuilding(b, new Set()));
});

test('relocateBuilding respects localOccupied (won\'t return an occupied tile)', () => {
  const wet = findWaterTile();
  const fp = { boundingBox: { x0: 0, y0: 0, w: 2, h: 2 }, sections: [{ x0: 0, y0: 0, w: 2, h: 2 }] };
  const b = { x: wet.x, y: wet.y, footprint: fp };
  const first = relocateBuilding(b, new Set());
  const occ = new Set();
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) occ.add((first.x + dx) + ',' + (first.y + dy));
  const second = relocateBuilding(b, occ);
  assert.ok(second, 'should still find a spot');
  assert.notDeepEqual(second, first, 'must avoid the occupied footprint');
});

test('no resolved building sits on water or a cliff (relocation guarantees validity)', () => {
  const { buildings } = resolveBuildingsInRange(SEED, ...RANGE);
  assert.ok(buildings.length > 0, 'expected buildings in the populated range');
  for (const b of buildings) {
    assert.ok(!buildingTouchesWater(b), `building at ${b.x},${b.y} still on water`);
    assert.ok(!buildingSpansCliff(b), `building at ${b.x},${b.y} still spans a cliff`);
  }
});

test('relocated buildings are tagged and remain deterministic', () => {
  const snap = () => resolveBuildingsInRange(SEED, ...RANGE).buildings.map(b => ({ x: b.x, y: b.y, from: b.relocatedFrom || null }));
  assert.deepEqual(snap(), snap(), 'relocation must be deterministic across resolves');
  for (const b of resolveBuildingsInRange(SEED, ...RANGE).buildings) {
    if (b.relocatedFrom) {
      const orig = { x: b.relocatedFrom.x, y: b.relocatedFrom.y, footprint: b.footprint };
      assert.ok(buildingTouchesWater(orig) || buildingSpansCliff(orig),
        'relocatedFrom must point at an invalid origin');
    }
  }
});
