// src/render/interior-gl.js — renders the active building's interior BACK layer
// (dim + floor + stair/lift markers + back/side walls) to an offscreen bitmap that
// canvas-renderer blits into the GL scene via glc.drawSceneOverlayBitmap() BEFORE
// presentScene. That makes the interior inherit the SAME GL lighting / day-night / CRT
// as terrain (CLAUDE.md: "everything in the world renders through the GL pipeline"),
// replacing the old 2D interior top-pass for the back layer.
//
// E/W side walls use the approved thin, material-agnostic PILASTER (flat top to the
// back-wall molding, floor preserved) — see docs/superpowers/2026-06-19-interior-sidewall-gl-spec.md
// and the calibrator tools/interior-wall-gallery.html.
//
// NOTE (current slice): the PLAYER and the SOUTH (front) wall still draw on the 2D ctx on
// top (existing behaviour). Migrating those into GL too is the follow-up — until then the
// player's lighting may not perfectly match the now-GL-lit floor at night.
import { getActiveInterior, isInside } from './active-interior.js';
import { ensureFloorImages, getFloorImg, getWallImg } from './building-renderer.js';
import { WALL_CONFIG } from './wall-config.js';
import { interiorLiftPx } from './interior-renderer.js';

// Thin interior side-wall thickness (fraction of a tile). Live-tunable via
// window._interiorWallThickness — meant to be re-dialed once more wall materials exist
// (the pilaster is procedural, so every material inherits it). Calibrated against the
// stone placeholder in tools/interior-wall-gallery.html (2026-06-19).
const INTERIOR_WALL_THICKNESS = 0.15;

let _cv = null, _cx = null;
function surface(w, h) {
  if (!_cv || _cv.width !== w || _cv.height !== h) {
    _cv = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(w, h)
        : (typeof document !== 'undefined') ? document.createElement('canvas') : null;
    if (_cv) { _cv.width = w; _cv.height = h; _cx = _cv.getContext('2d'); }
  }
  return _cv ? { cv: _cv, cx: _cx } : null;
}

// Material-agnostic interior side-wall pilaster — body band (0,50,32,32) + top-molding
// slice + bevel. Built only from the sprite's own regions (no per-material corner art).
// innerDir = +1 when the room is to the post's right (west post), -1 for the east post.
function pilaster(cx, base, cxCenter, topY, botY, tw, innerDir, t, wH, wp) {
  if (!base || botY <= topY) return;
  const x = Math.round(cxCenter - tw / 2);
  const capH = Math.round(t * 0.5);
  const sw = Math.max(4, Math.round(32 * tw / t));   // source slice → natural brick scale (no squish)
  for (let y = topY + capH; y < botY; y += t) {
    const hh = Math.min(t, botY - y);
    cx.drawImage(base, 0, 50, sw, Math.round(32 * (hh / t)), x, y, tw + wp, hh + wp);
  }
  cx.drawImage(base, 0, 8, sw, Math.round(112 * (capH / wH)), x, topY, tw + wp, capH + wp);
  const e = Math.max(1, Math.round(tw * 0.16));
  cx.save();
  cx.globalAlpha = 0.24; cx.fillStyle = '#000';
  cx.fillRect(innerDir > 0 ? x + tw - e : x, topY, e, botY - topY);
  cx.globalAlpha = 0.13; cx.fillStyle = '#fff';
  cx.fillRect(innerDir > 0 ? x : x + tw - e, topY, e, botY - topY);
  cx.restore();
}

function marker(cx, ai, tile, color, sym, sxAt, syAt, t) {
  if (!tile) return;
  const sx = sxAt(ai.bx + tile.x), sy = syAt(ai.by + tile.y);
  cx.fillStyle = color; cx.fillRect(sx + 2, sy + 2, t - 4, t - 4);
  if (sym) {
    cx.fillStyle = 'rgba(20,24,16,0.9)';
    cx.font = 'bold ' + Math.round(t * 0.6) + 'px system-ui';
    cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.fillText(sym, sx + t / 2, sy + t / 2 + 1);
    cx.textAlign = 'left'; cx.textBaseline = 'alphabetic';
  }
}

// Build the interior back-layer bitmap at art (= CSS-px) resolution. Returns the offscreen
// canvas, or null if not inside / no 2D surface available. Screen coords match the 2D path:
// the per-floor lift cancels out of syAt so the floor stays locked under the centred player.
export function buildInteriorSceneBitmap(camX, camY, tilePx, w, h) {
  if (!isInside()) return null;
  ensureFloorImages();
  const s = surface(w, h);
  if (!s) return null;
  const cx = s.cx;
  cx.setTransform(1, 0, 0, 1, 0, 0);
  cx.clearRect(0, 0, w, h);
  cx.imageSmoothingEnabled = false;

  const ai = getActiveInterior();
  if (!ai) return null;
  const lift = interiorLiftPx();
  const t = Math.round(tilePx), wp = 1;
  const WH = WALL_CONFIG.wallHeight, NY = WALL_CONFIG.northYOffset;
  const wH = Math.round(t * WH);
  const sxAt = (wx) => Math.round(wx * tilePx - camX);
  const syAt = (wy) => Math.round(wy * tilePx - camY - lift);

  // dim the outer (GL) world HARD — the dimmed EXTERIOR building (baked into the chunk:
  // multi-story walls + roof) must recede to a faint backdrop so "only the current floor
  // renders, the roof fades" (interior-visual-vision). This is pre-present, so the present
  // pass still lights it like terrain; a weak dim gets re-brightened by daytime and the
  // exterior bleeds through (the bug). Tunable via window._interiorDim.
  const baseDim = window._interiorDim ?? 0.92;
  const dim = ai.floorIndex < 0 ? 0.985                                   // basement: outside is black
    : Math.min(0.975, baseDim + ai.floorIndex * 0.015);                   // each floor up recedes a touch more
  cx.fillStyle = `rgba(6,8,14,${dim.toFixed(3)})`;
  cx.fillRect(0, 0, w, h);

  // floor over the full footprint
  const floorImg = getFloorImg(ai.layout.material) || getFloorImg('wood_plank');
  if (floorImg) {
    for (const k of ai.footprint) {
      const [lx, ly] = k.split(',').map(Number);
      const fx = sxAt(ai.bx + lx), fy = syAt(ai.by + ly);
      if (fx + t < 0 || fy + t < 0 || fx > w || fy > h) continue;
      cx.drawImage(floorImg, fx, fy, t + wp, t + wp);
    }
  }

  // stair / lift markers (gameplay way-finding)
  const L = ai.layout;
  if (L.landingTile) marker(cx, ai, L.landingTile, 'rgba(207,214,223,0.45)', null, sxAt, syAt, t);
  if (L.upTile) marker(cx, ai, L.upTile, '#5ec98a', '▲', sxAt, syAt, t);
  if (L.downTile) marker(cx, ai, L.downTile, '#e0913f', '▼', sxAt, syAt, t);
  if (L.liftTile) marker(cx, ai, L.liftTile, '#4aa6c8', '⇕', sxAt, syAt, t);
  if (!L.upTile && !L.downTile && !L.liftTile && L.stairTile) marker(cx, ai, L.stairTile, '#caa23a', null, sxAt, syAt, t);

  const base = getWallImg('south_base');
  if (!base) return s.cv;   // floor only until the wall sprite loads
  // Walls follow the ACTUAL per-tile footprint edge (ai.footprint), exactly like the exterior
  // chunk bake — so they hug ANY shape (round/L/concave), not bounding-section rectangles.
  const fset = ai.footprint;
  const has = (x, y) => fset.has(x + ',' + y);
  const bb = ai.building.footprint.boundingBox;

  // NORTH (back) wall — a full-width rising-brick billboard at every NORTH-facing edge tile
  // (north neighbour outside the footprint). On a round footprint this traces the curved
  // back (top cap + shoulders) instead of overshooting a section rectangle.
  for (const k of fset) {
    const c = k.indexOf(',');
    const lx = +k.slice(0, c), ly = +k.slice(c + 1);
    if (has(lx, ly - 1)) continue;                         // north neighbour inside → not a back edge
    const sx = sxAt(ai.bx + lx), sy = syAt(ai.by + ly) - wH + Math.round(t * NY);
    if (sx + t < 0 || sx > w || sy + wH < 0 || sy > h) continue;
    cx.drawImage(base, 0, 8, 32, 112, sx, sy, t + wp, wH + wp);
  }

  // EAST/WEST — thin floor-preserving pilasters on the footprint's side edges, per contiguous
  // vertical run in a column. A full billboard here would rise into the interior floor to its
  // north and eat floorspace; a thin post on the boundary line does not. Runs are found from
  // the real per-tile edge so a round footprint's stepped sides get a stepped set of posts
  // that track the curve (straight rooms collapse to one flat-top post per side = approved look).
  const tw = Math.max(3, Math.round(t * (window._interiorWallThickness ?? INTERIOR_WALL_THICKNESS)));
  for (const side of [-1, +1]) {                           // -1 = west edge, +1 = east edge
    for (let lx = 0; lx < bb.w; lx++) {
      const boundaryX = side < 0 ? lx : lx + 1;            // post sits on the outer tile boundary
      const cxC = sxAt(ai.bx + boundaryX);
      let runStart = null;
      for (let ly = 0; ly <= bb.h; ly++) {
        const isEdge = ly < bb.h && has(lx, ly) && !has(lx + side, ly);
        if (isEdge && runStart === null) runStart = ly;
        if (!isEdge && runStart !== null) {
          const topY = syAt(ai.by + runStart) - wH + Math.round(t * NY);
          const botY = syAt(ai.by + ly);                   // ly is one past the run's last tile
          if (cxC + tw > 0 && cxC - tw < w) pilaster(cx, base, cxC, topY, botY, tw, -side, t, wH, wp);
          runStart = null;
        }
      }
    }
  }

  return s.cv;
}
