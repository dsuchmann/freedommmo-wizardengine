import { WORLD } from '../core/constants.js';
import { paintTerrainTile } from './tile-painter.js';
import { paintTerrainFeatures } from './feature-painter.js';

export class ChunkRenderCache {
  constructor(compositor = null, atlas = null) {
    this.compositor = compositor;
    this.atlas = atlas;
    this.cache = new Map();
    this.maxEntries = 36;
  }

  beginFrame(maxJobs = 1) {
    this._frameBudget = maxJobs;
  }

  key(chunk, lightBucket) {
    return `${chunk.cx},${chunk.cy},${lightBucket}`;
  }

  lightBucket(sun) {
    return `${Math.round(sun.ambient * 3)},${Math.round(sun.height * 3)}`;
  }

  get(chunk, sun, chunkStore = null) {
    var bucket = this.lightBucket(sun);
    var key = this.key(chunk, bucket);
    var hit = this.cache.get(key);
    if (hit) { hit.lastUsed = performance.now(); return hit.canvas; }
    var canvas = document.createElement('canvas');
    canvas.width = WORLD.chunkSize * WORLD.tileSize;
    canvas.height = WORLD.chunkSize * WORLD.tileSize;
    var ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: false });
    this.renderChunk(ctx, chunk, sun, chunkStore);
    this.cache.set(key, { canvas, lastUsed: performance.now() });
    this.evict();
    return canvas;
  }

  renderChunk(ctx, chunk, sun, chunkStore) {
    var tileAt = function(wx, wy) {
      var cx = Math.floor(wx / WORLD.chunkSize);
      var cy = Math.floor(wy / WORLD.chunkSize);
      var tx = ((wx % WORLD.chunkSize) + WORLD.chunkSize) % WORLD.chunkSize;
      var ty = ((wy % WORLD.chunkSize) + WORLD.chunkSize) % WORLD.chunkSize;
      if (cx === chunk.cx && cy === chunk.cy) {
        return chunk.tiles[ty * WORLD.chunkSize + tx];
      }
      if (chunkStore) {
        var nbChunk = chunkStore.get(cx, cy);
        if (nbChunk && nbChunk.tiles) return nbChunk.tiles[ty * WORLD.chunkSize + tx];
      }
      return null;
    };
    for (var y = 0; y < WORLD.chunkSize; y++) {
      for (var x = 0; x < WORLD.chunkSize; x++) {
        var index = y * WORLD.chunkSize + x;
        var tile = chunk.tiles[index];
        var sx = x * WORLD.tileSize;
        var sy = y * WORLD.tileSize;
        // compute Wang edge mask with cross-chunk neighbor lookup
        var mask = 0;
        var wx = chunk.cx * WORLD.chunkSize + x;
        var wy = chunk.cy * WORLD.chunkSize + y;
        var nTile = tileAt(wx, wy - 1);
        if (nTile && nTile.biome !== tile.biome) mask |= 1;
        nTile = tileAt(wx + 1, wy);
        if (nTile && nTile.biome !== tile.biome) mask |= 2;
        nTile = tileAt(wx, wy + 1);
        if (nTile && nTile.biome !== tile.biome) mask |= 4;
        nTile = tileAt(wx - 1, wy);
        if (nTile && nTile.biome !== tile.biome) mask |= 8;
        tile.wangEdgeMask = mask;
        paintTerrainTile(ctx, tile, sx, sy, WORLD.tileSize, sun, tile.climate.elevation, this.compositor, 0, this.atlas);
        paintTerrainFeatures(ctx, tile, sx, sy, WORLD.tileSize, sun);
      }
    }
  }

  evict() {
    if (this.cache.size <= this.maxEntries) return;
    const entries = [...this.cache.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    while (entries.length && this.cache.size > this.maxEntries) this.cache.delete(entries.shift()[0]);
  }

  clear() {
    this.cache.clear();
  }

  stats() {
    return { cachedTerrainChunks: this.cache.size, maxTerrainChunks: this.maxEntries };
  }
}

function elevationLift(elevation) {
  return Math.max(0, elevation - 0.35) * 18;
}
