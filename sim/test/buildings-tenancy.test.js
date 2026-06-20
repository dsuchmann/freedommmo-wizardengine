import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBuildingsInRange } from '../world/buildings/resolved-buildings.js';
import { buildingTenancies } from '../world/buildings/tenancy.js';

const SEED = 42;
// Inland populated range (same area the layout tests use, around (1460,768)).
const RANGE = [21, 11, 24, 13];

function buildings() { return resolveBuildingsInRange(SEED, ...RANGE).buildings.filter(b => b.footprint?.node); }

test('every building yields >=1 tenancy and every unit belongs to exactly one', () => {
  const bs = buildings();
  assert.ok(bs.length > 0, 'expected buildings');
  for (const b of bs.slice(0, 12)) {
    const ts = buildingTenancies(b.footprint.node);
    assert.ok(ts.length >= 1, `building ${b.x},${b.y} has no tenancy`);
    const seen = new Set();
    for (const t of ts) for (const uid of t.unitIds) {
      assert.ok(!seen.has(uid), `unit ${uid} in two tenancies`);
      seen.add(uid);
    }
    for (const t of ts) {
      assert.ok(t.id && t.kind && Array.isArray(t.floors) && t.floors.length >= 1, 'tenancy shape');
      assert.ok(t.slots && (t.slots.home + t.slots.work) >= 0, 'tenancy has slots');
    }
  }
});

test('a multi-floor business is ONE tenancy spanning floors; residential units are separate households', () => {
  const bs = buildings();
  let spanning = null, multiHousehold = null;
  for (const b of bs) {
    const ts = buildingTenancies(b.footprint.node);
    if (!spanning && ts.some(t => t.kind !== 'household' && t.floors.length > 1)) spanning = ts;
    if (!multiHousehold && ts.filter(t => t.kind === 'household').length > 1) multiHousehold = ts;
  }
  if (spanning) {
    const biz = spanning.find(t => t.kind !== 'household' && t.floors.length > 1);
    assert.ok(biz.floors.length > 1, 'business tenancy spans multiple floors');
  }
  if (multiHousehold) {
    assert.ok(multiHousehold.filter(t => t.kind === 'household').length > 1, 'multiple household tenancies');
  }
  assert.ok(spanning || multiHousehold, 'expected a spanning-business or multi-household building in range');
});

test('buildingTenancies is deterministic', () => {
  const b = buildings()[0];
  assert.deepEqual(buildingTenancies(b.footprint.node), buildingTenancies(b.footprint.node));
});
