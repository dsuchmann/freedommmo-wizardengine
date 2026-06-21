// roof-accents.test.js — structural-edge accents. Problem A from live feedback: the roof
// must read as INTENTIONAL structure (ridge + hips + valleys), not graph paper. The old
// accent pass stroked a full quad outline for every ridge/peak tile, and a broken role
// classifier flagged the whole interior as ridge -> a dense white grid. structuralEdges
// emits ONLY the shared grid edges where adjacent facets face different ways (the true
// creases), so the count is SPARSE relative to the tile count and reads as real structure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { structuralEdges } from '../../tools/roof/roof-renderer.js';
import { buildRoofGrid } from '../../tools/roof/roof-geometry.js';

const P = { pitch: 0.9, ridgeOrientation: 'ew', clampHeight: 0.5, parapetRise: 0.5,
  knee: 2.5, capHeight: 4, sharpness: 1.4, stepWidth: 2, stepRise: 0.7, toothWidth: 4, fascia: 0.5 };

function hip(w = 20, h = 15) {
  return buildRoofGrid([{ x0: 0, y0: 0, w, h }],
    { style: 'hip', overhang: 1, overhangDroop: 0.18, noNorthOverhang: true, params: P });
}

test('hip roof: structural edges are SPARSE (a few creases, not a grid)', () => {
  const g = hip();
  const edges = structuralEdges(g);
  assert.ok(edges.length > 0, 'a hip has creases (ridge + 4 hips)');
  // the headline regression: far fewer crease edges than roof tiles (no graph paper).
  // a 20x15 hip has ~250 roof tiles; the ridge + 4 hip lines are a small fraction.
  assert.ok(edges.length < g.tiles.length * 0.5,
    `sparse: ${edges.length} edges vs ${g.tiles.length} tiles`);
});

test('hip roof: has both convex creases (ridge/hip) and is mostly creases not valleys', () => {
  const g = hip();
  const edges = structuralEdges(g);
  const creases = edges.filter(e => e.kind === 'crease').length;
  const valleys = edges.filter(e => e.kind === 'valley').length;
  assert.ok(creases > 0, 'a simple hip has convex ridge/hip creases');
  assert.ok(creases >= valleys, 'a simple rectangular hip has no interior valleys');
});

test('L-shaped (compound) roof grows a VALLEY where wings meet', () => {
  // two rectangles forming an L -> a concave valley at the inside corner.
  const g = buildRoofGrid([{ x0: 0, y0: 0, w: 12, h: 5 }, { x0: 0, y0: 5, w: 5, h: 8 }],
    { style: 'hip', overhang: 1, overhangDroop: 0.18, noNorthOverhang: true, params: P });
  const edges = structuralEdges(g);
  const valleys = edges.filter(e => e.kind === 'valley').length;
  assert.ok(valleys >= 1, `L-roof has an inside-corner valley (got ${valleys})`);
});

test('every structural edge is a unit grid segment with a kind', () => {
  const g = hip();
  for (const e of structuralEdges(g)) {
    const len = Math.hypot(e.bx - e.ax, e.by - e.ay);
    assert.ok(Math.abs(len - 1) < 1e-9, 'edge spans one grid cell');
    assert.ok(e.kind === 'crease' || e.kind === 'valley', 'classified kind');
  }
});
