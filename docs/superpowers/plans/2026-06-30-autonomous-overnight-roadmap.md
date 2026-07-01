# Autonomous Overnight Roadmap (2026-06-30 → 2026-07-01)

**Context:** User granted a ~12h unimpeded window and said DO NOT STOP. Work the sequence below top-to-bottom; keep a self-pacing loop (ScheduleWakeup, ~20min heartbeat). Commit by explicit file name (shared repo — never `git add -A`). Verify with `node --check` + unit tests; DO NOT use Playwright (it can hang for hours — user's explicit warning). Leave dev-hook profilers in place for the user to confirm visuals.

**Guiding principle (user, verbatim):** don't cut corners / don't add escape hatches — fix things correctly in the context of the broader GPU re-architecture (eliminate CPU-raster bottlenecks, move rendering to the GPU / GL pipeline; "everything through GL").

**Discipline note:** this session caused several regressions from unverified rapid changes. Slow down: reason carefully, keep changes flag-gated where they touch live rendering, run tests, commit small.

---

## PHASE A — Make the game LOAD + RENDER correctly (the immediate blocker)
- [x] **A1. Roof render cost.** Root cause: roof rasterized via Canvas2D per-facet sheared drawImage on a main-thread `OffscreenCanvas` whose 2D context Chrome does NOT reliably GPU-accelerate → software → ~1.5s/building → town-load main-thread jam ("terrain won't load"). FIX committed `306d8c2b0`: use a detached `<canvas>` (reliably GPU-accelerated on main thread). Verify via `window._roofProf` (render vs blit split, committed `c065a932e`) — expect `maxRender` to drop from ~1500ms to tens of ms.
- [ ] **A2. Remaining per-building bake cost.** After the roof fix, the biggest remaining bake cost is the D1/D2 dressing coverage passes (damage ~365ms + growth ~231ms on big buildings) — per-pixel `getImageData`/`putImageData` on the software bake canvas (inherently CPU). This still jams somewhat when a town's buildings first bake (BUILD_BUDGET=1 spreads it). PROPER FIX (GPU re-architecture): move the dressing coverage onto GPU shaders (like the soil pass), OR bake buildings off the main thread (worker + OffscreenCanvas transferred to a worker, where its 2D IS accelerated). Design + implement.
- [ ] **A3. Confirm terrain loads across biomes** with the roof fix in — no permanent blank terrain. (P4 bitmap-skip is safe: worker meta always lags the compositor, so a complete index always resolves. The blank-terrain the user saw was the main-thread jam, not P4.)

## DECISIONS + CONSTRAINTS (2026-06-30, autonomous run)
- **Cannot verify GPU/render visuals** (Playwright hang risk — user's explicit warning). Cannot mass-generate PixelLab (subscription generations EXHAUSTED 0/10000; only **$104.85 fallback credits** — do NOT burn on speculative gen without the user). So overnight work = FREE + flag-gated (contained risk) + unit-testable where possible + specs. Verify with `node --check`/unit tests; leave dev-hook profilers (`_roofProf`, `_gpuTerrainStats`) for the user.
- **Priority = finish the GPU graphical transition (Phase B), the P3a way** the user validated ("soil looks great"): unit-test the data/emitter, reason the shader carefully, flag-gate behind `window._gpuTerrain`. B is FREE (uses existing gc/F3 assets) and flag-gated (bugs can't break the default bitmap path).
- **KEY DATA FINDINGS** (from worker-chunk-renderer.js): (a) **grassland gc = all `mode:'sprite'`** (grass_mat/clover_patch/golden_thatch), NO luminance — so the VISIBLE grassland GPU gap is **B2 (gc-sprites + F3 scatter)**, currently absent on GPU chunks (P4 skips the bitmap). (b) **gc-luminance = at most ONE object per biome** (beach wet_sand, dense_forest dark_leaf_mat, taiga frost_pine_needles, desert sand_ripple, swamp algae_film, …) — so B1 is soil-like (one lum swatch/biome), NOT multi-object. (c) The texel A channel (RGBA16UI, currently reserved) is free for a gc-lum id.
- **Loading remainder (A2):** after the roof fix, the biggest per-building bake cost is the D1/D2 dressing coverage (damage ~365ms + growth ~231ms on big buildings) — per-pixel getImageData on the software bake canvas, inherently CPU. Proper fix = move the building bake to a WORKER (OffscreenCanvas 2D IS accelerated in a worker) so it never jams the main thread. Big + risky-blind → SPEC it, don't implement blind.

## PHASE B — Finish the GPU terrain (retire the CPU bitmap fully = the real pop-in kill)
**Execution order chosen: B2 first** (visible grassland gap) then B1 (soil-like, biome-specific). Each in P3a style, flag-gated, tests where possible.
- **B2 concrete steps** (gc-sprites + F3 as GPU sprite fields): (1) study field2-animator's descriptor build + `drawPoolSprites`/`drawAnimSprites` feed (it already pools F2/F4/F5/F6 — the pool is the reuse target); (2) add a deterministic gc-sprite descriptor source (port the `mode:'sprite'` placement from worker-chunk-renderer.js ~665-748: rand2 sparsity, variant, jitter, scale, shore-angle, occupancy) + an F3 descriptor source (port applySmallScatterToChunk ~927+: f3Placements, lifecycle state, `_f3RemovedKeys`); (3) feed them into the sprite pool with depth-from-baseline (occlude behind buildings, like the F2 fix); (4) shared occupancy grid so gc/F3/F2 don't collide; (5) skip the CPU gc-sprite + F3 bake in the worker when gpuTerrain (like the soil-skip). Unit-test the descriptor emitters (deterministic placement) in node.
- **B1 concrete steps** (gc-luminance): mirror soil P3a.
  - [x] Step 1 `9a074b424`: texel A channel = gcLumId (encode/decode + test).
  - [x] Step 2 `563d0b40b`: `GC_LUM`/`GC_LUM_IDS`/`gcLumIdForBiome`/`gcLumSwatchURL` in wang-image-list.js (11 luminance biomes; grassland none) + test.
  - [x] Step 3 `73931c12f`: buildChunkIndex emits gcLumId via worker gcLumResolver; ?v=gputiles9.
  - [x] Step 4 `8d16bb61a`: `_ensureGcLumAtlas` + `setGcLumAtlas` (swatch strip + strength/density config). Dev hook `window._gpuGcLumReady`.
  - [x] Step 5 `d100a655a`: shader decodes `gcLumId=int(ti.a)`; additive gc-luminance pass after soil (density gate + jittered swatch sample + `col.rgb += (lum-0.5)*strength` clamped); uniforms + unit 5/6 binding.
  - [x] Step 6 — **NOT NEEDED: P4 already skips the whole bitmap for GPU-indexed chunks**, so the CPU gc-luminance never runs for them (no double-draw). Non-indexed fallback chunks keep bitmap gc-luminance (correct). **B1 COMPLETE.**
  - GATE (user, when back): gpuTerrain on, walk into beach/desert/dense_forest/mountains/arctic/water — subtle surface luminance mottling should ~match `_gpuTerrain=false`. Flag-gated; grassland unchanged (no gc-luminance). All gpu-terrain unit tests green.

Spec: `docs/superpowers/specs/2026-06-30-gpu-terrain-detail-fields-design.md`. P2 (all-biome atlas + cliffs) + P3a (index widen + F0 soil) DONE + soil verified good by user. Remaining:
- [ ] **B1. P3b — ground-cover LUMINANCE on GPU.** Same fragment-shader pattern as soil: gc-lum swatch atlas + a lum id in the texel's A channel + an additive-luminance pass in TILEMAP_FRAG_SRC. Then skip the CPU gc-luminance in the worker when gpuTerrain (like the soil-skip).
- [ ] **B2. P3c — ground-cover SPRITES + F3 small-scatter as GPU sprite fields.** Generalize field2-animator's descriptor+drawAnimSprites instancing to feed gc-sprites + F3 scatter (shared occupancy grid; F3 lifecycle states + `_f3RemovedKeys` honesty). This is what lets P4 drop the bitmap with ZERO visual loss.
- [ ] **B3. P4 finalize.** With B1+B2 at parity, the worker's bitmap path is only the fallback; confirm the pop-in is gone across biomes; keep the flag default-off until the user green-lights default-on.

## PHASE C — Manmade landscape decorations (the "there's a lot more to do")
Only after A+B. Existing design archaeology: building dressing D-fields (`[[project_building_dressing_system]]`), G-stack manmade grounds (`[[project_manmade_grounds_gstack]]` — paved streets/walkways/plazas/PATHWAYS/ROADS), the `decoration-field-pipeline` SKILL (INVOKE for any decoration-field gen/curation), `building-tile-pipeline` skill. Continue the grassland pilot.
- [ ] **C1. Read the specs** (grounds/G-stack PLAN `2026-06-23-dressing-and-grounds-PLAN.md`; dressing plan; decoration-field-pipeline skill) and write/refresh a concrete build order.
- [ ] **C2. Pathways + roads (G-stack).** The biggest missing manmade system: paver/kerb tile corpus, district/street/plaza claims that push natural flora aside, reuse the dressing seam machinery. Spec is design-only — needs the tile corpus + wiring.
- [ ] **C3. More decoration objects across landscape (decoration) fields, grassland pilot.** Have: vines (D2 placed), wall-attachments (lanterns etc. D3), flowers. Add the rest: windowsill pots, more D3 props, garden/yard decor, fences, signage, etc. Generate via PixelLab (decoration-field-pipeline skill), curate, wire (field-studio / apply-field-picks), verify catalog.

---

## Loop mechanics
- Keep a ScheduleWakeup heartbeat (~1200s) with the autonomous sentinel so the loop self-continues across turns/compaction. Work continuously; the heartbeat is insurance against stopping.
- Each turn: pick the next unchecked item, do a bounded chunk, commit, update this doc's checkboxes + memory, continue.
- If blocked on something needing the user's browser (visual verify), NOTE it, leave a profiler/flag, and move to the next item — never idle.
- Update memory `[[project_gpu_tilemap_terrain]]`, `[[project_building_sprite_cache]]`, and the relevant decoration memories as phases complete.
