// sim/test/door-leaf-fit.test.js — door leaf doorway-hole sub-rect fit.
// The swung leaf must land INSIDE the doorway cut-out sub-rect of the 2t×wH piece (not the full
// piece), so it doesn't overhang the masonry jambs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doorwayHoleScreenRect, DEFAULT_HOLE } from '../../src/render/door-leaves.js';
import { doorwayHole } from '../../sim/world/buildings/building-material-registry.js';

test('doorwayHoleScreenRect maps a fractional hole to the screen sub-rect of the 2t×wH piece', () => {
  const r = doorwayHoleScreenRect({ x0: 0.25, y0: 0.10, w: 0.5, h: 0.85 }, 100, 50, 64, 128);
  assert.equal(r.dx, 100 + 0.25 * 64);
  assert.equal(r.dy, 50 + 0.10 * 128);
  assert.equal(r.dw, 0.5 * 64);
  assert.equal(r.dh, 0.85 * 128);
});

test('DEFAULT_HOLE is a real sub-rect (narrower/shorter than the full piece)', () => {
  assert.ok(DEFAULT_HOLE.w < 1 && DEFAULT_HOLE.h < 1, 'default hole is inside the piece');
  assert.ok(DEFAULT_HOLE.x0 > 0, 'default hole is inset from the left jamb');
});

test('registry doorwayHole feeds a real sub-rect for each grassland material', () => {
  for (const m of ['cob', 'fieldstone', 'wattle_daub', 'timber_frame']) {
    const r = doorwayHoleScreenRect(doorwayHole(m), 0, 0, 64, 128);
    assert.ok(r.dw > 0 && r.dh > 0, `${m} hole is a positive rect`);
    assert.ok(r.dx >= 0 && r.dx + r.dw <= 64.001, `${m} hole within the 2t width`);
    assert.ok(r.dy >= 0 && r.dy + r.dh <= 128.001, `${m} hole within the wall height`);
  }
});
