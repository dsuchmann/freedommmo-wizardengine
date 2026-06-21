// src/render/door-leaves.js — per-frame DOOR LEAF overlay (decoupled doors).
//
// The wall bake draws the doorway OPENING (an empty dark threshold). This pass draws each visible
// building's door LEAF over its opening with a procedural HINGE SWING — the leaf foreshortens
// about its left hinge as the player approaches (open amount = proximity). It renders into an
// offscreen bitmap that gl-compositor blits into the SCENE framebuffer (drawSceneOverlayBitmap),
// so it lights / day-nights / CRTs IDENTICALLY to the baked wall (everything-through-GL). No
// generated animation — the swing is a transform, so it can never hallucinate a figure.

import { WALL_CONFIG } from './wall-config.js';
import { wallAssetDir, doorwayHole } from '../../sim/world/buildings/building-material-registry.js';

// Fallback doorway sub-rect (fractions of the 2t×4t south_doorway piece) when no per-material hole
// is available — a centred opening that keeps the swung leaf off the masonry jambs.
export const DEFAULT_HOLE = { x0: 0.1875, y0: 0.3594, w: 0.6875, h: 0.6406 };

// Map a fractional doorway-hole rect to the screen sub-rect of the 2t-wide × wH piece anchored at
// (sx,sy). The leaf is drawn + swung INSIDE this rect instead of the full piece, so the swung leaf
// stays within the masonry opening.
export function doorwayHoleScreenRect(hole, sx, sy, pw, wH) {
  const r = hole || DEFAULT_HOLE;
  return { dx: sx + r.x0 * pw, dy: sy + r.y0 * wH, dw: r.w * pw, dh: r.h * wH };
}

const DOOR_BASE = '/assets/pixelab/buildings/doors/';
// the 6 generated door shapes map onto the 3 shared, material-agnostic leaves
const LEAF_FOR = { plank: 'plank', iron_banded: 'plank', arched_double: 'arched', carved: 'ledged', rounded: 'arched', studded: 'ledged' };
const LEAF_HINGE_FRAC = 11 / 64;   // hinge x within the 64-wide normalized leaf canvas (DX0)
const OPEN_NEAR = 0.12, OPEN_FAR = 1.0, R_FULL = 0.6, R_OPEN = 2.6; // tiles: full-open ≤0.6, closed ≥2.6

// live-tunable from the console
export const DOOR_SWING = { enabled: true, rFull: R_FULL, rOpen: R_OPEN, openNear: OPEN_NEAR };
if (typeof window !== 'undefined') window._doorSwing = DOOR_SWING;

const _img = new Map();
function img(url) { let im = _img.get(url); if (!im) { im = new Image(); im.src = url; _img.set(url, im); } return (im.complete && im.naturalWidth) ? im : null; }
function leafImg(shape) { return img(DOOR_BASE + (LEAF_FOR[shape] || 'plank') + '__norm.png'); }
function doorwayLoaded(b) { return (b && b.biome && b.wallSlug) ? img(wallAssetDir(b.biome, b.wallSlug) + 'south_doorway__normal.png') : null; }

let _cv = null, _ox = null;

/** Per-frame door-leaf overlay (or null when nothing to draw). Caller blits via
 *  glc.drawSceneOverlayBitmap() after the occluder, before presentScene. */
export function buildDoorLeafBitmap(buildings, camX, camY, tilePx, w, h, player) {
  if (!DOOR_SWING.enabled || !buildings || !buildings.length || !player) return null;
  const t = Math.round(tilePx), wH = Math.round(tilePx * WALL_CONFIG.wallHeight), WY = WALL_CONFIG.wallYOffset;
  const draws = [];
  for (const b of buildings) {
    if (!doorwayLoaded(b)) continue;            // only buildings whose opening was baked (pilot assets present)
    const leaf = leafImg(b.doorShape); if (!leaf) continue;
    const fp = b.footprint; if (!fp || !fp.doors) continue;
    for (const d of fp.doors) {
      const sx = Math.round((b.x + d.x) * tilePx - camX), sy = Math.round((b.y + d.y + 1) * tilePx - camY) - wH + Math.round(t * WY);
      if (sx + 2 * t < 0 || sx > w || sy + wH < 0 || sy > h) continue;
      const dxw = (b.x + d.x + 1) - player.x, dyw = (b.y + d.y) - player.y, dist = Math.hypot(dxw, dyw);
      const k = Math.max(0, Math.min(1, (dist - DOOR_SWING.rFull) / (DOOR_SWING.rOpen - DOOR_SWING.rFull)));
      const open = DOOR_SWING.openNear + k * (OPEN_FAR - DOOR_SWING.openNear);
      // Per-material doorway cut-out hole (door void differs per material). fieldstone is escalate
      // (clipped opening) but doorwayHole still returns a usable rect → graceful degrade.
      const hole = doorwayHole(b.wallSlug, b.doorShape) || DEFAULT_HOLE;
      draws.push({ leaf, sx, sy, open, hole, sortY: b.y + d.y });
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
    // Fit + swing the leaf INSIDE the doorway-hole sub-rect (not the full 2t×4t piece) so the swung
    // leaf stays within the masonry opening. Hinge on the hole's left jamb.
    const r = doorwayHoleScreenRect(dr.hole, dr.sx, dr.sy, pw, wH);
    const hingeX = r.dx + LEAF_HINGE_FRAC * r.dw;
    o.save(); o.translate(hingeX, r.dy); o.scale(dr.open, 1); o.translate(-hingeX, -r.dy);
    o.drawImage(dr.leaf, 0, 0, 64, 128, r.dx, r.dy, r.dw, r.dh);
    o.restore();
  }
  return _cv;
}
