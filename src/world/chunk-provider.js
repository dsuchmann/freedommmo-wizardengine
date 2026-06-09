import { getWorldSeed } from '../core/world-seed.js';
import { chunkKey } from './chunk.js';
import { ChunkCompiler } from './chunk-compiler.js';
import { sampleRegionalMapChunk } from './regional-map.js';
import { preloadLargeObjectSprites } from '../render/large-object-renderer.js';
import { preloadField2Animations } from '../render/field2-animator.js';

export class ChunkProvider {
  constructor({ workerCount = Math.max(2, Math.min(6, (navigator.hardwareConcurrency ?? 8) - 2)) } = {}) {
    this.compiler = new ChunkCompiler();
    this.ready = new Map();
    this.pending = new Map();
    this.queued = new Map();
    this.completed = [];
    this.assembling = new Map();
    this.bitmaps = new Map();
    this.workers = [];
    this.nextWorker = 0;
    this.workerSupported = typeof Worker !== 'undefined';
    this.maxActive = Math.max(1, workerCount);
    this.maxAdoptPerFrame = 1;
    this.pumpScheduled = false;
    this.wangDebug = new Map();
    this.workersReady = 0;

    if (this.workerSupported) {
      for (let i = 0; i < workerCount; i++) this.createWorker();
    }
  }

  // Sample biomes in a radius around a world position and tell workers to preload those tiles.
  initPreload(wx, wy) {
    const pcx = Math.floor(wx / 64);
    const pcy = Math.floor(wy / 64);
    const biomeSet = new Set();
    // Sample a grid around the player — sparse sampling is fine, just need biome variety
    const sampleRadius = 30;
    const step = 3;
    for (let dy = -sampleRadius; dy <= sampleRadius; dy += step) {
      for (let dx = -sampleRadius; dx <= sampleRadius; dx += step) {
        const sample = sampleRegionalMapChunk(pcx + dx, pcy + dy);
        biomeSet.add(sample.id);
      }
    }
    const biomes = [...biomeSet];
    // Field 6 DISABLED — skip large object preloading to avoid 404 noise
    // preloadLargeObjectSprites(biomes);
    // Preload Field 2 wind sway animation frames on main thread
    preloadField2Animations(biomes);
    for (const worker of this.workers) {
      worker.postMessage({ type: 'preloadBiomes', biomes });
    }
  }

  createWorker() {
    try {
      const worker = new Worker(new URL('./chunk-worker.js', import.meta.url), { type: 'module' });
      worker._imagesReady = false;
      worker.onmessage = event => {
        const msg = event.data;
        if (msg.type === 'imagesReady') {
          worker._imagesReady = true;
          this.workersReady++;
          this.schedulePump();
          return;
        }
        if (msg.type === 'decorationsReady') {
          return; // no-op — soil/gc now load in phase 1
        }
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
        } else if (msg.type === 'chunkPainted') {
          // Bitmap arrived — store it. Also finalize chunk data assembly.
          const bitmapKey = msg.cx + ',' + msg.cy;
          const old = this.bitmaps.get(bitmapKey);
          if (old) old.close();
          this.bitmaps.set(bitmapKey, msg.bitmap);
          if (msg.wangDebug) this.wangDebug.set(bitmapKey, msg.wangDebug);
          // chunkPainted replaces chunkDone — finalize assembly
          const partial = this.assembling.get(key);
          this.assembling.delete(key);
          this.pending.delete(key);
          if (partial) this.completed.push({ key, chunk: { cx: partial.cx, cy: partial.cy, tiles: partial.tiles, renderTiles: partial.renderTiles, objects: partial.objects } });
          this.schedulePump();
        } else if (msg.type === 'chunkRepainted') {
          const bitmapKey = msg.cx + ',' + msg.cy;
          const old = this.bitmaps.get(bitmapKey);
          if (old) old.close();
          this.bitmaps.set(bitmapKey, msg.bitmap);
          if (msg.wangDebug) this.wangDebug.set(bitmapKey, msg.wangDebug);
          if (this._repaintPending) this._repaintPending.delete(bitmapKey);
        } else if (msg.type === 'chunkDone') {
          // Legacy fallback — shouldn't fire with new worker but handle gracefully
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
    let adopted = 0;
    while (this.completed.length > 0 && adopted < this.maxAdoptPerFrame) {
      const { key, chunk } = this.completed.shift();
      this.ready.set(key, chunk);
      adopted++;
    }

    const readyWorkers = this.workers.filter(w => w._imagesReady);
    if (readyWorkers.length > 0) {
      while (this.pending.size < this.maxActive && this.queued.size > 0) {
        const jobs = [...this.queued.values()].sort((a, b) => a.priority - b.priority || a.requestedAt - b.requestedAt);
        const job = jobs[0];
        this.queued.delete(job.key);
        this.pending.set(job.key, job);
        const worker = readyWorkers[this.nextWorker++ % readyWorkers.length];
        worker.postMessage({ type: 'compileChunk', key: job.key, seed: getWorldSeed(), cx: job.cx, cy: job.cy, priority: job.priority });
      }
    }

    // Request repaints for ready chunks that have no bitmap yet
    if (readyWorkers.length > 0) {
      for (const [key, chunk] of this.ready.entries()) {
        const bk = chunk.cx + ',' + chunk.cy;
        if (!this.bitmaps.has(bk) && !this._repaintPending?.has(bk)) {
          if (!this._repaintPending) this._repaintPending = new Set();
          this._repaintPending.add(bk);
          const neighbors = {};
          neighbors[bk] = chunk.tiles;
          const worker = readyWorkers[this.nextWorker++ % readyWorkers.length];
          worker.postMessage({ type: 'repaintChunk', key, cx: chunk.cx, cy: chunk.cy, neighbors });
        }
      }
    }

    if (this.completed.length > 0 || this.queued.size > 0) this.schedulePump();
  }

  getBitmap(cx, cy) {
    return this.bitmaps.get(cx + ',' + cy) ?? null;
  }

  getWangDebug(cx, cy) {
    return this.wangDebug.get(cx + ',' + cy) ?? null;
  }

  getReady(cx, cy) {
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
    // If no bitmap yet, send to a worker for painting
    const chunk = this.ready.get(key);
    if (chunk && !this.bitmaps.has(cx + ',' + cy)) {
      const readyWorkers = this.workers.filter(w => w._imagesReady);
      if (readyWorkers.length > 0) {
        const neighbors = {};
        neighbors[cx + ',' + cy] = chunk.tiles;
        const worker = readyWorkers[this.nextWorker++ % readyWorkers.length];
        worker.postMessage({ type: 'repaintChunk', key, cx, cy, neighbors });
      }
    }
    return chunk;
  }

  delete(cx, cy) {
    const key = chunkKey(cx, cy);
    this.ready.delete(key);
    this.pending.delete(key);
    this.queued.delete(key);
    this.assembling.delete(key);
    const bitmapKey = cx + ',' + cy;
    const bmp = this.bitmaps.get(bitmapKey);
    if (bmp) { bmp.close(); this.bitmaps.delete(bitmapKey); }
    const idx = this.completed.findIndex(item => item.key === key);
    if (idx >= 0) this.completed.splice(idx, 1);
  }

  stats() {
    return {
      ready: this.ready.size,
      pending: this.pending.size + this.queued.size + this.completed.length,
      workers: this.workers.length,
      workersReady: this.workersReady,
      workerSupported: this.workerSupported,
      bitmaps: this.bitmaps.size
    };
  }
}
