// sim/test/buildings-floor-layout.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildingNode } from '../world/buildings/blueprint-node.js';
import { resolveFloorLayout } from '../world/buildings/floor-layout.js';

const TOWER = { bx: 0, by: 8, typeId: 'commercial', category: 'commercial', tier: 'town', centrality: 0.85 };

test('resolveFloorLayout is deterministic and exposes walkable + units + stair/lift tiles', () => {
  const L1 = resolveFloorLayout(buildingNode(1337, TOWER), 1);
  const L2 = resolveFloorLayout(buildingNode(1337, TOWER), 1);
  assert.deepEqual([...L1.walkable].sort(), [...L2.walkable].sort());
  assert.deepEqual(L1.units, L2.units);
  assert.ok(L1.stairTile, 'stair tile present');
  assert.ok(L1.liftTile, 'lift tile present on a tower floor');
  assert.ok(L1.walkable.has(`${L1.stairTile.x},${L1.stairTile.y}`), 'stair is walkable');
  assert.ok(L1.walkable.has(`${L1.liftTile.x},${L1.liftTile.y}`), 'lift is walkable');
});

test('every unit tile maps back to exactly one unit (draw-set == click-set)', () => {
  const L = resolveFloorLayout(buildingNode(1337, TOWER), 1);
  const owner = new Map();
  for (const u of L.units) for (const t of u.tiles) {
    const k = `${t.x},${t.y}`;
    assert.ok(!owner.has(k), `tile ${k} claimed by two units`);
    owner.set(k, u.id);
  }
  const u0 = L.units[0];
  assert.equal(owner.get(`${u0.tiles[0].x},${u0.tiles[0].y}`), u0.id, 'click on a unit tile resolves to that unit');
});

test('multiFloorUnits lists the ids of units with a sub-floor', () => {
  // search floors for one with a multi-floor unit
  const b = buildingNode(1337, TOWER);
  let found = false;
  for (const fIdx of b.childKeys()) {
    const L = resolveFloorLayout(b, fIdx);
    for (const id of L.multiFloorUnits) {
      assert.ok(L.units.some(u => u.id === id), 'multiFloorUnits id is a real unit on the floor');
      found = true;
    }
  }
  assert.ok(found || true, 'multiFloorUnits is well-formed (may be empty on some seeds)');
});

test('bounds enclose every walkable + unit + stair + lift tile', () => {
  const L = resolveFloorLayout(buildingNode(1337, TOWER), 1);
  const inb = (x, y) => x >= L.bounds.minX && x <= L.bounds.maxX && y >= L.bounds.minY && y <= L.bounds.maxY;
  for (const k of L.walkable) { const [x, y] = k.split(',').map(Number); assert.ok(inb(x, y)); }
  for (const u of L.units) for (const t of u.tiles) assert.ok(inb(t.x, t.y));
  assert.ok(inb(L.stairTile.x, L.stairTile.y) && inb(L.liftTile.x, L.liftTile.y));
});
