# Outdoor Building See-Through Spotlight — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the player walks behind a building outdoors, open a soft circular GPU spotlight in the building around the player so you see through it to your character standing on the **real terrain**.

**Architecture:** Buildings leave the terrain chunk bake (subtractive) so real terrain exists under them. Buildings become a GL layer authored as **two Y-split bitmaps** — buildings *behind* the player (drawn under the player) and buildings *in front* (drawn over the player). The front bitmap is composited into the scene FBO with a **fragment-shader spotlight** that fades it around the player. Player-vs-building order is the Y-split (matching the game's sprite sort); building-vs-building order is a south-edge painter sort. All compositing is GPU, into the scene FBO before `presentScene`, so it inherits lighting / day-night / fog / CRT. This **refines the spec** (`2026-06-20-outdoor-building-spotlight-seethrough-design.md`) from the per-building depth-buffer mechanism to the simpler Y-split: identical visual, no z-fighting, no depth-buffer dependency. Approved edge = soft fade.

**Tech Stack:** Vanilla JS (ES modules), WebGL2 (`gl-compositor.js`), OffscreenCanvas authoring, web-worker chunk bake, `node --test` for pure-logic tests.

---

## File Structure

- **Create** `src/render/building-layer.js` — the outdoor building GL layer: the pure `splitBuildingsByPlayer()` partition + `buildBuildingLayerBitmaps()` author (reuses `drawBuildingTextured`). One responsibility: produce the behind/front building bitmaps for a frame.
- **Create** `sim/test/building-layer.test.js` — unit tests for the pure split logic.
- **Modify** `src/render/gl-compositor.js` — add `SPOTLIGHT_FRAG_SRC` + `drawBuildingSpotlightOverlay()` (a spotlight sibling of the existing `drawSceneOverlayBitmap`).
- **Modify** `src/render/canvas-renderer.js` — wire the behind blit (before the sprite batch) and the front spotlight blit (after); gate the old depth pass + ghost off when the layer is on.
- **Modify** `src/render/field2-animator.js` — gate, then remove, the see-through ghost player draw.
- **Modify** `src/render/worker-chunk-renderer.js` — remove the wall post-pass + roof bake from the chunk bake (keep floors).

Gated by `window._buildingLayer` (Task 4 default OFF for isolated bring-up; Task 5 flips default ON together with the bake change).

---

### Task 1: Pure Y-split partition + tests

**Files:**
- Create: `src/render/building-layer.js`
- Test: `sim/test/building-layer.test.js`

- [ ] **Step 1: Write the failing test**

Create `sim/test/building-layer.test.js`:

```js
// sim/test/building-layer.test.js — pure partition of buildings into behind/in-front of the player.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitBuildingsByPlayer } from '../../src/render/building-layer.js';

// Minimal fake building: south baseline = y + footprint.boundingBox.h.
function b(id, y, h) { return { id, y, footprint: { boundingBox: { w: 4, h } } }; }

test('partitions by south baseline vs player Y', () => {
  const north = b('north', 10, 4);  // baseline 14 — well north of player
  const onLine = b('online', 18, 2); // baseline 20 — exactly player Y → in front
  const south = b('south', 22, 4);  // baseline 26 — south of player
  const { behind, front } = splitBuildingsByPlayer([south, north, onLine], 20);
  assert.deepEqual(behind.map(x => x.id), ['north']);
  assert.deepEqual(front.map(x => x.id), ['online', 'south']);
});

test('each set is south-sorted (farther first)', () => {
  const a = b('a', 30, 4); // baseline 34
  const c = b('c', 40, 4); // baseline 44
  const { front } = splitBuildingsByPlayer([c, a], 10);
  assert.deepEqual(front.map(x => x.id), ['a', 'c']); // 34 before 44
});

test('skips buildings without a bounding box', () => {
  const ok = b('ok', 30, 4);
  const bad = { id: 'bad', y: 30, footprint: {} };
  const { behind, front } = splitBuildingsByPlayer([ok, bad], 10);
  assert.equal(behind.length + front.length, 1);
  assert.equal(front[0].id, 'ok');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test sim/test/building-layer.test.js`
Expected: FAIL — `Cannot find module '../../src/render/building-layer.js'`.

- [ ] **Step 3: Create `src/render/building-layer.js` with the pure function**

```js
// src/render/building-layer.js — the outdoor building GL layer (two Y-split bitmaps).
//
// Buildings are NO LONGER baked into the terrain chunk bitmap (worker-chunk-renderer.js drops the
// wall post-pass + roof bake), so real terrain exists under every building. This module re-renders
// the visible buildings at the live camera into TWO bitmaps split by the player's tile Y:
//   • behind — buildings whose south baseline is NORTH of the player (drawn UNDER the player)
//   • front  — buildings whose south baseline is at/SOUTH of the player (drawn OVER the player,
//              with the GPU spotlight so you see through to yourself on the terrain).
// canvas-renderer blits `behind` before the sprite batch and `front` (spotlight) after it. This
// resolves player-vs-building by the same Y-split the sprite sort uses; building-vs-building is the
// south-edge painter sort within each set. See
// docs/superpowers/specs/2026-06-20-outdoor-building-spotlight-seethrough-design.md and the plan.

import { drawBuildingTextured } from './building-occluder.js';
import { nearDepthBuildings } from './building-depth.js';

// South baseline = the building's front (south) edge in tile space.
function baseline(b) { return b.y + b.footprint.boundingBox.h; }

/** Partition buildings into those BEHIND the player (drawn under) and those IN FRONT (drawn over,
 *  spotlit). Split key = south baseline vs the player's tile Y; baseline >= playerY ⇒ in front
 *  (nearer the camera, can occlude). Each set is south-sorted (farther first) so the nearer
 *  building paints over the farther one. Pure; skips buildings missing a bounding box. */
export function splitBuildingsByPlayer(buildings, playerY) {
  const behind = [], front = [];
  for (const b of buildings) {
    const bb = b.footprint && b.footprint.boundingBox;
    if (!bb) continue;
    (b.y + bb.h >= playerY ? front : behind).push(b);
  }
  const bySouth = (a, c) => baseline(a) - baseline(c);
  behind.sort(bySouth);
  front.sort(bySouth);
  return { behind, front };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test sim/test/building-layer.test.js`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/render/building-layer.js sim/test/building-layer.test.js
git commit -m "feat(render): pure Y-split partition for the outdoor building layer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The two-bitmap author

**Files:**
- Modify: `src/render/building-layer.js`

- [ ] **Step 1: Add the author below `splitBuildingsByPlayer`**

Append to `src/render/building-layer.js`:

```js
// Shared per-frame offscreen canvases (one per set), reallocated on viewport resize.
let _behindCv = null, _behindCtx = null, _frontCv = null, _frontCtx = null;

function _ensure(w, h) {
  if (!_behindCv || _behindCv.width !== w || _behindCv.height !== h) {
    const make = () => (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(w, h)
      : (typeof document !== 'undefined') ? document.createElement('canvas') : null;
    _behindCv = make(); _frontCv = make();
    if (!_behindCv || !_frontCv) return false;
    _behindCv.width = w; _behindCv.height = h; _behindCtx = _behindCv.getContext('2d');
    _frontCv.width = w; _frontCv.height = h; _frontCtx = _frontCv.getContext('2d');
  }
  return true;
}

function _renderSet(ctx, list, camX, camY, tilePx, w, h) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = false;
  let drew = false;
  for (const b of list) {
    // drawBuildingTextured returns false until wall sprites load; south-sorted by the caller.
    if (drawBuildingTextured(ctx, b, camX, camY, tilePx, w, h)) drew = true;
  }
  return drew;
}

/** Render the behind+front building bitmaps for this frame. Returns { behind, front } where each
 *  is a canvas or null (null = empty set OR wall sprites not loaded yet). Returns null if there are
 *  no on-screen buildings at all. Culls to the on-screen set (+ north margin for tall roofs) via
 *  nearDepthBuildings, then splits by the player's tile Y. */
export function buildBuildingLayerBitmaps(buildings, camX, camY, tilePx, w, h, playerY) {
  if (!buildings || !buildings.length) return null;
  const near = nearDepthBuildings(buildings, camX, camY, tilePx, w, h);
  if (!near.length) return null;
  if (!_ensure(w, h)) return null;
  const { behind, front } = splitBuildingsByPlayer(near, playerY);
  const behindDrew = behind.length ? _renderSet(_behindCtx, behind, camX, camY, tilePx, w, h) : false;
  const frontDrew = front.length ? _renderSet(_frontCtx, front, camX, camY, tilePx, w, h) : false;
  return { behind: behindDrew ? _behindCv : null, front: frontDrew ? _frontCv : null };
}
```

- [ ] **Step 2: Verify the module still parses + tests pass**

Run: `node --check src/render/building-layer.js && node --test sim/test/building-layer.test.js`
Expected: no output from `--check` (OK), then PASS — 3 tests. (The author needs a canvas + sprites, so it's verified in-browser in Task 4; the pure split stays green here.)

- [ ] **Step 3: Commit**

```bash
git add src/render/building-layer.js
git commit -m "feat(render): two-bitmap (behind/front) building layer author

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: GPU spotlight overlay (shader + compositor method)

**Files:**
- Modify: `src/render/gl-compositor.js` (add `SPOTLIGHT_FRAG_SRC` near the other shader sources ~line 33; add `drawBuildingSpotlightOverlay` right after `drawSceneOverlayBitmap` ~line 1002)

- [ ] **Step 1: Add the spotlight fragment shader**

In `src/render/gl-compositor.js`, immediately after `FRAG_SRC` (the chunk fragment shader, ends ~line 33), add:

```js
// Building spotlight overlay: blit the FRONT building bitmap over the scene but fade it to nothing
// in a soft radial hole around the player, so you see THROUGH it to yourself on the real terrain.
// Reuses the chunk VERT_SRC quad (z=0 — the Y-split, not depth, orders player-vs-building). The
// hole is a GPU smoothstep on the distance from each fragment to the player's screen centre. NOTE
// gl_FragCoord origin is bottom-left in the FBO; uPlayerPx is top-left CSS/art px → flip Y.
var SPOTLIGHT_FRAG_SRC = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uViewport;   // _artW, _artH
uniform vec2 uPlayerPx;   // player screen centre (top-left origin)
uniform float uSpotInner; // px: fully clear at/inside this radius
uniform float uSpotOuter; // px: fully solid building at/outside this radius
out vec4 outColor;
void main() {
  vec2 frag = vec2(gl_FragCoord.x, uViewport.y - gl_FragCoord.y); // → top-left origin
  float hole = smoothstep(uSpotInner, uSpotOuter, distance(frag, uPlayerPx)); // 0 at player → 1 out
  outColor = texture(uTex, vUV) * hole; // premultiplied: fades colour AND alpha together
}`;
```

- [ ] **Step 2: Add the `drawBuildingSpotlightOverlay` method**

In `src/render/gl-compositor.js`, immediately after the closing `}` of `drawSceneOverlayBitmap()` (~line 1002), add:

```js
  // Like drawSceneOverlayBitmap, but blits the FRONT building bitmap with a GPU spotlight hole
  // around the player (playerPx in art/CSS px, top-left origin; spotInner/spotOuter in px). Call
  // AFTER the sprite batch, BEFORE presentScene. Premultiplied ONE/ONE_MINUS_SRC_ALPHA.
  drawBuildingSpotlightOverlay(bitmap, playerPx, spotInner, spotOuter) {
    if (!this.ok || !this.sceneActive || !bitmap) return;
    var gl = this.gl;
    if (!this.spotProgram) {
      var prog = this._buildProgram(VERT_SRC, SPOTLIGHT_FRAG_SRC);
      if (!prog) { this.spotProgram = null; this.spotOk = false; return; }
      this.spotProgram = prog;
      this.spotUViewport = gl.getUniformLocation(prog, 'uViewport');
      this.spotUPos = gl.getUniformLocation(prog, 'uPos');
      this.spotUSize = gl.getUniformLocation(prog, 'uSize');
      this.spotUTex = gl.getUniformLocation(prog, 'uTex');
      this.spotUPlayerPx = gl.getUniformLocation(prog, 'uPlayerPx');
      this.spotUInner = gl.getUniformLocation(prog, 'uSpotInner');
      this.spotUOuter = gl.getUniformLocation(prog, 'uSpotOuter');
      this.spotVao = gl.createVertexArray();
      gl.bindVertexArray(this.spotVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.unitVbo);
      var loc = gl.getAttribLocation(prog, 'aUnit');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    }
    if (this.spotOk === false) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    gl.viewport(0, 0, this._artW, this._artH);
    gl.useProgram(this.spotProgram);
    gl.bindVertexArray(this.spotVao);
    gl.uniform2f(this.spotUViewport, this._artW, this._artH);
    gl.uniform2f(this.spotUPlayerPx, playerPx.x, playerPx.y);
    gl.uniform1f(this.spotUInner, spotInner);
    gl.uniform1f(this.spotUOuter, spotOuter);
    gl.uniform1i(this.spotUTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    if (!this._spotTex) this._spotTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._spotTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform2f(this.spotUPos, 0, 0);
    gl.uniform2f(this.spotUSize, this._artW, this._artH);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }
```

- [ ] **Step 3: Verify the file parses**

Run: `node --check src/render/gl-compositor.js`
Expected: no output (OK). (GL needs a browser context — the visual check happens in Task 4.)

- [ ] **Step 4: Commit**

```bash
git add src/render/gl-compositor.js
git commit -m "feat(gl): drawBuildingSpotlightOverlay + spotlight fragment shader

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Wire the building layer (gated OFF) + gate the old depth/ghost path off when on

**Files:**
- Modify: `src/render/canvas-renderer.js` (import ~line 18; depth-pass block ~lines 448–471; `clearSpriteDepth` ~line 482; occluder block ~lines 569–575)
- Modify: `src/render/field2-animator.js` (the see-through ghost player draw — the `drawPoolSprites(..., true)` call(s))

- [ ] **Step 1: Add the import**

In `src/render/canvas-renderer.js`, after the existing `import { buildOccluderBitmap } from './building-occluder.js';` (~line 18), add:

```js
import { buildBuildingLayerBitmaps } from './building-layer.js';
```

- [ ] **Step 2: Gate the existing depth pass off when the layer is on, and blit the behind bitmap**

In `src/render/canvas-renderer.js`, replace the building-depth pass block (the block beginning `let _depthActive = false;` and ending at its closing `}` just before `// === FIELD 2`, ~lines 453–471) with:

```js
    // Outdoor building layer (Y-split): when window._buildingLayer is on, buildings are NOT baked
    // into the terrain — draw the BEHIND set here (under the player) and stash the FRONT set to
    // blit (spotlit) after the sprite batch. Gated OFF by default until the worker bake change
    // lands (Task 5). When OFF, fall back to the shipped depth-occlusion pass below.
    const _useLayer = glScene && !_inside && typeof window !== 'undefined' && window._buildingLayer === true;
    let _frontLayerBmp = null;
    if (_useLayer) {
      const _layer = buildBuildingLayerBitmaps(getCachedBuildings(), camX, camY, tilePx, w, h, player.y);
      if (_layer) {
        if (_layer.behind) this.glc.drawSceneOverlayBitmap(_layer.behind);
        _frontLayerBmp = _layer.front;
      }
    }

    // BUILDING DEPTH PASS (shipped occlusion — only when the new layer is OFF).
    let _depthActive = false;
    if (!_useLayer && glScene && typeof window !== 'undefined' && window._depthOcclusion !== false) {
      const _refY = (camY + h / 2) / tilePx;
      const _blds = nearDepthBuildings(getCachedBuildings(), camX, camY, tilePx, w, h);
      const _dbg = !!window._depthOcclusionDebug;
      let _wrote = false;
      for (const _b of _blds) {
        const _sil = renderBuildingSilhouette(_b, camX, camY, tilePx, w, h);
        if (!_sil) continue;
        const _z = tileDepth(_b.y + _b.footprint.boundingBox.h, _refY) * 2 - 1;
        this.glc.writeBuildingDepth(_sil, _z, _dbg);
        _wrote = true;
      }
      if (_wrote) {
        const _see = (typeof window._depthSeeStrength === 'number') ? window._depthSeeStrength : 0.45;
        this.glc.setSpriteDepth(_refY, DEPTH_SCALE, _see);
        _depthActive = true;
      }
    }
```

- [ ] **Step 3: Blit the front (spotlit) bitmap after the sprite batch**

In `src/render/canvas-renderer.js`, replace the outdoor fallback branch in the overlay block (~lines 569–575) — currently:

```js
      } else if (typeof window !== 'undefined' && window._depthOcclusion === false) {
        // Outdoors with depth occlusion explicitly OFF → fall back to the heuristic overlay
        // occluder (the depth pass above handles it by default; nothing to do here then).
        const _occ = buildOccluderBitmap(getCachedBuildings(), camX, camY, tilePx, w, h,
          { x: w / 2, y: _playerScreenY }, player);
        if (_occ) this.glc.drawSceneOverlayBitmap(_occ);
      }
```

with:

```js
      } else if (_useLayer) {
        // Outdoor building layer ON: blit the FRONT buildings with the GPU spotlight hole around
        // the player (torso-centred), revealing the player on the real terrain. radius 2.6 tiles,
        // inner 45% — matches the interior see-through wall.
        if (_frontLayerBmp) this.glc.drawBuildingSpotlightOverlay(_frontLayerBmp,
          { x: w / 2, y: _playerScreenY - tilePx * 0.6 }, tilePx * 2.6 * 0.45, tilePx * 2.6);
      } else if (typeof window !== 'undefined' && window._depthOcclusion === false) {
        // Outdoors with depth occlusion explicitly OFF → heuristic overlay occluder fallback.
        const _occ = buildOccluderBitmap(getCachedBuildings(), camX, camY, tilePx, w, h,
          { x: w / 2, y: _playerScreenY }, player);
        if (_occ) this.glc.drawSceneOverlayBitmap(_occ);
      }
```

- [ ] **Step 4: Gate the see-through ghost off when the layer is on**

In `src/render/field2-animator.js`, find the see-through ghost player draw — the SECOND `drawPoolSprites` call passing `true` (there are up to two player-draw sites; each has a normal call then a ghost call, e.g. `glc.drawPoolSprites(_pool.n, 1, w, h, cam); glc.drawPoolSprites(_pool.n, 1, w, h, cam, true);`). Wrap each ghost call so it is skipped when the layer owns occlusion:

```js
        glc.drawPoolSprites(_pool.n, 1, w, h, cam);
        if (typeof window === 'undefined' || window._buildingLayer !== true) {
          glc.drawPoolSprites(_pool.n, 1, w, h, cam, true);
        }
```

Apply the same wrap at every ghost-draw site.

- [ ] **Step 5: Verify parse + existing tests**

Run: `node --check src/render/canvas-renderer.js && node --check src/render/field2-animator.js && npm test`
Expected: `--check` clean; `npm test` PASS (no regressions — these are render files, the suite is sim logic).

- [ ] **Step 6: Browser verification (layer in isolation, buildings still baked)**

Start a no-cache server and open in a fresh incognito tab:
```bash
npx --yes http-server . -p 8131 -c-1 --silent &
```
In the page console: `window._buildingLayer = true`. Walk the player behind a building.
Expected at this stage (buildings are still baked into terrain too, so they look doubled/solid):
- A soft circular hole opens in the building around the player — proving the spotlight shader + the front/behind split + premultiplied blit all work.
- Inside the hole you currently see the *baked* building underneath (NOT terrain yet — that arrives in Task 5).
- Buildings north of the player still render (no vanishing) — proves the Y-split, not a single gated quad.
- `window._buildingLayer = false` returns to the shipped depth-occlusion behaviour (A/B).
Capture `#glTerrain` via `toDataURL` in a rAF and pixel-sample the hole centre to confirm it differs from the solid-building pixels.

- [ ] **Step 7: Commit**

```bash
git add src/render/canvas-renderer.js src/render/field2-animator.js
git commit -m "feat(render): wire Y-split building layer + GPU spotlight (gated off)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Remove walls+roofs from the terrain bake + default the layer ON

**Files:**
- Modify: `src/render/worker-chunk-renderer.js` (the wall post-pass + roof bake, ~lines 1324–1518; optional dead `if(false)` block ~1192–1255)
- Modify: `src/render/canvas-renderer.js` (flip the `_useLayer` default)

- [ ] **Step 1: Remove the wall post-pass + roof bake from the worker**

In `src/render/worker-chunk-renderer.js`, delete the entire wall-post-pass + roof-bake `try { … } catch { … }` block (begins at the comment `// ── Wall post-pass: inlined from separate-pass renderer ──` ~line 1324 and ends at the matching `}` of its `catch` ~line 1518, just before the `transferToImageBitmap()` at ~line 1520). **Keep** everything else: the per-tile terrain paint, the building **floor + foundation-border** block (sets `tile._buildingFloor`, ~lines 1168–1190), the decoration passes, and the final `transferToImageBitmap()` + return object.

Replace the deleted block with a one-line marker:

```js
  // Building walls + roofs are NOT baked here — they render as the GL building layer
  // (building-layer.js) so the spotlight can reveal the real terrain underneath. Floors stay baked
  // (above) for ground-plane + decoration suppression. See the see-through spec/plan (2026-06-20).
```

- [ ] **Step 2: (Optional) delete the dead per-tile wall block**

Still in `src/render/worker-chunk-renderer.js`, the per-tile wall block guarded by `if (false) { … }` (~lines 1192–1255, references undefined `wBmp`/`wallHit`) is already inert. Delete it for cleanliness, or leave it. If deleting, remove from the `// ── Building wall tile` comment through the closing `}` of the `if (false)` block. Do not touch the floor block above it.

- [ ] **Step 3: Default the layer ON**

In `src/render/canvas-renderer.js`, change the `_useLayer` gate from opt-in to default-on:

```js
    const _useLayer = glScene && !_inside && (typeof window === 'undefined' || window._buildingLayer !== false);
```

And in `src/render/field2-animator.js`, change every ghost-draw guard to default-off:

```js
        glc.drawPoolSprites(_pool.n, 1, w, h, cam);
        if (typeof window !== 'undefined' && window._buildingLayer === false) {
          glc.drawPoolSprites(_pool.n, 1, w, h, cam, true);
        }
```

- [ ] **Step 4: Verify parse + tests**

Run: `node --check src/render/worker-chunk-renderer.js && node --check src/render/canvas-renderer.js && npm test`
Expected: `--check` clean; `npm test` PASS.

- [ ] **Step 5: Browser verification (the real goal)**

Restart the no-cache server, open a fresh incognito tab (the chunk worker + bitmaps must reload):
```bash
npx --yes http-server . -p 8131 -c-1 --silent &
```
Walk the player ~8s so destination chunks re-bake. Expected:
- Buildings render once (no doubling) — they come only from the GL layer now.
- Walk **behind** a 1- and 2-storey building → a soft circular hole reveals the player standing on **real terrain** (grass/ground, not roof), building solid + present-lit outside the hole.
- Walk **in front of** (south of) a building → the player is fully visible; no spurious hole.
- Buildings **north of** the player still render.
- Two overlapping buildings (player behind the far one, in front of the near one) → correct stacking.
- Building **floors** still show under the player inside buildings; no grass growing through floors.
- `window._buildingLayer = false` → falls back to the (now building-less terrain + depth ghost) for A/B — note this fallback now shows no walls because the bake dropped them; that's expected (honest absence). The default-on path is the shippable one.

- [ ] **Step 6: Commit**

```bash
git add src/render/worker-chunk-renderer.js src/render/canvas-renderer.js src/render/field2-animator.js
git commit -m "feat(render): buildings leave the terrain bake; building layer default-on

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Cleanup obsolete depth/ghost code + final verification + memory

**Files:**
- Modify: `src/render/canvas-renderer.js`, `src/render/field2-animator.js`, `src/render/gl-compositor.js`
- Update: memory `project_building_occlusion_gl.md` + `MEMORY.md`

- [ ] **Step 1: Remove the now-dead depth-occlusion path**

Now that the layer is the default and proven, delete the shipped-but-superseded outdoor depth pass and ghost:
- In `src/render/canvas-renderer.js`: remove the `// BUILDING DEPTH PASS (shipped occlusion — only when the new layer is OFF)` block and its `_depthActive`/`clearSpriteDepth` usage, and the `window._depthOcclusion === false` heuristic-occluder branch. Keep the `_useLayer` path. Remove the now-unused imports (`nearDepthBuildings`, `renderBuildingSilhouette`, `tileDepth`, `DEPTH_SCALE`, `buildOccluderBitmap`) if nothing else references them (grep first).
- In `src/render/field2-animator.js`: delete the ghost `drawPoolSprites(..., true)` call(s) and their guards entirely (keep the normal player draw).
- In `src/render/gl-compositor.js`: `writeBuildingDepth`, `setSpriteDepth`, `clearSpriteDepth`, and the sprite `uSeeThrough`/`uDepthOn` plumbing are now unused outdoors. Leave them in place ONLY if the interior path still calls them (grep `setSpriteDepth`, `writeBuildingDepth`, `drawPoolSprites(.*true`); if no callers remain, remove them and the `_spriteDepth`/see-through shader branches. The scene-FBO depth renderbuffer (`sceneDepthRb`) may stay — it is inert and cheap.

- [ ] **Step 2: Verify no dangling references**

Run:
```bash
node --check src/render/canvas-renderer.js && node --check src/render/field2-animator.js && node --check src/render/gl-compositor.js && npm test
```
Plus grep to confirm removed symbols have no remaining callers:
```bash
git grep -n "writeBuildingDepth\|setSpriteDepth\|clearSpriteDepth\|drawPoolSprites(.*true)" src/render || echo "clean"
```
Expected: `--check` clean; `npm test` PASS; grep shows only definitions you intentionally kept (or "clean").

- [ ] **Step 3: Browser verification of the must-verify list**

With the no-cache server + fresh tab:
- **Shadows:** building ground-shadows still render (they are a separate main-thread pass, `building-shadow.js`, not part of the worker wall bake) and appear correctly relative to the layer buildings. Confirm they did not vanish.
- **Spotlight orientation:** the hole is centred on the player, not vertically mirrored (the `gl_FragCoord.y` flip). Pixel-sample the hole centre at the player's screen Y.
- **Floors + decoration suppression:** stand inside a building — floor tiles present, no soil/ground-cover/F3 growing through them.
- **Day/night + CRT:** the layer buildings tint with day-night and carry the CRT/lighting (they go through `presentScene`), matching the terrain.

- [ ] **Step 4: Update memory**

Update `project_building_occlusion_gl.md` to record that the outdoor occlusion is now the **Y-split building layer + GPU spotlight** (buildings out of the terrain bake; real terrain revealed), superseding the depth-ghost; note `window._buildingLayer` (default-on) and the spotlight tunables. Update the `MEMORY.md` one-line pointer hook to match.

- [ ] **Step 5: Commit**

```bash
git add src/render/canvas-renderer.js src/render/field2-animator.js src/render/gl-compositor.js
git commit -m "refactor(render): remove superseded depth-occlusion ghost path

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Two-layer (terrain-only + buildings) → Task 5 (worker subtractive) + Tasks 1–4 (building layer). ✓ (refined: buildings authored at render time, not a 2nd worker bitmap — spec's recommended cheaper path.)
- Buildings render all visible (no vanishing behind player) → Y-split (Task 1) replaces the rejected single-quad. ✓
- GPU spotlight fragment shader → Task 3 `SPOTLIGHT_FRAG_SRC`. ✓
- Reveal real terrain → Task 5 removes walls/roofs from bake. ✓
- Building-vs-building south sort → Task 1 `splitBuildingsByPlayer` sorts each set. ✓
- Composited in scene FBO before present (GL/GPU, lighting/CRT) → Task 3 binds `sceneFbo`, blits before `presentScene`. ✓
- Floors stay baked + decoration suppression → Task 5 Step 1 keeps the floor block; Task 6 verifies. ✓
- Remove the see-through ghost → Tasks 4 (gate) + 6 (delete). ✓
- Shadows / orientation / floors verification → Task 6 Step 3. ✓
- `window._buildingLayer` gate → Tasks 4 (off) + 5 (on). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. Worker deletion (Task 5) and ghost-site edits (Task 4 Step 4) reference exact anchors/line ranges rather than re-pasting hundreds of lines — acceptable because the executor edits in place against the named anchors.

**Type consistency:** `splitBuildingsByPlayer(buildings, playerY) → {behind, front}` defined in Task 1, used in Task 2's `buildBuildingLayerBitmaps`. `buildBuildingLayerBitmaps(buildings, camX, camY, tilePx, w, h, playerY) → {behind, front}` (canvases/null) defined in Task 2, used in Task 4. `drawBuildingSpotlightOverlay(bitmap, playerPx, spotInner, spotOuter)` defined in Task 3, called in Task 4 Step 3 with `{x,y}` + two px radii. `drawSceneOverlayBitmap(bitmap)` is the existing method (reused for the behind blit). All names consistent.

**Note on the depth variant:** the spec describes the per-building depth-buffer mechanism; this plan implements the simpler approved Y-split (identical visual). A one-line decision note is added to the spec pointing here.
