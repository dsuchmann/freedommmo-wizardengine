# Worker-Side Chunk Painting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move chunk terrain painting off the main thread into existing compile workers using OffscreenCanvas + createImageBitmap, eliminating main-thread stutter during chunk loading.

**Architecture:** Compile workers already generate chunk tile data. After compilation, workers now also paint the chunk to an OffscreenCanvas using ImageBitmap-based wang tiles (loaded via fetch + createImageBitmap). The finished ImageBitmap transfers to the main thread at zero copy cost. The main thread becomes a thin bitmap cache that just draws pre-rendered bitmaps.

**Tech Stack:** OffscreenCanvas, createImageBitmap, Transferable ImageBitmap, Web Workers (existing pool)

**Baseline commit:** `f3ed2870` (June 3, 3:00 PM)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/render/wang-image-list.js` | Create | Shared list of all wang tile URLs — used by both main thread and workers |
| `src/render/worker-tile-painter.js` | Create | Worker-compatible painting: paintTerrainTile + paintCliffOverlay using ImageBitmap cache |
| `src/render/worker-chunk-renderer.js` | Create | Worker-compatible renderChunk: neighbor lookup, transition pairs, wang masks, calls worker-tile-painter |
| `src/world/chunk-worker.js` | Modify | Add image preloading on init, paint step after compile, neighbor tile cache |
| `src/world/chunk-provider.js` | Modify | Handle `imagesReady` and `chunkPainted` messages, store bitmaps, repaint requests |
| `src/render/chunk-render-cache.js` | Modify | Simplify to bitmap lookup (remove renderChunk, remove frame budget) |
| `src/render/canvas-renderer.js` | Modify | Draw ImageBitmap from provider instead of canvas from cache |
| `src/main.js` | Modify | Wire bitmap store from provider into renderer |

---

### Task 1: Extract wang image URL list into shared module

**Files:**
- Create: `src/render/wang-image-list.js`

This module produces the complete list of wang tile URLs. It must be importable from both the main thread and workers (no DOM dependencies).

- [ ] **Step 1: Create `src/render/wang-image-list.js`**

```js
// Wang tile image URL list — shared between main thread and workers.
// No DOM dependencies. Pure data.

var WANG_SUFFIX = '__v000.png';
var TRANSITIONS_BASE = 'assets/pixelab/landscape_v2/transitions/';

var BIOME_INTERIOR = {
  beach:         { dir: 'beach_to_river',          mask: 6 },
  desert:        { dir: 'beach_to_desert',         mask: 12 },
  grassland:     { dir: 'grassland_to_forest',     mask: 6 },
  river:         { dir: 'beach_to_river',          mask: 12 },
  swamp:         { dir: 'swamp_to_forest',         mask: 6 },
  forest:        { dir: 'grassland_to_forest',     mask: 12 },
  dense_forest:  { dir: 'forest_to_dense_forest',  mask: 12 },
  tropical_forest:{ dir: 'forest_to_tropical_forest', mask: 12 },
  taiga:         { dir: 'forest_to_taiga',         mask: 12 },
  savanna:       { dir: 'grassland_to_savanna',    mask: 12 },
  steppe:        { dir: 'grassland_to_steppe',     mask: 12 },
  tundra:        { dir: 'tundra_to_snow',          mask: 6 },
  arctic:        { dir: 'tundra_to_snow',          mask: 12 },
  hills:         { dir: 'grassland_to_hills',      mask: 12 },
  mountains:     { dir: 'hills_to_mountains',      mask: 12 },
  volcanic:      { dir: 'desert_to_volcanic',      mask: 12 },
  mystic:        { dir: 'grassland_to_mystic',     mask: 12 },
  ocean:         { dir: 'deep_ocean_to_ocean',     mask: 12 },
  deep_ocean:    { dir: 'deep_ocean_to_ocean',     mask: 6 },
  shallow_water: { dir: 'ocean_to_shallow_water',  mask: 12 },
  lake:          { dir: 'lake_to_river',           mask: 6 },
};

var BIOME_CLIFF = {
  beach: 'beach_cliff', desert: 'sand_cliff', grassland: 'grass_cliff',
  forest: 'forest_cliff', dense_forest: 'forest_cliff', tropical_forest: 'forest_cliff',
  taiga: 'snow_cliff', savanna: 'savanna_cliff', steppe: 'steppe_cliff',
  swamp: 'swamp_cliff', tundra: 'tundra_cliff', arctic: 'snow_cliff',
  hills: 'hills_cliff', mountains: 'stone_cliff', volcanic: 'volcanic_cliff',
  mystic: 'mystic_cliff', ocean: 'cliff_overlay', deep_ocean: 'cliff_overlay',
  shallow_water: 'cliff_overlay', river: 'cliff_overlay', lake: 'cliff_overlay',
};

var EXTRA_TRANSITION_DIRS = [
  'beach_to_desert','beach_to_grassland','beach_to_forest','beach_to_hills',
  'dense_forest_to_mystic','dense_forest_to_tropical_forest',
  'desert_to_hills','desert_to_savanna',
  'forest_to_dense_forest','forest_to_hills',
  'forest_to_mystic','forest_to_savanna','forest_to_taiga','forest_to_tropical_forest',
  'grassland_to_desert','grassland_to_forest','grassland_to_hills','grassland_to_mystic',
  'grassland_to_savanna','grassland_to_steppe','grassland_to_taiga',
  'hills_to_mountains','hills_to_volcanic',
  'lake_to_forest','lake_to_grassland','lake_to_river','lake_to_shallow_water','lake_to_swamp',
  'mountains_to_snow','mountains_to_volcanic',
  'ocean_to_beach','ocean_to_shallow_water',
  'river_to_forest','river_to_grassland','river_to_hills','river_to_swamp',
  'savanna_to_hills','savanna_to_steppe',
  'shallow_water_to_beach','shallow_water_to_river','shallow_water_to_swamp',
  'steppe_to_desert','steppe_to_hills',
  'swamp_to_beach','swamp_to_dense_forest','swamp_to_forest','swamp_to_grass',
  'swamp_to_taiga','swamp_to_tropical_forest',
  'taiga_to_hills','taiga_to_mountains',
  'tropical_forest_to_mystic',
  'tundra_to_hills','tundra_to_mountains','tundra_to_snow','tundra_to_steppe','tundra_to_taiga'
];

export { WANG_SUFFIX, TRANSITIONS_BASE, BIOME_INTERIOR, BIOME_CLIFF, EXTRA_TRANSITION_DIRS };

// Build the complete URL list for all wang tile images
export function getAllWangImageURLs() {
  var urls = [];
  // Interior tiles for all biomes
  var seenDirs = new Set();
  for (var b in BIOME_INTERIOR) {
    var ie = BIOME_INTERIOR[b];
    if (seenDirs.has(ie.dir)) continue;
    seenDirs.add(ie.dir);
    for (var pm = 0; pm < 16; pm++) {
      urls.push(TRANSITIONS_BASE + ie.dir + '/wang/' + ie.dir + '__wang_' + pm + WANG_SUFFIX);
    }
  }
  // Extra transition dirs
  for (var ei = 0; ei < EXTRA_TRANSITION_DIRS.length; ei++) {
    var ed = EXTRA_TRANSITION_DIRS[ei];
    if (seenDirs.has(ed)) continue;
    seenDirs.add(ed);
    for (var em = 0; em < 16; em++) {
      urls.push(TRANSITIONS_BASE + ed + '/wang/' + ed + '__wang_' + em + WANG_SUFFIX);
    }
  }
  // Cliff tiles
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

- [ ] **Step 2: Verify module loads without errors**

Open browser devtools console. Import the module:
```
import('./src/render/wang-image-list.js').then(m => console.log('URLs:', m.getAllWangImageURLs().length))
```
Expected: prints a number around 1500.

- [ ] **Step 3: Commit**

```bash
git add src/render/wang-image-list.js
git commit -m "feat: extract wang image URL list into shared worker-safe module"
```

---

### Task 2: Create worker-compatible tile painter

**Files:**
- Create: `src/render/worker-tile-painter.js`

Port `paintTerrainTile`, `paintCliffOverlay`, and supporting functions from `tile-painter.js` to work with an `ImageBitmap` cache (Map) instead of DOM Image objects. No `new Image()`, no `.complete`, no `.naturalWidth`.

- [ ] **Step 1: Create `src/render/worker-tile-painter.js`**

```js
// Worker-compatible tile painter. Uses ImageBitmap cache instead of DOM Image objects.
// Mirrors tile-painter.js logic exactly but runs in Web Workers.

import { rand2, smoothNoise } from '../core/random.js';
import { paletteFor } from './palette.js';
import { cliffLevel } from '../world/terrain-shaper.js';
import { WANG_SUFFIX, TRANSITIONS_BASE, BIOME_INTERIOR, BIOME_CLIFF } from './wang-image-list.js';

var CLIFF_CORNER_TO_WANG = [12,13,0,3,8,1,14,5,15,4,11,2,9,10,7,6];
var WATER_BIOMES = { ocean: 1, deep_ocean: 1, shallow_water: 1, river: 1, lake: 1 };

function getWangSrc(tile) {
  var mask = tile.wangEdgeMask;
  if (mask === undefined) mask = 0;
  if (tile.transitionPair) {
    var pair = tile.transitionPair;
    var otherBiome = tile.transitionSide === 'from' ? pair.to : pair.from;
    var isLandWaterCliff = !WATER_BIOMES[tile.biome] && WATER_BIOMES[otherBiome] && cliffLevel(tile.climate.elevation) > 0;
    var isWaterLandCliff = WATER_BIOMES[tile.biome] && !WATER_BIOMES[otherBiome];
    if (isLandWaterCliff || isWaterLandCliff) {
      var intMask = tile.transitionSide === 'from' ? 6 : 12;
      return TRANSITIONS_BASE + pair.dir + '/wang/' + pair.dir + '__wang_' + intMask + WANG_SUFFIX;
    }
    return TRANSITIONS_BASE + pair.dir + '/wang/' + pair.dir + '__wang_' + mask + WANG_SUFFIX;
  }
  if (tile.nearestTransitionPair) {
    var intMask = tile.nearestTransitionSide === 'from' ? 6 : 12;
    return TRANSITIONS_BASE + tile.nearestTransitionPair.dir + '/wang/' + tile.nearestTransitionPair.dir + '__wang_' + intMask + WANG_SUFFIX;
  }
  var interior = BIOME_INTERIOR[tile.biome];
  if (interior) {
    return TRANSITIONS_BASE + interior.dir + '/wang/' + interior.dir + '__wang_' + interior.mask + WANG_SUFFIX;
  }
  return null;
}

function paintWangBase(ctx, tile, sx, sy, size, imageCache) {
  var src = getWangSrc(tile);
  if (!src) return;
  var bmp = imageCache.get(src);
  if (!bmp) return;
  ctx.drawImage(bmp, 0, 0, 32, 32, sx, sy, size, size);
}

function coherentPatch(wx, wy, biome) {
  return Math.abs(smoothNoise(wx * 0.17 + biome.length * 0.3, wy * 0.17 + biome.length * 0.3));
}

function shade(hex, amount) {
  if (!hex) return '#000';
  var r = parseInt(hex.slice(1, 3), 16);
  var g = parseInt(hex.slice(3, 5), 16);
  var b = parseInt(hex.slice(5, 7), 16);
  return '#' + [r, g, b].map(function(c) {
    var v = Math.floor(c * amount);
    return (v < 0 ? 0 : v > 255 ? 255 : v).toString(16).padStart(2, '0');
  }).join('');
}

export function paintTerrainTile(ctx, tile, sx, sy, size, sun, focusElevation, imageCache) {
  if (focusElevation === undefined) focusElevation = tile.climate.elevation;
  var palette = paletteFor(tile.biome);
  var patch = coherentPatch(tile.wx, tile.wy, tile.biome);
  var base = palette[Math.min(palette.length - 1, Math.floor(patch * palette.length))];
  var isWater = WATER_BIOMES[tile.biome];
  var elevationShade = isWater ? 0 : (tile.climate.elevation - 0.5) * 0.22;
  var depthFade = isWater ? 0 : Math.max(0, focusElevation - tile.climate.elevation - 0.08) * 0.50;
  var light = Math.max(0, 0.78 + sun.height * 0.22 - depthFade - elevationShade);
  var shaded = shade(base, light);
  ctx.fillStyle = shaded;
  ctx.fillRect(sx, sy, size, size);
  paintWangBase(ctx, tile, sx, sy, size, imageCache);
}

function cornerCliffLevel(elevation, biome) {
  if (WATER_BIOMES[biome]) return 0;
  return cliffLevel(elevation);
}

export function paintCliffOverlay(ctx, tile, sx, sy, size, sun, imageCache) {
  if (WATER_BIOMES[tile.biome]) return;
  var myEl = tile.climate.elevation;
  var nwLevel = cornerCliffLevel(myEl, tile.biome);
  var neLevel = cornerCliffLevel(tile._elE != null ? tile._elE : myEl, tile.neighborE || tile.biome);
  var swLevel = cornerCliffLevel(tile._elS != null ? tile._elS : myEl, tile.neighborS || tile.biome);
  var seLevel = cornerCliffLevel(tile._elSE != null ? tile._elSE : myEl, tile.neighborSE || tile.biome);
  if (nwLevel === neLevel && nwLevel === swLevel && nwLevel === seLevel) return;
  var minLevel = Math.min(nwLevel, neLevel, swLevel, seLevel);
  var cornerMask = 0;
  if (nwLevel === minLevel) cornerMask |= 8;
  if (neLevel === minLevel) cornerMask |= 4;
  if (swLevel === minLevel) cornerMask |= 2;
  if (seLevel === minLevel) cornerMask |= 1;
  if (cornerMask === 0 || cornerMask === 15) return;
  var wangIndex = CLIFF_CORNER_TO_WANG[cornerMask];
  var cliffDir = BIOME_CLIFF[tile.biome] || 'cliff_overlay';
  var src = TRANSITIONS_BASE + cliffDir + '/wang/' + cliffDir + '__wang_' + wangIndex + WANG_SUFFIX;
  var bmp = imageCache.get(src);
  if (!bmp) return;
  ctx.drawImage(bmp, 0, 0, 32, 32, sx, sy, size, size);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/render/worker-tile-painter.js
git commit -m "feat: worker-compatible tile painter using ImageBitmap cache"
```

---

### Task 3: Create worker-compatible chunk renderer

**Files:**
- Create: `src/render/worker-chunk-renderer.js`

Port `renderChunk()` from `chunk-render-cache.js` lines 142-254: the tile loop, neighbor lookup, transition pair matching, wang corner masks, and painting calls. This module takes a chunk, neighbor tile arrays, a sun object, and an ImageBitmap cache, paints to an OffscreenCanvas, and returns an ImageBitmap.

- [ ] **Step 1: Create `src/render/worker-chunk-renderer.js`**

```js
// Worker-compatible chunk renderer. Takes chunk data + neighbor tiles,
// paints to OffscreenCanvas, returns ImageBitmap.

import { WORLD } from '../core/constants.js';
import { paintTerrainTile, paintCliffOverlay } from './worker-tile-painter.js';

var CORNER_TO_WANG = [12,13,0,3,8,1,14,5,15,4,11,2,9,10,7,6];

var TRANSITION_PAIRS = {
  'beach|desert': { from: 'beach', to: 'desert', dir: 'beach_to_desert' },
  'beach|grassland': { from: 'beach', to: 'grassland', dir: 'beach_to_grassland' },
  'deep_ocean|ocean': { from: 'deep_ocean', to: 'ocean', dir: 'deep_ocean_to_ocean' },
  'dense_forest|mystic': { from: 'dense_forest', to: 'mystic', dir: 'dense_forest_to_mystic' },
  'dense_forest|tropical_forest': { from: 'dense_forest', to: 'tropical_forest', dir: 'dense_forest_to_tropical_forest' },
  'desert|hills': { from: 'desert', to: 'hills', dir: 'desert_to_hills' },
  'desert|savanna': { from: 'desert', to: 'savanna', dir: 'desert_to_savanna' },
  'desert|volcanic': { from: 'desert', to: 'volcanic', dir: 'desert_to_volcanic' },
  'forest|dense_forest': { from: 'forest', to: 'dense_forest', dir: 'forest_to_dense_forest' },
  'forest|hills': { from: 'forest', to: 'hills', dir: 'forest_to_hills' },
  'forest|mystic': { from: 'forest', to: 'mystic', dir: 'forest_to_mystic' },
  'forest|taiga': { from: 'forest', to: 'taiga', dir: 'forest_to_taiga' },
  'forest|tropical_forest': { from: 'forest', to: 'tropical_forest', dir: 'forest_to_tropical_forest' },
  'grassland|forest': { from: 'grassland', to: 'forest', dir: 'grassland_to_forest' },
  'grassland|hills': { from: 'grassland', to: 'hills', dir: 'grassland_to_hills' },
  'grassland|mystic': { from: 'grassland', to: 'mystic', dir: 'grassland_to_mystic' },
  'grassland|savanna': { from: 'grassland', to: 'savanna', dir: 'grassland_to_savanna' },
  'grassland|steppe': { from: 'grassland', to: 'steppe', dir: 'grassland_to_steppe' },
  'hills|mountains': { from: 'hills', to: 'mountains', dir: 'hills_to_mountains' },
  'hills|volcanic': { from: 'hills', to: 'volcanic', dir: 'hills_to_volcanic' },
  'lake|forest': { from: 'lake', to: 'forest', dir: 'lake_to_forest' },
  'lake|grassland': { from: 'lake', to: 'grassland', dir: 'lake_to_grassland' },
  'lake|river': { from: 'lake', to: 'river', dir: 'lake_to_river' },
  'lake|shallow_water': { from: 'lake', to: 'shallow_water', dir: 'lake_to_shallow_water' },
  'lake|swamp': { from: 'lake', to: 'swamp', dir: 'lake_to_swamp' },
  'mountains|arctic': { from: 'mountains', to: 'arctic', dir: 'mountains_to_snow' },
  'mountains|volcanic': { from: 'mountains', to: 'volcanic', dir: 'mountains_to_volcanic' },
  'ocean|beach': { from: 'ocean', to: 'beach', dir: 'ocean_to_beach' },
  'ocean|shallow_water': { from: 'ocean', to: 'shallow_water', dir: 'ocean_to_shallow_water' },
  'river|forest': { from: 'river', to: 'forest', dir: 'river_to_forest' },
  'river|grassland': { from: 'river', to: 'grassland', dir: 'river_to_grassland' },
  'river|hills': { from: 'river', to: 'hills', dir: 'river_to_hills' },
  'river|swamp': { from: 'river', to: 'swamp', dir: 'river_to_swamp' },
  'savanna|hills': { from: 'savanna', to: 'hills', dir: 'savanna_to_hills' },
  'savanna|steppe': { from: 'savanna', to: 'steppe', dir: 'savanna_to_steppe' },
  'shallow_water|beach': { from: 'shallow_water', to: 'beach', dir: 'shallow_water_to_beach' },
  'shallow_water|river': { from: 'shallow_water', to: 'river', dir: 'shallow_water_to_river' },
  'shallow_water|swamp': { from: 'shallow_water', to: 'swamp', dir: 'shallow_water_to_swamp' },
  'steppe|desert': { from: 'steppe', to: 'desert', dir: 'steppe_to_desert' },
  'steppe|hills': { from: 'steppe', to: 'hills', dir: 'steppe_to_hills' },
  'swamp|beach': { from: 'swamp', to: 'beach', dir: 'swamp_to_beach' },
  'beach|river': { from: 'beach', to: 'river', dir: 'beach_to_river' },
  'swamp|dense_forest': { from: 'swamp', to: 'dense_forest', dir: 'swamp_to_dense_forest' },
  'swamp|forest': { from: 'swamp', to: 'forest', dir: 'swamp_to_forest' },
  'swamp|grassland': { from: 'swamp', to: 'grassland', dir: 'swamp_to_grass' },
  'swamp|tropical_forest': { from: 'swamp', to: 'tropical_forest', dir: 'swamp_to_tropical_forest' },
  'taiga|hills': { from: 'taiga', to: 'hills', dir: 'taiga_to_hills' },
  'taiga|mountains': { from: 'taiga', to: 'mountains', dir: 'taiga_to_mountains' },
  'tropical_forest|mystic': { from: 'tropical_forest', to: 'mystic', dir: 'tropical_forest_to_mystic' },
  'swamp|taiga': { from: 'swamp', to: 'taiga', dir: 'swamp_to_taiga' },
  'tundra|hills': { from: 'tundra', to: 'hills', dir: 'tundra_to_hills' },
  'tundra|mountains': { from: 'tundra', to: 'mountains', dir: 'tundra_to_mountains' },
  'tundra|arctic': { from: 'tundra', to: 'arctic', dir: 'tundra_to_snow' },
  'tundra|steppe': { from: 'tundra', to: 'steppe', dir: 'tundra_to_steppe' },
  'tundra|taiga': { from: 'tundra', to: 'taiga', dir: 'tundra_to_taiga' },
};

function transitionPairFor(a, b) {
  return TRANSITION_PAIRS[a + '|' + b] || TRANSITION_PAIRS[b + '|' + a] || null;
}

// Render a chunk to an OffscreenCanvas and return an ImageBitmap.
// neighbors: Map<"cx,cy", tileArray> — cached tiles from adjacent chunks
// imageCache: Map<url, ImageBitmap> — preloaded wang tile bitmaps
// sun: { height, ambient, ... }
export function renderChunkToBitmap(chunk, neighbors, sun, imageCache) {
  var chunkSize = WORLD.chunkSize;
  var tileSize = WORLD.tileSize;
  var canvasSize = chunkSize * tileSize;
  var offscreen = new OffscreenCanvas(canvasSize, canvasSize);
  var ctx = offscreen.getContext('2d', { alpha: true });

  var tileAt = function(wx, wy) {
    var cx = Math.floor(wx / chunkSize);
    var cy = Math.floor(wy / chunkSize);
    var tx = ((wx % chunkSize) + chunkSize) % chunkSize;
    var ty = ((wy % chunkSize) + chunkSize) % chunkSize;
    if (cx === chunk.cx && cy === chunk.cy) {
      return chunk.tiles[ty * chunkSize + tx];
    }
    var nbKey = cx + ',' + cy;
    var nbTiles = neighbors.get(nbKey);
    if (nbTiles) return nbTiles[ty * chunkSize + tx];
    return null;
  };

  for (var y = 0; y < chunkSize; y++) {
    for (var x = 0; x < chunkSize; x++) {
      var tile = chunk.tiles[y * chunkSize + x];
      var sx = x * tileSize;
      var sy = y * tileSize;
      var wx = chunk.cx * chunkSize + x;
      var wy = chunk.cy * chunkSize + y;

      // 8 neighbors
      var nbN  = tileAt(wx, wy - 1) || tile;
      var nbNE = tileAt(wx + 1, wy - 1) || tile;
      var nbE  = tileAt(wx + 1, wy) || tile;
      var nbSE = tileAt(wx + 1, wy + 1) || tile;
      var nbS  = tileAt(wx, wy + 1) || tile;
      var nbSW = tileAt(wx - 1, wy + 1) || tile;
      var nbW  = tileAt(wx - 1, wy) || tile;
      var nbNW = tileAt(wx - 1, wy - 1) || tile;
      tile.neighborN  = nbN.biome;
      tile.neighborNE = nbNE.biome;
      tile.neighborE  = nbE.biome;
      tile.neighborSE = nbSE.biome;
      tile.neighborS  = nbS.biome;
      tile.neighborSW = nbSW.biome;
      tile.neighborW  = nbW.biome;
      tile.neighborNW = nbNW.biome;
      tile._elN  = nbN.climate ? nbN.climate.elevation : tile.climate.elevation;
      tile._elNE = nbNE.climate ? nbNE.climate.elevation : tile.climate.elevation;
      tile._elE  = nbE.climate ? nbE.climate.elevation : tile.climate.elevation;
      tile._elSE = nbSE.climate ? nbSE.climate.elevation : tile.climate.elevation;
      tile._elS  = nbS.climate ? nbS.climate.elevation : tile.climate.elevation;
      tile._elSW = nbSW.climate ? nbSW.climate.elevation : tile.climate.elevation;

      // Transition pair detection
      tile.transitionPair = null;
      tile.transitionSide = '';
      tile.nearestTransitionPair = null;
      tile.nearestTransitionSide = '';
      var immediate = [tile.neighborN, tile.neighborNE, tile.neighborE, tile.neighborSE, tile.neighborS, tile.neighborSW, tile.neighborW, tile.neighborNW];
      for (var ni = 0; ni < immediate.length; ni++) {
        var nb = immediate[ni];
        if (nb && nb !== tile.biome) {
          var pair = transitionPairFor(tile.biome, nb);
          if (pair) {
            tile.transitionPair = pair;
            tile.transitionSide = tile.biome === pair.from ? 'from' : 'to';
            tile.nearestTransitionPair = pair;
            tile.nearestTransitionSide = tile.transitionSide;
            break;
          }
        }
      }
      if (!tile.transitionPair) {
        var foundPair = null;
        for (var dy = -16; dy <= 16 && !foundPair; dy++) {
          for (var dx = -16; dx <= 16 && !foundPair; dx++) {
            if (dx === 0 && dy === 0) continue;
            var far = tileAt(wx + dx, wy + dy);
            if (!far || far.biome === tile.biome) continue;
            var pair = transitionPairFor(tile.biome, far.biome);
            if (pair) { foundPair = pair; }
          }
        }
        tile.nearestTransitionPair = foundPair;
        tile.nearestTransitionSide = foundPair ? (tile.biome === foundPair.from ? 'from' : 'to') : '';
      }

      // Wang corner mask
      var cornerMask = 0;
      if (tile.transitionPair) {
        var fb = tile.transitionPair.from;
        if (tile.biome === fb) cornerMask |= 8;
        if (tile.neighborE === fb) cornerMask |= 4;
        if (tile.neighborS === fb) cornerMask |= 2;
        if (tile.neighborSE === fb) cornerMask |= 1;
      }
      tile.wangEdgeMask = tile.transitionPair ? CORNER_TO_WANG[cornerMask] : 0;

      // Cliff edge detection
      var myEl = tile.climate.elevation;
      tile._isCliffEdge = false;
      if (myEl > 0) {
        if (myEl > (tile._elE || myEl) + 0.02 || myEl > (tile._elS || myEl) + 0.02 || myEl > (tile._elSE || myEl) + 0.02) {
          tile._isCliffEdge = true;
        }
      }

      paintTerrainTile(ctx, tile, sx, sy, tileSize, sun, tile.climate.elevation, imageCache);
      paintCliffOverlay(ctx, tile, sx, sy, tileSize, sun, imageCache);
    }
  }

  return offscreen.transferToImageBitmap();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/render/worker-chunk-renderer.js
git commit -m "feat: worker-compatible chunk renderer with OffscreenCanvas"
```

---

### Task 4: Add image preloading and painting to chunk worker

**Files:**
- Modify: `src/world/chunk-worker.js`

The worker now:
1. On init, fetches all wang tile PNGs via `fetch()` + `createImageBitmap()`, stores in a Map
2. Sends `imagesReady` message when done (does not accept compileChunk until ready)
3. Keeps a local cache of recently compiled chunk tile arrays (for neighbor lookups)
4. After compiling a chunk, paints it using `renderChunkToBitmap()` and transfers the ImageBitmap

- [ ] **Step 1: Replace `src/world/chunk-worker.js`**

```js
import { setWorldSeed } from '../core/world-seed.js';
import { WORLD } from '../core/constants.js';
import { ChunkCompiler } from './chunk-compiler.js';
import { getAllWangImageURLs } from '../render/wang-image-list.js';
import { renderChunkToBitmap } from '../render/worker-chunk-renderer.js';

var compiler = new ChunkCompiler();
var SLICE_ROWS = 8;
var imageCache = new Map();  // url -> ImageBitmap
var imagesReady = false;
var neighborCache = new Map();  // "cx,cy" -> tile array
var MAX_NEIGHBOR_CACHE = 50;

// Preload all wang tile images on worker init
(async function preloadImages() {
  var urls = getAllWangImageURLs();
  var loaded = 0;
  var failed = 0;
  await Promise.all(urls.map(async function(url) {
    try {
      var response = await fetch(url);
      if (!response.ok) { failed++; return; }
      var blob = await response.blob();
      var bmp = await createImageBitmap(blob);
      imageCache.set(url, bmp);
      loaded++;
    } catch (e) {
      failed++;
    }
  }));
  imagesReady = true;
  self.postMessage({ type: 'imagesReady', loaded: loaded, failed: failed, total: urls.length });
})();

// Evict oldest entries from neighbor cache
function evictNeighborCache() {
  if (neighborCache.size <= MAX_NEIGHBOR_CACHE) return;
  var keys = [...neighborCache.keys()];
  while (keys.length > MAX_NEIGHBOR_CACHE) {
    neighborCache.delete(keys.shift());
  }
}

self.onmessage = function(event) {
  var data = event.data;
  if (data.type === 'compileChunk') {
    if (!imagesReady) {
      // Queue not supported — main thread should wait for imagesReady
      return;
    }
    var key = data.key;
    var cx = data.cx;
    var cy = data.cy;
    setWorldSeed(data.seed);
    var chunk = compiler.compile(cx, cy);

    // Send tile data in slices (same as before, for main thread to store)
    self.postMessage({ type: 'chunkStart', key: key, cx: cx, cy: cy, totalRows: WORLD.chunkSize });
    for (var y = 0; y < WORLD.chunkSize; y += SLICE_ROWS) {
      var start = y * WORLD.chunkSize;
      var end = Math.min(WORLD.chunkSize * WORLD.chunkSize, (y + SLICE_ROWS) * WORLD.chunkSize);
      self.postMessage({
        type: 'chunkSlice',
        key: key,
        y: y,
        tiles: chunk.tiles.slice(start, end),
        renderTiles: chunk.renderTiles.slice(start, end),
        objects: chunk.objects.filter(function(o) { return o.y >= y && o.y < y + SLICE_ROWS; })
      });
    }

    // Cache tiles for neighbor lookups by future chunks
    var cacheKey = cx + ',' + cy;
    neighborCache.set(cacheKey, chunk.tiles);
    evictNeighborCache();

    // Paint the chunk
    var sun = { height: 0.5, ambient: 0.85 };  // static lighting
    var bitmap = renderChunkToBitmap(chunk, neighborCache, sun, imageCache);

    // Transfer bitmap to main thread (zero-copy)
    self.postMessage({ type: 'chunkPainted', key: key, cx: cx, cy: cy, bitmap: bitmap }, [bitmap]);
  } else if (data.type === 'repaintChunk') {
    // Re-paint with updated neighbor data
    if (!imagesReady) return;
    var key = data.key;
    var cx = data.cx;
    var cy = data.cy;
    // Store incoming neighbor tiles
    if (data.neighbors) {
      for (var nk in data.neighbors) {
        neighborCache.set(nk, data.neighbors[nk]);
      }
      evictNeighborCache();
    }
    var tiles = neighborCache.get(cx + ',' + cy);
    if (!tiles) return;  // chunk not in cache
    var chunk = { cx: cx, cy: cy, tiles: tiles };
    var sun = { height: 0.5, ambient: 0.85 };
    var bitmap = renderChunkToBitmap(chunk, neighborCache, sun, imageCache);
    self.postMessage({ type: 'chunkRepainted', key: key, cx: cx, cy: cy, bitmap: bitmap }, [bitmap]);
  }
};
```

- [ ] **Step 2: Commit**

```bash
git add src/world/chunk-worker.js
git commit -m "feat: chunk worker preloads wang images and paints chunks off-thread"
```

---

### Task 5: Update ChunkProvider to handle bitmaps

**Files:**
- Modify: `src/world/chunk-provider.js`

Handle new message types: `imagesReady`, `chunkPainted`, `chunkRepainted`. Store bitmaps in a Map. Track worker readiness. Don't dispatch compile jobs until at least one worker signals imagesReady.

- [ ] **Step 1: Update `src/world/chunk-provider.js`**

Replace the full file with:

```js
import { getWorldSeed } from '../core/world-seed.js';
import { chunkKey } from './chunk.js';
import { ChunkCompiler } from './chunk-compiler.js';

export class ChunkProvider {
  constructor({ workerCount = Math.max(2, Math.min(6, (navigator.hardwareConcurrency ?? 8) - 2)) } = {}) {
    this.compiler = new ChunkCompiler();
    this.ready = new Map();
    this.pending = new Map();
    this.queued = new Map();
    this.completed = [];
    this.assembling = new Map();
    this.bitmaps = new Map();       // "cx,cy" -> ImageBitmap
    this.workers = [];
    this.nextWorker = 0;
    this.workerSupported = typeof Worker !== 'undefined';
    this.maxActive = Math.max(1, workerCount);
    this.maxAdoptPerFrame = 2;
    this.pumpScheduled = false;
    this.workersReady = 0;          // count of workers with images loaded

    if (this.workerSupported) {
      for (let i = 0; i < workerCount; i++) this.createWorker();
    }
  }

  createWorker() {
    try {
      const worker = new Worker(new URL('./chunk-worker.js', import.meta.url), { type: 'module' });
      worker._imagesReady = false;
      worker.onmessage = event => {
        const msg = event.data;
        if (msg.type === 'imagesReady') {
          worker._imagesReady = true;
          this.workersReady++;
          // Flush any queued jobs now that a worker is ready
          this.schedulePump();
          return;
        }
        const { key } = msg;
        if (msg.type === 'chunkStart') {
          this.assembling.set(key, { cx: msg.cx, cy: msg.cy, tiles: [], renderTiles: [], objects: [] });
        } else if (msg.type === 'chunkSlice') {
          const partial = this.assembling.get(key);
          if (partial) {
            const offset = msg.y * 64;
            for (let i = 0; i < msg.tiles.length; i++) partial.tiles[offset + i] = msg.tiles[i];
            for (let i = 0; i < msg.renderTiles.length; i++) partial.renderTiles[offset + i] = msg.renderTiles[i];
            partial.objects.push(...msg.objects);
          }
        } else if (msg.type === 'chunkDone') {
          const partial = this.assembling.get(key);
          this.assembling.delete(key);
          this.pending.delete(key);
          if (partial) this.completed.push({ key, chunk: { cx: partial.cx, cy: partial.cy, tiles: partial.tiles, renderTiles: partial.renderTiles, objects: partial.objects } });
          this.schedulePump();
        } else if (msg.type === 'chunkPainted') {
          // Store the bitmap — arrives after chunkDone or sometimes overlapping
          const bitmapKey = msg.cx + ',' + msg.cy;
          // Close old bitmap if replacing
          const old = this.bitmaps.get(bitmapKey);
          if (old) old.close();
          this.bitmaps.set(bitmapKey, msg.bitmap);
          // If chunk data is still in flight, the bitmap will be ready when it arrives
          this.pending.delete(key);
          this.schedulePump();
        } else if (msg.type === 'chunkRepainted') {
          const bitmapKey = msg.cx + ',' + msg.cy;
          const old = this.bitmaps.get(bitmapKey);
          if (old) old.close();
          this.bitmaps.set(bitmapKey, msg.bitmap);
        } else if (msg.chunk) {
          this.pending.delete(key);
          this.completed.push({ key, chunk: msg.chunk });
          this.schedulePump();
        }
      };
      worker.onerror = () => {
        this.workerSupported = false;
      };
      this.workers.push(worker);
    } catch {
      this.workerSupported = false;
    }
  }

  has(cx, cy) {
    const key = chunkKey(cx, cy);
    return this.ready.has(key) || this.pending.has(key) || this.queued.has(key) || this.assembling.has(key) || this.completed.some(item => item.key === key);
  }

  request(cx, cy, priority = 0) {
    const key = chunkKey(cx, cy);
    if (this.ready.has(key) || this.pending.has(key) || this.queued.has(key) || this.assembling.has(key) || this.completed.some(item => item.key === key)) return;

    if (!this.workerSupported || this.workers.length === 0) {
      this.ready.set(key, this.compiler.compile(cx, cy));
      return;
    }

    this.queued.set(key, { key, cx, cy, priority, requestedAt: performance.now() });
    this.schedulePump();
  }

  schedulePump() {
    if (this.pumpScheduled) return;
    this.pumpScheduled = true;
    requestAnimationFrame(() => {
      this.pumpScheduled = false;
      this.pumpQueue();
    });
  }

  pumpQueue() {
    let adopted = 0;
    while (this.completed.length > 0 && adopted < this.maxAdoptPerFrame) {
      const { key, chunk } = this.completed.shift();
      this.ready.set(key, chunk);
      adopted++;
    }

    // Only dispatch to workers that have finished loading images
    const readyWorkers = this.workers.filter(w => w._imagesReady);
    if (readyWorkers.length > 0) {
      while (this.pending.size < this.maxActive && this.queued.size > 0) {
        const jobs = [...this.queued.values()].sort((a, b) => a.priority - b.priority || a.requestedAt - b.requestedAt);
        const job = jobs[0];
        this.queued.delete(job.key);
        this.pending.set(job.key, job);
        const worker = readyWorkers[this.nextWorker++ % readyWorkers.length];
        worker.postMessage({ type: 'compileChunk', key: job.key, seed: getWorldSeed(), cx: job.cx, cy: job.cy, priority: job.priority });
      }
    }

    if (this.completed.length > 0 || this.queued.size > 0) this.schedulePump();
  }

  getBitmap(cx, cy) {
    return this.bitmaps.get(cx + ',' + cy) ?? null;
  }

  getReady(cx, cy) {
    if (this.completed.length > 0) this.pumpQueue();
    return this.ready.get(chunkKey(cx, cy));
  }

  getOrCompileSync(cx, cy) {
    const key = chunkKey(cx, cy);
    if (!this.ready.has(key)) {
      this.pending.delete(key);
      this.queued.delete(key);
      this.assembling.delete(key);
      const idx = this.completed.findIndex(item => item.key === key);
      if (idx >= 0) {
        const [item] = this.completed.splice(idx, 1);
        this.ready.set(key, item.chunk);
      } else {
        this.ready.set(key, this.compiler.compile(cx, cy));
      }
    }
    return this.ready.get(key);
  }

  delete(cx, cy) {
    const key = chunkKey(cx, cy);
    this.ready.delete(key);
    this.pending.delete(key);
    this.queued.delete(key);
    this.assembling.delete(key);
    const bitmapKey = cx + ',' + cy;
    const bmp = this.bitmaps.get(bitmapKey);
    if (bmp) { bmp.close(); this.bitmaps.delete(bitmapKey); }
    const idx = this.completed.findIndex(item => item.key === key);
    if (idx >= 0) this.completed.splice(idx, 1);
  }

  stats() {
    return {
      ready: this.ready.size,
      pending: this.pending.size + this.queued.size + this.completed.length,
      workers: this.workers.length,
      workersReady: this.workersReady,
      workerSupported: this.workerSupported,
      bitmaps: this.bitmaps.size
    };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/world/chunk-provider.js
git commit -m "feat: ChunkProvider handles worker bitmaps and image readiness"
```

---

### Task 6: Simplify ChunkRenderCache to bitmap lookup

**Files:**
- Modify: `src/render/chunk-render-cache.js`

Remove `renderChunk()`, the frame budget system, `neighborReadyMask()`, and the canvas creation. The cache becomes a thin wrapper that returns bitmaps from the provider.

- [ ] **Step 1: Replace `src/render/chunk-render-cache.js`**

```js
// Chunk render cache — thin lookup layer over worker-painted bitmaps.
// Workers paint chunks off-thread; this just stores and retrieves the results.

export class ChunkRenderCache {
  constructor() {
    this.missThisFrame = 0;
  }

  beginFrame() {
    this.missThisFrame = 0;
  }

  // Get the pre-painted bitmap for a chunk. Returns ImageBitmap or null.
  get(chunk, provider) {
    var bitmap = provider.getBitmap(chunk.cx, chunk.cy);
    if (!bitmap) this.missThisFrame++;
    return bitmap;
  }

  clear() {
    // Bitmaps are owned by the provider, nothing to clear here
  }

  stats() {
    return { missedTerrainChunks: this.missThisFrame };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/render/chunk-render-cache.js
git commit -m "feat: simplify ChunkRenderCache to bitmap lookup from provider"
```

---

### Task 7: Update CanvasRenderer to draw bitmaps from provider

**Files:**
- Modify: `src/render/canvas-renderer.js:46-94` (draw method)
- Modify: `src/render/canvas-renderer.js:14-24` (constructor)
- Modify: `src/render/canvas-renderer.js:267-288` (hud method, stats lines)

The renderer now receives the provider reference (via draw call or constructor) and draws ImageBitmaps instead of canvases. The ChunkRenderCache is simplified.

- [ ] **Step 1: Update constructor** — remove compositor/atlas from cache constructor

In `src/render/canvas-renderer.js`, change line 23:
```js
// Old:
this.chunkRenderCache = new ChunkRenderCache(compositor, this.atlas);
// New:
this.chunkRenderCache = new ChunkRenderCache();
```

- [ ] **Step 2: Update draw method** — use bitmaps from provider

In `src/render/canvas-renderer.js`, change the draw method's chunk rendering loop (lines 68-94). The `draw` method signature changes to accept a provider parameter.

Replace lines 46-94 of the `draw` method:

```js
  draw(chunkStore, player, lighting, camera, provider) {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const sun = lighting.sun();
    const tilePx = WORLD.tileSize * camera.zoom;
    const focusTile = chunkStore.tileAt(player.x, player.y);
    ctx.fillStyle = '#18262b';
    ctx.fillRect(0, 0, w, h);

    const camX = player.x * tilePx - w / 2;
    const camY = player.y * tilePx - h / 2 + (camera.elevationOffsetY ?? 0);
    const minCX = floorDiv(Math.floor(camX / tilePx), WORLD.chunkSize) - 1;
    const minCY = floorDiv(Math.floor(camY / tilePx), WORLD.chunkSize) - 1;
    const maxCX = floorDiv(Math.ceil((camX + w) / tilePx), WORLD.chunkSize) + 1;
    const maxCY = floorDiv(Math.ceil((camY + h) / tilePx), WORLD.chunkSize) + 1;

    setChunkStore(chunkStore);
    this.chunkRenderCache.beginFrame();
    const visibleChunks = [];
    const chunkPx = Math.round(WORLD.chunkSize * tilePx);
    const baseSX = Math.round(minCX * WORLD.chunkSize * tilePx - camX);
    const baseSY = Math.round(minCY * WORLD.chunkSize * tilePx - camY);
    const playerCX = floorDiv(Math.floor(player.x), WORLD.chunkSize);
    const playerCY = floorDiv(Math.floor(player.y), WORLD.chunkSize);
    const chunkJobs = [];
    for (let cy = minCY; cy <= maxCY; cy++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        const chunk = chunkStore.getIfReady(cx, cy);
        if (!chunk) continue;
        chunkJobs.push({ cx, cy, chunk, dist: Math.abs(cx - playerCX) + Math.abs(cy - playerCY) });
      }
    }
    chunkJobs.sort((a, b) => a.dist - b.dist);
    for (const job of chunkJobs) {
      const { cx, cy, chunk } = job;
      const key = `${cx},${cy}`;
      const bitmap = this.chunkRenderCache.get(chunk, provider);
      const sx = baseSX + (cx - minCX) * chunkPx;
      const sy = baseSY + (cy - minCY) * chunkPx;
      if (!bitmap) continue;
      ctx.drawImage(bitmap, sx, sy, chunkPx, chunkPx);
      visibleChunks.push({ cx, cy, key, sx, sy, dw: chunkPx, dh: chunkPx });
    }
```

- [ ] **Step 3: Update hud method** — fix stats line to work with new stats format

In the `hud` method (around line 287), change the stats references:

```js
// Old:
const cacheStats = this.chunkRenderCache.stats();
// ... cachedTerrainChunks, maxTerrainChunks, etc.
const workerLine = `workers ${chunkStats.workers} · pending ${chunkStats.pending} · ready ${chunkStats.ready} · terrain cache ${cacheStats.cachedTerrainChunks}/${cacheStats.maxTerrainChunks} · art sheets ${atlasStats.loaded}/${atlasStats.sheets}`;

// New:
const cacheStats = this.chunkRenderCache.stats();
const workerLine = `workers ${chunkStats.workers} (${chunkStats.workersReady ?? '?'} ready) · pending ${chunkStats.pending} · ready ${chunkStats.ready} · bitmaps ${chunkStats.bitmaps ?? 0} · art sheets ${atlasStats.loaded}/${atlasStats.sheets}`;
```

- [ ] **Step 4: Commit**

```bash
git add src/render/canvas-renderer.js
git commit -m "feat: CanvasRenderer draws worker-painted bitmaps"
```

---

### Task 8: Wire provider into main.js render loop

**Files:**
- Modify: `src/main.js:24-26` (provider reference)
- Modify: `src/main.js:65` (draw call)

The ChunkStore wraps a ChunkProvider. We need to pass the provider to the draw call so the renderer can access bitmaps.

- [ ] **Step 1: Store provider reference**

In `src/main.js`, change lines 24-26:

```js
// Old:
const chunks = new ChunkStore(new ChunkProvider());

// New:
const provider = new ChunkProvider();
const chunks = new ChunkStore(provider);
```

- [ ] **Step 2: Pass provider to draw call**

In `src/main.js`, change line 65:

```js
// Old:
renderer.draw(chunks, player, lighting, camera);

// New:
renderer.draw(chunks, player, lighting, camera, provider);
```

- [ ] **Step 3: Update the R-key cache clear** to also note it's a no-op now

In `src/main.js`, line 38-39, the `renderer.chunkRenderCache.clear()` call is fine — it's a no-op in the new cache.

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat: wire provider into render loop for bitmap access"
```

---

### Task 9: Verify and fix — run the game, check console, fix issues

**Files:**
- Potentially any of the above

This is the integration testing task. Load the game in the browser and verify:

- [ ] **Step 1: Check browser console for errors**

Open the game. Watch for:
- Module import errors (wrong paths)
- OffscreenCanvas not supported errors
- createImageBitmap failures
- `transferToImageBitmap` errors

- [ ] **Step 2: Verify wang tiles render correctly**

Navigate to an area with biome transitions (forest ↔ grassland, beach ↔ desert). Check:
- Interior tiles show textured wang tile art (not flat solid colors)
- Transition edges have proper wang tile blending
- Cliff overlays render at elevation changes
- No visible seams between chunks

- [ ] **Step 3: Verify performance**

Check the HUD stats:
- FPS should be consistently 55-60
- draw time should be < 2ms (was 10-50ms before)
- workers should show "(N ready)" where N matches worker count
- No stutter when new chunks load during movement

- [ ] **Step 4: Fix any issues found**

Common issues to expect:
- Worker fetch URLs may need to be relative to the worker's location — if images fail to load, the URL base may need adjustment. Fix by making URLs absolute or relative to the document root.
- `smoothNoise` in `worker-tile-painter.js` is called with 2 args (`smoothNoise(wx * 0.17 + ..., wy * 0.17 + ...)`) but the function signature in `random.js` requires `scale` as 3rd arg. Check `coherentPatch()` — the original `tile-painter.js:222` has the same 2-arg call, so `smoothNoise` must handle it. Verify.
- The `chunkPainted` message may arrive before `chunkDone` — the provider must handle both orderings. The current code handles this (bitmap stored by cx,cy key, chunk data by chunkKey).

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: integration fixes for worker chunk painting"
```

---

### Task 10: Clean up — remove dead code from tile-painter.js

**Files:**
- Modify: `src/render/tile-painter.js`

The main-thread `tile-painter.js` is still imported by `wang-terrain-painter.js` for the old debug overlay system. Its `preloadWangImage` calls at module load now duplicate what workers do. Remove the preloading side effects but keep the exports that other modules use.

- [ ] **Step 1: Check what still imports tile-painter.js**

Search for imports of `tile-painter.js`. If only `wang-terrain-painter.js` imports it (for `paintCliffEdges` which is called from the disabled `paintWangTerrainChunk`), and `chunk-render-cache.js` no longer imports it, the preloading can be removed.

If `tile-painter.js` is still imported anywhere on the main thread, keep it working but remove the image preloading loops (lines 72-116) since workers handle that now. Keep `wangImgCache` for any remaining main-thread usage.

- [ ] **Step 2: Commit**

```bash
git add src/render/tile-painter.js
git commit -m "chore: remove redundant main-thread wang image preloading"
```
