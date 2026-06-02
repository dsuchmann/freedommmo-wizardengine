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
        // Compute all 8 neighbor biomes for this tile
        var wx = chunk.cx * WORLD.chunkSize + x;
        var wy = chunk.cy * WORLD.chunkSize + y;
        tile.neighborN  = (tileAt(wx, wy - 1) || {}).biome;
        tile.neighborNE = (tileAt(wx + 1, wy - 1) || {}).biome;
        tile.neighborE  = (tileAt(wx + 1, wy) || {}).biome;
        tile.neighborSE = (tileAt(wx + 1, wy + 1) || {}).biome;
        tile.neighborS  = (tileAt(wx, wy + 1) || {}).biome;
        tile.neighborSW = (tileAt(wx - 1, wy + 1) || {}).biome;
        tile.neighborW  = (tileAt(wx - 1, wy) || {}).biome;
        tile.neighborNW = (tileAt(wx - 1, wy - 1) || {}).biome;
        // Wang edge mask — pattern-based from tileset layout
        // Use neighbor diff pattern to select mask
        var nw = tile.neighborNW !== tile.biome ? 1 : 0;
        var nn = tile.neighborN  !== tile.biome ? 1 : 0;
        var ne = tile.neighborNE !== tile.biome ? 1 : 0;
        var ww = tile.neighborW  !== tile.biome ? 1 : 0;
        var ee = tile.neighborE  !== tile.biome ? 1 : 0;
        var sw = tile.neighborSW !== tile.biome ? 1 : 0;
        var ss = tile.neighborS  !== tile.biome ? 1 : 0;
        var se = tile.neighborSE !== tile.biome ? 1 : 0;
        // Pattern key: 8-bit diff concat
        var key = '' + nw + nn + ne + ww + ee + sw + ss + se;
        // Lookup table from user-provided examples (1=diff, 0=same)
        var lookup = {
          '00100110': 8,  // -10535,-19980: W,S,SW diff
          '00000010': 10, // -10534,-19980: SW only
          '00100010': 1,  // -10534,-19979: W,SW diff
          '10010110': 8,  // -10534,-19978: NW,W,S,SW diff
          '10100010': 1,  // unknown config but close to above
        };
        var mask = lookup[key];
        if (mask === undefined) {
          // Fallback: edge diff + corner overrides
          mask = 0;
          if (ww) mask |= 2;
          if (ss) mask |= 8;
          if (sw) mask |= 8;
          if (nw && !nn) mask &= ~2;
        }
        tile.wangEdgeMask = mask;
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
