# Unbounded World — Phase 1: Unbind the Kernel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every `kernel.bounds` gate so the live simulation works wherever the player stands; regions get a deterministic lazy baseline exactly once; boot finds a land start area near the requested spawn instead of a blind rect.

**Architecture:** `kernel.bounds` dies (field, checkpoint meta, every decision gate). Statistical baselines become lazy: `ensureRegionBaseline(kernel, regionKey, tick)` creates the region's aggregate deterministically (pure f(seed, region)) on first attention, recorded in a persisted `kernel.touched` frontier set so it happens exactly once per region across saves. TierManager calls it before promotion. Boot replaces bounds/start rects with a deterministic outward search over the terrain oracle for a mostly-land start rect near `--spawn=x,y`.

**Spec:** `docs/superpowers/specs/2026-06-12-unbounded-generative-world-design.md` (Phase 1 section + "What dies" table).

**Tech Stack:** Node (ES modules), node:test, better-sqlite3. Sim test suite: `node --test "sim/test/*.test.js" "sim/test/*.test.mjs"` (~9 min, 321 tests green at start).

**Worktree:** per project rule, implement in a worktree (`git worktree add .worktrees/p1-unbind -b p1-unbind-kernel master`). All test commands run from the worktree root.

**Key invariants (do not break):**
- Determinism: same seed ⇒ same world, independent of visit order. `spawnRegionAggregate` is already pure f(seed, rx, ry) — never make it read materialization state.
- Provenance: every runtime node needs `causeEventId`; boot-scope nodes don't (`graph.boot()`).
- Checkpoint order: ledger before graph; `meta.tick` written LAST (commit marker).
- Conservation: aggregates created via `createAggregate` schedule their own `agg_step`.

---

### Task 1: `planRoute` accepts null bounds (cost-horizon only)

**Files:**
- Modify: `sim/world/routing.js:18-28, 61`
- Modify: `sim/world/roads.js:35`
- Modify: `sim/society/suitability.js:40-47, 53-62`
- Test: `sim/test/unbounded-routing.test.js` (create)

- [ ] **Step 1: Write the failing test**

```js
// sim/test/unbounded-routing.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRoute, tileCost } from '../world/routing.js';

// Find two nearby land tiles around an arbitrary far coordinate, deterministically.
function landPairNear(x0, y0) {
  let a = null;
  for (let y = y0; y < y0 + 200 && !a; y++) for (let x = x0; x < x0 + 200 && !a; x++) {
    if (tileCost(x, y) !== Infinity && tileCost(x + 3, y) !== Infinity
      && tileCost(x + 1, y) !== Infinity && tileCost(x + 2, y) !== Infinity) {
      a = { from: { x, y }, to: { x: x + 3, y } };
    }
  }
  return a;
}

test('planRoute with null bounds routes far from origin', () => {
  const pair = landPairNear(50_000, -50_000);
  assert.ok(pair, 'expected land within the 200x200 scan window at +50k,-50k');
  const route = planRoute(pair.from, pair.to, null);
  assert.ok(route, 'route exists with null bounds');
  assert.deepEqual(route[0], pair.from);
  assert.deepEqual(route[route.length - 1], pair.to);
});

test('planRoute null-bounds result matches a generous explicit bounds', () => {
  const pair = landPairNear(7_000, 7_000);
  assert.ok(pair);
  const b = { x0: 6_900, y0: 6_900, w: 500, h: 500 };
  assert.deepEqual(planRoute(pair.from, pair.to, null), planRoute(pair.from, pair.to, b));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test sim/test/unbounded-routing.test.js`
Expected: FAIL — `TypeError: Cannot read properties of null (reading 'x0')` (or route null).

- [ ] **Step 3: Make `inB` null-tolerant**

In `sim/world/routing.js`, replace line 27:

```js
  const inB = (x, y) => bounds == null
    || (x >= bounds.x0 && x < bounds.x0 + bounds.w && y >= bounds.y0 && y < bounds.y0 + bounds.h);
```

Update the JSDoc on `planRoute` (line 18): `inside `bounds` ({x0,y0,w,h}, or null = unbounded — the MAX_EXPLORE cost horizon is the only limit)`.

- [ ] **Step 4: Update the two callers that pass kernel/rect bounds**

`sim/world/roads.js:35` — change:

```js
  const route = planRoute(from, to, null, opts);
```

`sim/society/suitability.js` — `scoreSite`'s trade loop (line 45): change to

```js
    const route = planRoute({ x, y }, { x: n.x, y: n.y }, null);
```

and remove the now-unused `bounds` parameter from `scoreSite` (line 29 → `export function scoreSite(kernel, x, y)`), updating `findSettlementSite` (line 57) to `scoreSite(kernel, x, y)`. Grep for other `scoreSite(` callers and drop their bounds arg (settlements.js:39 is handled in Task 2; `sim/test/*suitability*`/`*settlement*` tests pass rects — drop the arg there too).

- [ ] **Step 5: Run tests**

Run: `node --test sim/test/unbounded-routing.test.js` → PASS.
Run the suite files that exercise routing/suitability: `node --test sim/test/*suitability* sim/test/*road* sim/test/*settlement*` (glob whatever exists; adjust names by `ls sim/test`). Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add sim/world/routing.js sim/world/roads.js sim/society/suitability.js sim/test/unbounded-routing.test.js sim/test/<touched tests>
git commit -m "feat(sim): P1 — planRoute accepts null bounds; cost horizon is the only limit"
```

---

### Task 2: Remove every bounds decision gate

**Files:**
- Modify: `sim/time/lifecycle.js:103-106`
- Modify: `sim/world/actions.js:323-325`
- Modify: `sim/world/crossings.js:49-52`
- Modify: `sim/society/growth.js:84, 92-94`
- Modify: `sim/society/settlements.js:18-44`
- Test: `sim/test/unbounded-gates.test.js` (create)

- [ ] **Step 1: Write the failing test**

```js
// sim/test/unbounded-gates.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { move } from '../world/actions.js';
import { foundSettlement } from '../society/settlements.js';
import { findSettlementSite } from '../society/suitability.js';
import { tileCost } from '../world/routing.js';

function landRectNear(x0, y0, w = 64, h = 64) {
  for (let oy = 0; oy < 4000; oy += h) {
    let land = 0;
    for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4)
      if (tileCost(x0 + x, y0 + oy + y) !== Infinity) land++;
    if (land / (Math.ceil(w / 4) * Math.ceil(h / 4)) >= 0.8) return { x0, y0: y0 + oy, w, h };
  }
  return null;
}

test('move, founding work 50k tiles from origin with no bounds', () => {
  const kernel = new Kernel({ seed: 42 });
  const rect = landRectNear(50_000, 50_000);
  assert.ok(rect, 'land rect found far from origin');
  let group, actor;
  kernel.graph.boot(() => {
    group = kernel.graph.createNode({ type: 'group', tick: 0, x: rect.x0, y: rect.y0, R: 1e6, attrs: { noFlux: true } });
    actor = kernel.graph.createNode({ type: 'player', tick: 0, x: rect.x0 + 2, y: rect.y0 + 2, R: 0, attrs: { noFlux: true } });
  });
  // founding via the suitability field, not bounds
  const site = findSettlementSite(kernel, rect);
  assert.ok(site, 'suitability finds a site in the far rect');
  const s = foundSettlement(kernel, group.id, site, 0);
  assert.ok(s, 'settlement founded far from origin');
  // movement unrestricted by extent (terrain may still refuse via walls — none here)
  assert.equal(move(kernel, actor.id, 1, 0, 1), true);
});
```

Note: `new Kernel({ seed: 42 })` — after Task 3 the constructor loses `bounds`; today it defaults to null, so this test is valid now.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test sim/test/unbounded-gates.test.js`
Expected: FAIL — `foundSettlement` returns null (line 38 requires bounds: `if (!b || ...) return null`).

- [ ] **Step 3: Delete the gates**

`sim/time/lifecycle.js` — in the `seed` handler, delete lines 103-106 (`const b = k.bounds; const inBounds = ...`) and the `if (inBounds) {` wrapper: the seeding block always runs (keep its body and the same-tick conservation comment intact, just unindent). Update the comment "seeds landing outside the world fail to establish" — delete it; seeds land anywhere (suitability of the tile governs survival via flux, not extent).

`sim/world/actions.js` — in `move`, delete lines 324-325 (`const b = kernel.bounds; if (b && ...) return false;`). Update the JSDoc: remove "or it exits bounds".

`sim/world/crossings.js` — delete lines 49-52 (the `if (kernel.bounds) {...}` block).

`sim/society/growth.js` — delete line 84 (`const b = kernel.bounds;`) and lines 93-94 (the `if (b && (...)) continue;` clause). Update the JSDoc: remove "out of bounds /".

`sim/society/settlements.js`:
- `territoryAround(x, y)` — no bounds clipping, the territory is always the full rect:

```js
/** TERRITORY_W×TERRITORY_H rect centered on (x,y). */
function territoryAround(x, y) {
  return {
    x0: x - Math.floor(TERRITORY_W / 2), y0: y - Math.floor(TERRITORY_H / 2),
    w: TERRITORY_W, h: TERRITORY_H,
  };
}
```

- `foundSettlement` — delete lines 37-38 (the `const b = kernel.bounds; if (!b || ...) return null;` gate); call `scoreSite(kernel, site.x, site.y)` (Task 1 signature) and `territoryAround(site.x, site.y)`. Update the JSDoc: refusals are now missing/non-group founder, water site, or territory overlap — gated by suitability + overlap only.

- [ ] **Step 4: Run tests**

Run: `node --test sim/test/unbounded-gates.test.js` → PASS.
Run the full sim suite: `node --test "sim/test/*.test.js" "sim/test/*.test.mjs"`. Existing tests that assert bounds *refusals* (e.g. settlement-outside-bounds returns null, move-at-edge refused, expansion-at-edge skipped) now fail — **update those tests to assert the new semantics** (operation succeeds; extent never refuses). Do not weaken non-bounds assertions.

- [ ] **Step 5: Commit**

```bash
git add sim/time/lifecycle.js sim/world/actions.js sim/world/crossings.js sim/society/growth.js sim/society/settlements.js sim/test/unbounded-gates.test.js sim/test/<updated tests>
git commit -m "feat(sim): P1 — extent never refuses: seed/move/found/expand/crossing bounds gates removed"
```

---

### Task 3: Kernel loses `bounds`; gains the `touched` frontier; lazy baseline in spawn.js

**Files:**
- Modify: `sim/kernel/kernel.js:17-20`
- Modify: `sim/world/spawn.js` (replace `spawnWorld` with `spawnStart` + `ensureRegionBaseline`)
- Modify: `sim/server/main.js:11-24` (compile fix only; full boot rework is Task 5)
- Test: `sim/test/lazy-baseline.test.js` (create)

- [ ] **Step 1: Write the failing test**

```js
// sim/test/lazy-baseline.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { ensureRegionBaseline } from '../world/spawn.js';
import { aggregateOf } from '../lod/aggregate.js';

test('ensureRegionBaseline creates a region aggregate exactly once', () => {
  const kernel = new Kernel({ seed: 42 });
  const key = '3000,-2000';                      // 48000,-32000 in tiles — far from origin
  ensureRegionBaseline(kernel, key, 0);
  const agg = aggregateOf(kernel, key);
  assert.ok(agg, 'aggregate exists after first ensure');
  const nodeCount = kernel.graph.nodes.size;
  ensureRegionBaseline(kernel, key, 100);        // second call: no-op
  assert.equal(kernel.graph.nodes.size, nodeCount);
  assert.ok(kernel.touched.has(key));
});

test('baseline is pure f(seed, region) — visit order does not matter', () => {
  const a = new Kernel({ seed: 7 }), b = new Kernel({ seed: 7 });
  ensureRegionBaseline(a, '10,10', 0); ensureRegionBaseline(a, '-10,-10', 0);
  ensureRegionBaseline(b, '-10,-10', 0); ensureRegionBaseline(b, '10,10', 0);
  for (const key of ['10,10', '-10,-10']) {
    const pa = aggregateOf(a, key)?.attrs.pops ?? null;
    const pb = aggregateOf(b, key)?.attrs.pops ?? null;
    assert.deepEqual(pa, pb, `pops identical for ${key} across visit orders`);
  }
});

test('different seeds give different worlds', () => {
  const a = new Kernel({ seed: 7 }), b = new Kernel({ seed: 8 });
  let differs = false;
  for (let i = 0; i < 20 && !differs; i++) {
    const key = `${i * 13},${-i * 7}`;
    ensureRegionBaseline(a, key, 0); ensureRegionBaseline(b, key, 0);
    const pa = JSON.stringify(aggregateOf(a, key)?.attrs.pops ?? null);
    const pb = JSON.stringify(aggregateOf(b, key)?.attrs.pops ?? null);
    if (pa !== pb) differs = true;
  }
  assert.ok(differs, 'some region differs between seeds');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test sim/test/lazy-baseline.test.js`
Expected: FAIL — `ensureRegionBaseline` is not exported.

- [ ] **Step 3: Kernel — drop bounds, add touched**

`sim/kernel/kernel.js:17-20`:

```js
  constructor({ seed, phi = 4 }) {
    this.seed = seed;
    this.tick = 0;
    this.touched = new Set();   // region keys whose deterministic baseline has materialized (exactly-once frontier)
```

(Constructor callers that pass `bounds` simply have it ignored as an unknown option — destructuring drops it; tests cleaned in Step 5.)

- [ ] **Step 4: spawn.js — lazy baseline + start spawning**

In `sim/world/spawn.js`: keep `DENSITY`, `START`, `spawnMeadow`, `spawnRegionAggregate` (add a `tick` param defaulting to `kernel.tick` and a `causeEventId = null` param, passed through to `createAggregate`):

```js
export function spawnRegionAggregate(kernel, rx, ry, w = REGION, h = REGION, tick = kernel.tick, causeEventId = null) {
  ...
  if (Object.keys(pops).length) createAggregate(kernel, `${rx},${ry}`, pops, tick, causeEventId);
}
```

Replace `spawnWorld` entirely with:

```js
/** Deterministic baseline for one region, exactly once per world (frontier-tracked).
 *  Pure f(seed, region): never reads sim state, so visit order cannot matter.
 *  Provenance: a 'genesis' ledger event — the chronicle's "this land was always alive". */
export function ensureRegionBaseline(kernel, regionKey, tick) {
  if (kernel.touched.has(regionKey)) return;
  kernel.touched.add(regionKey);
  const [rx, ry] = regionKey.split(',').map(Number);
  const evId = kernel.ledger.emit({ tick, type: 'genesis', attrs: { region: regionKey } });
  spawnRegionAggregate(kernel, rx, ry, REGION, REGION, tick, evId);
}

/** Boot-time start area: full individuals in every region overlapping `rect`
 *  (whole regions — the world has no edges to clip against). */
export function spawnStart(kernel, rect) {
  kernel.graph.boot(() => {
    const r0x = Math.floor(rect.x0 / REGION), r1x = Math.ceil((rect.x0 + rect.w) / REGION);
    const r0y = Math.floor(rect.y0 / REGION), r1y = Math.ceil((rect.y0 + rect.h) / REGION);
    for (let ry = r0y; ry < r1y; ry++) for (let rx = r0x; rx < r1x; rx++) {
      kernel.touched.add(`${rx},${ry}`);   // individuals ARE this region's baseline
      spawnMeadow(kernel, { x0: rx * REGION, y0: ry * REGION, w: REGION, h: REGION });
    }
  });
}
```

Update the file header comment: baseline is lazy and unbounded; densities unchanged.

- [ ] **Step 5: Fix compile breakage at call sites**

`sim/server/main.js` — `spawnWorld` import/use breaks. Interim fix (full rework in Task 5): replace the import with `spawnStart` and `spawnWorld(kernel, bounds, start)` with `spawnStart(kernel, start)`. `bootWorld`'s `bounds` option becomes unused — leave signature for Task 5.

Grep `spawnWorld` and `new Kernel(` across `sim/` and `sim/test/`: update tests that construct kernels with bounds or call `spawnWorld` — replace with `spawnStart` over the same start rect (and drop `bounds:` options). Tests asserting "aggregates exist across all bounds regions at boot" must flip to lazy semantics: aggregates appear via `ensureRegionBaseline`/TierManager (Task 4), not at boot.

- [ ] **Step 6: Run tests**

Run: `node --test sim/test/lazy-baseline.test.js` → PASS.
Run: full sim suite → PASS (after test updates).

- [ ] **Step 7: Commit**

```bash
git add sim/kernel/kernel.js sim/world/spawn.js sim/server/main.js sim/test/lazy-baseline.test.js sim/test/<updated tests>
git commit -m "feat(sim): P1 — kernel.bounds dies; lazy exactly-once region baseline (touched frontier)"
```

---

### Task 4: TierManager materializes baseline on attention

**Files:**
- Modify: `sim/lod/tiers.js:143-154`
- Test: `sim/test/lazy-baseline.test.js` (extend)

- [ ] **Step 1: Write the failing test (append to lazy-baseline.test.js)**

```js
import { TierManager } from '../lod/tiers.js';
import { REGION } from '../lod/aggregate.js';

test('attention anywhere materializes a living world (±50k tiles)', () => {
  const kernel = new Kernel({ seed: 42 });
  const tm = new TierManager(kernel);
  const center = { x: 50_000 * 1, y: -50_000 };
  tm.update([center], 0);
  // every region within ringR is touched; individuals exist near the center
  const near = kernel.graph.nodesNear(center.x, center.y, REGION * 2).filter(n => n.R != null);
  assert.ok(near.length > 0, `expected living entities near ${center.x},${center.y}, got 0`);
  // visit-order independence at the world level: a fresh kernel visiting elsewhere first
  const k2 = new Kernel({ seed: 42 });
  const tm2 = new TierManager(k2);
  tm2.update([{ x: 0, y: 0 }], 0);
  tm2.update([center], 0);
  const near2 = k2.graph.nodesNear(center.x, center.y, REGION * 2).filter(n => n.R != null);
  assert.equal(near2.length, near.length, 'same entities near center regardless of prior visits');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test sim/test/lazy-baseline.test.js`
Expected: new test FAILS — 0 entities (no aggregate exists in unvisited regions; TierManager only promotes existing aggregates).

- [ ] **Step 3: Hook the baseline into promotion**

`sim/lod/tiers.js` — import at top:

```js
import { ensureRegionBaseline } from '../world/spawn.js';
```

(spawn.js does not import tiers.js — no cycle.)

In `update()`, inside the promote loop (line 149-151), before the promote:

```js
          const key = `${rx},${ry}`;
          ensureRegionBaseline(this.kernel, key, tick);   // first attention: deterministic genesis
          if (aggregateOf(this.kernel, key)) promoteRegion(this.kernel, key, tick);
          this.tiers.set(key, 'procedural');              // label refined below
```

Note the doc comment on the class: add a line — "Regions get their deterministic baseline on first attention (`ensureRegionBaseline`); the frontier set makes it exactly-once, so demoted-then-revisited regions resume their own history, never a fresh baseline."

- [ ] **Step 4: Run tests**

Run: `node --test sim/test/lazy-baseline.test.js` → PASS.
Run: full sim suite → PASS.

- [ ] **Step 5: Commit**

```bash
git add sim/lod/tiers.js sim/test/lazy-baseline.test.js
git commit -m "feat(sim): P1 — attention materializes deterministic baseline; world exists wherever you look"
```

---

### Task 5: Checkpoint persists the frontier, drops bounds; boot finds land

**Files:**
- Modify: `sim/store/checkpoint.js:22, 32-37`
- Modify: `sim/world/spawn.js` (add `findLandStart`)
- Modify: `sim/server/main.js`
- Test: `sim/test/unbounded-boot.test.js` (create)

- [ ] **Step 1: Write the failing test**

```js
// sim/test/unbounded-boot.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { openDb } from '../store/db.js';
import { checkpoint, loadKernel } from '../store/checkpoint.js';
import { findLandStart, ensureRegionBaseline } from '../world/spawn.js';
import { findSettlementSite } from '../society/suitability.js';
import { tileCost } from '../world/routing.js';
import { bootWorld } from '../server/main.js';

test('checkpoint round-trips the touched frontier (no bounds meta)', () => {
  const db = openDb(':memory:');
  const kernel = new Kernel({ seed: 42 });
  ensureRegionBaseline(kernel, '100,100', 0);
  ensureRegionBaseline(kernel, '-5,7', 0);
  checkpoint(kernel, db);
  const loaded = loadKernel(db);
  assert.deepEqual([...loaded.touched].sort(), [...kernel.touched].sort());
  assert.equal(db.prepare('SELECT value FROM meta WHERE key=?').get('bounds'), undefined);
});

test('ocean-spawn regression: old default coords resolve to a land start with positive suitability', () => {
  // Old default world was bounds 0,0,320,320 — entirely ocean (user-verified 2026-06-12).
  const start = findLandStart({ x: 0, y: 0 });
  assert.ok(start, 'land start found near 0,0');
  let land = 0, total = 0;
  for (let y = start.y0; y < start.y0 + start.h; y++) for (let x = start.x0; x < start.x0 + start.w; x++) {
    total++; if (tileCost(x, y) !== Infinity) land++;
  }
  assert.ok(land / total >= 0.6, `start rect is mostly land (${(land / total).toFixed(2)})`);
  const kernel = new Kernel({ seed: 42 });
  const site = findSettlementSite(kernel, start);
  assert.ok(site && site.score > 0, 'positive suitability inside the start rect');
});

test('findLandStart is deterministic', () => {
  assert.deepEqual(findLandStart({ x: 12345, y: -9876 }), findLandStart({ x: 12345, y: -9876 }));
});

test('bootWorld boots a fresh unbounded world on land', () => {
  const db = openDb(':memory:');
  const kernel = bootWorld(db, { seed: 42, spawn: { x: 0, y: 0 } });
  assert.ok(kernel.graph.nodes.size > 0, 'start area spawned individuals');
  const anyLiving = [...kernel.graph.nodes.values()].find(n => n.R != null && n.x != null);
  assert.ok(anyLiving, 'living entity exists');
  assert.notEqual(tileCost(Math.floor(anyLiving.x), Math.floor(anyLiving.y)), Infinity, 'on land, not ocean');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test sim/test/unbounded-boot.test.js`
Expected: FAIL — `findLandStart` not exported; checkpoint still writes bounds (and reads `kernel.bounds` = undefined → writes `undefined`, which would also throw or store garbage).

- [ ] **Step 3: checkpoint.js**

Replace line 22 (`meta.run('bounds', ...)`) with:

```js
    meta.run('touched', JSON.stringify([...kernel.touched]));
```

In `loadKernel` (lines 32-36): construct without bounds and restore the frontier:

```js
  const kernel = new Kernel({
    seed: Number(get('seed')),
    phi: Number(get('phi')),
  });
  kernel.touched = new Set(JSON.parse(get('touched') ?? '[]'));
  kernel.tick = Number(get('tick'));
```

(Legacy worlds with a `bounds` meta row load fine — the row is simply never read. Known cost: `touched` grows with exploration; one region key ≈ 10 bytes — 100k explored regions ≈ 1 MB of meta. Acceptable for P1; revisit if it ever shows in checkpoint timing.)

- [ ] **Step 4: `findLandStart` in spawn.js**

```js
import { tileCost } from './routing.js';
```

```js
/** Deterministic outward region-ring search for a mostly-land start rect near `spawn`.
 *  Pure f(terrain, spawn) — no kernel, no RNG. Samples every 4th tile (land fraction
 *  estimate, not a census). Returns {x0,y0,w,h} or null (refuse honestly: no land
 *  within maxRings regions — caller decides what to do, never a silent ocean boot). */
export function findLandStart(spawn, { w = 48, h = 32, minLand = 0.8, maxRings = 256 } = {}) {
  const cx = Math.floor(spawn.x / REGION), cy = Math.floor(spawn.y / REGION);
  const samples = Math.ceil(w / 4) * Math.ceil(h / 4);
  for (let r = 0; r <= maxRings; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;   // ring only, deterministic order
      const x0 = (cx + dx) * REGION, y0 = (cy + dy) * REGION;
      let land = 0;
      for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4)
        if (tileCost(x0 + x, y0 + y) !== Infinity) land++;
      if (land / samples >= minLand) return { x0, y0, w, h };
    }
  }
  return null;
}
```

- [ ] **Step 5: main.js boot rework**

```js
import { spawnStart, findLandStart } from '../world/spawn.js';
```

```js
/** Open-or-create: a db with a saved tick resumes; an empty one gets a land start near `spawn`. */
export function bootWorld(db, { seed, spawn = { x: 0, y: 0 }, phi = 4 }) {
  const saved = db.prepare('SELECT value FROM meta WHERE key=?').get('tick');
  let kernel;
  if (saved != null) {
    kernel = loadKernel(db);
  } else {
    kernel = new Kernel({ seed, phi });
    const start = findLandStart(spawn);
    if (!start) throw new Error(`no land within ${256 * 16} tiles of spawn ${spawn.x},${spawn.y} — refuse to boot in the ocean`);
    spawnStart(kernel, start);
    kernel.graph.boot(() => materializeRect(kernel, start, 0));
    checkpoint(kernel, db);          // birth certificate: baseline is durable immediately
  }
  initItemIdFromKernel(kernel);
  return kernel;
}
```

CLI block: delete the `rect` helper and `--bounds`/`--start` args; add `--spawn`:

```js
  const [sx, sy] = arg('spawn', '0,0').split(',').map(Number);
  const kernel = bootWorld(db, { seed: Number(arg('seed', '42')), spawn: { x: sx, y: sy } });
```

Also log the start so the user knows where to point the client: after boot, find any positioned living node and print, or simpler — recompute `findLandStart` only on fresh boot and log it there. Cleanest: inside the `else` branch add `console.log(`sim: start area ${start.x0},${start.y0} ${start.w}x${start.h}`);`.

- [ ] **Step 6: Run tests**

Run: `node --test sim/test/unbounded-boot.test.js` → PASS.
Run: full sim suite → PASS (update any tests calling `bootWorld` with bounds/start options to the new `{seed, spawn}` shape).

- [ ] **Step 7: Commit**

```bash
git add sim/store/checkpoint.js sim/world/spawn.js sim/server/main.js sim/test/unbounded-boot.test.js sim/test/<updated tests>
git commit -m "feat(sim): P1 — boot lands by suitability search; checkpoint persists frontier, never extent"
```

---

### Task 6: Sweep — no `bounds` references remain in sim decision logic

**Files:**
- Modify: whatever the grep finds
- Test: full suite

- [ ] **Step 1: Grep for stragglers**

Run: `grep -rn "kernel.bounds\|k.bounds\|\.bounds" sim/ --include="*.js"` (use the Grep tool). Every remaining hit must be either (a) a non-kernel `bounds` (e.g. viewport rects in wire/server — these are *attention* geometry, not world extent — leave them), or (b) dead code/comments to delete. There must be ZERO reads of a kernel-level world extent.

- [ ] **Step 2: Run the FULL sim suite**

Run: `node --test "sim/test/*.test.js" "sim/test/*.test.mjs"` (~9 min)
Expected: all green (321+ new tests).

- [ ] **Step 3: Run the client suite (renderer untouched, but verify)**

Run: `node --test "test/**/*.test.mjs" "test/**/*.test.js"`
Expected: 67/67 PASS.

- [ ] **Step 4: Commit (if anything changed)**

```bash
git add <files>
git commit -m "chore(sim): P1 — bounds sweep; only viewport/attention rects remain"
```

---

### Task 7: Headless probe — the world is everywhere

**Files:**
- Create: `sim/test/probe-unbounded.mjs` (a script, not a node:test file — keeps the 9-min suite lean; run manually/CI)

- [ ] **Step 1: Write the probe**

```js
// sim/test/probe-unbounded.mjs — continuous-testability probe (spec: Phase 1 verification).
// Boots a fresh in-memory world, then drags attention to three uncorrelated far
// coordinates (±50k tiles) and reports living-entity counts near each. Exit 1 on any zero.
import { openDb } from '../store/db.js';
import { bootWorld } from '../server/main.js';
import { TierManager } from '../lod/tiers.js';
import { REGION } from '../lod/aggregate.js';

const db = openDb(':memory:');
const kernel = bootWorld(db, { seed: 42, spawn: { x: 0, y: 0 } });
const tm = new TierManager(kernel);
const stops = [{ x: 50_000, y: 50_000 }, { x: -48_123, y: 31_337 }, { x: 7_712, y: -224 }];
let ok = true;
for (const c of stops) {
  tm.update([c], kernel.tick);
  const living = kernel.graph.nodesNear(c.x, c.y, REGION * 3).filter(n => n.R != null);
  const aggs = [...kernel.graph.nodes.values()].filter(n => n.type === 'aggregate').length;
  console.log(`probe ${c.x},${c.y}: living near=${living.length} aggregates(world)=${aggs} touched=${kernel.touched.size}`);
  if (living.length === 0) { console.error(`  FAIL: no world at ${c.x},${c.y}`); ok = false; }
}
process.exit(ok ? 0 : 1);
```

Note: some far stops may be deep ocean — living entities there are legitimately ~0 only if the DENSITY baseline is biome-blind... it is biome-blind today (P1 keeps it; biome-aware densities are Phase 2+ genesis). So counts must be > 0 everywhere. If a stop reports 0, that is a real bug (frontier or promotion).

- [ ] **Step 2: Run the probe**

Run: `node sim/test/probe-unbounded.mjs`
Expected: three lines, all `living near > 0`, exit 0.

- [ ] **Step 3: Commit**

```bash
git add sim/test/probe-unbounded.mjs
git commit -m "test(sim): P1 probe — attention at three far coordinates finds a living world"
```

---

### Task 8: Merge + restart the live sim on a land world (controller does this, not a subagent)

- [ ] Merge worktree branch to master (tests green; use finishing-a-development-branch).
- [ ] Kill the running sim (background task blg46dwc5 — it serves the old all-ocean `worlds/dev.db`).
- [ ] Start fresh: `node sim/server/main.js --world=worlds/main.db --seed=42 --port=8787` (new db file; the ocean dev.db is left untouched as an artifact). Note the logged start area; tell the user the client URL `http://localhost:8123/?x=<x0>&y=<y0>`.
- [ ] Verify via the client wire or probe that entities stream at the start area.

---

## Self-review notes

- Spec coverage: all 10 "What dies" rows are covered — kernel.js (T3), main.js (T5), spawn.js (T3/T5), lifecycle.js (T2), settlements.js (T2), growth.js (T2), routing.js (T1), crossings.js (T2), actions.js (T2), checkpoint.js (T5). Ocean regression test (T5), visit-order determinism (T3/T4), far-coordinate ops (T2), ±50k probe (T7).
- `scoreSite` signature change (drop bounds) ripples to settlements.js and tests — handled in T1 step 4 and T2.
- Demote-then-revisit correctness: frontier prevents double baseline; demoted aggregate carries the region's real history. A region whose individuals all died demotes to nothing and stays empty — honest (its history consumed it).
- Phase boundaries respected: no settlement genesis, no biome-aware densities, no chronicle — Phase 2/3 only.
