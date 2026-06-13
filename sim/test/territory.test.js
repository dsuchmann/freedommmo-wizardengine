// sim/test/territory.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTerritory, territoryAt } from '../world/territory.js';

test('computeTerritory produces an influence map from center', () => {
  const territory = computeTerritory(42, { x: 500, y: 500 }, 'village');
  assert.ok(territory, 'territory exists');
  assert.ok(territory.tiles.size > 0, 'has claimed tiles');
  assert.ok(territory.center, 'has center');
  assert.equal(territory.center.x, 500);
  assert.equal(territory.center.y, 500);
});

test('center tile has maximum influence', () => {
  const territory = computeTerritory(42, { x: 500, y: 500 }, 'village');
  const centerInfluence = territory.tiles.get('500,500');
  assert.ok(centerInfluence !== undefined, 'center tile exists');
  for (const [key, inf] of territory.tiles) {
    assert.ok(inf <= centerInfluence, `tile ${key} has higher influence than center`);
  }
});

test('influence decreases with distance from center', () => {
  const territory = computeTerritory(42, { x: 500, y: 500 }, 'village');
  const c = territory.tiles.get('500,500');
  const near = territory.tiles.get('505,500') ?? 0;
  const far = territory.tiles.get('520,500') ?? 0;
  assert.ok(c >= near, 'center >= near');
  assert.ok(near >= far, 'near >= far');
});

test('territory is larger for higher tiers', () => {
  const village = computeTerritory(42, { x: 500, y: 500 }, 'village');
  const town = computeTerritory(42, { x: 500, y: 500 }, 'town');
  const city = computeTerritory(42, { x: 500, y: 500 }, 'city');
  assert.ok(town.tiles.size > village.tiles.size, 'town > village');
  assert.ok(city.tiles.size > town.tiles.size, 'city > town');
});

test('territory shape is NOT rectangular (organic contour)', () => {
  const territory = computeTerritory(42, { x: 500, y: 500 }, 'town');
  // Compute actual bounding box and compare area to tile count.
  // A rectangle would have tileCount == bbox area.
  // Organic shape should be smaller (contour cuts corners).
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const key of territory.tiles.keys()) {
    const [x, y] = key.split(',').map(Number);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const bboxArea = (maxX - minX + 1) * (maxY - minY + 1);
  assert.ok(territory.tiles.size < bboxArea * 0.95,
    `territory fills ${(territory.tiles.size / bboxArea * 100).toFixed(0)}% of bbox -- too rectangular`);
});

test('territory is deterministic', () => {
  const a = computeTerritory(42, { x: 500, y: 500 }, 'village');
  const b = computeTerritory(42, { x: 500, y: 500 }, 'village');
  assert.equal(a.tiles.size, b.tiles.size);
});

test('territoryAt returns settlement + influence for claimed tile', () => {
  const settlements = [
    { seed: 42, site: { x: 500, y: 500 }, tier: 'town', id: 'town1' },
  ];
  const result = territoryAt(42, 500, 500, settlements);
  assert.ok(result, 'center tile is claimed');
  assert.equal(result.settlement, 'town1');
  assert.ok(result.influence > 0);
});

test('territoryAt returns null for unclaimed tile', () => {
  const settlements = [
    { seed: 42, site: { x: 500, y: 500 }, tier: 'village', id: 'v1' },
  ];
  const result = territoryAt(42, 0, 0, settlements);
  assert.equal(result, null, 'far tile is unclaimed');
});

test('overlapping territories: nearest wins at boundary', () => {
  const settlements = [
    { seed: 42, site: { x: 500, y: 500 }, tier: 'town', id: 'town1' },
    { seed: 42, site: { x: 530, y: 500 }, tier: 'town', id: 'town2' },
  ];
  // Midpoint at x=515 -- should belong to whichever has higher influence
  const result = territoryAt(42, 515, 500, settlements);
  assert.ok(result, 'midpoint is claimed by someone');
  // Both are equidistant -- result depends on noise, but must be one of them
  assert.ok(result.settlement === 'town1' || result.settlement === 'town2');
});
