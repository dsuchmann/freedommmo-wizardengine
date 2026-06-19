import { test } from 'node:test';
import assert from 'node:assert/strict';
import { facadeBands, windowStyle } from '../world/buildings/facade.js';
import { buildingNode } from '../world/buildings/blueprint-node.js';

const TOWER = { bx: 0, by: 8, typeId: 'commercial', category: 'commercial', tier: 'town', centrality: 0.85 };

test('window style by use', () => {
  assert.equal(windowStyle('shopfront'), 'shop');
  assert.equal(windowStyle('residential'), 'residential');
  assert.equal(windowStyle('storage'), 'slit');
  assert.equal(windowStyle('whatever'), 'plain');
});

test('one band per above-ground story; ground (0) carries the door, uppers do not', () => {
  const p = buildingNode(1337, TOWER).payload;
  const bands = facadeBands(p);
  assert.equal(bands.length, p.aboveGroundFloors, 'one band per above-ground story');
  assert.equal(bands[0].index, 0);
  assert.equal(bands[0].door, true, 'ground story carries the entrance');
  assert.ok(bands.slice(1).every(b => b.door === false), 'upper stories have no door');
});

test('a mixed-use tower has more than one window style across stories', () => {
  const bands = facadeBands(buildingNode(1337, TOWER).payload);
  const styles = new Set(bands.map(b => b.window));
  assert.ok(styles.size >= 2, 'shopfront ground + residential upper read differently');
});

test('basements (below grade) are excluded from the façade', () => {
  const bands = facadeBands(buildingNode(1337, TOWER).payload);
  assert.ok(bands.every(b => b.index >= 0), 'no negative-index stories on the exterior');
});

test('deterministic', () => {
  assert.deepEqual(facadeBands(buildingNode(1337, TOWER).payload), facadeBands(buildingNode(1337, TOWER).payload));
});
