// sim/test/active-interior.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildingNode } from '../world/buildings/blueprint-node.js';
import * as AI from '../../src/render/active-interior.js';

const TOWER = { bx: 0, by: 8, typeId: 'commercial', category: 'commercial', tier: 'town', centrality: 0.85 }; // lift, floors -1..4
const HOUSE = { bx: 0, by: 0, typeId: 'house', category: 'house', tier: 'village', centrality: 0.1 };

function fakeBuilding(ctx, x, y) { return { x, y, footprint: { node: buildingNode(1337, ctx) } }; }

test('enterAt starts on the lowest above-ground floor and records world origin', () => {
  const b = fakeBuilding(TOWER, 100, 200);
  const ai = AI.enterAt(b);
  assert.equal(ai.floorIndex, 0);
  assert.equal(ai.bx, 100); assert.equal(ai.by, 200);
  assert.ok(ai.layout && ai.layout.walkable instanceof Set, 'layout resolved for the start floor');
  assert.ok(AI.isInside());
  AI.exitInterior(); assert.equal(AI.isInside(), false);
});

test('changeFloor steps and clamps, re-resolving the layout', () => {
  AI.enterAt(fakeBuilding(TOWER, 0, 0)); // keys -1..4 start 0
  assert.equal(AI.changeFloor(-1), true); assert.equal(AI.getActiveInterior().floorIndex, -1);
  assert.equal(AI.changeFloor(-1), false, 'clamped at basement');
  for (let i = 0; i < 6; i++) AI.changeFloor(1);
  assert.equal(AI.getActiveInterior().floorIndex, 4, 'clamped at top');
  // layout follows the floor
  assert.equal(AI.getActiveInterior().layout.floorIndex, 4);
  AI.exitInterior();
});

test('isWalkableLocal: circulation + units + stair + lift walkable; walls/void block', () => {
  AI.enterAt(fakeBuilding(TOWER, 0, 0));
  const L = AI.getActiveInterior().layout;
  const [sx, sy] = [...L.walkable][0].split(',').map(Number);
  assert.equal(AI.isWalkableLocal(sx, sy), true, 'a circulation tile is walkable');
  if (L.stairTile) assert.equal(AI.isWalkableLocal(L.stairTile.x, L.stairTile.y), true, 'stair walkable');
  if (L.liftTile) assert.equal(AI.isWalkableLocal(L.liftTile.x, L.liftTile.y), true, 'lift walkable (P2)');
  const u0 = L.units[0]; const t = u0.tiles[0];
  assert.equal(AI.isWalkableLocal(t.x, t.y), true, 'a unit floor tile is walkable');
  assert.equal(AI.isWalkableLocal(9999, 9999), false, 'off-footprint void blocks');
  AI.exitInterior();
});

test('dimAlphaForFloor increases with height and clamps', () => {
  assert.ok(AI.dimAlphaForFloor(0) < AI.dimAlphaForFloor(3), 'higher floor dims more');
  assert.ok(AI.dimAlphaForFloor(50) <= 0.9, 'clamped');
  assert.ok(AI.dimAlphaForFloor(0) >= 0.3, 'ground floor already dims the outside');
});
