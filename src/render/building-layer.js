// src/render/building-layer.js — the outdoor building GL layer (two Y-split bitmaps).
//
// Buildings are NO LONGER baked into the terrain chunk bitmap (worker-chunk-renderer.js drops the
// wall post-pass + roof bake), so real terrain exists under every building. This module re-renders
// the visible buildings at the live camera into TWO bitmaps split by the player's tile Y:
//   • behind — buildings whose south baseline is NORTH of the player (drawn UNDER the player)
//   • front  — buildings whose south baseline is at/SOUTH of the player (drawn OVER the player,
//              with the GPU spotlight so you see through to yourself on the terrain).
// canvas-renderer blits `behind` before the sprite batch and `front` (spotlight) after it. This
// resolves player-vs-building by the same Y-split the sprite sort uses; building-vs-building is the
// south-edge painter sort within each set. See
// docs/superpowers/specs/2026-06-20-outdoor-building-spotlight-seethrough-design.md and the plan.

import { drawBuildingTextured } from './building-occluder.js';
import { nearDepthBuildings } from './building-depth.js';

// South baseline = the building's front (south) edge in tile space.
function baseline(b) { return b.y + b.footprint.boundingBox.h; }

/** Partition buildings into those BEHIND the player (drawn under) and those IN FRONT (drawn over,
 *  spotlit). Split key = south baseline vs the player's tile Y; baseline >= playerY ⇒ in front
 *  (nearer the camera, can occlude). Each set is south-sorted (farther first) so the nearer
 *  building paints over the farther one. Pure; skips buildings missing a bounding box. */
export function splitBuildingsByPlayer(buildings, playerY) {
  const behind = [], front = [];
  for (const b of buildings) {
    const bb = b.footprint && b.footprint.boundingBox;
    if (!bb) continue;
    (b.y + bb.h >= playerY ? front : behind).push(b);
  }
  const bySouth = (a, c) => baseline(a) - baseline(c);
  behind.sort(bySouth);
  front.sort(bySouth);
  return { behind, front };
}

// Shared per-frame offscreen canvases (one per set), reallocated on viewport resize.
let _behindCv = null, _behindCtx = null, _frontCv = null, _frontCtx = null;

function _ensure(w, h) {
  if (!_behindCv || _behindCv.width !== w || _behindCv.height !== h) {
    const make = () => (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(w, h)
      : (typeof document !== 'undefined') ? document.createElement('canvas') : null;
    _behindCv = make(); _frontCv = make();
    if (!_behindCv || !_frontCv) return false;
    _behindCv.width = w; _behindCv.height = h; _behindCtx = _behindCv.getContext('2d');
    _frontCv.width = w; _frontCv.height = h; _frontCtx = _frontCv.getContext('2d');
  }
  return true;
}

function _renderSet(ctx, list, camX, camY, tilePx, w, h) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = false;
  let drew = false;
  for (const b of list) {
    // drawBuildingTextured returns false until wall sprites load; south-sorted by the caller.
    if (drawBuildingTextured(ctx, b, camX, camY, tilePx, w, h)) drew = true;
  }
  return drew;
}

/** Render the behind+front building bitmaps for this frame. Returns { behind, front } where each
 *  is a canvas or null (null = empty set OR wall sprites not loaded yet). Returns null if there are
 *  no on-screen buildings at all. Culls to the on-screen set (+ north margin for tall roofs) via
 *  nearDepthBuildings, then splits by the player's tile Y. */
export function buildBuildingLayerBitmaps(buildings, camX, camY, tilePx, w, h, playerY) {
  if (!buildings || !buildings.length) return null;
  const near = nearDepthBuildings(buildings, camX, camY, tilePx, w, h);
  if (!near.length) return null;
  if (!_ensure(w, h)) return null;
  const { behind, front } = splitBuildingsByPlayer(near, playerY);
  const behindDrew = behind.length ? _renderSet(_behindCtx, behind, camX, camY, tilePx, w, h) : false;
  const frontDrew = front.length ? _renderSet(_frontCtx, front, camX, camY, tilePx, w, h) : false;
  return { behind: behindDrew ? _behindCv : null, front: frontDrew ? _frontCv : null };
}
