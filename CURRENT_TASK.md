# Current Task

## Task ID

M1-001

## Goal

Refactor the first playable slice from a monolithic prototype into the initial spec-aligned FreedomMMO module architecture.

## Why this matters

The current `src/main.js` proves that deterministic chunked terrain can render and scroll, but FreedomMMO requires explicit systems: seeded random/noise, chunk coordinates, tile layer stacks, chunk compiler, biome classification, object placement, renderer projection, input, and player/camera orchestration.

## Required reads before coding

- `IMPLEMENTATION_CONTRACT.md`
- `SPEC_IMPLEMENTATION_BACKLOG.md`
- `MIGRATION_BRIEF.md`
- `specs/2026-05-24-master-architecture-design.md`
- `specs/2026-05-25-layer-architecture-spec.md`
- `specs/2026-05-25-overmap-streaming-design.md`
- `specs/2026-05-24-world-compiler-design.md`

## Deliverables

Create/refactor toward:

- `src/core/constants.js`
- `src/core/random.js`
- `src/world/biomes.js`
- `src/world/tile-stack.js`
- `src/world/chunk.js`
- `src/world/chunk-compiler.js`
- `src/world/object-placement.js`
- `src/render/canvas-renderer.js`
- `src/input.js`
- `src/player.js`
- Slim `src/main.js`

## Acceptance criteria

- Game still runs from `index.html`.
- Player can move through a deterministic streamed world.
- Tile state includes explicit simulation layers/properties.
- Renderer derives visuals from compiled tile state.
- `DONE.md` is updated.
- `CURRENT_TASK.md` is advanced to the next task.
