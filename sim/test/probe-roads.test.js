// sim/test/probe-roads.test.js — P2 probe: two settlers pool their time into a group;
// the group grades a road across grassland along a deterministic least-cost route;
// flora under the road is suppressed and stays suppressed across reboot; traffic
// rides the road without wearing paths; left unmaintained the road decays — its
// embodied time returns to ambient, the suppression heals, and the grass regrows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { createPlayer, pick, move } from '../world/actions.js';
import { createGroup, contribute } from '../society/groups.js';
import { buildRoad, roadAt, ROAD_E_PER_TILE, ROAD_CONDITION_MAX, ROAD_DECAY_PER_DAY } from '../world/roads.js';
import { pathAt } from '../world/paths.js';
import { materializeRect } from '../world/wire.js';
import { tilePlacements } from '../world/baseline.js';
import { CHANNEL_EFF, DAY } from '../time/metabolism.js';

// Rect matches roads.test.js — pure grassland, no water.
const RECT = { x0: 938, y0: 6, w: 16, h: 8 };
const makeKernel = () => new Kernel({ seed: 42, phi: 4, bounds: { x0: 936, y0: 4, w: 24, h: 16 } });

// berry_bush pick: bite=300, harvest eff=0.50 → 150 tu per bite.
// 4 bites = 600 tu. Large R/body ensures no exhaustion within 4 bites.
const CONTRIBUTION_EACH = 600;

/** Find the first row y in RECT where ≥1 tile has ≥1 baseline placement.
 *  Returns { rowY, rowStart, rowEnd } (rowEnd − rowStart + 1 ≥ 5) or null. */
function findRoadRow(rect) {
  for (let y = rect.y0; y < rect.y0 + rect.h; y++) {
    let rowHasPlacement = false;
    for (let x = rect.x0; x < rect.x0 + rect.w; x++) {
      if (tilePlacements(x, y).length >= 1) { rowHasPlacement = true; break; }
    }
    if (rowHasPlacement) {
      const rowStart = rect.x0;
      const rowEnd = rect.x0 + rect.w - 1;   // full row width = 16 tiles
      return { rowY: y, rowStart, rowEnd };
    }
  }
  return null;
}

/** Pick from a bush until player.R ≥ targetTu (real pick verb, repeated bites). */
function pickUntil(k, playerId, bushId, targetTu) {
  const player = k.graph.nodes.get(playerId);
  while (player.R < targetTu) {
    const gained = pick(k, playerId, bushId, 0);
    if (gained <= 0) break;   // exhausted (should not happen with large R/body)
  }
}

/** Run the full road scenario; returns a summary object for determinism comparison.
 *  Advances kernel A only through step 4 + 20*DAY partial decay. */
function runScenario() {
  const k = makeKernel();

  // ── Step 1: boot — two large berry_bushes + materializeRect ──────────────
  let bush1, bush2, matCount;
  k.graph.boot(() => {
    // Two large berry_bushes placed at the road origin corner — real metabolic entities
    // with sufficient R+body to support ≥4 bites each without exhaustion.
    bush1 = k.addLiving({ species: 'berry_bush', x: 938, y: 6,
                          R: 20000, body: 30000, tick: 0, age: 400 * DAY });
    bush2 = k.addLiving({ species: 'berry_bush', x: 939, y: 6,
                          R: 20000, body: 30000, tick: 0, age: 400 * DAY });
    matCount = materializeRect(k, RECT, 0);
  });

  // Vacuity guard: ≥1 tile in RECT must have ≥1 baseline placement.
  const rowInfo = findRoadRow(RECT);
  assert.ok(rowInfo !== null,
    'vacuity guard: RECT must contain ≥1 tile with ≥1 baseline placement');
  // Vacuity guard: materializeRect must have created ≥1 entity.
  assert.ok(matCount >= 1,
    `vacuity guard: materializeRect must create ≥1 entity; got ${matCount}`);

  const { rowY, rowStart, rowEnd } = rowInfo;
  const roadTiles = rowEnd - rowStart + 1;
  assert.ok(roadTiles >= 5, `road must span ≥5 tiles; spans ${roadTiles}`);

  // ── Step 2: two players harvest + contribute ─────────────────────────────
  // All at tick 0: segment closures are dt=0 no-ops → stocks comparisons stay clean.
  const p1 = createPlayer(k, 0, { x: 938, y: 6 });
  const p2 = createPlayer(k, 0, { x: 939, y: 6 });
  const g = createGroup(k, 0, { x: rowStart, y: rowY });

  // Capture pre-harvest ledger baseline (tick-0 stocks snapshot).
  const stocksBefore = k.stocks(0);
  const tlBefore = k.ledger.totals.transferLoss;
  const capturedBefore = k.ledger.totals.captured;
  const burnedBefore = k.ledger.totals.burned;
  const decayedBefore0 = k.ledger.totals.decayed;

  // Real harvest (pick verb) — repeated until each player holds ≥ CONTRIBUTION_EACH tu.
  pickUntil(k, p1.id, bush1.id, CONTRIBUTION_EACH);
  pickUntil(k, p2.id, bush2.id, CONTRIBUTION_EACH);

  // Assert funding is genuine (non-vacuous).
  assert.ok(k.graph.nodes.get(p1.id).R >= CONTRIBUTION_EACH,
    `p1 must hold ≥${CONTRIBUTION_EACH} tu after harvest; holds ${k.graph.nodes.get(p1.id).R}`);
  assert.ok(k.graph.nodes.get(p2.id).R >= CONTRIBUTION_EACH,
    `p2 must hold ≥${CONTRIBUTION_EACH} tu after harvest; holds ${k.graph.nodes.get(p2.id).R}`);

  // Each contributes 600 through the gift channel (eff=0.90).
  assert.equal(contribute(k, p1.id, g.id, CONTRIBUTION_EACH, 0), true, 'p1 contribute succeeded');
  assert.equal(contribute(k, p2.id, g.id, CONTRIBUTION_EACH, 0), true, 'p2 contribute succeeded');

  // ── Step 3: conservation checkpoint after funding ─────────────────────────
  // Δstocks = -(new transferLoss) — only leaks are harvest (0.50) and gift (0.90) channels,
  // both fully counted in transferLoss. No captured/burned/decayed changes at tick 0
  // (all entities created at tick 0 with dt=0 segments).
  const stocksAfterFund = k.stocks(0);
  const tlAfterFund = k.ledger.totals.transferLoss;
  const capturedAfterFund = k.ledger.totals.captured;
  const burnedAfterFund = k.ledger.totals.burned;
  const decayedAfterFund = k.ledger.totals.decayed;

  // Full conservation identity (probe-conservation form):
  // Δstocks === (captured − burned − decayed − transferLoss) delta
  const deltaStocksFund = stocksAfterFund - stocksBefore;
  const deltaCapFund = capturedAfterFund - capturedBefore;
  const deltaBurnFund = burnedAfterFund - burnedBefore;
  const deltaDecFund = decayedAfterFund - decayedBefore0;
  const deltaTLFund = tlAfterFund - tlBefore;
  const rhsFund = deltaCapFund - deltaBurnFund - deltaDecFund - deltaTLFund;
  const scaleFund = Math.max(Math.abs(stocksBefore), 1);
  assert.ok(Math.abs(deltaStocksFund - rhsFund) / scaleFund < 1e-6,
    `conservation after funding: Δstocks=${deltaStocksFund} rhs=${rhsFund} diff=${Math.abs(deltaStocksFund - rhsFund)}`);

  // ── Step 4: buildRoad ─────────────────────────────────────────────────────
  const groupRBefore = g.R;
  const tlBeforeRoad = k.ledger.totals.transferLoss;
  const capturedBeforeRoad = k.ledger.totals.captured;
  const burnedBeforeRoad = k.ledger.totals.burned;
  const decayedBeforeRoad = k.ledger.totals.decayed;
  const stocksBeforeRoad = k.stocks(0);

  const ok = buildRoad(k, g.id, { x: rowStart, y: rowY }, { x: rowEnd, y: rowY }, 0);
  assert.equal(ok, true, 'buildRoad must succeed with a funded group over a land route');

  const segs = [...k.graph.nodes.values()]
    .filter(n => n.type === 'matter' && n.attrs.archetype === 'road_segment');
  const builtCount = segs.length;
  assert.ok(builtCount >= 5, `≥5 road segments built; got ${builtCount}`);

  // Every route tile has a road segment.
  for (let x = rowStart; x <= rowEnd; x++) {
    assert.ok(roadAt(k, x, rowY) !== undefined,
      `road segment must exist at (${x},${rowY})`);
  }

  // Group debited exactly builtCount × ROAD_E_PER_TILE.
  const expectedGroupDebit = builtCount * ROAD_E_PER_TILE;
  assert.ok(Math.abs(groupRBefore - g.R - expectedGroupDebit) < 1e-9,
    `group debited ${groupRBefore - g.R}; expected ${expectedGroupDebit}`);

  // ≥1 paved delta exists.
  const pavedDeltas = k.deltas.list.filter(d => d.kind === 'paved');
  assert.ok(pavedDeltas.length >= 1, `≥1 paved delta; got ${pavedDeltas.length}`);

  // road_built event exists with targets.length === segment count.
  const roadBuiltEv = k.ledger.events.find(e => e.type === 'road_built');
  assert.ok(roadBuiltEv !== undefined, 'road_built event must exist');
  assert.equal(roadBuiltEv.targets.length, builtCount,
    `road_built.targets.length must === segment count ${builtCount}`);

  // Conservation checkpoint after road build.
  const stocksAfterRoad = k.stocks(0);
  const tlAfterRoad = k.ledger.totals.transferLoss;
  const capturedAfterRoad = k.ledger.totals.captured;
  const burnedAfterRoad = k.ledger.totals.burned;
  const decayedAfterRoad = k.ledger.totals.decayed;

  const deltaStocksRoad = stocksAfterRoad - stocksBeforeRoad;
  const deltaCapRoad = capturedAfterRoad - capturedBeforeRoad;
  const deltaBurnRoad = burnedAfterRoad - burnedBeforeRoad;
  const deltaDecRoad = decayedAfterRoad - decayedBeforeRoad;
  const deltaTLRoad = tlAfterRoad - tlBeforeRoad;
  const rhsRoad = deltaCapRoad - deltaBurnRoad - deltaDecRoad - deltaTLRoad;
  const scaleRoad = Math.max(Math.abs(stocksBeforeRoad), 1);
  assert.ok(Math.abs(deltaStocksRoad - rhsRoad) / scaleRoad < 1e-6,
    `conservation after road build: Δstocks=${deltaStocksRoad} rhs=${rhsRoad} diff=${Math.abs(deltaStocksRoad - rhsRoad)}`);

  // ── Summary for determinism (partial: steps 1–4 + 20-day partial decay) ──
  k.runTo(20 * DAY);

  const segsAtPartial = [...k.graph.nodes.values()]
    .filter(n => n.type === 'matter' && n.attrs.archetype === 'road_segment')
    .map(n => ({ x: n.x, y: n.y, E: n.attrs.E, condition: n.attrs.condition }))
    .sort((a, b) => a.x - b.x || a.y - b.y);

  const deltasSummary = k.deltas.list.map(d => ({ target: d.target, kind: d.kind }));

  const eventCounts = {};
  for (const e of k.ledger.events) eventCounts[e.type] = (eventCounts[e.type] ?? 0) + 1;

  return {
    builtCount,
    rowY,
    segsAtPartial,
    deltasSummary,
    eventCounts,
    decayedTotal: k.ledger.totals.decayed,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Shared setup: build kernel A through the full lifecycle for per-test blocks.
// ──────────────────────────────────────────────────────────────────────────

/** Full setup helper — re-runs for each test block that needs it. */
function fullSetup() {
  const k = makeKernel();
  let bush1, bush2, matCount;
  k.graph.boot(() => {
    bush1 = k.addLiving({ species: 'berry_bush', x: 938, y: 6,
                          R: 20000, body: 30000, tick: 0, age: 400 * DAY });
    bush2 = k.addLiving({ species: 'berry_bush', x: 939, y: 6,
                          R: 20000, body: 30000, tick: 0, age: 400 * DAY });
    matCount = materializeRect(k, RECT, 0);
  });
  const rowInfo = findRoadRow(RECT);
  const { rowY, rowStart, rowEnd } = rowInfo;
  const p1 = createPlayer(k, 0, { x: 938, y: 6 });
  const p2 = createPlayer(k, 0, { x: 939, y: 6 });
  const g = createGroup(k, 0, { x: rowStart, y: rowY });
  pickUntil(k, p1.id, bush1.id, CONTRIBUTION_EACH);
  pickUntil(k, p2.id, bush2.id, CONTRIBUTION_EACH);
  contribute(k, p1.id, g.id, CONTRIBUTION_EACH, 0);
  contribute(k, p2.id, g.id, CONTRIBUTION_EACH, 0);
  buildRoad(k, g.id, { x: rowStart, y: rowY }, { x: rowEnd, y: rowY }, 0);
  const segs = [...k.graph.nodes.values()]
    .filter(n => n.type === 'matter' && n.attrs.archetype === 'road_segment');
  return { k, g, p1, p2, bush1, bush2, rowY, rowStart, rowEnd, segs, matCount };
}

// ──────────────────────────────────────────────────────────────────────────
// Test blocks
// ──────────────────────────────────────────────────────────────────────────

test('P2 probe step 1-4: boot, harvest, contribute, buildRoad — conservation holds', () => {
  // runScenario() exercises all steps 1-4 with full assertions inline.
  runScenario();  // assertion failures propagate as test failures
});

test('P2 probe step 5: traffic on road creates no path nodes; bare tile still wears', () => {
  const { k, rowY, rowStart, rowEnd } = fullSetup();
  // Third player starts on the road's first tile.
  const p3 = createPlayer(k, 0, { x: rowStart, y: rowY });

  // Walk the road end-to-end (east along the road row).
  for (let x = rowStart; x < rowEnd; x++) {
    move(k, p3.id, 1, 0, 0);
    // Assert: no path node on the road tile just entered.
    assert.equal(pathAt(k, x + 1, rowY), undefined,
      `no path node on road tile (${x + 1},${rowY})`);
  }

  // Control: step south off the road (one step south of the last tile).
  const offRoadY = rowY + 1;
  const offRoadX = rowEnd;
  // p3 is at (rowEnd, rowY) — move south.
  assert.ok(offRoadY < k.bounds.y0 + k.bounds.h, 'off-road tile must be within bounds');
  move(k, p3.id, 0, 1, 0);   // step south
  assert.ok(pathAt(k, offRoadX, offRoadY) !== undefined,
    `bare tile (${offRoadX},${offRoadY}) must have a path node after one step`);
});

test('P2 probe step 6: reboot-bare — paved placement keys absent in kernel B; siblings present', () => {
  const { k, matCount } = fullSetup();
  const kA = k;

  // Collect the paved placement keys from kA.
  const pavedKeys = new Set(
    kA.deltas.list
      .filter(d => d.kind === 'paved' && d.target?.startsWith('placement:'))
      .map(d => d.target.slice('placement:'.length)));
  assert.ok(pavedKeys.size >= 1, `need ≥1 paved placement key; got ${pavedKeys.size}`);

  // Kernel B: same seed + copy of kA's deltas (paved suppression) → no road nodes.
  const kB = makeKernel();
  for (const d of kA.deltas.list) kB.deltas.push(d);
  kB.graph.boot(() => materializeRect(kB, RECT, 0));

  const bPlacements = new Set(
    [...kB.graph.nodes.values()].map(n => n.attrs?.placement).filter(Boolean));

  // Paved placement keys must be absent in B.
  for (const key of pavedKeys) {
    assert.ok(!bPlacements.has(key),
      `paved placement key "${key}" must be suppressed in kernel B`);
  }

  // Sibling (non-paved) placements from the same rect must still appear in B.
  const kRef = makeKernel();
  kRef.graph.boot(() => materializeRect(kRef, RECT, 0));
  const refKeys = [...kRef.graph.nodes.values()].map(n => n.attrs?.placement).filter(Boolean);
  const siblings = refKeys.filter(k => !pavedKeys.has(k));
  assert.ok(siblings.length >= 1,
    `need ≥1 sibling (non-paved) placement for non-vacuous check; ref has ${refKeys.length}`);
  for (const key of siblings) {
    assert.ok(bPlacements.has(key),
      `sibling placement "${key}" must NOT be suppressed in kernel B`);
  }
});

test('P2 probe step 7: decay to gone — E returns to ambient, deltas healed, conservation holds', () => {
  const { k } = fullSetup();

  // Capture the segments built and their E.
  const segsBuilt = [...k.graph.nodes.values()]
    .filter(n => n.type === 'matter' && n.attrs.archetype === 'road_segment');
  const builtCount = segsBuilt.length;
  assert.ok(builtCount >= 5, `need ≥5 segments; got ${builtCount}`);
  // Expected E floor per segment (nurture channel).
  const segEFloor = ROAD_E_PER_TILE * CHANNEL_EFF.nurture;

  // Stocks + ledger snapshot at tick 0 (after build, before decay).
  const stocksT0 = k.stocks(0);
  const t0Captured = k.ledger.totals.captured;
  const t0Burned = k.ledger.totals.burned;
  const t0Decayed = k.ledger.totals.decayed;
  const t0TL = k.ledger.totals.transferLoss;

  // Advance until all segments have decayed: ROAD_CONDITION_MAX / ROAD_DECAY_PER_DAY + 2 days.
  const lifeDays = Math.ceil(ROAD_CONDITION_MAX / ROAD_DECAY_PER_DAY) + 2;
  k.runTo(lifeDays * DAY);

  // Zero road_segment nodes remain.
  const remaining = [...k.graph.nodes.values()]
    .filter(n => n.type === 'matter' && n.attrs.archetype === 'road_segment');
  assert.equal(remaining.length, 0, 'all road_segment nodes must be gone after full decay');

  // decayed counter grew by at least Σ segment E at death (floor = builtCount × segEFloor).
  const decayedGrowth = k.ledger.totals.decayed - t0Decayed;
  const decayedFloor = builtCount * segEFloor;
  assert.ok(decayedGrowth >= decayedFloor - 1e-6,
    `decayed counter must grow by ≥${decayedFloor}; grew by ${decayedGrowth}`);

  // Zero paved deltas remain.
  const pavedRemaining = k.deltas.list.filter(d => d.kind === 'paved');
  assert.equal(pavedRemaining.length, 0, 'all paved deltas must be healed after road decay');

  // road_gone events ≥ segment count.
  const goneEvents = k.ledger.events.filter(e => e.type === 'road_gone');
  assert.ok(goneEvents.length >= builtCount,
    `≥${builtCount} road_gone events; got ${goneEvents.length}`);

  // Full conservation identity at k.tick (not tick 0).
  const stocksEnd = k.stocks(k.tick);
  const endCaptured = k.ledger.totals.captured;
  const endBurned = k.ledger.totals.burned;
  const endDecayed = k.ledger.totals.decayed;
  const endTL = k.ledger.totals.transferLoss;

  const deltaStocks = stocksEnd - stocksT0;
  const rhs = (endCaptured - t0Captured) - (endBurned - t0Burned) - (endDecayed - t0Decayed) - (endTL - t0TL);
  const scale = Math.max(Math.abs(t0Captured - t0Burned), 1);
  assert.ok(Math.abs(deltaStocks - rhs) / scale < 1e-6,
    `full conservation identity after decay: Δstocks=${deltaStocks} rhs=${rhs} diff=${Math.abs(deltaStocks - rhs)}`);
});

test('P2 probe step 8: regrow — post-decay deltas healed, paved placements re-materialize in kernel C', () => {
  const { k } = fullSetup();

  // Capture paved keys before decay.
  const pavedKeysBefore = new Set(
    k.deltas.list
      .filter(d => d.kind === 'paved' && d.target?.startsWith('placement:'))
      .map(d => d.target.slice('placement:'.length)));
  assert.ok(pavedKeysBefore.size >= 1, 'need ≥1 paved key before decay');

  // Decay fully.
  const lifeDays = Math.ceil(ROAD_CONDITION_MAX / ROAD_DECAY_PER_DAY) + 2;
  k.runTo(lifeDays * DAY);

  // All paved deltas healed.
  assert.equal(k.deltas.list.filter(d => d.kind === 'paved').length, 0, 'paved deltas healed');

  // Kernel C: same seed + kA's POST-decay deltas (paved healed = no suppression for those keys).
  const kC = makeKernel();
  for (const d of k.deltas.list) kC.deltas.push(d);
  kC.graph.boot(() => materializeRect(kC, RECT, 0));

  const cPlacements = new Set(
    [...kC.graph.nodes.values()].map(n => n.attrs?.placement).filter(Boolean));

  // At least one previously-paved placement key re-materializes in C.
  let regrewCount = 0;
  for (const key of pavedKeysBefore) {
    if (cPlacements.has(key)) regrewCount++;
  }
  assert.ok(regrewCount >= 1,
    `≥1 previously-paved placement must re-materialize in kernel C after road decay; got ${regrewCount}`);
});

test('P2 probe step 9: determinism — runScenario() twice is bit-identical', () => {
  assert.deepEqual(runScenario(), runScenario(),
    'two identical scenario runs must produce bit-identical summary objects');
});
