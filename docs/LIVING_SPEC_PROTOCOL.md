# Living Spec Protocol

The project is governed by the specs corpus in `specs/`. Before significant asset generation, rendering, world simulation, movement, interaction, performance, or architecture changes, the implementation process must consult the living spec set.

## Required Loop

1. Re-read or digest all files in `specs/`.
2. Identify which specs govern the current task.
3. Preserve blueprint principles:
   - simulation-first world
   - visuals are projections of simulation state
   - hypergraph/layered tile assembly
   - generated assets with manifests
   - biome coherency and ecotones
   - draw-order/occlusion correctness
   - performance budgets
   - runtime compositor metadata
4. Implement changes.
5. Update DONE.md and any relevant generated/digest docs.
6. If the code deviates from the spec, either correct the code or write an explicit follow-up migration note.

## Current Spec Corpus

- 2026-05-24-master-architecture-design.md
- 2026-05-24-vertical-slice-design.md
- 2026-05-24-visual-vertical-slice-design.md
- 2026-05-24-world-compiler-design.md
- 2026-05-25-agent-swarm-design.md
- 2026-05-25-color-algebra-tiles-design.md
- 2026-05-25-layer-architecture-spec.md
- 2026-05-25-overmap-streaming-design.md
- 2026-05-25-tile-object-system-design.md
- 2026-05-25-tileset-framework-design.md
- 2026-05-25-visual-quality-spec.md
- 2026-05-26-asset-pipeline-spec.md
- 2026-05-26-biome-asset-manifest-spec.md
- 2026-05-26-dynamic-lighting-spec.md
- 2026-05-26-performance-infrastructure-spec.md
- 2026-05-26-runtime-compositor-spec.md
- 2026-05-26-subterranean-design.md
- 2026-05-26-world-biome-system-design.md
- 2026-05-27-elevation-cliff-rendering-design.md
- 2026-05-27-elevation-hypergraph-terrain-design.md
- 2026-05-27-terrain-shading-design.md
- 2026-05-28-pixellab-audit-plan.md
- 2026-05-28-terrain-object-system-design.md
- 2026-05-29-biome-layer-stack-design.md
- 2026-05-29-unity-migration-handoff.md
- 2026-05-31-terrain-rendering-cleanup-design.md

## Automation

Run `node scripts/digest-specs.mjs` after spec changes or before large implementation batches. This writes `docs/SPEC_DIGEST.md`.
