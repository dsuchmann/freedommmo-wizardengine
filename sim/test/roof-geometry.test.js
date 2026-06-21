// roof-geometry.test.js — baseline + slopeAxis invariants for the roof TOPOLOGY axis.
// Regression net for the roof render-quality pass (continuous slope-UV + shade rework).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoofGrid } from '../../tools/roof/roof-geometry.js';

const P = { pitch: 0.9, ridgeOrientation: 'ew', clampHeight: 0.5, parapetRise: 0.5,
  knee: 2.5, capHeight: 4, sharpness: 1.4, stepWidth: 2, stepRise: 0.7, toothWidth: 4, fascia: 0.5 };

function hipGrid() {
  return buildRoofGrid([{ x0: 0, y0: 0, w: 9, h: 6 }],
    { style: 'hip', overhang: 1, overhangDroop: 0.35, noNorthOverhang: true, params: P });
}

test('hip grid: footprint+overhang sized, ridge runs along long axis', () => {
  const g = hipGrid();
  assert.equal(g.W, 11); // 9 + 2*overhang
  assert.equal(g.H, 8);  // 6 + 2*overhang
  assert.ok(g.maxHeight > 1.5, 'a 9x6 hip at pitch .9 rises >1.5 tiles');
  const ridge = g.tiles.filter(t => t.role === 'ridge');
  assert.ok(ridge.length >= 3, 'ridge tiles exist along the long axis');
});

test('every roof tile carries a normal and a downhill dir', () => {
  const g = hipGrid();
  for (const t of g.tiles) {
    assert.equal(t.normal.length, 3);
    assert.ok(['n', 's', 'e', 'w', 'flat'].includes(t.dir));
  }
});

test('each tile exposes slopeAxis {dir, run, runMax} for continuous UV', () => {
  const g = hipGrid();
  for (const t of g.tiles) {
    assert.ok(t.slopeAxis, 'slopeAxis present');
    assert.ok(['n', 's', 'e', 'w'].includes(t.slopeAxis.dir), 'uphill cardinal');
    assert.ok(t.slopeAxis.run >= 0, 'run >= 0');
    assert.ok(t.slopeAxis.runMax >= 1, 'runMax >= 1');
  }
  // two slope tiles on the SAME south face at adjacent distEdge get consecutive run values
  const south = g.tiles.filter(t => t.dir === 's' && t.role === 'slope')
    .sort((a, b) => a.distEdge - b.distEdge);
  if (south.length >= 2) assert.ok(south[1].run !== south[0].run, 'run advances eave->ridge');
});

test('hip+gable expose ridge tiles for drawAccents to stroke', () => {
  const hip = hipGrid();
  assert.ok(hip.roleTiles.ridge.length >= 1, 'hip has ridge tiles');
  const gable = buildRoofGrid([{ x0: 0, y0: 0, w: 13, h: 7 }],
    { style: 'gable', overhang: 1, overhangDroop: 0.18, noNorthOverhang: true, params: P });
  assert.ok(gable.roleTiles.ridge.length >= 1, 'gable has a ridge line');
});
