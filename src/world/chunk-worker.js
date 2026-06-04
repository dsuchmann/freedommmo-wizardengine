import { setWorldSeed } from '../core/world-seed.js';
import { WORLD } from '../core/constants.js';
import { ChunkCompiler } from './chunk-compiler.js';
import { getAllWangImageURLs } from '../render/wang-image-list.js';
import { renderChunkToBitmap } from '../render/worker-chunk-renderer.js';

var compiler = new ChunkCompiler();
var SLICE_ROWS = 8;
var imageCache = new Map();
var imagesReady = false;
var neighborCache = new Map();
var MAX_NEIGHBOR_CACHE = 50;

// Preload all wang tile images on worker init
(async function preloadImages() {
  var urls = getAllWangImageURLs();
  var loaded = 0;
  var failed = 0;
  await Promise.all(urls.map(async function(url) {
    try {
      var response = await fetch(url);
      if (!response.ok) { failed++; return; }
      var blob = await response.blob();
      var bmp = await createImageBitmap(blob);
      imageCache.set(url, bmp);
      loaded++;
    } catch (e) {
      failed++;
    }
  }));
  imagesReady = true;
  self.postMessage({ type: 'imagesReady', loaded: loaded, failed: failed, total: urls.length });
})();

function evictNeighborCache() {
  if (neighborCache.size <= MAX_NEIGHBOR_CACHE) return;
  var keys = [...neighborCache.keys()];
  while (keys.length > MAX_NEIGHBOR_CACHE) {
    neighborCache.delete(keys.shift());
  }
}

self.onmessage = function(event) {
  var data = event.data;
  if (data.type === 'compileChunk') {
    if (!imagesReady) return;
    var key = data.key;
    var cx = data.cx;
    var cy = data.cy;
    setWorldSeed(data.seed);
    var chunk = compiler.compile(cx, cy);

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
    var bitmap = renderChunkToBitmap(chunk, neighborCache, sun, imageCache);

    // Transfer bitmap to main thread (zero-copy)
    self.postMessage({ type: 'chunkPainted', key: key, cx: cx, cy: cy, bitmap: bitmap }, [bitmap]);
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
    var bitmap = renderChunkToBitmap(chunk, neighborCache, sun, imageCache);
    self.postMessage({ type: 'chunkRepainted', key: key, cx: cx, cy: cy, bitmap: bitmap }, [bitmap]);
  }
};
