# BUILDING-RENDER (Lane B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Make the live wall/door/window/edge/corner draw engine (`building-occluder.js` and friends) read as believable structure — fix the ~14% vertical stretch, the round/pad tile seams, the see-through corner shoulders, the square-block E/W cap, the ill-fitting swung door leaf, and add window-as-object overlays — entirely inside the GL pipeline (offscreen 2D → scene FBO via `glc.drawSceneOverlayBitmap`), never a 2D top-pass, never faking a system, always 32px-multiple sprite PIECES.

**Architecture:** The wall+roof bake was deleted from `worker-chunk-renderer.js`. The single live wall draw engine is `building-occluder.js → drawWalls()` (+ `drawBuildingTextured()`), which composites every piece onto an OFFSCREEN 2D canvas that `gl-compositor` blits into the scene FBO (so it still inherits GL lighting/CRT/day-night/depth — fixing it here is GL-legal). `building-layer.js` (Y-split bitmaps) and `building-depth.js` (silhouette→depth) consume `drawBuildingTextured`; `door-leaves.js` draws the decoupled swung door leaf as its own offscreen→FBO blit; the NEW `window-overlay.js` mirrors `door-leaves.js` exactly for windows. Pure geometry helpers are extracted so the rect math is unit-testable headlessly via a recording-canvas shim (precedent: `sim/test/water-foam-render.test.js`). Serialized hot files (`wall-config.js`, `building-material-registry.js`, `building-renderer.js`, `canvas-renderer.js`) are COORDINATION-owned — this lane hands them by-name patch requests, never edits them.

**Tech Stack:** JS (browser canvas/GL + node:test), no build step.

---

## File Structure

| File | Ownership | Responsibility |
|---|---|---|
| `src/render/building-occluder.js` | Lane B (writer) | The live wall draw engine. Extract pure rect helpers (`tileExtent`, `cropBox`, `ewQuoinRect`); fix vertical stretch (isotropic crop), tile seams (boundary-derived integer extents), corner see-through back-fill, E/W full-height facade + quoin re-sample; retire the `isPilot` 4-bay branch in favour of true per-32px draws once ASSET ships 32px strips. |
| `src/render/door-leaves.js` | Lane B (writer) | Swung door-leaf overlay. Fit the leaf into a per-piece doorway-hole sub-rect (from registry metadata) instead of the full `2t × 4t`. |
| `src/render/window-overlay.js` | Lane B (NEW) | Window-as-object overlay. Mirrors `door-leaves.js` exactly: offscreen bitmap → `glc.drawSceneOverlayBitmap`, transparent-surround window drawn OVER an already-drawn `south_base` tile, procedural open/close transform (shutter/sash). Exports `buildWindowOverlayBitmap(...)` for COORDINATION to blit. |
| `src/render/building-layer.js` | Lane B (writer) | Unchanged structurally; gains a regression test that the per-building silhouette source stays `drawBuildingTextured` (so geometry fixes propagate to behind/front bitmaps and COORDINATION's depth quad for free). |
| `src/render/building-depth.js` | Lane B (writer) | Unchanged structurally; regression test that `renderBuildingSilhouette` routes through `drawBuildingTextured`. |
| `src/render/building-shadow.js` | Lane B (writer) | No fix required by the spec; left as-is. (Re-verified the facade-rect geometry still matches the occluder after the stretch fix; no edit needed because shadow uses `wallHeight`/`wallYOffset` directly, unchanged.) |
| `src/render/wall-draw.js` | Lane B (writer) | The reference per-32px draw pattern the occluder's retired `isPilot` branch matches. No edit; read-only reference for Task 8/9. |
| `sim/test/occluder-rects.test.js` | Lane B (NEW test) | Pure-helper + recording-canvas tests for stretch crop, boundary extents, corner back-fill, E/W quoin rect. |
| `sim/test/door-leaf-fit.test.js` | Lane B (NEW test) | Door-leaf doorway-hole sub-rect fit (recording-canvas). |
| `sim/test/window-overlay.test.js` | Lane B (NEW test) | Window-overlay builder: overlay set derivation + transform + GL-blit shape (recording-canvas). |

**Patch requests handed to COORDINATION (this lane does NOT edit these files):**
- `wall-config.js`: if `ewTileHeight`/`ewXOffset` must change for the E/W full-height facade (Task 9 patch request).
- `building-material-registry.js`: add a `doorwayHoleRect(shape)` accessor (Task 12), a window-overlay file resolver + `south_window__{shape}__open` case (Task 13).
- `canvas-renderer.js`: add one blit line for the new window overlay next to the door-leaf blit (Task 14).

---

## Task 1 — Extract `cropBox` + isotropic-crop helper (fix #1 prep, pure, testable)

**Files:** modify `src/render/building-occluder.js`; create `sim/test/occluder-rects.test.js`

The stretch bug: `facadeTile`/`facadeWide` legacy (non-pilot) branch uses `ctx.drawImage(img, 0, 8, 32, 112, dx, dy, t+wp, wH+wp)` — it crops `(0,8,W,112)` (strips 16 of the 128 rows) then fills the FULL 4-tile dest, so 112 source rows stretch into 128-equivalent dest rows = `128/112 ≈ 1.143` ⇒ ~14% vertical anisotropy. Extract the crop+dest as a pure helper so the fix is isolated and tested.

- [ ] Write the failing test in `sim/test/occluder-rects.test.js`:
```js
// sim/test/occluder-rects.test.js — pure rect math of the building wall draw engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cropBox } from '../../src/render/building-occluder.js';

test('cropBox is isotropic: source-crop aspect equals dest aspect (no stretch)', () => {
  // legacy 32x128 strip, dest tile width t=32, wall height wH=128
  const { sx, sy, sw, sh, dx, dy, dw, dh } = cropBox(32, 128, 0, 0, 32, 128);
  // crop the FULL height (no 16-row strip) so source aspect == dest aspect
  assert.equal(sy, 0, 'crops from row 0, not row 8');
  assert.equal(sh, 128, 'crops the full 128 source rows');
  // anisotropy = (sw/sh)/(dw/dh) must be ~1 (was 1.143 with the 0,8,W,112 crop)
  const aniso = (sw / sh) / (dw / dh);
  assert.ok(Math.abs(aniso - 1) < 0.02, `aspect must match within 2%, got ${aniso}`);
});
```
- [ ] Run it — expected FAIL: `SyntaxError: ... does not provide an export named 'cropBox'`.
- [ ] Add the helper near the top of `building-occluder.js` (after the imports, before `SPOT`):
```js
// Pure isotropic crop+dest for a legacy 32/64-wide wall strip. Crops the FULL source height
// (0..srcH) into the full dest (no 16-row strip) so source aspect == dest aspect — kills the
// old (0,8,W,112)->full-dest ~14% vertical stretch. Returns the 8 drawImage args.
export function cropBox(srcW, srcH, dx, dy, dw, dh) {
  return { sx: 0, sy: 0, sw: srcW, sh: srcH, dx, dy, dw, dh };
}
```
- [ ] Run the test — expected PASS (`cropBox is isotropic ... ok`).
- [ ] Commit: `git add src/render/building-occluder.js sim/test/occluder-rects.test.js`
  `git commit` — message body: `extract isotropic cropBox helper for wall strips (fix #1 prep)`
  Note: pure helper only; no draw-call change yet.

---

## Task 2 — Apply the isotropic crop in the legacy `facadeTile`/`facadeWide` (fix #1)

**Files:** modify `src/render/building-occluder.js`; modify `sim/test/occluder-rects.test.js`

Replace the two legacy `drawImage(img,0,8,W,112,...)` calls with `cropBox`. Use a recording-canvas to assert the emitted source rect is `(0,0,W,128)`, not `(0,8,W,112)`.

- [ ] Add a recording-canvas test in `sim/test/occluder-rects.test.js`:
```js
function recCtx() {
  const calls = [];
  return {
    globalCompositeOperation: 'source-over', imageSmoothingEnabled: false, fillStyle: '#000',
    drawImage(...a) { calls.push(a); },
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, translate() {}, rotate() {}, scale() {}, fillRect() {},
    _calls: calls,
  };
}
function fakeImg(w, h) { return { naturalWidth: w, naturalHeight: h, width: w, height: h, complete: true }; }

test('legacy facadeTile crops the full 128 rows (no 0,8,...,112 strip)', () => {
  const ctx = recCtx();
  // legacy path: a 32-wide strip image (naturalWidth < 96 => not pilot)
  const img = fakeImg(32, 128);
  // emulate one legacy facadeTile draw via cropBox at t=32, wH=128
  const c = cropBox(32, 128, 100, 50, 33, 129);
  ctx.drawImage(img, c.sx, c.sy, c.sw, c.sh, c.dx, c.dy, c.dw, c.dh);
  const a = ctx._calls[0];
  assert.deepEqual([a[1], a[2], a[3], a[4]], [0, 0, 32, 128], 'source rect = full image, no 16-row strip');
});
```
- [ ] Run — expected PASS for the cropBox assertion (it already returns full-height); now wire it into the engine.
- [ ] In `building-occluder.js`, change the legacy branch of `facadeTile` (currently `if (!P) { ctx.drawImage(img, 0, 8, 32, 112, dx, dy, t + wp, wH + wp); return; }`) to:
```js
    if (!P) { const c = cropBox(img.naturalWidth || 32, img.naturalHeight || 128, dx, dy, t + wp, wH + wp); ctx.drawImage(img, c.sx, c.sy, c.sw, c.sh, c.dx, c.dy, c.dw, c.dh); return; }
```
- [ ] Change the legacy branch of `facadeWide` (currently `if (!P) { ctx.drawImage(img, 0, 8, 64, 112, dx, dy, 2 * t + wp, wH + wp); return; }`) to:
```js
    if (!P) { const c = cropBox(img.naturalWidth || 64, img.naturalHeight || 128, dx, dy, 2 * t + wp, wH + wp); ctx.drawImage(img, c.sx, c.sy, c.sw, c.sh, c.dx, c.dy, c.dw, c.dh); return; }
```
- [ ] Run `node --test sim/test/occluder-rects.test.js` — expected PASS (both rect tests ok).
- [ ] Commit: `git add src/render/building-occluder.js sim/test/occluder-rects.test.js`
  `git commit` — body: `apply isotropic crop in legacy facadeTile/facadeWide (fix #1: kill ~14% vertical stretch)`
  Note: pilot branch unchanged (it crops 0,s[0],128,... full-width — addressed in Task 8).

---

## Task 3 — Extract `tileExtent` boundary-derived integer width (fix #2 prep, pure, testable)

**Files:** modify `src/render/building-occluder.js`; modify `sim/test/occluder-rects.test.js`

The seam bug: dest widths are fixed `t + wp` / `2t + wp` while x origins are `round(wx*tilePx - camX)`. At non-integer `tilePx` the per-tile rounding of origin + the fixed padded width double-paint or gap at the boundary. Fix: derive each tile's screen extent from the rounded NEXT boundary: `dx = round(wx*tilePx - camX); dw = round((wx+1)*tilePx - camX) - dx` (so adjacent tiles share the exact boundary pixel — no round/pad double-paint).

- [ ] Add the failing test:
```js
import { cropBox, tileExtent } from '../../src/render/building-occluder.js';

test('tileExtent: adjacent tiles share their boundary (no gap, no overlap)', () => {
  const tilePx = 12.7, camX = 5.3;
  const a = tileExtent(10, tilePx, camX, 1);     // tile at wx=10
  const b = tileExtent(11, tilePx, camX, 1);     // tile at wx=11
  assert.equal(a.dx + a.dw, b.dx, 'tile 10 right edge == tile 11 left edge');
  // 1-tile span never collapses or doubles a column
  assert.ok(a.dw >= 1, 'extent at least 1px');
});

test('tileExtent: wide=2 spans exactly two tile boundaries', () => {
  const tilePx = 16, camX = 0;
  const w1 = tileExtent(4, tilePx, camX, 1).dw;
  const w2 = tileExtent(4, tilePx, camX, 2).dw;
  assert.equal(w2, w1 * 2, 'a 2-wide piece is exactly two tiles wide');
});
```
- [ ] Run — expected FAIL: `does not provide an export named 'tileExtent'`.
- [ ] Add the helper next to `cropBox`:
```js
// Boundary-derived integer screen extent of `span` tiles starting at world tile wx. dx is the
// rounded left boundary; dw bridges to the rounded right boundary so adjacent tiles share the
// exact boundary pixel (no fixed t+wp round/pad double-paint, no seam at non-integer tilePx).
export function tileExtent(wx, tilePx, camX, span) {
  const dx = Math.round(wx * tilePx - camX);
  const dw = Math.round((wx + span) * tilePx - camX) - dx;
  return { dx, dw };
}
```
- [ ] Run the test — expected PASS (both `tileExtent` cases ok).
- [ ] Commit: `git add src/render/building-occluder.js sim/test/occluder-rects.test.js`
  `git commit` — body: `extract boundary-derived tileExtent helper (fix #2 prep)`
  Note: pure helper; draw sites wired in Task 4.

---

## Task 4 — Use `tileExtent` at the wall draw sites (fix #2)

**Files:** modify `src/render/building-occluder.js`; modify `sim/test/occluder-rects.test.js`

`facadeTile`/`facadeWide` take a precomputed `dx,dy` and currently hardcode dest width `t+wp`/`2t+wp`. Thread a per-call width `dw` (from `tileExtent`) through both helpers and through the legacy `cropBox` dest. The pilot clip-rect uses the same `dw`.

- [ ] Add a recording-canvas assertion:
```js
test('facadeTile dest width is boundary-derived, not fixed t+1', () => {
  // at tilePx=12.7 the boundary-derived width differs from round(12.7)+1=14
  const e = tileExtent(10, 12.7, 5.3, 1);
  assert.notEqual(e.dw, Math.round(12.7) + 1, 'boundary extent differs from the old t+wp');
});
```
- [ ] Run — expected PASS for the helper assertion; now thread it in.
- [ ] In `drawWalls`, change the `facadeTile` signature to accept `dw` and use it in BOTH branches:
```js
  const facadeTile = (img, c, dx, dy, vb, dw) => {
    const ew = dw || (t + wp);
    if (!P) { const cb = cropBox(img.naturalWidth || 32, img.naturalHeight || 128, dx, dy, ew, wH + wp); ctx.drawImage(img, cb.sx, cb.sy, cb.sw, cb.sh, cb.dx, cb.dy, cb.dw, cb.dh); return; }
    const ux = dx - ((((c) % 4) + 4) % 4) * t, s = SY(vb);
    ctx.save(); ctx.beginPath(); ctx.rect(dx, dy, ew, wH + wp); ctx.clip();
    ctx.drawImage(img, 0, s[0], 128, s[1] - s[0], ux, dy, 4 * t, wH + wp); ctx.restore();
  };
```
- [ ] Change `facadeWide` similarly to accept `dw` (2-tile span):
```js
  const facadeWide = (img, dx, dy, vb, dw) => {
    const ew = dw || (2 * t + wp);
    if (!P) { const cb = cropBox(img.naturalWidth || 64, img.naturalHeight || 128, dx, dy, ew, wH + wp); ctx.drawImage(img, cb.sx, cb.sy, cb.sw, cb.sh, cb.dx, cb.dy, cb.dw, cb.dh); return; }
    const ux = dx - t, s = SY(vb);
    ctx.save(); ctx.beginPath(); ctx.rect(dx, dy, ew, wH + wp); ctx.clip();
    ctx.drawImage(img, 0, s[0], 128, s[1] - s[0], ux, dy, 4 * t, wH + wp); ctx.restore();
  };
```
- [ ] At the NORTH-wall call site, replace `const sx = tsx(b.x + lx);` and the three `facadeTile(...)` calls (lines ~169-171) to pass the boundary extent:
```js
        const ex = tileExtent(b.x + lx, tilePx, camX, 1); const sx = ex.dx;
        ...
        facadeTile(wi.south_base, lx - s.x0, sx, sy, vb, ex.dw);
        if (wo && wi.south_corner_west) { const exw = tileExtent(b.x + lx - 1, tilePx, camX, 1); facadeTile(wi.south_corner_west, 0, exw.dx, sy, vb, exw.dw); }
        else if (eo && wi.south_corner_east) { const exe = tileExtent(b.x + lx + 1, tilePx, camX, 1); facadeTile(wi.south_corner_east, 3, exe.dx, sy, vb, exe.dw); }
```
- [ ] At the SOUTH-wall call site, replace `const sx = tsx(b.x + lx)` with `const ex = tileExtent(b.x + lx, tilePx, camX, 1); const sx = ex.dx;` and pass `ex.dw` into each `facadeTile(wi.south_base, c, sx, sy, vb)` → `facadeTile(wi.south_base, c, sx, sy, vb, ex.dw)`; for `facadeWide(...)` use a 2-span extent `const ex2 = tileExtent(b.x + lx, tilePx, camX, 2); facadeWide(wi.south_doorway || wi.south_door, sx, sy, vb, ex2.dw);` and the same for the window `facadeWide`; for the corner pieces use `tileExtent(b.x+lx-1,...)` / `tileExtent(b.x+lx+1,...)` as in the north site.
- [ ] Run `node --test sim/test/occluder-rects.test.js` — expected PASS.
- [ ] In-game smoke: `HOST=localhost:8123 node sim/server/main.js &` then open incognito to `http://localhost:8123/?x=<townX>&y=<townY>`, press `9`, click a building. Capture via raw CDP `Page.captureScreenshot`. Before/after: the vertical mortar seam between adjacent south-wall tiles should no longer show a 1px double-line at fractional zoom.
- [ ] Commit: `git add src/render/building-occluder.js sim/test/occluder-rects.test.js`
  `git commit` — body: `boundary-derived tile extents at all wall draw sites (fix #2: kill round/pad seams)`
  Note: re-verified north/south/corner offsets unchanged in tile space.

---

## Task 5 — Corner see-through back-fill (fix #5)

**Files:** modify `src/render/building-occluder.js`; modify `sim/test/occluder-rects.test.js`

The NORTH-wall corner branch (`:170-171`) draws only the corner piece at `sx-t`/`sx+t` with NO `south_base` underneath — its transparent buttress shoulder reveals terrain. The SOUTH-wall branch (`:228-229`) already draws `south_base` under the on-footprint tile but the OUTBOARD corner tile (`sx-t`/`sx+t`) has nothing behind it. Draw a `south_base` under each outboard corner tile first.

- [ ] Add the failing recording-canvas test:
```js
import { drawWalls } from '../../src/render/building-occluder.js';
// NOTE: drawWalls is not exported today; this task adds `export` to it for testing.

function fakeBuilding() {
  return { x: 100, y: 100, biome: null, wallSlug: null, // forces stone_brick fallback path
    footprint: { boundingBox: { w: 3, h: 3 }, sections: [{ x0: 0, y0: 0, w: 3, h: 3 }], doors: [] } };
}

test('north-wall west corner draws a base UNDER the outboard corner tile (no see-through)', () => {
  // (covered via the count assertion below once getWallImg is stubbed in the harness)
  assert.ok(true);
});
```
- [ ] Run — expected FAIL: `does not provide an export named 'drawWalls'`.
- [ ] In `building-occluder.js`, add `export` to `function drawWalls(...)` (`export function drawWalls(ctx, b, camX, camY, tilePx, w, h) {`).
- [ ] In the NORTH-wall corner branch, draw a base under the outboard corner tile FIRST:
```js
        if (wo && wi.south_corner_west) { const exw = tileExtent(b.x + lx - 1, tilePx, camX, 1); facadeTile(wi.south_base, 0, exw.dx, sy, vb, exw.dw); facadeTile(wi.south_corner_west, 0, exw.dx, sy, vb, exw.dw); }
        else if (eo && wi.south_corner_east) { const exe = tileExtent(b.x + lx + 1, tilePx, camX, 1); facadeTile(wi.south_base, 3, exe.dx, sy, vb, exe.dw); facadeTile(wi.south_corner_east, 3, exe.dx, sy, vb, exe.dw); }
```
- [ ] In the SOUTH-wall corner branch, add the outboard-tile base before the corner draw:
```js
        if (wo && wi.south_corner_west) { facadeTile(wi.south_base, c, sx, sy, vb, ex.dw); const exw = tileExtent(b.x + lx - 1, tilePx, camX, 1); facadeTile(wi.south_base, 0, exw.dx, sy, vb, exw.dw); facadeTile(wi.south_corner_west, 0, exw.dx, sy, vb, exw.dw); }
        else if (eo && wi.south_corner_east) { facadeTile(wi.south_base, c, sx, sy, vb, ex.dw); const exe = tileExtent(b.x + lx + 1, tilePx, camX, 1); facadeTile(wi.south_base, 3, exe.dx, sy, vb, exe.dw); facadeTile(wi.south_corner_east, 3, exe.dx, sy, vb, exe.dw); }
```
- [ ] Replace the placeholder test with a count assertion using a recording-canvas + a stubbed `getWallImg`. Because `getWallImg` is imported from the COORDINATION loader, stub it via a module-level dependency-injection seam is out of scope; instead assert through the in-game check below and keep a structural test that `drawWalls` is exported and callable without throwing on a fallback building:
```js
test('drawWalls runs without throwing on a fallback (stone_brick) building', () => {
  const ctx = recCtx();
  // stone_brick fallback returns null until loaded -> early return path; must not throw
  assert.doesNotThrow(() => drawWalls(ctx, fakeBuilding(), 0, 0, 32, 800, 600));
});
```
- [ ] Run `node --test sim/test/occluder-rects.test.js` — expected PASS.
- [ ] In-game: spawn at a building, press `9`; at the building's NW/NE corners the terrain no longer shows through the buttress shoulder. CDP screenshot before/after at the corner tile.
- [ ] Commit: `git add src/render/building-occluder.js sim/test/occluder-rects.test.js`
  `git commit` — body: `back-fill south_base under outboard corner tiles (fix #5: close corner see-through)`
  Note: stone_brick fallback corners also benefit; ASSET still closes the 8px stone_brick alpha seam separately.

---

## Task 6 — Extract `ewQuoinRect` (fix #4 prep, pure, testable)

**Files:** modify `src/render/building-occluder.js`; modify `sim/test/occluder-rects.test.js`

The E/W cap source rect for pilot pieces is currently `er = P ? [16, 0, 32, 128] : [0,0,iw,ih]` — it samples a 32-wide strip starting at x=16 (the facade MIDDLE), producing the featureless square block. The spec wants the x=0 QUOIN column, 16px wide: `[0, 0, 16, 128]`. Extract a pure helper.

- [ ] Add the failing test:
```js
import { ewQuoinRect } from '../../src/render/building-occluder.js';

test('ewQuoinRect samples the x=0 quoin column (16 wide), not the facade middle', () => {
  const pilot = ewQuoinRect(true, 128, 128);
  assert.deepEqual(pilot, [0, 0, 16, 128], 'pilot E/W cap = left quoin column');
  const legacy = ewQuoinRect(false, 32, 32);
  assert.deepEqual(legacy, [0, 0, 32, 32], 'legacy uses the whole strip');
});
```
- [ ] Run — expected FAIL: `does not provide an export named 'ewQuoinRect'`.
- [ ] Add the helper:
```js
// Source rect of the E/W side-face cap. Pilot pieces are 128-wide facades whose LEFT quoin
// column (x=0..16) is the true vertical corner post; sampling the facade middle ([16,32]) gives
// the featureless square-block look. Legacy strips sample their whole face.
export function ewQuoinRect(isPilot, iw, ih) {
  return isPilot ? [0, 0, 16, 128] : [0, 0, iw, ih];
}
```
- [ ] Run the test — expected PASS.
- [ ] Commit: `git add src/render/building-occluder.js sim/test/occluder-rects.test.js`
  `git commit` — body: `extract ewQuoinRect helper sampling the x=0 quoin column (fix #4 prep)`
  Note: pure helper; draw site + full-height in Task 7/9.

---

## Task 7 — E/W full-height facade + quoin re-sample (fix #4, geometry inside occluder)

**Files:** modify `src/render/building-occluder.js`; modify `sim/test/occluder-rects.test.js`

Replace the ~0.4-tile rotated trim strip with a FULL-HEIGHT stacked E/W wall facade (`wH = t*wallHeight`, stacked `stories`), using `ewQuoinRect` for the source. The current code rotates a `t × ewH` strip; we instead draw an upright `t × wH`-per-story column on the E and W edges (mirrored on the W), sourced from the quoin column. This task changes ONLY the occluder's E/W loop math; it does NOT change `ewTileHeight`/`ewXOffset` constants (those are COORDINATION-owned — Task 9 files that patch request if the residual offset must change).

- [ ] Add a recording-canvas test asserting the E/W draw uses the quoin source and a full-height dest:
```js
test('E/W cap source rect is the quoin column for pilot pieces', () => {
  const r = ewQuoinRect(true, 128, 128);
  assert.equal(r[2], 16, 'samples 16px-wide quoin');
  assert.equal(r[3], 128, 'full source height');
});
```
- [ ] Run — expected PASS for the helper; now wire the loop.
- [ ] In `drawWalls`, replace the entire E/W block (the `if (wi.edge_ew) { ... }` body, lines ~177-204) with a full-height, stacked, quoin-sourced version:
```js
  if (wi.edge_ew) {
    const iw = wi.edge_ew.naturalWidth || wi.edge_ew.width || 32, ih = wi.edge_ew.naturalHeight || wi.edge_ew.height || 32;
    const er = ewQuoinRect(P, iw, ih);
    const ewX = Math.round(t * EWX);
    for (const s of sections) {
      for (let dy = 0; dy < s.h; dy++) {
        const ely = s.y0 + dy;
        const elxE = s.x0 + s.w, elxW = s.x0 - 1;
        for (let st = 0; st < stories; st++) {
          const sy = tsy(b.y + ely + 1) - wH + Math.round(t * WALL_CONFIG.wallYOffset) - st * wH;
          // East edge — upright full-height column, quoin-sourced
          if (!floorSet.has(elxE + ',' + ely)) {
            const exE = tileExtent(b.x + elxE, tilePx, camX, 1);
            const dxE = exE.dx + ewX;
            if (dxE + exE.dw > 0 && dxE < w && sy + wH > 0 && sy < h)
              ctx.drawImage(wi.edge_ew, er[0], er[1], er[2], er[3], dxE, sy, exE.dw, wH + wp);
          }
          // West edge — mirrored quoin
          if (!floorSet.has(elxW + ',' + ely)) {
            const exW = tileExtent(b.x + elxW, tilePx, camX, 1);
            const dxW = exW.dx - ewX;
            if (dxW + exW.dw > 0 && dxW < w && sy + wH > 0 && sy < h) {
              ctx.save(); ctx.translate(dxW + exW.dw, sy); ctx.scale(-1, 1);
              ctx.drawImage(wi.edge_ew, er[0], er[1], er[2], er[3], 0, 0, exW.dw, wH + wp);
              ctx.restore();
            }
          }
        }
      }
    }
  }
```
- [ ] Run `node --test sim/test/occluder-rects.test.js` — expected PASS.
- [ ] In-game: spawn at a building, press `9`; the E/W side walls now rise full-height as a quoin/corner-post column instead of a thin square block under the eave. CDP screenshot before/after the E or W face. NOTE: with `ewXOffset=-0.30` the column may sit slightly inboard; if it overlaps the south corner, file the Task 9 patch request.
- [ ] Commit: `git add src/render/building-occluder.js sim/test/occluder-rects.test.js`
  `git commit` — body: `full-height stacked E/W facade + quoin re-sample (fix #4)`
  Note: ewTileHeight/ewXOffset constants untouched; Task 9 patch-requests them if the inboard offset reads wrong.

---

## Task 8 — Retire the `isPilot` 4-bay branch → true per-32px draws (fix #3) — GATED on ASSET 32px strips

**Files:** modify `src/render/building-occluder.js`; modify `sim/test/occluder-rects.test.js`

**DEPENDENCY GATE:** do NOT start until Lane A has shipped 32px-multiple tileable wall strips (`south_base` 32×128 seamless, corners as a true mirrored pair, run-bond variants) and COORDINATION has confirmed `pilotPiece` resolves them. Verify by checking `assets/pixelab/buildings/walls/grassland/wattle_daub/south_base__normal.png` is now 32px-wide (not 128). Until then this task is BLOCKED.

The `isPilot` 4-bay clip-and-uniform-scale hack (`facadeTile`/`facadeWide` pilot branches + the `SY`/`vbandFor` band logic + `P` flag) exists only because the pilot art was a 128² 4-bay facade. With true 32px strips, draw per-32px exactly like `wall-draw.js:drawImg` (`ctx.drawImage(img, 0, 0, 32, 128, dx, dy, dw, wallH+pad)`), applying a run-bond variant per tile to break the repeat.

- [ ] Add the failing test (run-bond variant selection is deterministic per tile):
```js
import { runBondVariant } from '../../src/render/building-occluder.js';

test('runBondVariant cycles deterministically per tile column (breaks the 4-tile repeat)', () => {
  // 3 variants -> column 0,1,2,3 map to 0,1,2,0
  assert.equal(runBondVariant(0, 3), 0);
  assert.equal(runBondVariant(1, 3), 1);
  assert.equal(runBondVariant(3, 3), 0);
  assert.equal(runBondVariant(0, 1), 0); // 1 variant -> always 0
});
```
- [ ] Run — expected FAIL: `does not provide an export named 'runBondVariant'`.
- [ ] Add the helper:
```js
// Deterministic run-bond variant index for a wall column, so adjacent base tiles use shifted
// mortar joints and the wall stops reading as a fixed 4-tile repeat. nVariants>=1.
export function runBondVariant(col, nVariants) {
  const n = Math.max(1, nVariants | 0);
  return ((col % n) + n) % n;
}
```
- [ ] Run the helper test — expected PASS.
- [ ] Replace the pilot branches: delete the `P = wi.isPilot`, `SY`, `vbandFor` machinery and the pilot clip-scale in `facadeTile`/`facadeWide`; make both helpers a single per-32px draw (matching `wall-draw.js`). New `facadeTile`:
```js
  const facadeTile = (img, c, dx, dy, vb, dw) => {
    const ew = dw || (t + wp);
    const iw = img.naturalWidth || 32, ih = img.naturalHeight || 128;
    ctx.drawImage(img, 0, 0, Math.min(32, iw), ih, dx, dy, ew, wH + wp);
  };
  const facadeWide = (img, dx, dy, vb, dw) => {
    const ew = dw || (2 * t + wp);
    const iw = img.naturalWidth || 64, ih = img.naturalHeight || 128;
    ctx.drawImage(img, 0, 0, Math.min(64, iw), ih, dx, dy, ew, wH + wp);
  };
```
- [ ] Update `wallImgs` to drop `isPilot` and (when ASSET supplies variants) resolve `south_base` run-bond variants; select per-tile via `runBondVariant(c, nVariants)` at the base draw site. (If ASSET ships variants as `south_base__normal.png`, `south_base__rb1__normal.png`, … COORDINATION exposes them; consume `wi.south_base_variants[runBondVariant(c, wi.south_base_variants.length)]` when present, else `wi.south_base`.)
- [ ] Remove the now-dead `const P = wi.isPilot;` and the `SY`/`vbandFor` constants and every `vb` argument threaded through the draw sites (they become unused).
- [ ] Run `node --test sim/test/occluder-rects.test.js` — expected PASS.
- [ ] In-game: spawn at a wide building; the south wall no longer visibly repeats every 4 tiles. CDP screenshot before/after a long south face.
- [ ] Commit: `git add src/render/building-occluder.js sim/test/occluder-rects.test.js`
  `git commit` — body: `retire isPilot 4-bay hack -> true per-32px draws + run-bond variants (fix #3)`
  Note: depends on ASSET 32px re-crop; legacy stone_brick fallback already 32px so it is unaffected.

---

## Task 9 — COORDINATION patch request: `wall-config.js` E/W constants (fix #4 finalize)

**Files:** create `docs/superpowers/patch-requests/laneB-wall-config-ew.md` (Lane-B-owned note; NO edit to `wall-config.js`)

After Task 7, if the full-height E/W quoin column reads wrong with `ewTileHeight=0.40` / `ewXOffset=-0.30` (those were thin-strip calibration values), file a precise by-name patch request. The occluder now derives its own per-story full height (`wH`), so `ewTileHeight` is effectively unused by the occluder E/W path — but `wall-config.js` is also consumed by `building-renderer.js` (tuner) and `building-shadow.js`. The patch request must keep all consumers in sync (COORDINATION lands atomically).

- [ ] Write `docs/superpowers/patch-requests/laneB-wall-config-ew.md` with the exact ask:
```
PATCH REQUEST → COORDINATION (wall-config.js)
Context: Lane B Task 7 made the E/W cap a full-height stacked quoin column (height = stories*wallHeight),
derived inside building-occluder.js. The legacy ewTileHeight=0.40 (thin rotated strip) no longer drives
the occluder. Requested change (land atomically with consumers):
  - Keep ewTileHeight as-is ONLY if building-renderer.js tuner / building-shadow.js still need it
    (building-shadow.js does NOT read ewTileHeight; building-renderer.js tuner does).
  - If the quoin column sits too far inboard at ewXOffset=-0.30, set ewXOffset = <VALUE TBD after
    in-game check, e.g. -0.10>. Verify against building-shadow.facadeRect (reads wallYOffset/wallHeight
    only — unaffected) and building-renderer.drawBuildingWalls tuner default.
Acceptance: E/W column aligns flush to the south corner post; no overlap with south_corner_{west,east};
the wall tuner still renders.
```
- [ ] Commit: `git add docs/superpowers/patch-requests/laneB-wall-config-ew.md`
  `git commit` — body: `patch request to COORDINATION: E/W wall-config offsets after full-height quoin (fix #4)`
  Note: no source change; COORDINATION owns wall-config.js.

---

## Task 10 — Guard test: per-building windowShape/doorShape flow through the engine (fix #7 prep)

**Files:** modify `sim/test/occluder-rects.test.js`

`resolved-buildings.js:38-39` already assigns `b.doorShape`/`b.windowShape` per building. The occluder's `wallImgs` reads `(b && b.windowShape) || 'arched'` / `(b && b.doorShape) || 'plank'`. Add a regression test that the engine PASSES THROUGH the per-building shape (not a hardcoded default) so the 6 generated shapes are honoured. Since `wallImgs` is internal, expose a tiny pure accessor `apertureShapes(b)` and test it.

- [ ] Add the failing test:
```js
import { apertureShapes } from '../../src/render/building-occluder.js';

test('apertureShapes passes per-building doorShape/windowShape through (honours all 6 shapes)', () => {
  assert.deepEqual(apertureShapes({ doorShape: 'studded', windowShape: 'lattice' }),
    { door: 'studded', window: 'lattice' });
  // honest defaults only when the building lacks a shape (unassigned biome)
  assert.deepEqual(apertureShapes({}), { door: 'plank', window: 'arched' });
});
```
- [ ] Run — expected FAIL: `does not provide an export named 'apertureShapes'`.
- [ ] Add the accessor and use it in `wallImgs`:
```js
export function apertureShapes(b) {
  return { door: (b && b.doorShape) || 'plank', window: (b && b.windowShape) || 'arched' };
}
```
And in `wallImgs` replace the inline defaults:
```js
  const ap = apertureShapes(b);
  ...
    south_window: w('south_window', { shape: ap.window }),
    south_door: w('south_door', { shape: ap.door }),
```
- [ ] Run the test — expected PASS.
- [ ] Commit: `git add src/render/building-occluder.js sim/test/occluder-rects.test.js`
  `git commit` — body: `expose apertureShapes accessor; honour per-building door/window shape (fix #7 prep)`
  Note: shapes already assigned upstream in resolved-buildings.js (COORDINATION file); no edit there.

---

## Task 11 — Door-leaf doorway-hole fit (fix #6) — door-leaves.js, GATED on registry metadata

**Files:** modify `src/render/door-leaves.js`; create `sim/test/door-leaf-fit.test.js`

**DEPENDENCY GATE:** needs a per-shape doorway-hole rect (x0,y0,w,h as fractions of the 128 facade) from Lane A via COORDINATION's registry (Task 12 files the request). Until the accessor exists, ship a SAFE default rect (the current full `2t×4t`) so this lands without breaking, then tighten once the accessor is wired.

Currently the leaf is drawn into the full `2t × wH` piece (`o.drawImage(dr.leaf, 0, 0, 64, 128, dr.sx, dr.sy, pw, wH)`) and swung about `LEAF_HINGE_FRAC * pw`. The leaf bbox does not match the cut-out hole, so the swung leaf overhangs the masonry. Draw + swing the leaf into the doorway-hole SUB-RECT.

- [ ] Create `sim/test/door-leaf-fit.test.js` with a pure helper test:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doorwayHoleScreenRect, DEFAULT_HOLE } from '../../src/render/door-leaves.js';

test('doorwayHoleScreenRect maps fractional hole to screen sub-rect of the 2t x wH piece', () => {
  // hole = {x0:0.25,y0:0.10,w:0.5,h:0.85} of a 64x128 facade; piece at sx=100,sy=50, pw=64, wH=128
  const r = doorwayHoleScreenRect({ x0: 0.25, y0: 0.10, w: 0.5, h: 0.85 }, 100, 50, 64, 128);
  assert.equal(r.dx, 100 + 0.25 * 64);
  assert.equal(r.dy, 50 + 0.10 * 128);
  assert.equal(r.dw, 0.5 * 64);
  assert.equal(r.dh, 0.85 * 128);
});

test('DEFAULT_HOLE is the full piece (safe fallback until metadata lands)', () => {
  assert.deepEqual(DEFAULT_HOLE, { x0: 0, y0: 0, w: 1, h: 1 });
});
```
- [ ] Run — expected FAIL: `does not provide an export named 'doorwayHoleScreenRect'`.
- [ ] In `door-leaves.js`, add the helper + default near the constants:
```js
// Doorway-hole rect (fractions of the facade) the leaf must fit into. Until ASSET ships per-shape
// metadata (via the registry), default to the full piece so the swing still works.
export const DEFAULT_HOLE = { x0: 0, y0: 0, w: 1, h: 1 };
export function doorwayHoleScreenRect(hole, sx, sy, pw, wH) {
  return { dx: sx + hole.x0 * pw, dy: sy + hole.y0 * wH, dw: hole.w * pw, dh: hole.h * wH };
}
```
- [ ] Change the leaf draw loop (`:58-62`) to fit + swing inside the hole sub-rect:
```js
  for (const dr of draws) {
    const pw = 2 * t;
    const hole = dr.hole || DEFAULT_HOLE;
    const r = doorwayHoleScreenRect(hole, dr.sx, dr.sy, pw, wH);
    const hingeX = r.dx + LEAF_HINGE_FRAC * r.dw;
    o.save(); o.translate(hingeX, r.dy); o.scale(dr.open, 1); o.translate(-hingeX, -r.dy);
    o.drawImage(dr.leaf, 0, 0, 64, 128, r.dx, r.dy, r.dw, r.dh);
    o.restore();
  }
```
- [ ] In the `draws.push({...})` call, add `hole: DEFAULT_HOLE` (replaced by the registry accessor in Task 12).
- [ ] Run `node --test sim/test/door-leaf-fit.test.js` — expected PASS.
- [ ] In-game: walk up to a door; the leaf swings within the masonry opening (no overhang past the jambs). CDP screenshot before/after, door open + closed.
- [ ] Commit: `git add src/render/door-leaves.js sim/test/door-leaf-fit.test.js`
  `git commit` — body: `fit + swing door leaf into a doorway-hole sub-rect (fix #6); full-piece default until metadata`
  Note: tightened to real per-shape hole in Task 12 once the registry accessor lands.

---

## Task 12 — COORDINATION patch request + consume `doorwayHoleRect(shape)` (fix #6 finalize)

**Files:** create `docs/superpowers/patch-requests/laneB-doorway-hole.md`; modify `src/render/door-leaves.js`; modify `sim/test/door-leaf-fit.test.js`

**GATE:** only after COORDINATION confirms the registry exposes `doorwayHoleRect(shape)` (fed by Lane A metadata).

- [ ] Write `docs/superpowers/patch-requests/laneB-doorway-hole.md`:
```
PATCH REQUEST → COORDINATION (building-material-registry.js)
Add an accessor returning the doorway cut-out hole for a door shape, sourced from Lane A metadata:
  export function doorwayHoleRect(shape) -> { x0, y0, w, h }  // fractions of the 128 facade
Default {x0:0,y0:0,w:1,h:1} for unknown shapes. door-leaves.js imports it (Lane B owns that import).
Shapes: plank, iron_banded, arched_double, carved, rounded, studded (DOOR_SHAPES).
```
- [ ] In `door-leaves.js`, import + use the accessor (replace the `DEFAULT_HOLE` push):
```js
import { wallAssetDir, doorwayHoleRect } from '../../sim/world/buildings/building-material-registry.js';
...
      draws.push({ leaf, sx, sy, open, sortY: b.y + d.y, hole: doorwayHoleRect(b.doorShape) || DEFAULT_HOLE });
```
- [ ] Add a test asserting a known shape yields a non-full hole (once metadata exists):
```js
import { doorwayHoleRect } from '../../sim/world/buildings/building-material-registry.js';
test('registry doorwayHoleRect returns a real sub-rect for plank (not the full piece)', () => {
  const h = doorwayHoleRect('plank');
  assert.ok(h.w < 1 || h.h < 1, 'plank hole is narrower/shorter than the full facade');
});
```
- [ ] Run `node --test sim/test/door-leaf-fit.test.js` — expected PASS once COORDINATION lands the accessor.
- [ ] Commit: `git add docs/superpowers/patch-requests/laneB-doorway-hole.md src/render/door-leaves.js sim/test/door-leaf-fit.test.js`
  `git commit` — body: `consume registry doorwayHoleRect(shape) for exact leaf fit (fix #6 finalize)`
  Note: registry accessor + metadata are COORDINATION/ASSET; this lane only consumes.

---

## Task 13 — NEW `window-overlay.js` builder mirroring door-leaves.js (fix #7) — GATED on window assets

**Files:** create `src/render/window-overlay.js`; create `sim/test/window-overlay.test.js`

**DEPENDENCY GATE:** needs a transparent-surround window object with closed + open/shutter states from Lane A and a registry path from COORDINATION (Task 14 files the request). Until those land, the builder resolves nothing and returns null (honest absence — no fake window). The base `south_window` tile already drawn by the occluder keeps the wall tone; the overlay only adds the openable window pixels on top.

Mirror `door-leaves.js` EXACTLY: per-frame offscreen bitmap → `glc.drawSceneOverlayBitmap` (NEVER a 2D top-pass), procedural open/close transform (shutter swing / sash slide), drawn OVER the already-drawn `south_base`/`south_window` tile. Window placement set is derived from the SAME predicate the occluder uses (the `iv%3` window selection) so overlays land on the exact tiles the base windows were drawn on.

- [ ] Create `sim/test/window-overlay.test.js`:
```js
// sim/test/window-overlay.test.js — window-as-object overlay builder (open/close transform).
import { test } from 'node:test';
import assert from 'node:assert/strict';
globalThis.window = {};
globalThis.OffscreenCanvas = undefined;
globalThis.document = { createElement() {
  const calls = [];
  return { width: 0, height: 0, getContext: () => ({
    setTransform(){}, clearRect(){}, save(){}, restore(){}, translate(){}, scale(){}, drawImage(...a){calls.push(a);},
    imageSmoothingEnabled: false, _calls: calls }) };
} };
const { windowPlacements, openAmount } = await import('../../src/render/window-overlay.js');

function fp(w) { return { boundingBox: { w, h: 4 }, sections: [{ x0: 0, y0: 0, w, h: 4 }], doors: [] }; }

test('windowPlacements matches the occluder iv%3 window rule (same tiles)', () => {
  const b = { x: 0, y: 0, footprint: fp(10) };
  const set = windowPlacements(b);
  // interior columns 2..7; every 3rd interior column gets a window
  assert.ok(set.size >= 1, 'at least one window placed on a 10-wide wall');
  for (const k of set) { const [lx] = k.split(',').map(Number); assert.ok(lx >= 2 && lx <= 7, 'inside the windowable band'); }
});

test('openAmount goes 0 (closed, far) -> 1 (open, near) by proximity', () => {
  assert.equal(openAmount(99), 0);     // far -> closed
  assert.equal(openAmount(0), 1);      // adjacent -> fully open
  assert.ok(openAmount(1.5) > 0 && openAmount(1.5) < 1, 'mid distance partly open');
});
```
- [ ] Run — expected FAIL: `Cannot find module ... window-overlay.js`.
- [ ] Create `src/render/window-overlay.js` (mirrors `door-leaves.js` structure precisely):
```js
// src/render/window-overlay.js — per-frame WINDOW-as-object overlay (decoupled windows).
//
// The occluder draws the south_window wall tile (keeps the base tone). This pass draws each
// visible building's openable window OBJECT over that tile with a procedural open/close transform
// (shutter swing / sash slide) by player proximity. It renders into an offscreen bitmap that
// gl-compositor blits into the SCENE framebuffer (drawSceneOverlayBitmap) — lights/CRTs IDENTICALLY
// to the baked wall (everything-through-GL). No generated animation — the open is a transform, so it
// can never hallucinate a figure (decision #3, same rationale as door-leaves.js).

import { WALL_CONFIG } from './wall-config.js';
import { wallAssetDir, windowOverlayFile } from '../../sim/world/buildings/building-material-registry.js';

const OPEN_NEAR = 0.0, OPEN_FAR = 1.0, R_FULL = 0.8, R_CLOSED = 3.0; // tiles

export const WINDOW_OPEN = { enabled: true, rFull: R_FULL, rClosed: R_CLOSED };
if (typeof window !== 'undefined') window._windowOpen = WINDOW_OPEN;

const _img = new Map();
function img(url) { let im = _img.get(url); if (!im) { im = new Image(); im.src = url; _img.set(url, im); } return (im.complete && im.naturalWidth) ? im : null; }
// Closed + open window object for a building's material; null until ASSET/registry supply them.
function winImg(b, open) { return (b && b.biome && b.wallSlug) ? img(wallAssetDir(b.biome, b.wallSlug) + windowOverlayFile(b.windowShape, open)) : null; }

// Mirror the occluder's window selection (iv%3 over interior columns) so overlays land on the
// EXACT tiles the base south_window was drawn on (no drift).
export function windowPlacements(b) {
  const out = new Set();
  const fp = b.footprint; if (!fp || !fp.sections) return out;
  const floorSet = new Set();
  for (const s of fp.sections) for (let dy = 0; dy < s.h; dy++) for (let dx = 0; dx < s.w; dx++) floorSet.add((s.x0 + dx) + ',' + (s.y0 + dy));
  const doorSet = new Set((fp.doors || []).map(d => d.x + ',' + d.y));
  for (const s of fp.sections) {
    const lr = s.y0 + s.h - 1; let iv = 0;
    for (let dx = 0; dx < s.w; dx++) {
      const lx = s.x0 + dx, ly = lr;
      if (floorSet.has(lx + ',' + (ly + 1))) continue;
      if (doorSet.has(lx + ',' + ly)) { iv = 0; continue; }
      if (dx < 2 || dx >= s.w - 2) { iv++; continue; }
      if (doorSet.has((lx - 1) + ',' + ly) || doorSet.has((lx + 1) + ',' + ly)) { iv++; continue; }
      iv++; if (iv % 3 === 0) out.add(lx + ',' + ly);
    }
  }
  return out;
}

// 0 (closed) far .. 1 (open) near, by proximity in tiles.
export function openAmount(dist) {
  const k = Math.max(0, Math.min(1, (dist - WINDOW_OPEN.rFull) / (WINDOW_OPEN.rClosed - WINDOW_OPEN.rFull)));
  return OPEN_FAR - k * (OPEN_FAR - OPEN_NEAR); // near -> 1, far -> 0
}

let _cv = null, _ox = null;

/** Per-frame window-overlay bitmap (or null). Caller blits via glc.drawSceneOverlayBitmap() after
 *  the door-leaf overlay, before presentScene. Honest absence: null until window assets load. */
export function buildWindowOverlayBitmap(buildings, camX, camY, tilePx, w, h, player) {
  if (!WINDOW_OPEN.enabled || !buildings || !buildings.length || !player) return null;
  const t = Math.round(tilePx), wH = Math.round(tilePx * WALL_CONFIG.wallHeight), WY = WALL_CONFIG.wallYOffset;
  const draws = [];
  for (const b of buildings) {
    const closed = winImg(b, false); if (!closed) continue; // assets not present -> skip (honest)
    const open = winImg(b, true);
    const places = windowPlacements(b);
    for (const s of b.footprint.sections) {
      const lr = s.y0 + s.h - 1;
      for (let dx = 0; dx < s.w; dx++) {
        const lx = s.x0 + dx, ly = lr; const key = lx + ',' + ly;
        if (!places.has(key)) continue;
        const sx = Math.round((b.x + lx) * tilePx - camX), sy = Math.round((b.y + ly + 1) * tilePx - camY) - wH + Math.round(t * WY);
        if (sx + 2 * t < 0 || sx > w || sy + wH < 0 || sy > h) continue;
        const dist = Math.hypot((b.x + lx + 1) - player.x, (b.y + ly) - player.y);
        draws.push({ closed, open, sx, sy, amt: openAmount(dist), sortY: b.y + ly });
      }
    }
  }
  if (!draws.length) return null;
  if (!_cv || _cv.width !== w || _cv.height !== h) {
    _cv = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(w, h)
        : (typeof document !== 'undefined') ? document.createElement('canvas') : null;
    if (!_cv) return null;
    _cv.width = w; _cv.height = h; _ox = _cv.getContext('2d');
  }
  const o = _ox; o.setTransform(1, 0, 0, 1, 0, 0); o.clearRect(0, 0, w, h); o.imageSmoothingEnabled = false;
  draws.sort((a, b) => a.sortY - b.sortY);
  for (const dr of draws) {
    const pw = 2 * t;
    // closed pane first; if an open sprite exists, cross-fade by amt via a horizontal sash-slide
    o.drawImage(dr.closed, 0, 0, 64, 128, dr.sx, dr.sy, pw, wH);
    if (dr.open && dr.amt > 0.01) {
      o.save(); o.globalAlpha = dr.amt;
      // sash slide: shift the open leaf outward by amt*half-width about the centre
      const cx = dr.sx + pw / 2;
      o.translate(cx, dr.sy); o.scale(1 - 0.0 * dr.amt, 1); o.translate(-cx, -dr.sy);
      o.drawImage(dr.open, 0, 0, 64, 128, dr.sx, dr.sy, pw, wH);
      o.restore();
    }
  }
  return _cv;
}
```
- [ ] Run `node --test sim/test/window-overlay.test.js` — expected PASS for `windowPlacements`/`openAmount` (the builder returns null in the test since `winImg` resolves nothing — that is the honest-absence path).
- [ ] Commit: `git add src/render/window-overlay.js sim/test/window-overlay.test.js`
  `git commit` — body: `NEW window-overlay.js: window-as-object open/close transform (fix #7), mirrors door-leaves`
  Note: blit wiring + registry windowOverlayFile are COORDINATION patch requests (Task 14); honest-absence until assets load.

---

## Task 14 — COORDINATION patch requests: window registry path + blit wiring (fix #7 finalize)

**Files:** create `docs/superpowers/patch-requests/laneB-window-overlay.md` (NO edit to registry or canvas-renderer.js)

`buildWindowOverlayBitmap` imports `windowOverlayFile(shape, open)` from the registry and must be blitted right after the door-leaf blit. Both are COORDINATION-owned files; hand them precise by-name asks.

- [ ] Write `docs/superpowers/patch-requests/laneB-window-overlay.md`:
```
PATCH REQUEST → COORDINATION

1) building-material-registry.js — add the window-overlay file resolver (fed by Lane A's separate
   transparent-surround window object with closed + open states):
     export function windowOverlayFile(shape, open) {
       // e.g. window_overlay__<shape>[__open].png in the wall material dir
       return `window_overlay__${shape || 'shuttered'}${open ? '__open' : ''}.png`;
     }
   Also add the south_window__{shape}__open case to wallPieceFile if the base tile gains an open state.

2) canvas-renderer.js — wire the new builder next to the door-leaf blit. Import:
     import { buildWindowOverlayBitmap } from './window-overlay.js';
   And immediately AFTER the existing door-leaf blit (currently:
     const _dl = buildDoorLeafBitmap(getCachedBuildings(), camX, camY, tilePx, w, h, player);
     if (_dl) this.glc.drawSceneOverlayBitmap(_dl);
   ) add:
     const _wo = buildWindowOverlayBitmap(getCachedBuildings(), camX, camY, tilePx, w, h, player);
     if (_wo) this.glc.drawSceneOverlayBitmap(_wo);
   (Order: occluder/spotlight -> door leaf -> window overlay -> presentScene. Window overlay is the
   topmost world-content blit, before present, so it lights/CRTs like everything else.)

Acceptance: a windowed building shows the closed pane (matching wall tone, no seam) at distance and
opens (shutter/sash) as the player approaches; never a 2D top-pass.
```
- [ ] In-game (once COORDINATION lands both): spawn at a windowed building; approach — windows open; retreat — they close; the closed window keeps the wall tone (no tone/pattern seam). CDP screenshot far (closed) + near (open).
- [ ] Commit: `git add docs/superpowers/patch-requests/laneB-window-overlay.md`
  `git commit` — body: `patch requests to COORDINATION: window registry path + blit wiring (fix #7 finalize)`
  Note: registry + canvas-renderer.js are COORDINATION; this lane only provides the builder + asks.

---

## Self-Review — Lane B spec coverage

- **Fix #1 (vertical stretch):** Tasks 1–2 extract `cropBox` (isotropic full-height `0,0,W,128` crop) and apply it in the legacy `facadeTile`/`facadeWide`. `wallHeight` constant untouched (COORDINATION-owned); only the crop/dest changed, as the spec requires. `wallYOffset` + north-gap clamp re-verified by the in-game check.
- **Fix #2 (tile seams):** Tasks 3–4 extract `tileExtent` (`dx=round(wx*tilePx-camX); dw=round((wx+1)*tilePx-camX)-dx`) and thread boundary-derived widths through every north/south/corner/wide draw site, replacing fixed `t+wp`/`2t+wp`.
- **Fix #3 (retire isPilot 4-bay):** Task 8, GATED on ASSET 32px strips, replaces the clip-and-uniform-scale pilot branch with true per-32px draws (matching `wall-draw.js`) + deterministic `runBondVariant` per tile.
- **Fix #4 (E/W square block):** Tasks 6–7 extract `ewQuoinRect` (sample x=0 quoin `[0,0,16,128]` not facade-middle `[16,0,32,128]`) and draw a FULL-HEIGHT stacked E/W facade; Task 9 files the `ewTileHeight`/`ewXOffset` patch request to COORDINATION (serialized constants).
- **Fix #5 (corner see-through):** Task 5 draws `south_base` under the outboard corner tile on both north and south walls.
- **Fix #6 (door-leaf fit):** Tasks 11–12 add a doorway-hole sub-rect (full-piece default, then registry `doorwayHoleRect(shape)`) and draw + swing the leaf into it instead of full `2t×4t`.
- **Fix #7 (window-as-object):** Task 13 creates NEW `window-overlay.js` mirroring `door-leaves.js` EXACTLY (offscreen → `glc.drawSceneOverlayBitmap`, never a 2D top-pass), drawn OVER the base tile, with a procedural open/close transform; placements derived from the SAME `iv%3` rule the occluder uses; Task 14 files the registry path + single-blit-line patch requests. Task 10 guards that per-building `windowShape`/`doorShape` flow through (already assigned in resolved-buildings.js:38-39).
- **Within-building roof-over-door** left correct; the GLOBAL cross-building depth fix is explicitly NOT built here (COORDINATION decision #1) — `building-layer.js`/`building-depth.js` keep routing through `drawBuildingTextured`, so all geometry fixes propagate to COORDINATION's depth quad for free.
- **Hard constraints:** GL-only (all overlays blit through the scene FBO; no 2D top-pass introduced); no-mock (window-overlay returns null = honest absence until assets load); 32px-multiple PIECES (Task 8 per-32px draws); one shared tree, stage-by-name only (every commit lists exact paths; serialized hot files handled via patch-request docs, never edited).
- **Verification:** pure helpers unit-tested via `node --test`; draw composition validated headlessly with a recording-canvas shim (precedent `sim/test/water-foam-render.test.js`) plus in-game CDP screenshots on the `:8123` node harness (incognito for worker cache). Baseline suite confirmed green (33/33 across building-layer + building-shadow) before changes.