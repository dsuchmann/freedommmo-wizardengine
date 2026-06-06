# Wang Tile Placement Diagnostics & Fixes

**Goal:** Build an 8-layer diagnostic system into the debug HUD so tile placement issues can be identified per-tile, then fix known issues at each layer.

**Architecture:** Expand the worker's existing `wangDebug` output with per-tile diagnostic data for all 8 layers of the wang tile pipeline. Display structured diagnostics in the HUD when debug mode is active. Use diagnostics to verify and fix each layer.

**Tech Stack:** Vanilla JS, Web Workers, OffscreenCanvas, existing HUD system in canvas-renderer.js.

---

## Part A: Enhanced Debug HUD

### Data Flow

The worker (`worker-chunk-renderer.js`) already computes all tile placement decisions during `renderChunkToBitmap`. Currently it returns:
- `masks` — wangEdgeMask per tile
- `successes` — whether the wang image was found in cache
- `srcs` — the URL that was constructed
- `biomes` — the biome ID

We expand this with additional arrays (all length 4096, one entry per tile in the chunk):

| Array | Type | Description |
|-------|------|-------------|
| `neighbors` | `string[]` | Comma-separated 8-directional neighbor biomes: "N,NE,E,SE,S,SW,W,NW" |
| `transitionDirs` | `string[]` | The transition pair dir used (e.g. "beach_to_ocean"), or empty string |
| `transitionSides` | `string[]` | "from", "to", or "" |
| `cornerMasks` | `number[]` | Raw 4-bit corner mask before CORNER_TO_WANG mapping |
| `variants` | `string[]` | Elevation variant selected: "wang", "wang_25", "wang_50", "wang_100" |
| `cliffLevels` | `string[]` | "NW,NE,SW,SE" cliff levels as comma-separated numbers |
| `interiorUsed` | `boolean[]` | True if BIOME_INTERIOR was used (no transition detected) |
| `cliffOverlayApplied` | `boolean[]` | True if paintCliffOverlay drew something |

### HUD Display

When debug mode is on (`0` key toggle), the HUD shows for the tile under the player:

```
-- L1 Neighbors --
N=ocean NE=ocean E=beach SE=beach S=beach SW=grassland W=ocean NW=ocean

-- L2 Transition --
pair: beach_to_ocean | side: to | nearest: beach_to_ocean

-- L3 Dir --
dir: beach_to_ocean | on disk: yes

-- L4 Mask --
corner: 0b1100 (12) -> wang 3 | NW=from NE=from SW=to SE=to

-- L5 Elevation --
cliff: NW=3 NE=3 SW=2 SE=2 | delta=1 -> wang_25

-- L6 URL --
/assets/.../beach_to_ocean/wang_25/beach_to_ocean__wang_3__v000.png
status: LOADED

-- L7 Interior --
BIOME_INTERIOR[ocean] = deep_ocean_to_ocean/15 | used: no

-- L8 Cliff --
overlay: none
```

This replaces the current wang debug section (which shows mask, src, biome, and success count). The existing chunk-level summary (X/4096 loaded) is preserved at the bottom.

### Performance

- Debug arrays are only populated when debug mode is active (pass a flag from main thread to worker)
- Arrays use primitive types (strings, numbers, booleans) for efficient postMessage transfer
- No impact when debug mode is off

## Part B: Known Fixes Per Layer

### Layer 1: Compass Neighbors
**Problem:** Worker sets `tile.neighborN` etc. on its copy of tile objects. Main thread tiles (received via `chunkSlice` before rendering) never have this data.
**Fix:** Include neighbor data in the expanded `wangDebug` arrays. The HUD reads from wangDebug, not from tile properties.

### Layer 2: Transition Detection
**Problem:** Cannot verify if `transitionPairFor()` fires correctly at biome borders without diagnostics.
**Fix:** Add `transitionDirs` and `transitionSides` to wangDebug. Once visible, walk biome borders to verify detection. If detection fails, the issue is in the neighbor scanning loop (lines 126-138 of worker-chunk-renderer.js).

### Layer 3: Pair Construction & Direction
**Problem:** Some BIOME_INTERIOR dirs pointed at non-existent directories (grassland_to_forest instead of forest_to_grassland). Fixed, but transition pair dirs may also mismatch.
**Fix:** Already corrected BIOME_INTERIOR dirs. For transitions, `transitionPairFor()` constructs the dir dynamically. The diagnostic will show the constructed dir and whether it resolved to a cached image, making mismatches immediately visible.

### Layer 4: Wang Mask Computation
**Problem:** CORNER_TO_WANG was using the old mapping. Updated to `[15,14,...,1,0]` to match PixelLab's encoding (index = NW*8 + NE*4 + SW*2 + SE*1, 1=upper).
**Fix:** Already applied. Diagnostics will show raw cornerMask and mapped wangIndex with corner labels (NW=from/to etc.) for visual verification.

### Layer 5: Elevation Variant Selection
**Problem:** `elevationVariant()` exists but untested. Returns wang/wang_25/wang_50/wang_100 based on max cliff level delta among 4 corners.
**Fix:** Diagnostics will show the 4 cliff levels and which variant was selected. Walk to elevation changes to verify correct variant selection.

### Layer 6: Image Preloading
**Problem:** 2-phase preload may not generate URLs that match what's on disk. URL format must exactly match: `{TRANSITIONS_BASE}{dir}/{variant}/{dir}__wang_{index}__v000.png`.
**Fix:** Diagnostics show the exact URL and LOADED/MISSING status. If MISSING, we can compare against disk to find the mismatch (wrong dir name, wrong index range, wrong filename format).

### Layer 7: Interior Tile Consistency
**Problem:** PixelLab's base tile IDs don't produce visually identical corner tiles across pairs. The "all taiga" tile looks different in beach_to_taiga vs forest_to_taiga. This causes visible seams where interior meets transition.
**Fix:** This is a PixelLab generation issue, not a code issue. Options:
1. Accept the inconsistency (transitions will have subtle color shifts)
2. Use a single canonical pair per biome for ALL rendering (interior and transitions both use the same pair's tiles) — loses transition variety but gains consistency
3. Report to PixelLab as a bug and regenerate once fixed

This is a design decision to make after diagnostics reveal the full scope of the inconsistency.

### Layer 8: Cliff Overlay
**Problem:** CLIFF_CORNER_TO_WANG updated to match PixelLab encoding. Cliff overlay directories may or may not have new tiles.
**Fix:** Diagnostics show whether cliff overlay was applied. Verify cliff overlay dirs exist on disk with tiles.

## Implementation Order

1. **Task 1:** Expand worker debug output with all 8 layers of data
2. **Task 2:** Update HUD display to show structured 8-layer diagnostics
3. **Task 3:** Use diagnostics to walk the map and verify each layer
4. **Task 4:** Fix any issues discovered during verification
5. **Task 5:** Address Layer 7 (interior consistency) based on findings

## Files Affected

- `src/render/worker-chunk-renderer.js` — expand debug data collection
- `src/render/canvas-renderer.js` — expand HUD display
- `src/world/chunk-worker.js` — pass debug flag from main thread
- `src/render/wang-image-list.js` — already fixed BIOME_INTERIOR dirs
- `src/render/worker-tile-painter.js` — already fixed CORNER_TO_WANG and intMask values
- `src/render/tile-painter.js` — already fixed (main thread fallback)
