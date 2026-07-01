import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVineSplines, VINE_RULES } from '../src/render/dressing/vine-index.js';

// A 10×3 building: south door at local (4,2), windows at (1,2) and (8,2). One storey.
function building(x = 100, y = 50) {
  return {
    x, y, biome: 'grassland',
    footprint: {
      sections: [{ x0: 0, y0: 0, w: 10, h: 3 }],
      boundingBox: { w: 10, h: 3 },
      doors: [{ x: 4, y: 2 }],
      windows: [{ x: 1, y: 2 }, { x: 8, y: 2 }],
    },
  };
}
const FORCE = { rules: { rootChance: 1, buildingChance: 1 } }; // bypass both gates for deterministic structure tests

// The aperture columns this building blocks (must match VINE_RULES half-widths).
function blockedBands() {
  return [
    [1.5 - VINE_RULES.winHalf, 1.5 + VINE_RULES.winHalf],
    [4.5 - VINE_RULES.doorHalf, 4.5 + VINE_RULES.doorHalf],
    [8.5 - VINE_RULES.winHalf, 8.5 + VINE_RULES.winHalf],
  ];
}
const allPts = (sp) => sp.branches.flatMap((br) => br.pts);

test('vines root in bare strips and climb from the wall base toward the eave', () => {
  const splines = buildVineSplines(building(), FORCE);
  assert.ok(splines.length >= 1, 'at least one vine on a wall with bare strips');
  assert.ok(splines.length <= VINE_RULES.maxRoots, 'never more than maxRoots vines per run');
  for (const sp of splines) {
    assert.ok(sp.branches.length >= 1, 'a vine has at least the main stem');
    const main = sp.branches[0];
    assert.equal(main.pts[0].v, 0, 'main stem roots at the wall base (v=0)');
    assert.ok(main.pts[main.pts.length - 1].v > 0.5, 'climbs upward');
    for (const br of sp.branches) {
      for (const pt of br.pts) assert.ok(pt.v <= 3 + 1e-9, 'every point stays at/below the eave (stories)');
      for (let i = 1; i < br.pts.length; i++) assert.ok(br.pts[i].v >= br.pts[i - 1].v - 1e-9, 'each branch climbs monotonically');
    }
  }
});

test('no vine point (any branch) ever crosses a door or window column', () => {
  const splines = buildVineSplines(building(), FORCE);
  const bands = blockedBands();
  for (const sp of splines) {
    for (const pt of allPts(sp)) {
      for (const [a, c] of bands) {
        assert.ok(pt.cxLocal <= a + 1e-9 || pt.cxLocal >= c - 1e-9,
          `vine point x=${pt.cxLocal.toFixed(2)} must stay out of aperture band [${a},${c}]`);
      }
    }
  }
});

test('complexity drives branching: simple vines are a single stem, lush ones fork', () => {
  // scan many building positions; collect branch counts across the complexity range
  const counts = [];
  for (let i = 0; i < 60; i++) {
    for (const sp of buildVineSplines(building(i * 3, 7), FORCE)) counts.push(sp.branches.length);
  }
  assert.ok(counts.some((n) => n === 1), 'some vines are a SIMPLE single stem');
  assert.ok(counts.some((n) => n >= 3), 'some vines are LUSH (multiple forked branches)');
});

test('per-building gate is selective: only a minority of buildings carry vines at the live default', () => {
  let withVines = 0, total = 0;
  for (let gx = 0; gx < 40; gx++) for (let gy = 0; gy < 5; gy++) {
    total++;
    if (buildVineSplines(building(gx * 5, gy * 5)).length > 0) withVines++;
  }
  const frac = withVines / total;
  assert.ok(frac > 0 && frac < 0.35, `live default vines on a selective minority of buildings (got ${(frac * 100).toFixed(0)}%)`);
});

test('determinism + honest absence: same building → identical placement; no footprint → none', () => {
  assert.deepEqual(buildVineSplines({ x: 0, y: 0 }), []);
  const a = buildVineSplines(building(), FORCE);
  const b = buildVineSplines(building(), FORCE);
  assert.deepEqual(a.map((s) => s.rootX), b.map((s) => s.rootX));
});
