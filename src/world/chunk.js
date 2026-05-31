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
  constructor(provider) {
    this.provider = provider;
    this.chunks = new Map();
    this.lastPlayerChunk = null;
  }

  get(cx, cy) {
    const key = chunkKey(cx, cy);
    const ready = this.provider.getReady(cx, cy);
    if (ready) {
      this.chunks.set(key, ready);
      return ready;
    }
    this.provider.request(cx, cy);
    return this.provider.getOrCompileSync(cx, cy);
  }

  getIfReady(cx, cy) {
    const key = chunkKey(cx, cy);
    const ready = this.provider.getReady(cx, cy);
    if (ready) this.chunks.set(key, ready);
    return ready ?? this.chunks.get(key) ?? null;
  }

  streamAround(wx, wy) {
    const pcx = floorDiv(wx, WORLD.chunkSize);
    const pcy = floorDiv(wy, WORLD.chunkSize);
    this.lastPlayerChunk = { cx: pcx, cy: pcy };

    const jobs = [];
    for (let cy = pcy - WORLD.loadRadius; cy <= pcy + WORLD.loadRadius; cy++) {
      for (let cx = pcx - WORLD.loadRadius; cx <= pcx + WORLD.loadRadius; cx++) {
        jobs.push({ cx, cy, d: Math.abs(cx - pcx) + Math.abs(cy - pcy) });
      }
    }
    jobs.sort((a, b) => a.d - b.d);
    for (const job of jobs) {
      const key = chunkKey(job.cx, job.cy);
      const ready = this.provider.getReady(job.cx, job.cy);
      if (ready) this.chunks.set(key, ready);
      else this.provider.request(job.cx, job.cy, job.d);
    }

    const maxDistance = WORLD.loadRadius + WORLD.unloadPadding;
    for (const [key, chunk] of this.chunks) {
      if (Math.abs(chunk.cx - pcx) > maxDistance || Math.abs(chunk.cy - pcy) > maxDistance) {
        this.chunks.delete(key);
        this.provider.delete(chunk.cx, chunk.cy);
      }
    }
  }

  tileAt(wx, wy) {
    const { cx, cy, lx, ly } = worldToChunk(Math.floor(wx), Math.floor(wy));
    return this.get(cx, cy).tiles[ly * WORLD.chunkSize + lx];
  }

  stats() {
    return this.provider.stats();
  }
}
