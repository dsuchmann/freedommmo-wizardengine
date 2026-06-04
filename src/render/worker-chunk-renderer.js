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
            var farPair = transitionPairFor(tile.biome, far.biome);
            if (farPair) { foundPair = farPair; }
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
