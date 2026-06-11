# Field Layering Claim System + F3 Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One deterministic placement+claim module shared by worker and main thread, so F3 debris bakes with perfect draw order and F2 flora never spawns inside an F3 footprint; extensible to F4+.

**Architecture:** New pure module `src/world/decoration-claims.js` owns the F3 catalog, placement function (existing 9500-series seeds preserved), per-tile 8×8 claim bitmasks with neighbor-tile scan, and memoized caches. Worker (`worker-chunk-renderer.js`) consumes placements to bake F3 sorted by base-Y; main thread (`field2-animator.js`) consumes masks to cull F2 blades.

**Tech Stack:** Vanilla ES modules, `rand2` from `src/core/random.js`, OffscreenCanvas worker baking, Playwright (swiftshader) verification.

**Spec:** `docs/superpowers/specs/2026-06-10-field-layering-claims-design.md`

---

### Task 1: Shared module `src/world/decoration-claims.js` + node test

**Files:**
- Create: `src/world/decoration-claims.js`
- Create: `scripts/test-decoration-claims.mjs` (standalone node test, run with `node`)
- Modify: `src/render/worker-chunk-renderer.js` (delete `SS_BIOME_OBJECTS`/`SS_BASE_PATH`/`SS_VARIANT_COUNT` lines ~881-1038, import from new module instead — full rewrite of the consumer is Task 2; this task only moves the catalog and keeps the existing code compiling by importing the moved names)

- [ ] **Step 1: Generate the per-object state map**

Run this to enumerate which lifecycle-state PNGs actually exist:

```bash
cd "C:/Users/daves/AppData/Roaming/wizardgenie/projects/default/assets/pixelab/landscape_v2/micro/small_scatter/_states" \
  && for b in */; do for o in "$b"*/; do sts=$(ls "$o" | sed -E 's/.*__state__(.+)\.png/\1/' | tr '\n' ' '); echo "'${o%/}': [$(echo $sts | sed "s/\([a-z_]*\)/'\1',/g")],"; done; done
```

Paste the output (keys like `'grassland/field_stone'`) into the `SS_STATES` literal in Step 2. Skip any entry whose files are <1000 bytes (404-JSON corruption — verify with `find . -name '*.png' -size -1k`).

- [ ] **Step 2: Write the module**

```js
// src/world/decoration-claims.js
// Single source of truth for Field 3+ decoration placement and the
// cross-field claim masks that stop lower fields (F2 flora) from spawning
// inside higher-field objects' base footprints. Pure + deterministic:
// worker and main thread compute identical results independently.
import { rand2 } from '../core/random.js';

export var SS_BASE_PATH = '/assets/pixelab/landscape_v2/micro/small_scatter/';
export var SS_VARIANT_COUNT = 64;

// MOVED VERBATIM from worker-chunk-renderer.js lines ~881-1035 — do not edit entries.
export var SS_BIOME_OBJECTS = { /* paste the full existing catalog here */ };

// Generated in Step 1 from assets/_states. 'biome/object' -> available states.
var SS_STATES = { /* paste generated map here */ };

var STATE_CHANCE = 0.22;        // share of placements that use a state sprite
var MAX_PER_TILE = 2;
var TILE_ART_PX = 32;           // art px per tile (claim space)
var CELLS = 8;                  // 8x8 claim cells per tile
var CELL_PX = TILE_ART_PX / CELLS;

var EMPTY = [];
var _placeCache = new Map();    // 'wx,wy' -> placements
var _maskCache = new Map();     // 'wx,wy' -> Uint8Array(8) row bitmasks
var MAX_CACHE = 20000;

function cachePut(map, key, val) {
  if (map.size >= MAX_CACHE) map.clear(); // deterministic — safe to drop wholesale
  map.set(key, val);
  return val;
}

// tileInfo(wx, wy) -> { biome, transition } | null  (caller-supplied lookup)
export function f3Placements(wx, wy, tileInfo) {
  var key = wx + ',' + wy;
  var hit = _placeCache.get(key);
  if (hit) return hit;
  var t = tileInfo(wx, wy);
  if (!t || t.transition) return EMPTY; // don't cache null tiles (may load later)
  var objs = SS_BIOME_OBJECTS[t.biome];
  if (!objs) return cachePut(_placeCache, key, EMPTY);
  var out = [];
  for (var oi = 0; oi < objs.length && out.length < MAX_PER_TILE; oi++) {
    var obj = objs[oi];
    var sparsity = obj.sparsity || 0.93;
    if (rand2(wx, wy, 9500 + oi) > (1.0 - sparsity)) continue; // SAME seeds as today
    var scale = obj.scale || 0.32;
    var ux = 0.5 + (rand2(wx, wy, 9520 + oi) - 0.5) * 0.6;     // tile units
    var uy = 0.5 + (rand2(wx, wy, 9530 + oi) - 0.5) * 0.6;
    var drawPx = TILE_ART_PX * scale;
    var p = {
      name: obj.name, biome: t.biome,
      variant: Math.floor(rand2(wx, wy, 9510 + oi) * SS_VARIANT_COUNT),
      ux: ux, uy: uy, scale: scale,
      angle: (rand2(wx, wy, 9540 + oi) - 0.5) * 0.5,
      alpha: 0.85 + rand2(wx, wy, 9550 + oi) * 0.15,
      state: null,
      // base footprint ellipse, world art px, centered at the sprite base
      bx: (wx + ux) * TILE_ART_PX,
      by: (wy + uy) * TILE_ART_PX + drawPx * 0.32,
      fw: drawPx * 0.55, fh: drawPx * 0.30,
    };
    var states = SS_STATES[t.biome + '/' + obj.name];
    if (states && states.length && rand2(wx, wy, 9560 + oi) < STATE_CHANCE) {
      p.state = states[Math.floor(rand2(wx, wy, 9561 + oi) * states.length)];
    }
    // self-spacing within the tile: reject if base centers closer than the
    // sum of half-widths (looser than ellipse-touch — debris may abut)
    var ok = true;
    for (var pi = 0; pi < out.length; pi++) {
      var q = out[pi];
      var dx = p.bx - q.bx, dy = p.by - q.by;
      if (dx * dx + dy * dy < (p.fw + q.fw) * (p.fw + q.fw) * 0.36) { ok = false; break; }
    }
    if (ok) out.push(p);
  }
  return cachePut(_placeCache, key, out.length ? out : EMPTY);
}

export function f3SpriteUrl(p) {
  if (p.state) {
    return SS_BASE_PATH + '_states/' + p.biome + '/' + p.name +
      '/ss__' + p.biome + '__' + p.name + '__state__' + p.state + '.png';
  }
  var v = p.variant;
  var idx = v < 10 ? '00' + v : (v < 100 ? '0' + v : '' + v);
  return SS_BASE_PATH + p.biome + '/' + p.name +
    '/ss__' + p.biome + '__' + p.name + '__v' + idx + '.png';
}

// 8x8 bitmask of claimed cells for tile (wx,wy). Row r bit c = cell claimed.
// Scans this tile + 8 neighbors (F3 max reach: jitter 0.3 tile + half base
// width ~6px ≈ well under one tile). Raise the radius when F4+ register.
export function getClaimMask(wx, wy, tileInfo) {
  var key = wx + ',' + wy;
  var hit = _maskCache.get(key);
  if (hit) return hit;
  var mask = new Uint8Array(CELLS);
  var ox = wx * TILE_ART_PX, oy = wy * TILE_ART_PX;
  for (var ny = -1; ny <= 1; ny++) {
    for (var nx = -1; nx <= 1; nx++) {
      var pls = f3Placements(wx + nx, wy + ny, tileInfo);
      for (var i = 0; i < pls.length; i++) {
        var p = pls[i];
        // rasterize the base ellipse into this tile's cells (center test)
        var c0 = Math.max(0, Math.floor((p.bx - p.fw - ox) / CELL_PX));
        var c1 = Math.min(CELLS - 1, Math.floor((p.bx + p.fw - ox) / CELL_PX));
        var r0 = Math.max(0, Math.floor((p.by - p.fh - oy) / CELL_PX));
        var r1 = Math.min(CELLS - 1, Math.floor((p.by + p.fh - oy) / CELL_PX));
        for (var r = r0; r <= r1; r++) {
          for (var c = c0; c <= c1; c++) {
            var px = ox + (c + 0.5) * CELL_PX, py = oy + (r + 0.5) * CELL_PX;
            var ex = (px - p.bx) / p.fw, ey = (py - p.by) / p.fh;
            if (ex * ex + ey * ey < 1.0) mask[r] |= (1 << c);
          }
        }
      }
    }
  }
  return cachePut(_maskCache, key, mask);
}

// Point test in world art px — used by F2 to cull blades.
export function isClaimedAt(px, py, tileInfo) {
  var wx = Math.floor(px / TILE_ART_PX), wy = Math.floor(py / TILE_ART_PX);
  var mask = getClaimMask(wx, wy, tileInfo);
  var c = Math.floor((px - wx * TILE_ART_PX) / CELL_PX);
  var r = Math.floor((py - wy * TILE_ART_PX) / CELL_PX);
  if (c < 0) c = 0; else if (c > 7) c = 7;
  if (r < 0) r = 0; else if (r > 7) r = 7;
  return (mask[r] & (1 << c)) !== 0;
}

export function clearClaimCaches() { _placeCache.clear(); _maskCache.clear(); }
```

Move the catalog: cut `SS_BIOME_OBJECTS` (worker-chunk-renderer.js ~881-1035) and the `SS_BASE_PATH`/`SS_VARIANT_COUNT` vars into the module verbatim; in worker-chunk-renderer.js replace with
`import { SS_BIOME_OBJECTS, SS_BASE_PATH, SS_VARIANT_COUNT } from '../world/decoration-claims.js';` so the worker still compiles unchanged otherwise.

- [ ] **Step 3: Check `src/core/world-seed.js` is node-safe**

`rand2` defaults its seed from `getWorldSeed()`. Read `src/core/world-seed.js`; if it touches `window`/`localStorage` at import time, the test must set a seed via its exported setter (or the module's import will throw under node — in that case guard the access in world-seed.js with `typeof window !== 'undefined'`, which is a 1-line fix, not a refactor).

- [ ] **Step 4: Write the failing/then-passing node test**

```js
// scripts/test-decoration-claims.mjs   (run: node scripts/test-decoration-claims.mjs)
import { f3Placements, getClaimMask, isClaimedAt, clearClaimCaches } from '../src/world/decoration-claims.js';

const tileInfo = (wx, wy) => ({ biome: 'grassland', transition: false });
let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); fails++; } };

// determinism across cache clears (simulates worker vs main thread)
const a = JSON.stringify(f3Placements(100, 200, tileInfo));
clearClaimCaches();
const b = JSON.stringify(f3Placements(100, 200, tileInfo));
ok(a === b, 'placements deterministic');
const m1 = Array.from(getClaimMask(100, 200, tileInfo)).join(',');
clearClaimCaches();
const m2 = Array.from(getClaimMask(100, 200, tileInfo)).join(',');
ok(m1 === m2, 'masks deterministic');

// somewhere in a 50x50 region there are placements, and every placement's
// base center cell is claimed in its own tile's mask
let found = 0;
for (let wy = 0; wy < 50; wy++) for (let wx = 0; wx < 50; wx++) {
  for (const p of f3Placements(wx, wy, tileInfo)) {
    found++;
    ok(isClaimedAt(p.bx, p.by, tileInfo), `base center claimed @${wx},${wy}`);
  }
}
ok(found > 10, 'grassland 50x50 produced >10 placements, got ' + found);

// transition tiles and unknown biomes produce nothing
ok(f3Placements(5, 5, () => ({ biome: 'grassland', transition: true })).length === 0, 'transition skip');
ok(f3Placements(5, 5, () => ({ biome: 'nope', transition: false })).length === 0, 'unknown biome skip');

console.log(fails ? `${fails} FAILURES` : 'all decoration-claims tests passed');
process.exit(fails ? 1 : 0);
```

- [ ] **Step 5: Run it** — `node scripts/test-decoration-claims.mjs` → expect `all decoration-claims tests passed`. Also run a quick game smoke (dev server, fresh incognito, chunk paint works — catalog import must not break the worker).

- [ ] **Step 6: Commit** — `git add src/world/decoration-claims.js scripts/test-decoration-claims.mjs src/render/worker-chunk-renderer.js && git commit -m "feat: shared deterministic decoration claim module (F3 catalog + masks)"`

---

### Task 2: Worker bakes F3 from shared placements, sorted, with states

**Files:**
- Modify: `src/render/worker-chunk-renderer.js` (`applySmallScatterToChunk` ~line 1040, its callsite in `renderChunkToBitmap` ~line 1261)
- Modify: `src/render/wang-image-list.js` (`getSmallScatterImageURLsForBiomes` line 390 — add state URLs; replace its private `SS_BIOME_OBJECTS_LIST` name source with the shared catalog so the two lists can never diverge)

- [ ] **Step 1: Rewrite `applySmallScatterToChunk`**

```js
import { SS_BIOME_OBJECTS, f3Placements, f3SpriteUrl } from '../world/decoration-claims.js';

function applySmallScatterToChunk(ctx, chunk, tileSize, chunkSize, imageCache) {
  var hasSS = false;
  for (var i = 0; i < chunk.tiles.length; i++) {
    if (SS_BIOME_OBJECTS[chunk.tiles[i].biome]) { hasSS = true; break; }
  }
  if (!hasSS) return;
  var tileInfo = function (wx, wy) {
    var tx = wx - chunk.cx * chunkSize, ty = wy - chunk.cy * chunkSize;
    if (tx < 0 || ty < 0 || tx >= chunkSize || ty >= chunkSize) return null;
    var t = chunk.tiles[ty * chunkSize + tx];
    return t ? { biome: t.biome, transition: !!t.transitionPair } : null;
  };
  // Collect every placement for the chunk, then draw far-to-near (base-Y
  // sort) — perfect stacking regardless of jitter (replaces raster order).
  var all = [];
  for (var ty2 = 0; ty2 < chunkSize; ty2++) {
    for (var tx2 = 0; tx2 < chunkSize; tx2++) {
      var wx2 = chunk.cx * chunkSize + tx2, wy2 = chunk.cy * chunkSize + ty2;
      var pls = f3Placements(wx2, wy2, tileInfo);
      for (var pi = 0; pi < pls.length; pi++) {
        var p = pls[pi];
        all.push({
          p: p,
          // chunk-local px; tileSize is the baked px-per-tile (== 32 art px scaled)
          x: (p.ux + tx2) * tileSize + (p.bx - (wx2 + p.ux) * 32) * 0, // ux already includes offset
          cx: tx2 * tileSize + p.ux * tileSize,
          cy: ty2 * tileSize + p.uy * tileSize,
          drawSize: tileSize * p.scale,
        });
      }
    }
  }
  all.sort(function (a, b) {
    return (a.cy + a.drawSize / 2) - (b.cy + b.drawSize / 2);
  });
  for (var di = 0; di < all.length; di++) {
    var e = all[di], pl = e.p;
    var bmp = imageCache.get(f3SpriteUrl(pl));
    if (!bmp && pl.state) bmp = imageCache.get(f3SpriteUrl({ ...pl, state: null })); // state PNG missing -> base variant
    if (!bmp) continue;
    var half = e.drawSize * 0.5;
    ctx.save();
    ctx.translate(e.cx, e.cy);
    ctx.rotate(pl.angle);
    ctx.globalAlpha = pl.alpha;
    ctx.drawImage(bmp, -half, -half, e.drawSize, e.drawSize);
    ctx.restore();
  }
  ctx.globalAlpha = 1.0;
}
```

Delete the stray `x:` line if redundant (`cx`/`cy` are the draw center). Update the callsite in `renderChunkToBitmap` (~line 1261): drop the now-unused `occupancy, cellsPerTile, cellPx, gridW` arguments and any code that built them solely for scatter (verify with grep that nothing else consumes them before removing).

- [ ] **Step 2: Preload state URLs** — in `getSmallScatterImageURLsForBiomes` (wang-image-list.js:390), additionally push, for every `'biome/object'` key of the shared `SS_STATES` map (export it or export a `f3StateUrlsForBiomes(biomes)` helper from decoration-claims.js), each state URL `_states/{biome}/{object}/ss__{biome}__{object}__state__{state}.png`. Source object names from the shared `SS_BIOME_OBJECTS` (drop the duplicated `SS_BIOME_OBJECTS_LIST` names for scatter).

- [ ] **Step 3: Visual check** — dev server + fresh incognito Playwright (CDP screenshot, wait `/bitmaps (\d+)/ >= 9`): grassland and forest scenes show debris (incl. occasional state sprites — burned/decayed tints), no console errors, no missing-image 404 storms beyond the known pre-existing ones. Capture a chunk-border region: debris near borders uncut and stacked correctly (no pebble drawn over a *nearer* one).

- [ ] **Step 4: Commit** — `git commit -am "feat: F3 bakes from shared placements, base-Y sorted, with lifecycle state pool"`

---

### Task 3: F2 respects claims + debug hook

**Files:**
- Modify: `src/render/field2-animator.js` (`buildTileDescriptor` ~line 565)
- Modify: `src/main.js` (debug hook)

- [ ] **Step 1: Cull claimed blades in `buildTileDescriptor`**

Add import: `import { getClaimMask, isClaimedAt } from '../world/decoration-claims.js';`

Inside the blade loop, immediately after `offUX`/`offUY` are rolled (they're in the `blades.push` literal — hoist the two rolls above the push), insert:

```js
    var offUX = (rand2(wx, wy, 7030 + bi) - 0.5) * 1.1;
    var offUY = (rand2(wx, wy, 7031 + bi) - 0.5) * 1.1;
    // F3+ claim test: blade root in world art px (root sits ~0.35 tile
    // below sprite center). Claimed cell -> the blade never existed.
    var rootPx = (wx + 0.5 + offUX) * 32;
    var rootPy = (wy + 0.5 + offUY) * 32 + 0.35 * 32;
    if (isClaimedAt(rootPx, rootPy, _claimTileInfo(chunkStore))) continue;
```

with a tiny memoized adapter near the top of the file (avoid re-allocating per blade):

```js
var _ctiStore = null, _ctiFn = null;
function _claimTileInfo(chunkStore) {
  if (_ctiStore === chunkStore && _ctiFn) return _ctiFn;
  _ctiStore = chunkStore;
  _ctiFn = function (wx, wy) {
    var t = chunkStore.tileAt(wx, wy);
    return t ? { biome: t.biome, transition: !!t.transitionPair } : null;
  };
  return _ctiFn;
}
```

and use the hoisted `offUX`/`offUY` vars in the existing `blades.push` literal (replace the two inline `rand2` expressions — same seeds, identical values). Note `tileAt` may return null for unloaded neighbors: `f3Placements` already declines to cache null-tile results, and this tile's descriptor is itself uncacheable in that situation (existing `cacheable=false` path covers it).

- [ ] **Step 2: Debug hook** — in `src/main.js`, alongside the existing `window.atmo` hook:

```js
import('./world/decoration-claims.js').then(function (m) {
  window._claims = {
    mask: function (wx, wy) { return Array.from(m.getClaimMask(wx, wy, function (x, y) {
      var t = window._dbgChunkStore && window._dbgChunkStore.tileAt(x, y);
      return t ? { biome: t.biome, transition: !!t.transitionPair } : null; })); },
    at: m.isClaimedAt, clear: m.clearClaimCaches,
  };
});
```

(Expose `window._dbgChunkStore` next to `window._dbgRenderer` if not already exposed — one line.)

- [ ] **Step 3: Verify no-pierce invariant (Playwright)** — freeze noon, grassland: evaluate in page — for 200 random tiles around the player, every `f3Placements` base center must satisfy `window._claims.at(p.bx, p.by, ...)` AND re-derive blade roots from the same seeds, asserting none lands claimed. Also visually: screenshot a dense debris area; no grass blade visibly rooted *inside* a stone/shell (eyeball + save screenshot for the user).

- [ ] **Step 4: Perf sanity** — with DevTools-less probe: average `drawField2Animations` frame cost before/after (performance.now around the call via a temporary page hook or existing #stats); descriptor build is one-time per tile — confirm steady-state frame time unchanged (±10%).

- [ ] **Step 5: Commit** — `git commit -am "feat: F2 flora respects F3 claim masks (no blades through debris)"`

---

### Task 4: End-to-end verification + docs

**Files:**
- Create: `C:\Users\daves\AppData\Local\Temp\pwtest\claims-verify.js` (throwaway)
- Modify: memory `project_decoration_fields.md` (F3 status), spec (verification notes)

- [ ] **Step 1: Combined run** — fresh incognito: (a) chunk compile time sample vs pre-change baseline (within noise); (b) screenshots of grassland/forest/desert debris fields at noon + golden hour (shadow/atmosphere interplay sanity); (c) console clean; (d) node test still green.
- [ ] **Step 2: Capture 3 user-facing screenshots** to `screenshots/_f3_<biome>.png` (grassland, forest, desert).
- [ ] **Step 3: Update memory** `project_decoration_fields.md`: F3 placed via shared claim module, states wired, F2 culling active; F4 next (joins sprite y-sort batch + registers claims).
- [ ] **Step 4: Commit** — `git add -A docs/ && git commit -m "docs: field layering verification notes"`

---

## Self-review notes

- **Spec coverage:** shared module (T1), draw-order contract base-Y sort + cross-chunk apron via tileInfo (T2 — note: neighbor *chunk* tiles return null from the chunk-local tileInfo; placements near borders still bake because each chunk bakes its own tiles' placements, and claim masks on the F2 side use the full chunkStore which spans chunks), F2 culling (T3), states-as-variant-pools (T1 §SS_STATES + T2), seed compatibility (same 9500-series rolls), testing (T1 node + T3/T4 Playwright). Max-2-per-tile and self-spacing in `f3Placements`.
- **Type consistency:** `f3Placements` returns `{name,biome,variant,ux,uy,scale,angle,alpha,state,bx,by,fw,fh}` — consumed by `f3SpriteUrl` (T1), worker draw (T2), tests (T1/T3). `tileInfo(wx,wy)->{biome,transition}|null` everywhere.
- **Known deviation risk:** worker `tileInfo` is chunk-local, so a *placement* query for a neighbor-chunk tile returns null inside the worker (affects only `getClaimMask` if ever called worker-side — it isn't in this plan; the worker only calls `f3Placements` for its own tiles). F2-side masks use chunkStore and are correct across borders.
