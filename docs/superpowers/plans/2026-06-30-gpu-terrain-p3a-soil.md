# GPU Terrain P3a — Index Widening + F0 Soil Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render F0 soil on the GPU as a procedural fragment-shader pass (replacing the per-pixel CPU soil baked into the 16.8 MB chunk bitmap), after first widening the per-chunk index texel from RGBA8 to RGBA16UI.

**Architecture:** The per-chunk index map becomes an RGBA16UI integer texture (R=base slot, G=cliff slot, B=soil id, A=reserved). The tilemap fragment shader gains a soil pass: per terrain pixel it reads the tile's soil id, looks up per-biome soil params (density/alpha/tint) in a small config texture, hash-gates by density, samples a per-biome soil swatch from a soil-swatch atlas at hash-jittered UVs, and alpha-blends over the base+cliff colour. Everything stays flag-gated behind `window._gpuTerrain` alongside the still-live bitmap path.

**Tech Stack:** WebGL2 / GLSL ES 3.00 (`usampler2D`, RGBA16UI, RGBA32F NEAREST lookup textures — same pattern as the existing RG32F slot-UV table), Web Worker chunk pipeline, plain `.mjs` + `node:assert` unit tests run via `node tests/<file>`.

**Branch:** `building-facade-blocks` (continue here; the `gpu-terrain` worktree is stale post-merge). Commit by EXPLICIT file name — the repo is shared by parallel sessions with uncommitted asset work; never `git add -A`.

**Reference spec:** `docs/superpowers/specs/2026-06-30-gpu-terrain-detail-fields-design.md` (§4 index widening, §5 soil).

**Worker cache-bust:** any task that edits a file in the worker module graph (`worker-chunk-renderer.js`, `worker-tile-painter.js`, `chunk-worker.js`, `wang-image-list.js`, `gpu-terrain-index.js`) MUST bump `workerUrl.searchParams.set('v', …)` in `src/world/chunk-provider.js` (~line 152) or the browser serves a stale worker. Current value: `20260619f-roof-overhang-nodroop-gputiles3-cliff`.

---

## Important pre-reading for the implementer

- **Texel codec** `src/render/gpu-terrain-index.js` — currently bit-packs base(12b)/cliff(12b)/soil(4b) into RGBA8. This plan replaces it with a flat 16-bit-per-channel layout.
- **Index emitter** `src/render/worker-chunk-renderer.js` `buildChunkIndex` (~line 1440) — writes a `Uint8Array`; becomes `Uint16Array`.
- **Worker resolver** `src/world/chunk-worker.js` `buildIndexBuffer` (~line 280) — `soilResolver` is stubbed `function(){return 0}`; becomes real.
- **GL upload + shader** `src/render/gl-compositor.js` — `uploadChunkIndex` (~2134) uploads the index texture; `TILEMAP_FRAG_SRC` (~103) decodes it; `drawChunkTilemap` (~2161) binds textures + sets uniforms; `setWangAtlas` (~2075) is the precedent for a lookup-table texture.
- **Atlas loader** `src/render/canvas-renderer.js` `_ensureWangAtlas` / `_growAtlas` / `_publishAtlas` (~243) — the precedent for fetching art into a GL atlas and publishing to the compositor; `drawChunkTilemap` is called at ~line 367 (`this.glc.drawChunkTilemap(key, sx, sy, chunkPx, chunkPx)`).
- **Soil data** `src/render/worker-chunk-renderer.js` `SOIL_BIOME_CONFIG` (~79) + `src/render/wang-image-list.js` `SOIL_MATERIALS` (~149), `soilMaterialForBiome` (~209), `SOIL_BASE_PATH` (`/assets/pixelab/landscape_v2/micro/soil/`), variant filename `soil__<material>__vNNN.png` (3-digit, NNN=000 representative swatch).
- **Run a test:** `node tests/gpu-terrain-index.test.mjs` (prints `PASS …` on success; throws on failure). These files live in `tests/`, NOT `sim/test/`, so `npm test` does not run them — run directly.

---

## File Structure

- **`src/render/gpu-terrain-index.js`** (modify) — RGBA16UI codec: `encodeTexel(baseSlot, cliffSlot, soilId)` → `[base, cliff, soil, 0]` (Uint16 values); `decodeTexel([base,cliff,soil,_])`.
- **`tests/gpu-terrain-index.test.mjs`** (modify) — round-trip over the widened ranges.
- **`src/render/worker-chunk-renderer.js`** (modify) — `buildChunkIndex` emits `Uint16Array`; writes base/cliff/soil as full 16-bit values.
- **`tests/build-chunk-index.test.mjs`** (modify) — expects `Uint16Array`, full-value base slot.
- **`src/render/wang-image-list.js`** (modify) — `SOIL_IDS` (biome→1..N, 0=none), `soilIdForBiome(biome)`, `SOIL_BIOME_LIST` (ordered biome array so ids are stable).
- **`tests/soil-ids.test.mjs`** (create) — id stability + distinctness.
- **`src/world/chunk-worker.js`** (modify) — `buildIndexBuffer` wires `soilResolver: soilIdForBiome`.
- **`src/render/gl-compositor.js`** (modify) — `uploadChunkIndex` RGBA16UI; `TILEMAP_FRAG_SRC` `usampler2D` decode + soil pass; `setSoilAtlas`; `drawChunkTilemap` extra params + uniforms.
- **`src/render/canvas-renderer.js`** (modify) — `_ensureSoilAtlas(provider)` loader; pass `cx,cy` to `drawChunkTilemap`.
- **`src/world/chunk-provider.js`** (modify) — bump worker `?v=`.

---

## Task 1: Widen the index texel codec to RGBA16UI

**Files:**
- Modify: `src/render/gpu-terrain-index.js`
- Test: `tests/gpu-terrain-index.test.mjs`

- [ ] **Step 1: Update the test for the widened layout**

Replace the body of `tests/gpu-terrain-index.test.mjs` with:

```js
import assert from 'node:assert';
import { encodeTexel, decodeTexel } from '../src/render/gpu-terrain-index.js';

// Widened texel: 16 bits per channel. R=baseSlot, G=cliffSlot, B=soilId, A=reserved(0).
// Slots 0..65535; soilId 0..65535 (only ~21 biomes used, but full range round-trips).
const cases = [
  { baseSlot: 0, cliffSlot: 0, soilId: 0 },
  { baseSlot: 65535, cliffSlot: 65535, soilId: 65535 },
  { baseSlot: 1234, cliffSlot: 77, soilId: 9 },
  { baseSlot: 5000, cliffSlot: 0, soilId: 21 }, // > old 12-bit ceiling (4095)
];
for (const c of cases) {
  const t = encodeTexel(c.baseSlot, c.cliffSlot, c.soilId);
  assert.strictEqual(t.length, 4, 'texel is RGBA');
  assert.strictEqual(t[3], 0, 'A reserved = 0');
  const d = decodeTexel(t);
  assert.strictEqual(d.baseSlot, c.baseSlot, `base ${JSON.stringify(c)}`);
  assert.strictEqual(d.cliffSlot, c.cliffSlot, `cliff ${JSON.stringify(c)}`);
  assert.strictEqual(d.soilId, c.soilId, `soil ${JSON.stringify(c)}`);
}
console.log('PASS gpu-terrain-index');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/gpu-terrain-index.test.mjs`
Expected: FAIL — current `decodeTexel` returns `{baseSlot, transitionSlot, soilId}` (no `cliffSlot`) and truncates 5000 → 904 etc.

- [ ] **Step 3: Rewrite the codec**

Replace the entire contents of `src/render/gpu-terrain-index.js` with:

```js
// src/render/gpu-terrain-index.js
// Pure (no GL, no worker globals) encode/decode of one terrain index texel.
// RGBA16UI layout — one unsigned 16-bit integer per channel:
//   R = base wang atlas slot   (0..65535; 0 = empty cell)
//   G = cliff wang atlas slot  (0..65535; 0 = no cliff overlay)
//   B = soil id                (0..65535; 0 = no soil; see wang-image-list SOIL_IDS)
//   A = reserved               (0)
// Returns/accepts a 4-element array of 16-bit values (caller packs into a Uint16Array).
export function encodeTexel(baseSlot, cliffSlot, soilId) {
  return [baseSlot & 0xffff, cliffSlot & 0xffff, soilId & 0xffff, 0];
}
export function decodeTexel(texel) {
  return { baseSlot: texel[0], cliffSlot: texel[1], soilId: texel[2] };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/gpu-terrain-index.test.mjs`
Expected: `PASS gpu-terrain-index`

- [ ] **Step 5: Commit**

```bash
git add src/render/gpu-terrain-index.js tests/gpu-terrain-index.test.mjs
git commit -m "feat(gpu-terrain): widen index texel to RGBA16UI (base/cliff/soil 16b each)"
```

---

## Task 2: buildChunkIndex emits a Uint16Array

**Files:**
- Modify: `src/render/worker-chunk-renderer.js` (`buildChunkIndex`, ~1440–1474)
- Test: `tests/build-chunk-index.test.mjs`

- [ ] **Step 1: Update the test**

Replace the body of `tests/build-chunk-index.test.mjs` with:

```js
import assert from 'node:assert';
import { buildChunkIndex } from '../src/render/worker-chunk-renderer.js';
// Flat grassland interior: getWangSrc → BIOME_INTERIOR url for grassland; slotResolver → 1234 (> 255,
// proving we now store the FULL 16-bit slot, not just a low byte). soilResolver → 21.
const chunk = { cx: 0, cy: 0, tiles: Array.from({ length: 4 }, () => ({ biome: 'grassland' })) };
let seenUrl = null;
const slotResolver = (src) => { seenUrl = src; return 1234; };
const buf = buildChunkIndex(chunk, { size: 2, slotResolver, soilResolver: () => 21 });
assert.ok(buf instanceof Uint16Array, 'returns Uint16Array');
assert.strictEqual(buf.length, 2 * 2 * 4, 'RGBA per tile');
assert.strictEqual(buf[0], 1234, 'R = full 16-bit base slot');
assert.strictEqual(buf[2], 21, 'B = soil id');
assert.strictEqual(buf[3], 0, 'A reserved = 0');
assert.ok(typeof seenUrl === 'string' && seenUrl.includes('__wang_'), 'resolver got a wang URL: ' + seenUrl);
console.log('PASS build-chunk-index');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/build-chunk-index.test.mjs`
Expected: FAIL — current code returns a `Uint8Array` and `buf[0]` is `1234 & 0xff` = 210.

- [ ] **Step 3: Change the emitter to Uint16Array**

In `src/render/worker-chunk-renderer.js` `buildChunkIndex`, change the buffer allocation:

```js
  var buf = new Uint16Array(size * size * 4);
```

and the per-tile write (the `encodeTexel(...)` block) so the four returned 16-bit values land directly:

```js
      var src = getWangSrc(tile, variant);
      var baseSlot = src ? (slotResolver(src) | 0) : 0;
      var cliffSrc  = getCliffSrc(tile);
      var cliffSlot = (cliffSrc && cliffResolver) ? (cliffResolver(cliffSrc) | 0) : 0;
      var soilId   = opts.soilResolver ? (opts.soilResolver(tile.biome) | 0) : 0;
      var texel    = encodeTexel(baseSlot, cliffSlot, soilId);
      buf[off]     = texel[0];
      buf[off + 1] = texel[1];
      buf[off + 2] = texel[2];
      buf[off + 3] = texel[3];
```

(The `off = (ty*size+tx)*4` indexing is unchanged — it now indexes Uint16 elements, not bytes.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/build-chunk-index.test.mjs`
Expected: `PASS build-chunk-index`

- [ ] **Step 5: Commit**

```bash
git add src/render/worker-chunk-renderer.js tests/build-chunk-index.test.mjs
git commit -m "feat(gpu-terrain): buildChunkIndex emits Uint16Array (RGBA16UI texels)"
```

---

## Task 3: Upload as RGBA16UI + decode with usampler2D in the shader

**Files:**
- Modify: `src/render/gl-compositor.js` (`uploadChunkIndex` ~2134; `TILEMAP_FRAG_SRC` ~103)

No unit test (GL/GLSL) — verify by `node --check` + the screenshot gate at Task 8. This task keeps soil OFF (still just base+cliff), only changing the index texture format + its decode, so terrain must look IDENTICAL to before after this task.

- [ ] **Step 1: Upload the index as an integer texture**

In `uploadChunkIndex`, the texture is currently `RGBA8` / `UNSIGNED_BYTE` with a `Uint8Array`. Change BOTH the allocation and the sub-upload to RGBA16UI. Replace the texture-creation block and the `texSubImage2D` call:

```js
  uploadChunkIndex(key, buf) {
    if (!this.ok) return;
    var gl = this.gl;
    if (!this._chunkIndexTex) this._chunkIndexTex = new Map();
    var tex = this._chunkIndexTex.get(key);
    if (!tex) {
      tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16UI, 64, 64, 0, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this._chunkIndexTex.set(key, tex);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, tex);
    }
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 64, 64, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, buf);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
```

(Integer textures REQUIRE NEAREST filtering — linear is an error. `buf` is the `Uint16Array` from Task 2; pass it through unchanged — the draw loop wraps the provider's index as `new Uint8Array(msg.index)` in chunk-provider.js, see Step 3.)

- [ ] **Step 2: Switch the shader's index sampler to usampler2D and decode the new layout**

In `TILEMAP_FRAG_SRC`, change the index sampler declaration:

```glsl
uniform highp usampler2D uIndex;    // 64x64 RGBA16UI index map
```

and replace the texel decode (the `texelFetch(uIndex,...)` + `int R/G/B` + `baseSlot`/`cliffSlot` lines) with:

```glsl
  uvec4 ti = texelFetch(uIndex, cell, 0);   // RGBA16UI: r=baseSlot g=cliffSlot b=soilId
  int baseSlot = int(ti.r);
  int cliffSlot = int(ti.g);
  int soilId = int(ti.b);
  if (baseSlot == 0) { outColor = vec4(0.0); return; }   // empty cell
```

Keep the rest of `main()` (the base sample, the cliff composite that uses `cliffSlot`, `outColor = col`) exactly as-is. `soilId` is read but unused until Task 7.

- [ ] **Step 3: Make the provider preserve the Uint16Array**

In `src/world/chunk-provider.js`, the two lines that store the worker's index currently wrap it in a `Uint8Array`:

```js
            if (msg.index) this.indexes.set(bitmapKey, new Uint8Array(msg.index));
```

Change BOTH occurrences (~line 193 and ~221) to keep 16-bit elements:

```js
            if (msg.index) this.indexes.set(bitmapKey, new Uint16Array(msg.index));
```

(`msg.index` is the transferred `ArrayBuffer` of the worker's `Uint16Array`; wrapping it as `Uint16Array` restores the correct element view that `uploadChunkIndex` hands to `texSubImage2D`.)

- [ ] **Step 4: Syntax-check + bump the worker cache-bust**

In `src/world/chunk-provider.js` (~line 152) bump:

```js
      workerUrl.searchParams.set('v', '20260619f-roof-overhang-nodroop-gputiles4-rgba16ui');
```

Run: `node --check src/render/gl-compositor.js && node --check src/world/chunk-provider.js`
Expected: no output (both OK).

- [ ] **Step 5: Commit**

```bash
git add src/render/gl-compositor.js src/world/chunk-provider.js
git commit -m "feat(gpu-terrain): index map as RGBA16UI integer texture + usampler2D decode"
```

---

## Task 4: Soil id table + real soilResolver

**Files:**
- Modify: `src/render/wang-image-list.js` (near `SOIL_MATERIALS` ~149 and `soilMaterialForBiome` ~209)
- Modify: `src/world/chunk-worker.js` (`buildIndexBuffer` ~280)
- Test: `tests/soil-ids.test.mjs` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/soil-ids.test.mjs`:

```js
import assert from 'node:assert';
import { soilIdForBiome, SOIL_IDS } from '../src/render/wang-image-list.js';

// 0 reserved = "no soil". Every known biome gets a stable, distinct, nonzero id.
assert.strictEqual(soilIdForBiome('nonexistent_biome'), 0, 'unknown biome → 0 (no soil)');
assert.ok(soilIdForBiome('grassland') > 0, 'grassland has soil');
assert.ok(soilIdForBiome('desert') > 0, 'desert has soil');
assert.notStrictEqual(soilIdForBiome('grassland'), soilIdForBiome('desert'), 'distinct biomes → distinct ids');
// Ids are 1-based and contiguous-ish, all within 16-bit range.
for (const b of Object.keys(SOIL_IDS)) {
  const id = SOIL_IDS[b];
  assert.ok(id >= 1 && id <= 0xffff, `${b} id in range: ${id}`);
}
console.log('PASS soil-ids');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/soil-ids.test.mjs`
Expected: FAIL — `soilIdForBiome` / `SOIL_IDS` not exported.

- [ ] **Step 3: Add the id table**

In `src/render/wang-image-list.js`, immediately AFTER the `SOIL_MATERIALS` object (ends ~line 172) and BEFORE `getSoilImageURLs`, add:

```js
// Stable per-biome soil id (1-based; 0 = no soil). The GPU soil pass uses this id
// to index the soil-swatch atlas + per-biome config texture (see gl-compositor
// setSoilAtlas). Order is fixed so ids never shift between sessions. Biomes that
// share a soil MATERIAL still get distinct ids (same swatch, own config).
var SOIL_IDS = {};
(function () {
  var i = 1;
  for (var biome in SOIL_MATERIALS) { SOIL_IDS[biome] = i++; }
})();
export { SOIL_IDS };
export function soilIdForBiome(biome) {
  return SOIL_IDS[biome] || 0;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/soil-ids.test.mjs`
Expected: `PASS soil-ids`

- [ ] **Step 5: Wire the real soilResolver in the worker**

In `src/world/chunk-worker.js`, add `soilIdForBiome` to the existing `wang-image-list.js` import (find the line importing from `'../render/wang-image-list.js'` and add `soilIdForBiome`). Then in `buildIndexBuffer` replace the stub:

```js
      soilResolver: function(biome) { return soilIdForBiome(biome); },
```

(Replaces `soilResolver: function() { return 0; }`.)

- [ ] **Step 6: Bump worker cache-bust + commit**

In `src/world/chunk-provider.js` bump `?v=` to `…-gputiles5-soilid`. Then:

```bash
git add src/render/wang-image-list.js src/world/chunk-worker.js src/world/chunk-provider.js tests/soil-ids.test.mjs
git commit -m "feat(gpu-terrain): per-biome soil ids + real soilResolver in the index"
```

---

## Task 5: Soil-swatch atlas + per-biome config texture

**Files:**
- Modify: `src/render/gl-compositor.js` (add `setSoilAtlas`)
- Modify: `src/render/canvas-renderer.js` (add `_ensureSoilAtlas`, import data)

This task BUILDS + UPLOADS the soil lookup textures but does not yet sample them (the shader pass is Task 7). No visual change.

- [ ] **Step 1: Add `setSoilAtlas` to the compositor**

In `src/render/gl-compositor.js`, after `setWangAtlas` (~line 2106), add:

```js
  // Soil lookup textures for the GPU F0 pass.
  //   swatchTex  : RGBA8, width = count*32, height = 32. Cell i (origin x=i*32) is
  //                biome soil-id i's 32x32 representative soil swatch.
  //   configTex  : RGBA32F, width = count, height = 2. Row 0 texel[i] =
  //                (density, alpha, tintStrength, hasTint); row 1 texel[i] = (tintR,tintG,tintB,0)
  //                with tint components in 0..1. Index by soil id i.
  //   count      : number of soil ids + 1 (id 0 reserved/empty).
  setSoilAtlas(swatchTex, configTex, count) {
    this._soilSwatchTex = swatchTex;
    this._soilConfigTex = configTex;
    this._soilCount = count | 0;
    this._soilCellW = 32; // px per swatch cell
  }
```

- [ ] **Step 2a: Relocate `SOIL_BIOME_CONFIG` into the shared data module**

The per-biome soil params live in `worker-chunk-renderer.js` (a worker-only module that the MAIN thread must not import — it pulls the whole chunk renderer + a dynamic roof import into the main bundle). Move them to the shared no-DOM `wang-image-list.js` (where `SOIL_MATERIALS` already lives).

In `src/render/wang-image-list.js`, add (right after the `SOIL_IDS` block from Task 4):

```js
// Per-biome F0 soil rendering params — shared by the worker bitmap path
// (applySoilFieldToChunk) and the main-thread GPU soil-config texture loader.
// { density, alpha, blobMin, blobMax, tint:[r,g,b]|null, tintStrength }
export var SOIL_BIOME_CONFIG = {
  forest:{density:0.96,alpha:0.70,blobMin:4,blobMax:6,tint:null},
  dense_forest:{density:0.97,alpha:0.75,blobMin:4,blobMax:6,tint:null},
  tropical_forest:{density:0.96,alpha:0.70,blobMin:4,blobMax:6,tint:null},
  taiga:{density:0.95,alpha:0.65,blobMin:4,blobMax:6,tint:null},
  grassland:{density:0.94,alpha:0.60,blobMin:4,blobMax:6,tint:null},
  savanna:{density:0.93,alpha:0.55,blobMin:3,blobMax:5,tint:null},
  steppe:{density:0.92,alpha:0.55,blobMin:3,blobMax:5,tint:null},
  desert:{density:0.96,alpha:0.50,blobMin:3,blobMax:4,tint:null},
  beach:{density:0.98,alpha:0.50,blobMin:3,blobMax:4,tint:[245,235,200],tintStrength:0.45},
  swamp:{density:0.97,alpha:0.80,blobMin:5,blobMax:7,tint:null},
  hills:{density:0.94,alpha:0.60,blobMin:4,blobMax:7,tint:null},
  mountains:{density:0.92,alpha:0.55,blobMin:5,blobMax:8,tint:null},
  volcanic:{density:0.90,alpha:0.60,blobMin:4,blobMax:6,tint:null},
  tundra:{density:0.97,alpha:0.75,blobMin:4,blobMax:6,tint:null},
  arctic:{density:0.88,alpha:0.50,blobMin:3,blobMax:5,tint:null},
  mystic:{density:0.95,alpha:0.65,blobMin:4,blobMax:6,tint:null},
  ocean:{density:0.96,alpha:0.50,blobMin:4,blobMax:6,tint:null},
  deep_ocean:{density:0.95,alpha:0.45,blobMin:3,blobMax:5,tint:null},
  shallow_water:{density:0.98,alpha:0.50,blobMin:4,blobMax:6,tint:null},
  river:{density:0.96,alpha:0.50,blobMin:4,blobMax:6,tint:null},
  lake:{density:0.96,alpha:0.50,blobMin:4,blobMax:6,tint:null},
};
export var SOIL_DEFAULT_CONFIG = {density:0.94,alpha:0.65,blobMin:4,blobMax:6,tint:null};
```

Then in `src/render/worker-chunk-renderer.js`: DELETE the local `var SOIL_BIOME_CONFIG = {…}` (~79–103) and `var SOIL_DEFAULT_CONFIG = {…}` (~104), and add `SOIL_BIOME_CONFIG, SOIL_DEFAULT_CONFIG` to its existing `import { … } from './wang-image-list.js'` (~line 14). The worker bitmap path (`applySoilFieldToChunk`) now reads them from the import — behaviour unchanged.

- [ ] **Step 2b: Build + publish the soil textures from the renderer**

In `src/render/canvas-renderer.js`, add to the imports from `./wang-image-list.js` the symbols `SOIL_IDS`, `soilMaterialForBiome`, `SOIL_BIOME_CONFIG` (the file already imports `getWangImageURLsForBiomes` from it). Then add the loader method (next to `_ensureWangAtlas`):

```js
  // Build the soil-swatch atlas + per-biome config texture for the GPU F0 pass.
  // Loads ONE representative swatch (v000) per biome soil material — only ~21 fetches,
  // so it loads in one shot (no incremental growth needed). Idempotent.
  _ensureSoilAtlas(provider) {
    if (typeof window === 'undefined' || !window._gpuTerrain) return;
    if (this._soilState) return;
    const gl = this.glc && this.glc.gl;
    if (!gl) return;
    this._soilState = 'loading';

    const ids = SOIL_IDS;                 // biome → 1..N
    let maxId = 0;
    for (const b in ids) if (ids[b] > maxId) maxId = ids[b];
    const count = maxId + 1;              // include reserved id 0
    const cellW = 32;

    // Config texture (RGBA32F, count x 2) — fill synchronously from SOIL_BIOME_CONFIG.
    const cfgData = new Float32Array(count * 2 * 4);
    for (const b in ids) {
      const id = ids[b];
      const c = SOIL_BIOME_CONFIG[b] || {};
      const density = (c.density != null) ? c.density : 0.94;
      const alpha = (c.alpha != null) ? c.alpha : 0.65;
      const tint = c.tint || null;
      const tintStrength = c.tintStrength != null ? c.tintStrength : 0.3;
      // row 0
      cfgData[(0 * count + id) * 4 + 0] = density;
      cfgData[(0 * count + id) * 4 + 1] = alpha;
      cfgData[(0 * count + id) * 4 + 2] = tint ? tintStrength : 0.0;
      cfgData[(0 * count + id) * 4 + 3] = tint ? 1.0 : 0.0;
      // row 1
      cfgData[(1 * count + id) * 4 + 0] = tint ? tint[0] / 255 : 0;
      cfgData[(1 * count + id) * 4 + 1] = tint ? tint[1] / 255 : 0;
      cfgData[(1 * count + id) * 4 + 2] = tint ? tint[2] / 255 : 0;
      cfgData[(1 * count + id) * 4 + 3] = 0;
    }
    const configTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, configTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, count, 2, 0, gl.RGBA, gl.FLOAT, cfgData);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);

    // Swatch atlas (RGBA8, count*32 x 32) — allocate now, fill async per biome.
    const swatchTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, swatchTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, count * cellW, cellW, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);   // jittered sampling wraps within a cell
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.bindTexture(gl.TEXTURE_2D, null);

    this.glc.setSoilAtlas(swatchTex, configTex, count);
    this._soilState = 'ready';
    if (typeof window !== 'undefined') window._gpuSoilReady = true;

    // Fetch each biome's representative swatch (soil__<material>__v000.png) into cell[id].
    const SOIL_BASE = '/assets/pixelab/landscape_v2/micro/soil/';
    for (const b in ids) {
      const id = ids[b];
      const mat = soilMaterialForBiome(b);
      const url = SOIL_BASE + mat + '/soil__' + mat + '__v000.png';
      fetch(url)
        .then(r => r.ok ? r.blob() : null)
        .then(bl => bl ? createImageBitmap(bl) : null)
        .then(bmp => {
          if (!bmp) return;
          gl.bindTexture(gl.TEXTURE_2D, swatchTex);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, id * cellW, 0, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
          gl.bindTexture(gl.TEXTURE_2D, null);
        })
        .catch(() => {}); // missing soil PNG → that cell stays transparent (honest absence)
    }
  }
```

- [ ] **Step 3: Call the loader each frame next to the wang atlas**

In `src/render/canvas-renderer.js` `draw()`, right after the existing `this._ensureWangAtlas(provider);` (~line 307) add:

```js
    this._ensureSoilAtlas(provider);
```

- [ ] **Step 4: Syntax-check + bump worker cache-bust**

`worker-chunk-renderer.js` changed (config relocated), so in `src/world/chunk-provider.js` bump `?v=` to `…-gputiles6-soilcfg`.

Run: `node --check src/render/gl-compositor.js && node --check src/render/canvas-renderer.js && node --check src/render/worker-chunk-renderer.js && node --check src/render/wang-image-list.js`
Expected: no output (all OK). Also re-run `node tests/build-chunk-index.test.mjs` (it imports worker-chunk-renderer) — expect `PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/render/gl-compositor.js src/render/canvas-renderer.js src/render/worker-chunk-renderer.js src/render/wang-image-list.js src/world/chunk-provider.js
git commit -m "feat(gpu-terrain): build soil-swatch atlas + per-biome config texture"
```

---

## Task 6: Pass chunk origin + bind soil textures in drawChunkTilemap (soil still OFF)

**Files:**
- Modify: `src/render/gl-compositor.js` (`_buildTilemapProgram` ~2108, `drawChunkTilemap` ~2161)
- Modify: `src/render/canvas-renderer.js` (the `drawChunkTilemap` call ~367)

Wire all uniforms/textures the soil pass needs, with `uSoilOn = 0` so rendering is unchanged. This isolates the plumbing from the shader math.

- [ ] **Step 1: Look up the new uniform locations**

In `_buildTilemapProgram`, after the existing `this._tmUAtlasSize = …` line, add:

```js
    this._tmUChunkOrigin = gl.getUniformLocation(prog, 'uChunkOrigin');
    this._tmUSoilAtlas   = gl.getUniformLocation(prog, 'uSoilAtlas');
    this._tmUSoilConfig  = gl.getUniformLocation(prog, 'uSoilConfig');
    this._tmUSoilCount   = gl.getUniformLocation(prog, 'uSoilCount');
    this._tmUSoilOn      = gl.getUniformLocation(prog, 'uSoilOn');
```

- [ ] **Step 2: Add the uniforms to the shader (declarations only this task)**

In `TILEMAP_FRAG_SRC`, add below the existing uniform declarations:

```glsl
uniform vec2  uChunkOrigin;   // chunk's world-tile origin (cx*64, cy*64)
uniform sampler2D uSoilAtlas; // RGBA8 strip, cell i = soil id i (32px cells)
uniform sampler2D uSoilConfig;// RGBA32F count x 2 (row0 params, row1 tint)
uniform int   uSoilCount;     // number of soil ids (atlas/config width)
uniform float uSoilOn;        // 0 = soil pass disabled
```

- [ ] **Step 3: Bind textures + set uniforms in drawChunkTilemap**

Change the signature to accept `cx, cy`:

```js
  drawChunkTilemap(key, cx, cy, sx, sy, dw, dh) {
```

After the existing `gl.uniform1f(this._tmUAtlasSize, this._wangAtlasSize);` line, add:

```js
    gl.uniform2f(this._tmUChunkOrigin, cx * 64, cy * 64);
    var _soilOn = (this._soilSwatchTex && this._soilConfigTex) ? 1 : 0;
    if (this._tmUSoilOn) gl.uniform1f(this._tmUSoilOn, _soilOn);
    if (_soilOn) {
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, this._soilSwatchTex);
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, this._soilConfigTex);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(this._tmUSoilAtlas, 3);
      gl.uniform1i(this._tmUSoilConfig, 4);
      gl.uniform1i(this._tmUSoilCount, this._soilCount);
    }
```

**Override for this task only:** force `uSoilOn` to 0 so there is no visual change yet — temporarily set `var _soilOn = 0;` (a comment `// TEMP: soil pass lands in Task 7`), and revert it to the real expression in Task 7. (This keeps each task independently shippable + screenshot-stable.)

- [ ] **Step 4: Update the caller to pass cx,cy**

In `src/render/canvas-renderer.js` (~line 367) change:

```js
          this.glc.drawChunkTilemap(key, cx, cy, sx, sy, chunkPx, chunkPx);
```

(`cx` and `cy` are in scope from `const { cx, cy, chunk } = job;`.)

- [ ] **Step 5: Syntax-check + commit**

Run: `node --check src/render/gl-compositor.js && node --check src/render/canvas-renderer.js`
Expected: no output.

```bash
git add src/render/gl-compositor.js src/render/canvas-renderer.js
git commit -m "feat(gpu-terrain): plumb chunk origin + soil textures into drawChunkTilemap (soil off)"
```

---

## Task 7: The soil fragment-shader pass

**Files:**
- Modify: `src/render/gl-compositor.js` (`TILEMAP_FRAG_SRC` soil math; revert the Task-6 `_soilOn` override)

- [ ] **Step 1: Add the soil pass to the shader**

In `TILEMAP_FRAG_SRC`, the `main()` currently ends with the cliff composite then `outColor = col;`. Insert the soil pass BETWEEN the cliff composite and `outColor = col;`:

```glsl
  // ── F0 soil pass — procedural per-pixel, replacing applySoilFieldToChunk ──
  if (uSoilOn > 0.5 && soilId > 0 && soilId < uSoilCount) {
    // World pixel coords (32 px per tile): origin tiles → tile cell → frac → px.
    vec2 worldTile = uChunkOrigin + vec2(cell);
    vec2 wp = worldTile * 32.0 + frac * 32.0;
    // Per-pixel hash in [0,1). GPU hash (NOT the CPU float64 hash) — we replace the
    // bitmap, so an equivalent distribution is the bar, not pixel identity.
    float h = fract(sin(dot(floor(wp), vec2(127.1, 311.7))) * 43758.5453123);
    // Config row 0: (density, alpha, tintStrength, hasTint).
    vec4 cfg0 = texelFetch(uSoilConfig, ivec2(soilId, 0), 0);
    if (h <= cfg0.x) {
      // Jittered sample within this soil id's 32px swatch cell. Two more hashes
      // pick a wrapped offset → breaks the source sprite's diagonal patterns.
      float jx = fract(sin(dot(floor(wp), vec2(269.5, 183.3))) * 43758.5453123);
      float jy = fract(sin(dot(floor(wp), vec2(419.2, 371.9))) * 43758.5453123);
      float cellU = fract((frac.x + jx)) ;            // 0..1 within the cell
      float cellV = fract((frac.y + jy)) ;
      float u = (float(soilId) + cellU) / float(uSoilCount);
      vec4 soil = texture(uSoilAtlas, vec2(u, cellV));
      if (soil.a > 0.0) {
        vec4 cfg1 = texelFetch(uSoilConfig, ivec2(soilId, 1), 0); // tint rgb
        vec3 srgb = soil.rgb;
        if (cfg0.w > 0.5) srgb = mix(srgb, cfg1.rgb, cfg0.z);     // tint toward target
        float a = soil.a * cfg0.y;                                // alpha = swatch.a * cfg.alpha
        col.rgb = mix(col.rgb, srgb, a);
      }
    }
  }
  outColor = col;
```

Notes for the implementer:
- `soilId`, `cell`, `frac`, `col` are already in scope from earlier in `main()`.
- The swatch atlas uses `texture()` (not `texelFetch`) with REPEAT wrap so the jittered `cellU/cellV` sample stays inside the 32px cell horizontally via the `(soilId + cellU)/uSoilCount` mapping; vertical REPEAT wraps the single 32px row.
- This matches the CPU model: density gate (`h <= density`), swatch sample, optional tint at `tintStrength`, alpha = `swatch.a * cfg.alpha`. The CPU `transitionFade` (per-pixel boundary fade on transition tiles) is intentionally dropped for v1 (single-material soil per tile — see spec §5); revisit only if border seams are visible.

- [ ] **Step 2: Re-enable the soil pass in drawChunkTilemap**

In `drawChunkTilemap`, revert the Task-6 TEMP override back to the real expression:

```js
    var _soilOn = (this._soilSwatchTex && this._soilConfigTex) ? 1 : 0;
```

- [ ] **Step 3: Syntax-check**

Run: `node --check src/render/gl-compositor.js`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/render/gl-compositor.js
git commit -m "feat(gpu-terrain): F0 soil procedural fragment pass (density+swatch+tint+alpha)"
```

---

## Task 8: Browser parity gate + handoff

**Files:** none (verification only)

- [ ] **Step 1: Hard-refresh + enable**

In the running game (DevTools "Disable cache" ON, or incognito — the dev server caches JS 1h): hard-refresh, then console:
```js
window._gpuTerrain = true
```
Wait until `window._gpuTerrainReady === true` && `window._gpuSoilReady === true`. WALK a few tiles to repaint chunks with fresh indexes.

- [ ] **Step 2: A/B parity in grassland (single-biome gate)**

Stand in grassland. Toggle `window._gpuTerrain = false` ↔ `true` (walk a step after each toggle to force repaint). The soil grain — density, colour, subtlety — should read EQUIVALENT between the two (not pixel-identical; the GPU hash differs by design). Confirm `window._gpuTerrainStats.tilemap` keeps climbing (GPU path live) and there are no bare/flat patches where the bitmap showed soil.

- [ ] **Step 3: Multi-biome spot-check**

Walk/teleport into desert (tint test — desert has a sand tint), forest, swamp (high alpha), beach (tint). Soil should appear on the GPU path in each, roughly matching the bitmap. Note any biome that looks bare (missing swatch fetch / wrong id) for follow-up.

- [ ] **Step 4: Record the result**

If parity holds: update `docs/superpowers/plans/2026-06-30-gpu-tilemap-terrain-CONTINUATION.md` and memory `[[project_gpu_tilemap_terrain]]` — mark P3a done, note P3b (ground-cover luminance — same scaffolding) next. If parity fails, capture which biome + symptom and iterate on Task 7 (density threshold, jitter, tint) before proceeding.

---

## Self-Review (completed by plan author)

**Spec coverage** (against `2026-06-30-gpu-terrain-detail-fields-design.md`):
- §4 index widening RGBA8→RGBA16UI → Tasks 1–3. ✓
- §5 soil-swatch atlas → Task 5; config lookup → Task 5; soilId in texel → Tasks 1,2,4; shader pass (hash density + jittered sample + tint + alpha) → Task 7; real soilResolver → Task 4; uChunkOrigin → Task 6. ✓
- §5 transition simplification (single-material per tile) → Task 7 note. ✓
- §9 honest absence (missing soil PNG → no soil, no stand-in) → Task 5 `.catch(()=>{})` leaves the cell transparent → shader `soil.a > 0.0` guard skips it. ✓
- §10 parity gate → Task 8. ✓
- Out of scope for P3a (correctly deferred to P3b/P3c): ground-cover, F3 scatter, atlas growth to 4096². ✓

**Placeholder scan:** no TBD/TODO; every code step shows real code; the one TEMP override (Task 6) is explicitly reverted in Task 7. ✓

**Type/name consistency:** `encodeTexel(baseSlot, cliffSlot, soilId)` (Tasks 1,2) · `Uint16Array` (Tasks 2,3) · `usampler2D uIndex` (Task 3) · `soilIdForBiome`/`SOIL_IDS` (Task 4) · `setSoilAtlas(swatchTex, configTex, count)` + `_soilSwatchTex`/`_soilConfigTex`/`_soilCount` (Tasks 5,6,7) · `_ensureSoilAtlas`/`window._gpuSoilReady` (Tasks 5,8) · uniforms `uChunkOrigin`/`uSoilAtlas`/`uSoilConfig`/`uSoilCount`/`uSoilOn` (Tasks 6,7) · `drawChunkTilemap(key, cx, cy, …)` (Tasks 6 + caller). Consistent. ✓
