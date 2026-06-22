// src/render/door-leaves.js — per-frame DOOR LEAF overlay (decoupled doors).
//
// The wall bake draws the doorway OPENING (an empty dark threshold). This pass draws each visible
// building's door LEAF over its opening with a procedural HINGE SWING — the leaf foreshortens
// about its left hinge as the player approaches (open amount = proximity). It renders into an
// offscreen bitmap that gl-compositor blits into the SCENE framebuffer (drawSceneOverlayBitmap),
// so it lights / day-nights / CRTs IDENTICALLY to the baked wall (everything-through-GL). No
// generated animation — the swing is a transform, so it can never hallucinate a figure.

import { WALL_CONFIG } from './wall-config.js';
import { wallAssetDir } from '../../sim/world/buildings/building-material-registry.js';
import { hasTileWall } from './building-tiles.js';

const DOOR_BASE = '/assets/pixelab/buildings/doors/';
// the 6 generated door shapes map onto the 3 shared, material-agnostic leaves
const LEAF_FOR = { plank: 'plank', iron_banded: 'plank', arched_double: 'arched', carved: 'ledged', rounded: 'arched', studded: 'ledged' };
const LEAF_HINGE_FRAC = 11 / 64;   // hinge x within the 64-wide normalized leaf canvas (DX0)
const OPEN_NEAR = 0.12, OPEN_FAR = 1.0, R_FULL = 0.6, R_OPEN = 2.6; // tiles: full-open ≤0.6, closed ≥2.6

// live-tunable from the console
export const DOOR_SWING = { enabled: true, rFull: R_FULL, rOpen: R_OPEN, openNear: OPEN_NEAR };
if (typeof window !== 'undefined') window._doorSwing = DOOR_SWING;

// Door-leaf FIT: the leaf is a ~1:3.5 plank in a 64x128 canvas. Drawing the whole canvas into the
// full 4-tile wall height made the door ~3 tiles tall + narrow ("taller without proportionally
// wider"). Instead draw it at a proper DOOR size — heightTiles tall, BOTTOM-aligned to the wall
// base, centred in the 2-tile door cell. Live-tunable so the proportion can be dialled by eye.
export const DOOR_FIT = { heightTiles: 3.4, widthScale: 1.15, yOff: 0.0 };
if (typeof window !== 'undefined') window._doorFit = DOOR_FIT;

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
    if (hasTileWall(b)) continue;               // tile-wall buildings draw their own door overlay
    if (!doorwayLoaded(b)) continue;            // only buildings whose opening was baked (pilot assets present)
    const leaf = leafImg(b.doorShape); if (!leaf) continue;
    const fp = b.footprint; if (!fp || !fp.doors) continue;
    for (const d of fp.doors) {
      const sx = Math.round((b.x + d.x) * tilePx - camX), sy = Math.round((b.y + d.y + 1) * tilePx - camY) - wH + Math.round(t * WY);
      if (sx + 2 * t < 0 || sx > w || sy + wH < 0 || sy > h) continue;
      const dxw = (b.x + d.x + 1) - player.x, dyw = (b.y + d.y) - player.y, dist = Math.hypot(dxw, dyw);
      const k = Math.max(0, Math.min(1, (dist - DOOR_SWING.rFull) / (DOOR_SWING.rOpen - DOOR_SWING.rFull)));
      const open = DOOR_SWING.openNear + k * (OPEN_FAR - DOOR_SWING.openNear);
      draws.push({ leaf, sx, sy, open, sortY: b.y + d.y });
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
  const DF = DOOR_FIT;
  for (const dr of draws) {
    const pw = 2 * t;
    const doorW = pw * DF.widthScale;
    const doorH = DF.heightTiles * t;
    const dx = dr.sx + (pw - doorW) / 2;            // centred in the door cell
    const dy = dr.sy + wH - doorH + DF.yOff * t;    // bottom-aligned to the wall base
    const hingeX = dx + LEAF_HINGE_FRAC * doorW;
    o.save(); o.translate(hingeX, dy); o.scale(dr.open, 1); o.translate(-hingeX, -dy);
    o.drawImage(dr.leaf, 0, 0, 64, 128, dx, dy, doorW, doorH);
    o.restore();
  }
  return _cv;
}
