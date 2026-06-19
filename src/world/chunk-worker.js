import { setWorldSeed } from '../core/world-seed.js';
import { WORLD } from '../core/constants.js';
import { setFieldTuning } from './field-tuning.js';
import { clearClaimCaches } from './decoration-claims.js';
import { ChunkCompiler } from './chunk-compiler.js';
import { getAllWangImageURLs, getWangImageURLsForBiomes, getSoilImageURLs, getSoilImageURLsForBiomes, getGroundCoverImageURLs, getGroundCoverImageURLsForBiomes, getSmallFloraImageURLs, getSmallScatterImageURLs } from '../render/wang-image-list.js';
import { renderChunkToBitmap, setF3RemovedKeys } from '../render/worker-chunk-renderer.js';
import { denoiseBitmap } from '../render/sprite-denoise.js';
import { getAllFloorTileURLs } from '../render/building-tile-query.js';

var compiler = new ChunkCompiler();
var SLICE_ROWS = 8;
var imageCache = new Map();
var imagesReady = false;
var backgroundLoadingDone = false;
var chunksNeedingRepaint = [];
var neighborCache = new Map();
var MAX_NEIGHBOR_CACHE = 50;
// Field-tuning generation — stamped onto every painted bitmap so the main
// thread can discard paints that were in flight when the tuning tree changed.
var tuneGen = 0;

// URLs matching these patterns get denoised at load time
function shouldDenoise(url) {
  return url.includes('/small_flora/');
}

// fetch() with a hard timeout. Without this, a single stalled connection (likely
// with thousands of image requests across ~6 workers) makes loadImageBatch's
// Promise.all never resolve, so backgroundLoadingDone never fires and the world
// never finishes loading. A timed-out request aborts and is treated exactly like
// a failed load (retried once, then refilled by the repaint pass).
function fetchWithTimeout(url, ms) {
  var controller = new AbortController();
  var tid = setTimeout(function() { controller.abort(); }, ms);
  return fetch(url, { signal: controller.signal }).finally(function() { clearTimeout(tid); });
}

// Load a batch of image URLs into the cache. Returns {loaded, failed}.
// Retries failed URLs once with a smaller batch size to handle server overload.
async function loadImageBatch(urls, batchSize) {
  var loaded = 0;
  var failed = 0;
  var failedUrls = [];
  for (var i = 0; i < urls.length; i += batchSize) {
    var batch = urls.slice(i, i + batchSize);
    await Promise.all(batch.map(async function(url) {
      if (imageCache.has(url)) { loaded++; return; }
      try {
        var response = await fetchWithTimeout(url, 12000);
        // Non-ok responses (server overload, transient errors) are retried below
        if (!response.ok) { failedUrls.push(url); failed++; return; }
        var blob = await response.blob();
        var bmp = await createImageBitmap(blob);
        if (shouldDenoise(url)) {
          bmp = await denoiseBitmap(bmp);
        }
        imageCache.set(url, bmp);
        loaded++;
      } catch (e) {
        failedUrls.push(url);
        failed++;
      }
    }));
  }
  // Retry failed URLs with smaller batch size (likely failed due to connection overload)
  if (failedUrls.length > 0) {
    var retryBatch = Math.min(20, Math.ceil(batchSize / 10));
    for (var ri = 0; ri < failedUrls.length; ri += retryBatch) {
      var rBatch = failedUrls.slice(ri, ri + retryBatch);
      await Promise.all(rBatch.map(async function(url) {
        if (imageCache.has(url)) return;
        try {
          var response = await fetchWithTimeout(url, 12000);
          if (!response.ok) return; // failed twice — repaint pass will retry later
          var blob = await response.blob();
          var bmp = await createImageBitmap(blob);
          if (shouldDenoise(url)) bmp = await denoiseBitmap(bmp);
          imageCache.set(url, bmp);
          loaded++;
          failed--;
        } catch (e) { /* truly missing */ }
      }));
    }
  }
  return { loaded: loaded, failed: failed };
}

// Phase 2: Background-load remaining wang tiles + scatter sprites after worker is already active.
async function backgroundLoadRemaining() {
  // Full streamed-area set: all wang + all soil + all ground cover (the critical
  // gate only loaded the player's core biomes) + scatter base/lifecycle sprites
  // (404s for missing art are normal). Already-cached URLs are filtered out below.
  var allUrls = getAllWangImageURLs()
    .concat(getSoilImageURLs())
    .concat(getGroundCoverImageURLs())
    .concat(getSmallScatterImageURLs());
  // Filter to only URLs not yet cached
  var remaining = allUrls.filter(function(url) { return !imageCache.has(url); });
  if (remaining.length === 0) {
    backgroundLoadingDone = true;
    scheduleRepaintPass();
    self.postMessage({ type: 'backgroundLoadDone', total: allUrls.length, cached: imageCache.size });
    return;
  }
  // Load in steps and repaint flagged chunks AFTER EACH STEP, so incomplete
  // chunks finalize PROGRESSIVELY as their images arrive — instead of waiting for
  // the entire ~22k-image set (the old behavior, which left the world incomplete
  // and storming for minutes). With the fetch timeout, this always runs to
  // completion even if some requests fail.
  var STEP = 1500;
  for (var i = 0; i < remaining.length; i += STEP) {
    await loadImageBatch(remaining.slice(i, i + STEP), 40);
    scheduleRepaintPass();
  }
  backgroundLoadingDone = true;
  scheduleRepaintPass(); // final pass — chunks still incomplete now give up (asset genuinely absent)
  self.postMessage({ type: 'backgroundLoadDone', total: allUrls.length, cached: imageCache.size });
}

// Repaint chunks that compiled while images were missing. Re-renders flagged
// chunks with WHATEVER IS CURRENTLY CACHED (no blocking load — the background
// loader fills the cache and re-triggers this per step). While the background
// load is still running, a chunk that's still incomplete is re-queued so it
// finalizes once its images arrive; once the load is done, remaining-incomplete
// chunks give up (the asset is genuinely absent — honest absence).
var repaintPassScheduled = false;

function scheduleRepaintPass() {
  if (repaintPassScheduled || chunksNeedingRepaint.length === 0) return;
  repaintPassScheduled = true;
  setTimeout(runRepaintPass, 400);
}

function runRepaintPass() {
  repaintPassScheduled = false;
  if (chunksNeedingRepaint.length === 0) return;

  var toRepaint = chunksNeedingRepaint.splice(0);
  var stillIncomplete = 0;
  for (var ri = 0; ri < toRepaint.length; ri++) {
    var rchunk = toRepaint[ri];
    var tiles = neighborCache.get(rchunk.cx + ',' + rchunk.cy);
    if (!tiles) {
      // Tiles evicted from neighborCache — ask main thread to resend them
      self.postMessage({ type: 'repaintNeedsTiles', key: rchunk.key, cx: rchunk.cx, cy: rchunk.cy });
      continue;
    }
    var chunk = { cx: rchunk.cx, cy: rchunk.cy, tiles: tiles };
    var sun = { height: 0.5, ambient: 0.85 };
    var result = renderChunkToBitmap(chunk, neighborCache, sun, imageCache);
    if (result.needsRepaint && !backgroundLoadingDone) {
      // Still missing images, but more are streaming in — try again next pass.
      chunksNeedingRepaint.push({ key: rchunk.key, cx: rchunk.cx, cy: rchunk.cy });
      stillIncomplete++;
    }
    self.postMessage({ type: 'chunkRepainted', key: rchunk.key, cx: rchunk.cx, cy: rchunk.cy, gen: tuneGen, bitmap: result.bitmap, wangDebug: result.debug }, [result.bitmap]);
  }
  // Do NOT self-reschedule on every incomplete chunk: that re-renders + re-uploads
  // flagged chunks every 400ms for the whole background load, flooding the main
  // thread. Incomplete chunks were re-queued above; they get re-rendered the next
  // time NEW images arrive — backgroundLoadRemaining calls scheduleRepaintPass once
  // per load-step, and a final pass runs when the load finishes. So repaint work is
  // proportional to image arrival, not wall-clock.
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
    if (b.includes('ocean') || b === 'shallow_water' || b === 'river' || b === 'lake' || b === 'stream') dist[i] = 0;
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

  if (data.type === 'setFieldTuning') {
    setFieldTuning(data.tuning);
    clearClaimCaches(); // F3 placements/masks derive from the tree
    if (data.gen != null) tuneGen = data.gen;
    return;
  }

  if (data.type === 'setF3RemovedKeys') {
    setF3RemovedKeys(data.keys ?? []);
    return;
  }

  if (data.type === 'preloadBiomes') {
    // CRITICAL first-paint set: only the player's immediate ("core") biomes.
    // Gating imagesReady on all 21 biomes' wang (~17k urls/worker) kept the
    // world blank for minutes; the full set loads in backgroundLoadRemaining()
    // and the repaint pass fills in any chunk that baked before it arrived.
    var coreBiomes = data.coreBiomes || data.biomes;
    var coreWang = getWangImageURLsForBiomes(coreBiomes);
    var coreSoil = getSoilImageURLsForBiomes(coreBiomes);
    var coreGc = getGroundCoverImageURLsForBiomes(coreBiomes);
    var floorUrls = getAllFloorTileURLs();
    var criticalUrls = coreWang.concat(coreSoil).concat(coreGc).concat(floorUrls);
    // Batch of 50 per worker — with up to 6 workers plus main-thread preloads,
    // larger batches exhaust the browser's network stack (ERR_INSUFFICIENT_RESOURCES)
    loadImageBatch(criticalUrls, 50).then(function(result) {
      imagesReady = true;
      self.postMessage({ type: 'imagesReady', loaded: result.loaded, failed: result.failed, total: criticalUrls.length });
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

    // Track chunks that had missing images — they'll be repainted after background load
    if (result.needsRepaint) {
      console.log('[SOIL] chunk', cx + ',' + cy, 'painted incomplete (soilMissed=' + !result.hasSoil + ') — repaint scheduled');
      chunksNeedingRepaint.push({ key: key, cx: cx, cy: cy, attempts: 0 });
      scheduleRepaintPass();
    }

    // Transfer bitmap to main thread (zero-copy)
    self.postMessage({ type: 'chunkPainted', key: key, cx: cx, cy: cy, gen: tuneGen, bitmap: result.bitmap, wangDebug: result.debug }, [result.bitmap]);
  } else if (data.type === 'repaintChunk') {
    if (!imagesReady) return;
    var key = data.key;
    var cx = data.cx;
    var cy = data.cy;
    if (data.seed != null) setWorldSeed(data.seed);
    if (data.neighbors) {
      for (var nk in data.neighbors) {
        // delete-then-set refreshes Map insertion order — plain set() on an
        // existing key keeps its old position, so evictNeighborCache() could
        // evict the tiles we were just handed before the get() below.
        neighborCache.delete(nk);
        neighborCache.set(nk, data.neighbors[nk]);
      }
      evictNeighborCache();
    }
    var tiles = neighborCache.get(cx + ',' + cy);
    if (!tiles) {
      // Never drop silently: the provider's _repaintPending entry would pin
      // this chunk bitmap-less forever. Ask for the tiles to be resent.
      self.postMessage({ type: 'repaintNeedsTiles', key: key, cx: cx, cy: cy });
      return;
    }
    var chunk = { cx: cx, cy: cy, tiles: tiles };
    var sun = { height: 0.5, ambient: 0.85 };
    var result = renderChunkToBitmap(chunk, neighborCache, sun, imageCache);
    if (result.scatterMissingUrls) {
      // F3 sprites this chunk needs aren't cached yet (background load still
      // running in this worker). Fetch just those, then repaint once — tuner
      // repaints must never ship F3-less bitmaps that look "final".
      result.bitmap.close();
      loadImageBatch(result.scatterMissingUrls, 20).then(function() {
        var r2 = renderChunkToBitmap(chunk, neighborCache, sun, imageCache);
        if (r2.needsRepaint) {
          chunksNeedingRepaint.push({ key: key, cx: cx, cy: cy, attempts: 0 });
          scheduleRepaintPass();
        }
        self.postMessage({ type: 'chunkRepainted', key: key, cx: cx, cy: cy, gen: tuneGen, bitmap: r2.bitmap, wangDebug: r2.debug }, [r2.bitmap]);
      });
      return;
    }
    if (result.needsRepaint) {
      chunksNeedingRepaint.push({ key: key, cx: cx, cy: cy, attempts: 0 });
      scheduleRepaintPass();
    }
    self.postMessage({ type: 'chunkRepainted', key: key, cx: cx, cy: cy, gen: tuneGen, bitmap: result.bitmap, wangDebug: result.debug }, [result.bitmap]);
  }
};
