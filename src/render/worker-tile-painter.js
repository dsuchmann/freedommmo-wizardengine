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
    var intMask2 = tile.nearestTransitionSide === 'from' ? 6 : 12;
    return TRANSITIONS_BASE + tile.nearestTransitionPair.dir + '/wang/' + tile.nearestTransitionPair.dir + '__wang_' + intMask2 + WANG_SUFFIX;
  }
  var interior = BIOME_INTERIOR[tile.biome];
  if (interior) {
    return TRANSITIONS_BASE + interior.dir + '/wang/' + interior.dir + '__wang_' + interior.mask + WANG_SUFFIX;
  }
  return null;
}

export { getWangSrc };

function paintWangBase(ctx, tile, sx, sy, size, imageCache) {
  var src = getWangSrc(tile);
  if (!src) return;
  var bmp = imageCache.get(src);
  if (!bmp) return;
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

export function paintTerrainTile(ctx, tile, sx, sy, size, sun, focusElevation, imageCache) {
  if (focusElevation === undefined) focusElevation = tile.climate.elevation;
  var palette = paletteFor(tile.biome);
  // Use middle palette color as base (coherentPatch is broken in original too)
  var base = palette[1] || palette[0] || '#888';
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
