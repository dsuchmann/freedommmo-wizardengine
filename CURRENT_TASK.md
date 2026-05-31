# Current Task

## Task ID

M7-002

## Goal

Reduce remaining draw/render bottlenecks after worker-backed chunk compilation by adding chunk-level render caches and/or lower-cost terrain projection.

## Why this matters

Chunk generation can now run through a worker pool, but the renderer still draws every visible tile every frame and applies per-tile shading/tint math in the hot path. FreedomMMO needs chunk-image projection, atlas-style batching, or cached terrain layers so the main thread mostly composites prebuilt chunk surfaces.

## Required reads before coding

- `AGENT_LOOP.md`
- `IMPLEMENTATION_CONTRACT.md`
- `SPEC_IMPLEMENTATION_BACKLOG.md`
- `specs/2026-05-26-runtime-compositor-spec.md`
- `specs/2026-05-27-terrain-shading-design.md`
- `src/render/canvas-renderer.js`
- `src/world/chunk-compiler.js`

## Deliverables

- Add cached terrain chunk image projection or equivalent batching.
- Keep dynamic lighting/elevation readable.
- Preserve deterministic tile/layer simulation data.
- Update perf HUD/logs/backlog.

## Acceptance criteria

- Renderer does less per-tile work every frame.
- Chunk cache invalidates safely if projection inputs change.
- `DONE.md` is updated.
