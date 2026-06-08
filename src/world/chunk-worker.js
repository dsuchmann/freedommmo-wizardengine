import { setWorldSeed } from '../core/world-seed.js';
import { WORLD } from '../core/constants.js';
import { ChunkCompiler } from './chunk-compiler.js';
import { getAllWangImageURLs, getWangImageURLsForBiomes, getSoilImageURLs, getGroundCoverImageURLs, getSmallFloraImageURLs, getSmallScatterImageURLs } from '../render/wang-image-list.js';
import { renderChunkToBitmap } from '../render/worker-chunk-renderer.js';
import { denoiseBitmap } from '../render/sprite-denoise.js';

var compiler = new ChunkCompiler();
var SLICE_ROWS = 8;
var imageCache = new Map();
var imagesReady = false;
var backgroundLoadingDone = false;
var neighborCache = new Map();
var MAX_NEIGHBOR_CACHE = 50;

// URLs matching these patterns get denoised at load time
function shouldDenoise(url) {
  return url.includes('/small_flora/') || url.includes('/micro/soil/');
}

// Load a batch of image URLs into the cache. Returns {loaded, failed}.
async function loadImageBatch(urls, batchSize) {
  var loaded = 0;
  var failed = 0;
  for (var i = 0; i < urls.length; i += batchSize) {
    var batch = urls.slice(i, i + batchSize);
    await Promise.all(batch.map(async function(url) {
      if (imageCache.has(url)) { loaded++; return; }
      try {
        var response = await fetch(url);
        if (!response.ok) { failed++; return; }
        var blob = await response.blob();
        var bmp = await createImageBitmap(blob);
        if (shouldDenoise(url)) {
          bmp = await denoiseBitmap(bmp);
        }
        imageCache.set(url, bmp);
        loaded++;
      } catch (e) {
        failed++;
      }
    }));
  }
  return { loaded: loaded, failed: failed };
}

// Phase 2: Background-load remaining wang tiles after worker is already active.
async function backgroundLoadRemaining() {
  var allUrls = getAllWangImageURLs();
  // Filter to only URLs not yet cached
  var remaining = allUrls.filter(function(url) { return !imageCache.has(url); });
  if (remaining.length === 0) {
    backgroundLoadingDone = true;
    self.postMessage({ type: 'backgroundLoadDone', total: allUrls.length, cached: imageCache.size });
    return;
  }
  await loadImageBatch(remaining, 40);
  backgroundLoadingDone = true;
  self.postMessage({ type: 'backgroundLoadDone', total: allUrls.length, cached: imageCache.size });
}

// Compute shore distance and shore angle for every tile in a chunk.
// Sets tile.shoreDistance (float, 0=water, higher=further inland)
// and tile.shoreAngle (radians, direction the shoreline runs at this point).
function computeShoreDataForChunk(chunk, chunkSize) {
  var size = chunkSize * chunkSize;
  var dist = new Float32Array(size);
  dist.fill(255);

  // Pass 1: mark water tiles as 0
  for (var i = 0; i < size; i++) {
    var b = chunk.tiles[i].biome;
    if (b.includes('ocean') || b === 'shallow_water' || b === 'river' || b === 'lake') dist[i] = 0;
  }

  // Pass 2: forward sweep
  for (var y = 0; y < chunkSize; y++) {
    for (var x = 0; x < chunkSize; x++) {
      var idx = y * chunkSize + x;
      if (x > 0 && dist[idx - 1] + 1 < dist[idx]) dist[idx] = dist[idx - 1] + 1;
      if (y > 0 && dist[idx - chunkSize] + 1 < dist[idx]) dist[idx] = dist[idx - chunkSize] + 1;
      if (x > 0 && y > 0 && dist[idx - chunkSize - 1] + 1.41 < dist[idx]) dist[idx] = dist[idx - chunkSize - 1] + 1.41;
      if (x < chunkSize - 1 && y > 0 && dist[idx - chunkSize + 1] + 1.41 < dist[idx]) dist[idx] = dist[idx - chunkSize + 1] + 1.41;
    }
  }

  // Pass 3: backward sweep
  for (var y = chunkSize - 1; y >= 0; y--) {
    for (var x = chunkSize - 1; x >= 0; x--) {
      var idx = y * chunkSize + x;
      if (x < chunkSize - 1 && dist[idx + 1] + 1 < dist[idx]) dist[idx] = dist[idx + 1] + 1;
      if (y < chunkSize - 1 && dist[idx + chunkSize] + 1 < dist[idx]) dist[idx] = dist[idx + chunkSize] + 1;
      if (x < chunkSize - 1 && y < chunkSize - 1 && dist[idx + chunkSize + 1] + 1.41 < dist[idx]) dist[idx] = dist[idx + chunkSize + 1] + 1.41;
      if (x > 0 && y < chunkSize - 1 && dist[idx + chunkSize - 1] + 1.41 < dist[idx]) dist[idx] = dist[idx + chunkSize - 1] + 1.41;
    }
  }

  // Pass 4: compute gradient (shore direction) and store on tiles
  for (var y = 0; y < chunkSize; y++) {
    for (var x = 0; x < chunkSize; x++) {
      var idx = y * chunkSize + x;
      var tile = chunk.tiles[idx];
      tile.shoreDistance = dist[idx];

      // Gradient of distance field → points away from water
      var dL = x > 0 ? dist[idx - 1] : dist[idx];
      var dR = x < chunkSize - 1 ? dist[idx + 1] : dist[idx];
      var dU = y > 0 ? dist[idx - chunkSize] : dist[idx];
      var dD = y < chunkSize - 1 ? dist[idx + chunkSize] : dist[idx];
      var gradX = dR - dL;
      var gradY = dD - dU;
      // Shore angle = perpendicular to gradient (the direction the coastline runs)
      tile.shoreAngle = Math.atan2(-gradX, gradY);
    }
  }
}

function evictNeighborCache() {
  if (neighborCache.size <= MAX_NEIGHBOR_CACHE) return;
  var keys = [...neighborCache.keys()];
  while (keys.length > MAX_NEIGHBOR_CACHE) {
    neighborCache.delete(keys.shift());
  }
}

self.onmessage = function(event) {
  var data = event.data;

  if (data.type === 'preloadBiomes') {
    // Phase 1: Preload ONLY wang tiles + soil + ground cover (essential for chunk rendering).
    // Flora and scatter URLs load in phase 2 (background) — they're not needed for chunks.
    var biomeUrls = getWangImageURLsForBiomes(data.biomes);
    var soilUrls = getSoilImageURLs();
    var gcUrls = typeof getGroundCoverImageURLs === 'function' ? getGroundCoverImageURLs() : [];
    var priorityUrls = biomeUrls.concat(soilUrls).concat(gcUrls);
    loadImageBatch(priorityUrls, 40).then(function(result) {
      imagesReady = true;
      self.postMessage({ type: 'imagesReady', loaded: result.loaded, failed: result.failed, total: priorityUrls.length });
      // Phase 2: Load flora, scatter, and everything else in the background
      backgroundLoadRemaining();
    });
    return;
  }

  if (data.type === 'compileChunk') {
    if (!imagesReady) return;
    var key = data.key;
    var cx = data.cx;
    var cy = data.cy;
    setWorldSeed(data.seed);
    var chunk = compiler.compile(cx, cy);

    // Compute shore distance + direction for every tile in this chunk.
    // Stored on each tile so main thread can use it for wave animation direction.
    computeShoreDataForChunk(chunk, WORLD.chunkSize);

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
    var sun = { height: 0.5, ambient: 0.85 };
    var result = renderChunkToBitmap(chunk, neighborCache, sun, imageCache);

    // Transfer bitmap to main thread (zero-copy)
    self.postMessage({ type: 'chunkPainted', key: key, cx: cx, cy: cy, bitmap: result.bitmap, wangDebug: result.debug }, [result.bitmap]);
  } else if (data.type === 'repaintChunk') {
    if (!imagesReady) return;
    var key = data.key;
    var cx = data.cx;
    var cy = data.cy;
    if (data.neighbors) {
      for (var nk in data.neighbors) {
        neighborCache.set(nk, data.neighbors[nk]);
      }
      evictNeighborCache();
    }
    var tiles = neighborCache.get(cx + ',' + cy);
    if (!tiles) return;
    var chunk = { cx: cx, cy: cy, tiles: tiles };
    var sun = { height: 0.5, ambient: 0.85 };
    var result = renderChunkToBitmap(chunk, neighborCache, sun, imageCache);
    self.postMessage({ type: 'chunkRepainted', key: key, cx: cx, cy: cy, bitmap: result.bitmap, wangDebug: result.debug }, [result.bitmap]);
  }
};
