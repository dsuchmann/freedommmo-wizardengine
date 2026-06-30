# GPU Tilemap Terrain Rendering — Design

**Date:** 2026-06-30
**Status:** Design (pending user review)
**Atlas placement:** S2 (World Substrate) — the *rendering* of the Wang/decoration substrate. No change to how the substrate is *derived* (biome classification, Wang corner masks, F0 soil parameters are untouched); this changes only how it is drawn. Edge: feeds the GL present pass (lighting/CRT/day-night) exactly as the current chunk quad does.

## Problem

Terrain is not GPU-bound — the GPU sits idle while the CPU does all the work, and the player out-runs the pipeline.

Per-chunk data flow today (`worker-chunk-renderer.js` → `chunk-provider.js` → `gl-compositor.drawChunk`):

1. A CPU worker **rasterizes each chunk to a ~2048×2048 RGBA bitmap = 16.8 MB** (Canvas2D `drawImage` of Wang tiles + transition tiles + F0 soil).
2. That bitmap is uploaded to a GL texture. Code-measured cost (gl-compositor.js:1010-1036): a fresh `texImage2D` re-stages the full 16.8 MB (~**131 ms/upload** on ANGLE/D3D11); a boundary-crossing burst stacked into a **~851 ms** hitch.
3. Uploads are therefore **throttled to 2 chunks/frame** (`CHUNK_UPLOAD_BUDGET = 2`).
4. The GPU draws each chunk as **one textured quad — microseconds.**

Consequences: (a) the GPU is idle (its only job is blitting pre-made images); (b) **stutter** = the big uploads; (c) **pop-in when running** = crossing chunks faster than 2 can rasterize+upload per frame. Stutter and pop-in share one root cause: the 16.8 MB CPU bitmap per chunk.

## Goal

Composite the terrain **base** on the GPU from a shared Wang-tile **atlas** + a tiny per-chunk **index map**, eliminating the 16.8 MB rasterize-and-upload. "Loading a chunk" becomes a ~4–16 KB index upload (instant, no throttle, no stall). The fragment shader does the real tile compositing → the GPU does real work; running pop-in disappears.

Success criteria:
- No per-chunk 16.8 MB upload; chunk index uploads are < 32 KB and un-throttled.
- Running across new terrain at full speed shows no pop-in (no upload backlog).
- GPU measurably active (frame-time moves from CPU upload to GPU fill); idle-frame draw time unchanged or better.
- Visual parity with the current bitmap path, per biome (A/B screenshots).

## Scope (decision 1 — confirmed: base only)

**In scope:** the terrain *base* that today bakes into the chunk bitmap — Wang substrate tiles (`wang` / `wang_25` / `wang_50` / `wang_100` by elevation delta), transition pairs, and F0 soil.

**Out of scope (unchanged, already on their own GPU path):** F2–F8 flora / large objects (GPU instanced sprites), buildings (cached sprite + GPU roof), weather/lighting/CRT (present shader). These keep working as-is and composite over the new terrain identically.

## Architecture

Three new pieces + threaded plumbing; everything flag-gated behind `window._gpuTerrain` and running **alongside** the existing bitmap path for A/B + instant fallback (decision 3 — confirmed).

### 1. Wang-tile atlas (`src/render/wang-atlas.js`)
- Packs every 32×32 Wang variant — keyed by `(biome|asset, level, cornerMask 0..63)` plus transition `dir` tiles and soil swatches — into a GL texture **atlas** (single 2D texture, shelf-packed like the sprite atlas; if it overflows the max texture size, fall back to a **2D texture array** layer-per-biome).
- Built lazily per biome on the same hot-load that today fetches Wang PNGs (`getWangImageURLsForBiomes`), so a biome's tiles are atlas-resident before its chunks draw. Reuses the existing image hot-load + scene-teardown eviction.
- Exposes `atlasIndexFor(biome, asset, level, cornerMask) -> {layer,u0,v0}` and the GL texture handle.

### 2. Per-chunk index map (worker-side, in `worker-chunk-renderer.js`)
- Instead of (Phase 4: in addition to) rasterizing the bitmap, the worker emits a **64×64 index buffer** (one texel per tile). Each texel encodes, in RGBA8 (or R32UI):
  - base tile atlas index (biome+asset+level+cornerMask resolved to an atlas slot),
  - transition tile atlas index + blend (0 = none),
  - F0 soil id + density/alpha bucket.
- This is *cheaper* than the current rasterize — the worker already computes the per-tile classification; it just stops calling `drawImage` and writes integers. Transferred as a small `ArrayBuffer` (zero-copy `postMessage` transfer).

### 3. Tilemap shader pass (`gl-compositor`)
- `uploadChunkIndex(key, buf)` → `texSubImage2D` of the 64×64 index map into a per-chunk (or per-chunk-ring) index texture. ~16 KB, no throttle.
- `drawChunkTilemap(key, quad…)` → draws the chunk quad with a fragment shader that, per pixel: computes the in-chunk cell, samples the index texture (nearest), looks up the base tile in the atlas with the correct sub-tile UV, samples + blends the transition tile, overlays soil. Writes into the **scene FBO** at the same place the current chunk quad does, so the present pass lights/CRTs it identically (CLAUDE.md: everything through GL).
- Filtering: atlas sampled with explicit per-tile UV clamping (half-texel inset) to avoid bleeding between atlas neighbors; terrain stays nearest-filtered to match today's pixel look.

### Plumbing
`chunk-provider`/`chunk.js` carry the index buffer alongside (Phase 4: instead of) the bitmap through the same queued→pending→completed→adopted path. `getReady`/`getBitmap` gain an index-buffer sibling. The directional-priority + zoom-aware-radius work already done still applies (now cheap, since adoption is a 16 KB upload).

## The hard part: F0 soil parity (decision 2 context)

F0 soil today is per-pixel procedural blobs with per-biome density/alpha/tint (CPU, in `worker-chunk-renderer`). Two options for the shader:
- **A (recommended):** bake each biome's soil into a small tiling **soil swatch** in the atlas; the shader samples it with a procedural per-tile mask (hash-driven, matching the current density). Keeps it fully on-GPU.
- **B:** keep F0 as a thin separate CPU pass for one release. Rejected unless A can't hit parity — it reintroduces a (smaller) CPU bitmap.

Transitions (decision 2 — confirmed parity): a second atlas sample of the `dir` tile + blend by corner mask, matching the current `cornerMask XOR 15` lookup. No simplification.

## Rollout / phases (each ends with something verifiable)

1. **Atlas + single-biome base**, no transitions/soil, behind `_gpuTerrain`. Screenshot-parity vs bitmap for one flat biome (grassland). Probe: upload bytes/chunk, GPU active.
2. **Transitions** — biome borders match the bitmap path (A/B screenshots across a coastline / biome seam).
3. **F0 soil** (option A) — soil density/tint parity.
4. **All biomes + make default**; retire the per-chunk bitmap rasterize + the 2/frame upload throttle. Keep the bitmap path behind the flag for one release as fallback, then delete.

## Risks & mitigations

- **Atlas capacity** (biomes × ~64 masks × 4 levels × transitions → potentially thousands of 32px tiles): start single-texture shelf-pack; escalate to a 2D-array layer-per-biome if it overflows `MAX_TEXTURE_SIZE`. Lazy per-biome load bounds the working set.
- **Visual parity** is the acceptance gate every phase — A/B screenshots, not "looks fine."
- **Worker/GL boundary**: index buffers are plain `ArrayBuffer`s (transferable); no canvas in the worker for the base path.
- **Fallback**: `_gpuTerrain=false` (or atlas build failure / no WebGL2 features) → the existing bitmap path, untouched. Zero-risk to ship dark.

## Testing
- Per-phase **A/B screenshot parity** (GPU tilemap vs current bitmap) per biome + at a transition seam.
- **Runtime probe**: bytes uploaded/chunk, uploads/frame, GPU-active check, run-speed pop-in (no backlog).
- Headless smoke (node `--check` + the existing chunk harness) on the worker index emitter.
