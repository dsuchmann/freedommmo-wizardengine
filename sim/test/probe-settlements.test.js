// sim/test/probe-settlements.test.js — P3 probe: settlers pool time into a group;
// the group founds a village at the SCORED best site in the region (every reason
// verifiable against an independent rescore); plots are deeded to members; a second
// group founds a second village whose trade component is live (the first village is
// reachable) and builds a road between them (P2 machinery); overlap is refused;
// the whole history is deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { createPlayer, pick } from '../world/actions.js';
import { createGroup, contribute } from '../society/groups.js';
import { foundSettlement, assignPlot, TERRITORY_W, TERRITORY_H } from '../society/settlements.js';
import { findSettlementSite, scoreSite } from '../society/suitability.js';
import { buildRoad, ROAD_E_PER_TILE } from '../world/roads.js';
import { planRoute, tileCost } from '../world/routing.js';
import { materializeRect } from '../world/wire.js';
import { DAY } from '../time/metabolism.js';

// Rect: river wedge NW + grassland (same rect as suitability.test.js).
const RECT = { x0: 926, y0: 0, w: 28, h: 14 };
const makeKernel = () => new Kernel({ seed: 7, bounds: RECT });

// berry_bush pick: bite=300, harvest eff=0.50 → 150 tu per bite.
// 3 bites = 450 tu. Large R/body ensures no exhaustion within many bites.
const CONTRIBUTION_EACH = 400;

/** Pick from a bush until player.R >= targetTu (real pick verb, repeated bites). */
function pickUntil(k, playerId, bushId, targetTu) {
  const player = k.graph.nodes.get(playerId);
  while (player.R < targetTu) {
    const gained = pick(k, playerId, bushId, 0);
    if (gained <= 0) break;   // exhausted (should not happen with large R/body)
  }
}

/** Best site in rect whose TERRITORY won't overlap `excludeTerritory`, scored with `rect`
 *  as the routing bounds (so trade routes to existing settlements can pass through the
 *  full rect, not just a narrow sub-strip). This is the honest absent-site-2 finder:
 *  findSettlementSite(RECT) returns site1 again after v1 is founded (it's the global
 *  argmax), but foundSettlement refuses the overlap — so we scan with the territory
 *  exclusion baked in, matching the predicate foundSettlement would apply. */
function bestSiteExcluding(k, rect, excludeTerritory) {
  function territoryFor(x, y) {
    const x0 = Math.max(rect.x0, x - Math.floor(TERRITORY_W / 2));
    const y0 = Math.max(rect.y0, y - Math.floor(TERRITORY_H / 2));
    const w  = Math.min(TERRITORY_W, rect.x0 + rect.w - x0);
    const h  = Math.min(TERRITORY_H, rect.y0 + rect.h - y0);
    return { x0, y0, w, h };
  }
  function overlapsFn(a, b) {
    return a.x0 < b.x0 + b.w && b.x0 < a.x0 + a.w &&
           a.y0 < b.y0 + b.h && b.y0 < a.y0 + a.h;
  }
  let best = null;
  for (let y = rect.y0; y < rect.y0 + rect.h; y++) {
    for (let x = rect.x0; x < rect.x0 + rect.w; x++) {
      if (overlapsFn(territoryFor(x, y), excludeTerritory)) continue;
      const s = scoreSite(k, x, y);
      if (!s) continue;
      if (!best || s.score > best.score + 1e-12) best = { x, y, ...s };
    }
  }
  return best;
}

/** Run the full settlement scenario; returns a plain-data summary for determinism comparison. */
function runScenario() {
  const k = makeKernel();

  // ── Step 1: boot — four large berry_bushes + materializeRect ─────────────
  // Two bushes for group 1 (near site1 candidate), two for group 2 (east strip).
  // Large R+body: 20000 + 30000 ensures no exhaustion within many bites.
  let bush1, bush2, bush3, bush4, matCount;
  k.graph.boot(() => {
    bush1 = k.addLiving({ species: 'berry_bush', x: 941, y: 1,
                          R: 20000, body: 30000, tick: 0, age: 400 * DAY });
    bush2 = k.addLiving({ species: 'berry_bush', x: 942, y: 1,
                          R: 20000, body: 30000, tick: 0, age: 400 * DAY });
    bush3 = k.addLiving({ species: 'berry_bush', x: 948, y: 1,
                          R: 20000, body: 30000, tick: 0, age: 400 * DAY });
    bush4 = k.addLiving({ species: 'berry_bush', x: 949, y: 1,
                          R: 20000, body: 30000, tick: 0, age: 400 * DAY });
    matCount = materializeRect(k, RECT, 0);
  });

  // Vacuity: materializeRect must have created entities.
  assert.ok(matCount >= 1,
    `vacuity guard: materializeRect must create ≥1 entity; got ${matCount}`);

  // Two players for group 1.
  const p1 = createPlayer(k, 0, { x: 941, y: 1 });
  const p2 = createPlayer(k, 0, { x: 942, y: 1 });
  const g1 = createGroup(k, 0, { x: 941, y: 0 });

  // Pre-harvest ledger baseline (tick-0 stocks snapshot — all entities created at tick 0, dt=0).
  const stocksBefore = k.stocks(0);
  const tlBefore = k.ledger.totals.transferLoss;
  const capBefore = k.ledger.totals.captured;
  const burnBefore = k.ledger.totals.burned;
  const decBefore  = k.ledger.totals.decayed;

  // Real harvest: each player picks until holding ≥ CONTRIBUTION_EACH tu.
  pickUntil(k, p1.id, bush1.id, CONTRIBUTION_EACH);
  pickUntil(k, p2.id, bush2.id, CONTRIBUTION_EACH);

  assert.ok(k.graph.nodes.get(p1.id).R >= CONTRIBUTION_EACH,
    `p1 must hold ≥${CONTRIBUTION_EACH} tu; holds ${k.graph.nodes.get(p1.id).R}`);
  assert.ok(k.graph.nodes.get(p2.id).R >= CONTRIBUTION_EACH,
    `p2 must hold ≥${CONTRIBUTION_EACH} tu; holds ${k.graph.nodes.get(p2.id).R}`);

  // Contribute to group 1 through the gift channel (eff=0.90).
  assert.equal(contribute(k, p1.id, g1.id, CONTRIBUTION_EACH, 0), true, 'p1 contribute succeeded');
  assert.equal(contribute(k, p2.id, g1.id, CONTRIBUTION_EACH, 0), true, 'p2 contribute succeeded');

  // ── Step 1 conservation checkpoint (after harvest + contribute) ───────────
  // Δstocks = -(new transferLoss); captured/burned/decayed unchanged at tick 0 (no flux).
  const stocksAfterFund = k.stocks(0);
  const tlAfterFund  = k.ledger.totals.transferLoss;
  const capAfterFund = k.ledger.totals.captured;
  const burnAfterFund = k.ledger.totals.burned;
  const decAfterFund  = k.ledger.totals.decayed;

  const deltaStocksFund = stocksAfterFund - stocksBefore;
  const deltaCapFund  = capAfterFund  - capBefore;
  const deltaBurnFund = burnAfterFund - burnBefore;
  const deltaDecFund  = decAfterFund  - decBefore;
  const deltaTLFund   = tlAfterFund   - tlBefore;
  const rhsFund = deltaCapFund - deltaBurnFund - deltaDecFund - deltaTLFund;
  const scaleFund = Math.max(Math.abs(stocksBefore), 1);
  assert.ok(Math.abs(deltaStocksFund - rhsFund) / scaleFund < 1e-6,
    `conservation after g1 funding: Δstocks=${deltaStocksFund} rhs=${rhsFund} diff=${Math.abs(deltaStocksFund - rhsFund)}`);

  // ── Step 2: findSettlementSite → site1 ────────────────────────────────────
  const site1 = findSettlementSite(k, RECT);
  assert.ok(site1, 'site1 must be found in RECT');
  assert.ok(tileCost(site1.x, site1.y) !== Infinity, 'site1 is land');

  // Independent rescore: score and reasons must be bit-identical to site1.
  const rescore1 = scoreSite(k, site1.x, site1.y);
  assert.deepEqual({ score: site1.score, reasons: site1.reasons },
    { score: rescore1.score, reasons: rescore1.reasons },
    'site1 score+reasons match independent rescore');

  // Argmax identity: no scanned tile beats site1 (reuse suitability.test.js pattern).
  for (let y = RECT.y0; y < RECT.y0 + RECT.h; y++) {
    for (let x = RECT.x0; x < RECT.x0 + RECT.w; x++) {
      const s = scoreSite(k, x, y);
      if (s) assert.ok(s.score <= site1.score + 1e-12,
        `argmax violated: (${x},${y}) scores ${s.score} > site1 ${site1.score}`);
    }
  }

  // ── Step 3: foundSettlement → village1 ────────────────────────────────────
  const stocksBeforeV1 = k.stocks(0);
  const evCountBeforeV1 = k.ledger.events.length;
  const v1 = foundSettlement(k, g1.id, { x: site1.x, y: site1.y }, 0);
  assert.ok(v1, 'foundSettlement must succeed for g1 at site1');

  // Founding is a declaration: zero time moved.
  assert.equal(k.stocks(0), stocksBeforeV1,
    'foundSettlement does not move time (zero stocks change)');

  // settlement_founded event
  const sfEv = k.ledger.events.find(e => e.type === 'settlement_founded');
  assert.ok(sfEv, 'settlement_founded event must exist');
  assert.equal(sfEv.actor, g1.id, 'settlement_founded actor === g1.id (provenance rule)');
  assert.deepEqual(sfEv.attrs.reasons, site1.reasons,
    'event reasons deepEqual site1.reasons (reason codes ride the event verbatim)');

  // Every event target id exists in the graph.
  for (const tid of sfEv.targets) {
    assert.ok(k.graph.nodes.has(tid),
      `settlement_founded target ${tid} must exist in graph`);
  }

  // Districts exactly cover territory.
  const t1 = v1.attrs.territory;
  const ds1 = v1.attrs.districts;
  assert.ok(ds1.length >= 2, 'at least residential + craft districts');
  const area1 = ds1.reduce((a, d) => a + d.rect.w * d.rect.h, 0);
  assert.equal(area1, t1.w * t1.h, 'districts exactly cover territory');

  // At least one plot owned by g1.
  const v1plots = [...k.graph.nodes.values()].filter(n => n.type === 'plot' && n.attrs.settlement === v1.id);
  assert.ok(v1plots.length >= 1, 'at least one plot deeded');
  assert.ok(v1plots.every(p => p.attrs.owner === g1.id), 'all plots owned by founder group g1');

  // ── Step 4: assignPlot to each of the two players ─────────────────────────
  const plot1 = v1plots[0];
  const ap1 = assignPlot(k, g1.id, plot1.id, p1.id, 0);
  assert.equal(ap1, true, 'assignPlot to p1 succeeded');
  assert.equal(plot1.attrs.owner, p1.id, 'plot1 owner changed to p1');

  // Assign a second plot if available; if only one plot exists, assign same plot is refused.
  let ap2 = false;
  if (v1plots.length >= 2) {
    ap2 = assignPlot(k, g1.id, v1plots[1].id, p2.id, 0);
    assert.equal(ap2, true, 'assignPlot to p2 succeeded');
    assert.equal(v1plots[1].attrs.owner, p2.id, 'plot2 owner changed to p2');
  }

  // Two plot_assigned events emitted (or one if only one plot available).
  const assignedEvents = k.ledger.events.filter(e => e.type === 'plot_assigned');
  const expectedAssignEvents = v1plots.length >= 2 ? 2 : 1;
  assert.equal(assignedEvents.length, expectedAssignEvents,
    `${expectedAssignEvents} plot_assigned event(s) must exist`);

  // ── Step 5: Group 2 harvest + contribute + site2 + found village2 ─────────
  const p3 = createPlayer(k, 0, { x: 948, y: 1 });
  const p4 = createPlayer(k, 0, { x: 949, y: 1 });
  const g2 = createGroup(k, 0, { x: 953, y: 0 });

  pickUntil(k, p3.id, bush3.id, CONTRIBUTION_EACH);
  pickUntil(k, p4.id, bush4.id, CONTRIBUTION_EACH);
  assert.equal(contribute(k, p3.id, g2.id, CONTRIBUTION_EACH, 0), true, 'p3 contribute to g2');
  assert.equal(contribute(k, p4.id, g2.id, CONTRIBUTION_EACH, 0), true, 'p4 contribute to g2');

  // Verify g2 has enough to fund the road (route length determined below).
  // Route from site2 to v1: 13 tiles × 30 tu/tile = 390 tu; g2.R = 720 >= 390.
  assert.ok(g2.R > 0, 'g2 must be funded');

  // Find site2: best site in RECT whose territory won't overlap v1's territory.
  // Uses RECT as routing bounds so the trade route to v1 is reachable.
  const site2 = bestSiteExcluding(k, RECT, v1.attrs.territory);
  assert.ok(site2, 'site2 must be found (non-overlapping territory in RECT)');
  assert.ok(tileCost(site2.x, site2.y) !== Infinity, 'site2 is land');

  // LIVE trade proof: site2 must see v1 as a reachable settlement.
  assert.ok(site2.reasons.trade.score > 0,
    `site2 trade component must be > 0 (live trade); got ${site2.reasons.trade.score}`);
  assert.equal(site2.reasons.trade.via, v1.id,
    `site2 trade.via must === v1.id; got ${site2.reasons.trade.via}`);

  // Verify g2 is funded for the road before founding.
  const routeToV1 = planRoute({ x: site2.x, y: site2.y }, { x: v1.x, y: v1.y }, RECT);
  assert.ok(routeToV1, 'route from site2 to v1 must exist');
  const roadCost = routeToV1.length * ROAD_E_PER_TILE;
  assert.ok(g2.R >= roadCost,
    `g2 must be funded for road (${roadCost} tu); has ${g2.R}`);

  const stocksBeforeV2 = k.stocks(0);
  const v2 = foundSettlement(k, g2.id, { x: site2.x, y: site2.y }, 0);
  assert.ok(v2, 'foundSettlement must succeed for g2 at site2');

  // Founding v2 is a declaration: zero time moved.
  assert.equal(k.stocks(0), stocksBeforeV2,
    'foundSettlement v2 does not move time');

  // ── Step 6: buildRoad between village2 and village1 ───────────────────────
  const stocksBeforeRoad = k.stocks(0);
  const tlBeforeRoad  = k.ledger.totals.transferLoss;
  const capBeforeRoad = k.ledger.totals.captured;
  const burnBeforeRoad = k.ledger.totals.burned;
  const decBeforeRoad  = k.ledger.totals.decayed;

  const roadOk = buildRoad(k, g2.id, { x: v2.x, y: v2.y }, { x: v1.x, y: v1.y }, 0);
  assert.equal(roadOk, true, 'buildRoad must succeed with a funded group over a land route');

  const roadBuiltEv = k.ledger.events.find(e => e.type === 'road_built');
  assert.ok(roadBuiltEv, 'road_built event must exist');
  assert.equal(roadBuiltEv.actor, g2.id, 'road_built actor === g2.id');

  // Road segment nodes exist along the route.
  const roadSegs = [...k.graph.nodes.values()]
    .filter(n => n.type === 'matter' && n.attrs.archetype === 'road_segment');
  assert.ok(roadSegs.length >= 1, `road_segment nodes must exist; got ${roadSegs.length}`);
  assert.equal(roadBuiltEv.targets.length, roadSegs.length,
    'road_built.targets.length === segment count');

  // Conservation after road build.
  const stocksAfterRoad = k.stocks(0);
  const tlAfterRoad  = k.ledger.totals.transferLoss;
  const capAfterRoad = k.ledger.totals.captured;
  const burnAfterRoad = k.ledger.totals.burned;
  const decAfterRoad  = k.ledger.totals.decayed;

  const deltaStocksRoad = stocksAfterRoad - stocksBeforeRoad;
  const deltaCapRoad  = capAfterRoad  - capBeforeRoad;
  const deltaBurnRoad = burnAfterRoad - burnBeforeRoad;
  const deltaDecRoad  = decAfterRoad  - decBeforeRoad;
  const deltaTLRoad   = tlAfterRoad   - tlBeforeRoad;
  const rhsRoad = deltaCapRoad - deltaBurnRoad - deltaDecRoad - deltaTLRoad;
  const scaleRoad = Math.max(Math.abs(stocksBeforeRoad), 1);
  assert.ok(Math.abs(deltaStocksRoad - rhsRoad) / scaleRoad < 1e-6,
    `conservation after road build: Δstocks=${deltaStocksRoad} rhs=${rhsRoad} diff=${Math.abs(deltaStocksRoad - rhsRoad)}`);

  // ── Step 7: overlap refusal ────────────────────────────────────────────────
  const g3 = createGroup(k, 0, { x: v1.x, y: v1.y });
  const evCountBeforeOverlap = k.ledger.events.length;
  const v3 = foundSettlement(k, g3.id, { x: v1.x, y: v1.y }, 0);
  assert.equal(v3, null, 'foundSettlement inside v1 territory must be refused');
  assert.equal(k.ledger.events.length, evCountBeforeOverlap,
    'overlap refusal is side-effect-free (no new events)');

  // ── Step 8: full conservation identity ────────────────────────────────────
  // All operations complete; only flows are harvest (0.50) and gift (0.90) and
  // road-nurture (0.95) — all fully counted in transferLoss. At tick 0 no flux.
  const stocksEnd = k.stocks(0);
  const tlEnd  = k.ledger.totals.transferLoss;
  const capEnd = k.ledger.totals.captured;
  const burnEnd = k.ledger.totals.burned;
  const decEnd  = k.ledger.totals.decayed;

  const deltaStocksTotal = stocksEnd - stocksBefore;
  const deltaCapTotal  = capEnd  - capBefore;
  const deltaBurnTotal = burnEnd - burnBefore;
  const deltaDecTotal  = decEnd  - decBefore;
  const deltaTLTotal   = tlEnd   - tlBefore;
  const rhsTotal = deltaCapTotal - deltaBurnTotal - deltaDecTotal - deltaTLTotal;
  const scaleTotal = Math.max(Math.abs(stocksBefore), 1);
  assert.ok(Math.abs(deltaStocksTotal - rhsTotal) / scaleTotal < 1e-6,
    `full conservation identity: Δstocks=${deltaStocksTotal} rhs=${rhsTotal} diff=${Math.abs(deltaStocksTotal - rhsTotal)}`);

  // foundSettlement specifically does not change stocks (tested inline at step 3 and 5 above).

  // ── Summary for determinism ────────────────────────────────────────────────
  const v1plotsSorted = [...k.graph.nodes.values()]
    .filter(n => n.type === 'plot' && n.attrs.settlement === v1.id)
    .map(n => ({ rect: n.attrs.rect, owner: n.attrs.owner }))
    .sort((a, b) => a.rect.x0 - b.rect.x0 || a.rect.y0 - b.rect.y0);

  const v2plotsSorted = [...k.graph.nodes.values()]
    .filter(n => n.type === 'plot' && n.attrs.settlement === v2.id)
    .map(n => ({ rect: n.attrs.rect, owner: n.attrs.owner }))
    .sort((a, b) => a.rect.x0 - b.rect.x0 || a.rect.y0 - b.rect.y0);

  const roadSegsSorted = [...k.graph.nodes.values()]
    .filter(n => n.type === 'matter' && n.attrs.archetype === 'road_segment')
    .map(n => ({ x: n.x, y: n.y }))
    .sort((a, b) => a.x - b.x || a.y - b.y);

  const eventCounts = {};
  for (const e of k.ledger.events) eventCounts[e.type] = (eventCounts[e.type] ?? 0) + 1;

  return {
    site1: { x: site1.x, y: site1.y, score: site1.score, reasons: site1.reasons },
    site2: { x: site2.x, y: site2.y, score: site2.score, reasons: site2.reasons },
    v1: { x: v1.x, y: v1.y, territory: v1.attrs.territory, districtKinds: v1.attrs.districts.map(d => d.kind) },
    v2: { x: v2.x, y: v2.y, territory: v2.attrs.territory, districtKinds: v2.attrs.districts.map(d => d.kind) },
    v1plots: v1plotsSorted,
    v2plots: v2plotsSorted,
    roadSegPositions: roadSegsSorted,
    eventCounts,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Test blocks
// ────────────────────────────────────────────────────────────────────────────

test('P3 probe steps 1-8: boot, harvest, contribute, founding, roads, overlap, conservation', () => {
  // runScenario() exercises all steps with full assertions inline.
  runScenario();  // assertion failures propagate as test failures
});

test('P3 probe step 9: determinism — runScenario() twice is bit-identical', () => {
  assert.deepEqual(runScenario(), runScenario(),
    'two identical scenario runs must produce bit-identical summary objects');
});
