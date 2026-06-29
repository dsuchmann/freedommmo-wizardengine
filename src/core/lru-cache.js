// src/core/lru-cache.js — a Map-shaped cache bounded by an estimated BYTE budget, evicting the
// least-recently-used entries when over budget. The codebase has ~30 per-URL image/bitmap/canvas
// caches that grew unbounded as the player roamed biomes (decoded @384 frames are ~590KB each) →
// heap/VRAM creep. This gives them all a continuous bound while keeping the on-screen working set
// hot (get() refreshes recency), so a cache miss only ever costs a re-decode of something genuinely
// off-screen — never the visible set.
//
// Drop-in for `new Map()` for the get/has/set/delete/clear/size surface those caches use. Values may
// be anything; pass sizeOf(value)->bytes and (optionally) onEvict(value) to release the resource
// (img.src='' to free the decode, ImageBitmap.close(), etc.). Insertion order = recency order (JS
// Map keeps insertion order; get()/set() move the key to the end).

export class BudgetCache {
  constructor({ budgetBytes = 256 * 1024 * 1024, sizeOf = () => 0, onEvict = null } = {}) {
    this._m = new Map();        // key -> { v, b }
    this._budget = budgetBytes;
    this._bytes = 0;
    this._sizeOf = sizeOf;
    this._onEvict = onEvict;
  }

  has(k) { return this._m.has(k); }

  get(k) {
    const e = this._m.get(k);
    if (e === undefined) return undefined;
    this._m.delete(k); this._m.set(k, e); // refresh recency (move to newest)
    return e.v;
  }

  set(k, v) {
    const prev = this._m.get(k);
    if (prev !== undefined) { this._bytes -= prev.b; this._m.delete(k); }
    let b = 0; try { b = this._sizeOf(v) || 0; } catch (e) { b = 0; }
    this._m.set(k, { v, b });
    this._bytes += b;
    this._evict();
    return this;
  }

  delete(k) {
    const e = this._m.get(k);
    if (e === undefined) return false;
    this._bytes -= e.b; this._m.delete(k);
    if (this._onEvict) { try { this._onEvict(e.v); } catch (x) { /* release best-effort */ } }
    return true;
  }

  // Evict least-recently-used (oldest insertion) until under budget. Keeps at least 1 entry so a
  // single oversized item can't loop forever.
  _evict() {
    while (this._bytes > this._budget && this._m.size > 1) {
      const k = this._m.keys().next().value;
      const e = this._m.get(k);
      this._bytes -= e.b; this._m.delete(k);
      if (this._onEvict) { try { this._onEvict(e.v); } catch (x) { /* release best-effort */ } }
    }
  }

  // Drop entries not refreshed recently — called on a scene discontinuity to release the old biome's
  // working set promptly (the budget alone would hold it until pressure). Keeps `keepNewest` most-
  // recent entries (the destination's just-loaded set), evicts the rest.
  trimTo(keepNewest) {
    const drop = this._m.size - keepNewest;
    if (drop <= 0) return 0;
    let n = 0;
    for (const k of [...this._m.keys()].slice(0, drop)) { this.delete(k); n++; }
    return n;
  }

  clear() {
    if (this._onEvict) { for (const e of this._m.values()) { try { this._onEvict(e.v); } catch (x) { /* best-effort */ } } }
    this._m.clear(); this._bytes = 0;
  }

  get size() { return this._m.size; }
  get bytes() { return this._bytes; }
}
