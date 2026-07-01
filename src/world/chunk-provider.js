import { getWorldSeed } from '../core/world-seed.js';
import { chunkKey } from './chunk.js';
import { ChunkCompiler } from './chunk-compiler.js';
import { sampleRegionalMapChunk } from './regional-map.js';
import { preloadField2Animations } from '../render/field2-animator.js';
import { fireSceneDiscontinuity } from '../core/scene-teardown.js';

export class ChunkProvider {
  constructor({ workerCount = Math.max(2, Math.min(6, (navigator.hardwareConcurrency ?? 8) - 2)) } = {}) {
    this.compiler = new ChunkCompiler();
    this.ready = new Map();
    this.pending = new Map();
    this.queued = new Map();
    this.completed = [];
    // Parallel key index for O(1) membership tests (has()/request()); kept in
    // exact sync with `completed` at every push/shift/splice site below so the
    // visible result is identical to the old `completed.some(...)` scan.
    this.completedKeys = new Set();
    this.assembling = new Map();
    this.bitmaps = new Map();
    this.workers = [];
    this.nextWorker = 0;
    this.workerSupported = typeof Worker !== 'undefined';
    this.maxActive = Math.max(1, workerCount);
    this.adoptBudgetMs = 3.0;       // frame-time budget for adopting compiled chunks
    this.adoptBudgetMovingMs = 1.5; // tighter while the player is moving
    this._playerChunk = null;
    this._playerMoving = false;
    this.pumpScheduled = false;
    this.wangDebug = new Map();
    this.indexes = new Map();
    this.workersReady = 0;
    // Field-tuning generation. Bumped on every F3-affecting tuning change;
    // workers stamp painted bitmaps with the gen they painted under, and
    // stale-gen bitmaps are discarded (fixes in-flight paints from the old
    // tree landing AFTER the purge and blocking the real repaint).
    this.tuneGen = 0;

    if (this.workerSupported) {
      for (let i = 0; i < workerCount; i++) this.createWorker();
    }

    // Runtime enable helper: window._floraWorker(true) sets the flag AND broadcasts to the
    // already-created workers (they read the flag at create time, so a plain console assignment
    // wouldn't reach them). window._floraWorker(false) disables. Dev/validation convenience.
    if (typeof window !== 'undefined') {
      window._floraWorker = (on = true) => { window._workerFloraDesc = !!on; this.setWorkerFloraDesc(on); return 'workerFloraDesc=' + !!on; };
    }
  }

  // Sample biomes in a radius around a world position and tell workers to preload those tiles.
  // Safe to call repeatedly (e.g. periodically as the player moves) — it
  // no-ops until the player has moved far enough from the last preload center.
  initPreload(wx, wy, force = false) {
    const pcx = Math.floor(wx / 64);
    const pcy = Math.floor(wy / 64);
    // The 15-chunk guard suppresses redundant preloads during incremental WALKING. A
    // teleport/fast-travel is a DISCONTINUITY (force=true): it must preload the destination
    // biomes + F2-F6 sprites immediately, or the flora stays absent until the next 128-frame
    // tick happens to clear the guard — sometimes never, if the jump landed within 15 chunks.
    if (!force && this._lastPreload && Math.max(Math.abs(pcx - this._lastPreload.cx), Math.abs(pcy - this._lastPreload.cy)) < 15) return;
    this._lastPreload = { cx: pcx, cy: pcy };
    // A forced preload is a teleport/fast-travel DISCONTINUITY: fire the teardown bus so every
    // per-biome cache (GL textures, decoded-image caches, …) drops its now-offscreen old-biome
    // entries at once, instead of leaking them until a slow age-based sweep (the 3-4fps cause).
    if (force) {
      fireSceneDiscontinuity({ x: wx, y: wy });
      this.wangDebug.clear();                                    // unbounded debug map — drop old-biome entries
      this.indexes.clear();                                      // GPU index buffers — evict alongside wangDebug
    }
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
    // Remember the wide biome set so the GPU-terrain atlas loader (canvas-renderer
    // _ensureWangAtlas) can grow the Wang atlas to cover every biome the player is
    // near — not just the bootstrap grassland set.
    this._activeBiomes = biomes;
    // Tight "core" set: the biomes actually around the player right now. Workers
    // gate their first paint on this small set (see chunk-worker preloadBiomes)
    // so the world appears in seconds instead of blocking on all 21 biomes' wang
    // art. The wider `biomes` set still streams in via backgroundLoadRemaining().
    const coreSet = new Set();
    const coreRadius = 5;
    for (let dy = -coreRadius; dy <= coreRadius; dy++) {
      for (let dx = -coreRadius; dx <= coreRadius; dx++) {
        coreSet.add(sampleRegionalMapChunk(pcx + dx, pcy + dy).id);
      }
    }
    const coreBiomes = [...coreSet];
    // Field 6 DISABLED — skip large object preloading to avoid 404 noise
    // preloadLargeObjectSprites(biomes);
    // Preload Field 2 wind sway animation frames on main thread
    preloadField2Animations(biomes);
    for (const worker of this.workers) {
      worker.postMessage({ type: 'preloadBiomes', biomes, coreBiomes });
    }
  }

  // Push the field-tuning tree to every worker. When repaintChunks is true
  // (F3 edits — F3 is baked into chunk bitmaps), drop all bitmaps; pumpQueue
  // already repaints any ready chunk that lacks a bitmap.
  applyFieldTuning(tuning, repaintChunks) {
    if (repaintChunks) this.tuneGen++;
    for (const worker of this.workers) {
      worker.postMessage({ type: 'setFieldTuning', tuning, gen: this.tuneGen });
    }
    if (repaintChunks) {
      for (const bmp of this.bitmaps.values()) bmp.close();
      this.bitmaps.clear();
      if (this._repaintPending) this._repaintPending.clear();
      this.schedulePump();
    }
  }

  // Push updated F3 removed-keys set to every worker and repaint affected chunk bitmaps.
  // Called from main.js whenever simWorldState changes and removal set differs.
  setF3RemovedKeys(keysArray) {
    for (const worker of this.workers) {
      worker.postMessage({ type: 'setF3RemovedKeys', keys: keysArray });
    }
    // Compute which chunk bitmaps are stale (contain at least one removed placement tile)
    const dirtyChunks = new Set();
    for (const key of keysArray) {
      // key format: 'f3:wx,wy:i' — extract wx,wy
      const m = key.match(/^f3:(-?\d+),(-?\d+):/);
      if (!m) continue;
      const wx = parseInt(m[1], 10);
      const wy = parseInt(m[2], 10);
      // chunkSize = 64 (matches WORLD.chunkSize constant)
      const cx = Math.floor(wx / 64);
      const cy = Math.floor(wy / 64);
      dirtyChunks.add(cx + ',' + cy);
    }
    // Drop stale bitmaps so pumpQueue repaints them
    for (const bk of dirtyChunks) {
      const bmp = this.bitmaps.get(bk);
      if (bmp) { bmp.close(); this.bitmaps.delete(bk); }
    }
    if (dirtyChunks.size > 0) this.schedulePump();
  }

  // Called by ChunkStore.streamAround every frame: lets the queue re-sort by
  // CURRENT distance (priorities assigned at request time go stale as the
  // player walks) and tightens the adoption budget while moving.
  setPlayerFocus(cx, cy, moving, dirX = 0, dirY = 0) {
    this._playerChunk = { cx, cy };
    this._playerMoving = !!moving;
    this._playerDir = { x: dirX, y: dirY };
  }

  createWorker() {
    try {
      // Cache-bust: append timestamp so browser reloads worker modules on code changes
      const workerUrl = new URL('./chunk-worker.js', import.meta.url);
      workerUrl.searchParams.set('v', '20260619f-roof-overhang-nodroop-gputiles9-gclumid');
      const worker = new Worker(workerUrl, { type: 'module' });
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
          if (msg.gen != null && msg.gen !== this.tuneGen) {
            // Painted under an old tuning tree — drop the bitmap (chunk stays
            // bitmap-less so pumpQueue repaints it under the current tree)
            if (msg.bitmap) msg.bitmap.close();
          } else {
            // msg.bitmap is null on the P4 GPU path (chunk renders via its index;
            // no bitmap was baked). Store the index; leave the bitmap slot empty.
            if (msg.bitmap) {
              const old = this.bitmaps.get(bitmapKey);
              if (old) old.close();
              this.bitmaps.set(bitmapKey, msg.bitmap);
            }
            if (msg.wangDebug) this.wangDebug.set(bitmapKey, msg.wangDebug);
            if (msg.index) this.indexes.set(bitmapKey, new Uint16Array(msg.index));
          }
          // chunkPainted replaces chunkDone — finalize assembly
          const partial = this.assembling.get(key);
          this.assembling.delete(key);
          this.pending.delete(key);
          if (partial) {
            const finalizedChunk = { cx: partial.cx, cy: partial.cy, tiles: partial.tiles, renderTiles: partial.renderTiles, objects: partial.objects };
            // Attach flora descriptors that arrived BEFORE this chunk finalized (rare — the
            // worker posts chunkFlora after chunkPainted on the same worker, so ordering is
            // preserved; this is the defensive path for any reorder). No-op when flora off.
            this._attachPendingFlora(key, finalizedChunk);
            this.completed.push({ key, chunk: finalizedChunk });
            this.completedKeys.add(key);
          }
          this.schedulePump();
        } else if (msg.type === 'chunkFlora') {
          // Off-thread flora descriptors (worker computed them when window._workerFloraDesc is
          // set). Attach the transferred buffers to the already-finalized chunk (the common
          // case — chunkFlora is posted right after chunkPainted), or stash them to attach on
          // finalize. Discard on gen mismatch (mirror the bitmap gen check above).
          if (msg.gen != null && msg.gen !== this.tuneGen) {
            // painted under an old tuning tree — drop; the chunk recompiles under the new tree
          } else {
            const bytes = new Uint8Array(msg.floraBytes);
            const offsets = new Uint32Array(msg.floraOffsets);
            const chunk = this._findAssembledChunk(key);
            if (chunk) {
              chunk.floraBytes = bytes;
              chunk.floraOffsets = offsets;
            } else {
              if (!this._pendingFlora) this._pendingFlora = new Map();
              if (this._pendingFlora.size > 256) this._pendingFlora.clear(); // bounded safety valve
              this._pendingFlora.set(key, { bytes, offsets, gen: msg.gen });
            }
          }
        } else if (msg.type === 'repaintNeedsTiles') {
          // Worker evicted this chunk's tiles from its neighbor cache — resend them
          const chunk = this.ready.get(msg.key);
          if (chunk) {
            const neighbors = {};
            neighbors[msg.cx + ',' + msg.cy] = chunk.tiles;
            worker.postMessage({ type: 'repaintChunk', key: msg.key, seed: getWorldSeed(), cx: msg.cx, cy: msg.cy, neighbors });
          }
        } else if (msg.type === 'chunkRepainted') {
          const bitmapKey = msg.cx + ',' + msg.cy;
          if (this._repaintPending) this._repaintPending.delete(bitmapKey);
          if (msg.gen != null && msg.gen !== this.tuneGen) {
            // Stale-tree repaint — discard; pumpQueue re-requests it fresh
            msg.bitmap.close();
            this.schedulePump();
          } else {
            const old = this.bitmaps.get(bitmapKey);
            if (old) old.close();
            this.bitmaps.set(bitmapKey, msg.bitmap);
            if (msg.wangDebug) this.wangDebug.set(bitmapKey, msg.wangDebug);
            if (msg.index) this.indexes.set(bitmapKey, new Uint16Array(msg.index));
          }
        } else if (msg.type === 'chunkDone') {
          // Legacy fallback — shouldn't fire with new worker but handle gracefully
          const partial = this.assembling.get(key);
          this.assembling.delete(key);
          this.pending.delete(key);
          if (partial) { this.completed.push({ key, chunk: { cx: partial.cx, cy: partial.cy, tiles: partial.tiles, renderTiles: partial.renderTiles, objects: partial.objects } }); this.completedKeys.add(key); }
          this.schedulePump();
        } else if (msg.chunk) {
          this.pending.delete(key);
          this.completed.push({ key, chunk: msg.chunk });
          this.completedKeys.add(key);
          this.schedulePump();
        }
      };
      worker.onerror = () => {
        this.workerSupported = false;
      };
      this.workers.push(worker);
      // Replay GPU-terrain state to this worker in case it was created after
      // setWangAtlasMeta / setGpuTerrain were already broadcast to earlier workers.
      if (this._wangAtlasMeta) worker.postMessage({ type: 'setWangAtlasMeta', meta: this._wangAtlasMeta });
      if (this._gpuTerrain) worker.postMessage({ type: 'setGpuTerrain', on: true });
      // Off-thread flora descriptors are OFF by default: enable per worker ONLY when the main
      // thread opt-in flag is set. Unset → nothing posted → worker stays byte-identical.
      if (typeof window !== 'undefined' && window._workerFloraDesc) worker.postMessage({ type: 'setFloraDesc', enabled: true });
    } catch {
      this.workerSupported = false;
    }
  }

  has(cx, cy) {
    const key = chunkKey(cx, cy);
    return this.ready.has(key) || this.pending.has(key) || this.queued.has(key) || this.assembling.has(key) || this.completedKeys.has(key);
  }

  request(cx, cy, priority = 0) {
    const key = chunkKey(cx, cy);
    if (this.ready.has(key) || this.pending.has(key) || this.queued.has(key) || this.assembling.has(key) || this.completedKeys.has(key)) return;

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
    const budget = this._playerMoving ? this.adoptBudgetMovingMs : this.adoptBudgetMs;
    const t0 = performance.now();
    let adopted = 0;
    while (this.completed.length > 0 && (adopted === 0 || performance.now() - t0 < budget)) {
      const { key, chunk } = this.completed.shift();
      this.completedKeys.delete(key);
      this.ready.set(key, chunk);
      adopted++;
    }

    const readyWorkers = this.workers.filter(w => w._imagesReady);
    if (readyWorkers.length > 0 && this.pending.size < this.maxActive && this.queued.size > 0) {
      // Sort the queue ONCE per pump (was re-sorted on every dispatched job).
      // The sort key (player chunk + per-job priority/requestedAt) is invariant
      // for the duration of this call, so taking jobs in sorted order yields the
      // identical dispatch sequence the per-iteration re-sort produced.
      const pc = this._playerChunk;
      const dir = this._playerDir || { x: 0, y: 0 };
      // DIRECTIONAL PRIORITY: chunks AHEAD of the player's movement are generated first, so the limited worker
      // throughput keeps up with where they're running TO instead of being split evenly around them. score =
      // chunk-distance MINUS how far the chunk lies along the heading (×AHEAD_WEIGHT). With no movement (dir≈0)
      // this collapses to the plain nearest-first distance sort.
      const AHEAD_WEIGHT = 2.0;
      const score = (j) => {
        const rx = j.cx - pc.cx, ry = j.cy - pc.cy;
        const dist = Math.abs(rx) + Math.abs(ry);
        const ahead = rx * dir.x + ry * dir.y; // >0 = in the direction of travel
        return dist - Math.max(0, ahead) * AHEAD_WEIGHT;
      };
      const jobs = [...this.queued.values()].sort((a, b) => {
        const da = pc ? score(a) : a.priority;
        const db = pc ? score(b) : b.priority;
        return da - db || a.requestedAt - b.requestedAt;
      });
      let ji = 0;
      while (this.pending.size < this.maxActive && ji < jobs.length) {
        const job = jobs[ji++];
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
          worker.postMessage({ type: 'repaintChunk', key, seed: getWorldSeed(), cx: chunk.cx, cy: chunk.cy, neighbors });
        }
      }
    }

    if (this.completed.length > 0 || this.queued.size > 0) this.schedulePump();
  }

  // Find an already-finalized chunk object by key — in `ready`, or still waiting in
  // `completed`. Used to attach flora descriptors that arrive on a separate message
  // right after chunkPainted. Returns the chunk object (mutable) or null.
  _findAssembledChunk(key) {
    if (this.ready.has(key)) return this.ready.get(key);
    for (const c of this.completed) if (c.key === key) return c.chunk;
    return null;
  }

  // Attach flora buffers that arrived before this chunk finalized (gen-checked).
  _attachPendingFlora(key, chunk) {
    if (!this._pendingFlora) return;
    const pf = this._pendingFlora.get(key);
    if (!pf) return;
    this._pendingFlora.delete(key);
    if (pf.gen == null || pf.gen === this.tuneGen) {
      chunk.floraBytes = pf.bytes;
      chunk.floraOffsets = pf.offsets;
    }
  }

  // Broadcast the flora-desc gate to every existing worker. Call after flipping
  // window._workerFloraDesc at runtime; workers created later pick it up in createWorker.
  setWorkerFloraDesc(on) {
    for (const worker of this.workers) worker.postMessage({ type: 'setFloraDesc', enabled: !!on });
  }

  getBitmap(cx, cy) {
    return this.bitmaps.get(cx + ',' + cy) ?? null;
  }

  getWangDebug(cx, cy) {
    return this.wangDebug.get(cx + ',' + cy) ?? null;
  }

  getChunkIndex(cx, cy) {
    return this.indexes.get(cx + ',' + cy) || null;
  }

  // The wide biome set sampled around the player by the most recent initPreload.
  // The GPU-terrain atlas loader grows the Wang atlas to cover these biomes.
  getActiveBiomes() {
    return this._activeBiomes || null;
  }

  setGpuTerrain(on) {
    this._gpuTerrain = !!on;
    for (const worker of this.workers) worker.postMessage({ type: 'setGpuTerrain', on: !!on });
  }

  setWangAtlasMeta(meta) {
    this._wangAtlasMeta = meta;
    for (const worker of this.workers) worker.postMessage({ type: 'setWangAtlasMeta', meta });
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
        this.completedKeys.delete(key);
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
    this.indexes.delete(bitmapKey); // GPU index is now load-bearing (P4) — evict with the chunk
    const idx = this.completed.findIndex(item => item.key === key);
    if (idx >= 0) this.completed.splice(idx, 1);
    this.completedKeys.delete(key);
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
