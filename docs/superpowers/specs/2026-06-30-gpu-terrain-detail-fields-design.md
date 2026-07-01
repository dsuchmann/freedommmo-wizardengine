# GPU Terrain Detail Fields (F0 soil · ground-cover · F3 small-scatter) — Design

**Date:** 2026-06-30
**Status:** Design (brainstorm authored autonomously per user directive "write the spec now… feel free to keep going, don't wait for me")
**Supersedes:** the "P3 — soil + ground-cover + small-flora on GPU" outline in `docs/superpowers/plans/2026-06-30-gpu-tilemap-terrain-CONTINUATION.md`.
**Depends on:** P1 (GPU Wang base) + P2 (all-biome atlas + cliffs), both COMPLETE on `building-facade-blocks`.
**Memory:** `[[project_gpu_tilemap_terrain]]`.

---

## 1. Goal & why this exists

The terrain pop-in + idle-GPU root cause is the per-chunk **~16.8 MB CPU bitmap** (`renderChunkToBitmap`), uploaded at ~131 ms each and throttled to 2/frame. P1+P2 moved the **Wang base + cliff overlays** onto the GPU tilemap shader, but the bitmap is **still produced and uploaded** because it ALSO bakes detail layers the GPU path doesn't yet reproduce. **The pop-in only dies when we stop making the bitmap (P4), and we can only do that once these detail layers render on the GPU.** This spec covers those layers.

Non-negotiable (CLAUDE.md): everything in the world renders through the GL pipeline — no 2D `ctx` overlay re-draws world content. These fields must render INTO the GL scene (tilemap shader and/or GL sprite instancing), inheriting the same lighting/CRT/day-night/depth as everything else.

## 2. Scope — what's actually baked (corrected)

`renderChunkToBitmap` (worker-chunk-renderer.js ~1387–1398) layers, in order:

| Layer | Function | Line | Status |
|---|---|---|---|
| Wang base | `paintTerrainTile`→`paintWangBase` | per-tile | ✅ on GPU (P1) |
| Cliff overlay | `paintCliffOverlay` | per-tile | ✅ on GPU (P2b) |
| **F0 soil** | `applySoilFieldToChunk` | 1387 | ⛔ baked — **THIS SPEC** |
| **Ground-cover** | `applyGroundCoverToChunk` | 1394 | ⛔ baked — **THIS SPEC** |
| F2 small-flora | `applySmallFloraToChunk` | 1395–96 **COMMENTED OUT** | ✅ already GPU (field2-animator / field2-gpu instancing) |
| **F3 small-scatter** | `applySmallScatterToChunk` | 1398 | ⛔ baked — **THIS SPEC** |

**Correction to the earlier note:** "small-flora" (F2) is NOT baked — it was migrated to GPU instancing already. The baked sprite scatter that remains is **F3 small-scatter** (pebbles, shells, bones, mushrooms — `SS_BIOME_OBJECTS`, lifecycle states, sim-removal aware). So the three migration targets are **F0 soil**, **ground-cover** (which has TWO sub-modes), and **F3 small-scatter**.

## 3. Two rendering categories

The baked detail splits cleanly by HOW it draws:

**(A) Procedural per-pixel passes** — write a tint/blend over the terrain at the pixel level, no discrete sprites:
- **F0 soil**: per-pixel hash density gate → sample a soil-blob texel → tint → alpha-blend over the base.
- **Ground-cover luminance mode** (`applyGroundCoverToChunk` ~630–660): per-pixel darken/lighten using a ground-cover blob's luminance map.

→ These belong **in the tilemap fragment shader** as additional passes after the base+cliff composite. They are exactly what a fragment shader does well (per-pixel hash + texture sample + blend). No extra draw calls.

**(B) Deterministic sprite scatter** — discrete sprites placed by `rand2(wx,wy,salt)` with an occupancy grid + depth sort:
- **Ground-cover sprite mode** (`applyGroundCoverToChunk` ~665–748): scatter gc sprites, occupancy-gated, shore-aware rotation/scale/alpha.
- **F3 small-scatter** (`applySmallScatterToChunk` ~927+): scatter F3 sprites, base-Y depth sort, lifecycle states, sim-removal (`_f3RemovedKeys`).

→ These belong as **GPU instanced sprite fields**, reusing the proven `field2-animator` / `drawAnimSprites` pipeline (deterministic per-tile descriptors → instance buffer → one instanced draw, already depth-tested behind buildings as of this session's flora fix).

## 4. Prerequisite — widen the index texel

Current texel (`gpu-terrain-index.js`) is RGBA8: base slot 12b · cliff slot 12b · soilId 4b. Two problems for P3:
1. **soilId needs ≥ 5 bits** — there are 21 soil materials (`SOIL_MATERIALS`); 4 bits (16) is not enough.
2. **Atlas capacity** — the 12-bit slot ceiling (4095) caps the atlas at 2048² (~3.8k tiles). Adding soil swatches + more biomes wants more headroom. (The 4096² bump was reverted in `3d49d6cc8` precisely because 12-bit slots can't address it.)

**Decision:** migrate the per-chunk index map from **RGBA8 → RGBA16UI** (a WebGL2 integer texture; `texelFetch` returns `uvec4`). New 64-bit layout:
- R16 = base slot (0–65535)
- G16 = cliff slot
- B16 = soil material id (low byte) + ground-cover-lum id (high byte), OR split as needed
- A16 = flags / reserved (e.g. soil density region, transition partner material — see §5)

Cost: index map 64×64×8 = **32 KB/chunk** (vs 16 KB) — still ~500× smaller than the 16.8 MB bitmap. This removes the slot ceiling (atlas can grow to 4096²+ later) and gives soil/gc ample id space. `encodeTexel`/`decodeTexel` and the GLSL decode update together; `buildChunkIndex` writes `Uint16Array`.

## 5. F0 soil on the GPU

**Reference:** `applySoilFieldToChunk` (worker-chunk-renderer.js ~232–363), `sampleSoilPixel`, `SOIL_BIOME_CONFIG`, `SOIL_MATERIALS`.

The CPU algorithm per terrain pixel: world-pixel hash → density gate (`cfg.density`) → sample a soil-blob texel (random-jittered for land, swirl-offset for water/beach) → optional tint (`cfg.tint`,`tintStrength`) → alpha-blend at `cfg.alpha * transitionFade`.

**GPU design:**
- **Soil-swatch atlas:** for each of the ~21 soil materials, pack a representative soil texture into a soil atlas (its own texture, or a reserved region of the Wang atlas). The CPU randomly samples across several blob variants to break diagonal patterns; on the GPU we get the same noise-breaking from **hash-jittered, wrapped UVs** into a single (or a few stacked) soil swatch(es) per material. v1: one 32×32 (or larger tiling) swatch per material.
- **soilId** rides in the widened texel (§4). A small **config lookup** — a tiny `Nx1` texture or uniform array indexed by soilId — carries `density, alpha, tint.rgb, tintStrength` per material.
- **Shader pass** (appended to TILEMAP_FRAG_SRC after base+cliff): compute world-pixel coords (needs the chunk world-tile origin as a uniform — `uChunkOrigin`), a GPU hash (NOT the CPU's float64 hash — exact pixel match is unnecessary since we REPLACE the bitmap; equal density/texture is the bar), density gate, jittered swatch sample, tint, `col = mix(col, soil.rgb, soil.a * alpha)`.

**Transition tiles (the one real simplification):** the CPU blends TWO materials (biomeA/biomeB) split by the corner-mask field with a fade near the boundary. A single soilId per texel can't carry both. **v1 decision:** use the tile's PRIMARY biome soil material across the whole tile (no per-pixel A/B split). Rationale: soil is a low-alpha (~0.3) sub-detail, and the visible biome blend already lives in the pre-blended Wang base tile underneath; a slightly-wrong soil material along the exact border seam is barely perceptible. **Deferred refinement** (if the user sees border seams): store the partner material id + corner mask in the texel's A16 field and reproduce the blend field in-shader.

**Parity gate:** stand in several biomes (grassland, desert, forest, swamp, beach) and a teleport across a forest↔grassland border; toggle `_gpuTerrain`; soil grain density/colour should read equivalently (not pixel-identical).

## 6. Ground-cover luminance mode on the GPU

**Reference:** `applyGroundCoverToChunk` luminance branch (~600–663) — per-pixel `pixel += blob.lum[sampleIdx] * strength` (darken/lighten, no colour).

Same machinery as soil: a **gc-lum swatch** per biome/object packed into the soil/detail atlas, a lum id in the texel, hashed-jittered sample, and an additive luminance term in the shader pass: `col.rgb += lum * strength`. Land uses random jitter; water/beach uses the directional swirl offset (reproduce the `sin/cos` swirl in-shader from world-pixel coords). This is a small addition once the soil pass exists (shares the world-coord + hash scaffolding).

## 7. Ground-cover sprites + F3 small-scatter as GPU sprite fields

**Reference:** gc sprite branch (~665–748); `applySmallScatterToChunk` (~927+); existing `field2-animator.js` (descriptor build + `drawAnimSprites` instancing).

**Design:** generalize the field2-animator pipeline into a shared **GPU sprite-field engine** that any field feeds:
1. **Per-tile descriptor build** (worker or main thread, deterministic via `rand2(wx,wy,salt)`): list of `{ux, uy, scale, angle, alpha, variantUrl, state}` per placement — exactly field2-animator's existing per-tile descriptor shape.
2. **Occupancy grid:** the bitmap uses a chunk-wide occupancy grid shared ACROSS fields to prevent overlap. The GPU engine needs the same cross-field occupancy so gc/F3/F2 don't visually collide. Decision: compute occupancy once per chunk (deterministic) and have all sprite fields consult it — keep it in the descriptor-build stage (CPU, cheap, cached per chunk like field2's `_f2TileDescriptors`).
3. **Variant atlas:** pack gc/F3 sprite variants into the sprite atlas (field2 already shelf-packs sprite variants — extend it).
4. **Instanced draw, depth-sorted:** feed all sprite-field instances through `drawAnimSprites` (static variant = no anim frames; reuse the depth-from-baseline z so they occlude correctly behind buildings — already wired this session).

**F3 specifics that must be preserved (no-mock):**
- **Lifecycle states** (`f3Placements` returns state; `f3SpriteUrl`) — seedling/normal/wilting/dead. Carry `state` in the descriptor → pick the state sprite variant.
- **Sim-removal** (`_f3RemovedKeys`, key `f3:wx,wy:i`) — honest object permanence: a placement the sim consumed must NOT render. The engine must consult the removed-keys set at descriptor-build time (it already flows to the worker via `setF3RemovedKeys`).
- **Base-Y depth sort** within the field for correct stacking — the instanced depth-z handles cross-sprite ordering.

**Why reuse field2-animator, not the tilemap shader:** discrete sprites with rotation/scale/per-instance alpha/occlusion are an instancing problem, not a per-pixel one. The infra exists and is proven (F2 ships through it).

## 8. Architecture / data flow

```
chunk-worker (per chunk):
  buildChunkIndex → Uint16Array index map  [base slot, cliff slot, soilId, gcLumId, flags]
                    (soilResolver now REAL: soilMaterialForBiome → material id)
  buildSpriteFieldDescriptors(chunk) → { gc:[…], f3:[…] }  (deterministic, occupancy-gated,
                    F3 lifecycle + removed-keys aware)   [cached like field2 descriptors]
main thread (canvas-renderer.draw):
  glc.drawChunkTilemap(...)  → base + cliff + SOIL pass + GC-LUM pass   (one fragment shader)
  spriteFieldEngine.draw(gc + f3 + f2 instances)  → drawAnimSprites (depth-tested)
compositor:
  setSoilAtlas(tex, configTex)         (new — soil/gc-lum swatches + per-material config)
  TILEMAP_FRAG_SRC                      (+ soil pass, + gc-lum pass, + uChunkOrigin uniform)
  index map now RGBA16UI                (uploadChunkIndex writes integer texture)
```

The soil/gc-lum atlas + config load the same incremental, all-biome way the Wang atlas does (§ P2a) — driven by `provider.getActiveBiomes()`.

## 9. Honest absence (no-mock)

Each field is ABSENT-not-fake when its assets aren't present:
- Soil material PNG missing → that material contributes NO soil pass (bare base tile), never a flat-colour stand-in.
- gc/F3 sprite variant missing → that placement is skipped (matches the bitmap's `if (!bmp) continue`), never a placeholder sprite.
- A biome with no gc/F3/soil config simply has none. The world looks like that field doesn't exist there — which is the honest semantics.

## 10. Parity gates (per phase)

Screenshot A/B (`_gpuTerrain` on vs off) at fixed spots, plus walk + teleport:
- **P3a soil:** grain density/colour equivalent across ≥5 biomes + a border teleport; no missing-soil "bare" patches where the bitmap had soil.
- **P3b gc-lum:** ground mottling/darkening reads the same.
- **P3c gc+F3 sprites:** same sprite density, no overlap collisions (occupancy preserved), F3 lifecycle states visible, sim-removed F3 absent. Then the headline gate: **P4 — delete the bitmap, walk/run/teleport at full speed → no pop-in, GPU active, terrain not visibly barer than before.**

## 11. Phasing

- **P3a — index widening + F0 soil in-shader.** RGBA16UI texel + encode/decode + GLSL decode; soil-swatch atlas + config lookup; soil fragment pass; real `soilResolver`. (Biggest single detail win; unblocks atlas growth.)
- **P3b — ground-cover luminance pass.** Small add on the soil scaffolding.
- **P3c — GPU sprite-field engine: ground-cover sprites + F3 small-scatter.** Generalize field2-animator; shared occupancy; F3 lifecycle + sim-removal.
- **P4 — delete the bitmap + retire the throttle.** Stop `renderChunkToBitmap` when `gpuTerrain`; drop `CHUNK_UPLOAD_BUDGET`; flag default-ON with `=false` fallback for one release; then `superpowers:finishing-a-development-branch`.

Each P3 sub-phase is independently shippable behind the flag and screenshot-gated. P4 is the payoff (pop-in dies).

## 12. Risks / open questions

- **GPU hash ≠ CPU hash** for soil density — intentional (we replace the bitmap, equivalence not identity). Risk: a visibly different *distribution* — mitigate by matching density thresholds and validating against screenshots.
- **Soil transition simplification** (§5) — single-material per tile may show a seam at strong soil-colour borders (e.g. desert↔swamp). Deferred A/B split is the fallback if the user notices.
- **Occupancy parity** — the bitmap's cross-field occupancy grid order (gc before F3, etc.) affects which sprite wins a contested cell. The GPU engine must build occupancy in the same field order to match density/placement, or accept a benign reshuffle.
- **Atlas growth vs index width** — once RGBA16UI lands, re-evaluate growing the Wang+soil atlas to 4096² (slots then fit in 16 bits). Capacity stops being a fallback-to-bitmap risk.
- **Descriptor build cost** — field2 caches per-tile descriptors; gc/F3 must cache equally or risk per-frame CPU. Reuse the `clearF2TileDescriptors`-style invalidation.

## Resume / handoff

Implement P3a first (index widening + soil). This is the disciplined next step after this spec → `superpowers:writing-plans` to produce the task-by-task plan, then subagent-driven execution. Continue on `building-facade-blocks`. P4 (the actual pop-in kill) is gated on P3a–c reaching parity.
