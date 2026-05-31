import { WORLD } from '../core/constants.js';

export function floorDiv(value, divisor = WORLD.chunkSize) {
  return Math.floor(value / divisor);
}

export function chunkKey(cx, cy) {
  return `${cx},${cy}`;
}

export function worldToChunk(wx, wy) {
  const cx = floorDiv(wx, WORLD.chunkSize);
  const cy = floorDiv(wy, WORLD.chunkSize);
  return { cx, cy, lx: wx - cx * WORLD.chunkSize, ly: wy - cy * WORLD.chunkSize };
}

export class ChunkStore {
  constructor(compiler) {
    this.compiler = compiler;
    this.chunks = new Map();
  }

  get(cx, cy) {
    const key = chunkKey(cx, cy);
    if (!this.chunks.has(key)) this.chunks.set(key, this.compiler.compile(cx, cy));
    return this.chunks.get(key);
  }

  streamAround(wx, wy) {
    const pcx = floorDiv(wx, WORLD.chunkSize);
    const pcy = floorDiv(wy, WORLD.chunkSize);
    for (let cy = pcy - WORLD.loadRadius; cy <= pcy + WORLD.loadRadius; cy++) {
      for (let cx = pcx - WORLD.loadRadius; cx <= pcx + WORLD.loadRadius; cx++) this.get(cx, cy);
    }
    const maxDistance = WORLD.loadRadius + WORLD.unloadPadding;
    for (const [key, chunk] of this.chunks) {
      if (Math.abs(chunk.cx - pcx) > maxDistance || Math.abs(chunk.cy - pcy) > maxDistance) this.chunks.delete(key);
    }
  }

  tileAt(wx, wy) {
    const { cx, cy, lx, ly } = worldToChunk(Math.floor(wx), Math.floor(wy));
    return this.get(cx, cy).tiles[ly * WORLD.chunkSize + lx];
  }
}
