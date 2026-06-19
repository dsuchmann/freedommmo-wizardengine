# Integration Contract — Diegetic Building Interiors via the Chunk Pipeline

**For:** the roof/chunk-bake developer (owner of `worker-chunk-renderer.js`, `building-tile-query.js`, `tools/roof/`, the GL compositor).
**From:** the building-interior work (data model + `active-interior` state + `resolveFloorLayout`).
**Date:** 2026-06-18 · **Branch:** `motion-eval-system`

## Why this exists
We're building **diegetic walk-in interiors**: the player walks into a building (no click, no loading screen), the building's **current floor** renders **in the world** with the character on top, they walk to the stairs/lift to change floors, the roof is off, the outside dims (black in basements, receding/bokeh as you climb).

My first attempt rendered the interior as a **main-thread 2D overlay** on top of the composited frame. That was wrong and it shows: player-under-floor, no night lighting, squished walls, and the **baked roof still occludes the player**. The codebase already says why — building floors were *disabled* from the main-thread pass (`canvas-renderer.js:331-335`) with the note that they *"need to be integrated into the chunk compilation pipeline so they share the same lighting, z-order, and pixel grid as terrain."* The ground floor and roof are **already** baked in your worker. So the interior belongs in **your pipeline**, not a separate overlay — that's the only way it gets lighting / day-night / CRT / GPU / z-order for free.

This contract proposes the smallest change to your pipeline to make that happen, plus exactly what I own on the main thread.

---

## The split

### My side (main thread — already built or I'll build)
- `src/render/active-interior.js` — tracks which building + floor the player is inside: `getActiveInterior()` → `{ building, bx, by, floorIndex, layout, footprint, doors } | null`, `isInside()`. (Done.)
- `sim/world/buildings/floor-layout.js` — `resolveFloorLayout(node, floorIndex)` → `{ walkable:Set<'x,y'>, units:[{unitKind,tiles,doorTile}], stairTile, liftTile, bounds }`, all **footprint-LOCAL** (world = `b.x + localX`). Deterministic, lazy. The worker can call this itself (it regenerates buildings in-process via `building-tile-query`).
- The walk-in / walk-onto-stairs / collision triggers (`main.js`, `movement.js`). (Done.)
- **Plumbing:** put `activeInterior` into the per-chunk render request, and **trigger a re-bake** of the chunks overlapping the active building on enter / exit / floor-change. I'll wire this to whatever cache-invalidation entry point you point me at.
- **Screen-space effects:** the outside **dim / height-recede / basement-black** and the **player-relative wall see-through** are screen-space, not per-chunk — see "Open question 3."

### Your side (worker / chunk bake)
Two changes, both keyed to one new request field:

**1. New per-chunk-render-request field:** `activeInterior: { bx:number, by:number, floorIndex:number } | null` (null = nobody inside; bake as today). I'll set it from `getActiveInterior()`.

**2. When baking a chunk that overlaps the active building** (`rb.x === activeInterior.bx && rb.y === activeInterior.by`):
   - **(a) Skip its roof.** At `worker-chunk-renderer.js:1473-1484`, skip `_roofEngine.drawRoofForBuilding(...)` for the matching building. (Other buildings keep their roofs.)
   - **(b) Bake the current floor's interior instead of the flat ground footprint.** Today `building-tile-query.js` `cachedLayout` builds a ground-floor `floorIndex` map from `footprint.sections`. For the active building, bake `resolveFloorLayout(b.footprint.node, activeInterior.floorIndex)` instead: the floor tiles (`walkable` + every `units[].tiles`, with per-unit/material fill) and the interior unit-division walls. For **non-active** buildings, nothing changes.

**3. Re-bake on change.** When `activeInterior` changes (enter / exit / floor-change), the chunks overlapping that building must re-render so the roof disappears/reappears and the floor swaps. I'll request this from the main thread — I just need the cache-invalidation/re-render entry point for "these chunk coords are dirty" (reuse `ChunkRenderCache`, don't full-repaint).

---

## Why this is the right shape
- The baked interior floor lands on the **same layer as terrain** → the player sprite (depth-sorted in the F2/GL system) draws **on top of it**, lit and CRT'd, with no 2D-overlay fight.
- The roof-skip is **per-building** and only while someone's inside — your default roof path is untouched.
- The interior is **deterministic** (`resolveFloorLayout` is pure `f(seed, node, floorIndex)`), so the bake is cacheable exactly like terrain.

---

## Open questions for you (these need your pipeline knowledge)

1. **Walls + player occlusion + see-through.** Building **walls** must occlude the player when appropriate (player behind a north wall) but become **see-through in a soft circle around the player** (esp. the south wall) so the character is never hidden. A *baked* wall (flat in the chunk bitmap, drawn before the player) can't do per-frame player-relative see-through. So: are walls baked, or are they depth-sorted sprites / a separate layer? If baked, can we put them on a layer that a present-time radial mask (centered on the player) can cut a soft hole in? **This is the crux of the "spotlight see-through" the user wants** — I need your read on where walls live.

2. **Request payload.** Where do I add `activeInterior` to the per-chunk render request without colliding with your in-flight chunk-integration TODO (`canvas-renderer.js:331-335`)? Is there an existing per-request options object?

3. **Screen-space dim / recede / basement-black.** The "outside dims (black underground, recedes into bokeh + clouds as you climb)" is a **screen-space** effect keyed to `floorIndex`, masking everything **except** the active building's footprint. Should this live in your **GL present/post shader** (so it's CRT-correct and unified), or is a main-thread 2D mask acceptable for now? I can drive it either way; I'd prefer the present shader so it composes with day-night/CRT.

4. **Cache invalidation API.** The exact call to mark the active building's chunks dirty + re-render (so I trigger it on enter/exit/floor-change).

5. **Z-order confirmation.** Confirm the player sprite depth-sorts **above** the baked interior floor and **below** baked walls (or the sprite-wall layer), so it reads as standing inside the room.

---

## Data you can rely on from me
- `getActiveInterior()` / `isInside()` (`src/render/active-interior.js`) — the single source of "who's inside, which floor."
- `resolveFloorLayout(node, floorIndex)` (`sim/world/buildings/floor-layout.js`) — the floor's walkable/units/stair/lift, footprint-LOCAL. Pure + lazy; safe to call in the worker.
- `b.footprint.node` — the lazy `BlueprintNode` (already in-process in the worker via `building-tile-query`); `node.payload.lift`, `floorRange`, `stairCores`.

## What I will NOT touch
`worker-chunk-renderer.js`, `building-tile-query.js`, `tools/roof/`, the GL compositor — yours. I'll provide the state + the floor-layout + the plumbing + the screen effects and integrate against whatever hooks you expose.

## Interim (already shipped, safe)
Until this lands, walking into a building does a **main-thread 2D dim + stair/lift markers** (character stays visible, basement dims to black). It's not pipeline-correct (no lighting) but it's non-breaking and lets the floor-change interaction be tested.
