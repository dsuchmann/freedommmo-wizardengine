# Building Relocation (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Buildings whose chosen site is over water or a cliff **relocate to the nearest valid site and always spawn** (honest-absence only when truly stranded), and the `9` debug overlay shows the **same resolved set** that actually spawns — so it stops showing "ghost" buildings that never exist.

**Architecture:** Relocation lives in `settlementCandidates()` in `resolved-buildings.js` — the per-settlement, **memoized, range-independent** stage — as a deterministic outward spiral that tests only terrain (a pure field) plus the settlement's own buildings (an intra-settlement occupancy set). The cross-settlement de-overlap in `resolveBuildingsInRange()` is untouched and still resolves any residual overlaps (first-writer-wins). The `9` overlay (`sim-debug-overlay.js`) stops running its own divergent water-only filter and instead draws `resolveBuildingsInRange(...).buildings`.

**Tech Stack:** Vanilla ES modules, `node:test` + `node:assert/strict`. Pure deterministic generation (no Date.now/Math.random). Terrain classifiers `classifyBiomeNoStream` / `classifyTerrainForm`.

---

## File Structure

- **Modify:** `sim/world/buildings/resolved-buildings.js` — export the two suppression predicates; add `relocateBuilding()` + `MAX_RELOCATE_RADIUS`; rewrite `settlementCandidates()` to relocate-instead-of-drop (two-pass, order-preserving, intra-settlement occupancy).
- **Modify:** `src/render/sim-debug-overlay.js` — draw the resolved set instead of a self-computed, differently-filtered layout; keep per-settlement spines/districts.
- **Create:** `sim/test/buildings-relocation.test.js` — unit + integration tests for relocation.

> Coordinate frame: building `b.x,b.y` are world tiles; `b.footprint.sections`/`boundingBox` are **relative** to them, so moving `(b.x,b.y)` moves the whole building. Never mutate `b` in place (it lives in the memoized `layoutSettlement` result) — clone it.

---

### Task 1: Export suppression predicates + add `relocateBuilding()`

**Files:**
- Modify: `sim/world/buildings/resolved-buildings.js`
- Test: `sim/test/buildings-relocation.test.js`

- [ ] **Step 1: Export the two predicates** so tests and the relocation search can call them. In `resolved-buildings.js`, change the declarations:

```js
// was: function buildingTouchesWater(b) {
export function buildingTouchesWater(b) {
```
```js
// was: function buildingSpansCliff(b) {
export function buildingSpansCliff(b) {
```

- [ ] **Step 2: Add `MAX_RELOCATE_RADIUS` + `relocateBuilding()`** immediately after `buildingSpansCliff()` (around line 82):

```js
// How far (in tiles) a suppressed building may search for a valid site before we accept
// honest absence. Generous enough to clear a typical shoreline/cliff band; bounded so the
// (memoized, once-per-settlement) search can't run away. Tunable.
export const MAX_RELOCATE_RADIUS = 32;

// Deterministic nearest-first search for a valid origin for a building whose intended site
// is invalid (water/cliff). Pure f(terrain, localOccupied): tests only the terrain field and
// the settlement's own already-placed footprints (range-independent) — never the cross-settlement
// occupied set. Canonical ring scan order => identical result every run. Returns {x,y} or null.
export function relocateBuilding(b, localOccupied) {
  const bb = b.footprint.boundingBox;
  const fitsAt = (nx, ny) => {
    const probe = { x: nx, y: ny, footprint: b.footprint };
    if (buildingTouchesWater(probe) || buildingSpansCliff(probe)) return false;
    for (let dy = 0; dy < bb.h; dy++)
      for (let dx = 0; dx < bb.w; dx++)
        if (localOccupied.has((nx + dx) + ',' + (ny + dy))) return false;
    return true;
  };
  for (let r = 1; r <= MAX_RELOCATE_RADIUS; r++) {
    // top & bottom edges of the ring, west→east
    for (let dx = -r; dx <= r; dx++) {
      if (fitsAt(b.x + dx, b.y - r)) return { x: b.x + dx, y: b.y - r };
      if (fitsAt(b.x + dx, b.y + r)) return { x: b.x + dx, y: b.y + r };
    }
    // left & right edges of the ring (corners already covered above), north→south
    for (let dy = -r + 1; dy <= r - 1; dy++) {
      if (fitsAt(b.x - r, b.y + dy)) return { x: b.x - r, y: b.y + dy };
      if (fitsAt(b.x + r, b.y + dy)) return { x: b.x + r, y: b.y + dy };
    }
  }
  return null;
}
```

- [ ] **Step 3: Write the failing test** `sim/test/buildings-relocation.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveBuildingsInRange, relocateBuilding, MAX_RELOCATE_RADIUS,
  buildingTouchesWater, buildingSpansCliff,
} from '../world/buildings/resolved-buildings.js';
import { classifyBiomeNoStream } from '../../src/world/biomes.js';

const SEED = 42;
const RANGE = [19, 10, 21, 12];
const WATER = new Set(['ocean', 'deep_ocean', 'lake', 'river', 'shallow_water']);

// Find a water tile deterministically by scanning outward from a known wet area near spawn.
function findWaterTile() {
  for (let r = 0; r < 400; r++) {
    for (let a = 0; a < r * 4 || r === 0; a++) {
      const x = ((r * 1103515245 + a * 12345) % 800) - 400;
      const y = ((r * 1664525 + a * 1013904223) % 800) - 400;
      if (WATER.has(classifyBiomeNoStream(x, y).id)) return { x, y };
    }
  }
  return null;
}

test('relocateBuilding moves a water-blocked building onto valid ground', () => {
  const wet = findWaterTile();
  assert.ok(wet, 'expected to find a water tile near spawn');
  const fp = { boundingBox: { x0: 0, y0: 0, w: 4, h: 4 }, sections: [{ x0: 0, y0: 0, w: 4, h: 4 }] };
  const b = { x: wet.x, y: wet.y, footprint: fp };
  assert.ok(buildingTouchesWater(b), 'fixture should start on water');
  const at = relocateBuilding(b, new Set());
  assert.ok(at, 'expected a valid relocation within MAX_RELOCATE_RADIUS');
  const moved = { x: at.x, y: at.y, footprint: fp };
  assert.ok(!buildingTouchesWater(moved) && !buildingSpansCliff(moved), 'relocated site must be valid');
  const dist = Math.max(Math.abs(at.x - b.x), Math.abs(at.y - b.y));
  assert.ok(dist >= 1 && dist <= MAX_RELOCATE_RADIUS, 'relocation within the search radius');
});

test('relocateBuilding is deterministic', () => {
  const wet = findWaterTile();
  const fp = { boundingBox: { x0: 0, y0: 0, w: 4, h: 4 }, sections: [{ x0: 0, y0: 0, w: 4, h: 4 }] };
  const b = { x: wet.x, y: wet.y, footprint: fp };
  assert.deepEqual(relocateBuilding(b, new Set()), relocateBuilding(b, new Set()));
});

test('relocateBuilding respects localOccupied (won\'t return an occupied tile)', () => {
  const wet = findWaterTile();
  const fp = { boundingBox: { x0: 0, y0: 0, w: 2, h: 2 }, sections: [{ x0: 0, y0: 0, w: 2, h: 2 }] };
  const b = { x: wet.x, y: wet.y, footprint: fp };
  const first = relocateBuilding(b, new Set());
  // Block the first answer's footprint; the next call must pick a different origin.
  const occ = new Set();
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) occ.add((first.x + dx) + ',' + (first.y + dy));
  const second = relocateBuilding(b, occ);
  assert.ok(second, 'should still find a spot');
  assert.notDeepEqual(second, first, 'must avoid the occupied footprint');
});
```

- [ ] **Step 4: Run the test to verify it passes** (predicates exported, function added):

Run: `node --test sim/test/buildings-relocation.test.js`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add sim/world/buildings/resolved-buildings.js sim/test/buildings-relocation.test.js
git commit -m "feat(buildings): deterministic relocateBuilding() + export suppression predicates (Slice 1)"
```

---

### Task 2: Relocate-instead-of-drop in `settlementCandidates()`

**Files:**
- Modify: `sim/world/buildings/resolved-buildings.js:96-124` (`settlementCandidates`)
- Test: `sim/test/buildings-relocation.test.js`

- [ ] **Step 1: Write the failing integration test** (append to `buildings-relocation.test.js`):

```js
test('no resolved building sits on water or a cliff (relocation guarantees validity)', () => {
  const { buildings } = resolveBuildingsInRange(SEED, ...RANGE);
  assert.ok(buildings.length > 0, 'expected buildings in the populated range');
  for (const b of buildings) {
    assert.ok(!buildingTouchesWater(b), `building at ${b.x},${b.y} still on water`);
    assert.ok(!buildingSpansCliff(b), `building at ${b.x},${b.y} still spans a cliff`);
  }
});

test('relocated buildings are tagged and remain deterministic', () => {
  const a = resolveBuildingsInRange(SEED, ...RANGE).buildings.map(b => ({ x: b.x, y: b.y, from: b.relocatedFrom || null }));
  const b = resolveBuildingsInRange(SEED, ...RANGE).buildings.map(b => ({ x: b.x, y: b.y, from: b.relocatedFrom || null }));
  assert.deepEqual(a, b, 'relocation must be deterministic across resolves');
  // any building carrying relocatedFrom must actually have started somewhere invalid
  for (const b2 of resolveBuildingsInRange(SEED, ...RANGE).buildings) {
    if (b2.relocatedFrom) {
      const orig = { x: b2.relocatedFrom.x, y: b2.relocatedFrom.y, footprint: b2.footprint };
      assert.ok(buildingTouchesWater(orig) || buildingSpansCliff(orig),
        'relocatedFrom must point at an invalid origin');
    }
  }
});
```

- [ ] **Step 2: Run to verify it fails** (today buildings are dropped, not relocated; but the water test may pass vacuously since dropped buildings are absent — the *real* failing assertion is `relocatedFrom` tagging):

Run: `node --test sim/test/buildings-relocation.test.js`
Expected: the "relocated buildings are tagged" test FAILS (no `relocatedFrom` exists yet) — confirming the feature is absent.

- [ ] **Step 3: Rewrite `settlementCandidates()`** (replace the body of the `if (layout && layout.buildings) { ... }` block, lines ~104-120). Keep the `_P` perf-probe lines intact:

```js
  const out = [];
  if (layout && layout.buildings) {
    const cap = Math.min(layout.buildings.length, MAX_RESOLVED_BUILDINGS);
    // Intra-settlement occupancy (bounding-box tiles) of buildings already fixed in place —
    // used so a relocated building avoids its own settlement's buildings. Pure f(seed,settlement),
    // range-independent (never reads the cross-settlement occupied set).
    const localOccupied = new Set();
    const mark = (x, y, bb) => {
      for (let dy = 0; dy < bb.h; dy++)
        for (let dx = 0; dx < bb.w; dx++) localOccupied.add((x + dx) + ',' + (y + dy));
    };
    // Pass 1: classify; valid-in-place buildings become fixed anchors.
    const bad = new Array(cap);
    for (let bi = 0; bi < cap; bi++) {
      const b = layout.buildings[bi];
      _pBldScanned++; // [TEMP probe]
      const _w0 = _P ? performance.now() : 0;
      const tw = buildingTouchesWater(b);
      if (_P) _pWaterMs += performance.now() - _w0;
      const _c0 = _P ? performance.now() : 0;
      const sc = tw ? false : buildingSpansCliff(b);
      if (_P) { _pCliffMs += performance.now() - _c0; _pCliffN++; }
      bad[bi] = tw || sc;
      if (!bad[bi]) mark(b.x, b.y, b.footprint.boundingBox);
    }
    // Pass 2: keep original order; relocate the invalid ones around the fixed anchors and
    // each other (mark each relocation so later ones avoid it). Drop only if truly boxed in.
    for (let bi = 0; bi < cap; bi++) {
      const b = layout.buildings[bi];
      if (!bad[bi]) { out.push(b); continue; }
      const at = relocateBuilding(b, localOccupied);
      if (at) {
        mark(at.x, at.y, b.footprint.boundingBox);
        out.push({ ...b, x: at.x, y: at.y, relocatedFrom: { x: b.x, y: b.y } });
      }
      // else: honest absence — no valid site within MAX_RELOCATE_RADIUS (e.g. stranded on water)
    }
  }
```

> Note: this preserves the original push order for valid-in-place buildings (so the downstream first-writer-wins de-overlap is byte-identical for them), and clones relocated buildings (never mutates the memoized layout).

- [ ] **Step 4: Run the relocation tests to verify they pass:**

Run: `node --test sim/test/buildings-relocation.test.js`
Expected: all passing.

- [ ] **Step 5: Run the full building suite to catch snapshot drift** (relocation changes which buildings exist / where):

Run: `node --test sim/test/buildings-*.test.js sim/test/resolved-buildings.test.js sim/test/probe-buildings.test.js`
Expected: all passing. If a test asserts an exact building count/position in the spawn range that shifted *because a previously-dropped building now exists*, update that expectation to the new (correct) value and note it in the commit. Determinism/no-overlap/range-independence tests must still pass unchanged.

- [ ] **Step 6: Commit**

```bash
git add sim/world/buildings/resolved-buildings.js sim/test/buildings-relocation.test.js
git commit -m "feat(buildings): relocate water/cliff-blocked buildings instead of dropping them (Slice 1)"
```

---

### Task 3: Unify the `9` overlay with the resolved set

**Files:**
- Modify: `src/render/sim-debug-overlay.js`

- [ ] **Step 1: Add imports.** At the top of `sim-debug-overlay.js`, ensure these are imported (it already imports `getWorldSeed`, `layoutSettlement`, `classifyBiome`):

```js
import { resolveBuildingsInRange } from '../../sim/world/buildings/resolved-buildings.js';
import { MACRO_TILES } from '../../sim/world/buildings/settlement-discovery.js';
```

- [ ] **Step 2: Remove the divergent per-settlement building pass.** Delete the `globalOccupied` declaration (line ~182) and the entire `for (const b of layout.buildings) { ... }` block (lines ~216-278) from inside the `for (const s of allSettlements)` loop. Keep the spine drawing (lines ~203-214) and the district-label drawing (lines ~280+). Move `_renderedBuildings = [];` out of being reset here (it is reset in Step 3).

- [ ] **Step 3: Draw the resolved set once, after the settlement loop.** Immediately after the `for (const s of allSettlements) { ... }` loop closes, insert:

```js
  // ── Buildings: draw the SAME resolved (de-overlapped, relocated) set the world spawns,
  // so the overlay never shows ghosts that don't materialize. (Was: a separate per-settlement
  // layout filtered by water-only — which diverged from the cliff-aware resolver.)
  _renderedBuildings = [];
  const mt = MACRO_TILES;
  const mx0 = Math.floor((camX / tilePx) / mt) - 1, my0 = Math.floor((camY / tilePx) / mt) - 1;
  const mx1 = Math.floor(((camX + w) / tilePx) / mt) + 1, my1 = Math.floor(((camY + h) / tilePx) / mt) + 1;
  let resolved = [];
  try { resolved = resolveBuildingsInRange(getWorldSeed(), mx0, my0, mx1, my1).buildings; }
  catch { resolved = []; } // honest absence
  const t = Math.ceil(tilePx);
  for (const b of resolved) {
    const fp = b.footprint, bb = fp.boundingBox;
    const bsx = Math.floor(b.x * tilePx - camX), bsy = Math.floor(b.y * tilePx - camY);
    const bw = Math.ceil(bb.w * tilePx), bh = Math.ceil(bb.h * tilePx);
    if (bsx > w || bsy > h || bsx + bw < 0 || bsy + bh < 0) continue;
    for (const sec of fp.sections) {
      const ssx = Math.floor((b.x + sec.x0) * tilePx - camX);
      const ssy = Math.floor((b.y + sec.y0) * tilePx - camY);
      const sw = Math.ceil(sec.w * tilePx), sh = Math.ceil(sec.h * tilePx);
      ctx.fillStyle = BUILDING_COLORS.floor;
      ctx.fillRect(ssx, ssy, sw, sh);
      ctx.strokeStyle = b.relocatedFrom ? 'rgba(120,200,255,0.9)' : BUILDING_COLORS.wall; // relocated = blue edge
      ctx.lineWidth = Math.max(1, tilePx * 0.1);
      ctx.strokeRect(ssx + 0.5, ssy + 0.5, sw - 1, sh - 1);
    }
    for (const d2 of fp.doors) {
      const dsx = Math.floor((b.x + d2.x) * tilePx - camX);
      const dsy = Math.floor((b.y + d2.y) * tilePx - camY);
      ctx.fillStyle = BUILDING_COLORS.door;
      ctx.fillRect(dsx, dsy, t, t);
    }
    if (tilePx >= 6) {
      ctx.font = '9px monospace'; ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(b.brand?.name || fp.typeName || fp.typeId, bsx + 2, bsy - 2);
    }
    _renderedBuildings.push({ screenX: bsx, screenY: bsy, screenW: bw, screenH: bh, building: b, settlement: null });
  }
```

> `BUILDING_COLORS` is defined just above the settlement loop (line ~178); it remains in scope. `_renderedBuildings` keeps the same shape the click handler expects (`building` + `screenX/Y/W/H`); `settlement: null` is acceptable — the click panel reads settlement data from the building when present and tolerates absence (verify in Step 4).

- [ ] **Step 4: Verify the click panel still renders.** The click handler resolves `_renderedBuildings` by screen rect (unchanged). Confirm the detail panel (lines ~436-527) does not hard-require `settlement` — if it dereferences `selectedSettlement` for fields, guard those lines with `selectedSettlement?.` Read lines 436-527 and add optional chaining where a settlement field is read. (No behavior change when settlement is present.)

- [ ] **Step 5: Headless in-game verify** (the overlay is canvas UI — verify visually + by probe, not unit test). With the dev server on `:8123`, confirm the overlay building set equals the resolved set:

```bash
node -e "import('http://localhost:8123/sim/world/buildings/resolved-buildings.js')" # sanity that module serves
```
Then in the running game press `9` and confirm: no building outlines sit on water; relocated buildings show a blue edge; clicking a building still opens the panel. (Use the `_enter.mjs`/`_shot.mjs` harness against `HOST=localhost:8123` if a screenshot is wanted.)

- [ ] **Step 6: Commit**

```bash
git add src/render/sim-debug-overlay.js
git commit -m "fix(overlay): 9-overlay draws the resolved (relocated, cliff-aware) building set — no more ghosts (Slice 1)"
```

---

### Task 4: Whole-suite + perf sanity, then close the slice

- [ ] **Step 1: Run the full sim test suite:**

Run: `node --test sim/test/*.test.js`
Expected: green. Fix any drift from relocation (see Task 2 Step 5).

- [ ] **Step 2: Perf sanity on first settlement resolve.** Relocation runs a spiral (≤ `MAX_RELOCATE_RADIUS` rings) per suppressed building, but only on the first (memoized) resolve of a settlement. Time a cold resolve of the spawn range and confirm it stays reasonable:

```bash
node -e "import('./sim/world/buildings/resolved-buildings.js').then(m=>{const t=Date.now();m.resolveBuildingsInRange(42,19,10,21,12);console.log('cold resolve ms:',Date.now()-t)})"
```
Expected: comparable to before (tens of ms, not seconds). If a coastal settlement is slow, lower `MAX_RELOCATE_RADIUS` (e.g. 24) and re-run.

- [ ] **Step 3: Verify the user-facing outcome** in-game: press `9` around a coastal/cliffy settlement — buildings that used to be missing now appear (relocated, blue-edged) and none float on water. This is the Slice 1 acceptance.
