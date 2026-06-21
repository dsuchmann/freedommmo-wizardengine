// roof-accents.test.js — structural-edge accents. Problem A from live feedback: the roof
// must read as INTENTIONAL structure (ridge + hips + valleys), not graph paper. The old
// accent pass stroked a full quad outline for every ridge/peak tile, and a broken role
// classifier flagged the whole interior as ridge -> a dense white grid. structuralEdges
// emits ONLY the shared grid edges where adjacent facets face different ways (the true
// creases), so the count is SPARSE relative to the tile count and reads as real structure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { structuralEdges, parseRgb, darkenRgb } from '../../tools/roof/roof-renderer.js';
import { buildRoofGrid } from '../../tools/roof/roof-geometry.js';
import { makeMaterial, hslToRgb } from '../../tools/roof/roof-materials.js';

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

// ── Round-3 (A): accent colour is a DARK SHADE of the roof's own colour ──────────
// The live feedback was that ridge/hip/valley accents rendered as BRIGHT cream stripes
// (painted-on lines). They must instead be a DARKER shade of the roof material's own
// colour (a shadowed fold). These tests pin the colour-derivation primitives.

test('parseRgb reads rgb(...) and #hex into {r,g,b}', () => {
  assert.deepEqual(parseRgb('rgb(180, 90, 40)'), { r: 180, g: 90, b: 40 });
  assert.deepEqual(parseRgb('#b45a28'), { r: 0xb4, g: 0x5a, b: 0x28 });
  assert.equal(parseRgb(null), null);
  assert.equal(parseRgb('not a colour'), null);
});

test('darkenRgb moves the colour TOWARD black (a shadow), never brighter/cream', () => {
  const base = { r: 180, g: 110, b: 60 }; // a clay-ish roof colour
  const crease = darkenRgb(base, 0.62);
  // every channel is darker than the base (a fold), and not cream (not all near 255)
  assert.ok(crease.r < base.r && crease.g < base.g && crease.b < base.b, 'all channels darker');
  assert.ok(crease.r < 255 && crease.g < 255 && crease.b < 255, 'never cream/white');
  // the valley is darker than the crease (a deeper fold)
  const valley = darkenRgb(base, 0.62 * 0.72);
  assert.ok(valley.r < crease.r, 'valley darker than crease');
});

test('material.baseColor() is the material own hue, NOT cream — and darkening keeps the hue', () => {
  const clay = makeMaterial('clay');          // warm terracotta base
  const c = clay.baseColor();
  // a terracotta roof is warm: red dominates over blue (it is NOT a neutral cream/white)
  assert.ok(c.r > c.b, 'clay base is warm (r>b), not cream');
  const fold = darkenRgb(c, 0.62);
  // the darkened accent keeps the warm hue ordering (still a clay-coloured shadow)
  assert.ok(fold.r >= fold.b, 'darkened accent keeps the roof hue');
  assert.ok(fold.r < c.r, 'accent is darker than the tile colour');
});

test('hslToRgb round-trips a few known anchors', () => {
  assert.deepEqual(hslToRgb(0, 0, 0), { r: 0, g: 0, b: 0 });       // black
  assert.deepEqual(hslToRgb(0, 0, 100), { r: 255, g: 255, b: 255 }); // white
  const red = hslToRgb(0, 100, 50);
  assert.ok(red.r > 250 && red.g < 5 && red.b < 5, 'pure red');
});

// ── Round-3 (B): per-facet courses track each facet's contour (cardinal flow) ────
// On a hip the four cardinal facets each flow down their OWN slope; within a facet the
// eave->ridge `run` must increase monotonically (courses flow unbroken up the slope, not
// restart mid-facet). The stepped diagonal boundary between facets is the only quantized
// staircase — and it's softened to a dark low-contrast fold by the (A) accent change.

test('hip: a slope facet run is MONOTONIC along the slope (courses flow unbroken, no restart)', () => {
  const g = hip();
  // The eave->ridge `run` (texture v-axis) must vary monotonically along a facet column so
  // the courses flow UNBROKEN up the slope (no per-tile restart that would read as broken
  // contour). Walk each south-facing column (constant i) sorted by j and assert run is
  // monotonic (strictly increasing OR strictly decreasing — never a zigzag). Which end is
  // the eave depends on the hip half; monotonicity is the contour-tracking invariant.
  const cols = new Map();
  for (const t of g.tiles) {
    if (t.dir !== 's' || t.isOverhang || t.role === 'eave') continue;
    if (!cols.has(t.i)) cols.set(t.i, []);
    cols.get(t.i).push(t);
  }
  let checked = 0;
  for (const arr of cols.values()) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => a.j - b.j);
    const runs = arr.map(t => t.slopeAxis.run);
    const inc = runs.every((v, k) => k === 0 || v >= runs[k - 1] - 1e-9);
    const dec = runs.every((v, k) => k === 0 || v <= runs[k - 1] + 1e-9);
    assert.ok(inc || dec, `south column run is monotonic along the slope: ${runs.join(',')}`);
    checked++;
  }
  assert.ok(checked > 0, 'walked at least one south-facet column');
});

test('hip: NO facet has a mis-oriented run — every non-eave tile has a cardinal dir', () => {
  const g = hip();
  for (const t of g.tiles) {
    if (t.isOverhang || t.role === 'eave') continue;
    // a sloped tile must flow in a real cardinal (or be a flat ridge/deck top) — never null
    assert.ok(['n', 's', 'e', 'w', 'flat'].includes(t.dir), `tile (${t.i},${t.j}) has dir ${t.dir}`);
    // the slopeAxis.dir (uphill) is the opposite cardinal of the downhill dir (or n for flat)
    if (t.dir !== 'flat') {
      const opp = { n: 's', s: 'n', e: 'w', w: 'e' }[t.dir];
      assert.equal(t.slopeAxis.dir, opp, `uphill is opposite of downhill for (${t.i},${t.j})`);
    }
  }
});
