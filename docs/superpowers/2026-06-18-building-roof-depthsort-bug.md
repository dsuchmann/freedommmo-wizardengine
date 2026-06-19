# Bug Report — Adjacent-Building Depth Order + Roof Over-Extent

**For:** the roof/chunk-bake developer (`worker-chunk-renderer.js`, `canvas-renderer.js` chunk composite, `tools/roof/*`).
**From:** the building-data/interior work (diagnosis only — these are your files; I did not edit them).
**Repro:** two close N–S adjacent buildings. The **front (south)** building's tall north wall + roof draw **under** the back (north) building (should be front-over-back), and the front roof's pitch **over-extends north** across the gap up to the back building's south wall.

These are **two independent root causes.**

---

## Bug 1 — Front-under-back depth inversion

**Root cause:** walls + roofs are baked **per-chunk** with only an *intra-chunk* south-edge Y-sort (`worker-chunk-renderer.js:1324-1336` — `cBuildings.sort((a,b)=> (a.y+a.footprint.boundingBox.h) - (b.y+b.footprint.boundingBox.h))`; the comment there explicitly disclaims cross-chunk ordering). But the **chunk bitmaps** are composited to screen in **player-distance** order, **not** Y order: `canvas-renderer.js:286-293` builds `chunkJobs` in grid order and sorts only by `job.dist = |cx-playerCX|+|cy-playerCY|` (line 290 / sort line 293), then blits 294-306.

A south building's tall elements (wall ~4 tiles, roof lifted ~7 tiles) paint into pixels that belong to the **north** chunk's bitmap. Whichever chunk blits last wins — so when the north chunk is equal/closer in player distance (a tie, or the player is north), it paints the back building **over** the front building's tall elements. An intra-chunk sort can't fix an inter-chunk inversion: the two buildings live in different bitmaps flattened before they can interleave.

**Fix (preferred, small):** composite chunks **back-to-front by Y**, not distance. In `canvas-renderer.js:293`:
```js
chunkJobs.sort((a, b) => (a.cy - b.cy) || (a.cx - b.cx)); // north chunks blit before south
```
Keep the "render ≤1 new chunk per frame" generation budget, but the **blit** order must be Y-sorted every frame so an already-cached south chunk always paints over a cached north chunk. This covers both the 2D and GL present paths (GL uses `glc.drawChunk` at `:303`, same blit loop).

*Alt (if blit order is LOD-locked):* bake each building's walls+roof only into the chunk owning its **south edge**, and add a global Y-sorted tall-element overlay pass on the main thread after all chunks (sorted by `b.y + bb.h` across all visible buildings).

---

## Bug 2 — Roof over-extends north into the neighbor

**Root cause:** the north pitch is clamped only to the building's **own** depth, never the neighbor gap. `roof-ingame.js:97-98` → `depthCapTiles = max(0.6, bbox.h/2 - 0.5)`, `riseTiles = min(maxRoofTiles, depthCapTiles)` — own bbox only. Plus `roof-geometry.js:85-89` grows the roof grid uniformly by the overhang ring **in all four directions** (`+ovh`, default 1 → one tile north of the footprint). `noNorthOverhang` (set true at `roof-ingame.js:61`) only skips the north **eave droop** tiles (`roof-geometry.js:170-173`), never the interior slope/ridge. So a deep south building's full-pitch ridge climbs north across a 1-tile gap to the neighbor's south wall.

**Fix:** add a **neighbor-distance clamp** in `roof-ingame.js drawRoofForBuilding` (~94-98). Probe north of the footprint's north edge via the existing `getBuildingsNearChunk()`/`queryBuildingTile()` (`building-tile-query.js`) until a building tile or a small max gap (≈4) → `gapTiles`, then:
```js
depthCapTiles = Math.min(Math.max(0.6, bbox.h/2 - 0.5), Math.max(0.6, gapTiles - 0.5));
```
so a 1-tile-north neighbor drops the rise to ~0.5 tile. Also trim the north grid column when a neighbor is within the overhang ring (extend `noNorthOverhang` to clip the interior north tile, not just the eave). The **height clamp is load-bearing**; the grid trim removes the residual 1-tile bleed.

---

## Why it's the hard one
True top-down painter's-algorithm draws all entities back-to-front by Y in one pass. Here that's broken at two levels: (1) tall elements occupy screen space far north of their footprint tile, so their correct order is set by the south edge but they paint into a northern chunk's pixels; (2) the renderer bakes into independent per-chunk bitmaps and composites them by **distance**, so the only globally-respected ordering uses the wrong key. The robust fix is **Bug 1 Fix A** (Y-sort the chunk blit) **and** **Bug 2** (geometrically keep roofs out of the neighbor).

**Validate:** two houses one tile apart on a N–S chunk boundary; walk the camera north past them — front roof must stay over back wall in both 2D and GL paths.

## Key files
`worker-chunk-renderer.js:1324-1336,1473-1484` · `canvas-renderer.js:286-306` · `building-tile-query.js:205-226,233+` · `tools/roof/roof-ingame.js:91-104` · `tools/roof/roof-geometry.js:85-89,170-173` · `wall-config.js:7-10` · `resolved-buildings.js:87-142`
