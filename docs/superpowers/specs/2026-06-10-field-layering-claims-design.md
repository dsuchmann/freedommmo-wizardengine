# Cross-Field Claim System & Field 3 Integration — Design

**Date:** 2026-06-10
**Status:** Approach approved by user (Approach A); F3 static-bake default accepted
**Context:** Decoration master plan `2026-06-07-decoration-field-master-plan.md`

## Problem

Fields 0-2 built the ground substrate bottom-up. From Field 3 upward (scatter, medium flora,
medium objects, trees, canopy — and later roads, buildings, characters' static props), objects
*intermingle*: a Field 2 grass blade must not sprout through a Field 3 bone pile or under a
Field 5 boulder. Today each field places independently:

- F2 (small flora): main-thread `field2-animator.js`, deterministic hash per tile, no occupancy.
- F3 (small scatter): worker `applySmallScatterToChunk()` already places + bakes debris with a
  *private* occupancy grid — invisible to F2 and everything else.
- F4-F7: not placed yet. F5/F6 footprints (8-40px) will span tile borders.

## Approach (A — shared deterministic claim module)

All placement is already a pure function of world coordinates (`rand2(wx, wy, seed)`), so the
worker and the main thread can compute identical results independently — no message passing,
no cache invalidation, no chunk coupling.

### New module: `src/world/decoration-claims.js`

Pure, importable from both the worker (`worker-chunk-renderer.js`) and main thread
(`field2-animator.js`). Two responsibilities:

1. **Placement source of truth.** Per-field placement functions are extracted/centralized here,
   starting with `f3Placements(wx, wy, biomeId) → [{ux, uy, objIdx, variant, state, scale}]`
   (ux/uy = continuous tile-unit offsets). The worker painter consumes this list to draw; the
   claim resolver consumes the same list to mask. One function, two consumers — placement and
   claims can never disagree. Higher fields (F4, F5, F6, architecture) add their own placement
   functions here as they come online.

2. **Claim resolution.** `getClaimMask(wx, wy) → Uint8Array(8)` — an 8×8 bit-per-cell mask of
   the tile's claimed sub-cells. Resolution is top-down by priority:

   `architecture (future) > F6 > F5 > F4 > F3`

   For tile T, scan tiles within radius R (R=2 tiles, covering the largest F6 base footprint)
   and rasterize each neighbor placement's **base footprint** into T's 8×8 grid. Each field
   level, when placing, first checks the mask accumulated from *higher* levels only — so debris
   never spawns under a tree trunk, but a tree may rise out of debris it was placed before.

### Base footprints (not sprite bounds)

Objects claim the ground their *base* occupies, not their full sprite:

| Field | Base footprint (art px, ellipse at sprite base) |
|---|---|
| F3 scatter | 0.55 × drawSize wide, 0.30 × drawSize tall |
| F4 medium flora | 0.50 × drawSize wide, 0.25 × drawSize tall |
| F5 medium objects | 8-16 px per object class |
| F6 trees | trunk only: ~0.25 × sprite width |
| F7 canopy | claims nothing (overhead) |

A tree's canopy casts no claim — grass grows under foliage, just not through the trunk.

### F2 integration

In `buildTileDescriptor` (field2-animator.js), after rolling a blade's position, test its base
point against `getClaimMask(wx, wy)`; claimed cell → skip the blade. Point test, one AND per
blade. The existing tile-descriptor cache keeps the cost amortized to first visit.

### F3 integration

- `applySmallScatterToChunk` switches from its private occupancy grid to
  `f3Placements()` + the shared mask (checking F4+ claims when those exist; today, none — its
  behavior change is only that its placements become *visible* to F2).
- **Rendering stays statically baked** into the chunk bitmap (user-approved default). Lifecycle
  **states** join as variant pools: per placement, hash-roll state (e.g. 78% base variant,
  22% spread across that object's available state PNGs under `_states/`). Generated animations
  are shelved for a later "live objects" pass.
- Density/spacing per master plan: 5-15%, 8×8 grid, max ~2 objects/tile (raised from 1 now that
  claims prevent ugly stacking).

### Draw-order contract (user requirement: "draw order must be perfect")

1. **Within F3 (baked):** the worker collects ALL placements for the chunk (+1-tile apron from
   neighbor data) first, sorts by base Y (`drawCenterY + drawSize/2`), and draws in that order.
   This replaces today's raster tile-order drawing, where jitter can stack a *nearer* pebble
   under a *farther* one. The shared module's self-spacing also works across chunk borders
   (today's occupancy grid is chunk-local — border overlaps are currently possible).
2. **F2 over F3:** runtime F2 sprites always draw above the chunk bitmap. This is *correct by
   construction*: F3 is flat ground debris (≤ half-tile visual height), and claims guarantee a
   blade's root is never inside a footprint — so any blade overlapping debris is physically
   beside/in front of it, and "grass in front of pebble" is the right read. The claim ellipse
   includes a small margin so roots can't sit right at a silhouette edge.
3. **Anything with real height is not F3.** Objects tall enough to need true y-sorting against
   flora and the player (F4 flowers upward) go on the sprite path with the existing single
   y-sorted instance batch (field2-animator already sorts F2 + player in one domain; F4-F6
   join that batch in their own plans). F7 canopy draws above everything.
4. **Seed compatibility:** `f3Placements` keeps the existing 9500-series seeds, so already-baked
   world placements don't shift — only ordering, spacing, and claims change.

### Caching & performance

- Memoize `f3Placements` and `getClaimMask` in size-capped Maps keyed `'wx,wy'` (deterministic →
  never invalidated, only evicted). Worker and main thread each keep their own cache.
- Claim resolution touches (2R+1)² = 25 neighbor tiles on first query; with memoized placements
  this is array math only. F2 already does ~50 `rand2` calls per tile descriptor; this adds a
  comparable one-time cost per tile.

### Extensibility (the F4→architecture story)

Each future layer registers a placement function and a priority. Roads/buildings will be the
highest priority claim source and can also *mask out entire cells of all fields* (no flora in a
road). Characters/NPCs are dynamic and never claim — they y-sort with F6.

## Testing

- Unit (node): determinism — `f3Placements`/`getClaimMask` identical across repeated calls and
  across simulated worker/main contexts; footprint rasterization claims expected cells; F3
  placements respect each other (no >40% overlap regression).
- Playwright visual: grassland/forest scene — no F2 blade base inside an F3 footprint
  (programmatic check via exposed debug hook `window._claims.check(wx,wy)`); F3 debris visible
  at expected density; chunk borders show F3 objects uncut.
- Perf: chunk compile time before/after within noise; F2 descriptor build unchanged order of
  magnitude.

## Non-goals

- F4-F7 placement implementation (each is its own later plan; they only get claim *slots* here).
- F3 animations / live-object pass.
- Collision/walkability (claims are visual placement only — gameplay collision is separate).
