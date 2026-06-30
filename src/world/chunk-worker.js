import { setWorldSeed } from '../core/world-seed.js';
import { WORLD } from '../core/constants.js';
import { setFieldTuning } from './field-tuning.js';
import { clearClaimCaches } from './decoration-claims.js';
import { ChunkCompiler } from './chunk-compiler.js';
import { getWangImageURLsForBiomes, getSoilImageURLsForBiomes, getGroundCoverImageURLsForBiomes, getSmallScatterImageURLs } from '../render/wang-image-list.js';
import { renderChunkToBitmap, setF3RemovedKeys, buildChunkIndex } from '../render/worker-chunk-renderer.js';
import { wangSlotKey } from '../render/wang-atlas.js';
import { denoiseBitmap } from '../render/sprite-denoise.js';
import { getAllFloorTileURLs } from '../render/building-tile-query.js';

var compiler = new ChunkCompiler();
var SLICE_ROWS = 8;
var imageCache = new Map(); // tile bitmaps; bounded in practice by the finite per-biome tilesets — do
                            // NOT cap by count: a FIFO cap evicts the foundational soil tiles (loaded
                            // first) and the wang landscape fails to render. (Reverted a bad IMG_CAP.)
var imagesReady = false;
var chunksNeedingRepaint = [];
var neighborCache = new Map();
var MAX_NEIGHBOR_CACHE = 50;
// Field-tuning generation — stamped onto every painted bitmap so the main
// thread can discard paints that were in flight when the tuning tree changed.
var tuneGen = 0;

// GPU terrain: slot metadata broadcast from the main thread; null until set.
var wangAtlasMeta = null;
var gpuTerrain = false;

// URLs matching these patterns get denoised at load time
function shouldDenoise(url) {
  return url.includes('/small_flora/');
}

// fetch() with a hard timeout. Without this, a single stalled connection (likely
// with many image requests across ~6 workers) makes loadImageBatch's Promise.all
// never resolve, so a chunk's hot-load never completes and that chunk never paints.
// A timed-out request aborts and is treated exactly like a failed load (retried
// once, then refilled by the repaint pass).
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

// On-demand biome asset loading. The old model eagerly fetched EVERY biome's
// tiles up front (~22k urls x ~6 workers ≈ 130k fetches) — which permanently
// saturated CPU/network and pinned the framerate at a few fps that never
// recovered. Instead, each chunk loads ONLY the biomes it actually contains
// (plus its 8 neighbors', so edge transitions resolve) the first time they are
// seen. Walking into a new biome — or fast-travelling — hot-loads just that
// biome; already-seen biomes are a no-op. This is the "load what's around me,
// stream the rest as I move" model.
var _loadedBiomes = new Set();
var _scatterLoaded = false;

function collectAreaBiomes(cx, cy, tiles) {
  var set = new Set();
  function scan(ts) {
    if (!ts) return;
    for (var i = 0; i < ts.length; i++) {
      var t = ts[i];
      if (!t) continue;
      if (t.biome) set.add(t.biome);
      // A transition tile renders TWO biomes' substrate (from + to). If we only load
      // tile.biome, the paired biome's soil never loads -> [SOIL MISS] -> the chunk
      // re-renders forever, saturating the workers and stuttering the main thread.
      if (t.transitionPair) {
        if (t.transitionPair.from) set.add(t.transitionPair.from);
        if (t.transitionPair.to) set.add(t.transitionPair.to);
      }
    }
  }
  scan(tiles);
  // Neighbor chunks supply the biome on the far side of an edge transition tile.
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      scan(neighborCache.get((cx + dx) + ',' + (cy + dy)));
    }
  }
  return set;
}

async function ensureChunkBiomes(cx, cy, tiles) {
  var biomes = collectAreaBiomes(cx, cy, tiles);
  var arr = [];
  var hasNew = false;
  biomes.forEach(function(b) {
    arr.push(b);
    if (!_loadedBiomes.has(b)) hasNew = true;
  });
  // Fast path: this chunk's biomes (and the one-time scatter set) are all cached.
  if (!hasNew && _scatterLoaded) return;

  var urls = [];
  if (hasNew) {
    // getWangImageURLsForBiomes generates each biome's interior tiles AND the
    // transitions between every pair in the set — so an area's tilesets + its
    // internal seams all load together. Already-cached urls are filtered below.
    urls = getWangImageURLsForBiomes(arr)
      .concat(getSoilImageURLsForBiomes(arr))
      .concat(getGroundCoverImageURLsForBiomes(arr));
  }
  if (!_scatterLoaded) {
    // Scatter sprites (F3 debris) are biome-agnostic; load the set once. Flag set
    // before the await so concurrent chunk compiles don't each re-add it.
    _scatterLoaded = true;
    urls = urls.concat(getSmallScatterImageURLs());
  }
  var missing = urls.filter(function(u) { return !imageCache.has(u); });
  if (missing.length) await loadImageBatch(missing, 50);
  biomes.forEach(function(b) { _loadedBiomes.add(b); });
}

// Repaint chunks that compiled while images were missing. Re-renders flagged
// chunks with WHATEVER IS CURRENTLY CACHED (no blocking load — the background
// loader fills the cache and re-triggers this per step). While the background
// load is still running, a chunk that's still incomplete is re-queued so it
// finalizes once its images arrive; once the load is done, remaining-incomplete
// chunks give up (the asset is genuinely absent — honest absence).
var repaintPassScheduled = false;
// A flagged chunk retries a bounded number of times (~MAX*400ms) so async
// resources — the roof engine import, building floors — can finalize, then gives
// up. Wang/soil are no longer a repaint concern (hot-loaded before first paint),
// so only a handful of building chunks ever flag, and only for a few seconds.
var MAX_REPAINT_ATTEMPTS = 12;

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
    if (result.needsRepaint && (rchunk.attempts || 0) < MAX_REPAINT_ATTEMPTS) {
      // An async resource is still loading — retry, bounded by the attempt cap.
      chunksNeedingRepaint.push({ key: rchunk.key, cx: rchunk.cx, cy: rchunk.cy, attempts: (rchunk.attempts || 0) + 1 });
      stillIncomplete++;
    }
    var rIdxBuf = buildIndexBuffer(chunk);
    self.postMessage({ type: 'chunkRepainted', key: rchunk.key, cx: rchunk.cx, cy: rchunk.cy, gen: tuneGen, bitmap: result.bitmap, wangDebug: result.debug, index: rIdxBuf }, rIdxBuf ? [result.bitmap, rIdxBuf] : [result.bitmap]);
  }
  // Self-reschedule only while chunks remain under the attempt cap. Bounded by
  // MAX_REPAINT_ATTEMPTS, so a building whose roof engine never loads stops
  // retrying after a few seconds instead of looping forever.
  if (stillIncomplete > 0) scheduleRepaintPass();
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

// Build a per-chunk index buffer for the GPU terrain shader. Returns the
// underlying ArrayBuffer (transferable) or null when GPU terrain is off.
function buildIndexBuffer(chunk) {
  if (!gpuTerrain || !wangAtlasMeta) return null;
  try {
    var idx = buildChunkIndex(chunk, {
      slotResolver: function(asset, level, mask) {
        var e = wangAtlasMeta.slots[wangSlotKey(asset, level, mask)];
        return e ? e.slot : 0;
      },
      soilResolver: function() { return 0; }, // Phase 3 wires real soil ids
    });
    return idx.buffer; // transferable ArrayBuffer
  } catch (e) { return null; }
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

  if (data.type === 'setWangAtlasMeta') {
    wangAtlasMeta = data.meta;
    return;
  }

  if (data.type === 'setGpuTerrain') {
    gpuTerrain = !!data.on;
    return;
  }

  if (data.type === 'preloadBiomes') {
    // CRITICAL first-paint set: only the player's immediate ("core") biomes.
    // Everything else streams in on demand per-chunk (ensureChunkBiomes) as the
    // player moves — we no longer eagerly fetch all 21 biomes up front, which
    // permanently saturated the workers and pinned the framerate.
    var coreBiomes = data.coreBiomes || data.biomes;
    var coreWang = getWangImageURLsForBiomes(coreBiomes);
    var coreSoil = getSoilImageURLsForBiomes(coreBiomes);
    var coreGc = getGroundCoverImageURLsForBiomes(coreBiomes);
    var floorUrls = getAllFloorTileURLs();
    var criticalUrls = coreWang.concat(coreSoil).concat(coreGc).concat(floorUrls);
    coreBiomes.forEach(function(b) { _loadedBiomes.add(b); }); // seed: core biomes are now cached
    // Batch of 50 per worker — with up to 6 workers plus main-thread preloads,
    // larger batches exhaust the browser's network stack (ERR_INSUFFICIENT_RESOURCES)
    loadImageBatch(criticalUrls, 50).then(function(result) {
      imagesReady = true;
      self.postMessage({ type: 'imagesReady', loaded: result.loaded, failed: result.failed, total: criticalUrls.length });
      // No eager all-biome background load — chunks hot-load their own biomes.
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

    // Hot-load this chunk's biome tilesets on demand, THEN paint — so the chunk
    // renders complete the first time without an eager all-biome preload. The
    // tile-slice data above was already posted synchronously, so the main thread
    // has the chunk's logical data immediately; only the painted bitmap waits on
    // the (usually-cached) biome load.
    ensureChunkBiomes(cx, cy, chunk.tiles).then(function() {
      var sun = { height: 0.5, ambient: 0.85 };
      var result = renderChunkToBitmap(chunk, neighborCache, sun, imageCache);

      // With wang/soil hot-loaded above, needsRepaint now only flags async
      // resources (roof engine, building floors) — a few bounded retries, not a storm.
      if (result.needsRepaint) {
        chunksNeedingRepaint.push({ key: key, cx: cx, cy: cy, attempts: 0 });
        scheduleRepaintPass();
      }

      // Transfer bitmap (and optional GPU index buffer) to main thread (zero-copy)
      var idxBuf = buildIndexBuffer(chunk);
      self.postMessage({ type: 'chunkPainted', key: key, cx: cx, cy: cy, gen: tuneGen, bitmap: result.bitmap, wangDebug: result.debug, index: idxBuf }, idxBuf ? [result.bitmap, idxBuf] : [result.bitmap]);
    });
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
        var r2IdxBuf = buildIndexBuffer(chunk);
        self.postMessage({ type: 'chunkRepainted', key: key, cx: cx, cy: cy, gen: tuneGen, bitmap: r2.bitmap, wangDebug: r2.debug, index: r2IdxBuf }, r2IdxBuf ? [r2.bitmap, r2IdxBuf] : [r2.bitmap]);
      });
      return;
    }
    if (result.needsRepaint) {
      chunksNeedingRepaint.push({ key: key, cx: cx, cy: cy, attempts: 0 });
      scheduleRepaintPass();
    }
    var repIdxBuf = buildIndexBuffer(chunk);
    self.postMessage({ type: 'chunkRepainted', key: key, cx: cx, cy: cy, gen: tuneGen, bitmap: result.bitmap, wangDebug: result.debug, index: repIdxBuf }, repIdxBuf ? [result.bitmap, repIdxBuf] : [result.bitmap]);
  }
};
