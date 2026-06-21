// roof-skirt.test.js — the N/E/W skirt-bridge classifier + the no-north-overhang clamp.
// SOUTH always bridges to the wall top (the visible roof->wall cliff); E/W bridge as the
// gable/rake ends; NORTH never bridges (it would poke into the neighbour to the north).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGableRakeEdge } from '../../tools/roof/roof-renderer.js';
import { buildRoofGrid } from '../../tools/roof/roof-geometry.js';

const P = { pitch: 1.2, ridgeOrientation: 'ew', clampHeight: 0.5, parapetRise: 0.5,
  knee: 2.5, capHeight: 4, sharpness: 1.4, stepWidth: 2, stepRise: 0.7, toothWidth: 4, fascia: 0.5 };

test('gable roof: S and E/W ends are rake edges (bridge), N is clamped', () => {
  const g = buildRoofGrid([{ x0: 0, y0: 0, w: 13, h: 7 }],
    { style: 'gable', overhang: 1, overhangDroop: 0.18, noNorthOverhang: true, params: P });
  // pick an eave tile on the E side (no footprint to the east)
  const eTile = g.tiles.find(t => t.role === 'eave' && !t.isOverhang &&
    !(g.fp[t.j * g.W + (t.i + 1)]));
  assert.ok(eTile, 'found an east-perimeter eave tile');
  assert.equal(isGableRakeEdge(g, eTile, 's', true), true, 'south always bridges');
  assert.equal(isGableRakeEdge(g, eTile, 'e', true), true, 'east end bridges as a rake');
  assert.equal(isGableRakeEdge(g, eTile, 'w', true), true, 'west end bridges as a rake');
  assert.equal(isGableRakeEdge(g, eTile, 'n', true), false, 'north never bridges');
});

test('isGableRakeEdge only bridges in the game view', () => {
  const g = buildRoofGrid([{ x0: 0, y0: 0, w: 9, h: 6 }],
    { style: 'hip', overhang: 1, overhangDroop: 0.18, noNorthOverhang: true, params: P });
  const t = g.tiles[0];
  assert.equal(isGableRakeEdge(g, t, 's', false), false, 'no bridge in oblique gallery');
  assert.equal(isGableRakeEdge(g, t, 'e', false), false, 'no bridge in oblique gallery');
});

test('noNorthOverhang: no overhang tile sits NORTH of the footprint', () => {
  const g = buildRoofGrid([{ x0: 0, y0: 0, w: 9, h: 6 }],
    { style: 'hip', overhang: 1, overhangDroop: 0.18, noNorthOverhang: true, params: P });
  for (const t of g.tiles) {
    if (!t.isOverhang) continue;
    // an overhang tile whose nearest footprint neighbour is to the SOUTH would sit north
    // of the building; assert none exist on the north ring.
    const southFp = g.fp[(t.j + 1) * g.W + t.i];
    assert.ok(!(southFp && !g.fp[t.j * g.W + t.i] && t.j < g.ovh + 1),
      `overhang tile at (${t.i},${t.j}) must not be a NORTH ring tile`);
  }
});

test('noSouthOverhang: no overhang tile sits SOUTH of the footprint (wall stays visible)', () => {
  // ROOF-REVEAL: suppressing the south overhang lets the south eave terminate at the
  // footprint edge (= the wall top) so the full south wall shows below the roof.
  const g = buildRoofGrid([{ x0: 0, y0: 0, w: 9, h: 6 }],
    { style: 'hip', overhang: 1, overhangDroop: 0.18, noNorthOverhang: true, noSouthOverhang: true, params: P });
  for (const t of g.tiles) {
    if (!t.isOverhang) continue;
    // an overhang tile whose nearest footprint neighbour is to the NORTH would sit SOUTH
    // of the building (draping over the visible south wall); assert none exist.
    const northFp = g.fp[(t.j - 1) * g.W + t.i];
    assert.ok(!(northFp && !g.fp[t.j * g.W + t.i] && t.j > g.ovh + 0),
      `overhang tile at (${t.i},${t.j}) must not be a SOUTH ring tile`);
  }
  // E/W overhang must still exist (the flared lip is kept on the sides).
  const ewOverhang = g.tiles.filter(t => t.isOverhang &&
    (g.fp[t.j * g.W + t.i - 1] || g.fp[t.j * g.W + t.i + 1]));
  assert.ok(ewOverhang.length >= 2, 'E/W overhang lip is preserved');
});
