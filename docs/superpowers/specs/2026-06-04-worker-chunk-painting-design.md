# Worker-Side Chunk Painting

Move chunk terrain painting off the main thread into existing compile workers using `OffscreenCanvas` + `createImageBitmap()`.

## Baseline

Commit `f3ed2870` (June 3, 3:00 PM). Wang tiles, cliff overlays, and terrain features all work correctly at this commit.

## Problem

`renderChunk()` runs on the main thread. For each of the 4096 tiles per chunk it:
- Looks up 8 neighbors via `tileAt()` (cross-chunk reads)
- Scans ±16 radius for nearest transition pair (up to 1089 lookups per tile)
- Calls `paintTerrainTile()`, `paintCliffOverlay()`, `paintTerrainFeatures()`

This blocks the main thread for tens of milliseconds per chunk, causing visible stutter during movement.

## Solution

Extend the existing compile workers to also paint chunks. After compiling tile data, the worker paints to an `OffscreenCanvas` and transfers the resulting `ImageBitmap` back to the main thread.

## Architecture

### Current flow
```
Main thread → Worker: compileChunk request
Worker → Main thread: chunkStart, chunkSlice × 8, chunkDone (tile data)
Main thread (render loop): renderChunk() on cache miss (BLOCKS 10-50ms)
```

### New flow
```
Main thread → Worker: compileChunk request
Worker: compile tiles → paint to OffscreenCanvas → transferToImageBitmap()
Worker → Main thread: chunkStart, chunkSlice × 8, chunkPainted (ImageBitmap transferable)
Main thread (render loop): draw cached ImageBitmap (< 1ms)
```

## Components

### 1. Worker image preloading (`chunk-worker.js`)

On worker init, before accepting any compile requests:
- Build the full list of wang tile URLs (interior tiles for all biomes, transition tiles, cliff tiles) — same list currently in `tile-painter.js` lines 72-116.
- `fetch()` each PNG → `createImageBitmap()` → store in `Map<string, ImageBitmap>`.
- Send `{ type: 'imagesReady' }` to main thread when all loaded.
- Do not process any `compileChunk` messages until images are ready.

Image list sources (from `tile-painter.js`):
- `BIOME_INTERIOR`: 20 biomes × 16 masks = 320 tiles
- `EXTRA_TRANSITION_DIRS`: ~60 dirs × 16 masks = ~960 tiles  
- `BIOME_CLIFF`: ~16 unique dirs × 16 masks = ~256 tiles
- Total: ~1536 PNGs, 32×32 each, ~300-700 bytes each

### 2. Worker-side painting (`chunk-paint.js` — new module)

A worker-compatible version of the painting pipeline. Imports:
- `paintTerrainTile()` logic from `tile-painter.js`
- `paintCliffOverlay()` logic from `tile-painter.js`
- `paintTerrainFeatures()` logic from `feature-painter.js`
- `renderChunk()` loop logic from `chunk-render-cache.js`

Key differences from main-thread versions:
- Uses `ImageBitmap` instead of `Image` for `drawImage()` calls
- Image cache is a `Map<string, ImageBitmap>` passed in, not a module global
- No DOM dependencies (`new Image()`, `.complete`, `.naturalWidth` replaced)
- `OffscreenCanvas` instead of `document.createElement('canvas')`
- `ctx.drawImage(imageBitmap, ...)` works identically on OffscreenCanvas

Function signature:
```js
paintChunk(tiles, neighbors, cx, cy, chunkSize, tileSize, imageCache) → ImageBitmap
```

Where `neighbors` is `{ north, south, east, west }` — each an array of tile data for the adjacent chunk (or null if not available).

### 3. Worker neighbor cache (`chunk-worker.js`)

Each worker maintains a `Map<string, tileArray>` of recently compiled chunks:
- After compiling a chunk, store its tile array keyed by `"cx,cy"`
- Cap at ~50 entries, LRU eviction
- When painting, look up neighbors from this cache
- If a neighbor isn't in cache, the worker can still paint — `tileAt()` returns null for missing neighbors, which falls back to self-biome (same as current behavior when neighbor chunks haven't loaded)

This means: a chunk gets painted immediately after compilation with whatever neighbor data the worker has. No waiting for neighbors. The main thread cache (two-state: partial/complete) handles re-painting when neighbors arrive.

### 4. Main thread re-paint requests

When ChunkRenderCache detects all 4 neighbors are ready and only has a "partial" cached bitmap:
- Send `{ type: 'repaintChunk', cx, cy, tiles, neighbors }` to an available worker
- Worker paints with full neighbor data → transfers new ImageBitmap
- Main thread replaces the partial bitmap with the complete one

This gives immediate display (partial) with eventual correctness (complete).

### 5. ChunkProvider changes (`chunk-provider.js`)

- Track `imagesReady` state per worker. Don't dispatch compile jobs until the worker signals ready.
- Handle new message type `chunkPainted`:
  ```js
  { type: 'chunkPainted', key, cx, cy, bitmap: ImageBitmap }
  ```
  Received via `postMessage` with `[bitmap]` transfer list.
- Store bitmaps in a `Map<string, ImageBitmap>` accessible to the render cache.
- Handle `repaintChunk` responses similarly.

### 6. ChunkRenderCache changes (`chunk-render-cache.js`)

- Remove `renderChunk()` method entirely
- `get()` becomes a pure lookup:
  ```js
  get(chunk) {
    var key = `${chunk.cx},${chunk.cy}`;
    return this.bitmaps.get(key) ?? null;
  }
  ```
- Bitmaps are inserted by ChunkProvider when `chunkPainted` messages arrive
- Remove frame budget system (no longer painting on main thread)
- Keep eviction for memory management

### 7. CanvasRenderer changes (`canvas-renderer.js`)

- `ctx.drawImage(bitmap, sx, sy, w, h)` — ImageBitmap works with regular canvas `drawImage()`
- No other changes needed

## File changes summary

| File | Change |
|------|--------|
| `src/world/chunk-worker.js` | Add image preloading, neighbor cache, paint step after compile |
| `src/render/chunk-paint.js` | **New** — worker-compatible painting (OffscreenCanvas + ImageBitmap) |
| `src/render/chunk-render-cache.js` | Simplify to bitmap lookup, remove renderChunk() |
| `src/world/chunk-provider.js` | Handle imagesReady, chunkPainted, repaintChunk messages |
| `src/render/canvas-renderer.js` | Draw ImageBitmap instead of canvas |
| `src/render/tile-painter.js` | Extract image URL list to shared module |
| `src/render/wang-image-list.js` | **New** — shared list of wang tile URLs (used by both worker and main thread preloading) |

## Constraints

- `OffscreenCanvas` and `createImageBitmap()` are supported in all modern browsers (Chrome 69+, Firefox 105+, Safari 16.4+)
- `transferToImageBitmap()` is the fast path — avoids copying pixel data
- Each worker's image cache is ~1536 ImageBitmaps × ~4KB each ≈ 6MB per worker. With 6 workers ≈ 36MB total. Acceptable.
- Chunk tile data is plain objects (biome strings, elevation numbers) — serializable via structured clone

## What stays the same

- Wang tile selection logic (getWangSrc, corner masks, transition pairs)
- Cliff overlay logic (dual-grid corners, elevation-based)
- Terrain feature painting
- ±16 scan radius (kept at 16 — no longer blocks main thread)
- Visual output — pixel-identical to current main-thread painting
