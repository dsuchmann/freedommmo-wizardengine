// Chunk render cache — thin lookup layer over worker-painted bitmaps.
// Workers paint chunks off-thread; this just stores and retrieves the results.

export class ChunkRenderCache {
  constructor() {
    this.missThisFrame = 0;
  }

  beginFrame() {
    this.missThisFrame = 0;
  }

  // Get the pre-painted bitmap for a chunk. Returns ImageBitmap or null.
  get(chunk, provider) {
    var bitmap = provider.getBitmap(chunk.cx, chunk.cy);
    if (!bitmap) this.missThisFrame++;
    return bitmap;
  }

  clear() {
    // Bitmaps are owned by the provider, nothing to clear here
  }

  stats() {
    return { missedTerrainChunks: this.missThisFrame };
  }
}
