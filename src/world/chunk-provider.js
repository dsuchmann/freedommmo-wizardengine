import { getWorldSeed } from '../core/world-seed.js';
import { chunkKey } from './chunk.js';
import { ChunkCompiler } from './chunk-compiler.js';

export class ChunkProvider {
  constructor({ workerCount = Math.max(2, Math.min(6, (navigator.hardwareConcurrency ?? 8) - 2)) } = {}) {
    this.compiler = new ChunkCompiler();
    this.ready = new Map();
    this.pending = new Map(); // active worker jobs
    this.queued = new Map();  // waiting jobs
    this.completed = [];      // worker results waiting for adoption
    this.assembling = new Map(); // partial chunk slices from workers
    this.workers = [];
    this.nextWorker = 0;
    this.workerSupported = typeof Worker !== 'undefined';
    this.maxActive = Math.max(1, workerCount);
    this.maxAdoptPerFrame = 1;
    this.pumpScheduled = false;

    if (this.workerSupported) {
      for (let i = 0; i < workerCount; i++) this.createWorker();
    }
  }

  createWorker() {
    try {
      const worker = new Worker(new URL('./chunk-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = event => {
        const msg = event.data;
        const { key } = msg;
        if (msg.type === 'chunkStart') {
          this.assembling.set(key, { cx: msg.cx, cy: msg.cy, tiles: [], renderTiles: [], objects: [] });
        } else if (msg.type === 'chunkSlice') {
          const partial = this.assembling.get(key);
          if (partial) {
            const offset = msg.y * 64;
            for (let i = 0; i < msg.tiles.length; i++) partial.tiles[offset + i] = msg.tiles[i];
            for (let i = 0; i < msg.renderTiles.length; i++) partial.renderTiles[offset + i] = msg.renderTiles[i];
            partial.objects.push(...msg.objects);
          }
        } else if (msg.type === 'chunkDone') {
          const partial = this.assembling.get(key);
          this.assembling.delete(key);
          this.pending.delete(key);
          if (partial) this.completed.push({ key, chunk: { cx: partial.cx, cy: partial.cy, tiles: partial.tiles, renderTiles: partial.renderTiles, objects: partial.objects } });
          this.schedulePump();
        } else if (msg.chunk) {
          this.pending.delete(key);
          this.completed.push({ key, chunk: msg.chunk });
          this.schedulePump();
        }
      };
      worker.onerror = () => {
        this.workerSupported = false;
      };
      this.workers.push(worker);
    } catch {
      this.workerSupported = false;
    }
  }

  has(cx, cy) {
    const key = chunkKey(cx, cy);
    return this.ready.has(key) || this.pending.has(key) || this.queued.has(key) || this.assembling.has(key) || this.completed.some(item => item.key === key);
  }

  request(cx, cy, priority = 0) {
    const key = chunkKey(cx, cy);
    if (this.ready.has(key) || this.pending.has(key) || this.queued.has(key) || this.assembling.has(key) || this.completed.some(item => item.key === key)) return;

    if (!this.workerSupported || this.workers.length === 0) {
      // Last-resort fallback: compile synchronously only if workers are unavailable.
      this.ready.set(key, this.compiler.compile(cx, cy));
      return;
    }

    this.queued.set(key, { key, cx, cy, priority, requestedAt: performance.now() });
    this.schedulePump();
  }

  schedulePump() {
    if (this.pumpScheduled) return;
    this.pumpScheduled = true;
    requestAnimationFrame(() => {
      this.pumpScheduled = false;
      this.pumpQueue();
    });
  }

  pumpQueue() {
    // Adopt at most one completed chunk per frame so structured-clone results
    // do not all become visible/rendered in the same frame.
    let adopted = 0;
    while (this.completed.length > 0 && adopted < this.maxAdoptPerFrame) {
      const { key, chunk } = this.completed.shift();
      this.ready.set(key, chunk);
      adopted++;
    }

    // Keep workers full, but all worker result adoption remains throttled above.
    while (this.pending.size < this.maxActive && this.queued.size > 0) {
      const jobs = [...this.queued.values()].sort((a, b) => a.priority - b.priority || a.requestedAt - b.requestedAt);
      const job = jobs[0];
      this.queued.delete(job.key);
      this.pending.set(job.key, job);
      const worker = this.workers[this.nextWorker++ % this.workers.length];
      worker.postMessage({ type: 'compileChunk', key: job.key, seed: getWorldSeed(), cx: job.cx, cy: job.cy, priority: job.priority });
    }

    if (this.completed.length > 0 || this.queued.size > 0) this.schedulePump();
  }

  getReady(cx, cy) {
    // Make sure one completed result can be adopted opportunistically before lookup.
    if (this.completed.length > 0) this.pumpQueue();
    return this.ready.get(chunkKey(cx, cy));
  }

  getOrCompileSync(cx, cy) {
    const key = chunkKey(cx, cy);
    if (!this.ready.has(key)) {
      this.pending.delete(key);
      this.queued.delete(key);
      this.assembling.delete(key);
      const idx = this.completed.findIndex(item => item.key === key);
      if (idx >= 0) {
        const [item] = this.completed.splice(idx, 1);
        this.ready.set(key, item.chunk);
      } else {
        this.ready.set(key, this.compiler.compile(cx, cy));
      }
    }
    return this.ready.get(key);
  }

  delete(cx, cy) {
    const key = chunkKey(cx, cy);
    this.ready.delete(key);
    this.pending.delete(key);
    this.queued.delete(key);
    this.assembling.delete(key);
    const idx = this.completed.findIndex(item => item.key === key);
    if (idx >= 0) this.completed.splice(idx, 1);
  }

  stats() {
    return {
      ready: this.ready.size,
      pending: this.pending.size + this.queued.size + this.completed.length,
      workers: this.workers.length,
      workerSupported: this.workerSupported
    };
  }
}
