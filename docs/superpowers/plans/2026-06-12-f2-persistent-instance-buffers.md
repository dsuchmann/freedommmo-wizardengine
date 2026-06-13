# F2 Persistent GPU Instance Buffers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the per-frame rebuild of the y-sorted field sprite batch (45.8% of frame CPU) by storing instances in world space in persistent GPU buffers, rebuilding only on events, and per-frame updating only actively animating sprites.

**Architecture:** The GL path of `drawField2Animations` is replaced by a persistent sprite pool: a CPU mirror Float32Array + GPU VBO holding **world-space** instances (tile-unit coordinates), with the camera applied by a vertex-shader uniform. A full rebuild (collect → sort → fill → upload) runs only on tile-window change, chunk-ready change, tuner apply, or zoom change. A 10Hz tick scans triggers (wind/ambient/contagion/sim overrides) into an active list; the per-frame loop updates only active instances and uploads coalesced dirty ranges. The Canvas 2D path is untouched.

**Tech Stack:** Vanilla ES modules, WebGL2 (`gl-compositor.js`), `node --test` for pure logic, playwright-core headless probes.

**Spec:** `docs/superpowers/specs/2026-06-12-f2-persistent-instance-buffers-design.md`

**Worktree:** Implement in an isolated worktree (parallel agents switch branches in the main checkout). Dev server for probes: `PROBE_PORT=8742`, never run two playwright probes concurrently.

**Key existing code (read these before starting):**
- `src/render/field2-animator.js:929-1326` — `drawField2Animations`, the function being restructured. Lines 966-1143 collect `drawBuffer`; 1173 sorts; 1177-1304 fill `_instArray`/`_shadowArray` and call `glc.drawSpriteInstances`/`drawShadowInstances`.
- `src/render/field2-animator.js:1-140` — wind currents (`updateCurrents`, `sampleCurrents`), `triggerTimes` Map, constants (`ANIM_RADIUS=40`, `FRAME_COUNT=9`, `FRAME_DURATION=120`).
- `src/render/gl-compositor.js:39-133` — sprite/shadow shaders + `SPRITE_FLOATS = 9` layout `(pivotX, pivotY, size, rot, alpha, u0, v0, du, dv)`.
- `src/render/gl-compositor.js:952-1006` — `drawSpriteInstances` / `drawShadowInstances` (full re-upload every call — the pattern being replaced for the pool).
- `src/render/canvas-renderer.js:405-412` — call site; `f2Grid` carries `baseSX/baseSY/minCX/minCY/chunkPx` (in GL scene mode these are **art px** with `w/zoom, h/zoom`).

**Coordinate math (the heart of the change):** today CPU computes
`sx = baseSX + (cx - minCX)*chunkPx + tx*tilePxSnapped + (0.5 + offUX)*tilePxSnapped`.
Since `chunkPx = chunkSize * tilePxSnapped` and `wx = cx*chunkSize + tx`, this equals
`sx = (wx + 0.5 + offUX) * tilePxSnapped + (baseSX - minCX*chunkPx)`.
So instances store **tile-unit world coords** `(wx + 0.5 + offUX)` and the shader applies `uCam = (offX, offY, scale)` where `offX = baseSX - gridMinCX*chunkPx`, `offY = baseSY - gridMinCY*chunkPx`, `scale = tilePxSnapped`. Sizes are stored in tile units (`lifeScale`) and multiplied by `uCam.z` in the shader. `baseSX/baseSY` change every frame as the camera pans — only the uniform changes, never the buffer. `tilePxSnapped` changes only with zoom → full rebuild (atlas entries are keyed by on-screen draw size via `scaledFrame`).

---

## File structure

- **Create `src/render/sprite-pool-util.js`** — pure, DOM-free helpers: dirty-range coalescing, sorted lower-bound. Unit-testable in node.
- **Create `test/sprite-pool-util.test.js`** — node --test for the above.
- **Modify `src/render/gl-compositor.js`** — world-space variants of the sprite/shadow vertex shaders (uniform `uCam`); pool VBO pair with capacity mgmt, partial upload, and **range draw** (WebGL2 has no baseInstance: range = re-point the 3 instance attribs at `start*36` bytes before `drawArraysInstanced`).
- **Modify `src/render/field2-animator.js`** — new GL pool section: registry + mirrors + rebuild + 10Hz tick + per-frame active-list update. `drawField2Animations` branches: GL → pool path; 2D → existing code verbatim.
- **Create `scripts/probe-f2-perf.mjs`** — headless GL probe asserting `window._f2Stats` invariants.
- **Modify `test/` (existing suite untouched)** — run `node --test test/field-tuning.test.js test/decoration-claims-f5.test.js test/random.test.js test/f6-placements.test.mjs test/sprite-pool-util.test.js` (directory form is broken pre-existing — always list files).

---

### Task 1: Pure helpers — dirty-range coalescer + lowerBound

**Files:**
- Create: `src/render/sprite-pool-util.js`
- Test: `test/sprite-pool-util.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// test/sprite-pool-util.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coalesceDirty, lowerBound } from '../src/render/sprite-pool-util.js';

test('coalesceDirty: empty set yields no ranges', () => {
  assert.deepEqual(coalesceDirty([], 4), []);
});

test('coalesceDirty: single index yields one 1-length range', () => {
  assert.deepEqual(coalesceDirty([7], 4), [{ start: 7, count: 1 }]);
});

test('coalesceDirty: adjacent and near indices merge within gap', () => {
  // gap=4: indices closer than gap merge into one range
  assert.deepEqual(coalesceDirty([3, 4, 6, 9], 4), [{ start: 3, count: 7 }]);
});

test('coalesceDirty: far indices split into separate ranges', () => {
  assert.deepEqual(coalesceDirty([1, 2, 50, 51], 4),
    [{ start: 1, count: 2 }, { start: 50, count: 2 }]);
});

test('coalesceDirty: unsorted input is handled', () => {
  assert.deepEqual(coalesceDirty([50, 1, 51, 2], 4),
    [{ start: 1, count: 2 }, { start: 50, count: 2 }]);
});

test('lowerBound: finds first index with value >= needle', () => {
  const a = new Float32Array([1, 3, 3, 7, 9]);
  assert.equal(lowerBound(a, 5, 0), 3);
  assert.equal(lowerBound(a, 3, 5), 1);
  assert.equal(lowerBound(a, 0, 5), 0);
  assert.equal(lowerBound(a, 99, 5), 5);
});

test('lowerBound: respects explicit length (ignores tail garbage)', () => {
  const a = new Float32Array([1, 3, 9, 777, 777]);
  assert.equal(lowerBound(a, 5, 3), 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/sprite-pool-util.test.js`
Expected: FAIL — `Cannot find module .../sprite-pool-util.js`

- [ ] **Step 3: Implement**

```js
// src/render/sprite-pool-util.js — pure helpers for the GL persistent
// sprite pool. No DOM/GL dependencies so node --test covers them.

// Merge a list of dirty instance indices into upload ranges. Indices closer
// than `gap` apart merge into one range — a few large bufferSubData calls
// beat many tiny ones on every driver we target.
export function coalesceDirty(indices, gap) {
  if (indices.length === 0) return [];
  var sorted = Array.from(indices).sort(function (a, b) { return a - b; });
  var ranges = [];
  var start = sorted[0];
  var end = sorted[0];
  for (var i = 1; i < sorted.length; i++) {
    var idx = sorted[i];
    if (idx - end <= gap) { end = idx; continue; }
    ranges.push({ start: start, count: end - start + 1 });
    start = idx; end = idx;
  }
  ranges.push({ start: start, count: end - start + 1 });
  return ranges;
}

// First index in sortedArr[0..len) with value >= needle (binary search).
// Used to find the player's insertion point in the y-sorted pool.
export function lowerBound(sortedArr, needle, len) {
  var lo = 0, hi = (len == null ? sortedArr.length : len);
  while (lo < hi) {
    var mid = (lo + hi) >> 1;
    if (sortedArr[mid] < needle) lo = mid + 1; else hi = mid;
  }
  return lo;
}
```

Note `lowerBound(a, 3, 5)` returning 1 in the test: first element `>= 3` is index 1. The second test call passes `len` explicitly; when `len == null` use full length.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/sprite-pool-util.test.js`
Expected: PASS, 7/7.

- [ ] **Step 5: Commit**

```bash
git add src/render/sprite-pool-util.js test/sprite-pool-util.test.js
git commit -m "feat(render): dirty-range coalescer + lowerBound for sprite pool"
```

---

### Task 2: gl-compositor — world-space pool shaders + persistent VBOs + range draws

**Files:**
- Modify: `src/render/gl-compositor.js` (shader sources at lines 39-129; new methods near `drawSpriteInstances` at 952)

No unit tests (GL); verified by the perf probe (Task 6) and visual parity (Task 7). Keep `drawSpriteInstances`/`drawShadowInstances` untouched — the 2D path never calls them, but removing them mid-plan risks breaking the in-between commits; they are deleted in Task 8 if unreferenced.

- [ ] **Step 1: Add `uCam` to the sprite vertex shader**

Replace `SPRITE_VERT_SRC` (gl-compositor.js:39-57) with:

```js
var SPRITE_VERT_SRC = `#version 300 es
precision highp float;
in vec2 aUnit;     // unit quad corner (0..1)
in vec4 aPSR;      // pivot.xy (world TILE units), size (tiles), rotation (rad)
in float aAlpha;
in vec4 aUV;       // u0, v0, du, dv
uniform vec2 uViewport;
uniform vec3 uCam; // x,y = screen-px offset, z = px per tile (tilePxSnapped)
out vec2 vUV;
out float vAlpha;
void main() {
  float sizePx = aPSR.z * uCam.z;
  vec2 pivotPx = aPSR.xy * uCam.z + uCam.xy;
  vec2 local = vec2(aUnit.x * sizePx - sizePx * 0.5, aUnit.y * sizePx - sizePx);
  float c = cos(aPSR.w);
  float s = sin(aPSR.w);
  vec2 px = pivotPx + vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  vec2 clip = vec2(px.x / uViewport.x * 2.0 - 1.0, 1.0 - px.y / uViewport.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vUV = aUV.xy + aUnit * aUV.zw;
  vAlpha = aAlpha;
}`;
```

The pivot is at bottom-center exactly as before (`local` math unchanged); only the unit conversion moved into the shader. The OLD screen-space behavior is recovered by passing `uCam = (0, 0, 1)` with pixel-unit instance data — which is exactly what `drawSpriteInstances` will do (Step 3), so the legacy entry points keep working during the transition.

- [ ] **Step 2: Add `uCam` to the shadow vertex shader the same way**

In `SHADOW_VERT_SRC` (gl-compositor.js:72-104), add the uniform and convert units at the top of `main()`; the rest of the shader body is unchanged except every use of `aPSR.z` becomes `sizePx` and `aPSR.xy` becomes `pivotPx`:

```js
var SHADOW_VERT_SRC = `#version 300 es
precision highp float;
in vec2 aUnit;
in vec4 aPSR;      // pivot.xy (world tiles), size (tiles), w = diffusion
in float aAlpha;   // sprite alpha * per-biome shadow strength
in vec4 aUV;
uniform vec2 uViewport;
uniform vec3 uCam;        // x,y = screen-px offset, z = px per tile
uniform vec2 uShadowVec;
out vec2 vUV;
out float vAlpha;
out float vH;
out float vDiff;
void main() {
  float sizePx = aPSR.z * uCam.z;
  vec2 pivotPx = aPSR.xy * uCam.z + uCam.xy;
  float hgt = 1.0 - aUnit.y;
  float diff = aPSR.w;
  float shadowLen = length(uShadowVec);
  float flatK = clamp(1.0 - shadowLen / 2.5, 0.0, 1.0);
  float vert = mix(0.85, 0.40, flatK);
  float wide = 1.0 + diff * 0.45;
  vec2 base = vec2((aUnit.x - 0.5) * sizePx * wide, hgt * sizePx * vert);
  vec2 px = pivotPx + base + hgt * sizePx * uShadowVec;
  vec2 clip = vec2(px.x / uViewport.x * 2.0 - 1.0, 1.0 - px.y / uViewport.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vUV = aUV.xy + aUnit * aUV.zw;
  vAlpha = aAlpha;
  vH = hgt;
  vDiff = diff;
}`;
```

- [ ] **Step 3: Cache the new uniform locations and keep legacy calls working**

Wherever the sprite/shadow programs' uniforms are looked up after link (search for `this.sUViewport =` and `this.shUViewport =`), add:

```js
this.sUCam = gl.getUniformLocation(this.spriteProgram, 'uCam');
// ...
this.shUCam = gl.getUniformLocation(this.shadowProgram, 'uCam');
```

In `drawSpriteInstances` (after the `uViewport` uniform set, line ~960) add `gl.uniform3f(this.sUCam, 0, 0, 1);` and in `drawShadowInstances` add `gl.uniform3f(this.shUCam, 0, 0, 1);` — identity camera, so legacy pixel-space callers render exactly as before.

- [ ] **Step 4: Add the persistent pool API**

Add these methods to the compositor class next to `drawSpriteInstances`:

```js
  // --- Persistent sprite pool (world-space instances, partial uploads) ---
  // The pool owns two VBOs (sprites, shadows) that survive across frames.
  // ensurePoolCapacity grows them; uploadPoolRange patches dirty instances;
  // drawPoolRange draws a contiguous instance range by re-pointing the
  // instance attributes (WebGL2 has no baseInstance).

  ensurePoolCapacity(kind, instCount) {
    if (!this.ok || !this.spritesOk) return false;
    var gl = this.gl;
    if (!this._pool) this._pool = {};
    var p = this._pool[kind];
    if (!p) {
      p = this._pool[kind] = { vbo: gl.createBuffer(), capBytes: 0 };
    }
    var bytes = Math.max(4096 * SPRITE_STRIDE, instCount * SPRITE_STRIDE);
    if (bytes > p.capBytes) {
      gl.bindBuffer(gl.ARRAY_BUFFER, p.vbo);
      p.capBytes = bytes * 2;
      gl.bufferData(gl.ARRAY_BUFFER, p.capBytes, gl.DYNAMIC_DRAW);
    }
    return true;
  }

  // Upload `count` instances from mirror (Float32Array of packed instances)
  // starting at instance index `start` (same index in VBO and mirror).
  uploadPoolRange(kind, mirror, start, count) {
    if (!this.ok || !this.spritesOk || count === 0) return;
    var gl = this.gl;
    var p = this._pool && this._pool[kind];
    if (!p) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, p.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, start * SPRITE_STRIDE,
      mirror, start * SPRITE_FLOATS, count * SPRITE_FLOATS);
  }

  // Point the 3 instance attributes of `vao` at byte offset start*stride of
  // the pool VBO. attribLocs = { psr, alpha, uv } (queried at program link).
  _pointPoolAttribs(vbo, locs, startInst) {
    var gl = this.gl;
    var base = startInst * SPRITE_STRIDE;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.vertexAttribPointer(locs.psr, 4, gl.FLOAT, false, SPRITE_STRIDE, base);
    gl.vertexAttribPointer(locs.alpha, 1, gl.FLOAT, false, SPRITE_STRIDE, base + 16);
    gl.vertexAttribPointer(locs.uv, 4, gl.FLOAT, false, SPRITE_STRIDE, base + 20);
  }

  // Draw instances [start, start+count) of the persistent sprite pool.
  // cam = { x, y, scale } (screen-px offset + px-per-tile).
  drawPoolSprites(start, count, cssW, cssH, cam) {
    if (!this.ok || !this.spritesOk || count === 0) return;
    var p = this._pool && this._pool.sprite;
    if (!p) return;
    var gl = this.gl;
    gl.useProgram(this.spriteProgram);
    gl.bindVertexArray(this.spriteVao);
    if (this.sceneActive) gl.uniform2f(this.sUViewport, this._artW, this._artH);
    else gl.uniform2f(this.sUViewport, cssW, cssH);
    gl.uniform3f(this.sUCam, cam.x, cam.y, cam.scale);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.uniform1i(this.sUAtlas, 0);
    this._pointPoolAttribs(p.vbo, this._spriteAttribLocs, start);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.disable(gl.BLEND);
    // Restore VAO's default pointers (offset 0 into the legacy instVbo) so
    // legacy drawSpriteInstances callers are unaffected.
    this._pointPoolAttribs(this.instVbo, this._spriteAttribLocs, 0);
    gl.bindVertexArray(null);
  }

  drawPoolShadows(start, count, cssW, cssH, cam, shadowVec, strength) {
    if (!this.ok || !this.shadowOk || count === 0) return;
    var p = this._pool && this._pool.shadow;
    if (!p) return;
    var gl = this.gl;
    gl.useProgram(this.shadowProgram);
    gl.bindVertexArray(this.shadowVao);
    if (this.sceneActive) gl.uniform2f(this.shUViewport, this._artW, this._artH);
    else gl.uniform2f(this.shUViewport, cssW, cssH);
    gl.uniform3f(this.shUCam, cam.x, cam.y, cam.scale);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.uniform1i(this.shUAtlas, 0);
    gl.uniform2f(this.shUShadowVec, shadowVec.x, shadowVec.y);
    gl.uniform1f(this.shUShadowAlpha, strength);
    gl.uniform1f(this.shUAtlasTexel, 1 / (this.atlasSize || 1));
    this._pointPoolAttribs(p.vbo, this._shadowAttribLocs, start);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.disable(gl.BLEND);
    this._pointPoolAttribs(this.shadowVbo, this._shadowAttribLocs, 0);
    gl.bindVertexArray(null);
  }
```

Where the sprite/shadow VAOs are first built (search `spriteVao` setup — the block that calls `vertexAttribPointer` for `aPSR`/`aAlpha`/`aUV` and `vertexAttribDivisor`), record the attrib locations on the instance:

```js
this._spriteAttribLocs = { psr: locPSR, alpha: locAlpha, uv: locUV };   // sprite program's locations
this._shadowAttribLocs = { psr: shLocPSR, alpha: shLocAlpha, uv: shLocUV }; // shadow program's
```

(Use whatever local variable names that setup code already has for the queried locations; the divisors are VAO state and stay valid when only the pointer offset changes.)

- [ ] **Step 5: Smoke-check in the running game**

Start dev server (or reuse :8742 in worktree). Load `http://localhost:8742/?x=1312&y=1312` — game must render identically (legacy path with identity uCam). Check the console for shader compile errors.

- [ ] **Step 6: Commit**

```bash
git add src/render/gl-compositor.js
git commit -m "feat(gl): world-space uCam sprite/shadow shaders + persistent pool VBOs with range draws"
```

---

### Task 3: Registry + rebuild in field2-animator (collect → sort → mirrors → full upload)

**Files:**
- Modify: `src/render/field2-animator.js` (new section after `imgFade`, line ~923; `drawField2Animations` gains the GL branch in Task 5)

This task builds the data structures and the event-driven rebuild, without wiring the draw yet — the existing path keeps running so every commit stays shippable.

- [ ] **Step 1: Add pool state + imports**

At the top of field2-animator.js add to the existing import from `./sprite-pool-util.js`:

```js
import { coalesceDirty, lowerBound } from './sprite-pool-util.js';
```

After the `imgFade` function (line ~923) add:

```js
// ==== GL persistent sprite pool ====
// World-space instances live in CPU mirrors + persistent GPU VBOs.
// Full rebuild only on events (tile window / zoom / tuning / chunk-ready);
// the 10Hz tick triggers animations; the per-frame path touches only the
// active list. Spec: docs/superpowers/specs/2026-06-12-f2-persistent-
// instance-buffers-design.md
var _pool = {
  n: 0,                 // live instance count
  mirror: null,         // Float32Array, n * SPRITE_FLOATS (sprite instances)
  shadowMirror: null,   // Float32Array, shadowN * SPRITE_FLOATS
  shadowN: 0,
  sortY: null,          // Float32Array(n) — for player lowerBound
  meta: [],             // per-instance registry (see _poolRebuild)
  shadowOf: null,       // Int32Array(n): sprite idx -> shadow idx or -1
  tiles: [],            // per-tile groups: { wx, wy, first, count, biomeShadowK }
  active: new Map(),    // instance idx -> true (currently animating/fading)
  dirty: new Set(),     // instance idxs needing upload this frame
  shadowDirty: new Set(),
  pending: [],          // instance idxs whose image/atlas wasn't ready at rebuild
  key: '',              // rebuild key — change forces rebuild
  lastTickMs: 0,
  uploaded: false,
};
var _f2Stats = { rebuilds: 0, dirtyInstances: 0, activeCount: 0, lastRebuildMs: 0, ticks: 0 };
if (typeof window !== 'undefined') window._f2Stats = _f2Stats;

export function clearF2Pool() { _pool.key = ''; }
```

Call `clearF2Pool()` from `clearF2TileDescriptors()` (the existing export near line 601) so every existing invalidation (tuner apply, anim toggles) also forces a pool rebuild:

```js
export function clearF2TileDescriptors() {
  _tileDescCache.clear();
  clearF2Pool();
}
```

- [ ] **Step 2: Write `_poolRebuild`**

This reuses the existing collect loop almost verbatim, but emits world-space registry entries instead of screen-space draw records. Add after the state block:

```js
// Build one instance's static 9 floats into the mirror. UV/alpha may be
// patched later (anim frames, fades). Returns the atlas rect or null.
function _poolWriteStatic(idx, m, worldX, worldPivotY, sizeTiles, rot, alpha, rect) {
  var o = idx * SPRITE_FLOATS;
  m[o] = worldX;
  m[o + 1] = worldPivotY;
  m[o + 2] = sizeTiles;
  m[o + 3] = rot;
  m[o + 4] = alpha;
  if (rect) {
    m[o + 5] = rect.u0; m[o + 6] = rect.v0; m[o + 7] = rect.du; m[o + 8] = rect.dv;
  } else {
    m[o + 5] = 0; m[o + 6] = 0; m[o + 7] = 0; m[o + 8] = 0;
  }
}

function _poolRebuild(chunkStore, player, glc, tilePxSnapped, radiusX, radiusY) {
  var t0 = performance.now();
  var px = Math.floor(player.x);
  var py = Math.floor(player.y);
  var maxR = Math.max(radiusX, radiusY);
  var fadeStart = maxR - 6;

  // Phase 1: collect raw entries (unsorted), exactly mirroring the legacy
  // per-tile/per-blade walk minus all time-dependent work.
  var entries = []; // { sortY, worldX, worldPivotY, sizeTiles, baseAngle, edgeFade, ... }
  var tiles = [];
  for (var wy = py - radiusY; wy <= py + radiusY; wy++) {
    for (var wx = px - radiusX; wx <= px + radiusX; wx++) {
      var cx = floorDiv(wx, WORLD.chunkSize);
      var cy = floorDiv(wy, WORLD.chunkSize);
      var chunk = chunkStore.getIfReady(cx, cy);
      if (!chunk) continue;
      var tx = ((wx % WORLD.chunkSize) + WORLD.chunkSize) % WORLD.chunkSize;
      var ty = ((wy % WORLD.chunkSize) + WORLD.chunkSize) % WORLD.chunkSize;
      var tile = chunk.tiles[ty * WORLD.chunkSize + tx];
      if (!tile) continue;
      var objects = SF_BIOME_OBJECTS_LIST[tile.biome];
      if (!objects || objects.length === 0) continue;
      if (tile.transitionPair) continue;

      var tkey = wx + ',' + wy;
      var desc;
      if (_tileDescCache.has(tkey)) {
        desc = _tileDescCache.get(tkey);
      } else {
        var built = buildTileDescriptor(chunkStore, tile, objects, wx, wy);
        desc = built.desc;
        if (built.cacheable) {
          if (_tileDescCache.size >= MAX_TILE_DESC_CACHE) _tileDescCache.clear();
          _tileDescCache.set(tkey, desc);
        }
      }
      if (!desc) continue;

      var dist = Math.max(Math.abs(wx - px), Math.abs(wy - py));
      var edgeFade = dist <= fadeStart ? 1.0 : Math.max(0, 1.0 - (dist - fadeStart) / (maxR - fadeStart));
      var biomeShadowK = getAtmosphere(tile.biome).shadow / 100;
      var tileEntry = { wx: wx, wy: wy, first: -1, count: 0, biomeShadowK: biomeShadowK };

      for (var b = 0; b < desc.blades.length; b++) {
        var bl = desc.blades[b];
        entries.push({
          sortY: wy + bl.sortYOff,
          worldX: wx + 0.5 + bl.offUX,
          // pivot at bottom-center: tile-center Y + half the draw size
          worldPivotY: wy + 0.5 + bl.offUY + bl.lifeScale * 0.5,
          sizeTiles: bl.lifeScale,
          bl: bl, wx: wx, wy: wy,
          edgeFade: edgeFade, biomeShadowK: biomeShadowK,
          tileRef: tileEntry,
        });
      }
      if (desc.extra) {
        entries.push({
          sortY: wy + 0.5,
          worldX: wx + 0.5 + desc.extra.offUX,
          worldPivotY: wy + 0.5 + desc.extra.offUY + 0.5,
          sizeTiles: 1.0,
          bl: null, extraUrl: desc.extra.url, wx: wx, wy: wy,
          edgeFade: edgeFade, biomeShadowK: biomeShadowK,
          tileRef: tileEntry,
        });
      }
      if (entries.length && entries[entries.length - 1].tileRef === tileEntry) tiles.push(tileEntry);
    }
  }

  // Phase 2: sort once by sortY (stable order for the lifetime of the pool).
  entries.sort(function (a, b) { return a.sortY - b.sortY; });

  // Phase 3: pack mirrors + registry.
  var n = entries.length;
  if (!_pool.mirror || _pool.mirror.length < n * SPRITE_FLOATS) {
    _pool.mirror = new Float32Array(Math.max(4096, n * SPRITE_FLOATS * 2));
    _pool.sortY = new Float32Array(Math.max(512, n * 2));
    _pool.shadowOf = new Int32Array(Math.max(512, n * 2));
    _pool.shadowMirror = new Float32Array(Math.max(4096, n * SPRITE_FLOATS * 2));
  }
  _pool.meta.length = 0;
  _pool.tiles = [];
  _pool.active.clear();
  _pool.dirty.clear();
  _pool.shadowDirty.clear();
  _pool.pending.length = 0;
  var minShadowTiles = 0.6; // legacy: drawSize < tilePxSnapped*0.6 skips shadow
  var shCount = 0;
  var lastTile = null;
  var timeMs = performance.now();
  for (var i = 0; i < n; i++) {
    var e = entries[i];
    _pool.sortY[i] = e.sortY;
    if (e.tileRef !== lastTile) { e.tileRef.first = i; lastTile = e.tileRef; _pool.tiles.push(e.tileRef); }
    e.tileRef.count++;

    var url, img, frameCount = null, restFrame = 0, baseAngle = 0;
    if (e.bl) {
      var bl = e.bl;
      baseAngle = bl.baseAngle;
      restFrame = bl.restFrame;
      frameCount = bl.frameCount || null;
      img = (bl.stateUrl) ? loadFrame(bl.stateUrl) : null;
      if (!img && bl.animUrlBase) {
        img = loadFrame(bl.animUrlBase + 'frame_' + String(bl.restFrame).padStart(3, '0') + '.png', bl.frameCount);
      }
      if (!img) img = loadFrame(bl.staticUrl);
    } else {
      img = loadFrame(e.extraUrl);
    }
    var drawSizePx = tilePxSnapped * e.sizeTiles;
    var rect = null, alpha = 0;
    if (img) {
      img = scaledFrame(img, drawSizePx);
      rect = glc.atlasRect(img, img.src || img._dnKey || '');
      alpha = e.edgeFade * imgFade(img, timeMs);
    }
    _poolWriteStatic(i, _pool.mirror, e.worldX, e.worldPivotY, e.sizeTiles, baseAngle, rect ? alpha : 0, rect);
    if (!rect || (img && img._f2At)) _pool.pending.push(i);
    if (img && img._f2At) _pool.active.set(i, true); // fade-in continues per frame

    // Shadow eligibility mirrors the legacy gate.
    var sIdx = -1;
    if (e.sizeTiles >= minShadowTiles) {
      sIdx = shCount++;
      var tier = (drawSizePx - tilePxSnapped * minShadowTiles) / (tilePxSnapped * 1.2);
      tier = tier < 0 ? 0 : tier > 1 ? 1 : tier;
      var diffuseK = 0.30 + 0.70 * tier;
      _poolWriteStatic(sIdx, _pool.shadowMirror, e.worldX, e.worldPivotY, e.sizeTiles,
        /* rot slot = diffusion */ 1.0 - tier,
        (rect ? alpha : 0) * e.biomeShadowK * diffuseK, rect);
    }
    _pool.shadowOf[i] = sIdx;

    _pool.meta.push({
      bl: e.bl, wx: e.wx, wy: e.wy, edgeFade: e.edgeFade,
      biomeShadowK: e.biomeShadowK, sizeTiles: e.sizeTiles,
      drawSizePx: drawSizePx, img: img || null,
      lastFrameIdx: restFrame, frozen: false,
    });
  }
  _pool.n = n;
  _pool.shadowN = shCount;

  // Phase 4: full GPU upload.
  var ok = glc.ensurePoolCapacity('sprite', n + 1) && glc.ensurePoolCapacity('shadow', shCount + 1);
  if (ok) {
    glc.uploadPoolRange('sprite', _pool.mirror, 0, n);
    glc.uploadPoolRange('shadow', _pool.shadowMirror, 0, shCount);
    _pool.uploaded = true;
  } else {
    _pool.uploaded = false;
  }
  _f2Stats.rebuilds++;
  _f2Stats.lastRebuildMs = performance.now() - t0;
}
```

Notes for the implementer:
- `loadFrame`, `scaledFrame`, `buildTileDescriptor`, `_tileDescCache`, `MAX_TILE_DESC_CACHE`, `imgFade`, `getAtmosphere`, `floorDiv`, `WORLD`, `SF_BIOME_OBJECTS_LIST` all already exist in this file/imports — do not duplicate them.
- The sim-override (`_simWorldState`) is intentionally NOT consulted at rebuild; the 10Hz tick owns it (Task 4) so overrides apply with at most 100ms latency whether or not a rebuild happens.
- `img._f2At` is the fade-in timestamp set by the loader; non-zero means mid-fade.

- [ ] **Step 3: Write the rebuild-key check**

```js
// Cheap per-frame signature: rebuild only when it changes. Chunk readiness
// is detected by counting ready chunks in the window (~120 getIfReady calls
// — Map lookups, ~free). Repaints don't change blade layout, so they don't
// need to participate.
function _poolKey(chunkStore, px, py, tilePxSnapped, radiusX, radiusY) {
  var minCX = floorDiv(px - radiusX, WORLD.chunkSize);
  var maxCX = floorDiv(px + radiusX, WORLD.chunkSize);
  var minCY = floorDiv(py - radiusY, WORLD.chunkSize);
  var maxCY = floorDiv(py + radiusY, WORLD.chunkSize);
  var ready = 0;
  for (var cy = minCY; cy <= maxCY; cy++)
    for (var cx = minCX; cx <= maxCX; cx++)
      if (chunkStore.getIfReady(cx, cy)) ready++;
  return px + '|' + py + '|' + tilePxSnapped.toFixed(4) + '|' + radiusX + '|' + radiusY + '|' + ready;
}
```

(`clearF2Pool()` setting `key = ''` covers tuner apply, anim toggles, and sim attach via the existing `clearF2TileDescriptors()` calls.)

- [ ] **Step 4: Run the full unit suite (nothing should regress — new code is not yet called)**

Run: `node --test test/field-tuning.test.js test/decoration-claims-f5.test.js test/random.test.js test/f6-placements.test.mjs test/sprite-pool-util.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/render/field2-animator.js
git commit -m "feat(render): F2 pool registry + event-driven rebuild (world-space mirrors, not yet wired)"
```

---

### Task 4: 10Hz trigger tick

**Files:**
- Modify: `src/render/field2-animator.js` (after `_poolKey`)

The tick reproduces the legacy trigger logic (field2-animator.js:1025-1065) over the registry: wind impulse per tile, ambient self-trigger, contagion, sim overrides, pending-atlas retry. It only *starts/extends* animations; envelope playback is per-frame (Task 5). `triggerTimes` (the existing module-level Map, including its `wx*10000+wy*100+bi` key and the bi=0 neighbor-lookup quirk) is kept verbatim so behavior matches the 2D path bit-for-bit.

- [ ] **Step 1: Implement `_poolTick`**

```js
function _poolTick(timeMs, timeSec, glc, tilePxSnapped) {
  _f2Stats.ticks++;
  // 1) Wind + ambient triggers, per tile then per blade (arithmetic only).
  for (var t = 0; t < _pool.tiles.length; t++) {
    var tg = _pool.tiles[t];
    var currentEffect = sampleCurrents(tg.wx, tg.wy, timeSec);
    tg.rot = currentEffect.rot; // cached for per-frame sway math
    var baseImpulse = Math.abs(currentEffect.rot) * 12;
    for (var i = tg.first; i < tg.first + tg.count; i++) {
      var meta = _pool.meta[i];
      var bl = meta.bl;
      if (!bl) continue;
      var canAnimate = !!bl.animUrlBase || !!bl.ambientPeriod || (!bl.isRigid && bl.lifeSway !== 0);
      if (!canAnimate) continue;
      var blCycle = (bl.frameCount || FRAME_COUNT) * FRAME_DURATION;
      var impulse = baseImpulse;
      // Tick runs every 100ms but the legacy ambient window is ~4*blCycle
      // (>4s wide) — a 10Hz sample cannot miss it.
      if (bl.ambientPeriod && (timeMs + bl.ambientPhase) % bl.ambientPeriod < blCycle * 4) {
        impulse = 0.2;
      }
      var triggerKey = meta.wx * 10000 + meta.wy * 100 + bl.bi;
      if (impulse > 0.08) {
        var existing = triggerTimes.get(triggerKey);
        if (!existing || timeMs - existing.time > blCycle * 2) {
          triggerTimes.set(triggerKey, { time: timeMs + bl.startDelay, ext: 0 });
          _pool.active.set(i, true);
        } else if (existing) {
          _pool.active.set(i, true);
        }
      }
      // Contagion (legacy lines 1050-1065), evaluated at tick rate.
      var triggerData = triggerTimes.get(triggerKey);
      if (triggerData) {
        var triggerDuration = blCycle * bl.loopCount;
        var elapsed = timeMs - triggerData.time;
        if (elapsed > triggerDuration * 0.8 && triggerData.ext < MAX_EXTENSIONS) {
          var shouldExtend = false;
          for (var nd = -1; nd <= 1 && !shouldExtend; nd++) {
            for (var ne = -1; ne <= 1 && !shouldExtend; ne++) {
              if (nd === 0 && ne === 0) continue;
              var nData = triggerTimes.get((meta.wx + ne) * 10000 + (meta.wy + nd) * 100);
              if (!nData) continue;
              var nElapsed = timeMs - nData.time;
              if (nElapsed < triggerDuration * 0.6 && nData.ext < MAX_EXTENSIONS) shouldExtend = true;
            }
          }
          if (shouldExtend) {
            triggerTimes.set(triggerKey, { time: triggerData.time + blCycle, ext: triggerData.ext + 1 });
            _pool.active.set(i, true);
          }
        }
        if (elapsed >= 0 && elapsed <= triggerDuration) _pool.active.set(i, true);
      }
    }
  }

  // 2) Sim overrides (F4 entries, bi >= 90). At most 100ms latency.
  if (_simWorldState) {
    for (var j = 0; j < _pool.n; j++) {
      var m2 = _pool.meta[j];
      if (!m2.bl || m2.bl.bi < 90) continue;
      var key = 'f4:' + m2.wx + ',' + m2.wy + ':' + (m2.bl.bi - 90);
      var ov = _simWorldState.overrideFor(key);
      var want = null;
      if (ov && ov.removed) want = 'REMOVED';
      else if (ov && ov.visual && ov.visual !== 'normal') want = ov.visual;
      if (want !== m2.simState) {
        m2.simState = want;
        _pool.active.set(j, true); // per-frame path re-resolves img/alpha
      }
    }
  }

  // 3) Pending images: retry load/atlas; on success the per-frame fade
  // handles alpha ramp-up (sprite was added to active when it resolves).
  for (var pIdx = _pool.pending.length - 1; pIdx >= 0; pIdx--) {
    var k = _pool.pending[pIdx];
    var pm = _pool.meta[k];
    var img = pm.bl
      ? ((pm.bl.stateUrl ? loadFrame(pm.bl.stateUrl) : null)
        || (pm.bl.animUrlBase ? loadFrame(pm.bl.animUrlBase + 'frame_' + String(pm.bl.restFrame).padStart(3, '0') + '.png', pm.bl.frameCount) : null)
        || loadFrame(pm.bl.staticUrl))
      : loadFrame(pm.extraUrl || '');
    if (!img) continue;
    img = scaledFrame(img, pm.drawSizePx);
    var rect = glc.atlasRect(img, img.src || img._dnKey || '');
    if (!rect) continue;
    pm.img = img;
    _pool.active.set(k, true); // per-frame path writes UV + fade alpha
    _pool.pending.splice(pIdx, 1);
  }
}
```

Note: `meta.extraUrl` must be carried into `_pool.meta` for extra-decor entries — extend the `_pool.meta.push({...})` in Task 3 Step 2 with `extraUrl: e.extraUrl || null, simState: null`.

- [ ] **Step 2: Run unit suite (still not wired — no regression expected)**

Run: `node --test test/field-tuning.test.js test/decoration-claims-f5.test.js test/random.test.js test/f6-placements.test.mjs test/sprite-pool-util.test.js`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add src/render/field2-animator.js
git commit -m "feat(render): F2 pool 10Hz trigger tick (wind/ambient/contagion/sim/pending)"
```

---

### Task 5: Per-frame pool path — wire into drawField2Animations

**Files:**
- Modify: `src/render/field2-animator.js:929-1326` (`drawField2Animations`)

- [ ] **Step 1: Implement `_poolFrame` (active-list update + dirty upload + draws)**

```js
function _poolFrame(ctx, chunkStore, player, camera, w, h, chunkGrid, timeMs, weather, sun, glc) {
  var tilePxSnapped = chunkGrid.chunkPx / WORLD.chunkSize;
  var visibleTilesX = Math.ceil(w / tilePxSnapped / 2) + 2;
  var visibleTilesY = Math.ceil(h / tilePxSnapped / 2) + 2;
  var radiusX = Math.min(ANIM_RADIUS, visibleTilesX);
  var radiusY = Math.min(ANIM_RADIUS, visibleTilesY);
  var px = Math.floor(player.x);
  var py = Math.floor(player.y);
  var timeSec = timeMs * 0.001;

  // Wind currents advance per frame (cheap; ≤4 currents).
  var wind = weather ? weather.wind() : { direction: 0.3, intensity: 0.3 };
  updateCurrents(timeSec, wind.direction, wind.intensity, player.x, player.y);

  // Rebuild on key change (tile window, zoom, chunk readiness, tuner clear).
  var key = _poolKey(chunkStore, px, py, tilePxSnapped, radiusX, radiusY);
  if (key !== _pool.key || !_pool.uploaded) {
    _pool.key = key;
    _poolRebuild(chunkStore, player, glc, tilePxSnapped, radiusX, radiusY);
    if (!_pool.uploaded) return false; // GL not ready — caller falls back to legacy path
  }

  // 10Hz trigger tick.
  if (timeMs - _pool.lastTickMs >= 100) {
    _pool.lastTickMs = timeMs;
    _poolTick(timeMs, timeSec, glc, tilePxSnapped);
  }

  // Per-frame: animate only the active list.
  var m = _pool.mirror;
  var sm = _pool.shadowMirror;
  var doneKeys = null;
  _pool.active.forEach(function (_v, i) {
    var meta = _pool.meta[i];
    var bl = meta.bl;
    var o = i * SPRITE_FLOATS;
    var stillActive = false;

    var frameIdx = bl ? bl.restFrame : 0;
    var animBlend = 0;
    if (bl) {
      var blCycle = (bl.frameCount || FRAME_COUNT) * FRAME_DURATION;
      var triggerKey = meta.wx * 10000 + meta.wy * 100 + bl.bi;
      var triggerData = triggerTimes.get(triggerKey);
      var triggerTime = triggerData ? triggerData.time : -99999;
      var triggerDuration = blCycle * bl.loopCount;
      var elapsed = timeMs - triggerTime;
      var isAnimating = elapsed >= 0 && elapsed <= triggerDuration;
      if (isAnimating) {
        frameIdx = Math.floor((elapsed / FRAME_DURATION + bl.restFrame) % (bl.frameCount || FRAME_COUNT));
        var cycleProgress = elapsed / blCycle;
        if (cycleProgress < 1) animBlend = Math.min(1, cycleProgress * 2);
        else if (cycleProgress > bl.loopCount - 1) animBlend = Math.max(0, (bl.loopCount - cycleProgress) * 2);
        else animBlend = 1;
        stillActive = true;
      } else if (triggerData && triggerTime > -99999) {
        // Freeze on the frame the animation ended on (ambient-life design).
        frameIdx = Math.floor((triggerDuration / FRAME_DURATION + bl.restFrame) % (bl.frameCount || FRAME_COUNT));
      }
    }

    // Resolve image: sim state > lifecycle state > anim frame > static.
    var img = null;
    if (bl && meta.simState === 'REMOVED') { img = null; }
    else if (bl) {
      var simUrl = (meta.simState && meta.simState !== 'REMOVED')
        ? f4SpriteUrl({ name: bl._f4Name, biome: bl._f4Biome, variant: bl._f4Variant, state: meta.simState })
        : null;
      img = (simUrl || bl.stateUrl) ? loadFrame(simUrl || bl.stateUrl) : null;
      if (!img && bl.animUrlBase) {
        img = loadFrame(bl.animUrlBase + 'frame_' + String(frameIdx).padStart(3, '0') + '.png', bl.frameCount);
      }
      if (!img) img = loadFrame(bl.staticUrl);
    } else {
      img = meta.img; // extra decor: static, only fades
    }

    var rect = null, alpha = 0, sway = 0;
    if (img) {
      img = scaledFrame(img, meta.drawSizePx);
      rect = glc.atlasRect(img, img.src || img._dnKey || '');
      var fade = imgFade(img, timeMs);
      if (fade < 1) stillActive = true; // keep fading
      alpha = meta.edgeFade * fade;
      if (bl && !bl.isRigid) {
        sway = (meta.tileRotCached || 0) * 1.2 * animBlend * bl.lifeSway;
      }
    }
    // Write floats + mark dirty.
    m[o + 3] = (bl ? bl.baseAngle : 0) + sway;
    m[o + 4] = rect ? alpha : 0;
    if (rect) { m[o + 5] = rect.u0; m[o + 6] = rect.v0; m[o + 7] = rect.du; m[o + 8] = rect.dv; }
    _pool.dirty.add(i);
    var sIdx = _pool.shadowOf[i];
    if (sIdx >= 0) {
      var so = sIdx * SPRITE_FLOATS;
      var tier = 1.0 - sm[so + 3]; // diffusion slot was set at rebuild
      sm[so + 4] = (rect ? alpha : 0) * meta.biomeShadowK * (0.30 + 0.70 * tier);
      if (rect) { sm[so + 5] = rect.u0; sm[so + 6] = rect.v0; sm[so + 7] = rect.du; sm[so + 8] = rect.dv; }
      _pool.shadowDirty.add(sIdx);
    }
    if (!stillActive) { if (!doneKeys) doneKeys = []; doneKeys.push(i); }
  });
  if (doneKeys) for (var d = 0; d < doneKeys.length; d++) _pool.active.delete(doneKeys[d]);

  // Upload dirty ranges (full upload if heavily fragmented).
  var FULL_FRACTION = 0.30, GAP = 8;
  if (_pool.dirty.size > 0) {
    if (_pool.dirty.size > _pool.n * FULL_FRACTION) {
      glc.uploadPoolRange('sprite', m, 0, _pool.n);
    } else {
      var ranges = coalesceDirty(Array.from(_pool.dirty), GAP);
      for (var r = 0; r < ranges.length; r++) glc.uploadPoolRange('sprite', m, ranges[r].start, ranges[r].count);
    }
  }
  if (_pool.shadowDirty.size > 0) {
    if (_pool.shadowDirty.size > _pool.shadowN * FULL_FRACTION) {
      glc.uploadPoolRange('shadow', sm, 0, _pool.shadowN);
    } else {
      var sRanges = coalesceDirty(Array.from(_pool.shadowDirty), GAP);
      for (var sr = 0; sr < sRanges.length; sr++) glc.uploadPoolRange('shadow', sm, sRanges[sr].start, sRanges[sr].count);
    }
  }
  _f2Stats.dirtyInstances = _pool.dirty.size;
  _f2Stats.activeCount = _pool.active.size;
  _pool.dirty.clear();
  _pool.shadowDirty.clear();

  // Camera uniform.
  var cam = {
    x: chunkGrid.baseSX - chunkGrid.minCX * chunkGrid.chunkPx,
    y: chunkGrid.baseSY - chunkGrid.minCY * chunkGrid.chunkPx,
    scale: tilePxSnapped,
  };

  // Shadows first (under sprites), as today.
  var sunH = sun ? sun.sunHeight : 1;
  var sunUp = sunH < 0.08 ? (sunH / 0.08) * (sunH / 0.08) * (3 - 2 * (sunH / 0.08)) : 1;
  if (glc.shadowOk && sun && sunH > 0.001 && _pool.shadowN > 0) {
    var shVec = { x: sun.shadowX * sun.shadowLength * 0.9, y: sun.shadowLength * 0.35 };
    var shStrength = 0.50 * (0.62 + (1 - sunH) * 0.38) * sunUp;
    glc.drawPoolShadows(0, _pool.shadowN, w, h, cam, shVec, shStrength);
  }

  // Player: uploaded per frame, drawn as a 1-instance range between the two
  // halves of the pool split at the player's sortY (no baseInstance needed —
  // painter's order across three draws).
  var pRect = _playerGL ? glc.uploadPlayerSprite(_playerGL.canvas) : null;
  var split = _pool.n;
  if (pRect && _playerGL) {
    split = lowerBound(_pool.sortY, player.y + 0.4, _pool.n);
    var tail = _pool.n; // player instance lives at slot n (capacity is n+1)
    var to = tail * SPRITE_FLOATS;
    // Player floats are SCREEN px (already computed by the compositor path),
    // so convert to world units for the shared shader: world = (px - off)/scale.
    m[to] = (_playerGL.pivotX - cam.x) / cam.scale;
    m[to + 1] = (_playerGL.pivotY - cam.y) / cam.scale;
    m[to + 2] = _playerGL.size / cam.scale;
    m[to + 3] = 0;
    m[to + 4] = 1;
    m[to + 5] = pRect.u0; m[to + 6] = pRect.v0; m[to + 7] = pRect.du; m[to + 8] = pRect.dv;
    glc.uploadPoolRange('sprite', m, tail, 1);
  }
  glc.drawPoolSprites(0, split, w, h, cam);
  if (pRect && _playerGL) glc.drawPoolSprites(_pool.n, 1, w, h, cam);
  if (split < _pool.n) glc.drawPoolSprites(split, _pool.n - split, w, h, cam);
  return true;
}
```

**Sway source:** `meta.tileRotCached` is written by `_poolTick` (Task 4): inside the per-blade loop add `meta.tileRotCached = currentEffect.rot;`. (Wind rot changes on ~1s timescales; a 100ms sample is visually smooth because `animBlend` still eases per frame.)

- [ ] **Step 2: Branch in `drawField2Animations`**

At the top of the function (after the `_f2Ready` guard, line 931), insert:

```js
  if (glc && glc.spritesOk) {
    var usedPool = _poolFrame(ctx, chunkStore, player, camera, w, h, chunkGrid, timeMs, weather, sun, glc);
    if (usedPool) {
      // Player-velocity tracking still feeds wind interaction elsewhere.
      _prevPlayerX = player.x; _prevPlayerY = player.y;
      return;
    }
  }
```

The rest of the function (the legacy path) is left byte-for-byte intact — it now serves the 2D mode and the GL-not-ready frame(s). The debug `8`-key dump keeps working in 2D mode; add a pool variant: in `_poolFrame`, after rebuild, if `self._f2DumpNext` is set, log `_pool.n + ' sprites in pool'` plus URL counts from `_pool.meta[i].img` and clear the flag.

- [ ] **Step 3: Manual smoke test in the browser**

Dev server on :8742. Load `?x=1312&y=1312` (grassland). Verify: grass renders, wind gusts sweep, trees/logs y-sort correctly against the player walking around, shadows present and rotating with time, no console errors. Check `window._f2Stats` in DevTools: `rebuilds` should stay flat while standing still, increment by ~1 per tile crossed while walking; `activeCount` should hover in the tens-to-hundreds; `dirtyInstances` should be ≈ activeCount, not ≈ pool size.

- [ ] **Step 4: Run unit suite**

Run: `node --test test/field-tuning.test.js test/decoration-claims-f5.test.js test/random.test.js test/f6-placements.test.mjs test/sprite-pool-util.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/render/field2-animator.js
git commit -m "feat(render): wire persistent sprite pool into GL frame path — uniform camera, active-list updates, 3-range player split"
```

---

### Task 6: `_f2Stats` perf probe

**Files:**
- Create: `scripts/probe-f2-perf.mjs`

- [ ] **Step 1: Write the probe**

Pattern-match `scripts/probe-f2-visual.mjs` (playwright-core, swiftshader, PROBE_PORT). This probe runs the **GL** path (do NOT set `useGL = false`).

```js
// scripts/probe-f2-perf.mjs — does the persistent pool actually stay
// persistent? Asserts rebuild/dirty invariants via window._f2Stats while
// panning the camera. Run with dev server up; PROBE_PORT to override :8741.
import { chromium } from 'playwright-core';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';

const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const PORT = process.env.PROBE_PORT || 8741;
await page.goto(`http://localhost:${PORT}/?x=1312&y=1312`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window._f2Stats && window._dbgRenderer && window._lighting
  && window._f2Stats.rebuilds > 0, null, { timeout: 240000 });
await page.waitForTimeout(5000); // let chunk loads + initial rebuilds settle

const res = await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  window._lighting.paused = true;
  window._lighting.time = 0.5;
  const p = window._player || window._dbgPlayer; // whichever the page exposes
  // settle: wait until rebuilds stop changing
  let last = window._f2Stats.rebuilds;
  for (let i = 0; i < 20; i++) { await wait(500); if (window._f2Stats.rebuilds === last) break; last = window._f2Stats.rebuilds; }

  // Leg 1: stand still 3s — zero rebuilds, dirty stays small.
  const r0 = window._f2Stats.rebuilds;
  let maxDirty = 0, samples = 0, dirtySum = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < 3000) {
    await wait(100);
    maxDirty = Math.max(maxDirty, window._f2Stats.dirtyInstances);
    dirtySum += window._f2Stats.dirtyInstances; samples++;
  }
  const idleRebuilds = window._f2Stats.rebuilds - r0;

  // Leg 2: sub-tile pan — move the player by 0.4 tiles (no floor() change).
  const r1 = window._f2Stats.rebuilds;
  const startX = p.x;
  for (let s = 0; s < 8; s++) { p.x = startX + 0.05 * (s + 1); await wait(100); }
  p.x = startX;
  await wait(300);
  const subTileRebuilds = window._f2Stats.rebuilds - r1;

  // Leg 3: cross a tile boundary — expect at least one rebuild, and few.
  const r2 = window._f2Stats.rebuilds;
  p.x = startX + 1.2;
  await wait(800);
  const crossRebuilds = window._f2Stats.rebuilds - r2;
  p.x = startX;
  await wait(800);

  return { idleRebuilds, subTileRebuilds, crossRebuilds, maxDirty,
    avgDirty: dirtySum / samples, poolN: window._f2Stats.dirtyInstances >= 0 ? (window._f2PoolN || 0) : 0,
    activeCount: window._f2Stats.activeCount };
});

console.log(JSON.stringify(res, null, 2));
await browser.close();
// Invariants: no rebuilds at rest or sub-tile; crossing rebuilds (>=1, <=4 —
// crossing back counts too); dirty stays well under the pool size.
const ok = res.idleRebuilds === 0 && res.subTileRebuilds === 0
  && res.crossRebuilds >= 1 && res.crossRebuilds <= 4
  && res.maxDirty < 800;
console.log(ok ? 'F2 PERF PROBE PASSED' : 'F2 PERF PROBE FAILED');
process.exit(ok ? 0 : 1);
```

Implementer notes: find how the page exposes the player object (grep `window._player` / `window._dbg` in `src/`; whatever debug handle exists — if none exposes a writable player position, expose `window._f2PoolN = _pool.n` and move the player via the existing debug teleport mechanism used by other probes, or simulate arrow-key presses with `page.keyboard`). Also export `window._f2PoolN` from field2-animator after each rebuild (`if (typeof window !== 'undefined') window._f2PoolN = _pool.n;` at the end of `_poolRebuild`). Adjust the probe to whatever movement mechanism exists — the invariants are the contract, not the movement mechanics.

- [ ] **Step 2: Run the probe (alone — never concurrent with another playwright probe)**

Run: `PROBE_PORT=8742 node scripts/probe-f2-perf.mjs`
Expected: `F2 PERF PROBE PASSED` with `idleRebuilds: 0, subTileRebuilds: 0`.

- [ ] **Step 3: Commit**

```bash
git add scripts/probe-f2-perf.mjs src/render/field2-animator.js
git commit -m "test(probe): F2 pool persistence invariants — zero rebuilds at rest/sub-tile pan"
```

---

### Task 7: Regression gates — visual probes + parity

**Files:** none created (running existing gates; fix regressions if any)

- [ ] **Step 1: Run probe-f2-visual (2D path — must be untouched)**

Run: `PROBE_PORT=8742 node scripts/probe-f2-visual.mjs`
Expected: `F2 VISUAL PROBE PASSED`. (Gates are drift-aware; if the anim gate flakes once, rerun once — do not "fix" non-zero dReset.)

- [ ] **Step 2: Run probe-f3-visual**

Run: `PROBE_PORT=8742 node scripts/probe-f3-visual.mjs`
Expected: PASS. (Sequentially after Step 1 — probes crash when concurrent.)

- [ ] **Step 3: Run probe-field-tuning**

Run: `PROBE_PORT=8742 node scripts/probe-field-tuning.mjs`
Expected: PASS — tuner applies must still repaint F2 live (the `clearF2TileDescriptors → clearF2Pool` chain is what makes slider edits rebuild the pool).

- [ ] **Step 4: GL visual sanity via screenshot**

Use the playwright MCP tools or a 10-line throwaway script (in the project dir, import `playwright-core`): load `?x=1312&y=1312` with GL on, freeze lighting (`_lighting.paused = true; _lighting.time = 0.5`), screenshot, and eyeball: grass present at sane density, trees sorted behind/in front of player correctly, shadows attached at bases. Delete the throwaway script afterwards. (A pixel-exact old-vs-new A/B isn't possible post-merge in one tree — the legacy GL path is gone from the frame; the 2D probes + eyeball cover parity. If anything looks off, `git stash` gives the old frame for comparison.)

- [ ] **Step 5: Run the full unit suite + commit any fixes**

Run: `node --test test/field-tuning.test.js test/decoration-claims-f5.test.js test/random.test.js test/f6-placements.test.mjs test/sprite-pool-util.test.js`
Expected: all pass.

```bash
git add -u
git commit -m "test: F2 pool regression gates green (visual probes + tuning probe)" --allow-empty
```

---

### Task 8: Cleanup + perf measurement

**Files:**
- Modify: `src/render/gl-compositor.js`, `src/render/field2-animator.js`

- [ ] **Step 1: Delete dead legacy GL plumbing if unreferenced**

Grep for callers of `drawSpriteInstances` and `drawShadowInstances`:

Run: `grep -rn "drawSpriteInstances\|drawShadowInstances" src/`

If field2-animator's legacy branch no longer reaches them in GL mode BUT the legacy code path still contains the calls (it does — the `if (glc && glc.spritesOk)` block at lines 1177-1304): that block is now unreachable (the pool branch returns first whenever `glc && glc.spritesOk`). Delete the `if (glc && glc.spritesOk) { ... }` block from the legacy path (lines 1177-1304) and the now-unused `_instArray`/`_shadowArray` module vars, keeping the pure-2D remainder. Then if `drawSpriteInstances`/`drawShadowInstances` have no remaining callers, delete them from gl-compositor.js along with `instVbo`/`shadowVbo` setup IF nothing else uses them (the VAO default-pointer restore in `drawPoolSprites` references `this.instVbo` — either keep the VBOs as the VAO's default binding or simplify the restore to re-point at the pool VBO offset 0). Keep `uploadPlayerSprite` (the pool uses it).

- [ ] **Step 2: Verify nothing broke**

Run: `PROBE_PORT=8742 node scripts/probe-f2-perf.mjs` then `PROBE_PORT=8742 node scripts/probe-f2-visual.mjs` (sequentially).
Expected: both PASS.

- [ ] **Step 3: Measure**

In the browser (GL on, grassland), record 10s of the Performance panel or run `window._dbgRenderer` frame timing if available. Compare `drawField2Animations` self-time share against the 45.8% baseline. Target: < 8% of frame CPU; fps at vsync-off (or `requestAnimationFrame` delta histogram) approaching the 144fps budget (≤ 6.9ms/frame total). Record numbers in the commit message.

- [ ] **Step 4: Final commit**

```bash
git add -u
git commit -m "perf(render): remove per-frame F2 batch rebuild — persistent world-space pool ([X]% -> [Y]% frame CPU)"
```

---

## Self-review checklist results

- **Spec coverage:** §1 world-space + camera/sun uniforms → Tasks 2, 5. §2 persistent buffer + event rebuild + registry → Task 3. §3 active-list frame loop + coalesced uploads + 30% fallback → Task 5 (+Task 1 coalescer). §4 10Hz tick → Task 4. §5 Canvas2D untouched → Task 5 Step 2 (legacy path intact) + Task 7 Step 1 gate. §6 `_f2Stats` + perf probe + parity + unit tests → Tasks 1, 6, 7.
- **Known deltas from legacy (intentional, per spec):** atlas-miss sprites in non-scene GL mode are now invisible-until-atlased instead of falling back to the 2D canvas for a frame (they were mid-fade anyway); trigger/contagion latency ≤100ms; wind sway magnitude sampled at 10Hz (eased per frame by animBlend).
- **Type consistency:** `coalesceDirty(indices, gap)` / `lowerBound(arr, needle, len)` (Task 1) match Task 5 usage; `ensurePoolCapacity/uploadPoolRange/drawPoolSprites/drawPoolShadows` (Task 2) match Task 3/5 calls; `_poolRebuild(chunkStore, player, glc, tilePxSnapped, radiusX, radiusY)` matches its Task 5 call; meta fields (`bl, wx, wy, edgeFade, biomeShadowK, sizeTiles, drawSizePx, img, extraUrl, simState, tileRotCached`) are declared in Task 3 (+Task 4 note) before use in Task 5.
