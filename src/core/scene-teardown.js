// src/core/scene-teardown.js — central "scene discontinuity" teardown bus.
//
// A far teleport / fast-travel is a DISCONTINUITY: the old biome's chunks, sprites, building
// textures and decoded-image caches are suddenly off-screen and will (from here) never be drawn
// again. Without a teardown, each of the ~30 per-biome caches across the codebase (GL textures,
// ImageBitmaps, Images, canvases) keeps its old-biome entries FOREVER → VRAM + heap grow on every
// teleport → the 3-4fps collapse. Every such cache registers a handler here once; the teleport path
// fires this bus a single time and they all evict their stale entries together.
//
// Contract for handlers: drop entries that are genuinely off-screen (by lastUsed age / distance),
// NOT the whole cache blindly — walking must stay incremental. Handlers must never throw into the
// teleport path (wrapped in try/catch here as a backstop).

const _handlers = new Set();

/** Register a teardown handler. Returns an unsubscribe fn. */
export function onSceneDiscontinuity(fn) { _handlers.add(fn); return () => _handlers.delete(fn); }

/** Fire every teardown handler once. `info` = { x, y } destination world tile (optional). */
export function fireSceneDiscontinuity(info) {
  const ctx = info || {};
  for (const fn of _handlers) {
    try { fn(ctx); } catch (e) { /* a cache teardown must never break the teleport */ }
  }
}

/** Count of registered handlers (dev/test introspection). */
export function sceneTeardownHandlerCount() { return _handlers.size; }
