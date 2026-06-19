import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floorMaterial } from '../world/buildings/floor-materials.js';
import { buildingNode } from '../world/buildings/blueprint-node.js';
import { resolveFloorLayout } from '../world/buildings/floor-layout.js';

test('material differs by floor use (distinct floors read differently)', () => {
  assert.equal(floorMaterial('lobby'), 'marble');
  assert.equal(floorMaterial('shopfront'), 'stone_slab');
  assert.equal(floorMaterial('residential'), 'wood_plank');
  assert.equal(floorMaterial('storage'), 'packed_dirt');
  assert.notEqual(floorMaterial('lobby'), floorMaterial('residential'));
});

test('unknown/empty use falls back to wood_plank, deterministic', () => {
  assert.equal(floorMaterial('whatever'), 'wood_plank');
  assert.equal(floorMaterial(undefined), 'wood_plank');
  assert.equal(floorMaterial('lobby'), floorMaterial('lobby'));
});

test('the floor node + resolveFloorLayout expose the per-floor material', () => {
  // commercial town tower: storage basement -> shopfront -> commercial -> residential...
  const b = buildingNode(1337, { bx: 0, by: 8, typeId: 'commercial', category: 'commercial', tier: 'town', centrality: 0.85 });
  for (const fIdx of b.childKeys()) {
    const f = b.child(fIdx).payload;
    assert.equal(f.material, floorMaterial(f.use), `floor ${fIdx} node material matches its use`);
    assert.equal(resolveFloorLayout(b, fIdx).material, f.material, `floor ${fIdx} layout exposes the material`);
  }
  // a tower spans uses, so at least two distinct floor materials exist across it
  const mats = new Set(b.childKeys().map(i => b.child(i).payload.material));
  assert.ok(mats.size >= 2, 'a multi-use tower has more than one floor material');
});
