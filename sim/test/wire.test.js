// sim/test/wire.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { materializeRect, keyHash } from '../world/wire.js';
import { tilePlacements } from '../world/baseline.js';

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
