// Worker-compatible chunk renderer. Takes chunk data + neighbor tiles,
// paints to OffscreenCanvas, returns ImageBitmap.

import { WORLD } from '../core/constants.js';
import { paintTerrainTile, paintCliffOverlay, getWangSrc } from './worker-tile-painter.js';
import { cliffLevel } from '../world/terrain-shaper.js';

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

      var variant = elevationVariant(tile);
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
