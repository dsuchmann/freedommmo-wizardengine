import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVineSplines, VINE_RULES } from '../src/render/dressing/vine-index.js';

// A 10×3 building: south door at local (4,2), windows at (1,2) and (8,2). One storey.
function building() {
  return {
    x: 100, y: 50, biome: 'grassland',
    footprint: {
      sections: [{ x0: 0, y0: 0, w: 10, h: 3 }],
      boundingBox: { w: 10, h: 3 },
      doors: [{ x: 4, y: 2 }],
      windows: [{ x: 1, y: 2 }, { x: 8, y: 2 }],
    },
  };
}

// The aperture columns this building blocks (must match VINE_RULES half-widths).
function blockedBands() {
  return [
    [1.5 - VINE_RULES.winHalf, 1.5 + VINE_RULES.winHalf],
    [4.5 - VINE_RULES.doorHalf, 4.5 + VINE_RULES.doorHalf],
    [8.5 - VINE_RULES.winHalf, 8.5 + VINE_RULES.winHalf],
  ];
}

test('vines root in bare strips and climb from the wall base toward the eave', () => {
  const splines = buildVineSplines(building(), { rules: { rootChance: 1 } }); // force every bare strip to root
  assert.ok(splines.length >= 1, 'at least one vine on a wall with bare strips');
  assert.ok(splines.length <= VINE_RULES.maxRoots, 'never more than maxRoots vines per run');
  for (const sp of splines) {
    assert.ok(sp.pts.length >= 2, 'a spline has a path');
    assert.equal(sp.pts[0].v, 0, 'roots at the wall base (v=0)');
    assert.ok(sp.pts[sp.pts.length - 1].v > 0.5, 'climbs upward');
    assert.ok(sp.pts[sp.pts.length - 1].v <= 3 + 1e-9, 'capped at/below the eave (stories)');
    // v is monotonically non-decreasing (always climbing, never dipping)
    for (let i = 1; i < sp.pts.length; i++) assert.ok(sp.pts[i].v >= sp.pts[i - 1].v - 1e-9, 'climbs monotonically');
  }
});

test('no vine point ever crosses a door or window column (aperture avoidance)', () => {
  const splines = buildVineSplines(building(), { rules: { rootChance: 1 } });
  const bands = blockedBands();
  for (const sp of splines) {
    for (const pt of sp.pts) {
      for (const [a, c] of bands) {
        assert.ok(pt.cxLocal <= a + 1e-9 || pt.cxLocal >= c - 1e-9,
          `vine point x=${pt.cxLocal.toFixed(2)} must stay out of aperture band [${a},${c}]`);
      }
    }
  }
});

test('rootChance gates density deterministically; a footprintless building yields none', () => {
  assert.deepEqual(buildVineSplines({ x: 0, y: 0 }), []);
  const none = buildVineSplines(building(), { rules: { rootChance: 0 } });
  assert.equal(none.length, 0, 'rootChance 0 → no vines');
  // determinism: same building + same rules → identical placement
  const a = buildVineSplines(building(), { rules: { rootChance: 0.5 } });
  const b = buildVineSplines(building(), { rules: { rootChance: 0.5 } });
  assert.deepEqual(a.map((s) => s.rootX), b.map((s) => s.rootX));
});
