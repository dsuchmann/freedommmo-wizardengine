# Interior Facade-Extension (W/E +1 Tile) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** The diegetic walk-in interior reads one tile too narrow on the W and E sides. The EXTERIOR (building-occluder.js) draws `south_corner_west` at `sx - t` and `south_corner_east` at `sx + t` — one tile OUTSIDE the footprint columns — so the on-screen building is one tile wider on each side than the raw footprint. `interior-gl.js` hugs the footprint exactly, so its side walls land one screen column inside the exterior facade. The user prefers the WIDER exterior shape. This lane extends the INTERIOR render (floor blit + N back-wall end-caps + E/W side-wall pilasters) outward by the SAME one-tile corner extension so the interior side walls land on the SAME screen columns as the exterior facade — while keeping player collision on the TRUE footprint so the extra visual tile stays NON-walkable.

**Architecture:** A new pure, node:test-able helper `interiorFacadeExtension(footprintSet, boundingBox)` (exported from `active-interior.js`, this lane's owned model file) computes, per W/E edge run, the extra screen column the exterior corner-extension occupies — mirroring the occluder's per-tile `wo`/`eo` (west-outside / east-outside) corner-placement precedence. `interior-gl.js` (this lane's render file) consumes it to (a) blit the floor one tile outward at each W/E edge tile, (b) draw an N back-wall end-cap one tile outward at each N-edge tile whose W/E neighbour is outside, and (c) shift the E/W pilaster anchor column outward by one tile. Collision (`active-interior.js` `isWalkableLocal`/`isInFootprint`) is UNCHANGED — it already reads `ai.footprint`/`layout`, which exclude the extension band, so the extra tile is non-walkable by construction; a regression test locks that in. This is a render-only change; the generated footprint, the exterior corner placement, claims, the `9` click-set, shadows, the roof clamp, floor-partition, and the 5,040-task asset matrix are all UNTOUCHED. NO new 2D top-pass: the interior already composites via `glc.drawSceneOverlayBitmap` (interior-gl.js builds an offscreen bitmap that canvas-renderer blits into the scene FBO before present) — this lane only adds blits to that SAME offscreen bitmap, so the extension inherits GL lighting/CRT/day-night identically (GL-only rule satisfied).

**Tech Stack:** JS (browser canvas/GL + node:test), no build step.

---

## File Structure

| File | Ownership | Responsibility / change |
|---|---|---|
| `src/render/active-interior.js` | THIS LANE (owned) | ADD exported pure helper `interiorFacadeExtension(footprintSet, boundingBox)` returning `{ floorCells:[{lx,ly}], northCaps:[{lx,ly,side}], westRuns:[{runStart,runEnd}], eastRuns:[...] }` — the W/E corner-extension band, mirroring the occluder's per-tile corner precedence. Collision predicates (`isWalkableLocal`, `isInFootprint`) UNCHANGED (they already exclude the extension band). |
| `src/render/interior-gl.js` | THIS LANE (owned) | CONSUME the helper: extend the floor blit, the NORTH back-wall end-caps, and the E/W pilaster anchor columns outward by one tile (`CORNER_EXTEND_TILES = 1`, matching occluder `sx ± t`). Render-only. |
| `sim/test/interior-facade-extension.test.js` | THIS LANE (NEW test, allowed — `sim/test/**` is shared test space, staged by exact name) | node:test for `interiorFacadeExtension` geometry + a collision regression test proving the extension band is NON-walkable (`isWalkableLocal`/`isInFootprint` return false there). |

**Out of this lane (DO NOT edit; file a by-name patch request to COORDINATION if needed):** `sim/world/buildings/resolved-buildings.js` (northClaim/relocate), `building-material-registry.js`, `building-renderer.js`, `wall-config.js`, `building-occluder.js` (exterior writer — INTERIOR mirrors it, never edits it), `canvas-renderer.js`, `building-tile-query.js`. The sim model files in my glob (`footprints.js`, `building-floors.js`, `blueprint-node.js`, `floor-layout.js`, `layout.js`) need NO change for this fix.

**Merge order (per spec sequencing, step 7):** lands AFTER BUILDING-RENDER (Lane B) finalizes the exterior corner/E/W geometry, so the interior mirrors the right screen columns. The `CORNER_EXTEND_TILES` constant in Task 4 mirrors the occluder's CURRENT 1-tile corner offset; re-sync it if Lane B changes that offset.

---

### Task 1 — Pin the exterior corner geometry the interior must mirror (no code; reference capture)

**Files:** read-only — `src/render/building-occluder.js`, `src/render/interior-gl.js`, `src/render/wall-config.js`.

1. - [ ] Open `src/render/building-occluder.js` and confirm the EXTERIOR corner placement (the thing the interior must mirror):
   - NORTH walls, line ~164/170-171: `const wo = !floorSet.has((lx - 1) + ',' + nr), eo = !floorSet.has((lx + 1) + ',' + nr);` then `if (wo && wi.south_corner_west) facadeTile(wi.south_corner_west, 0, sx - t, sy, vb); else if (eo && wi.south_corner_east) facadeTile(wi.south_corner_east, 3, sx + t, sy, vb);` — west corner dest-x is `sx - t`, east is `sx + t`, where `sx = tsx(b.x + lx)`. ONE corner per tile (else-if).
   - SOUTH walls, line ~227-229: same `wo`/`eo`, `facadeTile(..., sx - t, ...)` / `facadeTile(..., sx + t, ...)`. Confirm the corner extends exactly ONE tile (`t`) outward on each side.
2. - [ ] Open `src/render/interior-gl.js` and confirm the CURRENT (un-extended) interior geometry it must extend:
   - Floor blit, line ~106-113: iterates `ai.footprint` only (stops at footprint).
   - NORTH back-wall, line ~134-141: per N-edge tile, one `cx.drawImage(base, 0, 8, 32, 112, sx, sy, t+wp, wH+wp)` at `sx = sxAt(ai.bx + lx)` — NO end-cap one tile outward.
   - E/W pilasters, line ~148-165: `boundaryX = side < 0 ? lx : lx + 1;` `const cxC = sxAt(ai.bx + boundaryX);` — post center sits ON the footprint boundary line, NOT one tile outward.
3. - [ ] Confirm in `src/render/wall-config.js` that `cornerExtend: 0` is a SEPARATE wall-draw mechanism (used by `wall-draw.js`/`building-renderer.js`), NOT the occluder's hardcoded `± t` corner offset. The interior mirrors the OCCLUDER's hardcoded 1-tile offset, so this lane introduces its own `CORNER_EXTEND_TILES = 1` constant (Task 4) and does NOT read `WALL_CONFIG.cornerExtend`.
4. - [ ] No commit (reference task). Record the anchors so Tasks 2–4 quote real lines.

---

### Task 2 — Failing test: `interiorFacadeExtension` returns the W/E corner-extension band

**Files:** create `sim/test/interior-facade-extension.test.js`; (impl in Task 3) `src/render/active-interior.js`.

1. - [ ] Create `sim/test/interior-facade-extension.test.js` with a failing geometry test (the helper does not exist yet):
```js
// sim/test/interior-facade-extension.test.js — pure geometry of the interior facade-extension
// band: the one-tile W/E corner extension the exterior (building-occluder.js sx-t / sx+t) draws
// but the footprint-hugging interior must MIRROR. Pure; no canvas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interiorFacadeExtension } from '../../src/render/active-interior.js';

// Footprint-LOCAL tile set (keys 'x,y'), like ai.footprint built in enterAt().
function fset(cells) { return new Set(cells.map(([x, y]) => x + ',' + y)); }

test('rectangle: each row contributes a west run and an east run one tile outward', () => {
  // 3-wide x 2-tall rectangle at local origin: cols 0..2, rows 0..1.
  const fp = fset([[0,0],[1,0],[2,0],[0,1],[1,1],[2,1]]);
  const bb = { x0: 0, y0: 0, w: 3, h: 2 };
  const ext = interiorFacadeExtension(fp, bb);
  // West runs hug local col 0 (the run is described in EDGE-row indices); east runs hug col 2.
  assert.deepEqual(ext.westRuns, [{ runStart: 0, runEnd: 2 }], 'one contiguous west run rows 0..1 (runEnd exclusive)');
  assert.deepEqual(ext.eastRuns, [{ runStart: 0, runEnd: 2 }], 'one contiguous east run rows 0..1 (runEnd exclusive)');
});

test('rectangle: floorCells covers exactly one extra column on each side, per row', () => {
  const fp = fset([[0,0],[1,0],[2,0],[0,1],[1,1],[2,1]]);
  const bb = { x0: 0, y0: 0, w: 3, h: 2 };
  const ext = interiorFacadeExtension(fp, bb);
  const got = new Set(ext.floorCells.map(c => c.lx + ',' + c.ly));
  // west extra col = -1 (each row), east extra col = +3 (each row). No interior duplicates.
  assert.deepEqual([...got].sort(), ['-1,0','-1,1','3,0','3,1'].sort());
});

test('north end-caps: only N-edge tiles whose W or E neighbour is outside, one tile outward', () => {
  const fp = fset([[0,0],[1,0],[2,0],[0,1],[1,1],[2,1]]);
  const bb = { x0: 0, y0: 0, w: 3, h: 2 };
  const ext = interiorFacadeExtension(fp, bb);
  // Row 0 is the north edge (no tile at y=-1). NW corner tile (0,0) → west cap at lx=-1;
  // NE corner tile (2,0) → east cap at lx=+3. Middle (1,0) has both neighbours inside → no cap.
  const caps = ext.northCaps.map(c => c.lx + ',' + c.ly + ',' + c.side).sort();
  assert.deepEqual(caps, ['-1,0,-1', '3,0,1'].sort());
});

test('single-tile-wide row extends BOTH sides (west-then-east), not double on one side', () => {
  // A 1-wide column: col 0, rows 0..1. Each tile is both west AND east edge.
  const fp = fset([[0,0],[0,1]]);
  const bb = { x0: 0, y0: 0, w: 1, h: 2 };
  const ext = interiorFacadeExtension(fp, bb);
  assert.deepEqual(ext.westRuns, [{ runStart: 0, runEnd: 2 }]);
  assert.deepEqual(ext.eastRuns, [{ runStart: 0, runEnd: 2 }]);
  const got = new Set(ext.floorCells.map(c => c.lx + ',' + c.ly));
  assert.deepEqual([...got].sort(), ['-1,0','-1,1','1,0','1,1'].sort());
});
```
2. - [ ] Run it; expect FAIL — the import of a non-existent export throws / undefined-is-not-a-function:
```
node --test sim/test/interior-facade-extension.test.js
```
   Expected FAIL message: `TypeError: interiorFacadeExtension is not a function` (or `(0 , interiorFacadeExtension)(...)`), all 4 tests erroring.
3. - [ ] Commit the failing test:
```
git add sim/test/interior-facade-extension.test.js
git commit -m "$(cat <<'EOF'
test(interior): failing spec for interiorFacadeExtension W/E corner-extension band

Note: locks the one-tile W/E extension geometry the interior must mirror from the exterior occluder.
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3 — Implement `interiorFacadeExtension` in `active-interior.js` (pure; collision untouched)

**Files:** modify `src/render/active-interior.js`; test `sim/test/interior-facade-extension.test.js`.

1. - [ ] In `src/render/active-interior.js`, add the pure helper at the END of the file (after `dimAlphaForFloor`, before EOF). It mirrors the occluder's per-tile corner precedence: a tile is a NORTH end-cap source if it has no north neighbour AND (no west neighbour → west cap) ELSE (no east neighbour → east cap); but for the FLOOR + side-RUNS the interior needs BOTH W and E edges, so floor/runs use independent west-edge and east-edge tests. Insert exactly:
```js

/**
 * Pure geometry of the INTERIOR facade-extension band — the one-tile W/E corner extension that
 * the EXTERIOR (building-occluder.js draws south_corner_west at sx-t, south_corner_east at sx+t,
 * one tile OUTSIDE the footprint) projects but the footprint-hugging interior must MIRROR so its
 * side walls land on the SAME screen columns as the exterior facade. Footprint-LOCAL throughout.
 *
 * @param {Set<string>} footprintSet  ai.footprint — local 'x,y' keys.
 * @param {{x0:number,y0:number,w:number,h:number}} bb  building.footprint.boundingBox.
 * @returns {{ floorCells:{lx:number,ly:number}[],
 *             northCaps:{lx:number,ly:number,side:number}[],
 *             westRuns:{runStart:number,runEnd:number}[],
 *             eastRuns:{runStart:number,runEnd:number}[] }}
 *   floorCells: extra floor tiles (one tile outward) at every W/E edge tile.
 *   northCaps: extra N back-wall caps (one tile outward) at N-edge tiles whose W/E neighbour is
 *              outside (side=-1 west, +1 east) — mirrors the occluder's wo/eo corner on the N wall.
 *   west/eastRuns: contiguous edge-row runs per side (runEnd EXCLUSIVE) for the pilaster posts.
 */
export function interiorFacadeExtension(footprintSet, bb) {
  const has = (x, y) => footprintSet.has(x + ',' + y);
  const floorCells = [], northCaps = [], westRuns = [], eastRuns = [];
  const x0 = bb.x0, y0 = bb.y0;
  // FLOOR: one extra tile outward at every W/E edge tile (independent west + east tests).
  for (let ly = y0; ly < y0 + bb.h; ly++) {
    for (let lx = x0; lx < x0 + bb.w; lx++) {
      if (!has(lx, ly)) continue;
      if (!has(lx - 1, ly)) floorCells.push({ lx: lx - 1, ly });   // west edge → extend west
      if (!has(lx + 1, ly)) floorCells.push({ lx: lx + 1, ly });   // east edge → extend east
    }
  }
  // NORTH caps: N-edge tile (no north neighbour) whose W or E neighbour is outside → one cap outward.
  for (let ly = y0; ly < y0 + bb.h; ly++) {
    for (let lx = x0; lx < x0 + bb.w; lx++) {
      if (!has(lx, ly) || has(lx, ly - 1)) continue;               // not a north-facing edge tile
      if (!has(lx - 1, ly)) northCaps.push({ lx: lx - 1, ly, side: -1 });
      if (!has(lx + 1, ly)) northCaps.push({ lx: lx + 1, ly, side: +1 });
    }
  }
  // RUNS per side: contiguous vertical runs of edge tiles (runEnd EXCLUSIVE), one set per column.
  const runsForSide = (side, out) => {
    for (let lx = x0; lx < x0 + bb.w; lx++) {
      let runStart = null;
      for (let ly = y0; ly <= y0 + bb.h; ly++) {
        const isEdge = ly < y0 + bb.h && has(lx, ly) && !has(lx + side, ly);
        if (isEdge && runStart === null) runStart = ly;
        if (!isEdge && runStart !== null) { out.push({ runStart, runEnd: ly }); runStart = null; }
      }
    }
  };
  runsForSide(-1, westRuns);
  runsForSide(+1, eastRuns);
  return { floorCells, northCaps, westRuns, eastRuns };
}
```
2. - [ ] Run the test; expect PASS:
```
node --test sim/test/interior-facade-extension.test.js
```
   Expected PASS: `# pass 4  # fail 0`. (If `westRuns`/`eastRuns` mismatch, verify `runEnd` is EXCLUSIVE — `ly` is one past the run's last tile, matching the interior-gl loop convention at line ~159.)
3. - [ ] Confirm the rest of the building suite is still green (the helper is additive; collision predicates unchanged):
```
node --test sim/test/active-interior.test.js sim/test/buildings-floor-layout.test.js
```
   Expected: the pre-existing `changeFloor steps and clamps` failure in `active-interior.test.js` remains (UNRELATED — floor-count drift; see open concerns), everything else green. Do NOT touch that test.
4. - [ ] Commit:
```
git add src/render/active-interior.js sim/test/interior-facade-extension.test.js
git commit -m "$(cat <<'EOF'
feat(interior): pure interiorFacadeExtension — the one-tile W/E corner-extension band

Note: mirrors the exterior occluder's sx-t/sx+t corner so the interior can match the wider facade; collision predicates unchanged.
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4 — Failing collision regression: extension band is NON-walkable

**Files:** modify `sim/test/interior-facade-extension.test.js`; (no impl needed — proves collision already excludes the band).

1. - [ ] Append a collision regression test to `sim/test/interior-facade-extension.test.js` that enters a building WITH explicit footprint sections, then asserts every extension cell is OUTSIDE the footprint and NON-walkable. Add at the end:
```js

import * as AI from '../../src/render/active-interior.js';
import { buildingNode } from '../world/buildings/blueprint-node.js';

// A building whose footprint.* fields are FULLY populated (enterAt reads sections + doors + node),
// so ai.footprint is the real footprint-local set (origin 0), like generateFootprint produces.
function fakeBuildingWithFootprint(x, y) {
  const ctx = { bx: 0, by: 0, typeId: 'house', category: 'house', tier: 'village', centrality: 0.1 };
  const sections = [{ x0: 0, y0: 0, w: 3, h: 2 }];
  return { x, y, footprint: { sections, doors: [{ x: 1, y: 1 }], node: buildingNode(1337, { ...ctx, sections }) } };
}

test('facade-extension band is NON-walkable and outside the footprint (collision stays on the true footprint)', () => {
  const b = fakeBuildingWithFootprint(0, 0);
  const ai = AI.enterAt(b);
  const ext = interiorFacadeExtension(ai.footprint, b.footprint.sections.reduce((bb, s) => ({
    x0: Math.min(bb.x0, s.x0), y0: Math.min(bb.y0, s.y0),
    w: Math.max(bb.x0 + bb.w, s.x0 + s.w) - Math.min(bb.x0, s.x0),
    h: Math.max(bb.y0 + bb.h, s.y0 + s.h) - Math.min(bb.y0, s.y0),
  }), { x0: Infinity, y0: Infinity, w: 0, h: 0 }));
  assert.ok(ext.floorCells.length > 0, 'rectangle produces extension cells');
  for (const c of ext.floorCells) {
    assert.equal(AI.isInFootprint(c.lx, c.ly), false, `extension (${c.lx},${c.ly}) is OUTSIDE the footprint`);
    assert.equal(AI.isWalkableLocal(c.lx, c.ly), false, `extension (${c.lx},${c.ly}) is NON-walkable`);
  }
  AI.exitInterior();
});
```
2. - [ ] Run it; expect PASS immediately (this proves the EXISTING collision predicates already exclude the band — no impl change). If it FAILS, that means `isInFootprint`/`isWalkableLocal` leak into the extension band — STOP and re-derive; the whole point is the visual tile must stay non-walkable:
```
node --test sim/test/interior-facade-extension.test.js
```
   Expected PASS: `# pass 5  # fail 0`.
3. - [ ] Commit:
```
git add sim/test/interior-facade-extension.test.js
git commit -m "$(cat <<'EOF'
test(interior): regression — facade-extension band stays outside footprint and non-walkable

Note: locks the collision guarantee that the extra visual W/E tile is never walkable.
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5 — Consume the helper in `interior-gl.js`: extend floor + N back-wall caps

**Files:** modify `src/render/interior-gl.js`. (Render change — verified visually in Task 6; this task wires the floor + N-cap blits and is split from the E/W pilaster shift so each commit is small.)

1. - [ ] In `src/render/interior-gl.js`, add the import and a one-tile constant. Change the import line (currently line ~15):
```js
import { getActiveInterior, isInside } from './active-interior.js';
```
   to:
```js
import { getActiveInterior, isInside, interiorFacadeExtension } from './active-interior.js';
```
2. - [ ] Add the corner-extension constant next to `INTERIOR_WALL_THICKNESS` (after line ~24):
```js
// One-tile W/E corner extension that MIRRORS the exterior occluder (building-occluder.js draws
// south_corner_west at sx-t, south_corner_east at sx+t — one tile OUTSIDE the footprint). The
// interior extends its floor + back-wall caps + side pilasters outward by this so its side walls
// land on the SAME screen columns as the wider exterior facade. Re-sync if BUILDING-RENDER changes
// the exterior corner offset. Collision stays on the TRUE footprint (active-interior.js).
const CORNER_EXTEND_TILES = 1;
```
3. - [ ] In `buildInteriorSceneBitmap`, AFTER the `const bb = ai.building.footprint.boundingBox;` line (~129), compute the extension band once:
```js
  const ext = interiorFacadeExtension(fset, bb);
```
4. - [ ] Extend the FLOOR blit: the floor loop (line ~106-113) currently iterates only `ai.footprint`. Immediately AFTER that `if (floorImg) { ... }` block (after line ~113), append the extension-floor blit so the extra W/E column gets the same floor texture (so the player sees floor — not void — under the wider side wall):
```js
  if (floorImg) {
    for (const c of ext.floorCells) {
      const fx = sxAt(ai.bx + c.lx), fy = syAt(ai.by + c.ly);
      if (fx + t < 0 || fy + t < 0 || fx > w || fy > h) continue;
      cx.drawImage(floorImg, fx, fy, t + wp, t + wp);
    }
  }
```
5. - [ ] Extend the NORTH back wall: the N loop (line ~134-141) draws `base` at each N-edge tile. Immediately AFTER that `for (const k of fset) { ... }` loop (after line ~141), append the N end-cap blit, drawn one tile outward (`c.side * CORNER_EXTEND_TILES`) at the SAME crop/scale as the exterior `facadeTile` for non-pilot pieces (`0,8,32,112`), matching the back-wall billboard:
```js
  // NORTH end-caps — one tile outward at N-edge corners (mirrors the exterior occluder's wo/eo
  // corner on the back wall), so the back wall reaches the wider facade's W/E columns.
  for (const c of ext.northCaps) {
    const sx = sxAt(ai.bx + c.lx + (c.side < 0 ? 0 : 0)) ; // c.lx is already the outward column
    const sy = syAt(ai.by + c.ly) - wH + Math.round(t * NY);
    if (sx + t < 0 || sx > w || sy + wH < 0 || sy > h) continue;
    cx.drawImage(base, 0, 8, 32, 112, sx, sy, t + wp, wH + wp);
  }
```
   (Note: `c.lx` is already the extended column from the helper, so no extra `± t` math is needed — `sxAt` maps it directly; `CORNER_EXTEND_TILES` is reflected in the helper producing `lx-1`/`lx+1`.)
6. - [ ] Run the existing suite to confirm no model regressions (the render file is not unit-tested, but the import must resolve and other interior tests must still pass):
```
node --test sim/test/interior-facade-extension.test.js sim/test/active-interior.test.js
```
   Expected: `interior-facade-extension` all green; `active-interior` unchanged (pre-existing `changeFloor` failure remains, everything else green).
7. - [ ] Commit:
```
git add src/render/interior-gl.js
git commit -m "$(cat <<'EOF'
feat(interior): extend floor + north back-wall caps to the wider exterior facade columns

Note: mirrors the exterior occluder's one-tile W/E corner extension for the floor and back wall; pilasters in the next commit.
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6 — Shift the E/W pilasters outward + visual verification

**Files:** modify `src/render/interior-gl.js`. Visual check via in-game harness.

1. - [ ] In `src/render/interior-gl.js`, shift the E/W pilaster anchor column outward by one tile so the side wall lands on the exterior corner column. Replace the boundary-X line in the E/W loop (line ~151):
```js
      const boundaryX = side < 0 ? lx : lx + 1;            // post sits on the outer tile boundary
```
   with:
```js
      // Anchor the post on the WIDER exterior facade column (one tile beyond the footprint edge),
      // mirroring the occluder's south_corner_{west,east} at sx-t / sx+t. side<0 (west) → one tile
      // further west; side>0 (east) → one tile further east. CORNER_EXTEND_TILES === 1.
      const boundaryX = side < 0 ? lx - CORNER_EXTEND_TILES : lx + 1 + CORNER_EXTEND_TILES;
```
   (West boundary was `lx`; now `lx - 1`. East boundary was `lx + 1`; now `lx + 2`. This moves the post center one full tile outward on each side, landing it on the exterior corner column.)
2. - [ ] Run the suite once more to confirm nothing broke at import/parse:
```
node --test sim/test/interior-facade-extension.test.js
```
   Expected: `# pass 5  # fail 0`.
3. - [ ] Commit the pilaster shift:
```
git add src/render/interior-gl.js
git commit -m "$(cat <<'EOF'
feat(interior): shift E/W pilasters one tile outward to the exterior facade columns

Note: interior side walls now land on the SAME screen columns as the wider exterior facade.
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```
4. - [ ] VISUAL VERIFICATION (render change is not unit-testable). Start the NODE server on :8123 (NOT python :8000 — python single-threads and starves the sprite `<img>` loads):
```
HOST=localhost:8123 node sim/server/main.js
```
   (If the repo's serve entrypoint differs, use the project's documented :8123 launcher — the rule is NODE :8123, hard-reload/incognito because workers cache.)
5. - [ ] Capture a BEFORE/AFTER pair. Spawn at a known building via `?x=&y=` (use the building's world tile), walk through the south doorway into the interior, then take a raw CDP `Page.captureScreenshot` (Playwright `page.screenshot` HANGS on the rAF game — use raw CDP). Compare:
   - **Side walls:** the interior W and E side walls must land on the SAME screen columns as the EXTERIOR facade's `south_corner_west`/`south_corner_east` (step outside the doorway and back in, or compare against the exterior before entry). Before the fix the interior side walls sit one column INSIDE the exterior; after, they coincide.
   - **Floor:** floor texture (not void) now fills the extra W/E column under the side walls.
   - **North wall:** the back wall reaches the same W/E columns (end-caps present at the corners).
6. - [ ] COLLISION SPOT-CHECK (the load-bearing guarantee). Walk the player to the W and E edge and confirm the player CANNOT step into the new visual extension column — collision still stops on the true footprint (this is already guaranteed by Task 4's test; confirm it holds in-game). Press `9` for the building overlay to sanity-check the footprint matches the click-set (unchanged).
7. - [ ] If the side walls land one column too far OUT or still one column too far IN, the exterior corner offset differs from this lane's assumed 1 tile — re-read `building-occluder.js` lines ~170-171/228-229 for Lane B's FINAL corner dest-x and adjust `CORNER_EXTEND_TILES` (or the `boundaryX` formula) to match, then re-commit `src/render/interior-gl.js` by name. Do NOT edit the occluder.
8. - [ ] Final commit (only if step 7 required an adjustment; otherwise skip):
```
git add src/render/interior-gl.js
git commit -m "$(cat <<'EOF'
fix(interior): re-sync W/E facade-extension to the final exterior corner offset

Note: interior side walls verified on the same screen columns as the exterior facade in-game.
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review (spec coverage for Lane D)

- **Lane fix delivered:** the interior, which hugged the footprint exactly, now extends the floor blit (Task 5), the NORTH back-wall end-caps (Task 5), and the E/W side-wall pilasters (Task 6) outward by the SAME one-tile corner extension the EXTERIOR occluder draws (`sx - t` / `sx + t`), so the interior side walls land on the SAME screen columns as the wider exterior facade. ✔
- **Driven off the visual facade-extension band, NOT `layout.bounds`/`units`:** the new pure helper `interiorFacadeExtension` (Task 3) derives the band from the per-tile W/E footprint edges (mirroring the occluder's `wo`/`eo` corner precedence), exactly as the spec requires — `layout.bounds`/`units` stop at the footprint and have no tiles in the extension band, so they are NOT used. ✔
- **Footprint + exterior corner placement UNTOUCHED:** no edit to `footprints.js`, `resolved-buildings.js`, the occluder's corner placement, claims, the `9` click-set, shadows, the roof clamp, floor-partition, or the asset matrix. The change is INTERIOR-render-only (`interior-gl.js`) plus a pure helper in this lane's `active-interior.js`. ✔
- **Collision stays on the TRUE footprint:** `isWalkableLocal`/`isInFootprint` are UNCHANGED and already exclude the extension band; Task 4 adds a regression test proving every extension cell is `isInFootprint === false` and `isWalkableLocal === false`, so the extra visual tile is NON-walkable. ✔
- **GL-only (CLAUDE.md non-negotiable):** the extension blits are added to the SAME offscreen bitmap `interior-gl.js` already builds and hands to `glc.drawSceneOverlayBitmap` (blitted into the scene FBO before present) — NO new 2D `ctx` top-pass for world content; the extension inherits GL lighting/CRT/day-night identically. ✔
- **No-mock / spatial-pieces:** no faked system; the extension reuses the real `south_base` wall piece and the real floor sprite at the real 32px geometry — buildings stay 32px sprite pieces. ✔
- **Dependency + merge order noted:** depends on BUILDING-RENDER's final corner/E/W geometry (`CORNER_EXTEND_TILES` mirrors the current 1-tile offset; Task 6 step 7 re-syncs if Lane B changes it); merges AFTER Lane B per spec sequencing step 7. ✔
- **Ownership glob respected + stage-by-name:** only `src/render/{interior-gl,active-interior}.js` and the new `sim/test/interior-facade-extension.test.js` are written; every commit stages by exact path (never `git add -A`); each commit message ends with a one-line note. No SERIALIZED hot file is touched (no COORDINATION patch request needed for this fix). ✔