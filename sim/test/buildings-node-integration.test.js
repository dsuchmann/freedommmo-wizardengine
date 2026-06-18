import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFootprint } from '../world/buildings/footprints.js';
import { BUILDING_TYPES } from '../world/buildings/taxonomy.js';

const TYPE_IDS = Object.keys(BUILDING_TYPES);

test('generateFootprint attaches a building BlueprintNode (S2.6)', () => {
  const fp = generateFootprint(42, 'house');
  assert.ok(fp.node, 'footprint should carry a node');
  assert.equal(fp.node.kind, 'building');
  assert.ok(Array.isArray(fp.node.payload.floorRange) && fp.node.payload.floorRange.length === 2, 'floorRange');
  assert.ok(Array.isArray(fp.node.payload.stackPlan), 'floorStackPlan');
  assert.ok(Array.isArray(fp.node.payload.stairCores), 'stairCores');
});

test('node realized sections deepEqual footprint.sections (same footprint, no regen)', () => {
  for (const id of TYPE_IDS.slice(0, 8)) {
    for (let s = 0; s < 5; s++) {
      const fp = generateFootprint(900 + s, id);
      if (!fp) continue;
      assert.deepEqual(fp.node.payload.sections, fp.sections, `${id}/${s}: node sections diverge`);
    }
  }
});

test('node is NON-ENUMERABLE — existing footprint shape is byte-identical', () => {
  const fp = generateFootprint(7, 'manor');
  assert.ok(!Object.keys(fp).includes('node'), 'node must not appear in own enumerable keys');
  assert.ok(!('node' in JSON.parse(JSON.stringify(fp))), 'node must not serialize');
  // structured-clone path (what the worker boundary would do) must not choke on functions
  assert.doesNotThrow(() => structuredClone(fp), 'footprint must remain structured-cloneable');
});

test('attaching the node does not change any existing footprint field', () => {
  // Re-deriving the same seed yields identical enumerable content (node is excluded).
  const a = generateFootprint(123, 'cottage');
  const b = generateFootprint(123, 'cottage');
  assert.deepEqual({ ...a }, { ...b });
  assert.ok(a.sections.length > 0 && a.doors.length >= 1 && a.boundingBox);
});

test('floorRange/stairCores are lazy by-products (reading them is consistent)', () => {
  const fp = generateFootprint(55, 'temple');
  const p1 = fp.node.payload;
  const p2 = fp.node.payload; // memoized — same object
  assert.equal(p1, p2);
  assert.ok(p1.aboveGroundFloors >= 1);
  // a floor materializes lazily and reuses the footprint sections for its interior
  const floor = fp.node.child(0);
  assert.equal(floor.kind, 'floor');
  assert.ok(Array.isArray(floor.payload.units));
});
