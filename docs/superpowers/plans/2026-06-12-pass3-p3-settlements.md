# Pass 3 — P3: Settlement Seeding & Zoning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A real group founds a settlement at a deterministically *scored* site (water access, fertility, defensibility, trade centrality — every component a reason code on the founding event), claiming a territory, zoning it into districts, and carving the residential district into ownership-primitive plot nodes — the data shape Economy later animates. No town without a founder.

**Architecture:** Two new modules in sim/society/. `suitability.js` — pure deterministic site scoring over the real climate oracle (`classifyBiome().climate`: elevation/moisture/heat) + water proximity scan + trade reachability via P2's `planRoute`; `findSettlementSite` picks the argmax in a rect with total tie-ordering. `settlements.js` — `foundSettlement` (refusals side-effect-free; emits 'settlement_founded' carrying the full reason-code object recomputed at founding time; creates a settlement node with territory + districts and plot nodes owned by the founding group) and `assignPlot` (group → member ownership transfer, the Economy seam). Founding is a *declaration* (zero time cost — declared, like P1's move): physical construction is P4's labor.

**Tech Stack:** Plain ES modules, node:test. No new dependencies.

---

## Context for the implementer (read this first)

1. **Conservation:** settlements and plots are pure information — `type:'settlement'`/`type:'plot'` nodes with NO R and NO attrs.E, so `kernel.stocks()` (sim/kernel/kernel.js:104-130) ignores them (stocks counts corpse/aggregate/matter-E/R-wallet branches only — verify by reading it). Founding moves no time; the only conserved flows in the probe are the real contribute calls (gift 0.90). Δstocks = −transferLoss at tick 0.
2. **Provenance rule — no town without a founder:** `foundSettlement` requires a real group node (P2's sim/society/groups.js `createGroup`). Every settlement/plot node carries `causeEventId` (createNode param; the node STORES it as `createdByEvent` — graph.js, P2 lesson) pointing at the 'settlement_founded' event, and the event's targets list every created node id (push via `kernel.ledger.events[evId - 1].targets.push(...)`, the established pattern).
3. **Reason codes (world-compiler discipline):** the founding event's attrs carry the FULL scoring breakdown `{water, fertility, defensibility, trade}` each with its component score and its evidence (nearest water tile, climate values, reachable settlement id). `foundSettlement` recomputes the score itself via `scoreSite` — reasons are guaranteed consistent with the scorer, never caller-supplied.
4. **Climate oracle:** `classifyBiome(x, y)` from src/world/biomes.js (sim-side import precedent: sim/world/baseline.js:3, sim/world/routing.js) returns `{id, definition, climate}` with `climate.{elevation, moisture, heat, drainage, ridgeStrength, ...}` (all deterministic pure noise fields, roughly 0..1 — VERIFY ranges by probing a few tiles with node -e before finalizing clamps). Water ids: reuse `WATER_BIOMES` exported by sim/world/routing.js.
5. **HONEST ABSENCES (declare in module headers, never fake):** no soil system exists — the fertility component is a *declared climate-derived signal* (moisture × heat band), with the world-compiler L7 soil model as named backlog. No population/growth (P5). No markets/property animation (Economy pass) — plots are data-shape primitives only. Founding costs zero time — a declaration, not labor; building construction is P4. The FIRST settlement's trade component is honestly 0 ("no neighbors") — trade centrality only scores when an existing settlement is reachable, which the probe proves by founding a second settlement.
6. **Reboot-orphan caveat (P1/P2 precedent):** settlement and plot nodes are runtime state; they do not survive kernel reconstruction from seed+deltas. Same TODO(save/load) header discipline as paths.js/roads.js. Founding writes NO suppression deltas (a territory is zoned land, not bare dirt — baseline flora keeps materializing inside it; only P4 buildings will claim tiles).
7. **GEOGRAPHY for tests (verified empirically — re-probe if a test fails, adjust coordinates, never weaken structure):** (0,0) ocean; grassland ≈x930+; river wedge ≈x925-937 × y0-5 shrinking eastward (y0 is river through x≈937; y6+ all land). Mixed water+land rect for scoring tests: `{x0: 926, y0: 0, w: 28, h: 14}`. Pure-grass rect: `{x0: 938, y0: 6, w: 16, h: 8}`.
8. **Determinism:** scoring and site selection are pure functions of (kernel graph state, coordinates) — no RNG, total tie-ordering (highest score, then lowest y, then lowest x). `planRoute` (P2) is already deterministic.
9. **Refusals:** side-effect-free, zero events (project invariant — see contribute/buildRoad).
10. **Wire:** settlements/plots do NOT cross the protocol in P3 — declared absence until P4 puts buildings on screen. NO protocol/server changes.
11. **Funding chain in the probe:** real verbs only — boot berry_bushes (`R:20000, body:30000, age:400*DAY`) in `k.graph.boot`, `pick` until players hold R, `contribute` to the group (P2 probe-roads.test.js shows every pattern: pickUntil helper, tick-0 stocks discipline, runScenario-twice determinism).
12. **Suite:** single files `node --test sim/test/<file>`; full suite `npm test` (~8 min, 258 pre-P3) background at close-out only. Commits: conventional + trailer `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`. NEVER push to origin.

---

### Task 1: `sim/society/suitability.js` — site scoring with reason codes

**Files:**
- Create: `sim/society/suitability.js`
- Test: `sim/test/suitability.test.js`

- [ ] **Step 1: failing tests** — create `sim/test/suitability.test.js`:

```js
// sim/test/suitability.test.js — P3: deterministic site scoring over the real climate
// oracle; every component carries evidence (reason codes). Water tiles unscoreable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { scoreSite, findSettlementSite, WEIGHTS, WATER_SCAN_R } from '../society/suitability.js';
import { tileCost } from '../world/routing.js';

const MIXED = { x0: 926, y0: 0, w: 28, h: 14 };   // river wedge (NW) + grassland
const GRASS = { x0: 938, y0: 6, w: 16, h: 8 };    // pure grassland, no water in scan range? (verify)

function makeKernel(bounds = MIXED) { return new Kernel({ seed: 7, bounds }); }

test('P3 scoreSite: water tile is unscoreable (null); land tile yields full reason codes', () => {
  const k = makeKernel();
  assert.equal(scoreSite(k, 930, 0, MIXED), null, 'river tile refused');
  const s = scoreSite(k, 940, 8, MIXED);
  assert.ok(s, 'land tile scored');
  assert.ok(s.score >= 0 && s.score <= 1, 'score normalized');
  for (const c of ['water', 'fertility', 'defensibility', 'trade']) {
    assert.ok(c in s.reasons, `reason code ${c} present`);
    assert.ok(s.reasons[c].score >= 0 && s.reasons[c].score <= 1, `${c} component normalized`);
  }
  // weighted sum identity — the headline score IS its reasons, nothing hidden
  const expect = WEIGHTS.water * s.reasons.water.score + WEIGHTS.fertility * s.reasons.fertility.score
    + WEIGHTS.defensibility * s.reasons.defensibility.score + WEIGHTS.trade * s.reasons.trade.score;
  assert.ok(Math.abs(s.score - expect) < 1e-12, 'score = weighted sum of reason components');
});

test('P3 scoreSite: water access carries evidence — tile near river beats waterless tile on the water component', () => {
  const k = makeKernel();
  // (938,6) sits within WATER_SCAN_R of the river wedge edge; deep grass (945,12) does not (verify empirically; adjust).
  const near = scoreSite(k, 938, 6, MIXED);
  const far = scoreSite(k, 945, 12, MIXED);
  assert.ok(near.reasons.water.score > far.reasons.water.score, 'closer to water scores higher');
  assert.ok(near.reasons.water.nearest, 'evidence: nearest water tile recorded');
  assert.equal(tileCost(near.reasons.water.nearest.x, near.reasons.water.nearest.y), Infinity,
    'recorded nearest tile is actually water');
  assert.equal(far.reasons.water.nearest, null, 'no water in range → null evidence, score 0');
  assert.equal(far.reasons.water.score, 0);
});

test('P3 trade component: no settlements → 0 with declared absence; reachable settlement → > 0 with via evidence', () => {
  const k = makeKernel();
  const s0 = scoreSite(k, 940, 8, MIXED);
  assert.equal(s0.reasons.trade.score, 0, 'first settlement has no neighbors — honest 0');
  assert.equal(s0.reasons.trade.via, null);
  // arrange a settlement node (shape-only — real founding tested in settlements.test.js)
  k.graph.boot(() => {
    k.graph.createNode({ type: 'settlement', tick: 0, x: 945, y: 10, attrs: { territory: { x0: 941, y0: 6, w: 9, h: 8 }, noFlux: true } });
  });
  const s1 = scoreSite(k, 940, 8, MIXED);
  assert.ok(s1.reasons.trade.score > 0, 'reachable settlement raises trade');
  assert.ok(s1.reasons.trade.via != null, 'evidence: which settlement');
});

test('P3 findSettlementSite: argmax in rect, deterministic, never water, twice-identical', () => {
  const k = makeKernel();
  const a = findSettlementSite(k, MIXED);
  const b = findSettlementSite(k, MIXED);
  assert.ok(a, 'site found in mixed rect');
  assert.deepEqual(a, b, 'deterministic');
  assert.ok(tileCost(a.x, a.y) !== Infinity, 'site is land');
  // it really is the maximum: no scanned tile beats it (spot-check full rescan)
  for (let y = MIXED.y0; y < MIXED.y0 + MIXED.h; y++) for (let x = MIXED.x0; x < MIXED.x0 + MIXED.w; x++) {
    const s = scoreSite(k, x, y, MIXED);
    if (s) assert.ok(s.score <= a.score + 1e-12, `no tile beats the chosen site (${x},${y})`);
  }
});
```
Coordinates are empirically motivated — if one lands wrong, probe the map (node -e over classifyBiome) and adjust COORDINATES only; assertion structure may NOT be weakened.

- [ ] **Step 2:** `node --test sim/test/suitability.test.js` — FAIL (module not found).

- [ ] **Step 3: implement** — create `sim/society/suitability.js`:

```js
// sim/society/suitability.js — P3: deterministic settlement-site scoring (world-compiler
// L11 recomputed over OUR climate oracle). Pure functions of (graph state, coords); no RNG.
// Every component is a REASON CODE with evidence — the founding event will carry this
// object verbatim. HONEST ABSENCES: no soil system exists — fertility is a declared
// climate-derived signal (moisture × heat band; L7 soil model = backlog). Trade centrality
// scores 0 with null evidence when no settlement is reachable (first founder has no
// neighbors — declared, not faked).
import { classifyBiome } from '../../src/world/biomes.js';
import { tileCost, planRoute } from '../world/routing.js';

export const WEIGHTS = { water: 0.35, fertility: 0.25, defensibility: 0.2, trade: 0.2 };
export const WATER_SCAN_R = 6;     // Chebyshev radius for water-access scan
const clamp01 = v => Math.max(0, Math.min(1, v));

/** Nearest water tile within WATER_SCAN_R (Chebyshev rings, deterministic order), or null. */
function nearestWater(x, y) {
  for (let r = 1; r <= WATER_SCAN_R; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;   // ring only
      if (tileCost(x + dx, y + dy) === Infinity) return { x: x + dx, y: y + dy, d: r };
    }
  }
  return null;
}

/** Score a candidate site. Returns {score, reasons} or null when the tile itself is water.
 *  reasons = { water:{score,nearest}, fertility:{score,moisture,heat},
 *              defensibility:{score,elevation}, trade:{score,via} }. */
export function scoreSite(kernel, x, y, bounds) {
  if (tileCost(x, y) === Infinity) return null;
  const { climate } = classifyBiome(x, y);
  const nw = nearestWater(x, y);
  const water = { score: nw ? (WATER_SCAN_R + 1 - nw.d) / WATER_SCAN_R : 0, nearest: nw };
  water.score = clamp01(water.score);
  // Declared fertility signal: wet and temperate is fertile (no soil system — see header).
  const fertility = {
    score: clamp01(climate.moisture * (1 - Math.abs(climate.heat - 0.55))),
    moisture: climate.moisture, heat: climate.heat,
  };
  const defensibility = { score: clamp01(climate.elevation), elevation: climate.elevation };
  // Trade centrality: reachable existing settlement (coarse: any land route inside bounds).
  let trade = { score: 0, via: null };
  for (const n of kernel.graph.nodes.values()) {
    if (n.type !== 'settlement') continue;
    const route = planRoute({ x, y }, { x: n.x, y: n.y }, bounds);
    if (route) { trade = { score: 1, via: n.id }; break; }   // first reachable (lowest id order? see note)
  }
  const score = WEIGHTS.water * water.score + WEIGHTS.fertility * fertility.score
    + WEIGHTS.defensibility * defensibility.score + WEIGHTS.trade * trade.score;
  return { score, reasons: { water, fertility, defensibility, trade } };
}

/** Best site in rect: argmax score, ties → lowest y then lowest x. Null if no land tile. */
export function findSettlementSite(kernel, rect) {
  let best = null;
  for (let y = rect.y0; y < rect.y0 + rect.h; y++) for (let x = rect.x0; x < rect.x0 + rect.w; x++) {
    const s = scoreSite(kernel, x, y, rect);
    if (!s) continue;
    if (!best || s.score > best.score + 1e-12) best = { x, y, ...s };
    // strict > with epsilon: earlier (lower y, then x) tile wins ties by scan order
  }
  return best;
}
```

DETERMINISM NOTE on the trade loop: `kernel.graph.nodes.values()` iterates in insertion order, which IS deterministic for a deterministic scenario (same founding order). Acceptable; add a one-line comment saying so. VERIFY climate field ranges (elevation/moisture/heat ≈ 0..1) with a quick node -e probe; adjust clamps only if reality differs.

- [ ] **Step 4:** `node --test sim/test/suitability.test.js` — PASS (adjust test coordinates to real terrain if needed).

- [ ] **Step 5: Commit:**
```bash
git add sim/society/suitability.js sim/test/suitability.test.js
git commit -m "feat(sim): P3 site suitability — deterministic scoring with reason codes over the climate oracle

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: `sim/society/settlements.js` — founding, territory, districts, plots

**Files:**
- Create: `sim/society/settlements.js`
- Test: `sim/test/settlements.test.js`

- [ ] **Step 1: failing tests** — create `sim/test/settlements.test.js`:

```js
// sim/test/settlements.test.js — P3: founding (provenance + reason codes), territory
// overlap refusal, district zoning, plot ownership primitives, assignment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { createPlayer } from '../world/actions.js';
import { createGroup } from '../society/groups.js';
import { foundSettlement, assignPlot, TERRITORY_W, TERRITORY_H } from '../society/settlements.js';
import { scoreSite } from '../society/suitability.js';

const MIXED = { x0: 926, y0: 0, w: 28, h: 14 };

function world() {
  const k = new Kernel({ seed: 7, bounds: MIXED });
  const g = createGroup(k, 0, { x: 940, y: 8 });
  return { k, g };
}

test('P3 foundSettlement: settlement node + districts + plots, all provenanced to one event with reason codes', () => {
  const { k, g } = world();
  const stocksBefore = k.stocks(0);
  const s = foundSettlement(k, g.id, { x: 940, y: 8 }, 0);
  assert.ok(s, 'founded');
  assert.equal(s.type, 'settlement');
  assert.equal(s.attrs.tier, 'village');
  assert.equal(s.attrs.founderGroup, g.id);
  // reason codes recomputed at founding — must match an independent rescore
  const independent = scoreSite(k, 940, 8, MIXED);
  // (trade may differ: founding created the settlement itself — exclude it; assert the static components)
  for (const c of ['water', 'fertility', 'defensibility'])
    assert.deepEqual(s.attrs.reasons[c], independent.reasons[c], `reason ${c} matches independent rescore`);
  // territory centered on site, clipped to bounds
  const t = s.attrs.territory;
  assert.ok(t.w > 0 && t.h > 0 && t.w <= TERRITORY_W && t.h <= TERRITORY_H);
  assert.ok(t.x0 <= 940 && 940 < t.x0 + t.w && t.y0 <= 8 && 8 < t.y0 + t.h, 'site inside territory');
  // districts partition territory (no overlap, full cover), each with kind + reason
  const ds = s.attrs.districts;
  assert.ok(ds.length >= 2, 'at least residential + craft');
  const area = ds.reduce((a, d) => a + d.rect.w * d.rect.h, 0);
  assert.equal(area, t.w * t.h, 'districts exactly cover territory');
  for (const d of ds) { assert.ok(d.kind); assert.ok(d.reason, 'zoning reason code'); }
  // plots: ownership primitives in the residential district, owned by the founder group
  const plots = [...k.graph.nodes.values()].filter(n => n.type === 'plot');
  assert.ok(plots.length >= 1, 'at least one plot');
  for (const p of plots) {
    assert.equal(p.attrs.owner, g.id, 'founder group owns plots initially');
    assert.equal(p.attrs.settlement, s.id);
    assert.ok(p.createdByEvent != null, 'plot provenanced');
  }
  // one founding event targets settlement + all plots
  const ev = k.ledger.events.find(e => e.type === 'settlement_founded');
  assert.ok(ev, 'settlement_founded event');
  assert.equal(ev.actor, g.id, 'no town without a founder');
  assert.equal(ev.targets.length, 1 + plots.length, 'event targets settlement + every plot');
  assert.ok(ev.attrs.reasons, 'reason codes on the event');
  // founding is a declaration: zero time moved
  assert.equal(k.stocks(0), stocksBefore, 'founding conserves exactly (no time moved)');
});

test('P3 foundSettlement refusals: missing group, water site, overlapping territory — side-effect-free', () => {
  const { k, g } = world();
  const evCount0 = k.ledger.events.length;
  assert.equal(foundSettlement(k, 99999, { x: 940, y: 8 }, 0), null, 'missing group');
  assert.equal(foundSettlement(k, g.id, { x: 930, y: 0 }, 0), null, 'water site refused');
  assert.equal(k.ledger.events.length, evCount0, 'no events on refusal');
  assert.equal([...k.graph.nodes.values()].filter(n => n.type === 'settlement').length, 0);
  // found one for real, then refuse the overlap
  const s = foundSettlement(k, g.id, { x: 940, y: 8 }, 0);
  assert.ok(s);
  const evCount1 = k.ledger.events.length;
  assert.equal(foundSettlement(k, g.id, { x: 941, y: 8 }, 0), null, 'overlapping territory refused');
  assert.equal(k.ledger.events.length, evCount1, 'no events on overlap refusal');
});

test('P3 assignPlot: founder group deeds a plot to a member; refusals side-effect-free', () => {
  const { k, g } = world();
  const p = createPlayer(k, 0, { x: 940, y: 8 });
  const s = foundSettlement(k, g.id, { x: 940, y: 8 }, 0);
  const plot = [...k.graph.nodes.values()].find(n => n.type === 'plot');
  assert.equal(assignPlot(k, g.id, plot.id, p.id, 0), true);
  assert.equal(plot.attrs.owner, p.id, 'member now owns the plot');
  assert.ok(k.ledger.events.some(e => e.type === 'plot_assigned'), 'assignment is a ledger event');
  const evCount = k.ledger.events.length;
  assert.equal(assignPlot(k, g.id, plot.id, p.id, 0), false, 'group no longer owns it — refused');
  assert.equal(assignPlot(k, g.id, 99999, p.id, 0), false, 'missing plot');
  assert.equal(assignPlot(k, 99999, plot.id, p.id, 0), false, 'missing group');
  assert.equal(k.ledger.events.length, evCount, 'no events on refusals');
  assert.equal(plot.attrs.owner, p.id, 'owner unchanged by refusals');
});
```

- [ ] **Step 2:** `node --test sim/test/settlements.test.js` — FAIL.

- [ ] **Step 3: implement** — create `sim/society/settlements.js`:

```js
// sim/society/settlements.js — P3: settlement founding (provenance rule: no town
// without a founder — a real group node), territory, district zoning, and plot
// OWNERSHIP PRIMITIVES (the data shape Economy later animates). Founding is a
// declaration: zero time moves (declared — physical construction is P4 labor).
// Settlements write NO suppression deltas: a territory is zoned land, not bare
// dirt — baseline flora keeps materializing until P4 buildings claim tiles.
// HONEST ABSENCES: no population/growth (P5), no markets (Economy), no buildings
// at founding (P4). TODO(save/load): settlement/plot nodes are runtime state and
// do not survive kernel reconstruction — rehydrate on load (P1/P2 precedent).
import { scoreSite } from './suitability.js';
import { tileCost } from '../world/routing.js';

export const TERRITORY_W = 12;
export const TERRITORY_H = 10;
export const PLOT_W = 5;          // hut footprint (M4 blueprint)
export const PLOT_H = 4;

/** Clip a TERRITORY_W×TERRITORY_H rect centered on (x,y) to kernel bounds. */
function territoryAround(x, y, bounds) {
  const x0 = Math.max(bounds.x0, x - Math.floor(TERRITORY_W / 2));
  const y0 = Math.max(bounds.y0, y - Math.floor(TERRITORY_H / 2));
  const w = Math.min(TERRITORY_W, bounds.x0 + bounds.w - x0);
  const h = Math.min(TERRITORY_H, bounds.y0 + bounds.h - y0);
  return { x0, y0, w, h };
}

function overlaps(a, b) {
  return a.x0 < b.x0 + b.w && b.x0 < a.x0 + a.w && a.y0 < b.y0 + b.h && b.y0 < a.y0 + a.h;
}

/** Found a settlement at `site` by group `groupId`. Returns the settlement node, or
 *  null (side-effect-free, zero events) on: missing/non-group founder, water site,
 *  site outside bounds, or territory overlapping an existing settlement. */
export function foundSettlement(kernel, groupId, site, tick) {
  const group = kernel.graph.nodes.get(groupId);
  if (!group || group.type !== 'group') return null;
  const b = kernel.bounds;
  if (!b || site.x < b.x0 || site.x >= b.x0 + b.w || site.y < b.y0 || site.y >= b.y0 + b.h) return null;
  const scored = scoreSite(kernel, site.x, site.y, b);
  if (!scored) return null;                      // water site
  const territory = territoryAround(site.x, site.y, b);
  for (const n of kernel.graph.nodes.values()) {
    if (n.type === 'settlement' && overlaps(territory, n.attrs.territory)) return null;
  }
  // Zoning: split territory into west=residential / east=craft halves. Reason codes
  // are zoning rationale (world-compiler discipline), derived from the site score.
  const wWest = Math.ceil(territory.w / 2);
  const districts = [
    { kind: 'residential', rect: { x0: territory.x0, y0: territory.y0, w: wWest, h: territory.h },
      reason: `nearest water access (water score ${scored.reasons.water.score.toFixed(2)})` },
    { kind: 'craft', rect: { x0: territory.x0 + wWest, y0: territory.y0, w: territory.w - wWest, h: territory.h },
      reason: 'set apart from dwellings (smoke/noise); P4 workshops land here' },
  ];
  const evId = kernel.ledger.emit({
    tick, type: 'settlement_founded', actor: groupId, targets: [],
    attrs: { x: site.x, y: site.y, score: scored.score, reasons: scored.reasons },
  });
  const settlement = kernel.graph.createNode({
    type: 'settlement', tick, x: site.x, y: site.y, causeEventId: evId,
    attrs: { tier: 'village', founderGroup: groupId, territory, districts,
             reasons: scored.reasons, noFlux: true },
  });
  kernel.ledger.events[evId - 1].targets.push(settlement.id);
  // Plots: PLOT_W×PLOT_H grid packed into the residential district, land tiles only
  // (a plot containing water is not deeded). Owned by the founder group initially.
  const res = districts[0].rect;
  for (let py = res.y0; py + PLOT_H <= res.y0 + res.h; py += PLOT_H) {
    for (let px = res.x0; px + PLOT_W <= res.x0 + res.w; px += PLOT_W) {
      let land = true;
      for (let yy = py; yy < py + PLOT_H && land; yy++)
        for (let xx = px; xx < px + PLOT_W && land; xx++)
          if (tileCost(xx, yy) === Infinity) land = false;
      if (!land) continue;
      const plot = kernel.graph.createNode({
        type: 'plot', tick, x: px, y: py, causeEventId: evId,
        attrs: { rect: { x0: px, y0: py, w: PLOT_W, h: PLOT_H }, settlement: settlement.id,
                 district: 'residential', owner: groupId, noFlux: true },
      });
      kernel.ledger.events[evId - 1].targets.push(plot.id);
    }
  }
  return settlement;
}

/** Founder group deeds a plot to a member. Refuses (false, side-effect-free) unless
 *  the group currently owns the plot and all nodes exist. The Economy seam. */
export function assignPlot(kernel, groupId, plotId, memberId, tick) {
  const group = kernel.graph.nodes.get(groupId);
  const plot = kernel.graph.nodes.get(plotId);
  const member = kernel.graph.nodes.get(memberId);
  if (!group || group.type !== 'group' || !plot || plot.type !== 'plot' || !member) return false;
  if (plot.attrs.owner !== groupId) return false;
  kernel.ledger.emit({
    tick, type: 'plot_assigned', actor: groupId, targets: [plotId, memberId],
    attrs: { from: groupId, to: memberId },
  });
  plot.attrs.owner = memberId;
  return true;
}
```

NOTE: founding refuses sites with NO plottable land? It does not — a settlement whose residential district yields zero land plots still founds (plots.length may be 0; the unit test's rect guarantees ≥1 — if it doesn't on real terrain, move the test site). Keep that behavior (a fishing village on a sliver is legal); the test asserts ≥1 plot only because its site guarantees it.

- [ ] **Step 4:** `node --test sim/test/settlements.test.js sim/test/suitability.test.js sim/test/groups.test.js sim/test/kernel.test.js` — ALL PASS.

- [ ] **Step 5: Commit:**
```bash
git add sim/society/settlements.js sim/test/settlements.test.js
git commit -m "feat(sim): P3 settlement founding — provenanced declaration with reason codes, territory, districts, plot ownership primitives

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: the P3 probe — founders score, found, deed, and connect two villages

**Files:**
- Create: `sim/test/probe-settlements.test.js`

- [ ] **Step 1: the probe** — header:

```js
// sim/test/probe-settlements.test.js — P3 probe: settlers pool time into a group;
// the group founds a village at the SCORED best site in the region (every reason
// verifiable against an independent rescore); plots are deeded to members; a second
// group founds a second village whose trade component is live (the first village is
// reachable) and builds a road between them (P2 machinery); overlap is refused;
// the whole history is deterministic.
```

Scenario — ONE `runScenario()` returning a summary, asserted deepEqual twice; individual test blocks may share helpers. Rect `{x0: 926, y0: 0, w: 28, h: 14}` (water + grass). Steps, every guard asserting:

1. Kernel A; boot TWO berry_bushes on land tiles in the rect + `materializeRect`. Two players `pick` (real verb) until each holds ≥400 tu; both `contribute` 400 to group ONE. Conservation checkpoint at tick 0: full identity (probe-roads form).
2. `findSettlementSite(k, rect)` → site1. Assert: site is land; independently rescore site1 and assert `deepEqual` with the returned reasons; assert site1's water component > 0 (the rect contains the river wedge — the argmax should be near water; if not, that is a real scoring outcome: assert instead that NO tile with water access scores higher, i.e. keep the argmax property assertion from suitability.test.js).
3. `foundSettlement(k, g1.id, site1, 0)` → village1. Assert: settlement_founded event actor g1, reasons attached and matching step 2's, districts cover territory exactly, ≥1 plot owned by g1, every created node id in the event targets.
4. `assignPlot` one plot to each contributing player. Assert owners changed + plot_assigned events.
5. Group TWO (funded the same real way, 400 tu) founds village2 at a site OUTSIDE village1's territory (use `findSettlementSite` over a sub-rect that excludes village1's territory; assert the chosen site's trade component is > 0 with `via === village1.id` — the live trade proof).
6. Connectivity (P2 consumption): group2 `buildRoad` from village2's site toward village1's site (both centers; if planRoute needs more funding, contribute more — keep the real chain). Assert road segments exist on the route and the road_built event references g2.
7. Overlap refusal: founding a third settlement inside village1's territory returns null with zero new events.
8. Conservation checkpoint: full identity at tick 0 (all steps at tick 0 — stocks discipline; the only flows are pick/contribute/buildRoad channel losses, all ledger-counted). Founding moved zero time: assert stocks unchanged across the two foundSettlement calls specifically (capture before/after each).
9. Determinism: `assert.deepEqual(runScenario(), runScenario())` — summary = {site1, site2, village reason objects, district rects, plot {rect, owner} lists sorted by x0/y0, road segment positions, event-type counts}.

Real APIs only (probe-roads.test.js is the style oracle — pickUntil helper, boot arrangements, identity form). No direct player.R assignment. Assertion strength may not be weakened.

- [ ] **Step 2:** `node --test sim/test/probe-settlements.test.js` — PASS. Regression: `node --test sim/test/settlements.test.js sim/test/suitability.test.js sim/test/probe-roads.test.js sim/test/roads.test.js sim/test/groups.test.js sim/test/routing.test.js`.

- [ ] **Step 3: Commit:**
```bash
git add sim/test/probe-settlements.test.js
git commit -m "test(sim): P3 probe — scored founding with verifiable reasons, deeded plots, live trade between two villages

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Close-out — full suite, deviations, roadmap

- [ ] **Step 1:** `npm test` in background (~8 min). Expected: all pass (258 pre-P3 + new).
- [ ] **Step 2:** Append `## Deviations (canonical)` to this doc (every divergence + why).
- [ ] **Step 3:** Roadmap P3 row → DONE with test count + note (fertility = declared climate signal, soil backlog; settlements sim-side only until P4; region/city tiers absent until P5 growth).
- [ ] **Step 4: Commit:**
```bash
git add docs/superpowers/plans/2026-06-12-pass2plus-roadmap.md docs/superpowers/plans/2026-06-12-pass3-p3-settlements.md
git commit -m "docs(sim): P3 settlements close-out — roadmap DONE, deviations recorded

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Out of scope (honest absences, declared)

- **Soil/fertility system**: fertility component is a declared climate-derived signal (moisture × heat band); world-compiler L7 soil model = backlog.
- **Population, growth, building construction**: P4 (buildings as group-paid labor on plots) and P5 (growth/decline). Founding compiles NO blueprints.
- **Region → city tiers**: settlements found as `tier:'village'`; higher tiers are P5 growth outcomes, never placed.
- **Markets/property animation**: plots are ownership *data shapes* only; Economy animates them later.
- **Wire**: settlements/plots do not cross the protocol until P4 puts buildings on screen.
- **Ports**: require coast + navigable water + trade rationale (world-compiler L11) — no navigation system exists; backlog.
- **Save/load**: settlement/plot nodes are runtime state (same backlog as paths/roads rehydration).

## Seams for later plans

- `settlement.attrs.districts` + plots are P4's building sites (hut blueprint = PLOT_W×PLOT_H footprint, deliberately matched).
- `assignPlot` is the ownership-transfer primitive Economy (V4) generalizes to trade/sale/inheritance.
- `scoreSite` reasons feed P5 growth decisions (expand toward what scored high) and Pass-6 History Generation (why this town is here — mineable rationale).
- Trade centrality + P2 `planRoute` give P5/P6 the connectivity graph for settlement networks.
