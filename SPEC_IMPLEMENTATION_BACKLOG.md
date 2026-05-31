# FreedomMMO Spec Implementation Backlog

## Status

The first playable slice exists, but it is a scaffold. The next work must turn it into the spec-defined architecture.

## Milestone 1 — Architecture split

- [x] `src/core/constants.js` — world constants from specs: seed, chunk size, tile size, load radius.
- [x] `src/core/random.js` — deterministic hash/random/noise utilities.
- [x] `src/world/biomes.js` — biome definitions and thresholds.
- [x] `src/world/tile-stack.js` — layer-stack tile records.
- [x] `src/world/chunk.js` — chunk structure and coordinate helpers.
- [x] `src/world/chunk-compiler.js` — simulation-to-render compile pass.
- [x] `src/world/object-placement.js` — deterministic terrain object placement.
- [x] `src/render/canvas-renderer.js` — renderer projection only.
- [x] `src/player.js` — player state and movement.
- [x] `src/input.js` — input state.
- [x] `src/main.js` — orchestration only.

## Milestone 2 — Godot reference extraction

- [ ] Inventory `reference/godot/scripts`.
- [ ] Find overmap generation code.
- [ ] Find seed/noise utilities.
- [ ] Find biome/climate/elevation thresholds.
- [ ] Find chunk coordinate/streaming code.
- [ ] Find terrain object affinity/catalog loading.
- [ ] Summarize extracted facts in `REFERENCE_FINDINGS.md`.

## Milestone 3 — Spec-aligned layer stacks

- [ ] Represent tile as simulation layers, not a color.
- [ ] Include elevation, moisture, heat, biome, material, walkability.
- [ ] Add object/debris/detail layers.
- [ ] Keep render color/sprite as derived output.

## Milestone 4 — Data-driven biomes and objects

- [ ] Load or mirror biome definitions from reference manifests.
- [ ] Load or mirror terrain object affinities from reference manifests.
- [ ] Use biome-specific object densities and rules.
- [ ] Add coast/forest/mountain transition object logic.

## Milestone 5 — Overmap/chunk streaming fidelity

- [ ] Align chunk size and coordinate behavior with specs/reference.
- [ ] Add chunk cache lifecycle.
- [ ] Add deterministic loaded-region bounds.
- [ ] Add debug overlay for tile/chunk/biome/layers.

## Milestone 6 — Visual projection improvements

- [ ] Neighbor-aware terrain transitions.
- [x] Elevation shading.
- [ ] Object layering/depth sort.
- [x] Day/night ambient tint.
- [ ] Optional atlas/procedural sprite pipeline.

## Milestone 7 — Performance and worker infrastructure

- [x] Add frame/update/draw performance instrumentation.
- [x] Cache biome audit work.
- [x] Cache overmap base image and redraw only when needed.
- [x] Remove per-tile cross-chunk lookups from main draw hot path.
- [x] Add chunk compile job queue.
- [x] Move chunk compilation into Web Workers.
- [ ] Add render batching/atlas projection for terrain and objects.
- [x] Add first procedural layered terrain painter for richer ground projection.

## Current implementation caveat

The current world is intentionally simple so there is something playable immediately. It must be refactored against this backlog before major feature expansion.
