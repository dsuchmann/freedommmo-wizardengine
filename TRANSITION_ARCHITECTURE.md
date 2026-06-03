# FreedomMMO Terrain Wang Tile System — Architecture & State

## Current State (2026-06-03)

### What's Working
- **Swamp/Beach transitions**: edges, corners, and interior fillers rendering correctly using `swamp_to_beach` Wang tiles
- **Generic transition registry**: 55+ transition pairs mapped to directory names
- **All 21 biomes**: base Wang tiles preloaded and available
- **Edge detection**: immediate neighbor + small radius scan finds transition context
- **Filler masks**: "from" side gets `wang_6`, "to" side gets `wang_12`
- **Map-level adjacency**: diagnostic scans loaded chunks to determine which transition pairs exist on map
- **Performance**: terrain cache 160 chunks, one new chunk per frame, no stuttering

### What's Missing
- **beach_to_river** Wang tiles — Claude needs to generate (directory may exist but needs verification)
- **swamp_to_taiga** Wang tiles — user says downloaded, needs registry entry
- **Water walkability** — water biomes set to `walkable: false`, user wants swimming

## Core Architecture

### Files

| File | Role |
|------|------|
| `src/render/tile-painter.js` | Draws Wang tiles on terrain. Contains `getWangSrc()`, `paintWangBase()`, `BASE_WANG_PREFIX` map, image preloading |
| `src/render/chunk-render-cache.js` | Chunk cache + render orchestrator. Contains `TRANSITION_PAIRS` registry, `transitionPairFor()`, edge mask computation, `renderChunk()` |
| `src/render/canvas-renderer.js` | Main renderer. Contains transition diagnostic, HUD display |
| `src/world/biome-definitions.js` | Biome properties (walkable, material, color) |
| `src/core/constants.js` | World constants (chunkSize=64, tileSize=32, loadRadius=1) |
| `src/camera.js` | Camera zoom (default 1.95, max 2.4) |

### Asset Directories

| Path | Contents |
|------|----------|
| `assets/pixelab/landscape_v2/base/` | 22 biome base Wang directories (arctic, beach, desert, forest, grassland, hills, lake, mountains, mystic, ocean, deep_ocean, river, savanna, shallow_water, steppe, swamp_mud_pool, swamp_wet_mud, taiga, tropical_forest, tundra, volcanic) |
| `assets/pixelab/landscape_v2/transitions/` | 55+ transition pair directories, each with `wang/` subdirectory containing 16 Wang tiles (0-15) |
| `assets/generated/` | Placeholder sprites — **removed from loading** via empty atlas defs |

### Wang Tile Files

Each transition directory follows this pattern:
```
transitions/swamp_to_beach/wang/swamp_to_beach__wang_0__v000.png  (interior)
transitions/swamp_to_beach/wang/swamp_to_beach__wang_1__v000.png  (edge N)
...
transitions/swamp_to_beach/wang/swamp_to_beach__wang_15__v000.png (island)
```

Base biome directories follow:
```
base/swamp_wet_mud/wang/swamp_wet_mud__wang_0__v000.png
...
base/swamp_wet_mud/wang/swamp_wet_mud__wang_15__v000.png
```

### Wang Mask Convention

**Bits: N=1, W=2, E=4, S=8** — bits represent DIFFERENT edges

Corner rules (calibrated):
- SW corner diff → sets W+S bits
- NE corner diff → sets N+E bits
- NW diff + N same → N only, clears W
- W+S+SW all diff → clear W (leave S=8)

### Transition Registry

Key format: `"biomeA|biomeB"` (alphabetically sorted)
```
TRANSITION_PAIRS = {
  "swamp|beach": { from: "swamp", to: "beach", dir: "swamp_to_beach" },
  ...
}
transitionPairFor(a, b) → returns matching pair or null
```

### Render Flow

1. `canvas-renderer.js` → calls `chunkRenderCache.get(chunk, sun, chunkStore)`
2. `chunk-render-cache.js` → `renderChunk()`:
   - Computes 8 neighbor biomes via `tileAt()` (cross-chunk via `chunkStore.getIfReady`)
   - Finds transition context (immediate neighbor → fallback via preferredPairs from diagnostic)
   - Computes Wang edge mask with corner rules
   - Calls `paintTerrainTile()` for each tile
3. `tile-painter.js` → `paintTerrainTile()`:
   - Draws biome color base
   - Calls `paintWangBase()` which uses `getWangSrc()` to select correct Wang tile
   - `getWangSrc()`: if `tile.transitionPair` exists → use transition directory; else → use base biome directory
   - Filler logic: interior tiles (no cardinal edge diff, or 'to' side corner-only) → `wang_6`/`wang_12`

## PixelLab Generation Pipeline

### For Claude / PixelLab Agent

When generating transition tile sets:

1. **Directory**: `assets/pixelab/landscape_v2/transitions/{biomeA}_to_{biomeB}/wang/`
2. **Files**: 16 PNGs, `{name}__wang_0__v000.png` through `{name}__wang_15__v000.png`
3. **Resolution**: 32×32 pixels per tile
4. **Layout**: Standard Wang tile layout (0=isolated, 15=full interior, edges 1-14)
5. **Naming**: Double underscore before `wang_` e.g. `swamp_to_beach__wang_3__v000.png`
6. **Reference**: Copy tile layout from existing `swamp_to_beach` tileset

### To Register New Transitions

After generation, add to three places:

1. **`src/render/chunk-render-cache.js`** → `TRANSITION_PAIRS` object:
   ```js
   "swamp|taiga": { from: "swamp", to: "taiga", dir: "swamp_to_taiga" },
   ```

2. **`src/render/tile-painter.js`** → `transKeys` preload array:
   ```js
   'swamp_to_taiga',
   ```

3. **`src/render/canvas-renderer.js`** → `available` Set in `transitionDiagnosticData`:
   ```js
   'swamp|taiga',
   ```

## Remaining TODOs

1. Add `beach|river` and `swamp|taiga` to diagnostic available Set
2. Preload `beach_to_river` and `swamp_to_taiga` Wang images
3. Change water biomes from `walkable: false` to `walkable: true` with `movementCost: 2-3`
4. Add player visibility marker
5. Generate missing transition sets via PixelLab (beach↔river, swamp↔taiga)
6. Apply transition system to all biome pairs that exist on the map

## Git

- **Repo**: `https://github.com/dsuchmann/freedommmo-wizardengine`
- **Branch**: `master`
- **Checkpoint**: `bc11260a` — "Checkpoint: swamp/beach transitions working, diagnostic live for all biomes"
