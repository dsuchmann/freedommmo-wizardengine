import { getWorldSeed } from '../core/world-seed.js';
import { chunkKey } from './chunk.js';
import { ChunkCompiler } from './chunk-compiler.js';

export class ChunkProvider {
  constructor({ workerCount = Math.max(1, Math.min(4, (navigator.hardwareConcurrency ?? 4) - 1)) } = {}) {
    this.compiler = new ChunkCompiler();
    this.pending = new Map();
    this.ready = new Map();
    this.workers = [];
    this.nextWorker = 0;
    this.workerSupported = typeof Worker !== 'undefined';

    if (this.workerSupported) {
      for (let i = 0; i < workerCount; i++) this.createWorker();
    }
  }

  createWorker() {
    try {
      const worker = new Worker(new URL('./chunk-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = event => {
        const { key, chunk } = event.data;
        this.pending.delete(key);
        this.ready.set(key, chunk);
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
    return this.ready.has(key) || this.pending.has(key);
  }

  request(cx, cy, priority = 0) {
    const key = chunkKey(cx, cy);
    if (this.ready.has(key) || this.pending.has(key)) return;

    if (!this.workerSupported || this.workers.length === 0) {
      this.ready.set(key, this.compiler.compile(cx, cy));
      return;
    }

    this.pending.set(key, { cx, cy, priority });
    const worker = this.workers[this.nextWorker++ % this.workers.length];
    worker.postMessage({ type: 'compileChunk', key, seed: getWorldSeed(), cx, cy, priority });
  }

  getReady(cx, cy) {
    return this.ready.get(chunkKey(cx, cy));
  }

  getOrCompileSync(cx, cy) {
    const key = chunkKey(cx, cy);
    if (!this.ready.has(key)) {
      this.pending.delete(key);
      this.ready.set(key, this.compiler.compile(cx, cy));
    }
    return this.ready.get(key);
  }

  delete(cx, cy) {
    const key = chunkKey(cx, cy);
    this.ready.delete(key);
    this.pending.delete(key);
  }

  stats() {
    return { ready: this.ready.size, pending: this.pending.size, workers: this.workers.length, workerSupported: this.workerSupported };
  }
}
