# Autonomous Overnight Roadmap (2026-06-30 → 2026-07-01)

**Context:** User granted a ~12h unimpeded window and said DO NOT STOP. Work the sequence below top-to-bottom; keep a self-pacing loop (ScheduleWakeup, ~20min heartbeat). Commit by explicit file name (shared repo — never `git add -A`). Verify with `node --check` + unit tests; DO NOT use Playwright (it can hang for hours — user's explicit warning). Leave dev-hook profilers in place for the user to confirm visuals.

**Guiding principle (user, verbatim):** don't cut corners / don't add escape hatches — fix things correctly in the context of the broader GPU re-architecture (eliminate CPU-raster bottlenecks, move rendering to the GPU / GL pipeline; "everything through GL").

**Discipline note:** this session caused several regressions from unverified rapid changes. Slow down: reason carefully, keep changes flag-gated where they touch live rendering, run tests, commit small.

---

## PHASE A — Make the game LOAD + RENDER correctly (the immediate blocker)
- [x] **A1. Roof render cost.** Root cause: roof rasterized via Canvas2D per-facet sheared drawImage on a main-thread `OffscreenCanvas` whose 2D context Chrome does NOT reliably GPU-accelerate → software → ~1.5s/building → town-load main-thread jam ("terrain won't load"). FIX committed `306d8c2b0`: use a detached `<canvas>` (reliably GPU-accelerated on main thread). Verify via `window._roofProf` (render vs blit split, committed `c065a932e`) — expect `maxRender` to drop from ~1500ms to tens of ms.
- [ ] **A2. Remaining per-building bake cost.** After the roof fix, the biggest remaining bake cost is the D1/D2 dressing coverage passes (damage ~365ms + growth ~231ms on big buildings) — per-pixel `getImageData`/`putImageData` on the software bake canvas (inherently CPU). This still jams somewhat when a town's buildings first bake (BUILD_BUDGET=1 spreads it). PROPER FIX (GPU re-architecture): move the dressing coverage onto GPU shaders (like the soil pass), OR bake buildings off the main thread (worker + OffscreenCanvas transferred to a worker, where its 2D IS accelerated). Design + implement.
- [ ] **A3. Confirm terrain loads across biomes** with the roof fix in — no permanent blank terrain. (P4 bitmap-skip is safe: worker meta always lags the compositor, so a complete index always resolves. The blank-terrain the user saw was the main-thread jam, not P4.)

## PHASE B — Finish the GPU terrain (retire the CPU bitmap fully = the real pop-in kill)
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
