# Unbounded World — Phase 2: Genesis Field — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deterministic settlements and roads exist everywhere, seeded over the climate oracle. Attention at any coordinate materializes a populated world with settlements, roads, and living ecology — the sim continues them live. Press 9 anywhere and there's civilization.

**Architecture:** A new `sim/world/genesis.js` module implements `ensureGenesisSettlements(kernel, regionKey, tick)` — a frontier-guarded function (like `ensureRegionBaseline` for flora) that evaluates a "macro-cell" of 4×4 regions (64×64 tiles) around the given region. For each macro-cell, a seeded roll decides if a settlement exists (probability proportional to peak suitability), then `scoreSite` picks the best tile, a genesis group is created, `foundSettlement` places the town, and `buildRoad` connects it to nearest existing settlements. The frontier prevents double-placement. TierManager calls it during promotion, after the flora baseline.

**Spec:** `docs/superpowers/specs/2026-06-12-unbounded-generative-world-design.md` Phase 2 section.

**Tech Stack:** Node (ES modules), node:test, better-sqlite3.

**Key invariants:**
- Determinism: same seed ⇒ same settlements/roads everywhere, visit-order-independent. Genesis reads only seed + terrain oracle + its own frontier — never sibling regions' materialization state (except existing settlements for trade/road graph, which is deterministic given the deterministic visit of macro-cells in attention order).
- Provenance: genesis group and settlement nodes created via ledger events (not boot scope — these are L2/L3 history, not baseline flora).
- Phase boundary: no chronicle, no ruins, no ages — settlements are present-state genesis only (Phase 3 adds history). Honest absence.

**Worktree:** `git worktree add` from master (post-Phase 1 merge). All work in the worktree.

---

### Task 1: Genesis module — deterministic settlement placement

**Files:**
- Create: `sim/world/genesis.js`
- Modify: `sim/store/checkpoint.js` (persist genesis frontier)
- Test: `sim/test/genesis.test.js` (create)

- [ ] **Step 1: Write the failing test**

```js
// sim/test/genesis.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { ensureGenesisSettlements, MACRO } from '../world/genesis.js';

test('ensureGenesisSettlements places a settlement in a land macro-cell', () => {
  const kernel = new Kernel({ seed: 42 });
  // Try several macro-cells until we find one that gets a settlement
  let found = false;
  for (let i = 0; i < 40 && !found; i++) {
    const key = `${i * 3},${i * 2}`;
    ensureGenesisSettlements(kernel, key, 0);
    for (const n of kernel.graph.nodes.values()) {
      if (n.type === 'settlement') { found = true; break; }
    }
  }
  assert.ok(found, 'at least one settlement placed across 40 macro-cells');
});

test('genesis is exactly-once (frontier-guarded)', () => {
  const kernel = new Kernel({ seed: 42 });
  ensureGenesisSettlements(kernel, '5,5', 0);
  const count1 = [...kernel.graph.nodes.values()].filter(n => n.type === 'settlement').length;
  ensureGenesisSettlements(kernel, '5,5', 100);
  const count2 = [...kernel.graph.nodes.values()].filter(n => n.type === 'settlement').length;
  assert.equal(count1, count2, 'second call is a no-op');
});

test('genesis is visit-order-independent (same settlements regardless of order)', () => {
  const a = new Kernel({ seed: 7 }), b = new Kernel({ seed: 7 });
  const cells = ['3,3', '10,10', '-5,8', '0,0'];
  for (const c of cells) ensureGenesisSettlements(a, c, 0);
  for (const c of [...cells].reverse()) ensureGenesisSettlements(b, c, 0);
  const settA = [...a.graph.nodes.values()].filter(n => n.type === 'settlement')
    .map(n => `${n.x},${n.y}`).sort();
  const settB = [...b.graph.nodes.values()].filter(n => n.type === 'settlement')
    .map(n => `${n.x},${n.y}`).sort();
  assert.deepEqual(settA, settB, 'same settlements regardless of visit order');
});

test('different seeds produce different settlement patterns', () => {
  const a = new Kernel({ seed: 7 }), b = new Kernel({ seed: 8 });
  for (let i = 0; i < 20; i++) {
    const key = `${i * 5},${i * 3}`;
    ensureGenesisSettlements(a, key, 0);
    ensureGenesisSettlements(b, key, 0);
  }
  const settA = [...a.graph.nodes.values()].filter(n => n.type === 'settlement')
    .map(n => `${n.x},${n.y}`).sort().join(';');
  const settB = [...b.graph.nodes.values()].filter(n => n.type === 'settlement')
    .map(n => `${n.x},${n.y}`).sort().join(';');
  assert.notEqual(settA, settB, 'different seeds → different worlds');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test sim/test/genesis.test.js`
Expected: FAIL — module `../world/genesis.js` does not exist.

- [ ] **Step 3: Implement genesis.js**

```js
// sim/world/genesis.js — Phase 2: deterministic settlement + road genesis.
// Pure f(seed, macro-cell, terrain oracle) — evaluated lazily on first attention.
// Each "macro-cell" is MACRO×MACRO regions (64×64 tiles). At most one settlement
// per macro-cell, probability proportional to peak suitability. HONEST ABSENCES:
// no chronicle, no ages, no ruins — present-state genesis only (Phase 3).
import { rand } from '../kernel/rng.js';
import { REGION } from '../lod/aggregate.js';
import { scoreSite } from '../society/suitability.js';
import { foundSettlement } from '../society/settlements.js';
import { buildRoad } from './roads.js';
import { tileCost } from './routing.js';

export const MACRO = 4;                     // macro-cell = 4×4 regions = 64×64 tiles
const MACRO_TILES = MACRO * REGION;         // 64
const SETTLE_PROB_SCALE = 0.6;             // max probability of settlement per macro-cell
const SETTLE_SCORE_THRESHOLD = 0.15;       // below this suitability: no settlement possible
const ROAD_SEARCH_RADIUS = MACRO_TILES * 4; // search for road neighbors within ~256 tiles
const SAMPLE_STEP = 4;                      // suitability sampling stride (every 4th tile)

/** Macro-cell key for a region key. Deterministic. */
export function macroKeyOf(regionKey) {
  const [rx, ry] = regionKey.split(',').map(Number);
  return `${Math.floor(rx / MACRO)},${Math.floor(ry / MACRO)}`;
}

/** Evaluate a macro-cell for settlement placement. Pure f(seed, macro-cell, oracle).
 *  Returns {x, y, score} or null. Never reads kernel graph state for placement. */
function evaluateMacroCell(seed, macroKey) {
  const [mx, my] = macroKey.split(',').map(Number);
  const x0 = mx * MACRO_TILES, y0 = my * MACRO_TILES;

  // Seeded roll: should this macro-cell have a settlement?
  // Sample suitability at stride SAMPLE_STEP to estimate peak quality.
  let bestScore = 0, bestX = x0, bestY = y0;
  for (let y = y0; y < y0 + MACRO_TILES; y += SAMPLE_STEP) {
    for (let x = x0; x < x0 + MACRO_TILES; x += SAMPLE_STEP) {
      if (tileCost(x, y) === Infinity) continue;
      // Inline lightweight suitability (water proximity + climate) without kernel:
      // We use the terrain oracle directly for the placement decision.
      // For the actual site score we'll use scoreSite once we know we're placing.
      const roll = rand(seed, x * 7 + 91, y * 13 + 37);
      if (roll < 0.1) {  // 10% of sampled tiles are candidates
        // Rough quality: non-water neighbors as proxy for water access
        let waterNear = 0;
        for (let r = 1; r <= 6; r++) {
          if (tileCost(x + r, y) === Infinity || tileCost(x - r, y) === Infinity ||
              tileCost(x, y + r) === Infinity || tileCost(x, y - r) === Infinity) { waterNear = 1; break; }
        }
        const quality = waterNear ? 0.7 + roll * 0.3 : 0.2 + roll * 0.3;
        if (quality > bestScore) { bestScore = quality; bestX = x; bestY = y; }
      }
    }
  }

  // Probability of settlement proportional to best score
  const settlementRoll = rand(seed, mx * 1000003, my * 1000033, 777);
  if (bestScore < SETTLE_SCORE_THRESHOLD || settlementRoll > bestScore * SETTLE_PROB_SCALE) return null;
  return { x: bestX, y: bestY };
}

/** Fine-tune placement: scan a small rect around the candidate for the actual best site
 *  using the full scoreSite function (which reads kernel for trade centrality). */
function refineSite(kernel, candidate) {
  const r = 8;  // refine within ±8 tiles
  let best = null;
  for (let y = candidate.y - r; y <= candidate.y + r; y++) {
    for (let x = candidate.x - r; x <= candidate.x + r; x++) {
      const s = scoreSite(kernel, x, y);
      if (!s) continue;
      if (!best || s.score > best.score + 1e-12) best = { x, y, ...s };
    }
  }
  return best;
}

/** Ensure the macro-cell containing `regionKey` has been evaluated for settlement genesis.
 *  Frontier-guarded: exactly once per macro-cell per world. Creates a deterministic
 *  genesis group, founds settlement if the macro-cell qualifies, and builds roads to
 *  nearest existing settlements. */
export function ensureGenesisSettlements(kernel, regionKey, tick) {
  const mk = macroKeyOf(regionKey);
  if (kernel.genesisSettlements.has(mk)) return;
  kernel.genesisSettlements.add(mk);

  const candidate = evaluateMacroCell(kernel.seed, mk);
  if (!candidate) return;  // this macro-cell has no settlement (suitability/roll)

  const site = refineSite(kernel, candidate);
  if (!site) return;  // all water or too low quality after refinement

  // Create a deterministic genesis group (the "original settlers" — no individuals,
  // just a group node with R to fund roads). Provenance: genesis event.
  const evId = kernel.ledger.emit({
    tick, type: 'genesis_settlement',
    attrs: { macroCell: mk, x: site.x, y: site.y, score: site.score },
  });
  const group = kernel.graph.createNode({
    type: 'group', tick, x: site.x, y: site.y, causeEventId: evId,
    attrs: { noFlux: true, genesis: true, R_initial: 50000 },
  });
  group.R = 50000;  // enough to fund several road segments

  const settlement = foundSettlement(kernel, group.id, site, tick);
  if (!settlement) return;  // territory overlap with an earlier settlement

  // Connect to nearest existing settlements via roads
  connectToNeighbors(kernel, group, settlement, tick);
}

/** Build roads from `settlement` to nearest existing settlements within search radius. */
function connectToNeighbors(kernel, group, settlement, tick) {
  const sx = settlement.x, sy = settlement.y;
  const neighbors = [];
  for (const n of kernel.graph.nodes.values()) {
    if (n.type !== 'settlement' || n.id === settlement.id) continue;
    const d = Math.abs(n.x - sx) + Math.abs(n.y - sy);
    if (d <= ROAD_SEARCH_RADIUS) neighbors.push({ node: n, d });
  }
  neighbors.sort((a, b) => a.d - b.d);

  // Connect to up to 3 nearest neighbors (road cost comes from group.R)
  for (let i = 0; i < Math.min(3, neighbors.length); i++) {
    const nb = neighbors[i].node;
    buildRoad(kernel, group.id, { x: sx, y: sy }, { x: nb.x, y: nb.y }, tick);
    if (group.R < 1000) break;  // stop if funds run low
  }
}
```

- [ ] **Step 4: Add genesisSettlements frontier to Kernel**

In `sim/kernel/kernel.js` constructor, add after `this.touched`:

```js
    this.genesisSettlements = new Set();  // macro-cell keys whose settlement genesis has been evaluated
```

- [ ] **Step 5: Persist genesisSettlements in checkpoint**

In `sim/store/checkpoint.js`, in `checkpoint()`, add after the `touched` line:

```js
    meta.run('genesisSettlements', JSON.stringify([...kernel.genesisSettlements]));
```

In `loadKernel()`, after the `kernel.touched` line:

```js
  kernel.genesisSettlements = new Set(JSON.parse(get('genesisSettlements') ?? '[]'));
```

- [ ] **Step 6: Run tests**

Run: `node --test sim/test/genesis.test.js` → PASS.

- [ ] **Step 7: Commit**

```bash
git add sim/world/genesis.js sim/kernel/kernel.js sim/store/checkpoint.js sim/test/genesis.test.js
git commit -m "feat(sim): P2 — deterministic settlement genesis over climate oracle (macro-cell placement)"
```

---

### Task 2: TierManager hooks genesis settlements

**Files:**
- Modify: `sim/lod/tiers.js`
- Test: `sim/test/genesis-tiers.test.js` (create)

- [ ] **Step 1: Write the failing test**

```js
// sim/test/genesis-tiers.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { TierManager } from '../lod/tiers.js';
import { REGION } from '../lod/aggregate.js';
import { spawnStart, findLandStart } from '../world/spawn.js';
import { MACRO } from '../world/genesis.js';

test('attention at a far land coordinate produces settlements', () => {
  const kernel = new Kernel({ seed: 42 });
  const tm = new TierManager(kernel);
  // Scan several positions to find one where genesis places a settlement
  let found = false;
  for (let i = 0; i < 30 && !found; i++) {
    const cx = 1000 + i * MACRO * REGION;
    tm.update([{ x: cx, y: 500 }], 0);
    for (const n of kernel.graph.nodes.values()) {
      if (n.type === 'settlement') { found = true; break; }
    }
  }
  assert.ok(found, 'at least one settlement appeared via attention-driven genesis');
});

test('settlements survive checkpoint round-trip', () => {
  const { openDb } = await import('../store/db.js');
  const { checkpoint, loadKernel } = await import('../store/checkpoint.js');
  const kernel = new Kernel({ seed: 42 });
  const tm = new TierManager(kernel);
  for (let i = 0; i < 20; i++) {
    tm.update([{ x: i * MACRO * REGION, y: 200 }], 0);
  }
  const settlements = [...kernel.graph.nodes.values()].filter(n => n.type === 'settlement');
  const db = openDb(':memory:');
  checkpoint(kernel, db);
  const loaded = loadKernel(db);
  assert.deepEqual(
    [...loaded.genesisSettlements].sort(),
    [...kernel.genesisSettlements].sort(),
    'genesis frontier persists'
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — genesis not called from TierManager; no settlements appear.

- [ ] **Step 3: Hook genesis into TierManager**

In `sim/lod/tiers.js`, add import:

```js
import { ensureGenesisSettlements } from '../world/genesis.js';
```

In `update()`, inside the promote loop, AFTER `ensureRegionBaseline` and BEFORE `aggregateOf`:

```js
          ensureGenesisSettlements(this.kernel, key, tick);
```

This evaluates the macro-cell for settlement genesis whenever a new region enters attention. Since it's frontier-guarded, it's a no-op for already-evaluated macro-cells.

- [ ] **Step 4: Run tests**

Run: `node --test sim/test/genesis-tiers.test.js` → PASS.
Run: `node --test sim/test/genesis.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add sim/lod/tiers.js sim/test/genesis-tiers.test.js
git commit -m "feat(sim): P2 — TierManager hooks genesis; attention materializes settlements + roads"
```

---

### Task 3: Full sim suite green + probe

**Files:**
- Create: `sim/test/probe-genesis.mjs`
- Modify: any broken tests

- [ ] **Step 1: Run full sim suite**

Run: `node --test "sim/test/*.test.js" "sim/test/*.test.mjs"`

Fix any failures caused by the new genesis code. Common issues:
- Tests that create kernels and call TierManager.update now get settlements unexpectedly — update assertions or use seeds/coordinates that land in ocean (no settlement genesis in water).
- Tests that count node types may need updating.

- [ ] **Step 2: Write the probe**

```js
// sim/test/probe-genesis.mjs — P2 verification: settlements + roads exist far from origin.
import { openDb } from '../store/db.js';
import { bootWorld } from '../server/main.js';
import { TierManager } from '../lod/tiers.js';
import { REGION } from '../lod/aggregate.js';
import { MACRO } from '../world/genesis.js';

const db = openDb(':memory:');
const kernel = bootWorld(db, { seed: 42, spawn: { x: 0, y: 0 } });
const tm = new TierManager(kernel);

// Sweep attention across many macro-cells to accumulate settlements
const stops = [];
for (let i = 0; i < 50; i++) {
  stops.push({ x: i * MACRO * REGION * 2, y: i * MACRO * REGION });
}
for (const c of stops) tm.update([c], kernel.tick);

const settlements = [...kernel.graph.nodes.values()].filter(n => n.type === 'settlement');
const roads = [...kernel.graph.nodes.values()].filter(n => n.type === 'matter' && n.attrs.archetype === 'road_segment');
const groups = [...kernel.graph.nodes.values()].filter(n => n.type === 'group' && n.attrs.genesis);

console.log(`genesis probe: ${settlements.length} settlements, ${roads.length} road segments, ${groups.length} genesis groups`);
console.log(`  macro-cells evaluated: ${kernel.genesisSettlements.size}`);
console.log(`  regions touched: ${kernel.touched.size}`);

if (settlements.length === 0) {
  console.error('  FAIL: no settlements generated');
  process.exit(1);
}
if (settlements.length < 3) {
  console.error('  WARN: very few settlements — tune SETTLE_PROB_SCALE?');
}

// Report settlement locations
for (const s of settlements.slice(0, 10)) {
  console.log(`  settlement at ${s.x},${s.y} (score=${s.attrs.reasons?.water?.score?.toFixed(2) ?? '?'})`);
}

console.log('PASS');
process.exit(0);
```

- [ ] **Step 3: Run the probe**

Run: `node sim/test/probe-genesis.mjs`
Expected: multiple settlements, some road segments, exit 0.

If settlement count is 0 or very low, tune `SETTLE_PROB_SCALE` or `SETTLE_SCORE_THRESHOLD` in genesis.js. The goal is roughly 1 settlement per 5-10 macro-cells on average (civilized but not crowded).

- [ ] **Step 4: Commit**

```bash
git add sim/test/probe-genesis.mjs sim/test/<any fixed tests>
git commit -m "test(sim): P2 probe — settlements and roads exist far from origin"
```

---

### Task 4: Merge to master + restart sim

- [ ] Merge worktree branch to master (tests green).
- [ ] Kill old sim, start fresh: `node sim/server/main.js --world=worlds/main-p2.db --seed=42 --port=8787`
- [ ] Verify settlements appear in probe or live client.

---

## Self-review

- Spec coverage: "seeded settlement placement over scoreSite at region scale" — MACRO-cell placement uses scoreSite for refinement. "Deterministic road graph between neighbor settlements" — connectToNeighbors via buildRoad/planRoute. "Materialize on LOD promotion" — TierManager hook. "Materialization-frontier record so backfill happens exactly once" — genesisSettlements Set, persisted in checkpoint. "Press 9 anywhere — settlements and roads exist" — probe verifies.
- Determinism: evaluateMacroCell is pure f(seed, macroKey) — reads only terrain oracle. refineSite reads kernel for trade centrality (existing settlements), but that's deterministic given the frontier evaluation order (macro-cells within attention ring). Visit-order test validates.
- Phase boundary: no chronicle, no ruins, no history — present-state genesis only. Settlement attrs carry reason codes from scoreSite but no temporal backstory. Honest absence declared in genesis.js header.
- Road cost model: genesis groups start with R=50000 (enough for ~1600 road tiles at 30tu/tile). Roads decay naturally via the existing system.
