# Current Task

## Task ID

M7-001

## Goal

Add worker-ready chunk compilation infrastructure so terrain generation can scale across modern multi-core computers.

## Why this matters

The current performance pass reduced avoidable main-thread work, but FreedomMMO needs to support large deterministic worlds with rich layered chunks, object placement, lighting projection, and eventually asset composition. Chunk compilation should move behind an asynchronous job queue and then into Web Workers.

## Required reads before coding

- `AGENT_LOOP.md`
- `IMPLEMENTATION_CONTRACT.md`
- `SPEC_IMPLEMENTATION_BACKLOG.md`
- `specs/2026-05-26-performance-infrastructure-spec.md`
- `specs/2026-05-24-world-compiler-design.md`
- `src/world/chunk.js`
- `src/world/chunk-compiler.js`

## Deliverables

- Add a chunk compile job queue abstraction.
- Preserve deterministic synchronous fallback.
- Prepare worker message format for `{ seed, cx, cy } -> compiled chunk`.
- Keep game playable even before full worker migration.
- Update backlog and logs.

## Acceptance criteria

- Chunk generation still produces the same deterministic chunks.
- Main code depends on a chunk provider abstraction instead of directly instantiating compiler everywhere.
- `DONE.md` and `SPEC_IMPLEMENTATION_BACKLOG.md` are updated.
