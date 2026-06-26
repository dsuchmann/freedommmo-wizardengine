// src/render/building-sprite-cache.js — cache each building's textured silhouette as a building-LOCAL
// bitmap so the render hot path stops rebuilding (and re-uploading) a full-screen image per building
// per frame.
//
// THE PROBLEM this fixes: the per-object colour+depth pass used to call renderBuildingSilhouette() for
// every near building EVERY frame — each call cleared a full w×h canvas, re-ran drawBuildingTextured
// (walls + per-pixel weathering + damage + roof warp), then texImage2D'd that whole screen-sized image
// to the GPU. In a town that's N full-screen CPU repaints + N full-screen texture re-uploads at 60Hz
// (~336ms draw measured) — all on the main thread, leaving the GPU idle.
//
// THE FIX (mirrors the terrain chunk cache): a building's pixels are camera- AND zoom-independent in
// CONTENT (weathering/damage are deterministic; day-night tint is applied later by the GL present shader,
// NOT baked here). So render it ONCE into a tight, building-local bitmap, cache it keyed by the building's
// tile anchor ALONE, and every subsequent frame just place the cached texture via a cheap GL quad SCALED
// to the current zoom — exactly like terrain chunks, which bake once and scale the quad. Zoom changes
// therefore cost NOTHING (just a different quad size): NO per-frame rebuild during the gesture, and NO
// re-bake when it settles either. A building is baked exactly once (at the zoom where it's first seen,
// i.e. the player's working zoom) and scaled thereafter — like terrain. (An earlier version re-baked for
// crispness once zoom settled; that synchronous re-render in the draw loop produced ~0.5s spike frames
// that froze every animation on each zoom — so it's gone. Slight softness when zoomed far from the bake
// zoom is the same tradeoff terrain makes, and is preferred over the freeze.)
//
// This module is deliberately render-AGNOSTIC: the caller supplies the renderFn (drawBuildingTextured),
// so this file pulls in none of the heavy occluder/roof/dressing import chain and stays unit-testable.

// Generous north headroom (tiles) above the footprint top for tall walls + roof overhang. Matches the
// nearDepthBuildings cull margin (16 tiles) plus slack; the alpha-crop tightens the stored sprite, so
// over-sizing the transient work canvas only costs a few ms on the (one-time) miss, never per frame.
const HEAD_TILES = 18;
const SIDE_TILES = 2;        // east/west + south slack for eave overhang and shadows
const MAX_SPRITES = 384;     // LRU cap — small per-building textures, bounded memory
const EVICT_AFTER = 600;     // frames a sprite may go unused before eviction (~10s @60fps)
const BUILD_BUDGET = 3;      // max NEW building bakes per frame (same idea as terrain's CHUNK_UPLOAD_BUDGET):
                             // when many buildings enter view at once (fast-travel, zoom, walking into a
                             // town) they bake over a few frames instead of one freeze. Over-budget ones
                             // return null (not drawn this frame) and bake next frame — a 1-frame pop-in,
                             // exactly like terrain chunks.
const MAX_WARMUP = 900;      // frames an INCOMPLETE bake may keep RE-baking before it's frozen as-is (~15s @60fps).
                             // A building's tiles + roof load async, so the FIRST drawable frame is walls-only;
                             // we must re-bake until it's structurally complete (isComplete), else that walls-only
                             // sprite freezes forever (the bug: eviction only fires when size>384, so a small town
                             // never recovers). This cap is the backstop for a building whose assets never finish.

const _cache = new Map();    // key -> { canvas, ax, ay, w, h, builtTilePx, frame }
let _frame = 0;
let _builds = 0;             // NEW bakes used this frame
let _work = null, _wx = null;

if (typeof window !== 'undefined') window._buildingSpriteStats = { built: 0, hits: 0, size: 0 };
function _stat(k) { if (typeof window !== 'undefined' && window._buildingSpriteStats) window._buildingSpriteStats[k]++; }

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return null;
}

/** Stable, unique per-building key: the world-tile anchor (deterministic from seed, de-overlapped). NO
 *  zoom term — the sprite is scaled to the current zoom at draw time, so it's reused across all zooms. */
export function spriteKey(b) { return `${b.x},${b.y}`; }

/** Advance the LRU clock + reset the per-frame bake budget. Call once per rendered frame. */
export function bumpSpriteFrame() {
  _frame++;
  _builds = 0;
}

/** Drop every cached sprite (e.g. on a material/weather change that should re-bake appearance). */
export function invalidateBuildingSprites() { _cache.clear(); if (typeof window !== 'undefined' && window._buildingSpriteStats) window._buildingSpriteStats.size = 0; }

/** Tight alpha bounding box of an RGBA buffer, or null if fully transparent. */
export function alphaBBox(data, W, H) {
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    const row = y * W * 4;
    for (let x = 0; x < W; x++) {
      if (data[row + x * 4 + 3] !== 0) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { minX, minY, maxX, maxY };
}

// Render building `b` at `tilePx` into a tight, alpha-cropped building-local sprite. Returns the entry or
// null if it can't draw yet (tiles loading) / is fully empty.
function buildSprite(b, tilePx, renderFn) {
  const bb = b.footprint && b.footprint.boundingBox;
  if (!bb) return null;
  const head = Math.ceil(tilePx * HEAD_TILES);
  const side = Math.ceil(tilePx * SIDE_TILES);
  const W = Math.ceil(bb.w * tilePx) + side * 2;
  const H = Math.ceil(bb.h * tilePx) + head + side; // roof rises NORTH → headroom on top, slack below

  if (!_work || _work.width < W || _work.height < H) {
    _work = makeCanvas(Math.max(W, _work ? _work.width : 0), Math.max(H, _work ? _work.height : 0));
    if (!_work) return null;
    _wx = _work.getContext('2d', { willReadFrequently: true });
    if (!_wx) return null;
  }
  // Place the building's world anchor (b.x*tilePx, b.y*tilePx) at local (side, head) — both integers, so
  // the per-tile flooring inside renderFn phases exactly as it would with the anchor on an integer pixel.
  const localCamX = b.x * tilePx - side;
  const localCamY = b.y * tilePx - head;
  _wx.setTransform(1, 0, 0, 1, 0, 0);
  _wx.globalCompositeOperation = 'source-over';
  _wx.imageSmoothingEnabled = false;
  _wx.clearRect(0, 0, W, H);
  if (!renderFn(_wx, b, localCamX, localCamY, tilePx, W, H)) return null; // not ready → don't cache a blank

  const id = _wx.getImageData(0, 0, W, H);
  const box = alphaBBox(id.data, W, H);
  if (!box) return null;
  const cw = box.maxX - box.minX + 1, ch = box.maxY - box.minY + 1;
  const canvas = makeCanvas(cw, ch);
  if (!canvas) return null;
  const cx = canvas.getContext('2d');
  cx.imageSmoothingEnabled = false;
  cx.drawImage(_work, box.minX, box.minY, cw, ch, 0, 0, cw, ch);
  return { canvas, ax: side - box.minX, ay: head - box.minY, w: cw, h: ch, builtTilePx: tilePx, frame: _frame };
}

/** Get the cached building-local sprite for `b`, building it on a miss via renderFn. Returns
 *  { canvas, ax, ay, w, h, builtTilePx } or null if the building can't render yet / is fully empty.
 *  The sprite is baked at `builtTilePx`; the caller scales to the live tilePx:
 *    scale = tilePx / builtTilePx
 *    destX = round(b.x*tilePx - camX - ax*scale), destY = round(b.y*tilePx - camY - ay*scale)
 *    drawW = w*scale, drawH = h*scale
 *
 *  renderFn(ctx, b, camX, camY, tilePx, W, H) -> boolean: paints the building (walls+weathering+roof…)
 *  at its camera-relative position; returns false if it could not draw (assets not loaded). Matches
 *  drawBuildingTextured's signature exactly.
 *
 *  bakeState(b) -> { complete:boolean, sig:string } (optional): the cache reuses a frozen sprite ONLY while
 *  the building is complete AND its sig is unchanged. Two jobs:
 *   • complete — is the building FULLY renderable now (all tiles + roof loaded)? An incomplete bake (walls
 *     before the windows/doors/roof finish async-loading) is RE-baked each frame until it completes, so late
 *     assets appear instead of being frozen into a permanent walls-only sprite.
 *   • sig — a string of anything that VARIES and must be re-baked INTO the sprite when it changes: the live
 *     door swing frame indices. A door is part of the weathered, scaled, depth-sorted sprite (NOT a separate
 *     overlay — an overlay can't match the cache's scaling/weathering), so we re-bake the sprite the ~8 times
 *     its frame steps as the player approaches, then freeze again. Closed door (player far) → sig stable →
 *     frozen (the perf win). Omitted → always complete, never stale (legacy behavior). */
export function getBuildingSprite(b, tilePx, renderFn, bakeState) {
  const key = spriteKey(b);
  const hit = _cache.get(key);
  const state = bakeState ? bakeState(b) : null;
  const liveSig = state ? state.sig : '';
  if (hit && hit.complete && hit.sig === liveSig) { hit.frame = _frame; _stat('hits'); return hit; } // unchanged → reuse (perf win)
  // A miss, an INCOMPLETE bake (still loading), or a STALE one (door frame changed): (re)bake.
  if (_builds >= BUILD_BUDGET) { if (hit) { hit.frame = _frame; return hit; } return null; } // over budget → show last partial / defer
  const built = buildSprite(b, tilePx, renderFn);
  if (!built) { if (hit) { hit.frame = _frame; return hit; } return null; }                  // can't draw yet → keep last partial
  _builds++;
  const firstFrame = hit && hit.firstFrame != null ? hit.firstFrame : _frame;
  built.firstFrame = firstFrame;
  built.complete = state ? !!state.complete : true;
  built.sig = liveSig;
  if (!built.complete && _frame - firstFrame > MAX_WARMUP) built.complete = true;            // backstop: freeze as-is
  _cache.set(key, built);
  if (!hit) _stat('built');
  if (_cache.size > MAX_SPRITES) {
    for (const [k, e] of _cache) if (_frame - e.frame > EVICT_AFTER) _cache.delete(k);
  }
  if (typeof window !== 'undefined' && window._buildingSpriteStats) window._buildingSpriteStats.size = _cache.size;
  return built;
}
