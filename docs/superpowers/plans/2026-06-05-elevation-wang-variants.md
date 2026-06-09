# Elevation-Based Wang Tile Variant Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Select the correct wang tile elevation variant (wang/, wang_25/, wang_50/, wang_100/) based on the elevation delta between adjacent tiles, so terrain transitions show flat blends, subtle ledges, medium cliffs, or full cliff faces depending on actual elevation change.

**Architecture:** The existing `cliffLevel()` function (floor(elevation*10) → 0-9) already discretizes elevation into 10 levels. We compute the max cliffLevel delta across a tile's 4 wang corners (self, east, south, southeast) and map that to one of 4 wang subdirectories. The change flows through `getWangSrc()` which currently hardcodes `/wang/` — it will receive the elevation variant suffix and construct the correct path. `getAllWangImageURLs()` must also generate URLs for all 4 subdirectories so workers preload them.

**Tech Stack:** Vanilla JS, Web Workers, OffscreenCanvas

---

## File Structure

| File | Change | Responsibility |
|------|--------|---------------|
| `src/render/wang-image-list.js` | Modify | Add `WANG_VARIANTS` array, update `getAllWangImageURLs()` to emit URLs for all 4 subdirectories |
| `src/render/worker-tile-painter.js` | Modify | Update `getWangSrc()` to accept elevation variant and build path with correct subdirectory |
| `src/render/worker-chunk-renderer.js` | Modify | Compute elevation variant per tile from corner cliffLevel deltas, pass to paint functions |

Only 3 files change. No new files needed.

---

### Task 1: Add wang variant constants and URL generation for all 4 subdirectories

**Files:**
- Modify: `src/render/wang-image-list.js`

Currently `getAllWangImageURLs()` only generates URLs for `wang/` subdirectories (16 tiles each). It needs to also generate URLs for `wang_25/`, `wang_50/`, and `wang_100/` (16 tiles for wang_25/50, 25 tiles for wang_100).

- [ ] **Step 1: Add WANG_VARIANTS constant and export it**

In `src/render/wang-image-list.js`, after the `WANG_SUFFIX` declaration (line 4), add:

```javascript
var WANG_VARIANTS = ['wang', 'wang_25', 'wang_50', 'wang_100'];
var WANG_VARIANT_TILE_COUNTS = { wang: 16, wang_25: 16, wang_50: 16, wang_100: 25 };
```

Update the export line (line 64) to include the new constants:

```javascript
export { WANG_SUFFIX, TRANSITIONS_BASE, BIOME_INTERIOR, BIOME_CLIFF, EXTRA_TRANSITION_DIRS, WANG_VARIANTS, WANG_VARIANT_TILE_COUNTS };
```

- [ ] **Step 2: Update getAllWangImageURLs() to emit URLs for all 4 subdirectories**

Replace the current `getAllWangImageURLs()` function (lines 67-96) with:

```javascript
export function getAllWangImageURLs() {
  var urls = [];
  var seenDirs = new Set();

  // Collect all transition directories
  for (var b in BIOME_INTERIOR) {
    var ie = BIOME_INTERIOR[b];
    seenDirs.add(ie.dir);
  }
  for (var ei = 0; ei < EXTRA_TRANSITION_DIRS.length; ei++) {
    seenDirs.add(EXTRA_TRANSITION_DIRS[ei]);
  }

  // For each transition dir, generate URLs for all variants that exist on disk
  seenDirs.forEach(function(dir) {
    for (var vi = 0; vi < WANG_VARIANTS.length; vi++) {
      var variant = WANG_VARIANTS[vi];
      var tileCount = WANG_VARIANT_TILE_COUNTS[variant];
      for (var m = 0; m < tileCount; m++) {
        urls.push(TRANSITIONS_BASE + dir + '/' + variant + '/' + dir + '__wang_' + m + WANG_SUFFIX);
      }
    }
  });

  // Cliff overlays (only wang/ — cliffs don't have elevation variants)
  var cliffSeen = {};
  for (var bk in BIOME_CLIFF) {
    var cd = BIOME_CLIFF[bk];
    if (cliffSeen[cd]) continue;
    cliffSeen[cd] = true;
    for (var cm = 0; cm < 16; cm++) {
      urls.push(TRANSITIONS_BASE + cd + '/wang/' + cd + '__wang_' + cm + WANG_SUFFIX);
    }
  }
  return urls;
}
```

- [ ] **Step 3: Verify the URL count is reasonable**

Open the game in a browser, open dev console, and run:
```javascript
import('/src/render/wang-image-list.js').then(m => console.log('Total URLs:', m.getAllWangImageURLs().length))
```

Expected: roughly 4x the previous count (was ~1500, should now be ~5000-6000). Workers will preload these — the batched fetch (BATCH=30) in `chunk-worker.js` already handles large counts.

- [ ] **Step 4: Commit**

```bash
git add src/render/wang-image-list.js
git commit -m "feat: generate wang tile URLs for all 4 elevation variants (wang, wang_25, wang_50, wang_100)"
```

---

### Task 2: Update getWangSrc() to accept and use elevation variant

**Files:**
- Modify: `src/render/worker-tile-painter.js`

Currently `getWangSrc()` hardcodes `/wang/` in all path constructions. It needs to accept a variant parameter (e.g. `'wang_50'`) and use the correct subdirectory.

- [ ] **Step 1: Add variant parameter to getWangSrc()**

Replace the current `getWangSrc()` function (lines 12-35) with:

```javascript
function getWangSrc(tile, variant) {
  if (!variant) variant = 'wang';
  var mask = tile.wangEdgeMask;
  if (mask === undefined) mask = 0;
  if (tile.transitionPair) {
    var pair = tile.transitionPair;
    var otherBiome = tile.transitionSide === 'from' ? pair.to : pair.from;
    var isLandWaterCliff = !WATER_BIOMES[tile.biome] && WATER_BIOMES[otherBiome] && cliffLevel(tile.climate.elevation) > 0;
    var isWaterLandCliff = WATER_BIOMES[tile.biome] && !WATER_BIOMES[otherBiome];
    if (isLandWaterCliff || isWaterLandCliff) {
      var intMask = tile.transitionSide === 'from' ? 6 : 12;
      return TRANSITIONS_BASE + pair.dir + '/' + variant + '/' + pair.dir + '__wang_' + intMask + WANG_SUFFIX;
    }
    return TRANSITIONS_BASE + pair.dir + '/' + variant + '/' + pair.dir + '__wang_' + mask + WANG_SUFFIX;
  }
  if (tile.nearestTransitionPair) {
    var intMask2 = tile.nearestTransitionSide === 'from' ? 6 : 12;
    return TRANSITIONS_BASE + tile.nearestTransitionPair.dir + '/' + variant + '/' + tile.nearestTransitionPair.dir + '__wang_' + intMask2 + WANG_SUFFIX;
  }
  var interior = BIOME_INTERIOR[tile.biome];
  if (interior) {
    return TRANSITIONS_BASE + interior.dir + '/' + variant + '/' + interior.dir + '__wang_' + interior.mask + WANG_SUFFIX;
  }
  return null;
}
```

The key change: every path now uses `'/' + variant + '/'` instead of `'/wang/'`.

- [ ] **Step 2: Update paintWangBase() to pass variant through**

Replace `paintWangBase()` (lines 39-45) with:

```javascript
function paintWangBase(ctx, tile, sx, sy, size, imageCache, variant) {
  var src = getWangSrc(tile, variant);
  if (!src) return;
  var bmp = imageCache.get(src);
  if (!bmp) {
    // Fallback: if the elevation variant isn't available, try flat
    if (variant !== 'wang') {
      src = getWangSrc(tile, 'wang');
      bmp = imageCache.get(src);
    }
    if (!bmp) return;
  }
  ctx.drawImage(bmp, 0, 0, 32, 32, sx, sy, size, size);
}
```

The fallback is important: not all transition pairs have all 4 variants on disk yet. If `wang_50/` doesn't exist for a pair, it gracefully falls back to `wang/`.

- [ ] **Step 3: Update paintTerrainTile() signature to accept variant**

Replace `paintTerrainTile()` (lines 65-78) with:

```javascript
export function paintTerrainTile(ctx, tile, sx, sy, size, sun, focusElevation, imageCache, variant) {
  if (focusElevation === undefined) focusElevation = tile.climate.elevation;
  var palette = paletteFor(tile.biome);
  var base = palette[1] || palette[0] || '#888';
  var isWater = WATER_BIOMES[tile.biome];
  var elevationShade = isWater ? 0 : (tile.climate.elevation - 0.5) * 0.22;
  var depthFade = isWater ? 0 : Math.max(0, focusElevation - tile.climate.elevation - 0.08) * 0.50;
  var light = Math.max(0, 0.78 + sun.height * 0.22 - depthFade - elevationShade);
  var shaded = shade(base, light);
  ctx.fillStyle = shaded;
  ctx.fillRect(sx, sy, size, size);
  paintWangBase(ctx, tile, sx, sy, size, imageCache, variant);
}
```

Only change: added `variant` parameter, passed through to `paintWangBase()`.

- [ ] **Step 4: Commit**

```bash
git add src/render/worker-tile-painter.js
git commit -m "feat: getWangSrc and paintTerrainTile accept elevation variant parameter with fallback"
```

---

### Task 3: Compute elevation variant per tile in worker-chunk-renderer

**Files:**
- Modify: `src/render/worker-chunk-renderer.js`

This is where the elevation variant is actually determined. For each tile, we look at the 4 wang corners (self, east, south, southeast), compute the max `cliffLevel()` delta, and map it to a variant.

- [ ] **Step 1: Import cliffLevel**

At the top of `worker-chunk-renderer.js` (line 5), update the import:

```javascript
import { paintTerrainTile, paintCliffOverlay, getWangSrc } from './worker-tile-painter.js';
import { cliffLevel } from '../world/terrain-shaper.js';
```

- [ ] **Step 2: Add elevationVariant() helper function**

After the `transitionPairFor()` function (after line 69), add:

```javascript
function elevationVariant(tile) {
  var myLevel = cliffLevel(tile.climate.elevation);
  var eLevel = cliffLevel(tile._elE != null ? tile._elE : tile.climate.elevation);
  var sLevel = cliffLevel(tile._elS != null ? tile._elS : tile.climate.elevation);
  var seLevel = cliffLevel(tile._elSE != null ? tile._elSE : tile.climate.elevation);
  var maxDelta = Math.max(
    Math.abs(myLevel - eLevel),
    Math.abs(myLevel - sLevel),
    Math.abs(myLevel - seLevel),
    Math.abs(eLevel - sLevel),
    Math.abs(eLevel - seLevel),
    Math.abs(sLevel - seLevel)
  );
  if (maxDelta <= 0) return 'wang';
  if (maxDelta === 1) return 'wang_25';
  if (maxDelta === 2) return 'wang_50';
  return 'wang_100';
}
```

This computes the max elevation delta across ALL 6 corner pairs (not just vs self) — the wang tile covers the visual area between all 4 corners, so the largest delta anywhere in the tile determines which variant to use.

- [ ] **Step 3: Compute variant and pass to paint call**

In the main render loop, after the cliff edge detection block (after line 185), replace the paint calls:

Find (lines 187-188):
```javascript
      paintTerrainTile(ctx, tile, sx, sy, tileSize, sun, tile.climate.elevation, imageCache);
      paintCliffOverlay(ctx, tile, sx, sy, tileSize, sun, imageCache);
```

Replace with:
```javascript
      var variant = elevationVariant(tile);
      paintTerrainTile(ctx, tile, sx, sy, tileSize, sun, tile.climate.elevation, imageCache, variant);
      paintCliffOverlay(ctx, tile, sx, sy, tileSize, sun, imageCache);
```

Note: `paintCliffOverlay` is NOT changed — cliff overlays use their own separate cliff tilesets and don't have elevation variants.

- [ ] **Step 4: Update debug data to include variant**

Find the debug data collection (lines 191-196) and update `getWangSrc` call to pass variant:

```javascript
      var wangSrc = getWangSrc(tile, variant);
      var wangOk = !!(wangSrc && imageCache.get(wangSrc));
      debugMasks[y * chunkSize + x] = tile.wangEdgeMask;
      debugSuccesses[y * chunkSize + x] = wangOk;
      debugSrcs[y * chunkSize + x] = wangSrc || '';
      debugBiomes[y * chunkSize + x] = tile.biome;
```

- [ ] **Step 5: Test in browser**

1. Open the game
2. Navigate to an area with hills/mountains adjacent to plains
3. Look for visual cliff faces on steep transitions (wang_100 tiles have visible vertical cliff faces)
4. Look for subtle ledges at gentle slopes (wang_25 tiles have slight steps)
5. Flat areas within same-elevation biomes should look unchanged (wang/ tiles, same as before)

If tiles appear missing (black squares), the fallback in `paintWangBase()` should catch it — but verify by checking the browser console for 404s on wang_25/wang_50 URLs. Some transition pairs may only have wang/ and wang_100/ on disk.

- [ ] **Step 6: Commit**

```bash
git add src/render/worker-chunk-renderer.js
git commit -m "feat: select wang tile elevation variant based on cliffLevel delta between corners"
```

---

## Summary

| Task | What changes | Risk |
|------|-------------|------|
| 1 | URL generation for all variants | Low — additive, more images preloaded |
| 2 | getWangSrc + paint accept variant | Low — fallback to wang/ if variant missing |
| 3 | Compute variant from elevation | Medium — visual change, needs tuning of delta thresholds |

**Tuning notes:** The delta thresholds in `elevationVariant()` (0→wang, 1→wang_25, 2→wang_50, 3+→wang_100) map cliffLevel deltas (each level = 0.1 elevation) to visual cliff sizes. If the terrain looks too "cliffy", raise the thresholds (e.g. 2→wang_25, 3→wang_50, 4+→wang_100). If it looks too flat, lower them. The function is a single point of tuning.

**Memory impact:** Preloading 4x the wang tile images increases worker memory from ~1500 to ~5500 ImageBitmaps. Each is 32x32 RGBA = ~4KB, so total increase is ~16MB per worker. With 6 workers that's ~96MB total — acceptable for a desktop game.
