// Worker-compatible tile painter. Uses ImageBitmap cache instead of DOM Image objects.
// Mirrors tile-painter.js logic exactly but runs in Web Workers.

import { rand2, smoothNoise } from '../core/random.js';
import { paletteFor } from './palette.js';
import { cliffLevel } from '../world/terrain-shaper.js';
import { WANG_SUFFIX, TRANSITIONS_BASE, BIOME_INTERIOR, BIOME_CLIFF } from './wang-image-list.js';

// Cliff overlay wang index mapping — matches PixelLab's cliff tile ordering.
// Differs from terrain CORNER_TO_WANG because cliff tiles have their own layout.
var CLIFF_CORNER_TO_WANG = [7,9,14,0,10,2,3,11,1,15,8,6,12,4,5,13];
var WATER_BIOMES = { ocean: 1, deep_ocean: 1, shallow_water: 1, river: 1, lake: 1 };

function getWangSrc(tile, variant) {
  if (!variant) variant = 'wang';
  var mask = tile.wangEdgeMask;
  if (mask === undefined) mask = 0;
  if (tile.transitionPair) {
    var pair = tile.transitionPair;
    var dir = pair.dir;
    // For flat wang, use alphabetical dir (only one direction on disk for s0.0)
    // and adjust mask if from biome is alphabetically second
    if (variant === 'wang') {
      var sorted = [pair.from, pair.to].sort();
      dir = sorted[0] + '_to_' + sorted[1];
      // wangEdgeMask was computed with 1=upper-elevation biome.
      // If from(lower-elev) is alphabetically second, the mask is inverted
      // relative to the alphabetical dir where 1=upper=second biome.
      if (pair.from !== sorted[0]) {
        mask = 15 - mask;
      }
    }
    // No water/cliff suppression — let wang transition tiles render naturally.
    // The cliff overlay system handles cliff face rendering separately.
    return TRANSITIONS_BASE + dir + '/' + variant + '/' + dir + '__wang_' + mask + WANG_SUFFIX;
  }
  if (tile.nearestTransitionPair) {
    var np = tile.nearestTransitionPair;
    var npDir = [np.from, np.to].sort();
    var nearDir = npDir[0] + '_to_' + npDir[1];
    // Use tile's biome position in the alphabetical pair
    var intMask2 = tile.biome === npDir[0] ? 0 : 15;
    return TRANSITIONS_BASE + nearDir + '/wang/' + nearDir + '__wang_' + intMask2 + WANG_SUFFIX;
  }
  var interior = BIOME_INTERIOR[tile.biome];
  if (interior) {
    return TRANSITIONS_BASE + interior.dir + '/wang/' + interior.dir + '__wang_' + interior.mask + WANG_SUFFIX;
  }
  return null;
}

export { getWangSrc };

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

function coherentPatch(wx, wy, biome) {
  // smoothNoise requires (x, y, scale, salt, seed) — use scale=1, salt=0 for direct coords
  var v = smoothNoise(wx * 0.17 + biome.length * 0.3, wy * 0.17 + biome.length * 0.3, 1, 0);
  if (isNaN(v)) return 0.5;
  return Math.abs(v);
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
