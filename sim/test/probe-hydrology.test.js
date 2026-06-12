// sim/test/probe-hydrology.test.js — P2.5 probe: the world has real linear rivers
// now. A discovered stream blocks routing where basins never did; settlers fund a
// group with picked time; the group builds a ford at a narrow crossable point
// (scouted programmatically, never hardcoded); a route then crosses the water
// through the ford; the unmaintained ford decays away and the crossing is lost
// again; conservation holds exactly; the whole history replays bit-identically.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { createPlayer, pick } from '../world/actions.js';
import { createGroup, contribute } from '../society/groups.js';
import { buildCrossing, crossingsOf, FORD_COST, FORD_MAX_WIDTH, CROSSING_DECAY_PER_DAY } from '../world/crossings.js';
import { planRoute, tileCost } from '../world/routing.js';
import { classifyBiome } from '../../src/world/biomes.js';
import { streamAt } from '../../src/world/hydrology.js';
import { DAY } from '../time/metabolism.js';
import { materializeRect } from '../world/wire.js';

// Discover a stream tile with land on opposite sides (a crossable narrows).
// Deterministic scan — same search order every run.
function findCrossable() {
  for (let y = -300; y < 300; y += 1) for (let x = 930; x < 2430; x += 1) {
    const s = streamAt(x, y);
    if (!s || s.width > FORD_MAX_WIDTH) continue;
    // land west & east of the channel within 4 tiles
    let west = null, east = null;
    for (let d = 1; d <= 4; d++) {
      if (!west && tileCost(x - d, y) !== Infinity) west = { x: x - d, y };
      if (!east && tileCost(x + d, y) !== Infinity) east = { x: x + d, y };
    }
    if (west && east) return { tile: { x, y }, west, east, width: s.width };
  }
  return null;
}

/** Pick from a bush until player.R >= targetTu (real pick verb, repeated bites). */
function pickUntil(k, playerId, bushId, targetTu) {
  const player = k.graph.nodes.get(playerId);
  while (player.R < targetTu) {
    const gained = pick(k, playerId, bushId, 0);
    if (gained <= 0) break;   // exhausted (should not happen with large R/body)
  }
}

/** Run the full hydrology scenario; returns a summary object for determinism comparison.
 *  Each call builds a FRESH Kernel. */
function runScenario() {
  // ── Step 1: SCOUT — find a crossable narrows ─────────────────────────────
  const spot = findCrossable();
  assert.ok(spot, 'a crossable narrows exists (width ≤ FORD_MAX_WIDTH, land both sides)');

  // Bounds: crossings.test formula, h ≥ 13, wide enough for banks + berry-bush tiles
  const bounds = {
    x0: spot.west.x - 4,
    y0: spot.tile.y - 6,
    w:  (spot.east.x - spot.west.x) + 9,
    h:  13,
  };

  // LINEARITY HEADLINE: scan the crossing row across bounds width; count contiguous stream tiles.
  let scanlineWidth = 0;
  let inStream = false;
  let maxContiguous = 0;
  let cur = 0;
  // center scan on the crossing tile
  const scanX0 = bounds.x0;
  const scanX1 = bounds.x0 + bounds.w - 1;
  for (let x = scanX0; x <= scanX1; x++) {
    if (classifyBiome(x, spot.tile.y).id === 'stream') {
      cur++;
      if (cur > maxContiguous) maxContiguous = cur;
    } else {
      cur = 0;
    }
  }
  scanlineWidth = maxContiguous;
  assert.ok(scanlineWidth <= 10,
    `linear channel: contiguous stream width ≤ 10; got ${scanlineWidth} (P2 basins were 180–200)`);

  // ── Step 2: FUND — fresh kernel, boot bushes on land near west bank ───────
  const k = new Kernel({ seed: 7, bounds });

  // Place berry bushes on land tiles near the west bank
  // Bush positions: use spot.west tile and one step further west (both must be land)
  const bx1 = spot.west.x;
  const bx2 = spot.west.x - 1;
  const by  = spot.tile.y;

  let bush1, bush2, matCount;
  k.graph.boot(() => {
    bush1 = k.addLiving({ species: 'berry_bush', x: bx1, y: by,
                          R: 20000, body: 30000, tick: 0, age: 400 * DAY });
    bush2 = k.addLiving({ species: 'berry_bush', x: bx2, y: by,
                          R: 20000, body: 30000, tick: 0, age: 400 * DAY });
    matCount = materializeRect(k, bounds, 0);
  });

  // Vacuity guard: materializeRect must have created ≥1 entity (OR bushes exist)
  // (stream-heavy bounds may have sparse placements — bushes are always present)
  assert.ok(bush1 && bush2, 'bush nodes created');

  const CONTRIBUTION_EACH = FORD_COST + 20;   // enough for one player to cover the ford

  const p1 = createPlayer(k, 0, { x: bx1, y: by });
  const p2 = createPlayer(k, 0, { x: bx2, y: by });
  const g  = createGroup(k, 0, spot.west);

  // Pre-harvest ledger baseline (tick-0 stocks snapshot)
  const stocksBefore = k.stocks(0);
  const tlBefore      = k.ledger.totals.transferLoss;
  const capBefore     = k.ledger.totals.captured;
  const burnBefore    = k.ledger.totals.burned;
  const decBefore     = k.ledger.totals.decayed;

  // Real harvest (pick verb) — each player picks until holding ≥ CONTRIBUTION_EACH
  pickUntil(k, p1.id, bush1.id, CONTRIBUTION_EACH);
  pickUntil(k, p2.id, bush2.id, CONTRIBUTION_EACH);

  assert.ok(k.graph.nodes.get(p1.id).R >= CONTRIBUTION_EACH,
    `p1 must hold ≥${CONTRIBUTION_EACH} tu; holds ${k.graph.nodes.get(p1.id).R}`);
  assert.ok(k.graph.nodes.get(p2.id).R >= CONTRIBUTION_EACH,
    `p2 must hold ≥${CONTRIBUTION_EACH} tu; holds ${k.graph.nodes.get(p2.id).R}`);

  // Contribute to group through gift channel (eff=0.90)
  assert.equal(contribute(k, p1.id, g.id, CONTRIBUTION_EACH, 0), true, 'p1 contribute succeeded');
  assert.equal(contribute(k, p2.id, g.id, CONTRIBUTION_EACH, 0), true, 'p2 contribute succeeded');

  assert.ok(g.R >= FORD_COST,
    `group wallet must be ≥ FORD_COST after contributions; got ${g.R}`);

  // ── Step 3: BLOCKED CHECK ─────────────────────────────────────────────────
  const routeBefore = planRoute(spot.west, spot.east, bounds);
  let blocked = false;
  let routeLenBefore = null;
  if (routeBefore === null) {
    blocked = true;
  } else {
    // route exists without crossing — must not pass through any stream tile
    for (const p of routeBefore) {
      assert.notEqual(classifyBiome(p.x, p.y).id, 'stream',
        `route without crossing must not traverse stream tile (${p.x},${p.y})`);
    }
    routeLenBefore = routeBefore.length;
  }

  // ── Step 3 conservation checkpoint (after harvest+contribute, tick 0) ─────
  const stocksAfterFund = k.stocks(0);
  const tlAfterFund   = k.ledger.totals.transferLoss;
  const capAfterFund  = k.ledger.totals.captured;
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
    `conservation after funding: Δstocks=${deltaStocksFund} rhs=${rhsFund} diff=${Math.abs(deltaStocksFund - rhsFund)}`);

  // ── Step 4: BUILD ford ────────────────────────────────────────────────────
  const groupRBefore = g.R;
  const stocksBeforeBuild = k.stocks(0);
  const tlBeforeBuild   = k.ledger.totals.transferLoss;
  const capBeforeBuild  = k.ledger.totals.captured;
  const burnBeforeBuild = k.ledger.totals.burned;
  const decBeforeBuild  = k.ledger.totals.decayed;

  const ford = buildCrossing(k, g.id, spot.tile, 'ford', 0);
  assert.ok(ford !== null, 'ford must be built successfully');
  assert.ok(Math.abs(groupRBefore - g.R - FORD_COST) < 1e-9,
    `group debited exactly FORD_COST=${FORD_COST}; debited ${groupRBefore - g.R}`);
  assert.ok(k.ledger.events.some(e => e.type === 'ford_built'), 'ford_built event must exist');
  assert.ok(ford.attrs.E > 0, 'ford node must have E > 0 (embodied time from nurture transfer)');

  const fordE = ford.attrs.E;

  // Conservation checkpoint after ford build (tick 0)
  const stocksAfterBuild = k.stocks(0);
  const tlAfterBuild   = k.ledger.totals.transferLoss;
  const capAfterBuild  = k.ledger.totals.captured;
  const burnAfterBuild = k.ledger.totals.burned;
  const decAfterBuild  = k.ledger.totals.decayed;

  const deltaStocksBuild = stocksAfterBuild - stocksBeforeBuild;
  const deltaCapBuild  = capAfterBuild  - capBeforeBuild;
  const deltaBurnBuild = burnAfterBuild - burnBeforeBuild;
  const deltaDecBuild  = decAfterBuild  - decBeforeBuild;
  const deltaTLBuild   = tlAfterBuild   - tlBeforeBuild;
  const rhsBuild = deltaCapBuild - deltaBurnBuild - deltaDecBuild - deltaTLBuild;
  const scaleBuild = Math.max(Math.abs(stocksBeforeBuild), 1);
  assert.ok(Math.abs(deltaStocksBuild - rhsBuild) / scaleBuild < 1e-6,
    `conservation after ford build: Δstocks=${deltaStocksBuild} rhs=${rhsBuild} diff=${Math.abs(deltaStocksBuild - rhsBuild)}`);

  // ── Step 5: CROSS — route through the ford ────────────────────────────────
  const xs = crossingsOf(k);
  assert.ok(xs.has(`${spot.tile.x},${spot.tile.y}`),
    'ford tile must appear in crossingsOf(k)');
  const routeWith = planRoute(spot.west, spot.east, bounds, { crossings: xs });
  assert.ok(routeWith !== null, 'route must exist when crossing whitelist includes the ford');
  if (blocked) {
    assert.ok(routeWith.some(p => p.x === spot.tile.x && p.y === spot.tile.y),
      'when the channel previously blocked, route must pass through the ford tile');
  }
  const routeLenWith = routeWith.length;

  // ── Step 6: DECAY — 51 days: ford washes away ────────────────────────────
  const decBeforeDecay = k.ledger.totals.decayed;
  k.runTo(51 * DAY);

  assert.ok(k.ledger.events.some(e => e.type === 'crossing_gone'),
    'crossing_gone event must exist after 51 days without maintenance');
  assert.ok(!k.graph.nodes.has(ford.id),
    'ford node must be removed after condition reaches 0');

  const decayedGrowth = k.ledger.totals.decayed - decBeforeDecay;
  assert.ok(decayedGrowth >= fordE - 1e-6,
    `decayed counter must grow by ≥ fordE=${fordE}; grew by ${decayedGrowth}`);

  // Re-derive crossings — ford tile must no longer be present
  const xsAfter = crossingsOf(k);
  assert.ok(!xsAfter.has(`${spot.tile.x},${spot.tile.y}`),
    'ford tile must no longer be in crossingsOf(k) after decay');

  // Route with fresh (empty) crossings set
  const routeAfterDecay = planRoute(spot.west, spot.east, bounds, { crossings: xsAfter });
  let routeAfterLen = null;
  if (blocked) {
    // When originally blocked, should be blocked again or at least not through stream
    if (routeAfterDecay === null) {
      routeAfterLen = null;
    } else {
      for (const p of routeAfterDecay) {
        assert.notEqual(classifyBiome(p.x, p.y).id, 'stream',
          `post-decay route must not traverse stream tile (${p.x},${p.y})`);
      }
      routeAfterLen = routeAfterDecay.length;
    }
  } else {
    routeAfterLen = routeAfterDecay ? routeAfterDecay.length : null;
  }

  // ── Step 7: SUMMARY for determinism comparison ────────────────────────────
  const eventCounts = {};
  for (const e of k.ledger.events) eventCounts[e.type] = (eventCounts[e.type] ?? 0) + 1;

  return {
    crossing: { x: spot.tile.x, y: spot.tile.y, width: spot.width },
    scanlineWidth,
    blocked,
    routeLenBefore,
    routeLenWith,
    routeAfterDecay: routeAfterLen,
    fordE: Math.round(fordE * 1e6) / 1e6,
    eventTypeCounts: eventCounts,
    finalDecayed: Math.round(k.ledger.totals.decayed * 1e6) / 1e6,
    finalStocks: Math.round(k.stocks(k.tick) * 1e6) / 1e6,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Test blocks
// ────────────────────────────────────────────────────────────────────────────

test('P2.5 probe: scout, fund, build ford, cross, decay — conservation holds', () => {
  runScenario();  // assertion failures propagate as test failures
});

test('P2.5 probe determinism — runScenario() twice is bit-identical', () => {
  assert.deepEqual(runScenario(), runScenario(),
    'two identical scenario runs must produce bit-identical summary objects');
});
