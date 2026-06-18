// sim/test/floor-view-transform.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateFloorViewTransform, screenToWorldTile, focusTransform } from '../../src/render/floor-view.js';

test('screenToWorldTile inverts the stashed world transform', () => {
  // world transform: screenX = wx*tilePx - camX → wx = (screenX + camX)/tilePx
  updateFloorViewTransform(/*camX*/100, /*camY*/50, /*tilePx*/40, 800, 600);
  const p = screenToWorldTile(300, 250);
  assert.equal(p.tileX, (300 + 100) / 40);
  assert.equal(p.tileY, (250 + 50) / 40);
});

test('focusTransform fits a floor bounds inside the viewport, centered', () => {
  const layout = { bounds: { minX: 4, minY: 0, maxX: 15, maxY: 8 } }; // 12 x 9 tiles
  const V = focusTransform(layout, 1000, 700);
  assert.ok(V.tile > 0 && V.tile <= 54, 'tile size clamped');
  // a tile at the bounds centre maps near screen centre
  const cx = (4 + 15) / 2, cy = (0 + 8) / 2;
  const sx = V.ox + cx * V.tile, sy = V.oy + cy * V.tile;
  assert.ok(Math.abs(sx - 500) < V.tile * 1.5, 'horizontally centered');
  assert.ok(Math.abs(sy - 350) < V.tile * 2.5, 'vertically centered (slight top bias for walls)');
});
