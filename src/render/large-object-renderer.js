// Field 6 — Large objects (trees, boulders, structures)
// Drawn on main thread per-frame, y-sorted with the player.
// Uses deterministic placement from tile data (rand2-based).

import { WORLD } from '../core/constants.js';
import { rand2 } from '../core/random.js';
import { LG_BIOME_OBJECTS_LIST, LG_BASE_PATH, LG_VARIANT_COUNT } from './wang-image-list.js';
import { floorDiv } from '../world/chunk.js';
import { getBuildingHeightMask, sampleHeight } from './building-shadow.js';
import { onSceneDiscontinuity } from '../core/scene-teardown.js';

// Water biomes don't get large objects
var WATER_BIOMES = { ocean: 1, deep_ocean: 1, shallow_water: 1, river: 1, lake: 1, stream: 1 };

// Per-object sizing in WORLD TILES (uniform square — sprites are 64x64).
var OBJECT_SIZE = {
  // Large trees
  ancient_oak: 5,  gnarled_elm: 5,  strangler_fig: 5,  oak: 5,  spirit_tree: 5,
  banyan: 5,  jungle_tree: 5,  coconut_palm: 5,  cypress: 5,  spruce: 5,
  // Medium trees
  birch: 4,  maple: 4,  cherry_blossom: 4,  meadow_oak: 4,  beach_palm: 4,
  date_palm: 4,  frost_cedar: 4,  snow_pine: 4,  dead_willow: 4,  crystal_tree: 4,
  apple_tree: 4,  baobab: 5,  mangrove: 4,  frozen_tree: 4,
  // Smaller trees / tall objects
  rowan: 4,  scots_pine: 4,  cliff_pine: 4,  mountain_ash: 4,  coastal_pine: 4,
  acacia: 4,  thorny_acacia: 4,  dead_tree: 4,  charred_tree: 4,
  frost_willow: 4,  saguaro: 3,  aether_pillar: 3,  ice_crystal_spire: 3,
  crystal_ice_tower: 4,  stunted_pine: 3,
  // Structures / rocks / short objects
  standing_stone: 3,  stone_monolith: 3,  rock_spire: 3,  ice_pillar: 3,
  obsidian_spike: 3,  sandstone_arch: 3,  twisted_shrub: 3,
  // Low objects
  driftwood: 2,  magma_vent: 2,
};
var DEFAULT_SIZE = 4;

// Per-biome placement density — tuned for visual density, not coverage percentage.
// Forest biomes are dense but the trees are smaller now so it balances.
var LG_DENSITY = {
  forest:          0.025,
  dense_forest:    0.040,
  tropical_forest: 0.035,
  taiga:           0.030,
  grassland:       0.008,
  savanna:         0.006,
  steppe:          0.003,
  desert:          0.003,
  beach:           0.002,
  swamp:           0.020,
  hills:           0.005,
  mountains:       0.004,
  volcanic:        0.004,
  tundra:          0.003,
  arctic:          0.002,
  mystic:          0.025,
};

// Per-biome dominant tree type weighting.
// Instead of equal random across all 3 types, one type dominates (70%)
// to create visual coherence — groves of similar trees, not random salad.
// The dominant type rotates by region (based on large-scale noise).
var DOMINANT_WEIGHT = 0.70; // 70% chance of dominant type, 30% split among others

// Sprite cache: url → Image (loaded or loading)
var spriteCache = new Map();
var loadingSet = new Set();
var badSprites = new Set();

// Evict per-url sprite caches on far teleport so memory doesn't grow unbounded
// as the player roams biomes. Values are usually Images, but may be ImageBitmaps;
// close those first to free GPU memory.
onSceneDiscontinuity(function () {
  for (var v of spriteCache.values()) {
    try { if (v && v.close) v.close(); } catch (e) {}
  }
  spriteCache.clear();
  loadingSet.clear();
  badSprites.clear();
});

// Offscreen canvas for sprite quality validation
var _validationCanvas = null;
var _validationCtx = null;

function getValidationCtx() {
  if (!_validationCanvas) {
    _validationCanvas = document.createElement('canvas');
    _validationCtx = _validationCanvas.getContext('2d', { willReadFrequently: true });
  }
  return _validationCtx;
}

// Reject sprites with landscape baked in or cut-off edges
function validateSprite(img, url) {
  var ctx = getValidationCtx();
  var w = img.naturalWidth || img.width;
  var h = img.naturalHeight || img.height;
  if (w === 0 || h === 0) { badSprites.add(url); return false; }

  _validationCanvas.width = w;
  _validationCanvas.height = h;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0);
  var data = ctx.getImageData(0, 0, w, h).data;

  // Check edges: count opaque pixels on all 4 borders
  var edgeOpaque = 0;
  var edgeTotal = 0;
  for (var x = 0; x < w; x++) {
    if (data[x * 4 + 3] > 20) edgeOpaque++;
    if (data[((h - 1) * w + x) * 4 + 3] > 20) edgeOpaque++;
    edgeTotal += 2;
  }
  for (var y = 0; y < h; y++) {
    if (data[(y * w) * 4 + 3] > 20) edgeOpaque++;
    if (data[(y * w + w - 1) * 4 + 3] > 20) edgeOpaque++;
    edgeTotal += 2;
  }
  if (edgeOpaque / edgeTotal > 0.30) { badSprites.add(url); return false; }

  // Check bottom quarter for baked-in landscape
  var bottomOpaque = 0;
  var bottomTotal = 0;
  var bottomStart = Math.floor(h * 0.75);
  for (var by = bottomStart; by < h; by++) {
    for (var bx = 0; bx < w; bx++) {
      if (data[(by * w + bx) * 4 + 3] > 20) bottomOpaque++;
      bottomTotal++;
    }
  }
  if (bottomOpaque / bottomTotal > 0.85) { badSprites.add(url); return false; }

  return true;
}

function loadSprite(url) {
  if (badSprites.has(url)) return null;
  if (spriteCache.has(url)) return spriteCache.get(url);
  if (loadingSet.has(url)) return null;
  loadingSet.add(url);
  var img = new Image();
  img.src = url;
  img.onload = function() {
    loadingSet.delete(url);
    if (validateSprite(img, url)) {
      spriteCache.set(url, img);
    } else {
      spriteCache.set(url, null);
    }
  };
  img.onerror = function() {
    loadingSet.delete(url);
    spriteCache.set(url, null);
  };
  return null;
}

var lastPreloadKey = '';
export function preloadLargeObjectSprites(biomes) {
  var key = biomes.sort().join(',');
  if (key === lastPreloadKey) return;
  lastPreloadKey = key;
  for (var b = 0; b < biomes.length; b++) {
    var objects = LG_BIOME_OBJECTS_LIST[biomes[b]];
    if (!objects) continue;
    for (var oi = 0; oi < objects.length; oi++) {
      for (var v = 0; v < LG_VARIANT_COUNT; v++) {
        var idx = v < 10 ? '00' + v : (v < 100 ? '0' + v : '' + v);
        var url = LG_BASE_PATH + biomes[b] + '/' + objects[oi] + '/lg__' + biomes[b] + '__' + objects[oi] + '__v' + idx + '.png';
        loadSprite(url);
      }
    }
  }
}

function elevationLift(elevation) {
  return Math.max(0, elevation - 0.35) * 18;
}

function getLargeObjectForTile(tile) {
  if (!tile || WATER_BIOMES[tile.biome]) return null;
  var objects = LG_BIOME_OBJECTS_LIST[tile.biome];
  if (!objects || objects.length === 0) return null;

  var density = LG_DENSITY[tile.biome] || 0.01;
  var vegDensity = tile.layers && tile.layers[6] ? tile.layers[6].vegetationDensity : 0.5;
  var effectiveDensity = density * (0.5 + vegDensity * 0.5);

  var placementRoll = rand2(tile.wx, tile.wy, 6000);
  if (placementRoll > effectiveDensity) return null;

  // Minimum spacing: skip if a neighboring tile already has an object.
  // This prevents trees from piling on top of each other.
  // Check 2 neighbors to enforce ~2-tile minimum gap.
  var neighbor1 = rand2(tile.wx - 1, tile.wy, 6000);
  var neighbor2 = rand2(tile.wx, tile.wy - 1, 6000);
  var neighbor3 = rand2(tile.wx - 1, tile.wy - 1, 6000);
  if (neighbor1 <= effectiveDensity || neighbor2 <= effectiveDensity || neighbor3 <= effectiveDensity) {
    // A neighbor already placed — skip unless we won a tiebreak
    if (rand2(tile.wx, tile.wy, 6001) > 0.15) return null;
  }

  var slope = tile.layers && tile.layers[7] ? (tile.layers[7].slope || 0) : 0;
  if (slope > 0.4) return null;

  // Regional dominant type: use large-scale noise (divide coords by 20) to pick
  // which tree type dominates this region. Creates groves of similar trees.
  var regionX = Math.floor(tile.wx / 20);
  var regionY = Math.floor(tile.wy / 20);
  var dominantIdx = Math.floor(rand2(regionX, regionY, 6060) * objects.length);
  // 70% chance of dominant type, 30% split among others
  var typeRoll = rand2(tile.wx, tile.wy, 6010);
  var typeIdx;
  if (typeRoll < DOMINANT_WEIGHT) {
    typeIdx = dominantIdx;
  } else {
    // Pick from the non-dominant types
    var otherRoll = Math.floor(rand2(tile.wx, tile.wy, 6011) * (objects.length - 1));
    typeIdx = otherRoll >= dominantIdx ? otherRoll + 1 : otherRoll;
  }
  var objectName = objects[typeIdx];

  var variant = Math.floor(rand2(tile.wx, tile.wy, 6020) * LG_VARIANT_COUNT);
  var idx = variant < 10 ? '00' + variant : (variant < 100 ? '0' + variant : '' + variant);
  var url = LG_BASE_PATH + tile.biome + '/' + objectName + '/lg__' + tile.biome + '__' + objectName + '__v' + idx + '.png';

  var jitterX = (rand2(tile.wx, tile.wy, 6030) - 0.5) * 0.6;
  var jitterY = (rand2(tile.wx, tile.wy, 6040) - 0.5) * 0.3;

  // Per-instance size variation (±15%) so not every tree is identical
  var sizeVariation = 0.85 + rand2(tile.wx, tile.wy, 6050) * 0.30;

  var size = OBJECT_SIZE[objectName] || DEFAULT_SIZE;

  return {
    url: url,
    objectName: objectName,
    jitterX: jitterX,
    jitterY: jitterY,
    sizeTiles: size * sizeVariation,
  };
}

// chunkGrid: { baseSX, baseSY, minCX, minCY, chunkPx } from canvas-renderer
export function drawLargeObjects(ctx, chunkStore, player, camera, w, h, chunkGrid) {
  var tilePx = WORLD.tileSize * camera.zoom;

  // Use the EXACT chunk grid from canvas-renderer
  var chunkPx = chunkGrid.chunkPx;
  var baseSX = chunkGrid.baseSX;
  var baseSY = chunkGrid.baseSY;
  var gridMinCX = chunkGrid.minCX;
  var gridMinCY = chunkGrid.minCY;
  var tilePxSnapped = chunkPx / WORLD.chunkSize;

  var camX = player.x * tilePx - w / 2;
  var camY = player.y * tilePx - h / 2 + (camera.elevationOffsetY ?? 0);

  var drawables = [];
  var pad = 10;

  var minWX = Math.floor(camX / tilePx) - pad;
  var minWY = Math.floor(camY / tilePx) - pad;
  var maxWX = Math.ceil((camX + w) / tilePx) + pad;
  var maxWY = Math.ceil((camY + h) / tilePx) + pad;

  var minCX = floorDiv(minWX, WORLD.chunkSize);
  var minCY = floorDiv(minWY, WORLD.chunkSize);
  var maxCX = floorDiv(maxWX, WORLD.chunkSize);
  var maxCY = floorDiv(maxWY, WORLD.chunkSize);

  for (var cy = minCY; cy <= maxCY; cy++) {
    for (var cx = minCX; cx <= maxCX; cx++) {
      var chunk = chunkStore.getIfReady(cx, cy);
      if (!chunk) continue;

      var chunkOriginX = baseSX + (cx - gridMinCX) * chunkPx;
      var chunkOriginY = baseSY + (cy - gridMinCY) * chunkPx;

      var startX = Math.max(0, minWX - cx * WORLD.chunkSize);
      var startY = Math.max(0, minWY - cy * WORLD.chunkSize);
      var endX = Math.min(WORLD.chunkSize, maxWX - cx * WORLD.chunkSize);
      var endY = Math.min(WORLD.chunkSize, maxWY - cy * WORLD.chunkSize);

      for (var ty = startY; ty < endY; ty++) {
        for (var tx = startX; tx < endX; tx++) {
          var tile = chunk.tiles[ty * WORLD.chunkSize + tx];
          var info = getLargeObjectForTile(tile);
          if (!info) continue;

          var img = loadSprite(info.url);
          if (!img) continue;

          var elev = tile.climate ? tile.climate.elevation : 0.35;
          var lift = elevationLift(elev);

          // Size in screen pixels — uniform square, derived from tile grid
          var drawSize = info.sizeTiles * tilePxSnapped;

          // Screen position: bottom-center anchored to tile grid
          var sx = chunkOriginX + (tx + 0.5 + info.jitterX) * tilePxSnapped;
          var sy = chunkOriginY + (ty + 1.0 + info.jitterY) * tilePxSnapped - lift * camera.zoom;

          var sortY = (cy * WORLD.chunkSize + ty) + 1.0 + info.jitterY;

          drawables.push({
            img: img,
            sx: sx,
            sy: sy,
            drawSize: drawSize,
            sortY: sortY,
          });
        }
      }
    }
  }

  var playerSortY = player.y + 0.78;
  drawables.sort(function(a, b) { return a.sortY - b.sortY; });

  var playerDrawn = false;
  ctx.save();
  // Pixel art must stay crisp — no smoothing
  ctx.imageSmoothingEnabled = false;

  var _hmask = getBuildingHeightMask();
  for (var i = 0; i < drawables.length; i++) {
    var d = drawables[i];

    if (!playerDrawn && d.sortY > playerSortY) {
      drawPlayerCallback(ctx, player, camera, w, h);
      playerDrawn = true;
    }

    var dx = Math.round(d.sx);
    var dy = Math.round(d.sy);
    var ds = Math.round(d.drawSize);

    // Shadow — suppressed where a taller building silhouette covers this ground point (grass/tree = ground-level).
    if (!(sampleHeight(_hmask, dx, dy) > 0)) {
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = '#2a2e2b';
      ctx.beginPath();
      ctx.ellipse(dx, dy, ds * 0.30, ds * 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Sprite (square, anchored at bottom-center)
    ctx.globalAlpha = 1.0;
    ctx.drawImage(d.img, dx - (ds >> 1), dy - ds, ds, ds);
  }

  if (!playerDrawn) {
    ctx.imageSmoothingEnabled = false;
    drawPlayerCallback(ctx, player, camera, w, h);
  }
  ctx.restore();

  return drawables.length;
}

var _playerDrawFn = null;
export function setPlayerDrawFn(fn) { _playerDrawFn = fn; }

function drawPlayerCallback(ctx, player, camera, w, h) {
  if (_playerDrawFn) _playerDrawFn(ctx, player, camera, w, h);
}
