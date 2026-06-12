// Worker-compatible chunk renderer. Takes chunk data + neighbor tiles,
// paints to OffscreenCanvas, returns ImageBitmap.

// F3 suppression: placement keys that have been taken (sim truth). Set from chunk-worker via
// setF3RemovedKeys(). When sim is absent this stays empty and behaviour is unchanged.
var _f3RemovedKeys = new Set();
export function setF3RemovedKeys(keys) { _f3RemovedKeys = keys instanceof Set ? keys : new Set(keys); }

import { WORLD } from '../core/constants.js';
import { paintTerrainTile, paintCliffOverlay, getWangSrc } from './worker-tile-painter.js';
import { cliffLevel } from '../world/terrain-shaper.js';
import { soilMaterialForBiome, sfVariantsFor, wangAssetName } from './wang-image-list.js';
import { rand2 } from '../core/random.js';
import { SS_BIOME_OBJECTS, f3Placements, f3SpriteUrl } from '../world/decoration-claims.js';

// PixelLab wang tile index = NW*8 + NE*4 + SW*2 + SE*1 where 1=upper biome.
// Game cornerMask uses same bit positions but 1=lower biome.
// So wang_index = cornerMask XOR 15 (complement all bits).
var CORNER_TO_WANG = [15,14,13,12,11,10,9,8,7,6,5,4,3,2,1,0];

// Dynamic transition pair — direction determined by elevation.
// For s0.0 (flat/symmetric), uses alphabetical order.
// For s0.25/s0.5/s1.0, lower-elevation biome is 'from', higher is 'to'.
function transitionPairFor(a, b, elevA, elevB) {
  if (a === b) return null;
  // Biomes sharing the same Wang art (e.g. stream/river) draw no transition
  // between each other — visually they're the same substance.
  if (wangAssetName(a) === wangAssetName(b)) return null;
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
  // dir uses asset-aliased names (stream draws river art); from/to stay real.
  return { from: lower, to: upper, dir: wangAssetName(lower) + '_to_' + wangAssetName(upper) };
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

// Per-biome field 0 rendering parameters
var SOIL_BIOME_CONFIG = {
  // { density, alpha, blobMin, blobMax, tint: [r,g,b] or null }
  // tint shifts pixel color toward target (0-255 RGB), blended at tintStrength (0-1)
  forest:           { density: 0.96, alpha: 0.70, blobMin: 4, blobMax: 6, tint: null },
  dense_forest:     { density: 0.97, alpha: 0.75, blobMin: 4, blobMax: 6, tint: null },
  tropical_forest:  { density: 0.96, alpha: 0.70, blobMin: 4, blobMax: 6, tint: null },
  taiga:            { density: 0.95, alpha: 0.65, blobMin: 4, blobMax: 6, tint: null },
  grassland:        { density: 0.94, alpha: 0.60, blobMin: 4, blobMax: 6, tint: null },
  savanna:          { density: 0.93, alpha: 0.55, blobMin: 3, blobMax: 5, tint: null },
  steppe:           { density: 0.92, alpha: 0.55, blobMin: 3, blobMax: 5, tint: null },
  desert:           { density: 0.96, alpha: 0.50, blobMin: 3, blobMax: 4, tint: null },
  beach:            { density: 0.98, alpha: 0.50, blobMin: 3, blobMax: 4, tint: [245, 235, 200], tintStrength: 0.45 },
  swamp:            { density: 0.97, alpha: 0.80, blobMin: 5, blobMax: 7, tint: null },
  hills:            { density: 0.94, alpha: 0.60, blobMin: 4, blobMax: 7, tint: null },
  mountains:        { density: 0.92, alpha: 0.55, blobMin: 5, blobMax: 8, tint: null },
  volcanic:         { density: 0.90, alpha: 0.60, blobMin: 4, blobMax: 6, tint: null },
  tundra:           { density: 0.97, alpha: 0.75, blobMin: 4, blobMax: 6, tint: null },
  arctic:           { density: 0.88, alpha: 0.50, blobMin: 3, blobMax: 5, tint: null },
  mystic:           { density: 0.95, alpha: 0.65, blobMin: 4, blobMax: 6, tint: null },
  ocean:            { density: 0.96, alpha: 0.50, blobMin: 4, blobMax: 6, tint: null },
  deep_ocean:       { density: 0.95, alpha: 0.45, blobMin: 3, blobMax: 5, tint: null },
  shallow_water:    { density: 0.98, alpha: 0.50, blobMin: 4, blobMax: 6, tint: null },
  river:            { density: 0.96, alpha: 0.50, blobMin: 4, blobMax: 6, tint: null },
  lake:             { density: 0.96, alpha: 0.50, blobMin: 4, blobMax: 6, tint: null },
};
var SOIL_DEFAULT_CONFIG = { density: 0.94, alpha: 0.65, blobMin: 4, blobMax: 6, tint: null };

// Cache for extracted pixel data from soil blob ImageBitmaps.
// Key: URL, Value: Uint8ClampedArray (32*32*4 RGBA)
var soilPixelCache = new Map();

// Shared extraction canvas — one per worker instead of one per soil image
var _soilExtractCanvas = null;
var _soilExtractCtx = null;

// Extract RGBA pixel data from an ImageBitmap by drawing to a tiny OffscreenCanvas.
function getSoilPixels(url, imageCache) {
  if (soilPixelCache.has(url)) return soilPixelCache.get(url);
  var bmp = imageCache.get(url);
  if (!bmp) return null;
  if (!_soilExtractCtx) {
    _soilExtractCanvas = new OffscreenCanvas(32, 32);
    _soilExtractCtx = _soilExtractCanvas.getContext('2d', { willReadFrequently: true });
  }
  _soilExtractCtx.clearRect(0, 0, 32, 32);
  _soilExtractCtx.drawImage(bmp, 0, 0, 32, 32);
  var data = _soilExtractCtx.getImageData(0, 0, 32, 32).data;
  // Validate: under resource pressure (canvas context loss) getImageData returns
  // transparent black. NEVER cache a blank extraction — it permanently poisons
  // this worker's soil cache and produces bare F0 chunks. Return null so the
  // tile is flagged missedSoil and repainted later when extraction succeeds.
  var hasPixels = false;
  for (var i = 3; i < data.length; i += 4) {
    if (data[i] >= 10) { hasPixels = true; break; }
  }
  if (!hasPixels) {
    if (!self._soilBlankWarned) {
      self._soilBlankWarned = true;
      console.warn('[SOIL] blank pixel extraction (canvas context loss?) for', url, '— evicting bitmap, will refetch on repaint');
    }
    // Evict the bitmap too — it may itself be blank (bad decode under pressure).
    // The repaint pass refetches URLs missing from imageCache.
    try { bmp.close(); } catch (e) {}
    imageCache.delete(url);
    return null;
  }
  soilPixelCache.set(url, data);
  return data;
}

function formatIdx(v) {
  return v < 10 ? '00' + v : (v < 100 ? '0' + v : '' + v);
}

// Prepare blob pixel data + offsets for a given material.
// Returns { blobs: [Uint8ClampedArray...], offsets: [{x,y}...] } or null.
function prepareSoilBlobs(material, wx, wy, imageCache, blobMin, blobMax) {
  blobMin = blobMin || 4;
  blobMax = blobMax || 6;
  var blobCount = blobMin + Math.floor(rand2(wx, wy, 6020) * (blobMax - blobMin + 1));
  var blobs = [];
  for (var b = 0; b < blobCount; b++) {
    var v = Math.floor(rand2(wx, wy, 6030 + b) * SOIL_VARIANT_COUNT);
    var url = SOIL_BASE_PATH + material + '/soil__' + material + '__v' + formatIdx(v) + '.png';
    var data = getSoilPixels(url, imageCache);
    if (data) blobs.push(data);
  }
  if (blobs.length === 0) {
    if (!self._soilBlobDebug) self._soilBlobDebug = {};
    if (!self._soilBlobDebug[material]) {
      self._soilBlobDebug[material] = true;
      var testUrl = SOIL_BASE_PATH + material + '/soil__' + material + '__v000.png';
      var allSoilCount = 0;
      imageCache.forEach(function(v, k) { if (k.includes('/soil/')) allSoilCount++; });
      console.log('[SOIL MISS] material:', material, 'url:', testUrl, 'inCache:', imageCache.has(testUrl), 'val:', imageCache.get(testUrl), 'totalSoil:', allSoilCount, 'totalCache:', imageCache.size);
    }
    return null;
  }
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
// randomSample: true for land biomes (fully random coords), false for beach/water (offset-based)
function sampleSoilPixel(px, py, wx, wy, blobSet, randomSample) {
  var blobIdx = ((px * 37 + py * 59 + wx * 13 + wy * 29) & 0x7FFFFFFF) % blobSet.blobs.length;
  var blob = blobSet.blobs[blobIdx];
  var sampleX, sampleY;
  if (randomSample) {
    // Fully random sample position — breaks diagonal patterns in source sprites
    var wpx = wx * 32 + px;
    var wpy = wy * 32 + py;
    sampleX = ((wpx * 73856093 ^ wpy * 19349669) & 0x7FFFFFFF) & 31;
    sampleY = ((wpx * 19349669 ^ wpy * 83492791) & 0x7FFFFFFF) & 31;
  } else {
    var off = blobSet.offsets[blobIdx];
    sampleX = (px + off.x) & 31;
    sampleY = (py + off.y) & 31;
  }
  var srcIdx = (sampleY * 32 + sampleX) * 4;
  var r = blob[srcIdx], g = blob[srcIdx + 1], b = blob[srcIdx + 2], a = blob[srcIdx + 3];
  if (a < 10) {
    // Fallback: try next blob
    var altIdx = (blobIdx + 1) % blobSet.blobs.length;
    var altX, altY;
    if (randomSample) {
      var wpx2 = wx * 32 + px;
      var wpy2 = wy * 32 + py;
      altX = ((wpx2 * 83492791 ^ wpy2 * 73856093) & 0x7FFFFFFF) & 31;
      altY = ((wpx2 * 48611 ^ wpy2 * 29123) & 0x7FFFFFFF) & 31;
    } else {
      var altOff = blobSet.offsets[altIdx];
      altX = (px + altOff.x) & 31;
      altY = (py + altOff.y) & 31;
    }
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
  var missedSoil = false; // true if any tile couldn't paint soil due to missing images
  var soilPixels = 0; // total pixels actually blended — 0 on a land chunk means the loop painted nothing

  // Cache blob sets per material so we don't re-prepare for repeated materials
  var blobCache = new Map();

  for (var ty = 0; ty < chunkSize; ty++) {
    for (var tx = 0; tx < chunkSize; tx++) {
      var tile = chunk.tiles[ty * chunkSize + tx];
      var wx = chunk.cx * chunkSize + tx;
      var wy = chunk.cy * chunkSize + ty;

      var isTransition = !!tile.transitionPair;
      var biomeA, biomeB;
      var materialA, materialB, blobSetA, blobSetB;
      var configA, configB;
      var cornerNW, cornerNE, cornerSW, cornerSE;

      if (isTransition) {
        biomeA = tile.transitionPair.from;
        biomeB = tile.transitionPair.to;
        materialA = soilMaterialForBiome(biomeA);
        materialB = soilMaterialForBiome(biomeB);
        configA = SOIL_BIOME_CONFIG[biomeA] || SOIL_DEFAULT_CONFIG;
        configB = SOIL_BIOME_CONFIG[biomeB] || SOIL_DEFAULT_CONFIG;

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
        biomeA = tile.biome;
        materialA = soilMaterialForBiome(biomeA);
        materialB = null;
        configA = SOIL_BIOME_CONFIG[biomeA] || SOIL_DEFAULT_CONFIG;
        configB = null;
      }

      // Prepare blob sets using per-biome blob count
      var keyA = materialA + '_' + wx + '_' + wy;
      if (!blobCache.has(keyA)) blobCache.set(keyA, prepareSoilBlobs(materialA, wx, wy, imageCache, configA.blobMin, configA.blobMax));
      blobSetA = blobCache.get(keyA);
      if (!blobSetA) { missedSoil = true; continue; }

      if (materialB && materialB !== materialA) {
        var cB = configB || SOIL_DEFAULT_CONFIG;
        var keyB = materialB + '_' + wx + '_' + wy + '_B';
        if (!blobCache.has(keyB)) blobCache.set(keyB, prepareSoilBlobs(materialB, wx, wy + 7000, imageCache, cB.blobMin, cB.blobMax));
        blobSetB = blobCache.get(keyB);
        if (!blobSetB) missedSoil = true;
      } else {
        blobSetB = blobSetA;
      }

      anySoil = true;
      var baseX = tx * tileSize;
      var baseY = ty * tileSize;

      for (var py = 0; py < tileSize; py++) {
        for (var px = 0; px < tileSize; px++) {
          // Determine which biome this pixel belongs to (for transition tiles)
          var blobSet = blobSetA;
          var cfg = configA;
          var transitionFade = 1.0;
          if (isTransition && blobSetB) {
            var u = px / 31;
            var v = py / 31;
            var blend = cornerNW * (1 - u) * (1 - v)
                      + cornerNE * u * (1 - v)
                      + cornerSW * (1 - u) * v
                      + cornerSE * u * v;
            var isFromSide = blend > 0.5;
            blobSet = isFromSide ? blobSetA : blobSetB;
            cfg = isFromSide ? configA : (configB || SOIL_DEFAULT_CONFIG);

            var distFromBoundary = Math.abs(blend - 0.5);
            if (distFromBoundary < 0.08) continue;
            transitionFade = Math.min(1.0, (distFromBoundary - 0.08) / 0.22);
          }

          // Density check using per-biome density.
          // NOTE: must be a true per-pixel hash. The old linear form
          // (wx*7919 + wy*6271 + px*131 + py*97) was near-constant across whole
          // regions — wherever it exceeded density, entire areas painted ZERO soil.
          var hpx = wx * 32 + px;
          var hpy = wy * 32 + py;
          var hash = ((hpx * 73856093 ^ hpy * 19349669) & 0x7FFFFFFF) / 0x7FFFFFFF;
          if (hash > cfg.density) continue;

          // Use random sampling for land biomes to break diagonal sprite patterns
          var currentBiome = isTransition ? (blobSet === blobSetA ? biomeA : biomeB) : biomeA;
          var isWaterOrBeach = currentBiome === 'beach' || currentBiome.includes('ocean') || currentBiome === 'shallow_water' || currentBiome === 'river' || currentBiome === 'lake' || currentBiome === 'stream';
          var sample = sampleSoilPixel(px, py, wx, wy, blobSet, !isWaterOrBeach);
          if (!sample) continue;

          var srcR = sample[0], srcG = sample[1], srcB = sample[2];

          // Apply per-biome color tint if configured
          if (cfg.tint) {
            var ts = cfg.tintStrength || 0.3;
            srcR = (srcR * (1 - ts) + cfg.tint[0] * ts + 0.5) | 0;
            srcG = (srcG * (1 - ts) + cfg.tint[1] * ts + 0.5) | 0;
            srcB = (srcB * (1 - ts) + cfg.tint[2] * ts + 0.5) | 0;
          }

          var a = (sample[3] / 255) * cfg.alpha * transitionFade;
          var dstIdx = (baseY + py) * stride + (baseX + px) * 4;
          pixels[dstIdx]     = (pixels[dstIdx] * (1 - a) + srcR * a + 0.5) | 0;
          pixels[dstIdx + 1] = (pixels[dstIdx + 1] * (1 - a) + srcG * a + 0.5) | 0;
          pixels[dstIdx + 2] = (pixels[dstIdx + 2] * (1 - a) + srcB * a + 0.5) | 0;
          soilPixels++;
        }
      }
    }
  }

  if (anySoil) ctx.putImageData(imageData, 0, 0);
  return { anySoil: anySoil, missedSoil: missedSoil, soilPixels: soilPixels };
}

var GC_BASE_PATH = '/assets/pixelab/landscape_v2/micro/ground_cover/';
var GC_VARIANT_COUNT = 64;

// Ground cover object definitions per biome.
// mode: 'luminance' = texture modulation (no color change, adds surface detail)
//       'sprite'    = placed object (drawn as actual sprite at scattered positions)
// maxShoreDist: null = everywhere, number = only within N tiles of water
var GC_BIOME_OBJECTS = {
  beach: [
    { name: 'wet_sand', mode: 'luminance', strength: 0.20, density: 0.85, maxShoreDist: null },
    { name: 'sea_foam', mode: 'sprite', maxShoreDist: 4, sparsity: 0.82, scale: 0.55 },
    { name: 'tide_line', mode: 'sprite', minShoreDist: 1, maxShoreDist: 5, sparsity: 0.85, scale: 0.50 }
  ],
  // --- FOREST BIOMES ---
  forest: [
    { name: 'fallen_leaves', mode: 'sprite', sparsity: 0.75, scale: 0.50, pattern: 'scattered_even' },
    { name: 'moss_patch', mode: 'sprite', sparsity: 0.80, scale: 0.50, pattern: 'patchy_groups' },
    { name: 'pine_needles', mode: 'sprite', sparsity: 0.70, scale: 0.42, pattern: 'scattered_even' }
  ],
  dense_forest: [
    { name: 'dark_leaf_mat', mode: 'luminance', strength: 0.28, density: 0.85, maxShoreDist: null },
    { name: 'dark_wet_moss', mode: 'sprite', sparsity: 0.75, scale: 0.50, pattern: 'patchy_groups' },
    { name: 'fungal_film', mode: 'sprite', sparsity: 0.80, scale: 0.42, pattern: 'scattered_even' }
  ],
  tropical_forest: [
    { name: 'tropical_leaves', mode: 'sprite', sparsity: 0.75, scale: 0.50, pattern: 'scattered_even' },
    { name: 'bright_green_moss', mode: 'sprite', sparsity: 0.80, scale: 0.50, pattern: 'patchy_groups' },
    { name: 'fern_fronds', mode: 'sprite', sparsity: 0.78, scale: 0.50, pattern: 'scattered_even' }
  ],
  taiga: [
    { name: 'frost_pine_needles', mode: 'luminance', strength: 0.20, density: 0.70, maxShoreDist: null },
    { name: 'frost_lichen', mode: 'sprite', sparsity: 0.80, scale: 0.50, pattern: 'scattered_even' },
    { name: 'bark_chips', mode: 'sprite', sparsity: 0.75, scale: 0.50, pattern: 'patchy_groups' }
  ],
  // --- GRASS/DRY BIOMES ---
  grassland: [
    { name: 'grass_mat', mode: 'sprite', sparsity: 0.65, scale: 0.50, pattern: 'scattered_even' },
    { name: 'clover_patch', mode: 'sprite', sparsity: 0.80, scale: 0.50, pattern: 'patchy_groups' },
    { name: 'golden_thatch', mode: 'sprite', sparsity: 0.70, scale: 0.55, pattern: 'scattered_even' }
  ],
  savanna: [
    { name: 'golden_grass_tuft', mode: 'sprite', sparsity: 0.75, scale: 0.50, pattern: 'patchy_groups' },
    { name: 'cracked_earth', mode: 'sprite', sparsity: 0.80, scale: 0.55, pattern: 'patchy_groups' },
    { name: 'seed_husks', mode: 'sprite', sparsity: 0.80, scale: 0.38, pattern: 'scattered_even' }
  ],
  steppe: [
    { name: 'pale_grass_wisps', mode: 'sprite', sparsity: 0.85, scale: 0.38, pattern: 'scattered_even' },
    { name: 'dust_patch', mode: 'sprite', sparsity: 0.80, scale: 0.50, pattern: 'patchy_groups' },
    { name: 'dried_stems', mode: 'sprite', sparsity: 0.75, scale: 0.42, pattern: 'scattered_even' }
  ],
  desert: [
    { name: 'sand_ripple', mode: 'luminance', strength: 0.18, density: 0.75, maxShoreDist: null },
    { name: 'dust_drift', mode: 'sprite', sparsity: 0.75, scale: 0.50, pattern: 'scattered_even' },
    { name: 'cracked_clay', mode: 'sprite', sparsity: 0.80, scale: 0.55, pattern: 'patchy_groups' }
  ],
  // --- WET BIOMES ---
  swamp: [
    { name: 'algae_film', mode: 'sprite', sparsity: 0.78, scale: 0.50, pattern: 'patchy_groups' },
    { name: 'sphagnum_moss', mode: 'sprite', sparsity: 0.75, scale: 0.50, pattern: 'patchy_groups' },
    { name: 'waterlogged_leaf', mode: 'sprite', sparsity: 0.75, scale: 0.42, pattern: 'scattered_even' }
  ],
  // --- HIGHLAND BIOMES ---
  hills: [
    { name: 'flat_stone', mode: 'sprite', sparsity: 0.75, scale: 0.55, pattern: 'scattered_even' },
    { name: 'brown_moss', mode: 'sprite', sparsity: 0.80, scale: 0.50, pattern: 'patchy_groups' }
  ],
  mountains: [
    { name: 'lichen_crust', mode: 'luminance', strength: 0.18, density: 0.60, maxShoreDist: null },
    { name: 'frost_crystals', mode: 'sprite', sparsity: 0.85, scale: 0.42, pattern: 'scattered_even' },
    { name: 'gravel_scatter', mode: 'sprite', sparsity: 0.65, scale: 0.42, pattern: 'scattered_even' }
  ],
  volcanic: [
    { name: 'ash_film', mode: 'sprite', sparsity: 0.75, scale: 0.42, pattern: 'scattered_even' },
    { name: 'char_crust', mode: 'sprite', sparsity: 0.80, scale: 0.42, pattern: 'patchy_groups' },
    { name: 'pumice_dust', mode: 'sprite', sparsity: 0.85, scale: 0.30, pattern: 'scattered_even' }
  ],
  // --- POLAR BIOMES ---
  tundra: [
    { name: 'frozen_moss', mode: 'sprite', sparsity: 0.85, scale: 0.50, pattern: 'patchy_groups' },
    { name: 'ice_crust', mode: 'sprite', sparsity: 0.80, scale: 0.55, pattern: 'scattered_even' },
    { name: 'dead_lichen', mode: 'sprite', sparsity: 0.80, scale: 0.42, pattern: 'scattered_even' }
  ],
  arctic: [
    { name: 'frost_pattern', mode: 'luminance', strength: 0.18, density: 0.65, maxShoreDist: null },
    { name: 'ice_crystals', mode: 'sprite', sparsity: 0.80, scale: 0.45, pattern: 'scattered_even' },
    { name: 'snow_crust', mode: 'sprite', sparsity: 0.75, scale: 0.55, pattern: 'patchy_groups' }
  ],
  // --- MYSTIC ---
  mystic: [
    { name: 'glowing_moss', mode: 'sprite', sparsity: 0.85, scale: 0.50, pattern: 'patchy_groups' },
    { name: 'aether_tendril', mode: 'sprite', sparsity: 0.80, scale: 0.50, pattern: 'scattered_even' },
    { name: 'crystal_dust', mode: 'sprite', sparsity: 0.75, scale: 0.38, pattern: 'scattered_even' }
  ],
  shallow_water: [
    { name: 'ripple_pattern', mode: 'luminance', strength: 0.15, density: 0.75, maxShoreDist: null },
    { name: 'sand_shimmer', mode: 'luminance', strength: 0.12, density: 0.60, maxShoreDist: null },
    // seaweed_strand: animated on main thread (water-wave-overlay.js), not baked into chunk bitmap
  ],
  ocean: [
    { name: 'wave_foam', mode: 'luminance', strength: 0.15, density: 0.70, maxShoreDist: null },
    { name: 'light_caustic', mode: 'luminance', strength: 0.10, density: 0.55, maxShoreDist: null },
    { name: 'floating_debris', mode: 'sprite', maxShoreDist: null, sparsity: 0.97 }
  ],
  deep_ocean: [
    { name: 'dark_current', mode: 'luminance', strength: 0.10, density: 0.60, maxShoreDist: null },
    { name: 'bioluminescence', mode: 'luminance', strength: 0.08, density: 0.40, maxShoreDist: null }
  ],
  river: [
    { name: 'flow_streaks', mode: 'luminance', strength: 0.15, density: 0.70, maxShoreDist: null },
    { name: 'bubble_trail', mode: 'luminance', strength: 0.10, density: 0.50, maxShoreDist: null },
    { name: 'river_foam', mode: 'sprite', maxShoreDist: null, sparsity: 0.95 }
  ],
  lake: [
    { name: 'soft_ripple', mode: 'luminance', strength: 0.12, density: 0.65, maxShoreDist: null },
    { name: 'light_dapple', mode: 'luminance', strength: 0.10, density: 0.50, maxShoreDist: null },
    { name: 'lily_pad', mode: 'sprite', maxShoreDist: 6, sparsity: 0.93 }
  ],
};

// Compute distance-to-water for every tile in a chunk.
function computeShoreDistanceMap(chunk, chunkSize) {
  var size = chunkSize * chunkSize;
  var dist = new Float32Array(size);
  dist.fill(255);
  for (var i = 0; i < size; i++) {
    var b = chunk.tiles[i].biome;
    if (b.includes('ocean') || b === 'shallow_water' || b === 'river' || b === 'lake') dist[i] = 0;
  }
  for (var y = 0; y < chunkSize; y++) {
    for (var x = 0; x < chunkSize; x++) {
      var idx = y * chunkSize + x;
      if (x > 0 && dist[idx - 1] + 1 < dist[idx]) dist[idx] = dist[idx - 1] + 1;
      if (y > 0 && dist[idx - chunkSize] + 1 < dist[idx]) dist[idx] = dist[idx - chunkSize] + 1;
      if (x > 0 && y > 0 && dist[idx - chunkSize - 1] + 1.41 < dist[idx]) dist[idx] = dist[idx - chunkSize - 1] + 1.41;
      if (x < chunkSize - 1 && y > 0 && dist[idx - chunkSize + 1] + 1.41 < dist[idx]) dist[idx] = dist[idx - chunkSize + 1] + 1.41;
    }
  }
  for (var y = chunkSize - 1; y >= 0; y--) {
    for (var x = chunkSize - 1; x >= 0; x--) {
      var idx = y * chunkSize + x;
      if (x < chunkSize - 1 && dist[idx + 1] + 1 < dist[idx]) dist[idx] = dist[idx + 1] + 1;
      if (y < chunkSize - 1 && dist[idx + chunkSize] + 1 < dist[idx]) dist[idx] = dist[idx + chunkSize] + 1;
      if (x < chunkSize - 1 && y < chunkSize - 1 && dist[idx + chunkSize + 1] + 1.41 < dist[idx]) dist[idx] = dist[idx + chunkSize + 1] + 1.41;
      if (x > 0 && y < chunkSize - 1 && dist[idx + chunkSize - 1] + 1.41 < dist[idx]) dist[idx] = dist[idx + chunkSize - 1] + 1.41;
    }
  }
  return dist;
}

// Precompute luminance arrays from ground cover sprites.
// Returns array of { lum: Float32Array(1024), alpha: Uint8ClampedArray(1024) }
function prepareLuminanceBlobs(biome, objName, wx, wy, imageCache, count) {
  var blobs = [];
  for (var b = 0; b < count; b++) {
    var v = Math.floor(rand2(wx, wy, 7030 + b) * GC_VARIANT_COUNT);
    var url = GC_BASE_PATH + biome + '/' + objName + '/gc__' + biome + '__' + objName + '__v' + formatIdx(v) + '.png';
    var rgba = getSoilPixels(url, imageCache);
    if (!rgba) continue;
    // Extract luminance (0-1) and alpha from sprite
    var lum = new Float32Array(1024);
    var alpha = new Uint8Array(1024);
    for (var i = 0; i < 1024; i++) {
      var ri = i * 4;
      // Luminance: perceived brightness (0.299R + 0.587G + 0.114B) normalized to -0.5..+0.5
      lum[i] = (rgba[ri] * 0.299 + rgba[ri + 1] * 0.587 + rgba[ri + 2] * 0.114) / 255.0 - 0.5;
      alpha[i] = rgba[ri + 3];
    }
    blobs.push({ lum: lum, alpha: alpha });
  }
  return blobs;
}

// Simple world-space hash for continuous blob selection across tile boundaries
function worldHash(worldX, worldY, salt) {
  return ((worldX * 73856093 + worldY * 19349669 + salt * 83492791) & 0x7FFFFFFF) / 0x7FFFFFFF;
}

// Apply ground cover field to entire chunk (Field 1).
// Two modes: luminance modulation (texture) and sprite placement (objects).
function applyGroundCoverToChunk(ctx, chunk, canvasSize, tileSize, chunkSize, imageCache, occupancy, cellsPerTile, cellPx, gridW) {
  // Quick check: does any tile in this chunk have ground cover defined?
  var hasGC = false;
  for (var i = 0; i < chunk.tiles.length; i++) {
    if (GC_BIOME_OBJECTS[chunk.tiles[i].biome]) { hasGC = true; break; }
  }
  if (!hasGC) return;

  var shoreDistMap = computeShoreDistanceMap(chunk, chunkSize);

  // === LUMINANCE MODULATION PASS ===
  var imageData = ctx.getImageData(0, 0, canvasSize, canvasSize);
  var pixels = imageData.data;
  var stride = canvasSize * 4;
  var anyLum = false;

  // Pre-build luminance blob cache keyed by biome+object (shared across all tiles of same biome)
  var lumCache = new Map();

  for (var ty = 0; ty < chunkSize; ty++) {
    for (var tx = 0; tx < chunkSize; tx++) {
      var tile = chunk.tiles[ty * chunkSize + tx];
      var biomeObjs = GC_BIOME_OBJECTS[tile.biome];
      if (!biomeObjs) continue;
      // Skip transition tiles EXCEPT for water-adjacent biomes where ground cover is essential
      var skipTransition = tile.transitionPair && tile.biome !== 'beach' && tile.biome !== 'swamp';
      if (skipTransition) continue;

      var wx = chunk.cx * chunkSize + tx;
      var wy = chunk.cy * chunkSize + ty;
      var shoreDist = shoreDistMap[ty * chunkSize + tx];
      var baseX = tx * tileSize;
      var baseY = ty * tileSize;

      for (var oi = 0; oi < biomeObjs.length; oi++) {
        var obj = biomeObjs[oi];
        if (obj.mode !== 'luminance') continue;
        if (obj.maxShoreDist !== null && shoreDist > obj.maxShoreDist) continue;

        // Get or create luminance blobs for this biome+object
        var lumKey = tile.biome + '/' + obj.name;
        if (!lumCache.has(lumKey)) {
          lumCache.set(lumKey, prepareLuminanceBlobs(tile.biome, obj.name, 0, 0, imageCache, 6));
        }
        var lumBlobs = lumCache.get(lumKey);
        if (lumBlobs.length === 0) continue;

        var strength = obj.strength || 0.20;
        // Shore distance modulation
        if (obj.maxShoreDist !== null) {
          strength *= 1.0 - Math.min(1.0, shoreDist / obj.maxShoreDist);
        }

        anyLum = true;

        for (var py = 0; py < tileSize; py++) {
          for (var px = 0; px < tileSize; px++) {
            // World-space pixel coordinates (continuous across tiles)
            var worldPx = baseX + px + chunk.cx * chunkSize * tileSize;
            var worldPy = baseY + py + chunk.cy * chunkSize * tileSize;

            // Density check
            var hash = worldHash(worldPx, worldPy, 8001);
            if (hash > obj.density) continue;

            // World-space blob selection (continuous, no tile boundary)
            var blobIdx = (worldHash(worldPx, worldPy, 8002) * lumBlobs.length) | 0;
            if (blobIdx >= lumBlobs.length) blobIdx = lumBlobs.length - 1;
            var blob = lumBlobs[blobIdx];

            // World-space offset — different patterns for water vs land biomes
            var offX, offY;
            if (tile.biome === 'beach' || tile.biome.includes('ocean') || tile.biome === 'shallow_water' || tile.biome === 'river' || tile.biome === 'lake') {
              // Water/beach: directional swirls (wave-like)
              var swirl1 = Math.sin(worldPx * 0.08 + worldPy * 0.05) * 4;
              var swirl2 = Math.sin(worldPx * 0.03 - worldPy * 0.07 + 2.1) * 6;
              var swirl3 = Math.cos(worldPx * 0.015 + worldPy * 0.02 + 0.7) * 8;
              offX = ((worldPx * 7 + 13 + swirl1 + swirl3) & 31);
              offY = ((worldPy * 11 + 7 + swirl2 - swirl3) & 31);
            } else {
              // Land: fully random sample position — breaks any source sprite patterns
              var hx = ((worldPx * 73856093 ^ worldPy * 19349669) & 0x7FFFFFFF);
              var hy = ((worldPx * 19349669 ^ worldPy * 83492791) & 0x7FFFFFFF);
              offX = (hx & 31) - px;
              offY = (hy & 31) - py;
            }
            var sampleIdx = ((py + offY) & 31) * 32 + ((px + offX) & 31);

            if (blob.alpha[sampleIdx] < 10) continue;

            // Luminance modulation: darken or lighten existing pixel
            var lumVal = blob.lum[sampleIdx] * strength;
            var dstIdx = (baseY + py) * stride + (baseX + px) * 4;
            pixels[dstIdx]     = Math.max(0, Math.min(255, (pixels[dstIdx] + lumVal * 255 + 0.5) | 0));
            pixels[dstIdx + 1] = Math.max(0, Math.min(255, (pixels[dstIdx + 1] + lumVal * 255 + 0.5) | 0));
            pixels[dstIdx + 2] = Math.max(0, Math.min(255, (pixels[dstIdx + 2] + lumVal * 255 + 0.5) | 0));
          }
        }
      }
    }
  }

  if (anyLum) ctx.putImageData(imageData, 0, 0);

  // === SPRITE PLACEMENT PASS ===
  // Objects check the chunk-wide occupancy grid before placing.
  // After placing, they mark the cells they cover as occupied.
  // This prevents graphical overlap across ALL fields.

  for (var ty = 0; ty < chunkSize; ty++) {
    for (var tx = 0; tx < chunkSize; tx++) {
      var tile = chunk.tiles[ty * chunkSize + tx];
      var biomeObjs = GC_BIOME_OBJECTS[tile.biome];
      if (!biomeObjs) continue;
      var skipTransition2 = tile.transitionPair && tile.biome !== 'beach' && tile.biome !== 'swamp';
      if (skipTransition2) continue;

      var wx = chunk.cx * chunkSize + tx;
      var wy = chunk.cy * chunkSize + ty;
      var tileIdx = ty * chunkSize + tx;
      var shoreDist = shoreDistMap[tileIdx];

      for (var oi = 0; oi < biomeObjs.length; oi++) {
        var obj = biomeObjs[oi];
        if (obj.mode !== 'sprite') continue;
        if (obj.maxShoreDist !== null && shoreDist > obj.maxShoreDist) continue;
        if (obj.minShoreDist !== undefined && shoreDist < obj.minShoreDist) continue;

        var sparsity = obj.sparsity || 0.90;
        var shoreBoost = obj.maxShoreDist ? (1.0 - shoreDist / obj.maxShoreDist) * 0.15 : 0;
        if (rand2(wx, wy, 8500 + oi) > (1.0 - sparsity + shoreBoost)) continue;

        // Pick variant
        var v = Math.floor(rand2(wx, wy, 8510 + oi) * GC_VARIANT_COUNT);
        var url = GC_BASE_PATH + tile.biome + '/' + obj.name + '/gc__' + tile.biome + '__' + obj.name + '__v' + formatIdx(v) + '.png';
        var bmp = imageCache.get(url);
        if (!bmp) continue;

        // Compute draw position
        var jitterX = (rand2(wx, wy, 8520 + oi) - 0.5) * tileSize * 0.5;
        var jitterY = (rand2(wx, wy, 8530 + oi) - 0.5) * tileSize * 0.5;
        var proximity = obj.maxShoreDist ? 1.0 - Math.min(1.0, shoreDist / obj.maxShoreDist) : 1.0;
        var baseScale = obj.scale || (0.5 + proximity * 0.5);
        var drawSize = tileSize * baseScale;

        // Compute which occupancy cells this sprite would cover
        var drawCenterX = tx * tileSize + tileSize * 0.5 + jitterX;
        var drawCenterY = ty * tileSize + tileSize * 0.5 + jitterY;
        var halfDraw = drawSize * 0.5;
        var cellMinX = Math.max(0, Math.floor((drawCenterX - halfDraw) / cellPx));
        var cellMinY = Math.max(0, Math.floor((drawCenterY - halfDraw) / cellPx));
        var cellMaxX = Math.min(gridW - 1, Math.floor((drawCenterX + halfDraw) / cellPx));
        var cellMaxY = Math.min(gridW - 1, Math.floor((drawCenterY + halfDraw) / cellPx));

        // Check occupancy: if >40% of target cells are taken, skip this placement
        var totalCells = 0;
        var occupiedCells = 0;
        for (var cy2 = cellMinY; cy2 <= cellMaxY; cy2++) {
          for (var cx2 = cellMinX; cx2 <= cellMaxX; cx2++) {
            totalCells++;
            if (occupancy[cy2 * gridW + cx2]) occupiedCells++;
          }
        }
        if (totalCells > 0 && occupiedCells / totalCells > 0.40) continue;

        // Place the sprite
        var sx = tx * tileSize;
        var sy = ty * tileSize;
        var distL = tx > 0 ? shoreDistMap[tileIdx - 1] : shoreDist;
        var distR = tx < chunkSize - 1 ? shoreDistMap[tileIdx + 1] : shoreDist;
        var distU = ty > 0 ? shoreDistMap[tileIdx - chunkSize] : shoreDist;
        var distD = ty < chunkSize - 1 ? shoreDistMap[tileIdx + chunkSize] : shoreDist;
        var shoreAngle = Math.atan2(-(distR - distL), distD - distU);

        ctx.save();
        ctx.translate(drawCenterX, drawCenterY);
        ctx.rotate(shoreAngle + (rand2(wx, wy, 8540 + oi) - 0.5) * 0.4);
        ctx.globalAlpha = 0.6 + proximity * 0.3;
        if (obj.underwaterTint) {
          ctx.globalAlpha *= 0.7;
          ctx.filter = 'saturate(0.7) brightness(0.85) sepia(0.15) hue-rotate(180deg)';
        }
        ctx.drawImage(bmp, -halfDraw, -halfDraw, drawSize, drawSize);
        if (obj.underwaterTint) ctx.filter = 'none';
        ctx.globalAlpha = 1.0;
        ctx.restore();

        // Mark occupancy cells as taken
        for (var cy3 = cellMinY; cy3 <= cellMaxY; cy3++) {
          for (var cx3 = cellMinX; cx3 <= cellMaxX; cx3++) {
            occupancy[cy3 * gridW + cx3] = 1;
          }
        }
        break; // This tile placed an object — don't try more object types on same tile
      }
    }
  }
}

// === FIELD 2: SMALL FLORA ===
// Small vegetation sprites (grass, ferns, flowers) placed per-tile.
// Static base rendering — wind sway animations will draw on main thread later.
var SF_BIOME_OBJECTS = {
  arctic: [
    { name: 'frost_flower', sparsity: 0.94, scale: 0.55 },
    { name: 'frozen_grass', sparsity: 0.90, scale: 0.50 },
    { name: 'ice_needle', sparsity: 0.92, scale: 0.45 },
  ],
  beach: [
    { name: 'beach_weed', sparsity: 0.94, scale: 0.50 },
    { name: 'dune_grass', sparsity: 0.91, scale: 0.55 },
    { name: 'sea_oat', sparsity: 0.95, scale: 0.55 },
  ],
  dense_forest: [
    { name: 'shade_fern', sparsity: 0.72, scale: 0.55 },
    { name: 'dark_herb', sparsity: 0.78, scale: 0.50 },
    { name: 'bracket_fungus', sparsity: 0.85, scale: 0.45 },
  ],
  desert: [
    { name: 'sand_grass', sparsity: 0.88, scale: 0.45 },
  ],
  forest: [
    { name: 'grass_blade_cluster', sparsity: 0.70, scale: 0.50 },
    { name: 'small_fern', sparsity: 0.75, scale: 0.55 },
    { name: 'clover_bloom', sparsity: 0.80, scale: 0.45 },
  ],
  grassland: [
    { name: 'tall_grass_blade', sparsity: 0.68, scale: 0.55 },
    { name: 'dandelion_stem', sparsity: 0.82, scale: 0.45 },
    { name: 'wild_herb', sparsity: 0.78, scale: 0.50 },
  ],
  hills: [
    { name: 'heather_sprig', sparsity: 0.80, scale: 0.55 },
  ],
  mountains: [
    { name: 'alpine_tuft', sparsity: 0.985, scale: 0.50 },
    { name: 'hardy_lichen', sparsity: 0.985, scale: 0.45 },
  ],
  mystic: [
    { name: 'glow_grass_blade', sparsity: 0.75, scale: 0.50 },
    { name: 'aether_fern', sparsity: 0.80, scale: 0.55 },
    { name: 'crystal_sprout', sparsity: 0.85, scale: 0.50 },
  ],
  savanna: [
    { name: 'dry_grass_spike', sparsity: 0.78, scale: 0.55 },
    { name: 'thorn_sprout', sparsity: 0.85, scale: 0.45 },
    { name: 'acacia_seedling', sparsity: 0.92, scale: 0.50 },
  ],
  steppe: [
    { name: 'sparse_weed', sparsity: 0.82, scale: 0.50 },
    { name: 'dry_tuft', sparsity: 0.88, scale: 0.42 },
  ],
  swamp: [
    { name: 'swamp_herb', sparsity: 0.80, scale: 0.50 },
  ],
  taiga: [
    { name: 'frost_grass', sparsity: 0.78, scale: 0.55 },
    { name: 'low_juniper', sparsity: 0.85, scale: 0.50 },
    { name: 'cold_moss_tuft', sparsity: 0.80, scale: 0.50 },
  ],
  tropical_forest: [
    { name: 'broad_fern', sparsity: 0.72, scale: 0.60 },
    { name: 'orchid_sprout', sparsity: 0.85, scale: 0.45 },
    { name: 'vine_tendril', sparsity: 0.78, scale: 0.50 },
  ],
  tundra: [
    { name: 'tundra_grass', sparsity: 0.88, scale: 0.45 },
    { name: 'low_berry_bush', sparsity: 0.93, scale: 0.50 },
  ],
  volcanic: [
    { name: 'heat_sprout', sparsity: 0.997, scale: 0.50 },
    { name: 'lava_fern', sparsity: 0.996, scale: 0.50 },
  ],
};
var SF_BASE_PATH = '/assets/pixelab/landscape_v2/micro/small_flora/';
var SF_VARIANT_COUNT = 64;

function applySmallFloraToChunk(ctx, chunk, tileSize, chunkSize, imageCache) {
  // Field 2: Dense vegetation layer — Ghost of Tsushima style.
  // Object A (grass) is placed 3-4 times per tile at sub-tile positions,
  // creating a dense carpet of overlapping individual blades.
  // Objects B, C (flowers, ferns) occasionally replace one of the grass placements.
  // Coverage driven by tile vegetation density and fertility.

  var halfTile = tileSize >> 1;

  for (var ty = 0; ty < chunkSize; ty++) {
    for (var tx = 0; tx < chunkSize; tx++) {
      var tile = chunk.tiles[ty * chunkSize + tx];
      var biomeObjs = SF_BIOME_OBJECTS[tile.biome];
      if (!biomeObjs) continue;
      if (tile.transitionPair) continue;

      var wx = chunk.cx * chunkSize + tx;
      var wy = chunk.cy * chunkSize + ty;

      var vegDensity = tile.layers && tile.layers[6] ? tile.layers[6].vegetationDensity : 0.5;
      var fertility = tile.layers && tile.layers[6] ? tile.layers[6].fertility : 0.5;

      // Skip tiles with very low vegetation potential
      if (vegDensity < 0.08 && fertility < 0.10) continue;

      // How many blades to place on this tile (2-4 based on fertility)
      var bladeCount = 2 + Math.floor(fertility * 2.5);
      var sx = tx * tileSize;
      var sy = ty * tileSize;

      for (var bi = 0; bi < bladeCount; bi++) {
        // Per-blade coverage check — sparser in arid biomes
        var bladeCoverage = 0.50 + vegDensity * 0.35 + fertility * 0.15;
        if (rand2(wx, wy, 7000 + bi) > bladeCoverage) continue;

        // Pick species: 90% grass (Object A), 7% Object B, 3% Object C
        var speciesRoll = rand2(wx, wy, 7010 + bi * 100);
        var oi;
        if (biomeObjs.length === 1) {
          oi = 0;
        } else if (biomeObjs.length === 2) {
          oi = speciesRoll < 0.90 ? 0 : 1;
        } else {
          if (speciesRoll < 0.90) oi = 0;
          else if (speciesRoll < 0.97) oi = 1;
          else oi = 2;
        }
        var obj = biomeObjs[oi];

        // Pick variant — use different salt per blade so each is unique.
        // Whitelisted species pick only from their curated variant list.
        var sfWl = sfVariantsFor(tile.biome, obj.name);
        var v = sfWl
          ? sfWl[Math.floor(rand2(wx, wy, 7020 + bi * 17 + oi) * sfWl.length)]
          : Math.floor(rand2(wx, wy, 7020 + bi * 17 + oi) * SF_VARIANT_COUNT);
        var url = SF_BASE_PATH + tile.biome + '/' + obj.name + '/sf__' + tile.biome + '__' + obj.name + '__v' + formatIdx(v) + '.png';
        var bmp = imageCache.get(url);
        if (!bmp) continue;

        // Sub-tile position: distribute blades across the tile
        var offX = (rand2(wx, wy, 7030 + bi) - 0.5) * tileSize * 0.8;
        var offY = (rand2(wx, wy, 7031 + bi) - 0.5) * tileSize * 0.8;

        // Draw size: full tile for grass, slightly smaller for accents
        var drawSize = oi === 0 ? tileSize : Math.round(tileSize * obj.scale);

        // Slight rotation for organic feel
        var angle = (rand2(wx, wy, 7040 + bi) - 0.5) * 0.35;

        ctx.save();
        ctx.translate(sx + halfTile + offX, sy + halfTile + offY);
        ctx.rotate(angle);
        ctx.globalAlpha = 0.85 + rand2(wx, wy, 7050 + bi) * 0.15;
        ctx.drawImage(bmp, -drawSize * 0.5, -drawSize * 0.5, drawSize, drawSize);
        ctx.globalAlpha = 1.0;
        ctx.restore();
      }
    }
  }
}

// === FIELD 3: SMALL SCATTER ===
// Sparse placement of small objects (pebbles, shells, bones, mushrooms, etc).
// Very low density (5-10%), sprite-only, no luminance modulation.
// Objects are static — no animation. Uses occupancy grid to avoid overlaps.
// SS_BIOME_OBJECTS, SS_BASE_PATH, SS_VARIANT_COUNT imported from decoration-claims.js above.

function applySmallScatterToChunk(ctx, chunk, tileSize, chunkSize, imageCache, missingOut) {
  // Quick check: does any tile in this chunk have small scatter defined?
  var hasSS = false;
  for (var i = 0; i < chunk.tiles.length; i++) {
    if (SS_BIOME_OBJECTS[chunk.tiles[i].biome]) { hasSS = true; break; }
  }
  if (!hasSS) return 0;
  var tileInfo = function(wx, wy) {
    var tx = wx - chunk.cx * chunkSize, ty = wy - chunk.cy * chunkSize;
    if (tx < 0 || ty < 0 || tx >= chunkSize || ty >= chunkSize) return null;
    var t = chunk.tiles[ty * chunkSize + tx];
    return t ? { biome: t.biome, transition: !!t.transitionPair } : null;
  };
  // Collect every placement for the chunk, then draw far-to-near (base-Y
  // sort) — perfect stacking regardless of jitter (replaces raster order).
  var all = [];
  for (var ty2 = 0; ty2 < chunkSize; ty2++) {
    for (var tx2 = 0; tx2 < chunkSize; tx2++) {
      var wx2 = chunk.cx * chunkSize + tx2, wy2 = chunk.cy * chunkSize + ty2;
      var pls = f3Placements(wx2, wy2, tileInfo);
      for (var pi = 0; pi < pls.length; pi++) {
        // Skip placements that the sim has marked as taken (honest removal, no pop)
        if (_f3RemovedKeys.size > 0 && _f3RemovedKeys.has('f3:' + wx2 + ',' + wy2 + ':' + pi)) continue;
        var p = pls[pi];
        all.push({
          p: p,
          cx: (tx2 + p.ux) * tileSize,
          cy: (ty2 + p.uy) * tileSize,
          drawSize: tileSize * p.scale,
        });
      }
    }
  }
  all.sort(function(a, b) {
    return (a.cy + a.drawSize / 2) - (b.cy + b.drawSize / 2);
  });
  var missed = 0;
  for (var di = 0; di < all.length; di++) {
    var e = all[di], pl = e.p;
    var url = f3SpriteUrl(pl);
    var bmp = imageCache.get(url);
    if (!bmp && pl.state) { // state PNG missing -> fall back to base variant
      var base = Object.assign({}, pl); base.state = null;
      url = f3SpriteUrl(base);
      bmp = imageCache.get(url);
    }
    if (!bmp) { missed++; if (missingOut) missingOut.add(url); continue; }
    var half = e.drawSize * 0.5;
    ctx.save();
    ctx.translate(e.cx, e.cy);
    ctx.rotate(pl.angle);
    ctx.globalAlpha = pl.alpha;
    ctx.drawImage(bmp, -half, -half, e.drawSize, e.drawSize);
    ctx.restore();
  }
  ctx.globalAlpha = 1.0;
  return missed;
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
          var selfAsset = wangAssetName(tile.biome);
          var selfDir = selfAsset + '_to_' + selfAsset;
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
          // Compare in asset-alias space: stream and river share the same art,
          // so a 2×2 cell mixing them must put both on the same side of the mask.
          var fbAsset = wangAssetName(tile.transitionPair.from);
          if (wangAssetName(tile.biome) === fbAsset) cornerMask |= 8;
          if (wangAssetName(tile.neighborE) === fbAsset) cornerMask |= 4;
          if (wangAssetName(tile.neighborS) === fbAsset) cornerMask |= 2;
          if (wangAssetName(tile.neighborSE) === fbAsset) cornerMask |= 1;
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

  // Chunk-wide occupancy grid: tracks which pixels are claimed by placed objects.
  // Resolution: 4×4 cells per tile (8px per cell). Each cell = 1 bit.
  // Total: (chunkSize*4) × (chunkSize*4) = 256×256 = 65,536 cells = 8KB.
  // All decoration fields share this grid — objects in any field respect
  // pixels claimed by objects in earlier fields.
  var cellsPerTile = 4;
  var cellPx = tileSize / cellsPerTile; // 8px per cell
  var gridW = chunkSize * cellsPerTile; // 256
  var occupancy = new Uint8Array(gridW * gridW); // 0 = free, 1 = occupied

  // Apply decoration fields in order — each field reads+writes the occupancy grid
  // DEBUG: check if soil images are in cache
  var soilTestUrl = '/assets/pixelab/landscape_v2/micro/soil/loam_base/soil_base__loam__v000.png';
  var soilTestUrl2 = '/assets/pixelab/landscape_v2/micro/soil/loam/soil__loam__v000.png';
  if (!self._soilDebugDone) {
    self._soilDebugDone = true;
    var soilCount = 0;
    imageCache.forEach(function(v, k) { if (k.includes('/soil/')) soilCount++; });
    console.log('[SOIL DEBUG] imageCache size:', imageCache.size, 'soil entries:', soilCount, 'base test:', !!imageCache.get(soilTestUrl), 'accent test:', !!imageCache.get(soilTestUrl2));
    // Log first few soil keys to see actual URL format
    var soilKeys = [];
    imageCache.forEach(function(v, k) { if (k.includes('/soil/') && soilKeys.length < 5) soilKeys.push(k); });
    console.log('[SOIL DEBUG] actual soil keys:', soilKeys);
  }
  var soilResult = applySoilFieldToChunk(ctx, chunk, canvasSize, tileSize, chunkSize, imageCache);
  var hasSoil = soilResult.anySoil;
  // Diagnostic: a land chunk that painted few/no soil pixels indicates the soil
  // loop is skipping everything (not a missing-image problem)
  if (soilResult.soilPixels < 10000 && !soilResult.missedSoil) {
    console.log('[SOIL LOW] chunk', chunk.cx + ',' + chunk.cy, 'painted only', soilResult.soilPixels, 'soil pixels (anySoil=' + soilResult.anySoil + ')');
  }
  applyGroundCoverToChunk(ctx, chunk, canvasSize, tileSize, chunkSize, imageCache, occupancy, cellsPerTile, cellPx, gridW);
  // Field 2 rendered entirely on main thread via GPU instancing (field2-gpu.js)
  // applySmallFloraToChunk(ctx, chunk, tileSize, chunkSize, imageCache);
  var scatterMissing = new Set();
  var scatterMissed = applySmallScatterToChunk(ctx, chunk, tileSize, chunkSize, imageCache, scatterMissing) || 0;

  // Check if any wang tiles failed to load
  var wangMissing = 0;
  for (var wi = 0; wi < debugSuccesses.length; wi++) {
    if (!debugSuccesses[wi]) wangMissing++;
  }

  var bitmap = offscreen.transferToImageBitmap();
  return {
    bitmap: bitmap,
    hasSoil: hasSoil,
    needsRepaint: soilResult.missedSoil || wangMissing > 0 || scatterMissed > 0,
    scatterMissingUrls: scatterMissing.size > 0 ? [...scatterMissing] : null,
    debug: {
      masks: debugMasks, successes: debugSuccesses, srcs: debugSrcs, biomes: debugBiomes,
      neighbors: debugNeighbors, transitionDirs: debugTransitionDirs, transitionSides: debugTransitionSides,
      cornerMasks: debugCornerMasks, variants: debugVariants, cliffLevels: debugCliffLevels,
      interiorUsed: debugInteriorUsed, cliffOverlay: debugCliffOverlay,
      soilPixels: soilResult.soilPixels, soilMissed: soilResult.missedSoil
    }
  };
}
