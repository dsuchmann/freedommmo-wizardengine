# Integration Contract — Exterior Façade Stacking (multi-story buildings look multi-story)

**For:** the roof/chunk-bake developer (owner of the worker wall bake `worker-chunk-renderer.js`, `building-tile-query.js`, `wall-config.js`, `tools/roof/`).
**From:** the building-data work. **Goal:** a building with `aboveGroundFloors = N` renders an exterior **N stories tall** — stacked wall + a window row per floor — instead of the current flat one-story footprint. *"A five-story building must not look like a one-story building."*

## The problem
Walls bake at a **fixed height** — `wall-config.js: wallHeight = 4` (tiles), used uniformly in the worker wall post-pass and `building-renderer.js`. So a 1-story house and a 10-story tower render identical-height exterior walls. The building's real height is already known in the data; the renderer just isn't reading it.

## Data you can rely on from me (already in-process in the worker via `building-tile-query`)
- `b.footprint.node.payload.aboveGroundFloors` — the story count (≥0 floors). **This is the wall-stack height in floors.**
- `…payload.floorRange = [min, max]` — `min < 0` ⇒ basements (don't add exterior stories for basements; they're below grade).
- `…payload.lift` (present ⟺ `aboveGroundFloors > 3`) and `…stackPlan[i].use` per floor — useful if you want per-band façade variety (shopfront ground vs residential upper), optional for v1.
- **Per-floor façade bands (now a real, tested function):** `facadeBands(b.footprint.node.payload)` in `sim/world/buildings/facade.js` → `[{ index, use, window, door }]` bottom→top, one per **above-ground** story (basements excluded). Story `0` carries the entrance (`door: true`); `window` ∈ `shop | residential | grand | arched | slit | none | plain` by the floor's use. Use this to vary the stacked windows per story (shopfront ground, residential windows above) instead of a uniform box — no need to invent per-floor patterns yourself.

## What v1 needs (worker wall bake)
1. **Height = stories.** Replace the fixed `wallHeight` for a building's exterior wall with `wallHeight * aboveGroundFloors` (each story = one `south_base` 32×128 sprite stacked vertically). The wall now rises `~4 * aboveGroundFloors` tiles in screen space.
2. **A window row per floor.** Stack a `window_128` band per story (the existing window/door logic, repeated per floor). Keep the **door on the ground story only**; upper stories get windows.
3. **Ground vs upper.** Ground story keeps doors/shopfront; upper stories are windows (read `stackPlan[i].use` if you want shopfront-vs-residential bands, else uniform).
4. **North/E/W walls** stack to the same height so the box reads as a solid N-story building from the 3/4 camera.

## Hard prerequisite — depth sort
Taller stacked walls extend **much further north** in screen space (a 10-story wall is ~40 tiles tall), so they cross **many more chunks**. The existing adjacent-building depth inversion (see `docs/superpowers/2026-06-18-building-roof-depthsort-bug.md`) gets dramatically worse with stacking. **Land the chunk Y-sort fix (Bug 1 Fix A) before/with stacking**, or tall buildings will draw through their neighbors badly.

## Consistency with the interior
The exterior story count (`aboveGroundFloors`) **must match** the interior floors the player walks (`resolveFloorLayout` floors over `floorRange`). They read from the same node, so they're consistent by construction — just don't hardcode a different height anywhere.

## Out of scope for v1 (later)
Per-floor setbacks, balconies, façade archetypes per race/type, roof cap matching the stacked height (the roof should sit on top of the **stacked** wall, not the 1-story wall — coordinate the roof lift with the new height).

## What I provide / won't touch
I provide the data (`aboveGroundFloors`, `floorRange`, `stackPlan`, façade bands) on the node. I won't touch the worker bake or `wall-config.js` — yours. Ping me if you want a helper that returns the per-floor façade band for a building.
