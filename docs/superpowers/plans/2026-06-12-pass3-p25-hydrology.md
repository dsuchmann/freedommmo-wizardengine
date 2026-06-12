# Pass 3 — P2.5: Hydrology & Bridges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real linear rivers (streams, 1–10 tiles wide) derived by deterministic flow-routing over the existing elevation field, layered into `classifyBiome` as an additive stream-channel signal — and therefore honest bridges/fords: routing can cross narrow water at a penalty, and groups fund crossing objects on the exact P2 roads pattern.

**Architecture (user-directed, 2026-06-12):** (1) `src/world/hydrology.js` — deterministic sources at high-elevation/high-moisture jittered-grid points, steepest-descent trace over `sampleClimate` elevation, channels widen with downstream progress toward the sea; memoized per-source polylines + a tile index, all pure f(seed, coords) so reboot/baseline/routing reproducibility is untouched. (2) `classifyBiome` gains a `'stream'` biome id that OVERRIDES land classification on channel tiles (additive — the existing basin `'river'` rule is untouched, so all empirical test geography survives). (3) `sim/world/crossings.js` — `buildFord`/`buildBridge` (group-funded nurture, condition/decay/maintenance — P2 roads pattern verbatim) + `routeWithCrossings` (planRoute with a crossings whitelist; streams cost Infinity unless a crossing exists or an explicit ford-scouting option pays a heavy penalty). World-compiler L10: "no road crosses impassable cells without crossing feature."

**Tech Stack:** Plain ES modules, node:test. No new dependencies.

---

## Context for the implementer (read this first)

1. **The no-mock prerequisite this closes:** P2 declared bridges/fords an honest absence because worldgen "rivers" are basin-scale blobs (~180–200 tiles, e.g. near x≈2035) classified per-tile from independent noise (`drainage > 0.73 && moisture > 0.58 && elevation < 0.62`, src/world/biomes.js classifyLocalCandidate). No linear, bridgeable watercourses exist. This plan derives them from the elevation field.
2. **Purity constraint (biomes.js:34-38 comment is law):** biome decisions must come from continuous world-space fields only — never chunk-local coordinates. Flow tracing is neighborhood-dependent, but a *memoized pure function* is still pure: same seed → same sources → same traces → same channel tiles, regardless of query order. Module-level caches keyed by seed are the established determinism-safe pattern (decoration-claims.js `_placeCache`).
3. **Noise substrate:** `fbm(x, y, salt, seed, baseScale, octaves)` and `rand2(x, y, salt, seed)` from src/core/random.js — pure, seeded via `getWorldSeed()` (default 42). `sampleClimate(wx, wy)` IS exported from src/world/biomes.js:9 (verified). elevation/moisture ≈ 0..1. Ocean: elevation < 0.36; shallow_water < 0.40.
4. **Additive, not destructive:** the existing `'river'`/`'lake'` basin rules stay EXACTLY as-is. Streams are a new `'stream'` id layered on top of land tiles only (a channel tile that is already ocean/shallow/lake/river keeps its old id — the stream has reached open water and ends). This preserves every empirical coordinate in routing/suitability/probe tests (river wedge x925–937×y0–5, MIXED rect, site2 (953,0)).
5. **Blast radius (researched):** consumers of `classifyBiome().id`: sim/world/routing.js `tileCost` (WATER_BIOMES set), sim/world/baseline.js (decoration placements per biome — `'stream'` gets NO entry in SS_BIOME_OBJECTS so it simply yields no placements, which is correct for a watercourse), src/world/chunk-compiler.js + wang painter + src/render/worker-tile-painter.js `WATER_BIOMES` map (add `stream: 1` so it renders as water, no cliff overlays). `BIOMES` table lives in src/world/biome-definitions.js.
6. **Renderer honesty:** add `stream: { material: 'river_water', color: '#2f8cb4', walkable: true, movementCost: 2 }` — reusing river_water material is honest (same substance, art variety is asset backlog), distinct color so streams are visible on the map. NO new Wang tileset generation in this plan (asset backlog X1).
7. **Sim-side mirror:** sim/world/routing.js `WATER_BIOMES` gains `'stream'` (impassable by default — wading a river is not free). Crossing machinery is OPT-IN via `routeWithCrossings`.
8. **P2 patterns to copy verbatim (sim/world/roads.js is the oracle):** group pays via `transfer(cost, 'nurture', ledger)` (0.95); ONE event (`ford_built`/`bridge_built`) with targets pushed via `kernel.ledger.events[evId-1].targets.push(...)`; matter node `{archetype:'ford'|'bridge', E, condition: 100, noFlux: true}`; daily decay scheduled `ver: -1`, condition −2/day, at 0 → `count('decayed', E)` + remove node (`road_gone` analog `crossing_gone`); `maintainCrossing` pays 5 → condition back to max. `ARCHETYPE_YIELD` entries `ford: {}` and `bridge: {}` are MANDATORY (sim/matter/composition.js longest-prefix fallthrough to `default: {stone: 0.01}` would conjure stone from labor — P2 lesson).
9. **Conservation:** crossing nodes hold embodied E from the nurture transfer (counted by stocks() matter branch — same as road_segment). Refusals null + zero events. All probe activity at tick 0 (stocks discipline).
10. **Provenance:** createNode param is `causeEventId`; the node stores `createdByEvent`.
11. **Scale/perf:** tracing is lazy + memoized. Worst case per query region: all source cells within MAX_STREAM_LEN must be traced once. Acceptable for tests and chunk compiles (one-time, cached); record O(...) in a header comment + backlog note. NEVER trace eagerly at module load.
12. **GEOGRAPHY (verified P2/P3):** (0,0) ocean; coast/grassland boundary ≈x926–930; grassland x930+; river wedge x925–937×y0–5; pure-grass {x0:938,y0:6,w:16,h:8}. Where streams actually land is DISCOVERED by Task 1's scan test — the probe then uses a real discovered stream tile (the test finds one programmatically; no hardcoded stream coordinates).
13. **Suite:** single files `node --test sim/test/<file>`; full suite `npm test` (~8.5 min, 267 pre-P2.5) at close-out only. Commits conventional + trailer `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`. NEVER push to origin. NEVER stage assets/, .claude/, .playwright-mcp/.

---

### Task 1: `src/world/hydrology.js` — sources, flow trace, channel index

**Files:**
- Create: `src/world/hydrology.js`
- Test: `sim/test/hydrology.test.js`

- [ ] **Step 1: failing tests** — create `sim/test/hydrology.test.js`:

```js
// sim/test/hydrology.test.js — P2.5: deterministic flow-routed streams. Sources at
// high-elevation/high-moisture jittered-grid points; steepest-descent traces that
// END at open water or max length; channels widen downstream; everything pure
// f(seed, coords) — memoization must not change results vs a cold module.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  streamAt, sourceFor, traceStream, clearHydrologyCache,
  SOURCE_CELL, SOURCE_MIN_ELEV, SOURCE_MIN_MOIST, MAX_STREAM_LEN, MAX_WIDTH,
} from '../../src/world/hydrology.js';
import { sampleClimate } from '../../src/world/biomes.js';

// A wide inland scan rect, east of the coast (grassland x930+). Streams are
// DISCOVERED, not assumed: the scan must find at least one channel tile in a
// region this large IF any source qualifies upstream. If zero streams exist in
// this rect, widen the rect empirically (document the change) — a worldgen with
// no streams anywhere within 1500×600 inland tiles would mean thresholds are
// mis-tuned, which is a real finding to fix in SOURCE_* constants, not in the test.
const SCAN = { x0: 930, y0: -300, w: 1500, h: 600 };

function findStreamTiles(limit = 50) {
  const hits = [];
  for (let y = SCAN.y0; y < SCAN.y0 + SCAN.h; y += 3) {
    for (let x = SCAN.x0; x < SCAN.x0 + SCAN.w; x += 3) {
      const s = streamAt(x, y);
      if (s) { hits.push({ x, y, ...s }); if (hits.length >= limit) return hits; }
    }
  }
  return hits;
}

test('P2.5 sources: jittered-grid candidates qualify only on high elevation + moisture, deterministic', () => {
  let qualified = 0;
  for (let cy = -8; cy < 8; cy++) for (let cx = 9; cx < 30; cx++) {
    const s = sourceFor(cx, cy);
    const s2 = sourceFor(cx, cy);
    assert.deepEqual(s, s2, 'deterministic per cell');
    if (!s) continue;
    qualified++;
    const c = sampleClimate(s.x, s.y);
    assert.ok(c.elevation >= SOURCE_MIN_ELEV, `source (${s.x},${s.y}) elevation qualifies`);
    assert.ok(c.moisture >= SOURCE_MIN_MOIST, `source (${s.x},${s.y}) moisture qualifies`);
    // candidate point lies inside its cell
    assert.ok(s.x >= cx * SOURCE_CELL && s.x < (cx + 1) * SOURCE_CELL);
    assert.ok(s.y >= cy * SOURCE_CELL && s.y < (cy + 1) * SOURCE_CELL);
  }
  assert.ok(qualified >= 1, `at least one qualified source in a 21x16-cell highland scan (got ${qualified})`);
});

test('P2.5 trace: monotone non-increasing elevation (with carve tolerance), ends at water or MAX, widens downstream', () => {
  // find a qualified source
  let src = null;
  outer: for (let cy = -8; cy < 8; cy++) for (let cx = 9; cx < 30; cx++) {
    src = sourceFor(cx, cy); if (src) break outer;
  }
  assert.ok(src, 'a source exists');
  const path = traceStream(src);
  assert.ok(path.length >= 2, 'trace has length');
  assert.ok(path.length <= MAX_STREAM_LEN, 'trace bounded');
  for (let i = 1; i < path.length; i++) {
    // steepest descent with carve tolerance: elevation may rise at most CARVE_EPS per step
    assert.ok(sampleClimate(path[i].x, path[i].y).elevation
      <= sampleClimate(path[i - 1].x, path[i - 1].y).elevation + 0.02 + 1e-9,
      `step ${i} does not climb`);
    // 8-connected steps
    assert.ok(Math.abs(path[i].x - path[i - 1].x) <= 1 && Math.abs(path[i].y - path[i - 1].y) <= 1);
    // width non-decreasing downstream, capped
    assert.ok(path[i].width >= path[i - 1].width && path[i].width <= MAX_WIDTH);
  }
  const last = path[path.length - 1];
  const endsAtWater = sampleClimate(last.x, last.y).elevation < 0.40;
  assert.ok(endsAtWater || path.length === MAX_STREAM_LEN,
    'trace ends at open water or at the length bound (an endorheic dead-end is a real finding — flag it)');
});

test('P2.5 streamAt: channel tiles report width/distance evidence; determinism across cache clear', () => {
  const hits = findStreamTiles(20);
  assert.ok(hits.length >= 1, 'streams discovered in the inland scan rect');
  for (const h of hits) {
    assert.ok(h.width >= 1 && h.width <= MAX_WIDTH, 'width in 1..MAX_WIDTH');
    assert.ok(Number.isInteger(h.dist) && h.dist >= 0, 'distance evidence');
  }
  // memoization must be invisible: clear all caches, re-query, identical
  const before = hits.map(h => ({ x: h.x, y: h.y, width: h.width, dist: h.dist }));
  clearHydrologyCache();
  const after = before.map(h => ({ x: h.x, y: h.y, ...streamAt(h.x, h.y) }));
  assert.deepEqual(after, before, 'cold cache reproduces identical channels');
});

test('P2.5 streamAt: open-water and far-from-channel tiles are null', () => {
  assert.equal(streamAt(0, 0), null, 'ocean is not a stream channel');
  // a known pure-grass tile far from any channel found above — verify against scan
  const hits = findStreamTiles(50);
  const hitSet = new Set(hits.map(h => `${h.x},${h.y}`));
  let probe = null;
  for (let y = 6; y < 14 && !probe; y++) for (let x = 938; x < 954 && !probe; x++) {
    if (!hitSet.has(`${x},${y}`) && streamAt(x, y) === null) probe = { x, y };
  }
  assert.ok(probe, 'at least one inland tile is channel-free');
});
```

- [ ] **Step 2:** `node --test sim/test/hydrology.test.js` — FAIL (module not found).

- [ ] **Step 3: implement** — create `src/world/hydrology.js`:

```js
// src/world/hydrology.js — P2.5: deterministic flow-routed watercourses (streams).
// Sources seed at high-elevation/high-moisture points on a jittered grid; each
// traces steepest-descent over the SAME elevation field classifyBiome uses,
// carving through small flats (CARVE_EPS) and ending at open water (elevation
// < 0.40) or MAX_STREAM_LEN. Channels widen with downstream distance (1..MAX_WIDTH,
// widening toward the sea). PURITY: every export is a pure function of
// (world seed, coordinates); module-level memoization is invisible (same seed →
// same traces regardless of query order — clearHydrologyCache() exists to prove
// it in tests). Complexity: first query in a region traces all source cells within
// MAX_STREAM_LEN Chebyshev (lazy, then cached) — O(cells × MAX_STREAM_LEN × 8 climate
// samples) once per neighborhood. TODO(perf backlog): persist traces per seed if
// chunk-compile profiling demands.
// HONEST ABSENCES: no erosion/seasons/flow-volume physics — width is a declared
// downstream-progress signal; no lakes from endorheic basins (dead-end traces just
// stop — declared); stream art reuses river_water material (asset backlog X1).
import { rand2 } from '../core/random.js';
import { getWorldSeed } from '../core/world-seed.js';
import { sampleClimate } from './biomes.js';

export const SOURCE_CELL = 96;          // jittered-grid cell size (tiles)
export const SOURCE_MIN_ELEV = 0.62;    // headwaters sit high...
export const SOURCE_MIN_MOIST = 0.55;   // ...and wet
export const MAX_STREAM_LEN = 600;      // trace bound (tiles)
export const MAX_WIDTH = 10;            // channel half-spec: full width 1..10
const CARVE_EPS = 0.02;                 // max per-step climb when carving through flats
const SEA_ELEV = 0.40;                  // trace ends below this (shallow water line)

/** Deterministic candidate source for grid cell (cx,cy): one jittered point per cell,
 *  qualified by elevation+moisture thresholds. Returns {x,y} or null. Pure. */
export function sourceFor(cx, cy, seed = getWorldSeed()) {
  const jx = Math.floor(rand2(cx, cy, 9101, seed) * SOURCE_CELL);
  const jy = Math.floor(rand2(cx, cy, 9102, seed) * SOURCE_CELL);
  const x = cx * SOURCE_CELL + jx, y = cy * SOURCE_CELL + jy;
  const c = sampleClimate(x, y);
  if (c.elevation < SOURCE_MIN_ELEV || c.moisture < SOURCE_MIN_MOIST) return null;
  return { x, y };
}

const N8 = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];

/** Steepest-descent trace from a source. Each step picks the lowest unvisited
 *  8-neighbor (ties: N8 order — deterministic); may climb at most CARVE_EPS
 *  (carving through micro-flats); stops at open water, a forced climb, or
 *  MAX_STREAM_LEN. width = 1 + floor(progress² · (MAX_WIDTH−1)) where progress
 *  is the fraction of elevation drop toward sea level — widening toward the sea.
 *  Returns [{x,y,width}, ...]. Pure. */
export function traceStream(source, seed = getWorldSeed()) {
  const path = [];
  const visited = new Set();
  let { x, y } = source;
  const e0 = sampleClimate(x, y).elevation;
  let e = e0;
  while (path.length < MAX_STREAM_LEN) {
    const span = Math.max(e0 - SEA_ELEV, 1e-6);
    const progress = Math.min(1, Math.max(0, (e0 - e) / span));
    path.push({ x, y, width: 1 + Math.floor(progress * progress * (MAX_WIDTH - 1)) });
    visited.add(`${x},${y}`);
    if (e < SEA_ELEV) break;                       // reached open water
    let bx = null, by = null, be = Infinity;
    for (const [dx, dy] of N8) {
      const nx = x + dx, ny = y + dy;
      if (visited.has(`${nx},${ny}`)) continue;
      const ne = sampleClimate(nx, ny).elevation;
      if (ne < be) { be = ne; bx = nx; by = ny; }
    }
    if (bx === null || be > e + CARVE_EPS) break;  // boxed in or forced climb: dead end
    x = bx; y = by; e = be;
  }
  return path;
}

// ---- memoized channel index (purity-invisible cache) ----
let _cache = null;  // { seed, traced: Set<cellKey>, tiles: Map<'x,y' → {width, dist}> }
function cacheFor(seed) {
  if (!_cache || _cache.seed !== seed) _cache = { seed, traced: new Set(), tiles: new Map() };
  return _cache;
}
export function clearHydrologyCache() { _cache = null; }

function ensureCell(cx, cy, seed) {
  const c = cacheFor(seed);
  const key = `${cx},${cy}`;
  if (c.traced.has(key)) return;
  c.traced.add(key);
  const src = sourceFor(cx, cy, seed);
  if (!src) return;
  const path = traceStream(src, seed);
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const r = Math.floor(p.width / 2);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const k = `${p.x + dx},${p.y + dy}`;
      const prev = c.tiles.get(k);
      // widest claim wins (confluences/overlaps deterministic: width, then dist)
      if (!prev || p.width > prev.width || (p.width === prev.width && i < prev.dist)) {
        c.tiles.set(k, { width: p.width, dist: i });
      }
    }
  }
}

/** Is (x,y) on a stream channel? Returns {width, dist} (dist = tiles from source
 *  along the claiming trace) or null. Open water (elevation < 0.40) is never a
 *  stream tile (the channel has ended). Pure given seed; lazily traces every
 *  source cell within MAX_STREAM_LEN Chebyshev of the query (memoized). */
export function streamAt(x, y, seed = getWorldSeed()) {
  if (sampleClimate(x, y).elevation < SEA_ELEV) return null;
  const reach = Math.ceil(MAX_STREAM_LEN / SOURCE_CELL) + 1;
  const cx0 = Math.floor(x / SOURCE_CELL), cy0 = Math.floor(y / SOURCE_CELL);
  for (let cy = cy0 - reach; cy <= cy0 + reach; cy++)
    for (let cx = cx0 - reach; cx <= cx0 + reach; cx++) ensureCell(cx, cy, seed);
  return cacheFor(seed).tiles.get(`${x},${y}`) ?? null;
}
```

- [ ] **Step 4:** `node --test sim/test/hydrology.test.js` — PASS. EMPIRICAL TUNING LOOP: if zero sources qualify in the scan, probe the elevation/moisture distribution (`node -e` over sampleClimate on a coarse grid) and tune SOURCE_MIN_ELEV / SOURCE_MIN_MOIST (document final values + evidence). If traces dead-end immediately, raise CARVE_EPS cautiously (≤0.03). The scan rect may be widened; assertion structure may NOT be weakened. NOTE the runtime: if the first streamAt scan exceeds ~60s, shrink the test SCAN rect (not MAX_STREAM_LEN) and document.

- [ ] **Step 5: Commit:**
```bash
git add src/world/hydrology.js sim/test/hydrology.test.js
git commit -m "feat(world): P2.5 hydrology — deterministic flow-routed streams over the elevation field

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: `'stream'` biome layer — classifyBiome, definitions, renderer + sim mirrors

**Files:**
- Modify: `src/world/biomes.js` (classifyBiome — stream override)
- Modify: `src/world/biome-definitions.js` (stream entry)
- Modify: `src/render/worker-tile-painter.js` (WATER_BIOMES map + stream entry)
- Modify: `sim/world/routing.js` (WATER_BIOMES set + stream)
- Test: `sim/test/stream-biome.test.js`

- [ ] **Step 1: failing tests** — create `sim/test/stream-biome.test.js`:

```js
// sim/test/stream-biome.test.js — P2.5: the stream channel layer in classifyBiome.
// Additive: basin water ids unchanged everywhere (empirical P2/P3 geography intact);
// stream tiles get id 'stream' on land only; routing treats streams as water.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyBiome } from '../../src/world/biomes.js';
import { streamAt } from '../../src/world/hydrology.js';
import { tileCost, WATER_BIOMES } from '../world/routing.js';

test('P2.5 stream layer: channel tiles classify as stream; id carries the hydrology evidence', () => {
  // discover a stream tile (same scan approach as hydrology.test.js)
  let tile = null;
  outer: for (let y = -300; y < 300; y += 3) for (let x = 930; x < 2430; x += 3) {
    if (streamAt(x, y)) { tile = { x, y }; break outer; }
  }
  assert.ok(tile, 'a stream tile exists inland');
  const b = classifyBiome(tile.x, tile.y);
  assert.equal(b.id, 'stream');
  assert.ok(b.definition.movementCost >= 1, 'stream has a definition');
  assert.ok(b.climate.stream, 'climate carries stream evidence {width, dist}');
  assert.ok(b.climate.stream.width >= 1);
});

test('P2.5 additive guarantee: every empirically-known water/land tile keeps its pre-stream id', () => {
  // P2/P3 geography must be untouched (these ids back routing/suitability/probe tests)
  assert.equal(classifyBiome(930, 0).id !== 'stream' && WATER_BIOMES.has(classifyBiome(930, 0).id), true,
    'river wedge tile is still basin water');
  const grass = classifyBiome(940, 8);
  assert.ok(!WATER_BIOMES.has(grass.id), '(940,8) still land');     // P3 founding site
  const grass2 = classifyBiome(953, 0);
  assert.ok(!WATER_BIOMES.has(grass2.id), '(953,0) still land');    // P3 probe site2
  assert.equal(classifyBiome(0, 0).id, classifyBiome(0, 0).id, 'pure');
  // open water never re-classifies as stream
  assert.notEqual(classifyBiome(0, 0).id, 'stream');
});

test('P2.5 routing: stream tiles are impassable water by default', () => {
  assert.ok(WATER_BIOMES.has('stream'), 'stream in the impassable set');
  let tile = null;
  outer: for (let y = -300; y < 300; y += 3) for (let x = 930; x < 2430; x += 3) {
    if (streamAt(x, y)) { tile = { x, y }; break outer; }
  }
  assert.equal(tileCost(tile.x, tile.y), Infinity, 'stream tile costs Infinity without a crossing');
});
```

- [ ] **Step 2:** run — FAIL ('stream' never assigned).

- [ ] **Step 3: implement** (four small edits):

src/world/biome-definitions.js — add to the BIOMES table next to river:
```js
stream: { material: 'river_water', color: '#2f8cb4', walkable: true, movementCost: 2 },
```

src/world/biomes.js — in `classifyBiome`, after the current id is determined and BEFORE the return, layer the channel signal (land tiles only — basin water ids win, the channel has ended in open water):
```js
import { streamAt } from './hydrology.js';
const BASIN_WATER = new Set(['deep_ocean', 'ocean', 'shallow_water', 'river', 'lake']);
// ... inside classifyBiome, after `const id = regionalCandidate;` etc.:
let finalId = id, stream = null;
if (!BASIN_WATER.has(id)) {
  stream = streamAt(wx, wy);
  if (stream) finalId = 'stream';
}
return { id: finalId, definition: BIOMES[finalId],
  climate: { ...climate, regionalBiome: regionalCandidate, localCandidate,
             ecotone: localAllowed ? 1 : 0, borderCandidate: localAllowed ? localCandidate : null,
             stream } };
```
(Adapt variable names to the real function body — keep the existing ecotone fields EXACTLY; only add `stream` and the finalId override. Cost note: streamAt adds ~a Map lookup after first trace; the lazy trace cost lands on first chunk compile per region.)

src/render/worker-tile-painter.js — `var WATER_BIOMES = { ..., stream: 1 };`

sim/world/routing.js — add `'stream'` to the WATER_BIOMES set (already exported, routing.js:8 — verified).

- [ ] **Step 4:** `node --test sim/test/stream-biome.test.js sim/test/hydrology.test.js` — PASS.

- [ ] **Step 5: regression** — the full empirical-geography surface: `node --test sim/test/routing.test.js sim/test/suitability.test.js sim/test/settlements.test.js sim/test/probe-settlements.test.js sim/test/probe-roads.test.js sim/test/baseline.test.js sim/test/wire.test.js` — ALL PASS. If any fails because a stream now crosses an empirical coordinate (e.g. a P3 site became 'stream'), DO NOT move the stream: re-tune is forbidden mid-task — report BLOCKED with the collision coordinates (the controller decides: adjust test coordinates per the established empirical-coordinate convention, or revisit source thresholds).

- [ ] **Step 6: Commit:**
```bash
git add src/world/biomes.js src/world/biome-definitions.js src/render/worker-tile-painter.js sim/world/routing.js sim/test/stream-biome.test.js
git commit -m "feat(world): P2.5 stream biome layer — channels override land classification, render as water, route as impassable

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: `sim/world/crossings.js` — fords & bridges on the P2 roads pattern

**Files:**
- Create: `sim/world/crossings.js`
- Modify: `sim/world/routing.js` (planRoute opts.crossings whitelist — ~4 lines)
- Modify: `sim/matter/composition.js` (ARCHETYPE_YIELD: `ford: {}`, `bridge: {}`)
- Modify: `sim/kernel/kernel.js` (registerCrossings after registerRoads)
- Modify BOTH REMOVAL_KINDS copies? NO — crossings are matter nodes, not placement suppressions (a ford sits ON water; no baseline placement exists there). Confirm no suppression needed.
- Test: `sim/test/crossings.test.js`

- [ ] **Step 1: failing tests** — create `sim/test/crossings.test.js`:

```js
// sim/test/crossings.test.js — P2.5: fords/bridges = group-funded matter on stream
// tiles (P2 roads pattern: nurture transfer, condition+decay+maintenance). Routing
// crosses water ONLY through a crossing (world-compiler L10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { createGroup } from '../society/groups.js';
import { buildCrossing, maintainCrossing, crossingsOf, FORD_COST, BRIDGE_COST, CROSSING_DECAY_PER_DAY, MAINTAIN_COST } from '../world/crossings.js';
import { planRoute, tileCost } from '../world/routing.js';
import { streamAt } from '../../src/world/hydrology.js';
import { DAY } from '../time/metabolism.js';

// Discover a stream tile with land on opposite sides (a crossable narrows).
function findCrossable() {
  for (let y = -300; y < 300; y += 1) for (let x = 930; x < 2430; x += 1) {
    const s = streamAt(x, y);
    if (!s || s.width > 3) continue;
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

test('P2.5 buildCrossing: ford on a narrow stream — paid, provenanced, conditioned; routing crosses only via it', () => {
  const spot = findCrossable();
  assert.ok(spot, 'a crossable narrows exists');
  const bounds = { x0: spot.west.x - 2, y0: spot.tile.y - 6, w: (spot.east.x - spot.west.x) + 5, h: 13 };
  const k = new Kernel({ seed: 7, bounds });
  const g = createGroup(k, 0, spot.west);
  k.graph.boot(() => { g.R = FORD_COST + 50; });   // boot arrangement: pre-funded wallet (probe funds for real)
  // without a crossing: unreachable across the channel IF the channel separates west/east in bounds
  const before = planRoute(spot.west, spot.east, bounds);
  // (stream may be skirtable inside these bounds — if so the route must not contain the ford tile)
  const ford = buildCrossing(k, g.id, spot.tile, 'ford', 0);
  assert.ok(ford, 'ford built');
  assert.equal(ford.attrs.archetype, 'ford');
  assert.equal(ford.attrs.condition, 100);
  assert.ok(ford.attrs.E > 0, 'embodied time from the nurture transfer');
  assert.ok(k.ledger.events.some(e => e.type === 'ford_built'), 'ledger event');
  // routing with the crossings whitelist passes through the ford tile
  const xs = crossingsOf(k);
  assert.ok(xs.has(`${spot.tile.x},${spot.tile.y}`));
  const route = planRoute(spot.west, spot.east, bounds, { crossings: xs });
  assert.ok(route, 'route exists with crossing');
  if (!before) assert.ok(route.some(p => p.x === spot.tile.x && p.y === spot.tile.y),
    'when the channel blocks, the route uses the ford');
});

test('P2.5 refusals: not a stream tile, too wide for ford, missing/poor group — side-effect-free', () => {
  const spot = findCrossable();
  const bounds = { x0: spot.west.x - 2, y0: spot.tile.y - 6, w: (spot.east.x - spot.west.x) + 5, h: 13 };
  const k = new Kernel({ seed: 7, bounds });
  const g = createGroup(k, 0, spot.west);
  k.graph.boot(() => { g.R = 1000; });
  const ev0 = k.ledger.events.length;
  assert.equal(buildCrossing(k, g.id, spot.west, 'ford', 0), null, 'land tile refused');
  assert.equal(buildCrossing(k, 99999, spot.tile, 'ford', 0), null, 'missing group');
  const poor = createGroup(k, 0, spot.west);
  assert.equal(buildCrossing(k, poor.id, spot.tile, 'ford', 0), null, 'cannot pay');
  assert.equal(k.ledger.events.length - ev0, 1, 'only the group_founded event for poor — no crossing events on refusal');
  // ford width limit: fords only on width ≤ FORD_MAX_WIDTH (bridge required beyond)
});

test('P2.5 decay: unmaintained crossing decays to nothing with conserved E; maintenance resets', () => {
  const spot = findCrossable();
  const bounds = { x0: spot.west.x - 2, y0: spot.tile.y - 6, w: (spot.east.x - spot.west.x) + 5, h: 13 };
  const k = new Kernel({ seed: 7, bounds });
  const g = createGroup(k, 0, spot.west);
  k.graph.boot(() => { g.R = FORD_COST * 3; });
  const ford = buildCrossing(k, g.id, spot.tile, 'ford', 0);
  const s0 = k.stocks(k.tick);
  const dec0 = k.ledger.totals.decayed ?? 0;
  k.runTo(10 * DAY);
  assert.equal(ford.attrs.condition, 100 - 10 * CROSSING_DECAY_PER_DAY, 'condition decays daily');
  assert.equal(maintainCrossing(k, g.id, ford.id, k.tick), true);
  assert.equal(ford.attrs.condition, 100, 'maintenance restores');
  k.runTo(60 * DAY);   // 100/2 = 50 days to die
  assert.ok(!k.graph.nodes.has(ford.id), 'crossing gone at condition 0');
  assert.ok(k.ledger.events.some(e => e.type === 'crossing_gone'));
  assert.ok((k.ledger.totals.decayed ?? 0) > dec0, 'embodied E counted as decayed');
});
```

- [ ] **Step 2:** run — FAIL.

- [ ] **Step 3: implement** — create `sim/world/crossings.js` (copy sim/world/roads.js structure verbatim, adapting):

```js
// sim/world/crossings.js — P2.5: fords & bridges (world-compiler L10 "no road crosses
// impassable cells without crossing feature"). A group pays embodied time (nurture
// 0.95) to place a crossing matter node ON a stream tile; planRoute crosses water
// ONLY through crossing tiles (opts.crossings whitelist — routing stays pure; the
// caller derives the whitelist from the kernel via crossingsOf). Condition decays
// daily; unmaintained crossings wash away (E → 'decayed', node removed).
// Fords only on narrow channels (width ≤ FORD_MAX_WIDTH); bridges any width ≤ MAX.
// NO suppression deltas: crossings sit on water — no baseline placement exists there.
// TODO(save/load): crossing nodes are runtime state (same rehydration backlog as
// roads/paths/settlements).
import { transfer, DAY } from '../time/metabolism.js';
import { streamAt } from '../../src/world/hydrology.js';

export const FORD_COST = 40;
export const BRIDGE_COST = 150;
export const FORD_MAX_WIDTH = 3;
export const CROSSING_CONDITION_MAX = 100;
export const CROSSING_DECAY_PER_DAY = 2;
export const MAINTAIN_COST = 5;
```
…then `buildCrossing(kernel, groupId, tile, kind /* 'ford'|'bridge' */, tick)`:
- refusals (null, zero events): group missing/not type 'group'; tile not a stream (`streamAt` null); kind 'ford' and stream width > FORD_MAX_WIDTH; tile outside kernel.bounds; existing crossing on that tile; group.R < cost.
- success: `group.R -= cost`; `const E = transfer(cost, 'nurture', kernel.ledger)`; ONE event `${kind}_built` (actor group, attrs {x, y, width}); matter node `{type:'matter', x, y, attrs:{archetype: kind, E, condition: CROSSING_CONDITION_MAX, noFlux: true}, causeEventId: evId}`; targets.push(node.id); schedule daily decay `{ver: -1}` exactly like roads.js (`crossing_decay` handler: condition −= CROSSING_DECAY_PER_DAY; at ≤0 → `kernel.ledger.count('decayed', node.attrs.E)`, emit `crossing_gone`, `removeNode` — copy onRoadDecay including the `if (!node) return` guard and isFresh discipline).
- `maintainCrossing(kernel, groupId, crossingId, tick)`: pays MAINTAIN_COST via nurture (E adds to node.attrs.E), condition → max; refusals false/zero-events.
- `crossingsOf(kernel)` → `Set('x,y')` of all live crossing nodes (archetype ford|bridge).
- `registerCrossings(kernel)` in kernel constructor right after registerRoads (mirror the pattern).

sim/world/routing.js — `planRoute(from, to, bounds, opts = {})`: where tileCost is consulted, allow `opts.crossings?.has(`${x},${y}`)` to substitute a finite crossing cost (use the tile's definition movementCost, i.e. 2). Touch NOTHING else; default behavior identical (all existing callers pass no opts).

sim/matter/composition.js — ARCHETYPE_YIELD: add `ford: {}` and `bridge: {}` with the road_segment MANDATORY comment (prefix fallthrough conjures stone).

- [ ] **Step 4:** `node --test sim/test/crossings.test.js sim/test/roads.test.js sim/test/routing.test.js` — PASS.

- [ ] **Step 5: Commit:**
```bash
git add sim/world/crossings.js sim/test/crossings.test.js sim/world/routing.js sim/matter/composition.js sim/kernel/kernel.js
git commit -m "feat(sim): P2.5 fords & bridges — group-funded crossings on stream tiles, routing crosses only through them

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: the P2.5 probe — a real river, a real ford, a road across it

**Files:**
- Create: `sim/test/probe-hydrology.test.js`

- [ ] **Step 1: the probe** — header + scenario (style oracle: probe-roads.test.js / probe-settlements.test.js — pickUntil, real verbs, tick-0 stocks discipline, runScenario-twice determinism):

```js
// sim/test/probe-hydrology.test.js — P2.5 probe: the world has real linear rivers
// now. A discovered stream blocks routing where basins never did; settlers fund a
// group with picked time; the group builds a ford at a narrow crossable point
// (scouted programmatically, never hardcoded); a route then crosses the water
// through the ford; the unmaintained ford decays away and the crossing is lost
// again; conservation holds exactly; the whole history replays bit-identically.
```

Steps (every guard asserting; structure may not be weakened):
1. Discover (programmatically, the crossings.test findCrossable approach) a narrow stream tile with land both sides; build bounds around it. Assert linearity evidence: walk the discovered stream's tiles in bounds and assert the channel is ≤ MAX_WIDTH wide at the crossing scanline (count contiguous 'stream'-classified tiles along the row) — versus the P2 basin fact (~180–200 tiles): assert width ≤ 10. THE headline assertion of the whole pass.
2. Kernel on those bounds; boot berry_bushes on land; players pick (real verb) until they can `contribute` FORD_COST + maintenance headroom to a group.
3. Without crossings: `planRoute(west, east, bounds)` — if null, record blocked=true (the honest case); if a skirting route exists inside bounds, assert it contains NO stream tile (water never crossed without a feature — L10 verified either way).
4. `buildCrossing(..., 'ford', 0)` → assert paid (group.R dropped by FORD_COST), E embodied, ford_built event, conservation identity at tick 0 (probe-roads form).
5. `planRoute(west, east, bounds, { crossings: crossingsOf(k) })` → route exists; if blocked=true, assert the route passes through the ford tile.
6. Decay: runTo until the ford dies (50 days + epsilon); assert crossing_gone, node removed, decayed counter increased by ≥ the ford's E (ambient flora decay also accrues — ≥ floor, the P2 convention); re-route with fresh crossingsOf → ford tile no longer crossable (route null again or skirts).
7. Determinism: deepEqual(runScenario(), runScenario()) — summary: {crossing tile+width, scanline width, blocked flag, route lengths, event-type counts, fordE}.

- [ ] **Step 2:** `node --test sim/test/probe-hydrology.test.js` — PASS. Regression: `node --test sim/test/hydrology.test.js sim/test/stream-biome.test.js sim/test/crossings.test.js sim/test/probe-roads.test.js sim/test/probe-settlements.test.js`.

- [ ] **Step 3: Commit:**
```bash
git add sim/test/probe-hydrology.test.js
git commit -m "test(sim): P2.5 probe — linear river blocks, funded ford crosses, decay severs the crossing again

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Close-out — full suite, deviations, roadmap

- [ ] **Step 1:** `npm test` background (~9 min). Expected: 267 pre-P2.5 + new, all pass.
- [ ] **Step 2:** Append `## Deviations (canonical)` here (tuned constants + empirical evidence, discovered stream geography, every divergence).
- [ ] **Step 3:** Roadmap P2.5 row → DONE (test count; honest absences: no erosion/seasons/lakes-from-dead-ends, stream art reuses river_water pending X1, crossing rehydration joins save/load backlog). Update the P2 row's bridges note → "closed by P2.5".
- [ ] **Step 4: Commit:**
```bash
git add docs/superpowers/plans/2026-06-12-pass2plus-roadmap.md docs/superpowers/plans/2026-06-12-pass3-p25-hydrology.md
git commit -m "docs(sim): P2.5 hydrology close-out — roadmap DONE, deviations recorded

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Out of scope (honest absences, declared)

- **Erosion, seasons, flow volume physics**: width is a declared downstream-progress signal.
- **Lakes from endorheic dead-ends**: a boxed-in trace just stops — declared (future hydrology deepening).
- **Stream-specific art**: reuses river_water material; distinct color only. Wang stream tileset = asset backlog X1.
- **Confluence merging into wider unified channels**: overlapping traces resolve by widest-claim-wins on shared tiles; true tributary accumulation = backlog.
- **Navigation/ports** (world-compiler L11): still absent.
- **Save/load**: crossing nodes join the roads/paths/settlements rehydration backlog.
- **Renderer chunk-cache invalidation for biome changes**: not needed — hydrology is baseline worldgen (present from first compile), never changes at runtime.

## Seams for later plans

- `streamAt` width evidence is the bridge-vs-ford gate AND P5 growth's water-access upgrade (riverside settlements).
- `crossingsOf` + planRoute opts is the connectivity seam for P4 NPC movement and P5/P6 settlement networks.
- Suitability's `nearestWater` now finds streams automatically (tileCost sees 'stream') — riverside sites score realistically with zero changes.
- Dead-end traces (endorheic) are the future lakes/wetlands seam.
