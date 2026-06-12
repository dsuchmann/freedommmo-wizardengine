// sim/test/roads.test.js — P2: build (conserved), suppress, decay→gone→heal, maintain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { createPlayer, move } from '../world/actions.js';
import { createGroup, contribute } from '../society/groups.js';
import { buildRoad, maintainRoad, roadAt, ROAD_E_PER_TILE, ROAD_CONDITION_MAX, ROAD_DECAY_PER_DAY, MAINTAIN_COST } from '../world/roads.js';
import { pathAt } from '../world/paths.js';
import { CHANNEL_EFF, DAY } from '../time/metabolism.js';

const BOUNDS = { x0: 938, y0: 6, w: 16, h: 8 };   // pure grassland

function fundedWorld() {
  const k = new Kernel({ seed: 7, bounds: BOUNDS });
  const g = createGroup(k, 0, { x: 940, y: 8 });
  const p = createPlayer(k, 0, { x: 940, y: 8 });
  p.R = 1000;          // arrangement (not conserved); conservation asserted via deltas below
  contribute(k, p.id, g.id, 1000, 0);   // group gets 900
  return { k, g, p };
}

test('P2 buildRoad: segments along the route, E conserved through nurture channel, paved deltas', () => {
  const { k, g } = fundedWorld();
  const base = k.stocks(0);
  const lossBase = k.ledger.totals.transferLoss;
  const ok = buildRoad(k, g.id, { x: 940, y: 8 }, { x: 945, y: 8 }, 0);
  assert.equal(ok, true);
  const segs = [...k.graph.nodes.values()].filter(n => n.type === 'matter' && n.attrs.archetype === 'road_segment');
  assert.equal(segs.length, 6, 'one segment per route tile, endpoints included');
  for (const s of segs) {
    assert.ok(Math.abs(s.attrs.E - ROAD_E_PER_TILE * CHANNEL_EFF.nurture) < 1e-9, 'segment E = delivered');
    assert.equal(s.attrs.condition, ROAD_CONDITION_MAX);
    assert.ok(s.createdByEvent != null, 'provenance from road_built event');
  }
  assert.ok(Math.abs(g.R - (900 - 6 * ROAD_E_PER_TILE)) < 1e-9, 'group debited the full spend');
  // conservation: only channel losses left the world, all ledger-counted
  const after = k.stocks(0);
  const lossNew = k.ledger.totals.transferLoss - lossBase;
  assert.ok(Math.abs((base - after) - lossNew) < 1e-9, 'Δstocks = new transferLoss');
  assert.ok(k.ledger.events.some(e => e.type === 'road_built'), 'road_built event');
  const paved = k.deltas.list.filter(d => d.kind === 'paved');
  assert.ok(paved.every(d => d.target.startsWith('placement:')), 'paved deltas target placements');
});

test('P2 buildRoad refusals: underfunded, unreachable route, missing group — side-effect-free', () => {
  const k = new Kernel({ seed: 7, bounds: BOUNDS });
  const g = createGroup(k, 0, { x: 940, y: 8 });   // R = 0
  const evCount = k.ledger.events.length;
  assert.equal(buildRoad(k, g.id, { x: 940, y: 8 }, { x: 945, y: 8 }, 0), false, 'underfunded');
  assert.equal(buildRoad(k, 99999, { x: 940, y: 8 }, { x: 945, y: 8 }, 0), false, 'missing group');
  g.R = 1000;   // funded — refusal below must be due to unreachable route alone
  assert.equal(buildRoad(k, g.id, { x: 940, y: 8 }, { x: 0, y: 0 }, 0), false, 'unreachable (out of bounds/ocean) refused');
  assert.equal(g.R, 1000, 'unreachable refusal side-effect-free');
  g.R = 0;
  assert.equal(k.ledger.events.length, evCount, 'no events on refusal');
  assert.equal([...k.graph.nodes.values()].filter(n => n.attrs?.archetype === 'road_segment').length, 0);
});

test('P2 decay: unmaintained road decays to gone — E returns to ambient (decayed), deltas heal', () => {
  const { k, g } = fundedWorld();
  buildRoad(k, g.id, { x: 940, y: 8 }, { x: 942, y: 8 }, 0);
  const segE = ROAD_E_PER_TILE * CHANNEL_EFF.nurture;
  const nSegs = 3;
  const decayedBefore = k.ledger.totals.decayed;
  const lifeDays = Math.ceil(ROAD_CONDITION_MAX / ROAD_DECAY_PER_DAY) + 2;
  k.runTo(lifeDays * DAY);
  assert.equal(roadAt(k, 940, 8), undefined, 'road gone');
  assert.equal(roadAt(k, 942, 8), undefined);
  assert.ok((k.ledger.totals.decayed - decayedBefore) >= nSegs * segE - 1e-6,
    'all road E returned to ambient via decayed counter (other ambient decay may add more)');
  assert.equal(k.deltas.list.filter(d => d.kind === 'paved').length, 0, 'paved deltas healed');
  assert.ok(k.ledger.events.some(e => e.type === 'road_gone'), 'road_gone events');
});

test('P2 maintain: paying resets condition; group debited; refused when underfunded', () => {
  const { k, g } = fundedWorld();
  buildRoad(k, g.id, { x: 940, y: 8 }, { x: 941, y: 8 }, 0);
  k.runTo(10 * DAY);   // decay a bit
  const seg = roadAt(k, 940, 8);
  assert.ok(seg.attrs.condition < ROAD_CONDITION_MAX, 'decayed some');
  const rBefore = g.R;
  assert.equal(maintainRoad(k, g.id, seg.id, k.tick), true);
  assert.equal(seg.attrs.condition, ROAD_CONDITION_MAX, 'restored');
  assert.ok(Math.abs(g.R - (rBefore - MAINTAIN_COST)) < 1e-9, 'group paid');
  g.R = 0;
  assert.equal(maintainRoad(k, g.id, seg.id, k.tick), false, 'underfunded refused');
});

test('P2 roads carry traffic: moving onto a road tile wears NO path', () => {
  const { k, g } = fundedWorld();
  buildRoad(k, g.id, { x: 941, y: 8 }, { x: 943, y: 8 }, 0);
  const p2 = createPlayer(k, 0, { x: 940, y: 8 });
  move(k, p2.id, 1, 0, 0);              // onto road at (941,8)
  assert.equal(pathAt(k, 941, 8), undefined, 'no path node under a road');
  move(k, p2.id, -1, 0, 1);             // back onto bare grass (940,8)
  assert.ok(pathAt(k, 940, 8), 'bare tile still wears normally');
});

test('P2 determinism: build + decay scenario twice → bit-identical', () => {
  const run = () => {
    const { k, g } = fundedWorld();
    buildRoad(k, g.id, { x: 940, y: 8 }, { x: 944, y: 8 }, 0);
    k.runTo(20 * DAY);
    return {
      segs: [...k.graph.nodes.values()].filter(n => n.attrs?.archetype === 'road_segment')
        .map(n => ({ x: n.x, y: n.y, E: n.attrs.E, condition: n.attrs.condition }))
        .sort((a, b) => a.x - b.x || a.y - b.y),
      deltas: k.deltas.list.map(d => ({ target: d.target, kind: d.kind })),
      decayed: k.ledger.totals.decayed,
    };
  };
  assert.deepEqual(run(), run());
});
