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

  key(chunk, lightBucket) {
    return `${chunk.cx},${chunk.cy},${lightBucket}`;
  }

  lightBucket(sun) {
    return `${Math.round(sun.ambient * 3)},${Math.round(sun.height * 3)}`;
  }

  get(chunk, sun) {
    const bucket = this.lightBucket(sun);
    const key = this.key(chunk, bucket);
    const hit = this.cache.get(key);
    if (hit) {
      hit.lastUsed = performance.now();
      return hit.canvas;
    }
    const canvas = document.createElement('canvas');
    canvas.width = WORLD.chunkSize * WORLD.tileSize;
    canvas.height = WORLD.chunkSize * WORLD.tileSize + 24;
    const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: false });
    this.renderChunk(ctx, chunk, sun);
    this.cache.set(key, { canvas, lastUsed: performance.now() });
    this.evict();
    return canvas;
  }

  renderChunk(ctx, chunk, sun) {
    for (let y = 0; y < WORLD.chunkSize; y++) {
      for (let x = 0; x < WORLD.chunkSize; x++) {
        const index = y * WORLD.chunkSize + x;
        const tile = chunk.tiles[index];
        const sx = x * WORLD.tileSize;
        const sy = y * WORLD.tileSize - elevationLift(tile.climate.elevation);
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
