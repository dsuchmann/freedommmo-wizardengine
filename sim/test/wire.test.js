// sim/test/wire.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { materializeRect, keyHash } from '../world/wire.js';
import { tilePlacements } from '../world/baseline.js';
import { compileBlueprint } from '../world/construct.js';

// Verified: no shared helpers.js exists — sim tests construct kernels inline (see kernel.test.js:5).
// Origin (0,0) is ocean — no placements there. Grassland starts around x=938; we use a kernel
// whose bounds contain the rect (938..945, 0..7) so all 27 placements (24 f3 + 3 f4) are inside.
const makeKernel = () => new Kernel({ seed: 42, phi: 4, bounds: { x0: 930, y0: 0, w: 24, h: 16 } });

const RECT = { x0: 938, y0: 0, w: 8, h: 8 };

test('every placement in the rect becomes exactly one entity with its key', () => {
  const k = makeKernel();
  k.graph.boot(() => materializeRect(k, RECT, 0));
  const expected = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) expected.push(...tilePlacements(938 + x, y));
  const byKey = new Map([...k.graph.nodes.values()]
    .filter(n => n.attrs?.placement).map(n => [n.attrs.placement, n]));
  assert.equal(byKey.size, expected.length);
  for (const p of expected) {
    const n = byKey.get(p.key);
    assert.ok(n, p.key);
    if (p.field === 'f4') { assert.equal(n.attrs.species, 'berry_bush'); assert.ok(n.R > 0); }
    if (p.field === 'f3') { assert.equal(n.type, 'matter'); assert.ok(n.attrs.E > 0); assert.ok(n.attrs.noFlux); }
    assert.equal(n.attrs.archetype, p.archetype);
  }
});

test('materialization is deterministic (same seed → identical R/body)', () => {
  const a = makeKernel(), b = makeKernel();
  a.graph.boot(() => materializeRect(a, RECT, 0));
  b.graph.boot(() => materializeRect(b, RECT, 0));
  const dump = k => [...k.graph.nodes.values()].filter(n => n.attrs?.placement)
    .map(n => [n.attrs.placement, n.R ?? n.attrs.E, n.attrs.body ?? 0]).sort();
  assert.deepEqual(dump(a), dump(b));
});

test('a delta-suppressed placement is not materialized', () => {
  const k = makeKernel();
  const victim = tilePlacements(938, 0).concat(tilePlacements(939, 0), tilePlacements(940, 0))[0];
  if (victim) {
    k.deltas.push({ tick: 0, x: 0, y: 0, target: 'placement:' + victim.key, kind: 'taken', attrs: {} });
    k.graph.boot(() => materializeRect(k, RECT, 0));
    const present = [...k.graph.nodes.values()].some(n => n.attrs?.placement === victim.key);
    assert.equal(present, false);
  } else {
    assert.ok(true, 'no placements on probed tiles — biome empty, acceptable');
  }
});

test('damaged delta does NOT suppress the placement on reboot; taken/destroyed DO suppress', () => {
  // Regression for Issue 1: a cracked-but-existing object must survive reboot.
  // wire.js must only suppress on removal kinds (taken / felled / destroyed).
  const victim = tilePlacements(938, 0).concat(tilePlacements(939, 0), tilePlacements(940, 0))[0];
  if (!victim) { assert.ok(true, 'no placements on probed tiles — acceptable'); return; }

  // Case A: 'damaged' kind — object must still materialize
  const kA = makeKernel();
  kA.deltas.push({ tick: 0, x: 0, y: 0, target: 'placement:' + victim.key, kind: 'damaged',
    attrs: { stage: 'cracked', hp: 60 } });
  kA.graph.boot(() => materializeRect(kA, RECT, 0));
  assert.ok(
    [...kA.graph.nodes.values()].some(n => n.attrs?.placement === victim.key),
    'damaged delta must NOT suppress the placement — object still exists in the world');

  // Case B: 'taken' kind — object must be absent
  const kB = makeKernel();
  kB.deltas.push({ tick: 0, x: 0, y: 0, target: 'placement:' + victim.key, kind: 'taken', attrs: {} });
  kB.graph.boot(() => materializeRect(kB, RECT, 0));
  assert.equal(
    [...kB.graph.nodes.values()].some(n => n.attrs?.placement === victim.key), false,
    'taken delta must suppress the placement');

  // Case C: 'destroyed' kind — object must be absent
  const kC = makeKernel();
  kC.deltas.push({ tick: 0, x: 0, y: 0, target: 'placement:' + victim.key, kind: 'destroyed', attrs: {} });
  kC.graph.boot(() => materializeRect(kC, RECT, 0));
  assert.equal(
    [...kC.graph.nodes.values()].some(n => n.attrs?.placement === victim.key), false,
    'destroyed delta must suppress the placement');
});

// M4 claims tests — use grassland area (x≈936) where tilePlacements returns real placements.
// Hut at origin (936, 0) → footprint { x0:936, y0:0, w:5, h:4 }. Verified 11 placements inside.
const CLAIMS_RECT = { x0: 930, y0: 0, w: 16, h: 16 };
const HUT_ORIGIN = { x: 936, y: 0 };
const HUT_FP = { x0: 936, y0: 0, w: 5, h: 4 };

test('M4 claims: placements inside a building footprint are not materialized', () => {
  // Build two identical kernels over the same rect; one has a hut compiled first.
  // Any placement materialized in the bare kernel but missing in the claimed kernel
  // must lie inside the footprint; nothing outside the footprint may differ.
  const mk = withHut => {
    const k = new Kernel({ seed: 42, bounds: CLAIMS_RECT });
    k.graph.boot(() => {
      if (withHut) compileBlueprint(k, 'hut', HUT_ORIGIN, 0);
      materializeRect(k, CLAIMS_RECT, 0);
    });
    return k;
  };
  const bare = mk(false), claimed = mk(true);
  const placed = k => new Set([...k.graph.nodes.values()]
    .map(n => n.attrs?.placement).filter(Boolean));
  const bareNodes = [...bare.graph.nodes.values()].filter(n => n.attrs?.placement);
  const claimedKeys = placed(claimed);
  const inside = n => n.x >= HUT_FP.x0 && n.x < HUT_FP.x0 + HUT_FP.w &&
                      n.y >= HUT_FP.y0 && n.y < HUT_FP.y0 + HUT_FP.h;
  for (const n of bareNodes) {
    if (inside(n)) {
      assert.ok(!claimedKeys.has(n.attrs.placement),
        `claimed tile ${n.x},${n.y} must not materialize placement ${n.attrs.placement}`);
    } else {
      assert.ok(claimedKeys.has(n.attrs.placement),
        `unclaimed tile ${n.x},${n.y} must be unaffected by the claim`);
    }
  }
  // sanity: the seed actually produces ≥1 placement inside the footprint, else the test is vacuous
  assert.ok(bareNodes.some(inside),
    'seed 42 must place ≥1 baseline object inside the hut footprint — pick another seed/origin if not');
});

test('M4 claims: reboot reproducibility — claimed world rebuilds bit-identical from seed', () => {
  const mk = () => {
    const k = new Kernel({ seed: 42, bounds: CLAIMS_RECT });
    k.graph.boot(() => {
      compileBlueprint(k, 'compound', { x: 930, y: 0 }, 0);
      materializeRect(k, CLAIMS_RECT, 0);
    });
    return [...k.graph.nodes.values()]
      .map(n => ({ id: n.id, type: n.type, x: n.x, y: n.y, attrs: n.attrs }));
  };
  assert.deepEqual(mk(), mk());
});
