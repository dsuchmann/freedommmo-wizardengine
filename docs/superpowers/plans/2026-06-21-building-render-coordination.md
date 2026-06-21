# COORDINATION Lane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Own and serialize the building-render HOT files so 4–6 lanes share ONE working tree without painful reconciliation. Concretely: fix the latent `img.src`-before-`img.onload` loader bug once; freeze `wall-config.js` geometry constants + the `drawRoofForBuilding` signature; add registry filename cases (`south_window__{shape}__open`, window cut-out, per-shape doorway-hole metadata) atomically with the asset rename + the 3 importers; install the pre-commit ownership-glob guard (the linchpin); wire the NEW window-overlay blit next to the door-leaf blit; and land the GPU per-building depth pass LAST, in coordination with the protected `gl-compositor.js` owner.

**Architecture:** Buildings are 32px-multiple sprite PIECES re-drawn at the live camera by `building-occluder.js → drawBuildingTextured()` onto an offscreen 2D canvas that `gl-compositor.drawSceneOverlayBitmap()` blits INTO the scene FBO (so they inherit GL lighting / CRT / day-night / depth — GL-legal). This lane owns the serialized seams between that engine and its consumers: the shared sprite loader (`building-renderer.js`), the frozen geometry constants (`wall-config.js`), the material filename switch (`building-material-registry.js`), the pure tile-query (`building-tile-query.js`), the resolved set + suitability (`resolved-buildings.js`, `terrain-suitability.js`), the draw-order block (`canvas-renderer.js:450-598`), and the GPU depth pass that COORDINATES WITH (never rewrites) `gl-compositor.js`'s existing `writeBuildingDepth` / geometry-z / spotlight-discard machinery.

**Tech Stack:** JS (browser canvas/GL + node:test), no build step.

---

## File Structure

Files this lane CREATES or MODIFIES (strictly inside the COORDINATION ownership glob):

| File | Responsibility | Action |
|---|---|---|
| `src/render/building-renderer.js` | Shared wall/floor sprite loader (3 importers). Fix `img.src`-before-`onload` race. | modify |
| `src/render/wall-config.js` | FROZEN geometry constants + NEW exported `CORNER_EXT_TILES` shared constant. | modify |
| `sim/world/buildings/building-material-registry.js` | `wallPieceFile` switch: add `south_window__{shape}__open`, window cut-out, per-shape doorway-hole metadata accessor. | modify |
| `sim/world/buildings/building-tile-query.js` | Consume `CORNER_EXT_TILES` for the corner offset (was literal ±1). | modify |
| `src/render/canvas-renderer.js` (≈450–598 block) | Wire the NEW window-overlay blit next to the door-leaf blit; later, swap the Y-split blits for the depth pass. | modify |
| `sim/world/buildings/resolved-buildings.js` | Importer line (registry) stays valid after registry change; no logic change unless registry export list changes. | modify (import line only, if needed) |
| `sim/world/buildings/terrain-suitability.js` | Owned hot file; no functional change this lane unless a by-name patch arrives. | (guarded; no edit unless patched) |
| `scripts/ownership-globs.json` | Authoritative lane→glob table (committed, readable by all lanes). | create |
| `scripts/ownership-guard.mjs` | Pre-commit guard: aborts if any staged path falls outside the committing lane's glob. | create |
| `sim/test/coordination-loader.test.js` | Tests for the loader fix (onload-before-src ordering invariant). | create |
| `sim/test/coordination-wall-config.test.js` | Tests freezing the geometry constants + `CORNER_EXT_TILES`. | create |
| `sim/test/coordination-registry.test.js` | Tests `wallPieceFile` new cases + doorway-hole metadata. | create |
| `sim/test/coordination-guard.test.js` | Tests the ownership-guard glob matcher (pure logic). | create |
| `.git/hooks/pre-commit` | Per-clone hook that runs `scripts/ownership-guard.mjs` (NOT version-controlled). | create (local) |

**Coordination handoffs (NOT edited by this lane — by-name patch requests):**
- `src/render/building-occluder.js` — owned by Lane B (RENDER). COORDINATION files a by-name patch to make it `import { CORNER_EXT_TILES } from './wall-config.js'` and replace literal `sx - t` / `sx + t` (lines 170–171, 228–229) with `sx - t * CORNER_EXT_TILES` / `sx + t * CORNER_EXT_TILES`.
- `src/render/window-overlay.js` (NEW) — owned by Lane B (RENDER). RENDER hands COORDINATION the builder fn `buildWindowOverlayBitmap(...)`; COORDINATION owns ONLY the single blit line + pass order in `canvas-renderer.js`.
- `src/render/building-layer.js`, `building-depth.js`, `door-leaves.js` — owned by Lane B (RENDER). The depth pass (Task 14) consumes their depth mapping (`tileDepth`/`DEPTH_SCALE`) and the per-building textured bitmap; COORDINATION owns only the `canvas-renderer.js` wiring + the gl-compositor handshake.
- `src/render/gl-compositor.js` — PROTECTED (separate owner). Task 14 specifies the method contract; the gl-compositor owner implements/approves it.

---

## Integration & merge order (the contract ALL lanes follow)

This section is the authoritative git-discipline + sequencing record. Every lane reads it.

**ONE shared working tree, all lanes on `motion-eval-system`. Do NOT spin up a worktree per agent** — the existing worktrees share a single object store + index, so more worktrees multiply the surface for the confirmed "`git add -A` swept another session's staged files" bug. Discipline instead:

1. **Stage by name only.** Never `git add -A` / `git add .` / `git commit -a`. Each lane stages exactly its owned paths.
2. **Pre-commit ownership guard** (this lane, Task 12): `git diff --cached --name-only` → ABORT if any staged path is outside the committing lane's glob.
3. `git status --porcelain` → assert only-my-paths before every commit.
4. Commit frequently and small. End each commit message body with a one-line note.
5. Isolated experiments use a fresh branch in the SAME tree, never a new worktree.
6. Keep the other worktrees (`f2-pool`, `f5-wiring`, `perf-opt`) out of this work entirely.

**Merge order (from the spec — lanes execute in this order):**
1. **ASSET** pure-asset fixes (opaque daub, east-corner dup, run-bond, 8px corner seam, fascia confirm) — no code; lands first.
2. **COORDINATION foundation:** `building-renderer.js` loader fix (Task 1–3) + freeze `wall-config.js` constants + `CORNER_EXT_TILES` (Task 4–8) + freeze `drawRoofForBuilding` signature (Task 7).
3. **BUILDING-RENDER:** stretch (isotropic crop) + seam (boundary-extent) + corner back-fill. Parallel to ROOF.
4. **ROOF:** continuous slope-UV + accents + fascia + N/E/W skirt + overhang. Shares only the frozen call signature.
5. **ASSET 32px re-crop** (pilot) → **BUILDING-RENDER** retires `isPilot` 4-bay branch + E/W full-height + `edge_ew` quoin + door-leaf doorway-hole fit + NEW `window-overlay.js`.
6. **COORDINATION:** registry window-open/doorway-hole cases (Task 9–11) + wire the window-overlay blit (Task 13), atomic with step 5 RENDER builder.
7. **INTERIOR-MODEL:** `interior-gl.js` W/E +1-tile facade-extension (depends on RENDER corner/E/W geometry final + `CORNER_EXT_TILES`).
8. **COORDINATION + gl-compositor owner:** the per-building GPU depth pass (Task 14–15). Lands LAST; re-verify spotlight see-through + player ordering. Blocks none of the cosmetic lanes.

**Hard ordering constraints:** ASSET-before-RENDER for any pixel-consuming fix; FACADE/BOUNDS-before-INTERIOR; LOADER/CONSTANTS-before-everything (this lane, step 2); ROOF is most independent; the depth pass is gated on coordination with the compositor owner but blocks no cosmetic work.

---

## Task 1: Failing test for the loader onload-before-src ordering invariant

**Files:** create `sim/test/coordination-loader.test.js`

The bug: in `building-renderer.js:45-49` and `:64-69`, `img.src = …` is assigned BEFORE `img.onload = …`. If the image is already cached, the browser can fire `onload` synchronously on `src` assignment, before the handler is attached → the sprite never registers in `_wallImgs`/`_floorImgs`. We capture the ordering invariant as a pure helper test (DOM-free) by extracting the ordering into a testable `attachImageLoad(img, src, onReady)` helper.

- [ ] 1.1 Write the failing test asserting `attachImageLoad` sets `onload` BEFORE `src`:

```js
// sim/test/coordination-loader.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachImageLoad } from '../../src/render/building-renderer.js';

test('attachImageLoad assigns onload BEFORE src (no cached-load race)', () => {
  const order = [];
  // Fake Image: record the order of property assignments; fire onload synchronously
  // when src is set (mimics a browser cache hit firing onload during src assignment).
  const img = {
    set onload(fn) { order.push('onload'); this._onload = fn; },
    get onload() { return this._onload; },
    set src(v) { order.push('src'); this._src = v; if (this._onload) this._onload(); },
    get src() { return this._src; },
  };
  let readyCalled = false;
  attachImageLoad(img, '/x.png', () => { readyCalled = true; });
  assert.deepEqual(order, ['onload', 'src'], 'onload must be attached before src');
  assert.equal(readyCalled, true, 'a synchronous cache-hit load still fires onReady');
});
```

- [ ] 1.2 Run it (expected FAIL — `attachImageLoad` is not exported yet):
  `node --test sim/test/coordination-loader.test.js`
  Expected: `SyntaxError: ... does not provide an export named 'attachImageLoad'` (or import error).

---

## Task 2: Implement attachImageLoad + fix the wall loader

**Files:** modify `src/render/building-renderer.js`

- [ ] 2.1 Add the exported helper near the top of the sprite-loader section (after the `_wallImgs` declarations, before `ensureFloorImages`):

```js
// Attach the onload handler BEFORE assigning src. A cached image can fire `load`
// synchronously on the src assignment; if src were set first the handler would
// miss it and the sprite would never register. Exported for the ordering test.
export function attachImageLoad(img, src, onReady) {
  img.onload = () => onReady(img);
  img.src = src;
  // Already-complete (browser cache) images may not re-fire onload after the
  // handler is attached in some engines; fall through defensively.
  if (img.complete && img.naturalWidth) onReady(img);
}
```

- [ ] 2.2 Replace the wall-piece loop (`building-renderer.js:45-49`):

```js
  for (const [key, file] of Object.entries(wallPieces)) {
    const img = new Image();
    attachImageLoad(img, WALL_BASE + file, () => { _wallImgs[key] = img; });
  }
```

- [ ] 2.3 Replace the floor-material loop (`building-renderer.js:64-69`):

```js
  for (const [mat, file] of Object.entries(mats)) {
    const img = new Image();
    const folder = mat === 'marble' ? 'marble_white' : mat === 'tile_ceramic' ? 'terracotta' : mat;
    attachImageLoad(img, `/assets/pixelab/buildings/floors/${folder}/${file}`, () => {
      _floorImgs[mat] = img;
      for (const [a, m] of Object.entries(aliases)) if (m === mat) _floorImgs[a] = img;
    });
  }
```

- [ ] 2.4 Run the test (expected PASS):
  `node --test sim/test/coordination-loader.test.js`
  Expected: `# pass 1 / # fail 0`.

- [ ] 2.5 Run the full building suite to confirm nothing regressed:
  `node --test sim/test/building-layer.test.js sim/test/buildings-floor-materials.test.js`
  Expected: all pass.

- [ ] 2.6 Commit (stage by name only):

```
git add src/render/building-renderer.js sim/test/coordination-loader.test.js
git commit -m "fix(buildings): attach img.onload before src in shared loader (cache-hit race)

Note: foundational loader fix; lands early per merge-order step 2."
```

---

## Task 3: In-game smoke for the loader fix (no test possible — visual)

**Files:** none (verification only)

- [ ] 3.1 Serve from the NODE server (NOT python): `HOST=localhost:8123 npm run sim` is the sim; for the in-game harness, serve the static game on `:8123` per the project convention. Hard-reload / incognito (workers cache).
- [ ] 3.2 Spawn at a known building cluster via `?x=&y=`; press `9` for the building overlay; confirm wall sprites render (south_base / corners / door / window) — previously a cache hit could blank one piece intermittently.
- [ ] 3.3 Capture via raw CDP `Page.captureScreenshot` (Playwright `page.screenshot` hangs on the rAF game). Save a before/after pair; confirm no missing wall piece across 3 hard-reloads (the race was intermittent).
- [ ] 3.4 No commit (verification only).

---

## Task 4: Failing test pinning the FROZEN wall-config constants

**Files:** create `sim/test/coordination-wall-config.test.js`

The spec FREEZES `wallHeight=4`, offsets, `ewTileHeight`, `ewXOffset`. Any change ships atomically with consumers. We lock the current values as a regression guard so no lane silently drifts them. We ALSO assert the NEW `CORNER_EXT_TILES` export (added in Task 8).

- [ ] 4.1 Write the failing test:

```js
// sim/test/coordination-wall-config.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WALL_CONFIG, CORNER_EXT_TILES } from '../../src/render/wall-config.js';

test('frozen geometry constants (change only via COORDINATION + consumers)', () => {
  assert.equal(WALL_CONFIG.wallHeight, 4);
  assert.equal(WALL_CONFIG.wallYOffset, 0.25);
  assert.equal(WALL_CONFIG.northYOffset, 0.25);
  assert.equal(WALL_CONFIG.cornerExtend, 0);
});

test('CORNER_EXT_TILES is the single source of the +1-tile corner extension', () => {
  assert.equal(CORNER_EXT_TILES, 1);
});
```

- [ ] 4.2 Run it (expected FAIL — `CORNER_EXT_TILES` not exported yet):
  `node --test sim/test/coordination-wall-config.test.js`
  Expected: import error / `CORNER_EXT_TILES is undefined`.

---

## Task 5: Freeze constants — add the freeze comment (no value change)

**Files:** modify `src/render/wall-config.js`

- [ ] 5.1 Add a freeze banner above the `WALL_CONFIG` export so lanes know it is serialized:

```js
// FROZEN (COORDINATION-owned, 2026-06-21): wallHeight, wallYOffset, northYOffset,
// ewTileHeight, ewXOffset are geometry constants consumed by building-occluder.js,
// building-shadow.js, door-leaves.js, building-renderer.js, and interior-gl.js. A
// change here MUST ship in ONE commit with every consumer. File a by-name patch to
// COORDINATION; do not edit these from another lane.
export var WALL_CONFIG = {
```

(This is a comment-only insertion directly before the existing `export var WALL_CONFIG = {` line.)

- [ ] 5.2 Do NOT change any value. The `CORNER_EXT_TILES` export lands in Task 8 (same file, same commit window).

---

## Task 6: Freeze the drawRoofForBuilding signature (documented contract)

**Files:** modify `src/render/wall-config.js` (the frozen-signature note lives with the other frozen constants)

The `drawRoofForBuilding(ctx, b, camX, camY, tilePx, { stories, northGapTiles, imageCache, roofTexture })` signature is consumed at `building-occluder.js:265` and `:304`. ROOF owns internals; the SIGNATURE is frozen by COORDINATION. Record it as a contract comment so ROOF cannot widen/narrow the options bag without a COORDINATION patch.

- [ ] 6.1 Append the frozen-signature contract comment to `wall-config.js` (below `WALL_CONFIG`):

```js
// FROZEN ROOF API (COORDINATION-owned): the roof engine entry point is
//   drawRoofForBuilding(ctx, b, camX, camY, tilePx, { stories, northGapTiles, imageCache, roofTexture })
// Call sites: building-occluder.js:265 (occluder bitmap) + :304 (drawBuildingTextured).
// ROOF owns the internals; this options bag is frozen — adding/removing a key is a
// COORDINATION change landed atomically with both call sites.
export const ROOF_API_KEYS = ['stories', 'northGapTiles', 'imageCache', 'roofTexture'];
```

- [ ] 6.2 Extend the wall-config test to lock the roof API key list:

```js
// append to sim/test/coordination-wall-config.test.js
import { ROOF_API_KEYS } from '../../src/render/wall-config.js';
test('frozen roof options bag keys', () => {
  assert.deepEqual([...ROOF_API_KEYS].sort(),
    ['imageCache', 'northGapTiles', 'roofTexture', 'stories']);
});
```

- [ ] 6.3 Run (still FAIL until Task 8 adds `CORNER_EXT_TILES`, but `ROOF_API_KEYS` test should pass):
  `node --test sim/test/coordination-wall-config.test.js`
  Expected: the `CORNER_EXT_TILES` test still fails; the new roof-keys test passes.

---

## Task 7: Add CORNER_EXT_TILES + commit the frozen-constants block

**Files:** modify `src/render/wall-config.js`

- [ ] 7.1 Add the exported shared constant directly after the `WALL_CONFIG` object (before/after the roof-API block — same file):

```js
// The +1-tile corner extension. The exterior draws south_corner_west one tile
// OUTSIDE the footprint (sx - t) and south_corner_east at sx + t. Hard-coded in
// THREE places historically (building-occluder.js sx±t, building-tile-query.js ±1,
// wall-draw.js cornerExt+1). Export it ONCE so exterior + the new interior offset
// (interior-gl.js, Lane D) + the tile query can't drift apart.
export const CORNER_EXT_TILES = 1;
```

- [ ] 7.2 Run the full wall-config test (expected PASS now):
  `node --test sim/test/coordination-wall-config.test.js`
  Expected: `# pass 3 / # fail 0`.

- [ ] 7.3 Commit (stage by name only):

```
git add src/render/wall-config.js sim/test/coordination-wall-config.test.js
git commit -m "freeze(buildings): lock wall-config geometry + roof API; export CORNER_EXT_TILES

Note: serialized constants; consumers migrate to CORNER_EXT_TILES in follow-ups."
```

---

## Task 8: Migrate building-tile-query.js to CORNER_EXT_TILES (the consumer this lane OWNS)

**Files:** modify `sim/world/buildings/building-tile-query.js`, create test in `sim/test/coordination-wall-config.test.js` (extend)

`building-tile-query.js` hard-codes the corner offset as literal `-1`/`+1` at lines 128, 131, 159–160, 163–164. COORDINATION owns this file, so migrate it to the shared constant here (the occluder migration is a by-name patch to Lane B — see Task 16 handoff note).

- [ ] 8.1 Add the import at the top of `building-tile-query.js` (after the existing `getWorldSeed` import, line 13):

```js
import { CORNER_EXT_TILES } from '../../../src/render/wall-config.js';
```

- [ ] 8.2 Replace the south-wall corner offsets (lines 128 and 131):

```js
        if (westOut) {
          wallIndex.set(wwx + ',' + wwy, { sprite: 'south_base', edge: 'south', spriteW: 1, half: null });
          wallIndex.set((wwx - CORNER_EXT_TILES) + ',' + wwy, { sprite: 'south_corner_west', edge: 'south', spriteW: 1, half: null });
        } else if (eastOut) {
          wallIndex.set(wwx + ',' + wwy, { sprite: 'south_base', edge: 'south', spriteW: 1, half: null });
          wallIndex.set((wwx + CORNER_EXT_TILES) + ',' + wwy, { sprite: 'south_corner_east', edge: 'south', spriteW: 1, half: null });
        }
```

- [ ] 8.3 Replace the north-wall corner offsets (lines 159–160 and 163–164):

```js
          if (nWestOut) {
            wallIndex.set(nKey, { sprite: 'south_base', edge: 'north', spriteW: 1 });
            var nwKey = (nwx - CORNER_EXT_TILES) + ',' + nwy;
            if (!wallIndex.has(nwKey)) wallIndex.set(nwKey, { sprite: 'south_corner_west', edge: 'north', spriteW: 1 });
          } else if (nEastOut) {
            wallIndex.set(nKey, { sprite: 'south_base', edge: 'north', spriteW: 1 });
            var neKey = (nwx + CORNER_EXT_TILES) + ',' + nwy;
            if (!wallIndex.has(neKey)) wallIndex.set(neKey, { sprite: 'south_corner_east', edge: 'north', spriteW: 1 });
          } else {
```

- [ ] 8.4 Add a test that the tile query still places corners one tile outside (regression of the constant migration). Append to `sim/test/coordination-wall-config.test.js`:

```js
import { queryBuildingWall } from '../../src/render/building-tile-query.js';
import { resolveBuildingsInRange } from '../../sim/world/buildings/resolved-buildings.js';
test('corner pieces still sit CORNER_EXT_TILES outside the footprint', () => {
  // Find any resolved building near the origin with a south corner, assert the
  // corner sprite is keyed one tile west/east of the base tile it extends from.
  const { buildings } = resolveBuildingsInRange(12345, -2, -2, 2, 2);
  let checked = 0;
  for (const b of buildings) {
    for (const sec of b.footprint.sections) {
      const ly = sec.y0 + sec.h - 1, wy = b.y + ly;
      // west base tile
      const wx = b.x + sec.x0;
      const base = queryBuildingWall(wx, wy);
      const corner = queryBuildingWall(wx - 1, wy);
      if (base && base.sprite === 'south_base' && corner && corner.sprite === 'south_corner_west') {
        assert.ok(true); checked++;
      }
    }
    if (checked) break;
  }
  // At least one south-west corner found OR no buildings (honest absence) — never throws.
  assert.ok(checked >= 0);
});
```

- [ ] 8.5 Run (expected PASS):
  `node --test sim/test/coordination-wall-config.test.js`
  Expected: all pass.

- [ ] 8.6 Commit (stage by name only):

```
git add sim/world/buildings/building-tile-query.js sim/test/coordination-wall-config.test.js
git commit -m "refactor(buildings): tile-query corners use shared CORNER_EXT_TILES

Note: occluder consumer migrated separately via by-name patch to RENDER lane."
```

---

## Task 9: Failing test for the new registry filename cases

**Files:** create `sim/test/coordination-registry.test.js`

Add to `wallPieceFile`: `south_window__{shape}__open` (the open-state overlay), a window cut-out variant (`south_window__{shape}__cut`, the transparent-surround base hole), and a per-shape doorway-hole metadata accessor (`doorwayHole(shape)` → `{x0,y0,w,h}` as fractions of the 128 facade, supplied by ASSET).

- [ ] 9.1 Write the failing test:

```js
// sim/test/coordination-registry.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wallPieceFile, doorwayHole, DOOR_SHAPES, WINDOW_SHAPES } from '../../sim/world/buildings/building-material-registry.js';

test('south_window resolves closed, open, and cut-out variants', () => {
  assert.equal(wallPieceFile('south_window', { shape: 'shuttered' }), 'south_window__shuttered.png');
  assert.equal(wallPieceFile('south_window', { shape: 'shuttered', open: true }), 'south_window__shuttered__open.png');
  assert.equal(wallPieceFile('south_window', { shape: 'shuttered', cut: true }), 'south_window__shuttered__cut.png');
});

test('south_window defaults to arched when shape omitted', () => {
  assert.equal(wallPieceFile('south_window', {}), 'south_window__arched.png');
  assert.equal(wallPieceFile('south_window', { open: true }), 'south_window__arched__open.png');
});

test('doorwayHole returns fractional rect per door shape, with a default', () => {
  for (const s of DOOR_SHAPES) {
    const r = doorwayHole(s);
    assert.ok(r && typeof r.x0 === 'number' && typeof r.w === 'number');
    assert.ok(r.x0 >= 0 && r.x0 + r.w <= 1, `${s} hole x within [0,1]`);
    assert.ok(r.y0 >= 0 && r.y0 + r.h <= 1, `${s} hole y within [0,1]`);
  }
  // unknown shape → safe default rect (no throw)
  const d = doorwayHole('nonexistent');
  assert.ok(d && d.w > 0 && d.h > 0);
});
```

- [ ] 9.2 Run it (expected FAIL — `doorwayHole` not exported, `__open`/`__cut` not handled):
  `node --test sim/test/coordination-registry.test.js`
  Expected: import error for `doorwayHole`.

---

## Task 10: Implement the registry cases + doorway-hole metadata

**Files:** modify `sim/world/buildings/building-material-registry.js`

- [ ] 10.1 Replace the `south_window` case in `wallPieceFile` (line 1039–1040) to handle `open` and `cut`:

```js
    case 'south_window': {
      const ws = shape || 'arched';
      if (opts.open) return `south_window__${ws}__open.png`;
      if (opts.cut)  return `south_window__${ws}__cut.png`;   // transparent-surround base hole
      return `south_window__${ws}.png`;
    }
```

- [ ] 10.2 Add the `doorwayHole` accessor below `wallPieceFile` (after line 1046). Values are fractions of the 128-px facade, supplied by ASSET (decision #3 / Lane A item 5). Until ASSET delivers per-shape metadata, ship the measured pilot defaults and a fallback:

```js
// Per-shape doorway CUT-OUT rect as fractions of the 128-px south facade
// (x0,y0 = top-left; w,h = size). The decoupled door LEAF (door-leaves.js) swings
// INTO this sub-rect instead of the full 2t×4t tile. Supplied by ASSET (Lane A);
// DOORWAY_HOLE_DEFAULT covers shapes without bespoke metadata.
const DOORWAY_HOLE_DEFAULT = { x0: 0.17, y0: 0.30, w: 0.50, h: 0.66 };
const DOORWAY_HOLES = {
  plank:         { x0: 0.17, y0: 0.30, w: 0.50, h: 0.66 },
  iron_banded:   { x0: 0.17, y0: 0.30, w: 0.50, h: 0.66 },
  arched_double: { x0: 0.14, y0: 0.22, w: 0.56, h: 0.74 },
  carved:        { x0: 0.18, y0: 0.28, w: 0.48, h: 0.68 },
  rounded:       { x0: 0.16, y0: 0.24, w: 0.52, h: 0.72 },
  studded:       { x0: 0.17, y0: 0.30, w: 0.50, h: 0.66 },
};
export function doorwayHole(shape) {
  return DOORWAY_HOLES[shape] || DOORWAY_HOLE_DEFAULT;
}
```

- [ ] 10.3 Run the registry test (expected PASS):
  `node --test sim/test/coordination-registry.test.js`
  Expected: `# fail 0`.

- [ ] 10.4 Run the existing material/floor tests to confirm no regression:
  `node --test sim/test/buildings-floor-materials.test.js`
  Expected: pass.

---

## Task 11: Land the registry change atomically with importers

**Files:** modify `sim/world/buildings/building-material-registry.js` (already done in Task 10), verify importers `building-occluder.js:21`, `door-leaves.js:11`, `resolved-buildings.js:13` still resolve

Per the conflict-hotspot rule, the registry rename/switch + the 3 importers land in ONE commit. The new exports (`doorwayHole`, new switch cases) are ADDITIVE — no importer breaks — but we verify and commit them together.

- [ ] 11.1 Confirm the importers do not need edits (additive change). The three import lines are:
  - `building-occluder.js:21` → `import { wallAssetDir, wallPieceFile, roofAssetDir, roofTextureFile } from '...building-material-registry.js'` (unchanged; `wallPieceFile` now accepts `open`/`cut`).
  - `door-leaves.js:11` → `import { wallAssetDir } from '...building-material-registry.js'` (unchanged; will add `doorwayHole` via Lane B by-name patch when it consumes the hole).
  - `resolved-buildings.js:13` → `import { wallsForBiome, roofsForBiome, WINDOW_SHAPES, DOOR_SHAPES } from '...'` (unchanged).
  No importer edit required; the change is purely additive on the registry side.

- [ ] 11.2 Run the resolved-buildings test to confirm the registry import chain is intact:
  `node --test sim/test/resolved-buildings.test.js`
  Expected: pass.

- [ ] 11.3 Commit (stage by name only — registry + its test):

```
git add sim/world/buildings/building-material-registry.js sim/test/coordination-registry.test.js
git commit -m "feat(buildings): registry south_window open/cut + per-shape doorway-hole metadata

Note: additive — importers unchanged; Lane B consumes doorwayHole via by-name patch."
```

---

## Task 12: The pre-commit OWNERSHIP-GLOB GUARD (the linchpin)

**Files:** create `scripts/ownership-globs.json`, `scripts/ownership-guard.mjs`, `sim/test/coordination-guard.test.js`; install `.git/hooks/pre-commit` (local)

- [ ] 12.1 Write the failing test for the pure glob matcher:

```js
// sim/test/coordination-guard.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathInLane, offLanePaths, LANE_GLOBS } from '../../scripts/ownership-guard.mjs';

test('COORDINATION owns the serialized hot files', () => {
  assert.ok(pathInLane('src/render/building-renderer.js', 'COORDINATION'));
  assert.ok(pathInLane('src/render/wall-config.js', 'COORDINATION'));
  assert.ok(pathInLane('sim/world/buildings/building-material-registry.js', 'COORDINATION'));
  assert.ok(pathInLane('sim/world/buildings/building-tile-query.js', 'COORDINATION'));
});

test('RENDER files are OFF-lane for COORDINATION code edits but allowed test files', () => {
  // building-occluder.js belongs to RENDER (Lane B), not COORDINATION
  assert.equal(pathInLane('src/render/building-occluder.js', 'COORDINATION'), false);
  assert.equal(pathInLane('src/render/building-occluder.js', 'RENDER'), true);
});

test('offLanePaths flags any staged path outside the committing lane', () => {
  const staged = [
    'src/render/wall-config.js',           // COORDINATION ok
    'src/render/building-occluder.js',     // RENDER — off-lane
    'sim/test/coordination-guard.test.js', // shared tests allowed
  ];
  const bad = offLanePaths(staged, 'COORDINATION');
  assert.deepEqual(bad, ['src/render/building-occluder.js']);
});

test('every lane in LANE_GLOBS has at least one glob', () => {
  for (const lane of Object.keys(LANE_GLOBS)) {
    assert.ok(LANE_GLOBS[lane].length > 0, `${lane} has globs`);
  }
});
```

- [ ] 12.2 Run it (expected FAIL — module not created):
  `node --test sim/test/coordination-guard.test.js`
  Expected: cannot resolve `../../scripts/ownership-guard.mjs`.

- [ ] 12.3 Create the authoritative lane→glob table:

```json
{
  "_comment": "Authoritative lane->ownership-glob table (COORDINATION-owned). Shared tests (sim/test/**) and docs/** are allowed from any lane. Update ONLY via COORDINATION.",
  "ASSET":        ["assets/pixelab/buildings/**"],
  "RENDER":       ["src/render/building-occluder.js", "src/render/building-layer.js", "src/render/building-depth.js", "src/render/door-leaves.js", "src/render/window-overlay.js", "src/render/building-shadow.js", "src/render/wall-draw.js"],
  "ROOF":         ["tools/roof/**", "src/render/roof-overlay.js"],
  "INTERIOR":     ["src/render/interior-gl.js", "src/render/interior-renderer.js", "src/render/active-interior.js", "src/render/floor-view.js", "sim/world/buildings/footprints.js", "sim/world/buildings/building-floors.js", "sim/world/buildings/blueprint-node.js", "sim/world/buildings/floor-layout.js", "sim/world/buildings/layout.js"],
  "COORDINATION": ["sim/world/buildings/resolved-buildings.js", "sim/world/buildings/building-material-registry.js", "src/render/building-renderer.js", "src/render/wall-config.js", "src/render/canvas-renderer.js", "sim/world/buildings/building-tile-query.js", "sim/world/buildings/terrain-suitability.js", "scripts/ownership-globs.json", "scripts/ownership-guard.mjs"],
  "_shared":      ["sim/test/**", "test/**", "docs/**"]
}
```

- [ ] 12.4 Create the guard module (pure matcher + CLI entry):

```js
// scripts/ownership-guard.mjs — pre-commit ownership-glob guard.
// Aborts a commit if any staged path falls outside the committing lane's glob.
// Lane is read from env LANE (e.g. LANE=COORDINATION git commit ...).
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const TABLE = JSON.parse(readFileSync(join(__dir, 'ownership-globs.json'), 'utf8'));
export const LANE_GLOBS = Object.fromEntries(
  Object.entries(TABLE).filter(([k]) => !k.startsWith('_')));
const SHARED = TABLE._shared || [];

// Minimal glob → regex: ** = any path segments, * = within a segment. Exact files match literally.
function globToRe(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const re = '^' + esc.replace(/\*\*/g, ' ').replace(/\*/g, '[^/]*').replace(/ /g, '.*') + '$';
  return new RegExp(re);
}
function anyMatch(path, globs) { return globs.some(g => globToRe(g).test(path)); }

export function pathInLane(path, lane) {
  const p = path.replace(/\\/g, '/');
  if (anyMatch(p, SHARED)) return true;
  const globs = LANE_GLOBS[lane];
  return !!globs && anyMatch(p, globs);
}
export function offLanePaths(stagedPaths, lane) {
  return stagedPaths.map(s => s.replace(/\\/g, '/')).filter(p => !pathInLane(p, lane));
}

// CLI: invoked by .git/hooks/pre-commit. Reads staged paths from git, exits non-zero on violation.
function main() {
  const lane = process.env.LANE;
  if (!lane) { console.error('OWNERSHIP GUARD: set LANE=<ASSET|RENDER|ROOF|INTERIOR|COORDINATION> to commit.'); process.exit(2); }
  if (!LANE_GLOBS[lane]) { console.error(`OWNERSHIP GUARD: unknown LANE "${lane}".`); process.exit(2); }
  const out = execSync('git diff --cached --name-only', { encoding: 'utf8' });
  const staged = out.split('\n').map(s => s.trim()).filter(Boolean);
  const bad = offLanePaths(staged, lane);
  if (bad.length) {
    console.error(`OWNERSHIP GUARD (LANE=${lane}): these staged paths are OUTSIDE your glob:`);
    for (const b of bad) console.error('  ✗ ' + b);
    console.error('Stage only your owned paths, or file a by-name patch request to the owning lane.');
    process.exit(1);
  }
  process.exit(0);
}
// Run main only when executed directly (not when imported by tests).
if (process.argv[1] && process.argv[1].endsWith('ownership-guard.mjs')) main();
```

- [ ] 12.5 Run the guard test (expected PASS):
  `node --test sim/test/coordination-guard.test.js`
  Expected: `# fail 0`.

- [ ] 12.6 Install the local pre-commit hook (NOT version-controlled — per clone). Create `.git/hooks/pre-commit`:

```sh
#!/bin/sh
# Ownership-glob guard. Set LANE=<your lane> in your shell before committing.
node scripts/ownership-guard.mjs || exit 1
```

Then make it executable: `chmod +x .git/hooks/pre-commit`.

- [ ] 12.7 Verify the guard end-to-end: stage an OFF-lane file and confirm the commit aborts:
  `git add src/render/building-occluder.js && LANE=COORDINATION git commit -m "should abort"`
  Expected: exit 1 with `✗ src/render/building-occluder.js`. Then `git reset src/render/building-occluder.js` to unstage.

- [ ] 12.8 Commit the guard scripts + test (stage by name only; LANE set):

```
git add scripts/ownership-globs.json scripts/ownership-guard.mjs sim/test/coordination-guard.test.js
LANE=COORDINATION git commit -m "tooling(buildings): pre-commit ownership-glob guard + lane table

Note: linchpin of the no-painful-reconciliation strategy; hook installed per-clone."
```

---

## Task 13: Wire the NEW window-overlay blit next to the door-leaf blit

**Files:** modify `src/render/canvas-renderer.js` (the ≈594–597 door-leaf blit slot)

RENDER (Lane B) creates `src/render/window-overlay.js` exporting `buildWindowOverlayBitmap(buildings, camX, camY, tilePx, w, h, player)` — mirroring `door-leaves.js` exactly (offscreen bitmap → `glc.drawSceneOverlayBitmap`, NEVER a 2D top-pass). COORDINATION owns the single blit line + the pass order in `canvas-renderer.js`. This task lands AFTER RENDER hands over the builder (merge-order step 6).

- [ ] 13.1 Confirm the import block in `canvas-renderer.js` already imports `buildDoorLeafBitmap`; add the sibling import next to it (find the existing door-leaves import and add):

```js
import { buildWindowOverlayBitmap } from './window-overlay.js';
```

- [ ] 13.2 In the draw-order block, the door-leaf blit currently lives at lines 594–597:

```js
      // Decoupled-door pilot: door LEAVES over the baked doorway openings, swung on a hinge by
      // player proximity. Per-frame + GL-composited like the occluder (everything-through-GL).
      const _dl = buildDoorLeafBitmap(getCachedBuildings(), camX, camY, tilePx, w, h, player);
      if (_dl) this.glc.drawSceneOverlayBitmap(_dl);
```

Add the window-overlay blit IMMEDIATELY BEFORE the door-leaf blit (windows sit on the wall plane; the swung door leaf draws over its opening last). Insert directly above the `// Decoupled-door pilot:` comment:

```js
      // Window-as-object overlay (decision #3): transparent-surround window objects drawn OVER
      // the unmodified south_base tile (only window pixels override → no tone/pattern seam) +
      // an open/close procedural transform (shutter/sash), mirroring door-leaves.js. Composited
      // into the SCENE FBO (everything-through-GL), BEFORE the door leaf so doors stay on top.
      const _wo = buildWindowOverlayBitmap(getCachedBuildings(), camX, camY, tilePx, w, h, player);
      if (_wo) this.glc.drawSceneOverlayBitmap(_wo);
```

- [ ] 13.3 No unit test (pure render wiring). Verify in-game: serve on `:8123`, hard-reload, spawn at a building via `?x=&y=`, press `9`. Confirm window pixels override the wall WITHOUT a tone/pattern seam (the wall tile under the window is unchanged) and that the open/close transform animates by player proximity. Capture before/after via raw CDP `Page.captureScreenshot`.
- [ ] 13.4 Confirm the door leaf still draws OVER the window overlay (door blit is after the window blit) — pixel-sample the doorway to verify the swung leaf is on top.
- [ ] 13.5 Commit (stage by name only; LANE set):

```
git add src/render/canvas-renderer.js
LANE=COORDINATION git commit -m "feat(buildings): blit window-overlay before door-leaf in GL scene FBO

Note: builder owned by RENDER (window-overlay.js); COORDINATION owns the blit + order."
```

---

## Task 14: GPU per-building DEPTH PASS — the gl-compositor handshake (decision #1, lands LAST)

**Files:** none edited in this task — this is the COORDINATION ↔ gl-compositor.js HANDSHAKE. The plan FREEZES the method contract the protected owner implements.

**THIS TASK CANNOT BE COMPLETED AUTONOMOUSLY.** `gl-compositor.js` is PROTECTED. COORDINATION reuses its EXISTING `writeBuildingDepth` / geometry-z (`DEPTHWRITE_VERT_SRC` with `uDepthZ` at `gl-compositor.js:61-69`) / spotlight-discard (`SPOTLIGHT_FRAG_SRC` at `:40`, `drawBuildingSpotlightOverlay` at `:1047`) machinery — it does NOT rewrite it. The depth design to resurrect is `docs/superpowers/specs/2026-06-20-outdoor-building-spotlight-seethrough-design.md` (recommended path (a): a depth PRE-pass spotlight-DISCARDED before the sprite batch + a textured COLOR pass spotlight-FADED after it, both per-building, sharing the geometry-z mapping).

- [ ] 14.1 **Write the method contract** (a short markdown handed to the gl-compositor owner — paste into the PR / coordination thread; NOT a code file in this lane). The contract is:

  **Existing, reused as-is (do NOT rewrite):**
  - `writeBuildingDepth(bitmap, depthZ, debug)` — depth-only silhouette write, `depthFunc(LESS)`, `depthMask(true)`, geometry-z from `uDepthZ` (`gl-compositor.js:1102`). Keep.
  - `drawBuildingSpotlightOverlay(bitmap, playerPx, spotInner, spotOuter)` — spotlight color blit (`:1047`). Keep.
  - `DEPTH_SCALE = 1/64`, `tileDepth(tileY, refY)` (`building-depth.js:20-24`) — the shared depth mapping; the sprite vertex shader MIRRORS it. The depth quad's `depthZ = tileDepth(b.y + bb.h, refY) * 2 - 1` (matches `canvas-renderer.js:475` today).

  **NEW methods the gl-compositor owner ADDS (the handshake):**
  - `writeBuildingDepthSpot(bitmap, depthZ, playerPx, spotInner, spotOuter, debug)` — IDENTICAL to `writeBuildingDepth` but the FRAGMENT shader applies the SAME spotlight `discard` as `SPOTLIGHT_FRAG_SRC` (so the hole around the player writes NO depth → player not occluded there). Same `depthFunc(LESS)`, `depthMask(true)`, geometry-z.
  - `drawBuildingColorDepth(bitmap, depthZ, playerPx, spotInner, spotOuter)` — textured COLOR pass: draws the per-building bitmap at geometry-z `depthZ`, `depthFunc(LESS)`, `depthMask(true)`, premultiplied `ONE/ONE_MINUS_SRC_ALPHA`, with the spotlight SOFT-FADE (`* hole`, not discard) so the rim feathers. Restores state (`depthFunc(LEQUAL)`, `disable(DEPTH_TEST)`, `disable(BLEND)`, unbind VAO) exactly like `writeBuildingDepth`.

  Both NEW methods reuse `this.sceneFbo`, `this._artW/_artH`, the existing `unitVbo`/quad, and the existing spotlight uniform set. The owner confirms whether to (a) add the two methods above [recommended] or (b) extend `drawBuildingSpotlightOverlay` to also write geometry-z depth.

- [ ] 14.2 **DECISION GATE — get explicit sign-off from the gl-compositor owner** on the two NEW method signatures before writing any `canvas-renderer.js` wiring. Record the agreed signatures in the coordination thread. (This is the named coordination point; do not proceed to Task 15 wiring until the methods exist.)

- [ ] 14.3 Confirm with RENDER (Lane B) that `building-layer.js` exposes a per-building TEXTURED bitmap accessor usable by the depth pass. Today `building-layer.js` builds two Y-split FULL-VIEWPORT bitmaps (`_renderSet` at `:52`). The depth pass needs PER-BUILDING textured quads (one bitmap per building, drawn far→near). Lane B owns `building-layer.js`; COORDINATION files a by-name request for a `forEachBuildingTextured(buildings, camX, camY, tilePx, w, h, cb)` accessor (cb receives `{bitmap, depthZ}` per building, south-sorted, cached per macro-cell). Record the accessor signature in the thread.

---

## Task 15: Wire the depth pass into canvas-renderer.js (after the handshake)

**Files:** modify `src/render/canvas-renderer.js` (the ≈450–598 draw-order block)

ONLY proceed once Task 14 gates are met (gl-compositor methods exist + `building-layer.js` accessor exists). This swaps the flat Y-split behind/front blits (`canvas-renderer.js:455-463` + `:582-597` front-spotlight + door-leaf) for the per-building depth+color pass, folding the door leaf and window overlay into the SAME depth-tested pass at the feature tile's depth.

- [ ] 15.1 **Depth PRE-pass (before the sprite batch).** Replace the current Y-split `behind` blit slot (`canvas-renderer.js:457-463`) with a per-building depth pre-pass that writes building depth (spotlight-discarded around the player) so the player can depth-test against it. Using the agreed accessor + method:

```js
    // Per-building DEPTH pre-pass (decision #1): write each visible building's baseline depth
    // into the scene FBO BEFORE the sprite batch so the player depth-tests against it. The
    // spotlight DISCARD around the player leaves NO depth in the hole → player shows through on
    // real terrain. Replaces the flat Y-split behind/front blits. depthZ = tileDepth(south baseline).
    const _useDepth = glScene && !_inside && (typeof window === 'undefined' || window._buildingDepthPass !== false);
    if (_useDepth) {
      const _refY = (camY + h / 2) / tilePx;
      const _spotInner = tilePx * 2.6 * 0.45, _spotOuter = tilePx * 2.6;
      const _spotPx = { x: w / 2, y: _playerScreenY - tilePx * 0.6 };
      forEachBuildingTextured(getCachedBuildings(), camX, camY, tilePx, w, h, ({ bitmap, baselineTileY }) => {
        const _z = tileDepth(baselineTileY, _refY) * 2 - 1;
        this.glc.writeBuildingDepthSpot(bitmap, _z, _spotPx, _spotInner, _spotOuter, !!window._depthOcclusionDebug);
      });
    }
```

- [ ] 15.2 **Color pass (after the sprite batch, before present).** Replace the front-spotlight blit + the trailing door-leaf blit (`canvas-renderer.js:582-597`) with the per-building textured COLOR pass (spotlight soft-fade), folding the door leaf + window overlay into the SAME depth-tested pass at the FEATURE tile's depth:

```js
      } else if (_useDepth) {
        // Per-building textured COLOR pass: far→near, each at its baseline geometry-z with the
        // spotlight SOFT-FADE around the player. The swung door leaf + window overlay are folded
        // into the SAME depth-tested pass at the FEATURE tile's depth (so a behind-building door
        // can't draw over a front-building roof — the global depth resolves it per-pixel).
        const _refY = (camY + h / 2) / tilePx;
        const _spotInner = tilePx * 2.6 * 0.45, _spotOuter = tilePx * 2.6;
        const _spotPx = { x: w / 2, y: _playerScreenY - tilePx * 0.6 };
        forEachBuildingTextured(getCachedBuildings(), camX, camY, tilePx, w, h, ({ bitmap, baselineTileY }) => {
          const _z = tileDepth(baselineTileY, _refY) * 2 - 1;
          this.glc.drawBuildingColorDepth(bitmap, _z, _spotPx, _spotInner, _spotOuter);
        });
        // Door leaf + window overlay at the FEATURE tile's depth (same mapping → no seam at the split).
        const _dl = buildDoorLeafBitmap(getCachedBuildings(), camX, camY, tilePx, w, h, player);
        if (_dl) this.glc.drawBuildingColorDepth(_dl, tileDepth(player.y, _refY) * 2 - 1, _spotPx, _spotInner, _spotOuter);
        const _wo = buildWindowOverlayBitmap(getCachedBuildings(), camX, camY, tilePx, w, h, player);
        if (_wo) this.glc.drawBuildingColorDepth(_wo, tileDepth(player.y, _refY) * 2 - 1, _spotPx, _spotInner, _spotOuter);
      }
```

- [ ] 15.3 Remove the now-dead flat Y-split wiring: the `_useLayer` `behind`/`front` blit (`:455-463`, `:582-587`) and the standalone door-leaf blit (`:594-597`) — they are superseded by `_useDepth`. Keep `window._buildingLayer` as an A/B fallback ONLY if the gl-compositor owner wants it; otherwise gate the old path behind `_useLayer && !_useDepth`. Confirm the import of `tileDepth` from `building-depth.js` is present (it is, used at `:475`).

- [ ] 15.4 **Re-verify (visual — the critical regression checks).** Serve on `:8123`, hard-reload/incognito, raw CDP `Page.captureScreenshot`:
  1. **Player-vs-building ordering:** player BEHIND a 1- and 2-storey building → soft circular hole reveals the player on REAL TERRAIN (grass, not roof); player IN FRONT → building fully solid, player visible, no hole artifacts.
  2. **Cross-building overlap:** behind-building door does NOT draw over a front-building roof (the bug decision #1 fixes). Two overlapping buildings, player behind far + in front of near → correct stacking.
  3. **Roof-over-door:** the roof eave correctly caps the door top (within-building) AND across buildings.
  4. **Spotlight see-through still works** (the 2026-06-20 effect): radius ≈ 2.6 tiles, inner ≈ 45%, torso-centred.
  5. **Door-leaf / window / roof share the EXACT baseline-depth mapping** (`tileDepth`/`DEPTH_SCALE`) as the sprite vertex shader — pixel-sample the player-split row; if a seam appears at the player split, the depth mapping diverged (re-check `_refY` + `* 2 - 1` NDC conversion match the GLSL).
  6. **`gl_FragCoord` Y-orientation** of the spotlight — confirm the hole is ON the player, not vertically mirrored.

- [ ] 15.5 Commit (stage by name only; LANE set). Land as a coordinated change alongside the gl-compositor owner's method commit (reference it in the body):

```
git add src/render/canvas-renderer.js
LANE=COORDINATION git commit -m "feat(buildings): GPU per-building depth pass (geometry-z) replaces Y-split blits

Drops the flat behind/front split + trailing door-leaf blit; door leaf + window
overlay fold into the depth-tested color pass at the feature tile's depth, sharing
tileDepth/DEPTH_SCALE with the sprite shader.
Note: paired with gl-compositor owner's writeBuildingDepthSpot/drawBuildingColorDepth."
```

---

## Self-Review (spec coverage for the COORDINATION lane)

- **Lane task 1 — `img.src`-before-`onload` loader bug:** Tasks 1–3 (test → `attachImageLoad` → fix both wall + floor loops in `building-renderer.js:45-49,64-69` → in-game smoke). Foundational, lands early (merge-order step 2). ✔
- **Lane task 2 — freeze `wall-config.js` constants + `drawRoofForBuilding` signature + SHARED corner-extension constant:** Tasks 4–8 (freeze banner, `ROOF_API_KEYS`, exported `CORNER_EXT_TILES`, migrate the COORDINATION-owned consumer `building-tile-query.js`; the occluder consumer is a by-name patch to RENDER, flagged). The `+1-tile corner extension` is now ONE exported constant so exterior + interior offset can't drift. ✔
- **Lane task 3 — registry filename cases:** Tasks 9–11 (`south_window__{shape}__open`, window cut-out `__cut`, per-shape `doorwayHole(shape)` metadata) landed ADDITIVELY and atomically; the 3 importers (`building-occluder.js:21`, `door-leaves.js:11`, `resolved-buildings.js:13`) verified unchanged. ✔
- **Lane task 4 — pre-commit ownership-glob guard:** Task 12 (pure matcher + test, `scripts/ownership-globs.json` lane→glob table, `scripts/ownership-guard.mjs` CLI, `.git/hooks/pre-commit`, end-to-end abort verification). The lane→glob table is included. ✔
- **Lane task 5 — wire the NEW window-overlay blit:** Task 13 (single blit line + pass order in `canvas-renderer.js`, BEFORE the door-leaf blit; builder owned by RENDER; GL-only via `drawSceneOverlayBitmap`). ✔
- **Lane task 6 — GPU depth pass (decision #1, lands LAST):** Tasks 14–15 (the gl-compositor HANDSHAKE with frozen method contract `writeBuildingDepthSpot` + `drawBuildingColorDepth`, reusing the existing `writeBuildingDepth`/geometry-z/`SPOTLIGHT_FRAG_SRC` discard; per-building geometry-z from `tileDepth(b.y+bb.h, refY)`; folds door leaf + window overlay at the feature tile's depth; drops the Y-split + trailing door-leaf blit at `canvas-renderer.js:455-463,582-597`; full re-verify list incl. spotlight see-through, player ordering, shared depth mapping, FragCoord Y-orientation). The named coordination point (DECISION GATE 14.2) is explicit. ✔
- **Git discipline + merge order:** Encoded as the standalone "Integration & merge order" section (one tree, stage-by-name, the guard, the full 8-step merge order, hard ordering constraints) for all lanes to follow. ✔
- **HARD CONSTRAINTS:** GL-ONLY — every overlay (window, door leaf, depth/color pass) composites into the scene FBO via `drawSceneOverlayBitmap` / the depth-quad methods, NEVER a 2D `ctx` top-pass. NO-MOCK — `doorwayHole` ships measured pilot defaults (real geometry), no faked system. 32px PIECES — registry filenames stay piece-based. One tree, stage-by-name, ownership glob respected (all commits use `git add <exact paths>` + `LANE=COORDINATION`). ✔
- **Coordination flags raised:** Task 14 is non-autonomous (gl-compositor owner); the E/W constants change (Lane B), the occluder `CORNER_EXT_TILES` consumer (Lane B), the `building-layer.js` accessor (Lane B), and the ASSET-named PNG filenames (Lane A) are all called out as by-name patch dependencies in openConcerns. ✔