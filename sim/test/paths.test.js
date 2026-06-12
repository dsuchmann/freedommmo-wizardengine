// sim/test/paths.test.js — P1: wear accumulation, trample (conserved), fade, heal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { createPlayer, move } from '../world/actions.js';
import { pathAt, WEAR_PER_STEP, WORN_THRESHOLD, FADE_PER_DAY } from '../world/paths.js';
import { DAY } from '../time/metabolism.js';

function makeKernel(seed = 7) {
  return new Kernel({ seed, bounds: { x0: 0, y0: 0, w: 16, h: 16 } });
}

test('P1 wear: each move step wears the destination tile; path node has provenance', () => {
  const k = makeKernel();
  const p = createPlayer(k, 0, { x: 4, y: 4 });
  move(k, p.id, 1, 0, 0);          // → (5,4)
  const path = pathAt(k, 5, 4);
  assert.ok(path, 'path node exists on destination tile');
  assert.equal(path.type, 'path');
  assert.equal(path.attrs.wear, WEAR_PER_STEP);
  assert.ok(path.createdByEvent != null, 'provenance from move event');
  move(k, p.id, -1, 0, 1);         // back to (4,4)
  move(k, p.id, 1, 0, 2);          // → (5,4) again
  assert.equal(pathAt(k, 5, 4).attrs.wear, 2 * WEAR_PER_STEP);
});

test('P1 trample: wear crossing threshold kills tramplable flora via die() — conserved', () => {
  const k = makeKernel();
  let bush, tree;
  k.graph.boot(() => {
    bush = k.addLiving({ species: 'berry_bush', x: 5, y: 4, R: 500, body: 800, tick: 0 });
    tree = k.addLiving({ species: 'tree', x: 5, y: 4, R: 20000, body: 30000, tick: 0, age: 400 * DAY });
  });
  const p = createPlayer(k, 0, { x: 4, y: 4 });
  // All moves at tick=0 so all closeSegment calls are dt=0 no-ops.
  // stocks(0) before and after will agree iff the trample itself is conservation-neutral.
  const before = k.stocks(0);
  for (let i = 0; i < WORN_THRESHOLD; i++) {   // pace until threshold — all at tick 0
    move(k, p.id, 1, 0, 0);
    move(k, p.id, -1, 0, 0);
  }
  assert.equal(k.graph.nodes.has(bush.id), false, 'bush trampled');
  assert.equal(k.graph.nodes.has(tree.id), true, 'tree survives');
  const corpse = [...k.graph.nodes.values()].find(n => n.type === 'corpse');
  assert.ok(corpse, 'trampled bush left a corpse');
  const trampleEv = k.ledger.events.findLast(e => e.type === 'trample');
  assert.ok(trampleEv, 'trample event emitted');
  const after = k.stocks(0);
  assert.ok(Math.abs(after - before) < 1e-6, `trample conserves: before=${before} after=${after}`);
});

test('P1 fade + heal: wear decays daily; suppression deltas heal when wear drops below threshold', () => {
  const k = makeKernel();
  const p = createPlayer(k, 0, { x: 4, y: 4 });
  let t = 0;
  for (let i = 0; i < WORN_THRESHOLD + 4; i++) {  // overshoot threshold a little
    move(k, p.id, 1, 0, t++); move(k, p.id, -1, 0, t++);
  }
  const path = pathAt(k, 5, 4);
  assert.ok(path.attrs.wear >= WORN_THRESHOLD, 'tile is worn');
  const wornBefore = k.deltas.list.filter(d => d.kind === 'worn').length;
  // (this rect may have no baseline placements at (5,4) — worn deltas may be 0 here; the
  //  delta-content assertions live in Task 3's wire test on real grassland. Here we
  //  assert the FADE mechanics.)
  const wearBefore = path.attrs.wear;
  k.runTo(3 * DAY);
  assert.ok(pathAt(k, 5, 4).attrs.wear <= Math.max(0, wearBefore - 2 * FADE_PER_DAY),
    'wear fades daily while untrafficked');
  k.runTo(60 * DAY);
  assert.equal(pathAt(k, 5, 4).attrs.wear, 0, 'wear fully fades');
  assert.equal(k.deltas.list.filter(d => d.kind === 'worn').length, 0,
    `all worn deltas healed (was ${wornBefore})`);
  const healed = k.ledger.events.filter(e => e.type === 'path_healed');
  assert.ok(wornBefore === 0 || healed.length >= 1, 'path_healed emitted when deltas existed');
});

test('P1 determinism: same seed + same walk → bit-identical path state and deltas', () => {
  const run = () => {
    const k = makeKernel(7);
    const p = createPlayer(k, 0, { x: 4, y: 4 });
    let t = 0;
    for (let i = 0; i < 25; i++) { move(k, p.id, 1, 0, t++); move(k, p.id, -1, 0, t++); }
    k.runTo(5 * DAY);
    return {
      paths: [...k.graph.nodes.values()].filter(n => n.type === 'path')
        .map(n => ({ x: n.x, y: n.y, wear: n.attrs.wear })).sort((a, b) => a.x - b.x || a.y - b.y),
      deltas: k.deltas.list.map(d => ({ target: d.target, kind: d.kind })),
    };
  };
  assert.deepEqual(run(), run());
});
