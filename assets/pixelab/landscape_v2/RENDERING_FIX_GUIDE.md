# Terrain Rendering Fix Guide — For WizardGenie

## Problem: Visible Color Bands Between Interior and Transition Tiles

The rendered map shows visible color shifts where biome interior tiles meet transition edge tiles. This happens because **interior tiles and transition tiles come from different PixelLab generations** with slightly different color palettes.

### Root Cause

In `src/render/tile-painter.js`, `getWangSrc()` (line 69) selects tiles from two different sources:

1. **Edge tiles** — when `tile.transitionPair` is set, uses the transition tileset (e.g., `grassland_to_forest/wang/grassland_to_forest__wang_5__v000.png`)
2. **Interior tiles** — when no transition pair, falls back to `BIOME_INTERIOR` which sources from a *different* transition tileset (e.g., grassland interior comes from `beach_to_grassland` but grassland edges come from `grassland_to_forest`)

The same biome (grassland) rendered from two different PixelLab generations produces subtly different pixel art styles and colors, creating visible seams.

### Secondary Issue: Palette Fill Mismatch

`paintTerrainTile()` (line 91) fills a solid color from `palette.js` *before* overlaying the Wang PNG tile. The Wang PNGs are opaque 32x32 sprites that fully cover the palette fill, so the palette fill is only visible during loading or if images fail. However, the palette colors in `palette.js` don't perfectly match the PixelLab-generated tile colors, which can cause flicker.

---

## Fix 1: Transition-Consistent Interior Tiles (Primary Fix)

**Goal:** When a tile is deep inside a biome but near a transition zone, use the *same* transition tileset for its interior tile as the nearby transition uses.

### Current behavior (causes color bands):
```
grassland interior → uses beach_to_grassland (BIOME_INTERIOR fallback)
grassland near forest → uses grassland_to_forest (transition pair)
```

### Fixed behavior:
```
grassland interior near forest → uses grassland_to_forest wang_12 (from-side interior)
grassland near forest edge → uses grassland_to_forest wang_5 (transition tile)
```

### Changes to `chunk-render-cache.js` renderChunk():

The ±8 radius scan (lines 184-200) already finds the nearest transition pair for deep-interior tiles. The issue is that `getWangSrc()` ignores this pair when `tile.transitionPair` is set but the tile is fully interior (all corners same biome).

**The fix:** When `tile.transitionPair` is set AND the tile's `wangEdgeMask` resolves to the full-interior wang index (wang_12 for "from" side, wang_6 for "to" side), use that transition pair's interior tile instead of `BIOME_INTERIOR`.

In `tile-painter.js`, change `getWangSrc()`:

```javascript
function getWangSrc(tile) {
  var mask = tile.wangEdgeMask;
  if (mask === undefined) mask = 0;
  if (tile.transitionPair) {
    // Use the transition pair's tileset for BOTH edges and interior
    return TRANSITIONS_BASE + tile.transitionPair.dir + '/wang/' 
      + tile.transitionPair.dir + '__wang_' + mask + WANG_SUFFIX;
  }
  // Only fall back to BIOME_INTERIOR when no transition pair found at all
  var interior = BIOME_INTERIOR[tile.biome];
  if (interior) {
    return TRANSITIONS_BASE + interior.dir + '/wang/' 
      + interior.dir + '__wang_' + interior.mask + WANG_SUFFIX;
  }
  return null;
}
```

This already works correctly — the key insight is that the ±8 radius scan in `chunk-render-cache.js` needs to propagate transition pairs far enough that `BIOME_INTERIOR` is rarely used.

**Increase scan radius from 8 to 16** in `chunk-render-cache.js` line 187:
```javascript
for (var dy = -16; dy <= 16 && !foundPair; dy++) {
  for (var dx = -16; dx <= 16 && !foundPair; dx++) {
```

This ensures tiles deep inside a biome still get their transition pair from the nearest boundary, so they use the same tileset as the edges.

### Important: `BIOME_INTERIOR` should match `BIOME_INTERIOR_TILES.md`

The `BIOME_INTERIOR` map in `tile-painter.js` should be updated to match the canonical sources documented in `assets/pixelab/landscape_v2/BIOME_INTERIOR_TILES.md`. Several entries differ:

| Biome | Current in code | Should be (per BIOME_INTERIOR_TILES.md) |
|-------|----------------|----------------------------------------|
| beach | beach_to_desert, mask 6 | beach_to_river, mask 12 (from) |
| forest | swamp_to_forest, mask 12 | grassland_to_forest, mask 12 (to=6) |
| dense_forest | swamp_to_dense_forest, mask 12 | forest_to_dense_forest, mask 12 (to=6) |
| taiga | swamp_to_taiga, mask 12 | forest_to_taiga, mask 12 (to=6) |
| hills | desert_to_hills, mask 12 | grassland_to_hills, mask 12 (to=6) |
| lake | lake_to_swamp, mask 6 | lake_to_river, mask 12 (from) |

**Note on mask values:** In PixelLab Wang tilesets:
- `wang_12` = all 4 corners are the "from" biome (biome A interior)
- `wang_6` = all 4 corners are the "to" biome (biome B interior)

So `mask: 12` means this biome is the "from" biome in that tileset, `mask: 6` means it's the "to" biome.

---

## Fix 2: Remove Palette Color Fill (Quick Win)

Since Wang tiles are opaque 32x32 PNGs that fully cover the tile, the palette `fillRect` on line 104 is invisible in normal rendering. It only shows during image loading.

**Option A — Remove the fill entirely:**
```javascript
export function paintTerrainTile(ctx, tile, sx, sy, size, sun, focusElevation, compositor, timeSeconds, atlas) {
  // Skip palette fill — wang tiles are opaque and cover the full tile
  paintWangBase(ctx, tile, sx, sy, size);
}
```

**Option B — Keep fill as loading fallback but match it to the wang tile colors:**
Extract dominant colors from each Wang interior tile and update `palette.js` to match. This is more work but prevents flash-of-wrong-color during load.

---

## Fix 3: Blending at Transition Boundaries (Advanced)

If color bands persist even after Fix 1, apply alpha blending at the boundary between two transition tilesets.

### Approach: Feathered Alpha at Tileset Boundaries

When a tile switches from one transition tileset to another (e.g., from `grassland_to_forest` to `grassland_to_hills`), blend the two tiles with an alpha gradient.

In `paintTerrainTile()`, after drawing the primary wang tile:

```javascript
// If this tile is at a tileset boundary (adjacent tile uses different transitionPair.dir)
if (tile.tilesetBoundary) {
  ctx.save();
  ctx.globalAlpha = tile.tilesetBlendAlpha; // 0.0-0.5 based on distance from boundary
  // Draw the adjacent tileset's interior tile on top
  var altSrc = getAlternateWangSrc(tile);
  if (altSrc) {
    var altImg = wangImgCache[altSrc];
    if (altImg && altImg.complete && altImg.naturalWidth) {
      ctx.drawImage(altImg, 0, 0, 32, 32, sx, sy, size, size);
    }
  }
  ctx.restore();
}
```

This is optional and should only be attempted if Fix 1 alone doesn't resolve the visible bands.

---

## Fix 4: Cliff Overlay Tiles (Elevation Changes)

For same-biome elevation changes, 14 cliff tilesets have been generated in `assets/pixelab/landscape_v2/transitions/`. They use the same Wang corner system but encode elevation instead of biome.

See `ELEVATION_CLIFF_DESIGN.md` for full design. Key rendering addition:

After drawing biome tiles and transitions, add a cliff overlay pass:

```javascript
// In renderChunk(), after paintTerrainTile and paintTerrainFeatures:
if (tile.climate.elevation !== undefined) {
  var cliffMask = 0;
  var nwElev = (tileAt(wx - 1, wy - 1) || tile).climate.elevation;
  var neElev = (tileAt(wx + 1, wy - 1) || tile).climate.elevation;
  var swElev = (tileAt(wx - 1, wy + 1) || tile).climate.elevation;
  var seElev = (tileAt(wx + 1, wy + 1) || tile).climate.elevation;
  var threshold = 0.15; // elevation difference to trigger cliff
  if (nwElev - tile.climate.elevation > threshold) cliffMask |= 8;
  if (neElev - tile.climate.elevation > threshold) cliffMask |= 4;
  if (swElev - tile.climate.elevation > threshold) cliffMask |= 2;
  if (seElev - tile.climate.elevation > threshold) cliffMask |= 1;
  if (cliffMask > 0) {
    var cliffWang = CORNER_TO_WANG[cliffMask];
    var cliffDir = getCliffDirForBiome(tile.biome); // e.g., 'grass_cliff'
    var cliffSrc = TRANSITIONS_BASE + cliffDir + '/wang/' + cliffDir + '__wang_' + cliffWang + '__v000.png';
    var cliffImg = wangImgCache[cliffSrc];
    if (cliffImg && cliffImg.complete && cliffImg.naturalWidth) {
      ctx.drawImage(cliffImg, 0, 0, 32, 32, sx, sy, size, size);
    }
  }
}
```

### Available cliff tilesets by biome:
| Biome | Cliff Dir |
|-------|-----------|
| grassland, forest | grass_cliff |
| beach | beach_cliff |
| desert, savanna | sand_cliff |
| arctic, tundra | snow_cliff |
| hills, mountains | stone_cliff |
| volcanic | volcanic_cliff |
| swamp | swamp_cliff |
| steppe | steppe_cliff |
| mystic | mystic_cliff |
| forest, dense_forest, taiga, tropical_forest | forest_cliff |
| generic fallback | cliff_overlay |

---

## Rendering Order (Complete)

1. ~~Palette color fill~~ (remove or keep as loading fallback only)
2. Wang biome tile (interior or transition, from same tileset per Fix 1)
3. Cliff overlay tile (if elevation difference detected, per Fix 4)
4. Terrain features (`paintTerrainFeatures`)
5. Surface overlays (scatter decals — future)
6. Objects (trees, rocks, structures)

---

## Priority Order

1. **Fix 1** — Transition-consistent interiors. Biggest visual impact, eliminates most color bands.
2. **Fix 2** — Remove palette fill. Quick win, prevents color flash.
3. **Fix 4** — Cliff overlays. Adds elevation readability.
4. **Fix 3** — Alpha blending. Only if bands persist after Fix 1.

---

## Key Files to Modify

- `src/render/tile-painter.js` — `BIOME_INTERIOR` map, `getWangSrc()`, `paintTerrainTile()`
- `src/render/chunk-render-cache.js` — scan radius in `renderChunk()`, cliff overlay pass
- `src/render/palette.js` — update colors to match wang tiles (optional, for Fix 2B)

## Reference Documents

- `assets/pixelab/landscape_v2/WANG_TILE_MAPPING.md` — Corner-to-wang lookup table
- `assets/pixelab/landscape_v2/BIOME_INTERIOR_TILES.md` — Canonical interior tile sources
- `assets/pixelab/landscape_v2/ELEVATION_CLIFF_DESIGN.md` — Cliff system design
