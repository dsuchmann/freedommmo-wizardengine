// src/render/window-overlay.js — per-frame WINDOW-as-object overlay (decoupled windows).
//
// The occluder draws the south_base wall tile (keeps the base tone). This pass draws each visible
// building's openable window OBJECT over that tile with a procedural closed→shutters transform by
// player proximity. It renders into an offscreen bitmap that gl-compositor blits into the SCENE
// framebuffer (drawSceneOverlayBitmap) — so it lights / day-nights / CRTs IDENTICALLY to the baked
// wall (everything-through-GL). NEVER a 2D top-pass. No generated animation — the open is a
// transform (cross-fade closed↔shutters), so it can never hallucinate a figure (same rationale as
// door-leaves.js). The base tile is drawn unmodified by the occluder, so only the window pixels
// override → no tonal seam from a baked-in window tile. Honest absence: null until the overlay
// assets load (no fake window).

import { WALL_CONFIG } from './wall-config.js';
import { wallAssetDir, windowOverlayFile } from '../../sim/world/buildings/building-material-registry.js';

const OPEN_NEAR = 0.0, OPEN_FAR = 1.0, R_FULL = 1.0, R_CLOSED = 3.0; // tiles: open ≤1.0, closed ≥3.0

// live-tunable from the console
export const WINDOW_OPEN = { enabled: true, rFull: R_FULL, rClosed: R_CLOSED };
if (typeof window !== 'undefined') window._windowOpen = WINDOW_OPEN;

const _img = new Map();
function img(url) { let im = _img.get(url); if (!im) { im = new Image(); im.src = url; _img.set(url, im); } return (im.complete && im.naturalWidth) ? im : null; }
// Closed pane + shutters-open object for a building's material; null until ASSET/registry supply them.
function winImg(b, open) { return (b && b.biome && b.wallSlug) ? img(wallAssetDir(b.biome, b.wallSlug) + windowOverlayFile(b.windowShape, open)) : null; }

// Mirror the occluder's south-wall window selection (the iv%3 accumulation over the section's
// bottom row in drawWalls) so overlays land on the EXACT tiles the wall window-rule chose (no
// drift). Returns a Set of "lx,ly" footprint-local keys.
export function windowPlacements(b) {
  const out = new Set();
  const fp = b && b.footprint; if (!fp || !fp.sections) return out;
  const floorSet = new Set();
  for (const s of fp.sections) for (let dy = 0; dy < s.h; dy++) for (let dx = 0; dx < s.w; dx++) floorSet.add((s.x0 + dx) + ',' + (s.y0 + dy));
  const doorSet = new Set((fp.doors || []).map(d => d.x + ',' + d.y));
  for (const s of fp.sections) {
    const lr = s.y0 + s.h - 1; let iv = 0;
    for (let dx = 0; dx < s.w; dx++) {
      const lx = s.x0 + dx, ly = lr;
      if (floorSet.has(lx + ',' + (ly + 1))) continue;
      if (doorSet.has(lx + ',' + ly)) { iv = 0; continue; }
      if (dx < 2 || dx >= s.w - 2) { iv++; continue; }
      if (doorSet.has((lx - 1) + ',' + ly) || doorSet.has((lx + 1) + ',' + ly)) { iv++; continue; }
      iv++; if (iv % 3 === 0) out.add(lx + ',' + ly);
    }
  }
  return out;
}

// 0 (closed, far) .. 1 (shutters open, near), by proximity in tiles.
export function openAmount(dist) {
  const k = Math.max(0, Math.min(1, (dist - WINDOW_OPEN.rFull) / (WINDOW_OPEN.rClosed - WINDOW_OPEN.rFull)));
  return OPEN_FAR - k * (OPEN_FAR - OPEN_NEAR); // near -> 1, far -> 0
}

let _cv = null, _ox = null;

/** Per-frame window-overlay bitmap (or null). Caller blits via glc.drawSceneOverlayBitmap() AFTER
 *  the occluder and BEFORE the door-leaf blit (so doors stay on top of windows), before presentScene.
 *  Honest absence: null until the window-overlay assets load. */
export function buildWindowOverlayBitmap(buildings, camX, camY, tilePx, w, h, player) {
  if (!WINDOW_OPEN.enabled || !buildings || !buildings.length || !player) return null;
  const t = Math.round(tilePx), wH = Math.round(tilePx * WALL_CONFIG.wallHeight), WY = WALL_CONFIG.wallYOffset;
  const draws = [];
  for (const b of buildings) {
    const closed = winImg(b, false); if (!closed) continue; // assets not present -> skip (honest absence)
    const open = winImg(b, true);
    const places = windowPlacements(b);
    if (!places.size) continue;
    const fp = b.footprint;
    for (const s of fp.sections) {
      const lr = s.y0 + s.h - 1;
      for (let dx = 0; dx < s.w; dx++) {
        const lx = s.x0 + dx, ly = lr; const key = lx + ',' + ly;
        if (!places.has(key)) continue;
        // Window is a 2-tile-wide feature (matches the occluder's facadeWide); anchor at the
        // bottom of the wall (south baseline), full wall height — same geometry the base tile uses.
        const sx = Math.round((b.x + lx) * tilePx - camX);
        const sy = Math.round((b.y + ly + 1) * tilePx - camY) - wH + Math.round(t * WY);
        if (sx + 2 * t < 0 || sx > w || sy + wH < 0 || sy > h) continue;
        const dist = Math.hypot((b.x + lx + 1) - player.x, (b.y + ly) - player.y);
        draws.push({ closed, open, sx, sy, amt: openAmount(dist), sortY: b.y + ly });
      }
    }
  }
  if (!draws.length) return null;
  if (!_cv || _cv.width !== w || _cv.height !== h) {
    _cv = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(w, h)
        : (typeof document !== 'undefined') ? document.createElement('canvas') : null;
    if (!_cv) return null;
    _cv.width = w; _cv.height = h; _ox = _cv.getContext('2d');
  }
  const o = _ox; o.setTransform(1, 0, 0, 1, 0, 0); o.clearRect(0, 0, w, h); o.imageSmoothingEnabled = false;
  draws.sort((a, b) => a.sortY - b.sortY);
  for (const dr of draws) {
    const pw = 2 * t;
    // The 64x96 window object occupies the upper part of the wall plane (sill above the foundation).
    // Anchor its top to the wall top and let it run the source's 96px height at the wall scale, so
    // it reads as a window punched into the masonry, not a full-height panel.
    const oh = Math.round(wH * (96 / 128));
    // Closed pane first; cross-fade to the shutters-open object by proximity (amt). When no distinct
    // open sprite exists (e.g. stone/balcony lack one state) the closed pane just stays.
    if (dr.amt < 0.999 || !dr.open) o.drawImage(dr.closed, 0, 0, 64, 96, dr.sx, dr.sy, pw, oh);
    if (dr.open && dr.amt > 0.001) {
      o.save(); o.globalAlpha = Math.max(0, Math.min(1, dr.amt));
      o.drawImage(dr.open, 0, 0, 64, 96, dr.sx, dr.sy, pw, oh);
      o.restore();
    }
  }
  return _cv;
}
