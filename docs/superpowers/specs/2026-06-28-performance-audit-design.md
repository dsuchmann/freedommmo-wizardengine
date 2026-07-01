# Whole-Codebase Performance Audit — Charter / Design

**Date:** 2026-06-28
**Status:** Approved for execution (read-only audit)
**Type:** Multi-agent review → ranked optimization corpus. NO code changes until the user greenlights items.

## Motivation

- **Reproducible symptom:** teleporting between biomes leaks memory until fps collapses to **3–4**. Recovers only on reload. Strong suspicion of **unbounded per-biome growth** — image/texture caches that never evict, GL resources (terrain chunks, building sprites, atlas, the large **@384 tree upscales**) accumulating, and/or worker-side tileset state never freed.
- **North-star target:** **144fps in-browser, instant-feeling load** (no blocking frame work, nothing that stalls the main thread). Treated as the optimization *direction* that ranks findings — not a literal guarantee. "Instant load" = stream/async everything; never block a frame.

## Scope

- **Whole codebase** as it affects runtime: `src/` (render pipeline, GL, sim, decoration fields, buildings, world streaming), the **web workers**, and the **game lifecycle** (teleport / biome-switch / fast-travel, startup/boot). Asset-generation scripts are in scope only where they shape runtime memory (e.g. @384 sizes).
- **READ-ONLY.** This audit produces a corpus of findings + proposed fixes. **No code is edited** until the user picks items to implement.

## Methodology — multi-agent, iterated

Five phases. Agents are read-only (Explore-class): they read and reason, return structured findings, never edit.

1. **Subsystem shard (round 1, ~20 parallel agents).** One agent per subsystem (below), each hunting flaws in its area against the shared lens list.
2. **Lens sweep (round 2, ~7 agents).** Each sweeps the *whole* codebase for one cross-cutting pattern — catches "same bad pattern in 15 files" that subsystem shards miss.
3. **Leak hunt (~4 agents).** Trace exactly what grows per biome on the teleport path — the reproducible bug. Inventory every cache/Map/texture/worker-message touched on a biome switch and check each for an eviction/teardown path.
4. **Adversarial verification.** Each surviving finding gets a skeptic agent: *is it real (not a false positive), and is the impact realistic?* Findings that fail verification are dropped or down-confidenced.
5. **Completeness critic + iterate.** A final agent asks "what subsystem / lens / code path did we not cover?" and spawns another targeted round until it returns dry.

### Subsystems (round-1 shards)

GL compositor & present pipeline (`gl-compositor.js`) · chunk render cache (`chunk-render-cache.js`) · chunk workers + biome tileset loading (`chunk-worker.js`) · atlas / texture manager (`atlas-manager.js`) · **building sprite cache + door dynamic layer** (`building-sprite-cache.js`, `building-occluder.js`) · building tiles & image caches (`building-tiles.js`, `door-leaves.js`) · decoration fields F0–F8 (`field2-animator.js`, `decoration-claims.js`) · large-object/flora renderer + **@384 upscale manifest** (`large-object-renderer.js`, `upscale-manifest.js`) · main draw loop (`canvas-renderer.js`) · **world streaming / teleport / fast-travel** · sim / entities / motion · water & foam overlays · interior rendering (`interior-gl.js`) · shadows · dressing overlays (socket/vine/growth) · input / camera / zoom · startup / boot / preload · overmap / civilization overlay · audio (if present) · global lifecycle (listeners / timers / workers).

### Lenses (round-2 cross-cutting sweeps)

1. **Unbounded caches / memory leaks** — `Map`/`Set`/object caches with no eviction; GL textures/buffers never deleted; `Image()` objects retained forever.
2. **Per-frame allocations** — object/array/closure churn in the draw/update loop → GC pressure → stutter.
3. **GL / draw-call waste** — redundant `texImage2D`/uploads, full-screen passes, state thrash, per-object draws that could batch.
4. **Blocking / sync load** — synchronous decode, main-thread stalls, missing streaming, work that should be off-thread.
5. **Algorithmic hotspots** — O(n²) or per-frame full scans where incremental/cached would do.
6. **Teardown gaps** — workers, listeners, intervals/RAFs, observers not cleaned up across teleport/scene change.
7. **Redundant per-frame recompute** — deterministic work recomputed every frame instead of cached (the class of the door-weathering bug).

## Finding schema

Each finding is **actionable work**, not a complaint:

| field | content |
|---|---|
| **id / title** | short, unique |
| **subsystem** | which shard |
| **location** | `file:line` (concrete) |
| **category** | leak / per-frame-alloc / GL-waste / blocking-load / algorithmic / missing-teardown / redundant-recompute |
| **root cause** | what & why, with code evidence |
| **proposed fix** | concrete approach |
| **impact** | est. fps / MB / ms, and *under what conditions* (e.g. "+per biome teleport") |
| **confidence** | verified / likely / speculative (after adversarial pass) |
| **effort** | S / M / L |
| **priority** | `impact × confidence / effort` |
| **risk / deps** | what could break; ordering constraints |

## Corpus document

Single ranked doc in `docs/superpowers/specs/2026-06-28-performance-audit-CORPUS.md`:

1. **Teleport-leak root cause** — called out first, with the per-biome growth trace and the fix.
2. **Top-10 biggest wins** — highest priority score, the "do these first" list.
3. **Full ranked table** — every finding, sortable by priority.
4. **Grouped backlog** — by subsystem, for systematic execution.

## Success criteria

- Every subsystem **and** lens covered; completeness critic returns dry.
- Teleport-leak root cause **identified with code evidence**.
- Each finding **adversarially verified** (or explicitly flagged speculative), with a concrete fix + impact/effort.
- Output is a **ranked, actionable corpus** the user can execute from, top-down, toward 144fps / instant load.

## Out of scope

- Implementing any fix (separate effort, post-greenlight, item by item).
- Art/asset visual quality (own pipelines).
- New features.
