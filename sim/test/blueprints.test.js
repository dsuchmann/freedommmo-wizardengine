// sim/test/blueprints.test.js — M4: pure blueprint grammar (no kernel, no RNG).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLUEPRINT_TEMPLATES, expandBlueprint } from '../world/blueprints.js';

test('templates: hut and forge are leaves with footprints; compound is a group with children', () => {
  assert.equal(BLUEPRINT_TEMPLATES.hut.footprint.width, 5);
  assert.equal(BLUEPRINT_TEMPLATES.hut.footprint.height, 4);
  assert.ok(Array.isArray(BLUEPRINT_TEMPLATES.compound.children));
  assert.equal(BLUEPRINT_TEMPLATES.compound.footprint, undefined, 'groups have no own footprint');
});

test('expand hut: perimeter walls, interior floor, door punched into south wall', () => {
  const ex = expandBlueprint('hut', 10, 20);
  // exactly one leaf
  assert.equal(ex.leaves.length, 1);
  const leaf = ex.leaves[0];
  assert.deepEqual(leaf.footprint, { x0: 10, y0: 20, w: 5, h: 4 });
  // stamp count: 5x4 footprint = 20 tiles, every tile stamped exactly once
  assert.equal(leaf.stamps.length, 20);
  const at = (x, y) => leaf.stamps.find(s => s.x === x && s.y === y);
  // corners are walls
  for (const [x, y] of [[10, 20], [14, 20], [10, 23], [14, 23]]) {
    assert.equal(at(x, y).piece, 'wall', `corner ${x},${y}`);
    assert.equal(at(x, y).walkable, false);
  }
  // door: south side (y = 20+4-1 = 23), offset 2 → x = 12
  assert.equal(at(12, 23).piece, 'door');
  assert.equal(at(12, 23).walkable, true);
  // interior tile is floor and walkable
  assert.equal(at(12, 21).piece, 'floor');
  assert.equal(at(12, 21).walkable, true);
  // material carried through from template
  assert.equal(at(10, 20).material, 'wattle');
  assert.equal(at(12, 21).material, 'dirt');
});

test('expand hut: interior features at absolute coordinates, inside the walls', () => {
  const ex = expandBlueprint('hut', 10, 20);
  const leaf = ex.leaves[0];
  const hearth = leaf.features.find(f => f.type === 'hearth');
  assert.deepEqual({ x: hearth.x, y: hearth.y }, { x: 11, y: 21 }, 'pos [1,1] relative to origin');
  assert.equal(hearth.provides, 'heat');
  // every feature sits on an interior (floor) tile
  for (const f of leaf.features) {
    const s = leaf.stamps.find(t => t.x === f.x && t.y === f.y);
    assert.equal(s.piece, 'floor', `feature ${f.type} on floor`);
  }
});

test('expand hut: npc slots carried as data', () => {
  const ex = expandBlueprint('hut', 0, 0);
  assert.deepEqual(ex.leaves[0].npcSlots, [{ role: 'resident', workplace: null, sleep: 'bedroll' }]);
});

test('expand forge: two doors on different sides are both walkable openings', () => {
  const ex = expandBlueprint('forge', 0, 0);
  const leaf = ex.leaves[0];
  const doors = leaf.stamps.filter(s => s.piece === 'door');
  assert.equal(doors.length, 2);
  // south door: y = 4, x = 2; east door: x = 5, y = 2
  assert.ok(doors.some(d => d.x === 2 && d.y === 4));
  assert.ok(doors.some(d => d.x === 5 && d.y === 2));
});

test('expand compound: nesting — children expand at relative offsets, leaves are separate buildings', () => {
  const ex = expandBlueprint('compound', 100, 50);
  assert.equal(ex.leaves.length, 2);
  const hut = ex.leaves.find(l => l.template === 'hut');
  const forge = ex.leaves.find(l => l.template === 'forge');
  assert.deepEqual(hut.footprint, { x0: 100, y0: 50, w: 5, h: 4 });
  assert.deepEqual(forge.footprint, { x0: 107, y0: 50, w: 6, h: 5 }, 'child offset dx=7 applied');
});

test('determinism: identical calls are bit-identical', () => {
  assert.deepEqual(expandBlueprint('compound', 3, 7), expandBlueprint('compound', 3, 7));
});

test('unknown template throws', () => {
  assert.throws(() => expandBlueprint('castle', 0, 0), /unknown blueprint/);
});
