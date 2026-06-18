// sim/test/buildings-lift-core.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildingNode } from '../world/buildings/blueprint-node.js';

const TOWER = { bx: 0, by: 8, typeId: 'commercial', category: 'commercial', tier: 'town', centrality: 0.85 };
const key = (x, y) => `${x},${y}`;

test('lift building has aboveGround>3 and a lift', () => {
  const b = buildingNode(1337, TOWER);
  assert.ok(b.payload.aboveGroundFloors > 3, 'this fixture is a tall building');
  assert.ok(b.payload.lift, 'a tall building reserves a lift');
});

test('stair core AND lift shaft are walkable circulation on every floor, never inside a unit', () => {
  const b = buildingNode(1337, TOWER);
  const core = b.payload.stairCores[0];
  const shaft = b.payload.lift.shaft;
  for (const fIdx of b.childKeys()) {
    const f = b.child(fIdx).payload;
    const circ = new Set(f.circulation);
    assert.ok(circ.has(key(core.x, core.y)), `floor ${fIdx}: stair core not walkable`);
    assert.ok(circ.has(key(shaft.x, shaft.y)), `floor ${fIdx}: lift shaft not walkable`);
    for (const u of f.units) {
      assert.ok(!u.tiles.some(t => t.x === core.x && t.y === core.y), `floor ${fIdx}: stair core inside a unit`);
      assert.ok(!u.tiles.some(t => t.x === shaft.x && t.y === shaft.y), `floor ${fIdx}: lift shaft inside a unit`);
    }
  }
});

test('every unit door is still reachable from circulation after the carve-out', () => {
  const b = buildingNode(1337, TOWER);
  for (const fIdx of b.childKeys()) {
    const f = b.child(fIdx).payload;
    const circ = new Set(f.circulation);
    for (const u of f.units) {
      const d = u.doorTile;
      const adj = [[d.x + 1, d.y], [d.x - 1, d.y], [d.x, d.y + 1], [d.x, d.y - 1]].some(([x, y]) => circ.has(key(x, y)));
      assert.ok(adj, `floor ${fIdx}: unit door ${d.x},${d.y} not adjacent to circulation`);
    }
  }
});

test('lift gating unchanged: lift present iff aboveGroundFloors > 3', () => {
  const house = buildingNode(1337, { bx: 0, by: 0, typeId: 'house', category: 'house', tier: 'village', centrality: 0.1 });
  assert.equal(house.payload.lift, null);
  assert.ok(house.payload.aboveGroundFloors <= 3);
});
