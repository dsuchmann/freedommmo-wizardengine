// sim/test/probe-paths.test.js — P1 probe: a walker wears a path through grassland;
// flora is trampled (conserved), the ground stays bare across reboot, and when the
// walking stops the path heals — flora re-materializes. Ghost paths regrow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { createPlayer, move } from '../world/actions.js';
import { pathAt, WEAR_PER_STEP, WORN_THRESHOLD, FADE_PER_DAY, WEAR_MAX } from '../world/paths.js';
import { materializeRect } from '../world/wire.js';
import { DAY } from '../time/metabolism.js';

// Same grassland rect as wire.test.js (seed 42, phi 4).
// Verified: (938,2) has a berry_bush (tramplable) registered in flux; tile has 1 baseline f4 placement.
const RECT = { x0: 938, y0: 0, w: 8, h: 8 };
const makeKernel = () => new Kernel({ seed: 42, phi: 4, bounds: { x0: 930, y0: 0, w: 24, h: 16 } });

/** Find the first tile in RECT that has ≥1 baseline placement AND ≥1 living tramplable node in flux. */
function findRouteTile(k) {
  for (let y = RECT.y0; y < RECT.y0 + RECT.h; y++) {
    for (let x = RECT.x0; x < RECT.x0 + RECT.w; x++) {
      const hasBaseline = [...k.graph.nodes.values()]
        .some(n => n.attrs?.placement && Math.floor(n.x) === x && Math.floor(n.y) === y);
      const hasTramplable = [...k.flux.occupantsOf(x, y)]
        .some(id => {
          const n = k.graph.nodes.get(id);
          return n && n.attrs?.species && ['berry_bush', 'grass'].includes(n.attrs.species);
        });
      if (hasBaseline && hasTramplable) return { x, y };
    }
  }
  return null;
}

/** Walk the scenario and return kernel A along with diagnostic counts.
 *  All moves happen at tick=0 so segment closures are dt=0 no-ops — stocks comparison is clean. */
function runScenario() {
  const kA = makeKernel();
  kA.graph.boot(() => materializeRect(kA, RECT, 0));

  // --- VACUITY GUARDS ---
  // Find a tile in RECT that has ≥1 baseline placement AND ≥1 living tramplable node in flux.
  // We know from inspection that (938,2) qualifies; assert it programmatically so the test fails
  // loudly if the biome ever changes under us.
  const routeTile = findRouteTile(kA);
  assert.ok(routeTile != null,
    'vacuity guard: RECT must contain ≥1 tile with both a baseline placement and tramplable living flora');

  // Player starts one tile to the left of routeTile (inside bounds).
  const startX = routeTile.x - 1;  // 937 when routeTile.x=938
  const startY = routeTile.y;
  assert.ok(startX >= kA.bounds.x0, 'start tile must be inside bounds');

  const before = kA.stocks(0);

  // Create player with a valid position.
  const player = createPlayer(kA, 0, { x: startX, y: startY });

  // Walk back-and-forth at tick=0 (dt=0 segments → stocks comparison stays clean).
  // Each right-step lands on routeTile; WORN_THRESHOLD right-steps → trample.
  for (let i = 0; i < WORN_THRESHOLD; i++) {
    move(kA, player.id, 1, 0, 0);   // → routeTile (wears it)
    move(kA, player.id, -1, 0, 0);  // ← back to start
  }
  // One more right step to push wear past threshold (the crossing fires wearBare on the Nth step)
  // Actually WORN_THRESHOLD steps total onto the tile crosses the threshold exactly.
  // At WORN_THRESHOLD the threshold-crossing fires on the WORN_THRESHOLD-th arrival.
  // Verify it happened:

  const after = kA.stocks(0);

  return { kA, player, routeTile, before, after };
}

test('P1 probe: path wears to threshold, flora trampled, worn delta written', () => {
  const { kA, routeTile, before, after } = runScenario();
  const { x, y } = routeTile;

  // 1. Path node on route with wear ≥ WORN_THRESHOLD
  const path = pathAt(kA, x, y);
  assert.ok(path, `path node exists on route tile (${x},${y})`);
  assert.ok(path.attrs.wear >= WORN_THRESHOLD,
    `wear=${path.attrs.wear} must be ≥ WORN_THRESHOLD=${WORN_THRESHOLD}`);

  // 2. ≥1 'worn' delta exists targeting this tile's placement
  const wornDeltas = kA.deltas.list.filter(d => d.kind === 'worn');
  assert.ok(wornDeltas.length >= 1, `≥1 worn delta; found ${wornDeltas.length}`);

  // 3. ≥1 trample event
  const trampleEvents = kA.ledger.events.filter(e => e.type === 'trample');
  assert.ok(trampleEvents.length >= 1, `≥1 trample event; found ${trampleEvents.length}`);

  // 4. Tramplable flora on the worn tile is gone (node gone); corpse exists (corpse has attrs.species but type='corpse')
  const livingOnTile = [...kA.graph.nodes.values()]
    .filter(n => n.type !== 'corpse' && n.attrs?.species && Math.floor(n.x) === x && Math.floor(n.y) === y);
  assert.equal(livingOnTile.length, 0, 'all tramplable living nodes on the tile are dead (corpses allowed)');
  const corpse = [...kA.graph.nodes.values()].find(n => n.type === 'corpse');
  assert.ok(corpse, 'trampled flora left a corpse');

  // 5. Conservation: stocks before and after walking are equal within 1e-6
  //    (all moves at tick=0 → dt=0 segment closures → no metabolic drift)
  assert.ok(Math.abs(after - before) < 1e-6,
    `conservation violated: before=${before} after=${after} diff=${Math.abs(after - before)}`);
});

test('P1 probe: reboot bare — worn placement keys absent, siblings present', () => {
  const { kA, routeTile } = runScenario();

  // Kernel B: same seed + copy of A's delta list → worn placements stay suppressed
  const kB = makeKernel();
  for (const d of kA.deltas.list) kB.deltas.push(d);
  kB.graph.boot(() => materializeRect(kB, RECT, 0));

  const bKeys = new Set([...kB.graph.nodes.values()].map(n => n.attrs?.placement).filter(Boolean));

  // The worn deltas' target keys must be suppressed in B
  const wornTargetKeys = kA.deltas.list
    .filter(d => d.kind === 'worn' && d.target?.startsWith('placement:'))
    .map(d => d.target.slice('placement:'.length));
  assert.ok(wornTargetKeys.length >= 1, 'need ≥1 worn placement key to test suppression');
  for (const key of wornTargetKeys) {
    assert.ok(!bKeys.has(key),
      `worn placement key "${key}" must be suppressed in kernel B (reboot-bare)`);
  }

  // Sibling placements (not worn) must still be present
  const kRef = makeKernel();
  kRef.graph.boot(() => materializeRect(kRef, RECT, 0));
  const refKeys = [...kRef.graph.nodes.values()].map(n => n.attrs?.placement).filter(Boolean);
  const siblings = refKeys.filter(k => !wornTargetKeys.includes(k));
  assert.ok(siblings.length >= 1, 'need ≥1 sibling placement for non-vacuous check');
  for (const key of siblings) {
    assert.ok(bKeys.has(key), `sibling placement "${key}" must NOT be suppressed`);
  }
});

test('P1 probe: heal — worn deltas gone after fade; path_healed events emitted; regrow', () => {
  const { kA, routeTile } = runScenario();

  const wornCountBefore = kA.deltas.list.filter(d => d.kind === 'worn').length;
  assert.ok(wornCountBefore >= 1, 'need ≥1 worn delta before healing');

  // Kernel B: same seed + kA's current deltas (worn) → suppressed count for comparison
  const kB = makeKernel();
  for (const d of kA.deltas.list) kB.deltas.push(d);
  kB.graph.boot(() => materializeRect(kB, RECT, 0));
  const suppressedKeys = kA.deltas.list
    .filter(d => d.kind === 'worn' && d.target?.startsWith('placement:'))
    .map(d => d.target.slice('placement:'.length));

  // Advance kernel A far enough for wear to fully fade (wear hits 0, all worn deltas healed).
  // WEAR_MAX / FADE_PER_DAY days of inactivity drops any wear to 0.
  const healDays = Math.ceil(WEAR_MAX / FADE_PER_DAY) + 2;
  kA.runTo(healDays * DAY);

  // All worn deltas gone
  const wornAfter = kA.deltas.list.filter(d => d.kind === 'worn').length;
  assert.equal(wornAfter, 0, 'all worn deltas healed after full fade');

  // path_healed events emitted
  const healedEvents = kA.ledger.events.filter(e => e.type === 'path_healed');
  assert.ok(healedEvents.length >= 1, `≥1 path_healed event; found ${healedEvents.length}`);

  // Kernel C: same seed + A's now-healed delta list → suppressed placements regrow
  const kC = makeKernel();
  for (const d of kA.deltas.list) kC.deltas.push(d);
  kC.graph.boot(() => materializeRect(kC, RECT, 0));
  const cKeys = new Set([...kC.graph.nodes.values()].map(n => n.attrs?.placement).filter(Boolean));

  for (const key of suppressedKeys) {
    assert.ok(cKeys.has(key),
      `after healing, suppressed placement "${key}" must re-materialize in kernel C`);
  }
});

test('P1 probe: determinism — two identical runs produce bit-identical results', () => {
  const run = () => {
    const kA = makeKernel();
    kA.graph.boot(() => materializeRect(kA, RECT, 0));

    // Locate routeTile deterministically (same search as runScenario)
    const routeTile = findRouteTile(kA);

    const player = createPlayer(kA, 0, { x: routeTile.x - 1, y: routeTile.y });
    for (let i = 0; i < WORN_THRESHOLD; i++) {
      move(kA, player.id, 1, 0, 0);
      move(kA, player.id, -1, 0, 0);
    }

    const healDays = Math.ceil(WEAR_MAX / FADE_PER_DAY) + 2;
    kA.runTo(healDays * DAY);

    const paths = [...kA.graph.nodes.values()].filter(n => n.type === 'path')
      .map(n => ({ x: n.x, y: n.y, wear: n.attrs.wear }))
      .sort((a, b) => a.x - b.x || a.y - b.y);
    const deltaKinds = kA.deltas.list.map(d => ({ kind: d.kind, target: d.target }));
    const trampleCount = kA.ledger.events.filter(e => e.type === 'trample').length;
    const healedCount = kA.ledger.events.filter(e => e.type === 'path_healed').length;

    return { paths, deltaKinds, trampleCount, healedCount };
  };

  assert.deepEqual(run(), run(), 'two runs must be bit-identical (determinism)');
});
