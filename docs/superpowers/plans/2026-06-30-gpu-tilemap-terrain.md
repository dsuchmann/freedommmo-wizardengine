# GPU Tilemap Terrain Rendering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the terrain *base* on the GPU from a shared Wang-tile atlas + a tiny per-chunk index map, replacing the per-chunk 16.8 MB CPU bitmap (the ~131 ms upload / 2-per-frame throttle that causes run-pop-in and stutter).

**Architecture:** A worker emits a 64×64 per-tile index buffer (atlas slot + transition + soil ids) instead of rasterizing a 2048² bitmap. The main thread uploads that ~16 KB buffer to a per-chunk index texture and draws the chunk quad with a fragment shader that samples a shared Wang-tile atlas per pixel, writing into the scene FBO so the present pass lights it identically. Flag-gated `window._gpuTerrain`, running alongside the existing bitmap path for A/B + instant fallback.

**Tech Stack:** WebGL2 (GLSL ES 3.00), Web Workers, OffscreenCanvas (atlas build only), plain JS. Spec: `docs/superpowers/specs/2026-06-30-gpu-tilemap-terrain-design.md`.

**Testing reality:** GL *visual* output is verified by A/B screenshot parity (GPU tilemap vs the current bitmap path) using the existing Playwright probes, not unit tests. The *pure* logic — atlas slot mapping and index-buffer encoding/decoding — is unit-tested with node (`node --check` + small assertion scripts run via `node`). Each phase ends with a verifiable parity artifact.

**Conventions (from this codebase):**
- Commit by explicit file name (shared git index across parallel sessions); never `git add -A`.
- Commit messages end with the Co-Authored-By trailer used elsewhere in this repo.
- Workers are browser-cached; the worker URL already carries a `?v=` cache-bust query (`chunk-provider.js` createWorker) — bump it when changing worker code.
- New flags default OFF and read `window._gpuTerrain === true` (opt-in for the whole build-out; flipped to default-on only in Phase 4).

---

## File Structure

**Create:**
- `src/render/wang-atlas.js` — builds + owns the GL atlas of Wang base tiles per biome; pure slot-mapping (`wangSlotKey`) is exported separately for unit testing.
- `src/render/gpu-terrain-index.js` — pure encode/decode of the per-tile index texel (no GL, no worker globals) so both the worker (encode) and tests can use it.
- `tests/gpu-terrain-index.test.mjs` — node assertions for encode/decode round-trips and slot mapping.

**Modify:**
- `src/render/worker-chunk-renderer.js` — add `buildChunkIndex(chunk, neighborCache)` returning a `Uint8Array` (gated; bitmap path untouched).
- `src/world/chunk-worker.js` — when `_gpuTerrain`, attach `index` (transferable) to the `chunkPainted`/`chunkRepainted` messages; bump worker `?v=`.
- `src/world/chunk-provider.js` — store `index` buffers (`this.indexes` Map) next to bitmaps; expose `getChunkIndex(cx,cy)`; flag passthrough to workers.
- `src/world/chunk.js` — no change expected (it carries chunks, not pixels) — verify.
- `src/render/gl-compositor.js` — add the tilemap program, `setWangAtlas(tex, meta)`, `uploadChunkIndex(key, buf)`, `drawChunkTilemap(key, sx, sy, dw, dh)`.
- `src/render/canvas-renderer.js:323` — when `window._gpuTerrain` and the atlas+index are ready, call `drawChunkTilemap` instead of `drawChunk`.

---

## Phase 1 — Atlas + single-biome base (grassland), screenshot parity

Goal of phase: with `window._gpuTerrain = true`, a flat grassland area renders its Wang base via the GPU tilemap shader, pixel-comparable to the bitmap path; chunk index uploads are < 32 KB; the bitmap path still works with the flag off. No transitions, no soil yet (those areas may differ — test on a flat single-biome spot).

### Task 1: Pure index-texel encode/decode

**Files:**
- Create: `src/render/gpu-terrain-index.js`
- Test: `tests/gpu-terrain-index.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/gpu-terrain-index.test.mjs
import assert from 'node:assert';
import { encodeTexel, decodeTexel } from '../src/render/gpu-terrain-index.js';

// A texel packs: baseSlot (0..4095), transitionSlot (0..4095, 0=none), soilId (0..15) into RGBA8.
const cases = [
  { baseSlot: 0, transitionSlot: 0, soilId: 0 },
  { baseSlot: 4095, transitionSlot: 4095, soilId: 15 },
  { baseSlot: 1234, transitionSlot: 77, soilId: 9 },
];
for (const c of cases) {
  const rgba = encodeTexel(c.baseSlot, c.transitionSlot, c.soilId);
  assert.strictEqual(rgba.length, 4, 'texel is RGBA');
  const d = decodeTexel(rgba);
  assert.deepStrictEqual(d, c, `round-trip ${JSON.stringify(c)}`);
}
console.log('PASS gpu-terrain-index');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/gpu-terrain-index.test.mjs`
Expected: FAIL — `Cannot find module '../src/render/gpu-terrain-index.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/render/gpu-terrain-index.js
// Pure (no GL, no worker globals) encode/decode of one terrain index texel. RGBA8 layout:
//   R = baseSlot low 8 bits
//   G = (baseSlot high 4 bits) | (transitionSlot high 4 bits << 4)   -- 4 bits each
//   B = transitionSlot low 8 bits
//   A = soilId (0..15) in low 4 bits  (high nibble reserved)
// baseSlot/transitionSlot are 0..4095 (12-bit atlas slot indices); transitionSlot 0 = no transition.
export function encodeTexel(baseSlot, transitionSlot, soilId) {
  const r = baseSlot & 0xff;
  const g = ((baseSlot >> 8) & 0x0f) | (((transitionSlot >> 8) & 0x0f) << 4);
  const b = transitionSlot & 0xff;
  const a = soilId & 0x0f;
  return [r, g, b, a];
}
export function decodeTexel(rgba) {
  const baseSlot = rgba[0] | ((rgba[1] & 0x0f) << 8);
  const transitionSlot = rgba[2] | (((rgba[1] >> 4) & 0x0f) << 8);
  const soilId = rgba[3] & 0x0f;
  return { baseSlot, transitionSlot, soilId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/gpu-terrain-index.test.mjs`
Expected: `PASS gpu-terrain-index`.

- [ ] **Step 5: Commit**

```bash
git add src/render/gpu-terrain-index.js tests/gpu-terrain-index.test.mjs
git commit -m "feat(gpu-terrain): pure index-texel encode/decode + test"
```

### Task 2: Wang atlas slot mapping (pure)

**Files:**
- Create: `src/render/wang-atlas.js` (pure `wangSlotKey` + `WangAtlas` class skeleton; GL upload added in Task 3)
- Test: `tests/wang-atlas-slot.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/wang-atlas-slot.test.mjs
import assert from 'node:assert';
import { wangSlotKey } from '../src/render/wang-atlas.js';
// A slot key uniquely identifies one 32x32 tile: biome-asset, wang level, corner mask 0..63.
const a = wangSlotKey('grassland', 'wang', 0);
const b = wangSlotKey('grassland', 'wang', 0);
const c = wangSlotKey('grassland', 'wang_50', 0);
const d = wangSlotKey('grassland', 'wang', 63);
assert.strictEqual(a, b, 'deterministic');
assert.notStrictEqual(a, c, 'level matters');
assert.notStrictEqual(a, d, 'mask matters');
console.log('PASS wang-atlas-slot');
```

- [ ] **Step 2: Run to verify fail**

Run: `node tests/wang-atlas-slot.test.mjs`
Expected: FAIL — module/function missing.

- [ ] **Step 3: Minimal implementation**

```js
// src/render/wang-atlas.js
// Owns the GL atlas of 32x32 Wang base tiles, keyed (biome-asset, wang level, cornerMask). Pure slot key
// below is unit-tested; the GL build/upload (Task 3) attaches to the WangAtlas class.
export function wangSlotKey(biomeAsset, level, cornerMask) {
  return biomeAsset + '|' + level + '|' + (cornerMask & 63);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node tests/wang-atlas-slot.test.mjs`
Expected: `PASS wang-atlas-slot`.

- [ ] **Step 5: Commit**

```bash
git add src/render/wang-atlas.js tests/wang-atlas-slot.test.mjs
git commit -m "feat(gpu-terrain): wang atlas slot key + test"
```

### Task 3: WangAtlas GL build (shelf-pack the loaded Wang tiles for one biome)

**Files:**
- Modify: `src/render/wang-atlas.js`

- [ ] **Step 1: Implement `WangAtlas`**

Add to `wang-atlas.js`: a `WangAtlas` class holding a GL texture (start 2048², `NEAREST`, shelf-packed 33-px cells = 32 + 1 gutter), a `Map` from `wangSlotKey` → `{slot, u0, v0}` (slot is a stable integer 0..N assigned on insert), and:
- `add(gl, biomeAsset, level, cornerMask, imageBitmap)` — shelf-packs the 32×32 bitmap, records the slot. Returns the slot integer (0 reserved = "empty/none").
- `slotUV(slot)` — returns `{u0, v0}` (half-texel inset) for the shader.
- `texture()` — the GL texture handle.
- `serializeMeta()` — `{cell:33, atlasSize, slots: {key: {slot,u0,v0}}}` for the compositor uniform + the worker's slot lookup (sent to the worker so it can encode slot integers; see Task 5).

Mirror the existing `gl-compositor` `atlasStrip` packing (shelf x/y, `texSubImage2D`, `UNPACK_PREMULTIPLY_ALPHA_WEBGL` handling). Slot 0 stays an all-transparent reserved cell.

- [ ] **Step 2: Smoke test (node --check only; GL needs a browser)**

Run: `node --check src/render/wang-atlas.js`
Expected: no output (syntax OK).

- [ ] **Step 3: Commit**

```bash
git add src/render/wang-atlas.js
git commit -m "feat(gpu-terrain): WangAtlas GL shelf-pack + slot UV lookup"
```

### Task 4: Worker emits a per-chunk index buffer

**Files:**
- Modify: `src/render/worker-chunk-renderer.js` (add `buildChunkIndex`, reuse the existing per-tile classification at lines ~260-270 that already computes `cornerMask` + wang level)
- Test: `tests/build-chunk-index.test.mjs`

- [ ] **Step 1: Write the failing test** (drive `buildChunkIndex` with a tiny fake chunk + a slot resolver)

```js
// tests/build-chunk-index.test.mjs
import assert from 'node:assert';
import { buildChunkIndex } from '../src/render/worker-chunk-renderer.js';
// Fake 2x2 chunk of one biome; slotResolver returns a deterministic integer per (asset,level,mask).
const chunk = { cx: 0, cy: 0, tiles: Array.from({length: 4}, () => ({ biome: 'grassland', elevation: 0 })) };
const slotResolver = (asset, level, mask) => 1; // every base tile → slot 1
const buf = buildChunkIndex(chunk, { size: 2, slotResolver, soilResolver: () => 0 });
assert.ok(buf instanceof Uint8Array, 'returns Uint8Array');
assert.strictEqual(buf.length, 2 * 2 * 4, 'RGBA per tile');
assert.strictEqual(buf[0], 1, 'baseSlot low byte = 1');
console.log('PASS build-chunk-index');
```

- [ ] **Step 2: Run to verify fail**

Run: `node tests/build-chunk-index.test.mjs`
Expected: FAIL — `buildChunkIndex` not exported.

- [ ] **Step 3: Implement `buildChunkIndex`**

Add an exported `buildChunkIndex(chunk, opts)` to `worker-chunk-renderer.js` that walks the chunk's tiles in the SAME order the bitmap path does, reuses the existing biome→`wangAssetName`, elevation→wang-level, and cornerMask computation, calls `opts.slotResolver(asset, level, cornerMask)` for the base slot and `opts.soilResolver(biome)` for the soil id, and writes `encodeTexel(...)` (import from `gpu-terrain-index.js`) into a `Uint8Array(size*size*4)`. Transition slot = 0 in Phase 1 (handled in Phase 2). `opts.size` defaults to `WORLD.chunkSize`. The slot resolver is injected so the worker can use the atlas meta from Task 3 (sent over `postMessage`) and tests can fake it.

- [ ] **Step 4: Run to verify pass**

Run: `node tests/build-chunk-index.test.mjs`
Expected: `PASS build-chunk-index`.

- [ ] **Step 5: Commit**

```bash
git add src/render/worker-chunk-renderer.js tests/build-chunk-index.test.mjs
git commit -m "feat(gpu-terrain): worker buildChunkIndex emitter + test"
```

### Task 5: Plumb atlas meta → worker, index buffer → main

**Files:**
- Modify: `src/world/chunk-worker.js` (receive `setWangAtlasMeta`; attach `index` to `chunkPainted` when `_gpuTerrain`; bump `?v=`)
- Modify: `src/world/chunk-provider.js` (send atlas meta to workers; store `index` in `this.indexes`; `getChunkIndex`; `setGpuTerrain(on)`)

- [ ] **Step 1: Implement worker side**

In `chunk-worker.js`: handle a new message `{type:'setWangAtlasMeta', meta}` storing `wangAtlasMeta`; add `{type:'setGpuTerrain', on}` storing a `gpuTerrain` flag. In the compile path (after `renderChunkToBitmap`), when `gpuTerrain && wangAtlasMeta`, call `buildChunkIndex(chunk, { slotResolver: (a,l,m) => wangAtlasMeta.slots[wangSlotKey(a,l,m)]?.slot ?? 0, soilResolver: soilIdFor })` and add `index: buf.buffer` to the `chunkPainted` message transfer list. (`soilIdFor` returns 0 in Phase 1.) Keep emitting the bitmap unchanged.

- [ ] **Step 2: Implement provider side**

In `chunk-provider.js`: add `this.indexes = new Map()`; on `chunkPainted`/`chunkRepainted` with `msg.index`, store `new Uint8Array(msg.index)` under the chunk key; add `getChunkIndex(cx,cy)`; add `setGpuTerrain(on)` + `setWangAtlasMeta(meta)` that broadcast to all workers; evict indexes on the scene-teardown bus alongside bitmaps.

- [ ] **Step 3: Bump worker cache-bust**

In `chunk-provider.js createWorker`, bump `workerUrl.searchParams.set('v', ...)` to a new value (e.g. append `-gputiles1`).

- [ ] **Step 4: Smoke**

Run: `node --check src/world/chunk-worker.js && node --check src/world/chunk-provider.js`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/world/chunk-worker.js src/world/chunk-provider.js
git commit -m "feat(gpu-terrain): plumb atlas meta to workers + index buffers to main"
```

### Task 6: Compositor tilemap program + index upload + draw

**Files:**
- Modify: `src/render/gl-compositor.js`

- [ ] **Step 1: Add the program + methods**

Add `setWangAtlas(tex, meta)` (store handle + `cell/atlasSize`), `uploadChunkIndex(key, buf)` (lazy-create a 64×64 `RGBA8` texture per key, `NEAREST`, `texSubImage2D` the buffer — ~16 KB, NO upload budget), and `drawChunkTilemap(key, sx, sy, dw, dh)`. The fragment shader (GLSL ES 3.00): for the chunk quad, compute the in-chunk tile cell + the 0..1 sub-tile fraction from the interpolated UV, `texelFetch` the index texture at the cell, decode `baseSlot` (mirror `gpu-terrain-index.js` bit layout in GLSL), compute the atlas UV `= slotUV + frac * (32/atlasSize)` with a half-texel clamp, sample the atlas, output. Write into the scene FBO at the same bind/viewport `drawChunk` uses. Transition + soil are ignored in Phase 1 (baseSlot only).

- [ ] **Step 2: Smoke**

Run: `node --check src/render/gl-compositor.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/render/gl-compositor.js
git commit -m "feat(gpu-terrain): tilemap shader program + index upload + drawChunkTilemap"
```

### Task 7: Wire the atlas build + draw switch behind the flag

**Files:**
- Modify: `src/render/canvas-renderer.js` (build/lazy-load the grassland atlas; at line 323 branch to `drawChunkTilemap` when `window._gpuTerrain` and atlas+index ready, else `drawChunk`)
- Modify: `src/world/chunk-provider.js` (on atlas ready, `setWangAtlasMeta` + `setGpuTerrain(true)` so new chunks emit indexes)

- [ ] **Step 1: Implement**

In `canvas-renderer.js`: on first frame with `window._gpuTerrain === true`, lazily construct a `WangAtlas`, add grassland's already-loaded Wang tiles (from the provider's image cache / the same `getWangImageURLsForBiomes` set), call `glc.setWangAtlas(...)` and `provider.setWangAtlasMeta(atlas.serializeMeta())` + `provider.setGpuTerrain(true)`. At the chunk draw site (line 323), if `window._gpuTerrain` and `provider.getChunkIndex(cx,cy)` exists and the atlas is ready: `glc.uploadChunkIndex(key, idx); glc.drawChunkTilemap(key, sx, sy, chunkPx, chunkPx);` else the existing `glc.drawChunk(...)`.

- [ ] **Step 2: Browser parity check (manual, the acceptance gate)**

Hard-refresh (DevTools "Disable cache" on). Stand in flat grassland. Screenshot with `window._gpuTerrain=false`, then `=true`. They must match (ignore transition seams / soil, deferred). Confirm `provider stats`: index bytes/chunk < 32 KB, no `drawChunk` 16 MB uploads while on.

- [ ] **Step 3: Commit**

```bash
git add src/render/canvas-renderer.js src/world/chunk-provider.js
git commit -m "feat(gpu-terrain): build grassland atlas + flag-gated tilemap draw (Phase 1)"
```

---

## Phase 2 — Transitions (expand after Phase 1 lands; tasks below are the shape)

- **Task 2.1:** Extend `buildChunkIndex` to resolve the transition `dir` tile (the worker already computes `transitionPairFor` + `cornerMask`); add its atlas slot to the texel's transitionSlot field. Atlas: `add` the `<from>_to_<to>` dir tiles. Unit-test the encode path with a 2-biome fake chunk.
- **Task 2.2:** Shader: when `transitionSlot != 0`, sample the transition tile and blend over the base by corner mask (mirror the current `cornerMask XOR 15` blend). Acceptance: A/B screenshot across a coastline / biome seam matches the bitmap path.

## Phase 3 — F0 soil (expand after Phase 2)

- **Task 3.1:** Bake each biome's soil swatch into the atlas (reserved slot range); `soilResolver` returns a soil id; texel A field carries it.
- **Task 3.2:** Shader: sample the soil swatch with a hash-driven per-tile mask reproducing the current F0 density/alpha/tint (`worker-chunk-renderer` F0 params). Acceptance: soil density/tint parity screenshots per biome.

## Phase 4 — All biomes + default-on + retire the throttle

- **Task 4.1:** Lazy per-biome atlas growth (escalate single-texture → 2D array layer-per-biome if it overflows `MAX_TEXTURE_SIZE`); verify the whole biome set fits / arrays work.
- **Task 4.2:** A/B parity sweep across all 16+ biomes + teleport stress (no leak — reuse the existing GL-texture-count probe).
- **Task 4.3:** Flip `_gpuTerrain` default ON (keep `=false` fallback for one release); stop the worker from rasterizing the bitmap when GPU terrain is active (drop the 16 MB path); remove `CHUNK_UPLOAD_BUDGET` throttling for terrain. Acceptance: run at full speed across biomes — no pop-in, GPU active; then delete the bitmap path in a follow-up once stable.

---

## Self-Review notes
- **Spec coverage:** atlas (Tasks 2-3, 4.1), index map (Tasks 1,4,5), shader pass (Task 6), plumbing (Task 5,7), flag-gated rollout (Task 7 + Phase 4), transitions (Phase 2), F0 soil (Phase 3), retire throttle (Phase 4.3) — all mapped.
- **Type consistency:** `wangSlotKey(biomeAsset, level, cornerMask)`, `encodeTexel(baseSlot, transitionSlot, soilId)`/`decodeTexel`, `WangAtlas.serializeMeta()→{cell,atlasSize,slots}`, `buildChunkIndex(chunk,{size,slotResolver,soilResolver})→Uint8Array`, `getChunkIndex(cx,cy)`, `setWangAtlas/uploadChunkIndex/drawChunkTilemap` — names used identically across tasks.
- **Known deferral:** GLSL bit-decode must mirror `gpu-terrain-index.js` exactly — Task 6 references that layout explicitly to keep them in sync.
