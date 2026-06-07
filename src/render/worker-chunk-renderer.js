// Worker-compatible chunk renderer. Takes chunk data + neighbor tiles,
// paints to OffscreenCanvas, returns ImageBitmap.

import { WORLD } from '../core/constants.js';
import { paintTerrainTile, paintCliffOverlay, getWangSrc } from './worker-tile-painter.js';
import { cliffLevel } from '../world/terrain-shaper.js';
import { soilMaterialForBiome } from './wang-image-list.js';
import { rand2 } from '../core/random.js';

// PixelLab wang tile index = NW*8 + NE*4 + SW*2 + SE*1 where 1=upper biome.
// Game cornerMask uses same bit positions but 1=lower biome.
// So wang_index = cornerMask XOR 15 (complement all bits).
var CORNER_TO_WANG = [15,14,13,12,11,10,9,8,7,6,5,4,3,2,1,0];

// Dynamic transition pair — direction determined by elevation.
// For s0.0 (flat/symmetric), uses alphabetical order.
// For s0.25/s0.5/s1.0, lower-elevation biome is 'from', higher is 'to'.
function transitionPairFor(a, b, elevA, elevB) {
  if (a === b) return null;
  var lower, upper;
  if (elevA !== undefined && elevB !== undefined && elevA !== elevB) {
    // Elevation-aware: lower elevation biome is 'from'
    if (elevA <= elevB) { lower = a; upper = b; }
    else { lower = b; upper = a; }
  } else {
    // No elevation difference or not provided: alphabetical (for s0.0 symmetric lookup)
    var sorted = [a, b].sort();
    lower = sorted[0];
    upper = sorted[1];
  }
  return { from: lower, to: upper, dir: lower + '_to_' + upper };
}

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
  if (maxDelta <= 1) return 'wang';
  if (maxDelta <= 3) return 'wang_25';
  if (maxDelta <= 5) return 'wang_50';
  return 'wang_100';
}

var SOIL_BASE_PATH = '/assets/pixelab/landscape_v2/micro/soil/';
var SOIL_VARIANT_COUNT = 64;

// Cache for extracted pixel data from soil blob ImageBitmaps.
// Key: URL, Value: Uint8ClampedArray (32*32*4 RGBA)
var soilPixelCache = new Map();

// Extract RGBA pixel data from an ImageBitmap by drawing to a tiny OffscreenCanvas.
function getSoilPixels(url, imageCache) {
  if (soilPixelCache.has(url)) return soilPixelCache.get(url);
  var bmp = imageCache.get(url);
  if (!bmp) return null;
  var c = new OffscreenCanvas(32, 32);
  var cx = c.getContext('2d', { willReadFrequently: true });
  cx.drawImage(bmp, 0, 0, 32, 32);
  var data = cx.getImageData(0, 0, 32, 32).data;
  soilPixelCache.set(url, data);
  return data;
}

function formatIdx(v) {
  return v < 10 ? '00' + v : (v < 100 ? '0' + v : '' + v);
}

// Prepare blob pixel data + offsets for a given material.
// Returns { blobs: [Uint8ClampedArray...], offsets: [{x,y}...] } or null.
function prepareSoilBlobs(material, wx, wy, imageCache) {
  var blobCount = 4 + Math.floor(rand2(wx, wy, 6020) * 3);
  var blobs = [];
  for (var b = 0; b < blobCount; b++) {
    var v = Math.floor(rand2(wx, wy, 6030 + b) * SOIL_VARIANT_COUNT);
    var url = SOIL_BASE_PATH + material + '/soil__' + material + '__v' + formatIdx(v) + '.png';
    var data = getSoilPixels(url, imageCache);
    if (data) blobs.push(data);
  }
  if (blobs.length === 0) return null;
  var offsets = [];
  for (var oi = 0; oi < blobs.length; oi++) {
    offsets.push({
      x: Math.floor(rand2(wx, wy, 6040 + oi) * 32),
      y: Math.floor(rand2(wx, wy, 6060 + oi) * 32)
    });
  }
  return { blobs: blobs, offsets: offsets };
}

// Sample a soil pixel from blob data at a given position. Returns [r,g,b,a] or null.
function sampleSoilPixel(px, py, wx, wy, blobSet) {
  var blobIdx = ((px * 37 + py * 59 + wx * 13 + wy * 29) & 0x7FFFFFFF) % blobSet.blobs.length;
  var blob = blobSet.blobs[blobIdx];
  var off = blobSet.offsets[blobIdx];
  var sampleX = (px + off.x) & 31;
  var sampleY = (py + off.y) & 31;
  var srcIdx = (sampleY * 32 + sampleX) * 4;
  var r = blob[srcIdx], g = blob[srcIdx + 1], b = blob[srcIdx + 2], a = blob[srcIdx + 3];
  if (a < 10) {
    // Fallback: try next blob
    var altIdx = (blobIdx + 1) % blobSet.blobs.length;
    var altOff = blobSet.offsets[altIdx];
    var altX = (px + altOff.x) & 31;
    var altY = (py + altOff.y) & 31;
    var altSrcIdx = (altY * 32 + altX) * 4;
    r = blobSet.blobs[altIdx][altSrcIdx];
    g = blobSet.blobs[altIdx][altSrcIdx + 1];
    b = blobSet.blobs[altIdx][altSrcIdx + 2];
    a = blobSet.blobs[altIdx][altSrcIdx + 3];
    if (a < 10) return null;
  }
  return [r, g, b, a];
}

// Apply soil field to entire chunk in one pass.
// Handles both interior tiles (single material) and transition tiles (two materials split by corner mask).
function applySoilFieldToChunk(ctx, chunk, canvasSize, tileSize, chunkSize, imageCache) {
  var imageData = ctx.getImageData(0, 0, canvasSize, canvasSize);
  var pixels = imageData.data;
  var stride = canvasSize * 4;
  var anySoil = false;

  // Cache blob sets per material so we don't re-prepare for repeated materials
  var blobCache = new Map();

  for (var ty = 0; ty < chunkSize; ty++) {
    for (var tx = 0; tx < chunkSize; tx++) {
      var tile = chunk.tiles[ty * chunkSize + tx];
      var wx = chunk.cx * chunkSize + tx;
      var wy = chunk.cy * chunkSize + ty;
      var micro = tile.layers ? tile.layers[6] : null;
      var moisture = tile.climate ? tile.climate.moisture : 0.5;
      var fertility = micro ? micro.fertility : 0.5;

      var density = 0.93 + moisture * 0.03 + fertility * 0.02;
      if (density > 0.98) density = 0.98;
      var soilAlpha = 0.6 + moisture * 0.2;

      var isTransition = !!tile.transitionPair;
      var materialA, materialB, blobSetA, blobSetB;
      // Corner mask bits: NW=8, NE=4, SW=2, SE=1. Bit=1 means "from/lower" biome.
      var cornerNW, cornerNE, cornerSW, cornerSE;

      if (isTransition) {
        var fromBiome = tile.transitionPair.from;
        var toBiome = tile.transitionPair.to;
        materialA = soilMaterialForBiome(fromBiome);
        materialB = soilMaterialForBiome(toBiome);

        // Corner values: 1 = from biome (materialA), 0 = to biome (materialB)
        var cm = tile.wangEdgeMask !== undefined ? tile.wangEdgeMask : 0;
        // wangEdgeMask is the WANG index (0-15). We need cornerMask.
        // cornerMask = 15 - wangEdgeMask (complement)
        var cornerMask = 15 - cm;
        cornerNW = (cornerMask >> 3) & 1;
        cornerNE = (cornerMask >> 2) & 1;
        cornerSW = (cornerMask >> 1) & 1;
        cornerSE = cornerMask & 1;
      } else {
        materialA = soilMaterialForBiome(tile.biome);
        materialB = null;
      }

      // Prepare blob sets (cached by material+position for variety)
      var keyA = materialA + '_' + wx + '_' + wy;
      if (!blobCache.has(keyA)) blobCache.set(keyA, prepareSoilBlobs(materialA, wx, wy, imageCache));
      blobSetA = blobCache.get(keyA);
      if (!blobSetA) continue;

      if (materialB && materialB !== materialA) {
        var keyB = materialB + '_' + wx + '_' + wy + '_B';
        if (!blobCache.has(keyB)) blobCache.set(keyB, prepareSoilBlobs(materialB, wx, wy + 7000, imageCache));
        blobSetB = blobCache.get(keyB);
      } else {
        blobSetB = blobSetA;
      }

      anySoil = true;
      var baseX = tx * tileSize;
      var baseY = ty * tileSize;

      for (var py = 0; py < tileSize; py++) {
        for (var px = 0; px < tileSize; px++) {
          var hash = ((wx * 7919 + wy * 6271 + px * 131 + py * 97) & 0x7FFFFFFF) / 0x7FFFFFFF;
          if (hash > density) continue;

          // Determine which material this pixel belongs to
          var blobSet = blobSetA;
          var transitionFade = 1.0;
          if (isTransition && blobSetB) {
            // Bilinear interpolation of corner values to find boundary
            var u = px / 31;  // 0 at left (W), 1 at right (E)
            var v = py / 31;  // 0 at top (N), 1 at bottom (S)
            var blend = cornerNW * (1 - u) * (1 - v)
                      + cornerNE * u * (1 - v)
                      + cornerSW * (1 - u) * v
                      + cornerSE * u * v;
            // blend > 0.5 means "from" biome (materialA), else "to" biome (materialB)
            blobSet = blend > 0.5 ? blobSetA : blobSetB;

            // Fade out near the transition boundary to keep wang transition art crisp
            // distFromBoundary: 0 at boundary (blend=0.5), 0.5 at corners (blend=0 or 1)
            var distFromBoundary = Math.abs(blend - 0.5);
            // No substrate within ~3px of boundary (dist < 0.1), full at dist >= 0.3
            if (distFromBoundary < 0.08) continue;  // hard skip right at boundary
            transitionFade = Math.min(1.0, (distFromBoundary - 0.08) / 0.22);
          }

          var sample = sampleSoilPixel(px, py, wx, wy, blobSet);
          if (!sample) continue;

          var a = (sample[3] / 255) * soilAlpha * transitionFade;
          var dstIdx = (baseY + py) * stride + (baseX + px) * 4;
          pixels[dstIdx]     = (pixels[dstIdx] * (1 - a) + sample[0] * a + 0.5) | 0;
          pixels[dstIdx + 1] = (pixels[dstIdx + 1] * (1 - a) + sample[1] * a + 0.5) | 0;
          pixels[dstIdx + 2] = (pixels[dstIdx + 2] * (1 - a) + sample[2] * a + 0.5) | 0;
        }
      }
    }
  }

  if (anySoil) ctx.putImageData(imageData, 0, 0);
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
  var tileCount = chunkSize * chunkSize;
  var debugMasks = new Array(tileCount);
  var debugSuccesses = new Array(tileCount);
  var debugSrcs = new Array(tileCount);
  var debugBiomes = new Array(tileCount);
  // 8-layer diagnostic arrays
  var debugNeighbors = new Array(tileCount);
  var debugTransitionDirs = new Array(tileCount);
  var debugTransitionSides = new Array(tileCount);
  var debugCornerMasks = new Array(tileCount);
  var debugVariants = new Array(tileCount);
  var debugCliffLevels = new Array(tileCount);
  var debugInteriorUsed = new Array(tileCount);
  var debugCliffOverlay = new Array(tileCount);

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

      // Transition pair detection — based on the 2×2 wang cell (tile, E, S, SE).
      // The wang mask uses these 4 corners, so the transition pair must match.
      tile.transitionPair = null;
      tile.transitionSide = '';
      tile.nearestTransitionPair = null;
      tile.nearestTransitionSide = '';
      var myEl = tile.climate.elevation;
      // Check the 2×2 cell corners FIRST (these determine the wang mask)
      var cellNbs = [
        { biome: tile.neighborE, el: tile._elE },
        { biome: tile.neighborS, el: tile._elS },
        { biome: tile.neighborSE, el: tile._elSE }
      ];
      for (var ci = 0; ci < cellNbs.length; ci++) {
        if (cellNbs[ci].biome && cellNbs[ci].biome !== tile.biome) {
          var pair = transitionPairFor(tile.biome, cellNbs[ci].biome, myEl, cellNbs[ci].el);
          if (pair) {
            tile.transitionPair = pair;
            tile.transitionSide = tile.biome === pair.from ? 'from' : 'to';
            break;
          }
        }
      }
      // If the 2×2 cell is uniform, check remaining neighbors for transition context
      // (used for visual context but won't affect the wang mask)
      if (!tile.transitionPair) {
        var otherNbs = [
          { biome: tile.neighborN, el: tile._elN },
          { biome: tile.neighborNE, el: tile._elNE },
          { biome: tile.neighborSW, el: tile._elSW },
          { biome: tile.neighborW, el: nbW.climate ? nbW.climate.elevation : myEl },
          { biome: tile.neighborNW, el: nbNW.climate ? nbNW.climate.elevation : myEl }
        ];
        for (var oi = 0; oi < otherNbs.length; oi++) {
          if (otherNbs[oi].biome && otherNbs[oi].biome !== tile.biome) {
            var opair = transitionPairFor(tile.biome, otherNbs[oi].biome, myEl, otherNbs[oi].el);
            if (opair) {
              tile.transitionPair = opair;
              tile.transitionSide = tile.biome === opair.from ? 'from' : 'to';
              break;
            }
          }
        }
      }

      // Same-biome elevation transition: if no cross-biome transition was found
      // but there's an elevation difference in the 2×2 cell, use a self-transition
      // (e.g. grassland_to_grassland) to show the elevation change.
      // Uses a lower threshold (delta >= 1) than cross-biome variants (delta >= 2)
      // because same-biome elevation changes are always real terrain steps.
      if (!tile.transitionPair) {
        var selfMyLevel = cliffLevel(tile.climate.elevation);
        var selfELevel = cliffLevel(tile._elE != null ? tile._elE : tile.climate.elevation);
        var selfSLevel = cliffLevel(tile._elS != null ? tile._elS : tile.climate.elevation);
        var selfSELevel = cliffLevel(tile._elSE != null ? tile._elSE : tile.climate.elevation);
        var selfMaxDelta = Math.max(
          Math.abs(selfMyLevel - selfELevel),
          Math.abs(selfMyLevel - selfSLevel),
          Math.abs(selfMyLevel - selfSELevel),
          Math.abs(selfELevel - selfSLevel),
          Math.abs(selfELevel - selfSELevel),
          Math.abs(selfSLevel - selfSELevel)
        );
        if (selfMaxDelta >= 1) {
          var selfDir = tile.biome + '_to_' + tile.biome;
          tile.transitionPair = { from: tile.biome, to: tile.biome, dir: selfDir };
          var selfMinLevel = Math.min(selfMyLevel, selfELevel, selfSLevel, selfSELevel);
          tile.transitionSide = selfMyLevel === selfMinLevel ? 'from' : 'to';
        }
      }

      // Wang corner mask
      var cornerMask = 0;
      if (tile.transitionPair) {
        var isSelfTransition = tile.transitionPair.from === tile.transitionPair.to;
        if (isSelfTransition) {
          // Same-biome elevation: corners at the MINIMUM cliff level = 'from' (lower)
          // Using cliff levels ensures corners at the same level are treated consistently
          var cNW = cliffLevel(tile.climate.elevation);
          var cNE = cliffLevel(tile._elE != null ? tile._elE : tile.climate.elevation);
          var cSW = cliffLevel(tile._elS != null ? tile._elS : tile.climate.elevation);
          var cSE = cliffLevel(tile._elSE != null ? tile._elSE : tile.climate.elevation);
          var cMin = Math.min(cNW, cNE, cSW, cSE);
          if (cNW === cMin) cornerMask |= 8;
          if (cNE === cMin) cornerMask |= 4;
          if (cSW === cMin) cornerMask |= 2;
          if (cSE === cMin) cornerMask |= 1;
        } else {
          var fb = tile.transitionPair.from;
          if (tile.biome === fb) cornerMask |= 8;
          if (tile.neighborE === fb) cornerMask |= 4;
          if (tile.neighborS === fb) cornerMask |= 2;
          if (tile.neighborSE === fb) cornerMask |= 1;
        }
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

      var variant = elevationVariant(tile);
      // For self-transitions, use lower thresholds since these ARE real elevation steps
      if (tile.transitionPair && tile.transitionPair.from === tile.transitionPair.to && variant === 'wang') {
        // elevationVariant returned 'wang' but we detected a self-transition (delta >= 1)
        // Force wang_25 so the elevation tiles render
        variant = 'wang_25';
      }
      paintTerrainTile(ctx, tile, sx, sy, tileSize, sun, tile.climate.elevation, imageCache, variant);
      paintCliffOverlay(ctx, tile, sx, sy, tileSize, sun, imageCache);

      // Collect debug data
      var idx = y * chunkSize + x;
      var wangSrc = getWangSrc(tile, variant);
      var wangOk = !!(wangSrc && imageCache.get(wangSrc));
      debugMasks[idx] = tile.wangEdgeMask;
      debugSuccesses[idx] = wangOk;
      debugSrcs[idx] = wangSrc || '';
      debugBiomes[idx] = tile.biome;
      // 8-layer diagnostics
      debugNeighbors[idx] = tile.neighborN + ',' + tile.neighborNE + ',' + tile.neighborE + ',' + tile.neighborSE + ',' + tile.neighborS + ',' + tile.neighborSW + ',' + tile.neighborW + ',' + tile.neighborNW;
      debugTransitionDirs[idx] = tile.transitionPair ? tile.transitionPair.dir : (tile.nearestTransitionPair ? '~' + tile.nearestTransitionPair.dir : '');
      debugTransitionSides[idx] = tile.transitionPair ? tile.transitionSide : (tile.nearestTransitionPair ? '~' + tile.nearestTransitionSide : '');
      debugCornerMasks[idx] = cornerMask;
      debugVariants[idx] = variant;
      var myCliff = cliffLevel(tile.climate.elevation);
      var eCliff = cliffLevel(tile._elE != null ? tile._elE : tile.climate.elevation);
      var sCliff = cliffLevel(tile._elS != null ? tile._elS : tile.climate.elevation);
      var seCliff = cliffLevel(tile._elSE != null ? tile._elSE : tile.climate.elevation);
      debugCliffLevels[idx] = myCliff + ',' + eCliff + ',' + sCliff + ',' + seCliff;
      debugInteriorUsed[idx] = !tile.transitionPair && !tile.nearestTransitionPair;
      debugCliffOverlay[idx] = tile._isCliffEdge;
    }
  }

  // Apply soil field overlay in one pass (single getImageData/putImageData)
  applySoilFieldToChunk(ctx, chunk, canvasSize, tileSize, chunkSize, imageCache);

  var bitmap = offscreen.transferToImageBitmap();
  return {
    bitmap: bitmap,
    debug: {
      masks: debugMasks, successes: debugSuccesses, srcs: debugSrcs, biomes: debugBiomes,
      neighbors: debugNeighbors, transitionDirs: debugTransitionDirs, transitionSides: debugTransitionSides,
      cornerMasks: debugCornerMasks, variants: debugVariants, cliffLevels: debugCliffLevels,
      interiorUsed: debugInteriorUsed, cliffOverlay: debugCliffOverlay
    }
  };
}
