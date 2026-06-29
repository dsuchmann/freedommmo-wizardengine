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
    this.lastPlayerChunk = null; // last player chunk known to be ready/cached
  }

  get(cx, cy) {
    const key = chunkKey(cx, cy);
    const ready = this.provider.getReady(cx, cy);
    if (ready) {
      this.chunks.set(key, ready);
      return ready;
    }
    this.provider.request(cx, cy);
    // Never synchronously compile chunks on the main thread while walking.
    // Return a cached copy if we have one; otherwise null and callers should
    // wait for the worker result.
    return this.chunks.get(key) ?? null;
  }

  getIfReady(cx, cy) {
    const key = chunkKey(cx, cy);
    const ready = this.provider.getReady(cx, cy);
    if (ready) this.chunks.set(key, ready);
    return ready ?? this.chunks.get(key) ?? null;
  }

  getVisible(cx, cy) {
    const key = chunkKey(cx, cy);
    const ready = this.provider.getReady(cx, cy);
    if (ready) {
      this.chunks.set(key, ready);
      return ready;
    }
    this.provider.request(cx, cy);
    return this.chunks.get(key) ?? null;
  }

  streamAround(wx, wy) {
    const pcx = floorDiv(wx, WORLD.chunkSize);
    const pcy = floorDiv(wy, WORLD.chunkSize);
    const moved = this._lastStreamPos && (Math.abs(wx - this._lastStreamPos.x) > 0.01 || Math.abs(wy - this._lastStreamPos.y) > 0.01);
    this._lastStreamPos = { x: wx, y: wy };
    this.provider.setPlayerFocus(pcx, pcy, moved);
    const currentReady = this.getIfReady(pcx, pcy);
    if (currentReady) this.lastPlayerChunk = { cx: pcx, cy: pcy };

    // The job list (and its distance sort) is fully determined by the player
    // chunk (pcx,pcy) and the local-in-chunk position (lx,ly). Memoize the
    // built+sorted array on those determinants so we skip the rebuild and the
    // per-frame sort while the player stays on the same tile within a chunk.
    const lx = ((Math.floor(wx) % WORLD.chunkSize) + WORLD.chunkSize) % WORLD.chunkSize;
    const ly = ((Math.floor(wy) % WORLD.chunkSize) + WORLD.chunkSize) % WORLD.chunkSize;
    let jobs;
    const jobCache = this._jobsCache;
    if (jobCache && jobCache.pcx === pcx && jobCache.pcy === pcy && jobCache.lx === lx && jobCache.ly === ly) {
      jobs = jobCache.jobs;
    } else {
      jobs = [];
      const addJobsAround = (ccx, ccy, extraPriority = 0) => {
        for (let cy = ccy - WORLD.loadRadius; cy <= ccy + WORLD.loadRadius; cy++) {
          for (let cx = ccx - WORLD.loadRadius; cx <= ccx + WORLD.loadRadius; cx++) {
            jobs.push({ cx, cy, d: Math.abs(cx - ccx) + Math.abs(cy - ccy) + extraPriority });
          }
        }
      };
      addJobsAround(pcx, pcy, 0);
      // Predictive prefetch: when near a chunk edge, start streaming the next
      // chunk neighborhood before the player crosses the boundary.
      const margin = Math.max(24, Math.floor(WORLD.chunkSize * 0.50));
      if (lx < margin) addJobsAround(pcx - 1, pcy, 3);
      if (lx >= WORLD.chunkSize - margin) addJobsAround(pcx + 1, pcy, 3);
      if (ly < margin) addJobsAround(pcx, pcy - 1, 3);
      if (ly >= WORLD.chunkSize - margin) addJobsAround(pcx, pcy + 1, 3);
      jobs.sort((a, b) => a.d - b.d);
      this._jobsCache = { pcx, pcy, lx, ly, jobs };
    }
    const seenJobs = new Set();
    for (const job of jobs) {
      const key = chunkKey(job.cx, job.cy);
      if (seenJobs.has(key)) continue;
      seenJobs.add(key);
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
    const chunk = this.getVisible(cx, cy);
    if (chunk) return chunk.tiles[ly * WORLD.chunkSize + lx];
    // If the target chunk is not ready yet, fall back to nearest loaded tile
    // from the last player chunk so the game never blocks compiling a chunk.
    if (this.lastPlayerChunk) {
      const fallback = this.getIfReady(this.lastPlayerChunk.cx, this.lastPlayerChunk.cy);
      if (fallback) {
        const fx = Math.max(0, Math.min(WORLD.chunkSize - 1, lx));
        const fy = Math.max(0, Math.min(WORLD.chunkSize - 1, ly));
        return fallback.tiles[fy * WORLD.chunkSize + fx];
      }
    }
    // Absolute emergency fallback: compile only when no chunks are loaded at all
    // (initial boot). This path should not happen during normal walking.
    return this.provider.getOrCompileSync(cx, cy).tiles[ly * WORLD.chunkSize + lx];
  }

  stats() {
    return this.provider.stats();
  }
}
