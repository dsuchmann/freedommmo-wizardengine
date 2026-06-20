// src/render/building-occluder.js — GL-native player occlusion.
//
// THE PROBLEM: buildings (walls + roofs) are BAKED into the chunk bitmaps, which are the GROUND
// layer — always below the player sprite. So when the player stands BEHIND a building (north of
// it, where its walls/roof rise/project over the player on screen), the player wrongly draws ON
// TOP of it. There is no per-object depth sort between the player and a baked building.
//
// THE FIX (CLAUDE.md: everything in the world renders through the GL pipeline): build an OFFSCREEN
// bitmap of the buildings that are IN FRONT of the player (their south baseline is south of the
// player), re-drawn with the EXACT worker geometry (same wall sprites/crop/offsets) + the shared
// roof engine (same biome texture), then punch a soft see-through hole around the player. Hand it
// to gl-compositor.drawSceneOverlayBitmap(), which blits it into the SCENE framebuffer AFTER the
// sprite batch but BEFORE present — so the present pass lights / day-nights / CRTs it IDENTICALLY
// to the baked building (no 2D-overlay mismatch), the player sorts under it (occluded), and the
// hole keeps the player visible "through" it. Returns null when nothing occludes.

import { WALL_CONFIG } from './wall-config.js';
import { getWallImg } from './building-renderer.js';
import { buildingFloors } from './building-shadow.js';
import { queryBuildingTile } from './building-tile-query.js';

// Tiles the wall+roof silhouette projects NORTH of the footprint (mirrors building-shadow.js
// NORTH_SILHOUETTE_BASE / resolved-buildings NORTH_CLAIM: 8 for a 1-storey wall+roof, +4/storey).
const NORTH_BAND_BASE = 8;
const STORY = WALL_CONFIG.wallHeight; // 4

// Cutaway shape — radial by default (consistent with the interior). Live-tunable from the
// console: window._occluderSpot.mode = 'band' | 'circle', radii, or .enabled = false.
export const SPOT = { mode: 'circle', radiusTiles: 2.6, bandHalfTiles: 1.7, enabled: true, clipBelowFeetTiles: 0.4 };
if (typeof window !== 'undefined') window._occluderSpot = SPOT;

// Roof engine (the SAME module the worker bakes with) — lazy + guarded so a roof failure never
// breaks the frame (mirrors roof-overlay.js).
let _roof = null, _roofLoading = false, _roofFailed = false;
function ensureRoof() {
  if (_roof || _roofLoading || _roofFailed) return;
  _roofLoading = true;
  import('../../tools/roof/roof-ingame.js').then(m => { _roof = m; }).catch(() => { _roofFailed = true; }).finally(() => { _roofLoading = false; });
}

// Lazy biome roof-texture cache so the re-drawn roof gets the SAME ground-skin the worker bakes
// (else it'd read as a flat procedural fill vs the textured baked roof). Same lazy-Image pattern
// as building-renderer.js; null until the tile loads (roof draws procedurally one frame, then
// textured).
const _tex = new Map();
const _imageCache = {
  get(url) {
    let im = _tex.get(url);
    if (!im) { im = new Image(); im.src = url; _tex.set(url, im); }
    return (im.complete && im.naturalWidth) ? im : null;
  },
};

// Empty-tile gap to the building NORTH of us — mirrors the worker's roof clamp so the re-drawn
// roof rises to the SAME height as the baked one and aligns exactly.
function northGapTiles(b) {
  const bb = b.footprint.boundingBox;
  for (let gg = 1; gg <= 5; gg++)
    for (let dx = 0; dx < bb.w; dx++)
      if (queryBuildingTile(b.x + dx, b.y - gg)) return gg - 1;
  return 5;
}

function wallImgs() {
  return {
    south_base: getWallImg('south_base'), south_window: getWallImg('south_window'),
    south_door: getWallImg('south_door'), south_corner_west: getWallImg('south_corner_west'),
    south_corner_east: getWallImg('south_corner_east'), edge_ew: getWallImg('edge_ew'),
  };
}

// Does building b occlude a player standing at world tile (px,py)? True when the player is within
// the building's x-span and inside its north rise-band (north of the footprint, under the
// wall+roof projection) — i.e. the building is in FRONT of the player and rises over them.
function occludes(b, px, py) {
  const bb = b.footprint && b.footprint.boundingBox;
  if (!bb) return false;
  if (px < b.x - 0.5 || px > b.x + bb.w + 0.5) return false; // outside the building's columns
  if (py >= b.y + bb.h) return false;                        // player south of it → not behind
  const rise = NORTH_BAND_BASE + (buildingFloors(b) - 1) * STORY;
  if (py < b.y - rise) return false;                         // player north of the whole rise → clear
  return true;
}

// Re-draw ONE building's walls EXACTLY as the worker bakes them (worker-chunk-renderer.js wall
// post-pass): same `0,8,…,112` crop, same WALL_CONFIG offsets, STACKED `stories` tall, door on
// the ground storey only. World→screen via camX/camY (CSS px, same space as drawChunk).
function drawWalls(ctx, b, wi, camX, camY, tilePx, w, h) {
  if (!wi.south_base) return;
  const t = Math.round(tilePx), wp = 1;
  const wH = Math.round(tilePx * WALL_CONFIG.wallHeight);
  const WY = WALL_CONFIG.wallYOffset, NY = WALL_CONFIG.northYOffset;
  const EWH = WALL_CONFIG.ewTileHeight, EWX = WALL_CONFIG.ewXOffset;
  const stories = buildingFloors(b);
  const fp = b.footprint, sections = fp.sections || [];
  const tsx = (wx) => Math.round(wx * tilePx - camX);
  const tsy = (wy) => Math.round(wy * tilePx - camY);
  const floorSet = new Set();
  for (const s of sections) for (let dy = 0; dy < s.h; dy++) for (let dx = 0; dx < s.w; dx++) floorSet.add((s.x0 + dx) + ',' + (s.y0 + dy));
  const doorSet = new Set((fp.doors || []).map(d => d.x + ',' + d.y));

  // NORTH walls — stacked
  for (const s of sections) {
    const nr = s.y0;
    for (let dx = 0; dx < s.w; dx++) {
      const lx = s.x0 + dx;
      if (floorSet.has(lx + ',' + (nr - 1))) continue;
      const sx = tsx(b.x + lx);
      const wo = !floorSet.has((lx - 1) + ',' + nr), eo = !floorSet.has((lx + 1) + ',' + nr);
      for (let st = 0; st < stories; st++) {
        const sy = tsy(b.y + nr) - wH + Math.round(t * NY) - st * wH;
        if (sx + t < 0 || sx > w || sy + wH < 0 || sy > h) continue;
        ctx.drawImage(wi.south_base, 0, 8, 32, 112, sx, sy, t + wp, wH + wp);
        if (wo && wi.south_corner_west) ctx.drawImage(wi.south_corner_west, 0, 8, 32, 112, sx - t, sy, t + wp, wH + wp);
        else if (eo && wi.south_corner_east) ctx.drawImage(wi.south_corner_east, 0, 8, 32, 112, sx + t, sy, t + wp, wH + wp);
      }
    }
  }

  // EAST/WEST edge trims (worker uses the rotated edge_ew strip)
  if (wi.edge_ew) {
    const ewH = Math.round(t * EWH), ewX = Math.round(t * EWX);
    const iw = wi.edge_ew.naturalWidth || wi.edge_ew.width || 32, ih = wi.edge_ew.naturalHeight || wi.edge_ew.height || 32;
    for (const s of sections) {
      for (let dy = 0; dy < s.h; dy++) {
        const ely = s.y0 + dy;
        const elx = s.x0 + s.w;
        if (!floorSet.has(elx + ',' + ely)) {
          const ex = tsx(b.x + elx) + ewX, ey = tsy(b.y + ely);
          if (ex + t > 0 && ex < w && ey + ewH > 0 && ey < h) {
            ctx.save(); ctx.translate(ex + t / 2, ey + ewH / 2); ctx.rotate(Math.PI / 2);
            ctx.drawImage(wi.edge_ew, 0, 0, iw, ih, -t / 2, -ewH / 2, t + wp, ewH + wp); ctx.restore();
          }
        }
        const wlx = s.x0 - 1;
        if (!floorSet.has(wlx + ',' + ely)) {
          const wx = tsx(b.x + wlx) - ewX, wy = tsy(b.y + ely);
          if (wx + t > 0 && wx < w && wy + ewH > 0 && wy < h) {
            ctx.save(); ctx.translate(wx + t / 2, wy + ewH / 2); ctx.rotate(Math.PI / 2); ctx.scale(-1, 1);
            ctx.drawImage(wi.edge_ew, 0, 0, iw, ih, -t / 2, -ewH / 2, t + wp, ewH + wp); ctx.restore();
          }
        }
      }
    }
  }

  // SOUTH walls — stacked; door on the ground storey only, windows + corners match the bake
  for (const s of sections) {
    const lr = s.y0 + s.h - 1, fbY = b.y + s.y0 + s.h;
    const win = new Set(); let iv = 0;
    for (let dx = 0; dx < s.w; dx++) {
      const lx = s.x0 + dx, ly = lr;
      if (floorSet.has(lx + ',' + (ly + 1))) continue;
      if (doorSet.has(lx + ',' + ly)) { iv = 0; continue; }
      if (dx < 2 || dx >= s.w - 2) { iv++; continue; }
      if (doorSet.has((lx - 1) + ',' + ly) || doorSet.has((lx + 1) + ',' + ly)) { iv++; continue; }
      iv++; if (iv % 3 === 0) win.add(lx + ',' + ly);
    }
    for (let st = 0; st < stories; st++) {
      const ground = (st === 0);
      const skip = new Set();
      for (let dx = 0; dx < s.w; dx++) {
        if (skip.has(dx)) continue;
        const lx = s.x0 + dx, ly = lr;
        if (floorSet.has(lx + ',' + (ly + 1))) continue;
        const sx = tsx(b.x + lx), sy = tsy(fbY) - wH + Math.round(t * WY) - st * wH;
        if (sx + t < 0 || sx > w || sy + wH < 0 || sy > h) continue;
        const k = lx + ',' + ly, wo = !floorSet.has((lx - 1) + ',' + ly), eo = !floorSet.has((lx + 1) + ',' + ly);
        if (wo && wi.south_corner_west) { ctx.drawImage(wi.south_base, 0, 8, 32, 112, sx, sy, t + wp, wH + wp); ctx.drawImage(wi.south_corner_west, 0, 8, 32, 112, sx - t, sy, t + wp, wH + wp); }
        else if (eo && wi.south_corner_east) { ctx.drawImage(wi.south_base, 0, 8, 32, 112, sx, sy, t + wp, wH + wp); ctx.drawImage(wi.south_corner_east, 0, 8, 32, 112, sx + t, sy, t + wp, wH + wp); }
        else if (ground && doorSet.has(k) && dx >= 2 && dx < s.w - 2 && wi.south_door) { ctx.drawImage(wi.south_door, 0, 8, 64, 112, sx, sy, t * 2 + wp, wH + wp); skip.add(dx + 1); }
        else if (win.has(k) && dx >= 2 && dx < s.w - 2 && wi.south_window) { ctx.drawImage(wi.south_window, 0, 8, 64, 112, sx, sy, t * 2 + wp, wH + wp); skip.add(dx + 1); }
        else ctx.drawImage(wi.south_base, 0, 8, 32, 112, sx, sy, t + wp, wH + wp);
      }
    }
  }
}

let _cv = null, _ox = null; // persistent offscreen authoring canvas

/** Build the occlusion overlay bitmap (or null if nothing in front of the player). The caller
 *  blits it into the GL scene FBO via glc.drawSceneOverlayBitmap() before presentScene. */
export function buildOccluderBitmap(buildings, camX, camY, tilePx, w, h, playerScreen, player) {
  if (!SPOT.enabled || !buildings || !buildings.length || !playerScreen || !player) return null;
  const wi = wallImgs();
  if (!wi.south_base) return null;
  const occ = buildings.filter(b => occludes(b, player.x, player.y));
  if (!occ.length) return null;
  ensureRoof();

  if (!_cv || _cv.width !== w || _cv.height !== h) {
    _cv = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(w, h)
        : (typeof document !== 'undefined') ? document.createElement('canvas') : null;
    if (!_cv) return null;
    _cv.width = w; _cv.height = h; _ox = _cv.getContext('2d');
  }
  const o = _ox;
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.globalCompositeOperation = 'source-over';
  o.clearRect(0, 0, w, h);
  o.imageSmoothingEnabled = false;

  // More-south (closer) draws last so a nearer occluder sits over a farther one.
  occ.sort((a, b) => (a.y + a.footprint.boundingBox.h) - (b.y + b.footprint.boundingBox.h));
  for (const b of occ) {
    drawWalls(o, b, wi, camX, camY, tilePx, w, h);
    if (_roof) { try { _roof.drawRoofForBuilding(o, b, camX, camY, tilePx, { stories: buildingFloors(b), northGapTiles: northGapTiles(b), imageCache: _imageCache }); } catch { /* skip roof */ } }
  }

  // DEPTH GUARD: only the building ABOVE the player's feet occludes the player. The building's
  // lower parts (BELOW the player on screen) don't cover the player, and re-drawing them on top
  // of the scene wrongly pops THIS building in front of buildings that are SOUTH of it (closer to
  // camera) — the "redrawn whole building on top of the one it's behind" bug. Clear everything
  // below the feet so the baked scene (incl. the in-front building) shows there. (Proper
  // per-object building depth sort is the long-term fix; this clips the over-draw.)
  const clipY = Math.round(playerScreen.y + tilePx * SPOT.clipBelowFeetTiles);
  if (clipY < h) o.clearRect(0, clipY, w, h - clipY);

  // Spotlight hole around the player (centre on the torso, not the feet) — destination-out so the
  // building stays solid but fades to transparent at the player, revealing them through it.
  const cx = playerScreen.x, cy = playerScreen.y - tilePx * 0.6;
  o.globalCompositeOperation = 'destination-out';
  if (SPOT.mode === 'band') {
    const half = tilePx * SPOT.bandHalfTiles;
    const g = o.createLinearGradient(0, cy - half * 1.7, 0, cy + half * 1.7);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    o.fillStyle = g; o.fillRect(0, 0, w, h);
  } else {
    const r = tilePx * SPOT.radiusTiles;
    const g = o.createRadialGradient(cx, cy, Math.max(1, r * 0.45), cx, cy, Math.max(2, r));
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    o.fillStyle = g; o.fillRect(0, 0, w, h);
  }
  o.globalCompositeOperation = 'source-over';
  return _cv;
}
