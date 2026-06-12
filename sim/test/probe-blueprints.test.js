// sim/test/probe-blueprints.test.js — M4 probe: a compiled compound in a living world.
// Boot world with baseline flora + a compound (hut+forge); assert claims, serialization,
// conservation, and double-boot determinism end-to-end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { compileBlueprint } from '../world/construct.js';
import { materializeRect } from '../world/wire.js';
import { serializeEntity } from '../server/protocol.js';
import { DAY } from '../time/metabolism.js';

const RECT = { x0: 930, y0: 0, w: 24, h: 24 };   // grassland (near (0,0) is ocean)

function bootWorld(seed = 42) {
  const k = new Kernel({ seed, bounds: RECT });
  let buildings;
  k.graph.boot(() => {
    buildings = compileBlueprint(k, 'compound', { x: 936, y: 8 }, 0);
    materializeRect(k, RECT, 0);
  });
  return { k, buildings };
}

test('probe M4: buildings exist as stamped structures; no placement node inside any footprint', () => {
  const { k, buildings } = bootWorld();
  assert.equal(buildings.length, 2);
  const fps = buildings.map(b => b.attrs.footprint);
  const inAnyFp = n => fps.some(fp =>
    n.x >= fp.x0 && n.x < fp.x0 + fp.w && n.y >= fp.y0 && n.y < fp.y0 + fp.h);
  let bareInside = 0;   // vacuity guard: compare against a buildingless boot
  {
    const k2 = new Kernel({ seed: 42, bounds: RECT });
    k2.graph.boot(() => { materializeRect(k2, RECT, 0); });
    for (const n of k2.graph.nodes.values()) if (n.attrs?.placement && inAnyFp(n)) bareInside++;
  }
  assert.ok(bareInside >= 1, 'footprints must cover ≥1 baseline placement or the claim assertion is vacuous');
  for (const n of k.graph.nodes.values()) {
    if (n.attrs?.placement) assert.ok(!inAnyFp(n), `placement node at ${n.x},${n.y} violates a claim`);
  }
});

test('probe M4: serialized buildings carry full stamp lists; doors are walkable openings', () => {
  const { k, buildings } = bootWorld();
  for (const b of buildings) {
    const s = serializeEntity(k.graph.nodes.get(b.id), 0);
    assert.equal(s.type, 'building');
    assert.equal(s.stamps.length, s.footprint.w * s.footprint.h, 'every footprint tile stamped');
    assert.ok(s.stamps.some(t => t.piece === 'door' && t.walkable === true), 'door present');
    assert.equal(s.npcSlots, undefined);
  }
});

test('probe M4: conservation — run one day; the suite\'s standard conservation identity holds', () => {
  const { k } = bootWorld();
  const s0 = k.stocks(0);
  k.runTo(1 * DAY);
  const s1 = k.stocks(k.tick);
  const t = k.ledger.totals;
  const lhs = s1 - s0;
  const rhs = t.captured - t.burned - t.decayed - t.transferLoss;
  const scale = Math.max(Math.abs(t.captured), 1);
  assert.ok(Math.abs(lhs - rhs) / scale < 1e-9,
    `conservation violated: Δstocks=${lhs} flows=${rhs} (rel err ${(Math.abs(lhs - rhs) / scale)})`);
});

test('probe M4: double boot determinism — full serialized world is bit-identical', () => {
  const snap = () => {
    const { k } = bootWorld();
    return [...k.graph.nodes.values()].map(n => serializeEntity(n, 0));
  };
  assert.deepEqual(snap(), snap());
});
