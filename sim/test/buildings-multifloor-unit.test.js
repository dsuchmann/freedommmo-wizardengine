// sim/test/buildings-multifloor-unit.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildingNode, _stats, _resetStats } from '../world/buildings/blueprint-node.js';

// Commercial town tower: large shop/apartment floors → some units become multi-floor.
const CTX = { bx: 0, by: 8, typeId: 'commercial', category: 'commercial', tier: 'town', centrality: 0.85 };

function findMultiFloorUnit(b) {
  for (const fIdx of b.childKeys()) {
    const floor = b.child(fIdx);
    for (const uIdx of floor.childKeys()) {
      const u = floor.child(uIdx);
      if (u.payload.subFloors > 1) return u;
    }
  }
  return null;
}
function anyMultiFloorUnit() {
  for (let s = 0; s < 80; s++) { const u = findMultiFloorUnit(buildingNode(1000 + s, CTX)); if (u) return { u, seed: 1000 + s }; }
  return null;
}

test('eligible units can be multi-floor: subFloors>=2 with a private stair on a unit tile', () => {
  const hit = anyMultiFloorUnit();
  assert.ok(hit, 'expected at least one multi-floor unit across 80 commercial towers');
  const u = hit.u;
  assert.ok(u.payload.subFloors >= 2);
  assert.ok(u.payload.privateStair, 'multi-floor unit has a private stair');
  assert.ok(u.payload.tiles.some(t => t.x === u.payload.privateStair.x && t.y === u.payload.privateStair.y),
    'private stair is one of the unit tiles');
});

test('a multi-floor unit has one room per sub-floor; each room is a leaf (recursion depth <= 1)', () => {
  const { u } = anyMultiFloorUnit();
  const keys = u.childKeys();
  assert.equal(keys.length, u.payload.subFloors, 'one room child per sub-floor');
  for (const k of keys) assert.deepEqual(u.child(k).childKeys(), [], 'sub-floor room is a leaf — no deeper nesting');
  assert.deepEqual(u.child(1).payload.doorTile, u.payload.privateStair, 'upper sub-floor enters via the private stair');
});

test('sub-floor rooms materialize lazily (touching room 0 does not build room 1)', () => {
  const { u } = anyMultiFloorUnit();
  _resetStats();
  void u.child(0).payload;
  assert.equal(_stats.payloads.room, 1, 'exactly one sub-floor room materialized');
  assert.deepEqual(u.materializedKeys().sort((a, b) => a - b), [0], 'only room 0 cached');
});

test('single-floor (ineligible) unit is still exactly one room', () => {
  // floor 0 of this tower is a shopfront → SINGLE_USE single unit of kind "shop"; but a
  // lobby/storage unit is guaranteed ineligible. Use a house: one lobby unit.
  const house = buildingNode(1337, { bx: 0, by: 0, typeId: 'house', category: 'house', tier: 'village', centrality: 0.1 });
  const floor = house.child(0);
  const u = floor.child(floor.childKeys()[0]);
  assert.equal(u.payload.subFloors, 1);
  assert.deepEqual(u.childKeys(), [0], 'single-floor unit has exactly one room');
});

test('deterministic: the multi-floor structure regenerates byte-identically', () => {
  const { seed } = anyMultiFloorUnit();
  const ua = findMultiFloorUnit(buildingNode(seed, CTX));
  const ub = findMultiFloorUnit(buildingNode(seed, CTX));
  assert.deepEqual(ua.payload, ub.payload);
  assert.deepEqual(ua.child(1).payload, ub.child(1).payload);
});
