# GPU Tilemap Terrain — Continuation / Handoff (read this first to resume)

**Updated:** 2026-06-30. Supersedes the phasing in `2026-06-30-gpu-tilemap-terrain.md` (that plan's `(biome,level,cornerMask)` key + "transition = shader blend" model were REPLACED during implementation — see "Key realizations" below). Design rationale: `docs/superpowers/specs/2026-06-30-gpu-tilemap-terrain-design.md`. Memory: `[[project_gpu_tilemap_terrain]]`.

## One-paragraph status
The terrain pop-in + idle-GPU root cause: each chunk is CPU-rasterized to a **~2048² = 16.8 MB bitmap** (Canvas2D), uploaded at **~131 ms each, throttled `CHUNK_UPLOAD_BUDGET=2`/frame** — so walking outruns the pipeline and the GPU just blits pre-made images. The fix: render terrain on the GPU from a **Wang-tile atlas + a ~16 KB per-chunk index map** in a fragment shader. **Phase 1 is BUILT, MERGED (branch `building-facade-blocks`, flag-gated `window._gpuTerrain`, default OFF), and PROVEN in-browser**: `window._gpuTerrainStats = {tilemap:10879, bitmap:12452, ready:true}` — the shader drew 10,879 chunk-draws of real terrain. **The pop-in is NOT fixed yet** — see "Why pop-in isn't fixed."

## What exists & works (Phase 1, all committed on building-facade-blocks)
Commit chain: `035ec4e0`(codec) → `cbe90c07`/`b697ff99`(atlas) → `58218daf`(emitter) → `1a830a27`(plumbing) → `128a584c`(shader) → `a2ceecb9`(URL-key reconciliation) → `ac81fb50`(loader+draw switch) → `b38577bf`(stats diag) → merge `95440c85`.

- `src/render/gpu-terrain-index.js` — `encodeTexel(baseSlot,transitionSlot,soilId)`/`decodeTexel` → RGBA8 (R=baseSlot.lo8, G=baseSlot.hi4|transSlot.hi4<<4, B=transSlot.lo8, A=soilId). Unit-tested.
- `src/render/wang-atlas.js` — `class WangAtlas(gl, atlasSize=2048)`: `add(urlKey, imageBitmap)→slot` (URL-keyed, idempotent, shelf-packed 33px cells, slot 0 reserved=empty, returns 0 when full), `slotUV(slot)`, `texture()`, `serializeMeta()→{cell,atlasSize,slots:{[url]:{slot,u0,v0}}}`. (Mirrors gl-compositor `atlasStrip`.)
- `src/render/worker-chunk-renderer.js` — `buildChunkIndex(chunk,{size,slotResolver,soilResolver})→Uint8Array`: per tile calls **`getWangSrc(tile, variant)`** (the SAME fn the bitmap painter uses) + `elevationVariant(tile)` (+ self-transition→wang_25 special-case), resolves the URL → slot. `encodeTexel(slot,0,soilId)`. `elevationVariant` now exported. Runs AFTER `renderChunkToBitmap` so tiles are already classified (`transitionPair`/`wangEdgeMask`).
- `src/world/chunk-worker.js` — handles `setWangAtlasMeta`/`setGpuTerrain`; when on+meta, attaches transferable `index` to `chunkPainted`/`chunkRepainted`. Worker cache-bust `?v=…-gputiles1`.
- `src/world/chunk-provider.js` — `this.indexes` Map, `getChunkIndex(cx,cy)`, `setWangAtlasMeta(meta)`+`setGpuTerrain(on)` (broadcast + replay to new workers), evict indexes in `initPreload(force)`.
- `src/render/gl-compositor.js` — `setWangAtlas(tex,meta)` (builds RG32F slot→UV table texture), `uploadChunkIndex(key,buf)` (per-key 64² RGBA8 tex, no throttle), `drawChunkTilemap(key,sx,sy,dw,dh)` (TILEMAP_FRAG_SRC samples atlas per-pixel; restores base program after; co-evicts in `_sweep`/`purgeOffscreen`).
- `src/render/canvas-renderer.js` — `_ensureWangAtlas(provider)` (lazy once-only: fetch+`createImageBitmap` all `getWangImageURLsForBiomes(['grassland'])`, `atlas.add`, then `setWangAtlas`+`setWangAtlasMeta`+`setGpuTerrain(true)`+`window._gpuTerrainReady=true`); draw switch at the chunk loop (`drawChunkTilemap` when `_gpuTerrain && _wangAtlasState==='ready' && getChunkIndex` else `drawChunk`) + `window._gpuTerrainStats` counter.

**Test it:** hard-refresh → `window._gpuTerrain=true` → wait `window._gpuTerrainReady===true` → walk → read `window._gpuTerrainStats`. Dev-server caches JS 1h (no -c-1) → use DevTools "Disable cache" / incognito.

## KEY REALIZATIONS (these change the remaining plan — do not re-derive)
1. **Tile identity = the Wang URL from `getWangSrc(tile, variant)`** (`src/render/worker-tile-painter.js`). It returns `…/transitions/<pair-dir>/<variant>/<dir>__wang_<mask>__v000.png` (or null). The index emitter AND the atlas both key on this URL, so the GPU picks the IDENTICAL tile the bitmap draws. Do NOT reinvent cornerMask.
2. **Transitions are FREE** — a biome border tile is just a single PRE-BLENDED Wang PNG that `getWangSrc` already returns. So there is NO separate "transition blend" shader pass (the design's Phase 2 was wrong). The index's `transitionSlot` field is currently unused and can be removed. "Transitions" reduces to: make sure the atlas has the transition/all-biome tiles loaded.
3. **WHY POP-IN ISN'T FIXED:** the worker STILL rasterizes + uploads the 16.8 MB bitmap every chunk (both paths run; the draw just *prefers* tilemap when an index exists). The `CHUNK_UPLOAD_BUDGET=2` throttle + the 131 ms uploads are still happening. **The pop-in only dies when we STOP making the bitmap (Phase 4).** That requires the GPU path to FULLY replace it.
4. **The bitmap bakes MORE than wang base.** `renderChunkToBitmap` layers: (a) **wang base** `paintTerrainTile`→`paintWangBase`→`getWangSrc` [DONE on GPU], (b) **F0 soil** `applySoilFieldToChunk` (per-pixel procedural blobs, per-biome density/alpha/tint, transition-blended), (c) **cliff overlay** `paintCliffOverlay` (a SECOND wang tile where elevation steps — `CLIFF_CORNER_TO_WANG`, `BIOME_CLIFF` dirs), (d) **ground cover** (gc__ sprites scattered), (e) **small flora** (sf__ sprites scattered). (b)–(e) are MISSING from the GPU path = why GPU terrain looks barer. To delete the bitmap, all of (b)–(e) must render on the GPU (or move to existing sprite-field systems).

## Remaining plan (REVISED)
**P2 — all-biome + cliff coverage (makes GPU terrain usable world-wide).**
- Dynamic atlas growth: hook the existing biome preload (`ChunkProvider.initPreload` samples biomes around the player) so `_ensureWangAtlas` loads `getWangImageURLsForBiomes(biomesPresent)` incrementally, re-calls `setWangAtlas`+`setWangAtlasMeta` as the atlas grows (workers re-resolve new slots). Make the load incremental/parallel (Phase-1 load of ~100 URLs up-front was slow).
- Cliff overlay: `paintCliffOverlay` draws a 2nd wang tile per cliff cell. Either (i) add a 2nd index layer / use the `transitionSlot` field for the cliff tile + a 2nd atlas sample in the shader, or (ii) fold the cliff into the base where possible. Needs `getCliffSrc`-style identity (see `paintCliffOverlay` in worker-tile-painter.js: `BIOME_CLIFF[biome]` + `CLIFF_CORNER_TO_WANG[cornerMask]`).
- Atlas capacity: many biomes × masks × levels + transitions may exceed 2048². Escalate to a larger atlas or a 2D-array layer-per-biome.

**P3 — soil + ground-cover + small-flora on GPU (THE hard part).**
- F0 soil: per-pixel procedural (hash-driven blobs, per-biome `SOIL_BIOME_CONFIG` density/alpha/tint, transition-blended by corner mask). Options: bake each biome's soil into a tiling swatch in the atlas + reproduce the density/blend mask in the fragment shader (the `soilId`/`A` field already carries a per-tile soil id), OR a procedural soil shader. Parity gate = screenshot vs bitmap.
- Ground cover (gc) + small flora (sf): scattered sprite detail baked into the bitmap. Likely belongs as GPU sprite-FIELDS (like F2 flora), NOT in the tilemap shader. May reuse the existing field2-animator instancing.
- This is a real design effort — probably its own brainstorm/spec before coding.

**P4 — kill the bitmap + the throttle (the actual pop-in fix).**
- Once P2+P3 reach parity: stop the worker calling `renderChunkToBitmap` when `gpuTerrain` (drop the 16.8 MB path), remove `CHUNK_UPLOAD_BUDGET` throttling for terrain, flip `window._gpuTerrain` default-ON (keep `=false` fallback one release). Verify: run at full speed across biomes → no pop-in, GPU active. Then `superpowers:finishing-a-development-branch`.

## Gotchas / conventions
- Commit by EXPLICIT file name (shared index, parallel sessions). The working tree has OTHER sessions' uncommitted asset/script changes — DO NOT `git add -A` or touch them.
- Worker code change → bump `?v=` in `chunk-provider.js createWorker` or the browser serves stale worker.
- Dev server caches JS 1h (no -c-1) → DevTools "Disable cache"/incognito to load edits.
- The legacy CPU flora path was bit-rotted (null buffers); fixed this session, but GPU flora is the production path.
- GPU flora now depth-occludes behind buildings (fixed this session in `drawAnimSprites` — `uDepthOn/uDepthRef/uDepthScale`, z=2d-1 from baseline). Flora SHADOWS (`drawAnimShadows`) still don't depth-test — fix similarly if shadow-over-building appears.

## Dev hooks
`window._gpuTerrain` (flag), `window._gpuTerrainReady`, `window._gpuTerrainStats` {tilemap,bitmap,ready,idxNull}. `window._gpuFlora` (flora path), `window._drawProf`, `window._gpuTerrainStats`.

## Resume command
"continue the GPU terrain phases" → start at P2 (all-biome atlas loading), it's the next contained, testable step. The worktree `.claude/worktrees/gpu-terrain` is now STALE (post-merge) — continue on `building-facade-blocks`.
