import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildingNode, footprintTiles, _stats, _resetStats,
} from '../world/buildings/blueprint-node.js';

const WORLD_SEED = 1234;
// Provide a sizeable footprint so floors partition into real units (this is also the
// S2.6 path: the node is handed the already-placed footprint).
const RECT = [{ x0: 0, y0: 0, w: 18, h: 13 }];
const CTX = {
  bx: 100, by: 200, typeId: 'apartment', category: 'apartment',
  tier: 'city', centrality: 0.85, sections: RECT,
};

const key = (x, y) => `${x},${y}`;

test('a building node is O(1) until a floor is touched (no floor/unit/room payloads)', () => {
  _resetStats();
  const b = buildingNode(WORLD_SEED, CTX);
  const floors = b.childKeys();           // enumerate floor indices — O(1)
  assert.ok(floors.length >= 1, 'should have floors');
  assert.ok(floors.includes(0), 'ground floor index 0 always present');
  assert.equal(_stats.payloads.floor, undefined, 'no floor payload generated yet');
  assert.equal(_stats.payloads.unit, undefined, 'no unit payload generated yet');
  assert.equal(_stats.payloads.building, 1, 'building payload generated once (for the floor range)');
});

test('touching floor N materializes only that floor, not its siblings', () => {
  _resetStats();
  const b = buildingNode(WORLD_SEED, CTX);
  const floors = b.childKeys();
  const upper = floors.find((i) => i >= 1) ?? floors[floors.length - 1];
  const floor = b.child(upper);
  void floor.payload;                     // materialize exactly one floor
  assert.equal(_stats.payloads.floor, 1, 'exactly one floor materialized');
  assert.deepEqual(b.materializedKeys(), [upper], 'only the touched floor is cached');
});

test('same path is byte-identical across a fresh regeneration (cache-evict safe)', () => {
  const path = (b) => {
    const upper = b.childKeys().find((i) => i >= 1) ?? 0;
    const floor = b.child(upper);
    const unit = floor.child(floor.childKeys()[0]);
    const room = unit.child(0);
    return { floor: floor.payload, unit: unit.payload, room: room.payload };
  };
  const a = path(buildingNode(WORLD_SEED, CTX));
  const b = path(buildingNode(WORLD_SEED, CTX)); // brand-new tree, no shared cache
  assert.deepEqual(a, b);
});

test('the tree bottoms out at room (subFloor depth <= 1: room is a leaf)', () => {
  const b = buildingNode(WORLD_SEED, CTX);
  const floor = b.child(0);
  const unitKeys = floor.childKeys();
  assert.ok(unitKeys.length >= 1, 'floor has at least one unit');
  const unit = floor.child(unitKeys[0]);
  assert.deepEqual(unit.childKeys(), [0], 'a unit has exactly one room');
  const room = unit.child(0);
  assert.deepEqual(room.childKeys(), [], 'room is a leaf — no deeper nesting');
});

test('ancestorContext is CLOSED — no sibling references', () => {
  const b = buildingNode(WORLD_SEED, CTX);
  const floor = b.child(b.childKeys()[0]);
  const unit = floor.child(floor.childKeys()[0]);
  // A floor knows building-level data + its own index/use, never the other floors.
  const FLOOR_KEYS = new Set(['buildingId', 'sections', 'stairCore', 'floorIndex', 'floorUse',
    'aboveGroundFloors', 'lift', 'typeId', 'category', 'tier', 'race']);
  for (const k of Object.keys(floor.ancestorContext)) assert.ok(FLOOR_KEYS.has(k), `unexpected floor ctx key ${k}`);
  assert.ok(!('floors' in floor.ancestorContext) && !('units' in floor.ancestorContext) && !('siblings' in floor.ancestorContext),
    'floor ctx must not enumerate siblings');
  // A unit knows its floor id (a string), not the floor node or its other units.
  assert.equal(typeof unit.ancestorContext.floorId, 'string');
  assert.ok(!('units' in unit.ancestorContext), 'unit ctx must not list sibling units');
});

test('claim-safety: every generated doorTile + stairCore lies inside the building footprint', () => {
  const b = buildingNode(WORLD_SEED, CTX);
  const owned = footprintTiles(b);
  for (const core of b.payload.stairCores) {
    assert.ok(owned.has(key(core.x, core.y)), `stair core ${core.x},${core.y} outside footprint`);
  }
  for (const fIdx of b.childKeys()) {
    const floor = b.child(fIdx);
    for (const u of floor.payload.units) {
      assert.ok(owned.has(key(u.doorTile.x, u.doorTile.y)), `door ${u.doorTile.x},${u.doorTile.y} outside footprint`);
    }
  }
});

test('generated-shape path (no sections handed in) still produces a coherent node', () => {
  const ctx = { bx: 7, by: 9, typeId: 'manor', category: 'civic', tier: 'world_capital', centrality: 1 };
  const b = buildingNode(WORLD_SEED, ctx);
  assert.ok(b.payload.sections.length >= 1, 'shape produced sections');
  assert.ok(b.payload.aboveGroundFloors >= 1);
  // determinism on the generated-shape path too
  assert.deepEqual(buildingNode(WORLD_SEED, ctx).payload.sections, b.payload.sections);
});
