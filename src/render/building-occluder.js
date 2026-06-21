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
import { wallAssetDir, wallPieceFile, roofAssetDir, roofTextureFile, ROOF_FASCIA_FILE } from '../../sim/world/buildings/building-material-registry.js';

// Tiles the wall+roof silhouette projects NORTH of the footprint (mirrors building-shadow.js
// NORTH_SILHOUETTE_BASE / resolved-buildings NORTH_CLAIM: 8 for a 1-storey wall+roof, +4/storey).
const NORTH_BAND_BASE = 8;
const STORY = WALL_CONFIG.wallHeight; // 4

// Pure isotropic crop+dest for a legacy 32/64-wide wall strip. Crops the FULL source height
// (0..srcH) into the full dest (no 16-row top strip) so source aspect == dest aspect — kills the
// old `(0,8,W,112)`->full-dest ~14% vertical stretch (112 source rows stretched into the 4-tile
// dest gave ~2.24x vertical vs ~1.97x horizontal). The authored 8px top/bottom transparent margins
// become the intended cap/foot inset instead. Matches building-renderer.js, which already draws the
// stone_brick pieces with the full `(0,0,W,128)` source. Returns the 8 drawImage args.
export function cropBox(srcW, srcH, dx, dy, dw, dh) {
  return { sx: 0, sy: 0, sw: srcW, sh: srcH, dx, dy, dw, dh };
}

// Boundary-derived integer screen extent of `span` tiles starting at world tile wx. dx is the
// rounded left boundary; dw bridges to the rounded right boundary so adjacent tiles share the
// EXACT boundary pixel (tile N's dx+dw == tile N+1's dx). Replaces the old fixed `t+wp` / `2t+wp`
// dest width whose +1 pad over a rounded origin alternately overlapped/gapped neighbours by ~1px at
// non-integer tilePx (e.g. 62.4 at default zoom), double-painting a seam column.
export function tileExtent(wx, tilePx, camX, span) {
  const dx = Math.round(wx * tilePx - camX);
  const dw = Math.round((wx + span) * tilePx - camX) - dx;
  return { dx, dw };
}

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

// The building's assigned roof-material surface texture (thatch/wood_shingle/clay_tile/...),
// loaded lazily; null until loaded or when the building has no roofSlug (→ roof-ingame falls
// back to the biome ground texture). Lets a grassland roof read as a ROOF, not as soil.
function roofTexFor(b) {
  return (b && b.biome && b.roofSlug) ? _imageCache.get(roofAssetDir(b.biome, b.roofSlug) + roofTextureFile(0)) : null;
}
// Per-material eave/rake trim board (ROOF lane draws it on the skirt; degrades to procedural fasciaColor if absent).
function roofFasciaFor(b) {
  return (b && b.biome && b.roofSlug) ? _imageCache.get(roofAssetDir(b.biome, b.roofSlug) + ROOF_FASCIA_FILE) : null;
}

// Empty-tile gap to the building NORTH of us — mirrors the worker's roof clamp so the re-drawn
// roof rises to the SAME height as the baked one and aligns exactly.
function northGapTiles(b) {
  const bb = b.footprint.boundingBox;
  for (let gg = 1; gg <= 5; gg++)
    for (let dx = 0; dx < bb.w; dx++)
      if (queryBuildingTile(b.x + dx, b.y - gg)) return gg - 1;
  return 5;
}

// Resolve a building's wall sprite set. Per-(biome,wallSlug) pilot assets when assigned AND
// loaded; otherwise the global stone_brick fallback (getWallImg) — so unassigned biomes and
// not-yet-loaded tiles keep working (honest absence, one-frame fallback then textured, same
// convention the roof texture uses). `isPilot` tells drawWalls which source-rect scheme to use
// (pilot pieces are 128² facades; stone_brick are pre-cut 32/64-wide strips).
function pilotPiece(b, piece, opts) {
  if (!b || !b.biome || !b.wallSlug) return null;
  return _imageCache.get(wallAssetDir(b.biome, b.wallSlug) + wallPieceFile(piece, opts));
}
function wallImgs(b) {
  const w = (piece, opts) => pilotPiece(b, piece, opts) || getWallImg(piece);
  const wear = { wear: 'normal' };
  const base = w('south_base', wear);
  return {
    south_base: base,
    south_window: w('south_window', { shape: (b && b.windowShape) || 'arched' }),
    south_door: w('south_door', { shape: (b && b.doorShape) || 'plank' }),
    south_doorway: w('south_doorway', wear), // wall with the door CUT OUT (decoupled-door pilot)
    south_corner_west: w('south_corner_west', wear),
    south_corner_east: w('south_corner_east', wear),
    edge_ew: w('edge_ew', wear),
    isPilot: !!(base && (base.naturalWidth || 0) >= 96),
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
// post-pass): legacy strips use the full `(0,0,W,128)` crop (isotropic — matches building-renderer.js;
// no vertical stretch), boundary-derived tile extents (no seams), same WALL_CONFIG offsets, STACKED
// `stories` tall, door on the ground storey only. World→screen via camX/camY (CSS px, same space as drawChunk).
export function drawWalls(ctx, b, camX, camY, tilePx, w, h) {
  const wi = wallImgs(b);
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

  // Pilot pieces are raw 128² facades (a 4-bay wall with the cap/foundation bands and, for
  // window/door, a centred feature). To tile them to ANY building width WITHOUT fragmenting
  // diagonal braces or seaming at non-32 zoom, each on-screen tile draws its slice of a
  // UNIFORMLY-scaled 4-tile facade unit, clipped to the tile — so adjacent tiles reconstruct
  // one continuous facade (zoom-robust), and a wide piece shows the facade's centred 2 tiles.
  // Legacy stone_brick pieces are pre-cut 32/64-wide strips with an 8px top inset.
  const P = wi.isPilot;
  // A pilot facade has 3 vertical bands: a cap/beam (top ~18/128), a foundation course
  // (bottom ~22/128), and the wall surface between. On a MULTI-STORY wall, drawing the full
  // facade per story repeats the cap+foundation as a molding band at every floor. So per story
  // we pick a vertical band: ground story keeps the foundation but drops the cap; the top story
  // keeps the cap but drops the foundation; middle stories show only the surface. The cap then
  // appears only at the roofline and the foundation only at the floor. Single story = full facade.
  const SY = (vb) => vb === 'capmid' ? [0, 106] : vb === 'midfound' ? [18, 128] : vb === 'mid' ? [18, 106] : [0, 128];
  const vbandFor = (st) => stories === 1 ? 'full' : (st === 0 ? 'midfound' : (st === stories - 1 ? 'capmid' : 'mid'));
  // c = section-relative tile column (so each building's facade starts clean at its left edge).
  // dw = boundary-derived screen width for this tile (from tileExtent); falls back to the old
  // fixed pad only if a caller omits it (defensive — every live call now passes one).
  const facadeTile = (img, c, dx, dy, vb, dw) => {
    const ew = dw || (t + wp);
    if (!P) { const cb = cropBox(img.naturalWidth || 32, img.naturalHeight || 128, dx, dy, ew, wH + wp); ctx.drawImage(img, cb.sx, cb.sy, cb.sw, cb.sh, cb.dx, cb.dy, cb.dw, cb.dh); return; }
    const ux = dx - ((((c) % 4) + 4) % 4) * t, s = SY(vb);
    ctx.save(); ctx.beginPath(); ctx.rect(dx, dy, ew, wH + wp); ctx.clip();
    ctx.drawImage(img, 0, s[0], 128, s[1] - s[0], ux, dy, 4 * t, wH + wp); ctx.restore();
  };
  const facadeWide = (img, dx, dy, vb, dw) => {
    const ew = dw || (2 * t + wp);
    if (!P) { const cb = cropBox(img.naturalWidth || 64, img.naturalHeight || 128, dx, dy, ew, wH + wp); ctx.drawImage(img, cb.sx, cb.sy, cb.sw, cb.sh, cb.dx, cb.dy, cb.dw, cb.dh); return; }
    const ux = dx - t, s = SY(vb); // the facade's centred 2 tiles (window/door) land at dx..dx+2t
    ctx.save(); ctx.beginPath(); ctx.rect(dx, dy, ew, wH + wp); ctx.clip();
    ctx.drawImage(img, 0, s[0], 128, s[1] - s[0], ux, dy, 4 * t, wH + wp); ctx.restore();
  };

  // NORTH walls — stacked
  for (const s of sections) {
    const nr = s.y0;
    for (let dx = 0; dx < s.w; dx++) {
      const lx = s.x0 + dx;
      if (floorSet.has(lx + ',' + (nr - 1))) continue;
      const ex = tileExtent(b.x + lx, tilePx, camX, 1); const sx = ex.dx;
      const wo = !floorSet.has((lx - 1) + ',' + nr), eo = !floorSet.has((lx + 1) + ',' + nr);
      for (let st = 0; st < stories; st++) {
        const sy = tsy(b.y + nr) - wH + Math.round(t * NY) - st * wH;
        if (sx + t < 0 || sx > w || sy + wH < 0 || sy > h) continue;
        const vb = vbandFor(st);
        facadeTile(wi.south_base, lx - s.x0, sx, sy, vb, ex.dw);
        if (wo && wi.south_corner_west) { const exw = tileExtent(b.x + lx - 1, tilePx, camX, 1); facadeTile(wi.south_corner_west, 0, exw.dx, sy, vb, exw.dw); }
        else if (eo && wi.south_corner_east) { const exe = tileExtent(b.x + lx + 1, tilePx, camX, 1); facadeTile(wi.south_corner_east, 3, exe.dx, sy, vb, exe.dw); }
      }
    }
  }

  // EAST/WEST edge trims (worker uses the rotated edge_ew strip)
  if (wi.edge_ew) {
    const ewH = Math.round(t * EWH), ewX = Math.round(t * EWX);
    const iw = wi.edge_ew.naturalWidth || wi.edge_ew.width || 32, ih = wi.edge_ew.naturalHeight || wi.edge_ew.height || 32;
    // The E/W cap is a thin rotated strip; sample one facade column for pilot pieces.
    const er = P ? [16, 0, 32, 128] : [0, 0, iw, ih];
    const ew = (dx, dy) => ctx.drawImage(wi.edge_ew, er[0], er[1], er[2], er[3], dx, dy, t + wp, ewH + wp);
    for (const s of sections) {
      for (let dy = 0; dy < s.h; dy++) {
        const ely = s.y0 + dy;
        const elx = s.x0 + s.w;
        if (!floorSet.has(elx + ',' + ely)) {
          const ex = tsx(b.x + elx) + ewX, ey = tsy(b.y + ely);
          if (ex + t > 0 && ex < w && ey + ewH > 0 && ey < h) {
            ctx.save(); ctx.translate(ex + t / 2, ey + ewH / 2); ctx.rotate(Math.PI / 2);
            ew(-t / 2, -ewH / 2); ctx.restore();
          }
        }
        const wlx = s.x0 - 1;
        if (!floorSet.has(wlx + ',' + ely)) {
          const wx = tsx(b.x + wlx) - ewX, wy = tsy(b.y + ely);
          if (wx + t > 0 && wx < w && wy + ewH > 0 && wy < h) {
            ctx.save(); ctx.translate(wx + t / 2, wy + ewH / 2); ctx.rotate(Math.PI / 2); ctx.scale(-1, 1);
            ew(-t / 2, -ewH / 2); ctx.restore();
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
        const ex = tileExtent(b.x + lx, tilePx, camX, 1); const sx = ex.dx;
        const sy = tsy(fbY) - wH + Math.round(t * WY) - st * wH;
        if (sx + t < 0 || sx > w || sy + wH < 0 || sy > h) continue;
        const k = lx + ',' + ly, c = lx - s.x0, vb = vbandFor(st), wo = !floorSet.has((lx - 1) + ',' + ly), eo = !floorSet.has((lx + 1) + ',' + ly);
        if (wo && wi.south_corner_west) { facadeTile(wi.south_base, c, sx, sy, vb, ex.dw); const exw = tileExtent(b.x + lx - 1, tilePx, camX, 1); facadeTile(wi.south_corner_west, 0, exw.dx, sy, vb, exw.dw); }
        else if (eo && wi.south_corner_east) { facadeTile(wi.south_base, c, sx, sy, vb, ex.dw); const exe = tileExtent(b.x + lx + 1, tilePx, camX, 1); facadeTile(wi.south_corner_east, 3, exe.dx, sy, vb, exe.dw); }
        else if (ground && doorSet.has(k) && dx >= 2 && dx < s.w - 2 && (wi.south_doorway || wi.south_door)) { const ex2 = tileExtent(b.x + lx, tilePx, camX, 2); facadeWide(wi.south_doorway || wi.south_door, sx, sy, vb, ex2.dw); skip.add(dx + 1); }
        else if (win.has(k) && dx >= 2 && dx < s.w - 2 && wi.south_window) { const ex2 = tileExtent(b.x + lx, tilePx, camX, 2); facadeWide(wi.south_window, sx, sy, vb, ex2.dw); skip.add(dx + 1); }
        else facadeTile(wi.south_base, c, sx, sy, vb, ex.dw);
      }
    }
  }
}

let _cv = null, _ox = null; // persistent offscreen authoring canvas

/** Build the occlusion overlay bitmap (or null if nothing in front of the player). The caller
 *  blits it into the GL scene FBO via glc.drawSceneOverlayBitmap() before presentScene. */
export function buildOccluderBitmap(buildings, camX, camY, tilePx, w, h, playerScreen, player) {
  if (!SPOT.enabled || !buildings || !buildings.length || !playerScreen || !player) return null;
  if (!getWallImg('south_base')) return null; // stone_brick fallback must be loaded
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
    drawWalls(o, b, camX, camY, tilePx, w, h);
    if (_roof) { try { _roof.drawRoofForBuilding(o, b, camX, camY, tilePx, { stories: buildingFloors(b), northGapTiles: northGapTiles(b), imageCache: _imageCache, roofTexture: roofTexFor(b), roofFascia: roofFasciaFor(b) }); } catch { /* skip roof */ } }
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

/** Draw ONE building's walls+roof TEXTURED (no hole, no clip) onto ctx — the exact silhouette the
 *  baked building occupies on screen. Shared with the depth pass (building-depth.js), which
 *  recolours this silhouette to a per-building depth value. Returns false if wall sprites aren't
 *  loaded yet. */
export function drawBuildingTextured(ctx, b, camX, camY, tilePx, w, h) {
  if (!getWallImg('south_base')) return false; // stone_brick fallback must be loaded
  ensureRoof();
  drawWalls(ctx, b, camX, camY, tilePx, w, h);
  if (_roof) { try { _roof.drawRoofForBuilding(ctx, b, camX, camY, tilePx, { stories: buildingFloors(b), northGapTiles: northGapTiles(b), imageCache: _imageCache, roofTexture: roofTexFor(b), roofFascia: roofFasciaFor(b) }); } catch { /* skip roof */ } }
  return true;
}
