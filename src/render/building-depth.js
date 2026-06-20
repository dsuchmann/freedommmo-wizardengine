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

let _cv = null, _ox = null, _tmp = null, _tx = null;

/** Build the per-building depth bitmap (grey = baseline depth, alpha = building mask), or null
 *  when nothing's near or wall sprites aren't loaded yet. refY = depth-reference tile Y (the tile
 *  at screen centre) — MUST match the value handed to the sprite shader. */
export function buildBuildingDepthBitmap(buildings, camX, camY, tilePx, w, h, refY) {
  if (!buildings || !buildings.length) return null;
  // Cull to on-screen (+ a generous NORTH margin so tall roofs rising above the view still write
  // depth where they cover the player).
  const near = [];
  for (const b of buildings) {
    const bb = b.footprint && b.footprint.boundingBox; if (!bb) continue;
    const sx = b.x * tilePx - camX, sy = b.y * tilePx - camY;
    if (sx + bb.w * tilePx < -tilePx || sy + bb.h * tilePx < -16 * tilePx || sx > w + tilePx || sy > h + tilePx) continue;
    near.push(b);
  }
  if (!near.length) return null;

  if (!_cv || _cv.width !== w || _cv.height !== h) {
    const mk = () => (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(w, h)
                   : (typeof document !== 'undefined') ? document.createElement('canvas') : null;
    _cv = mk(); _tmp = mk(); if (!_cv || !_tmp) return null;
    _cv.width = _tmp.width = w; _cv.height = _tmp.height = h;
    _ox = _cv.getContext('2d'); _tx = _tmp.getContext('2d');
  }
  const o = _ox, t = _tx;
  o.setTransform(1, 0, 0, 1, 0, 0); o.globalCompositeOperation = 'source-over'; o.clearRect(0, 0, w, h); o.imageSmoothingEnabled = false;

  // Far-to-near (north-to-south) so the NEAREST building's depth wins where silhouettes overlap.
  near.sort((a, b) => (a.y + a.footprint.boundingBox.h) - (b.y + b.footprint.boundingBox.h));
  let drew = false;
  for (const b of near) {
    t.setTransform(1, 0, 0, 1, 0, 0); t.globalCompositeOperation = 'source-over'; t.clearRect(0, 0, w, h); t.imageSmoothingEnabled = false;
    if (!drawBuildingTextured(t, b, camX, camY, tilePx, w, h)) return null; // wall sprites not loaded yet
    // Recolour the silhouette to this building's depth grey (source-in keeps its alpha shape).
    const g = Math.round(tileDepth(b.y + b.footprint.boundingBox.h, refY) * 255);
    t.globalCompositeOperation = 'source-in';
    t.fillStyle = 'rgb(' + g + ',' + g + ',' + g + ')';
    t.fillRect(0, 0, w, h);
    t.globalCompositeOperation = 'source-over';
    o.drawImage(_tmp, 0, 0); // nearest wins via the far-to-near draw order
    drew = true;
  }
  return drew ? _cv : null;
}
