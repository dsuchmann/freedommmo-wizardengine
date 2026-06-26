// src/render/building-door-overlay.js
// LIVE DOOR ANIMATION as its own GL sprite — the clean fix for doors freezing inside the once-baked building
// sprite cache. building-sprite-cache.js bakes each building's silhouette EXACTLY once and never rebuilds (the
// 336ms→2.8ms perf win), so a per-frame proximity door swing baked into it froze at the bake-time frame —
// always closed, because a building is first seen from far away. The cache now bakes the door CLOSED
// (building-tiles.setStaticDoorBake) and we draw the CURRENT swing frame HERE, on top, every frame.
//
// Everything-through-GL: this routes through the SAME glc.drawBuildingSprite path as the walls, so the door
// inherits the GL lighting / day-night / CRT present pass — it is NOT a 2D top-pass overlay. The door is
// depth-sorted WITH its building (a hair nearer, so it wins the LESS depth test over the baked closed door),
// so the player still slides behind/in-front of the doorway exactly as before.
//
// Cost: the swing frame changes only ~8× across a whole approach, so the small door texture re-uploads only on
// a frame change; every other frame is a free quad redraw. Only doors the player is NEAR (fi>0) ever enter the
// cache, so in a town this stays a handful of tiny canvases.

import { doorAnimRects } from './building-tiles.js';

const _DOOR_EPS = 0.0009;        // draw the door fractionally NEARER than its building so it passes depthFunc LESS
const _canvasCache = new Map();  // 'bx,by:idx' -> { fi, w, h, canvas } — a NEW canvas object on frame/size change
const _CAP = 256;                // soft cap (only near-door entries exist; clear wholesale if a long session drifts)

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return null;
}

/** Draw building `b`'s live (proximity-animated) doors over its cached static sprite. `depthZ` = the building's
 *  sprite depth; the door draws at depthZ − eps so it overlays the baked closed door on the same depth plane.
 *  No-op when the building isn't tiled, has no doors, or every door is closed (then the baked door already reads). */
export function drawAnimatedDoors(glc, b, camX, camY, tilePx, depthZ) {
  if (!glc || typeof glc.drawBuildingSprite !== 'function') return;
  let rects;
  try { rects = doorAnimRects(b, camX, camY, tilePx); } catch { return; }
  if (!rects || !rects.length) return;
  if (_canvasCache.size > _CAP) _canvasCache.clear();
  for (const a of rects) {
    const w = Math.max(1, Math.round(a.cr - a.cl)), h = Math.max(1, Math.round(a.wH));
    const key = b.x + ',' + b.y + ':' + a.idx;
    let e = _canvasCache.get(key);
    if (!e || e.fi !== a.fi || e.w !== w || e.h !== h) {
      const canvas = makeCanvas(w, h); if (!canvas) continue;
      const cx = canvas.getContext('2d'); if (!cx) continue;
      cx.imageSmoothingEnabled = false;
      cx.clearRect(0, 0, w, h);
      cx.drawImage(a.img, a.srcX, 0, a.srcW, a.srcH, 0, 0, w, h);  // the clip [cl..cr] sub-rect of the swing frame
      e = { fi: a.fi, w, h, canvas };                              // NEW object ⇒ drawBuildingSprite re-uploads the texture
      _canvasCache.set(key, e);
    }
    glc.drawBuildingSprite('door:' + key, e.canvas, Math.round(a.cl), Math.round(a.top), w, h, depthZ - _DOOR_EPS);
  }
}

/** Drop every cached door canvas (e.g. on a material/weather change, mirroring invalidateBuildingSprites). */
export function invalidateDoorOverlays() { _canvasCache.clear(); }
