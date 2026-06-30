// src/render/building-depth.js — GL-native player↔building occlusion (the DEPTH pass).
//
// Renders the near buildings' wall+roof silhouettes into a per-building DEPTH bitmap: each
// building's shape is filled with a grey value = its BASELINE depth (south edge → how close to
// camera). gl-compositor.writeBuildingDepth() then writes that grey into the scene FBO's depth
// buffer BEFORE the sprite batch. The player sprite (z from its own baseline, depth-test on) is
// then correctly hidden behind buildings — at ANY distance, no rise-band — while building COLOUR
// stays baked and correctly sorted (this pass never touches colour, so it can't pop a building in
// front of the building it's behind, the heuristic's bug). See
// docs/superpowers/specs/2026-06-19-building-player-depth-occlusion-spec.md.

import { MACRO } from '../../sim/world/genesis.js';
import { REGION } from '../../sim/lod/aggregate.js';
import { drawBuildingTextured } from './building-occluder.js';

// Shared depth mapping — the sprite vertex shader MIRRORS this in GLSL (keep in sync). Larger tile
// Y = more south = nearer camera = smaller depth. refY (camera-centre tile) + scale centre the
// usable range on what's near the player; far content clamps. scale 1/64 → ±64 tiles span [0,1],
// giving ~0.125-tile depth resolution at 8-bit grey (player vs building differ by several tiles).
export const DEPTH_SCALE = 1 / 64;
export function tileDepth(tileY, refY) {
  const d = 0.5 - (tileY - refY) * DEPTH_SCALE;
  return d < 0 ? 0 : (d > 1 ? 1 : d);
}

let _tmp = null, _tx = null;
/** Near buildings whose silhouette can cover the player (on-screen + a generous NORTH margin for
 *  tall roofs rising above the view). The caller writes each one's depth separately. */
export function nearDepthBuildings(buildings, camX, camY, tilePx, w, h) {
  if (!buildings || !buildings.length) return [];
  // PREFETCH RING: include buildings a few tiles BEYOND the viewport (in SCREEN px, so it's inherently
  // zoom-correct) so their sprite bakes while still OFF-SCREEN and is frozen-complete by the time they scroll
  // into view = no bake-in-view pop-in. Off-screen sprites draw as GPU-clipped quads (≈free). An earlier
  // 7-tile ring backfired ONLY because the roof bake was a 1+ second software rasterize; now the roof renders
  // on the GPU (building-occluder) and the re-bake throttle + manifest gate keep each bake cheap, so warming a
  // ring ahead of visibility is a net win. North keeps the larger 16-tile margin for tall roofs.
  const PF = 5 * tilePx;
  const near = [];
  for (const b of buildings) {
    const bb = b.footprint && b.footprint.boundingBox; if (!bb) continue;
    const sx = b.x * tilePx - camX, sy = b.y * tilePx - camY;
    if (sx + bb.w * tilePx < -PF || sy + bb.h * tilePx < -16 * tilePx || sx > w + PF || sy > h + PF) continue;
    near.push(b);
  }
  return near;
}

/** Render ONE building's wall+roof SILHOUETTE (textured; only its ALPHA is used) to a shared temp
 *  canvas, or null if wall sprites aren't loaded yet. The GL depth pass writes this silhouette into
 *  the depth buffer at the building's flat baseline depth (depth via geometry z, not gl_FragDepth —
 *  ANGLE ignores the latter). Reused per building per frame; upload immediately after. */
export function renderBuildingSilhouette(b, camX, camY, tilePx, w, h) {
  if (!_tmp || _tmp.width !== w || _tmp.height !== h) {
    _tmp = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(w, h)
         : (typeof document !== 'undefined') ? document.createElement('canvas') : null;
    if (!_tmp) return null;
    _tmp.width = w; _tmp.height = h; _tx = _tmp.getContext('2d');
  }
  const t = _tx;
  t.setTransform(1, 0, 0, 1, 0, 0); t.globalCompositeOperation = 'source-over'; t.clearRect(0, 0, w, h); t.imageSmoothingEnabled = false;
  if (!drawBuildingTextured(t, b, camX, camY, tilePx, w, h)) return null;
  return _tmp;
}
