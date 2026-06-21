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

// Source rect of the E/W side-face cap. The grassland edge_ew strip is a 32x128 quoin/side-cap;
// sample its LEFT quoin column (x=0..16) as the true vertical corner post (`isQuoinStrip`) — drawing
// the whole 32-wide face as a thin rotated strip gave the featureless square-block look. The legacy
// stone_brick fallback edge_ew is a flat 32x32 trim with NO distinct quoin column → use it whole.
export function ewQuoinRect(isQuoinStrip, iw, ih) {
  return isQuoinStrip ? [0, 0, 16, ih || 128] : [0, 0, iw || 32, ih || 32];
}

// Deterministic run-bond variant index for a wall column so adjacent base tiles use shifted mortar
// joints and the 32px strip stops reading as a fixed repeat. nVariants includes the base (index 0)
// + the rb1..rb(n-1) shifted strips. Hash of the column index (large-prime XOR) → stable per column.
export function runBondVariant(col, nVariants) {
  const n = Math.max(1, nVariants | 0);
  let x = (col | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = (x ^ (x >>> 16)) >>> 0;
  return x % n;
}

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
  // Run-bond variants of south_base (rb1/rb2/rb3) — the renderer shifts the mortar joint per wall
  // column so the 32px strip doesn't read as a fixed repeat. Only the per-(biome,wallSlug) pilot
  // pieces have them; the stone_brick fallback has none, so the variant array is just [base].
  const baseVariants = [base];
  for (let n = 1; n <= 3; n++) { const v = pilotPiece(b, 'south_base', { rbVariant: n }); if (v) baseVariants.push(v); }
  return {
    south_base: base,
    south_base_variants: baseVariants,
    south_window: w('south_window', { shape: (b && b.windowShape) || 'arched' }),
    south_door: w('south_door', { shape: (b && b.doorShape) || 'plank' }),
    south_doorway: w('south_doorway', wear), // wall with the door CUT OUT (decoupled-door pilot)
    south_corner_west: w('south_corner_west', wear),
    south_corner_east: w('south_corner_east', wear),
    edge_ew: w('edge_ew', wear),
    // True only when the per-(biome,wallSlug) pilot edge_ew loaded — a full-height structured quoin
    // strip whose left 16px is the corner post. The stone_brick fallback edge_ew is a flat trim.
    edgeIsQuoin: !!pilotPiece(b, 'edge_ew', wear),
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
  const EWX = WALL_CONFIG.ewXOffset;
  const stories = buildingFloors(b);
  const fp = b.footprint, sections = fp.sections || [];
  const tsy = (wy) => Math.round(wy * tilePx - camY);
  const floorSet = new Set();
  for (const s of sections) for (let dy = 0; dy < s.h; dy++) for (let dx = 0; dx < s.w; dx++) floorSet.add((s.x0 + dx) + ',' + (s.y0 + dy));
  const doorSet = new Set((fp.doors || []).map(d => d.x + ',' + d.y));

  // Grassland wall pieces are now 32x128 STRUCTURED STRIPS (cap+body+foundation baked in) and the
  // wide pieces (south_doorway/window) are 64x128 — both drop straight into the isotropic per-32px
  // crop. The old isPilot 4-bay clip-and-uniform-scale hack (for 128² facades) is retired: each
  // tile draws its strip at the full source height into the boundary-derived dest width. dw =
  // boundary-derived screen width for this tile (from tileExtent); falls back to the old fixed pad
  // only if a caller omits it (defensive — every live call now passes one).
  const baseFor = (col) => {
    const vs = wi.south_base_variants;
    return (vs && vs.length > 1) ? vs[runBondVariant(col, vs.length)] : wi.south_base;
  };
  const facadeTile = (img, c, dx, dy, dw) => {
    if (!img) return;
    const ew = dw || (t + wp);
    const cb = cropBox(img.naturalWidth || 32, img.naturalHeight || 128, dx, dy, ew, wH + wp);
    ctx.drawImage(img, cb.sx, cb.sy, cb.sw, cb.sh, cb.dx, cb.dy, cb.dw, cb.dh);
  };
  const facadeWide = (img, dx, dy, dw) => {
    if (!img) return;
    const ew = dw || (2 * t + wp);
    const cb = cropBox(img.naturalWidth || 64, img.naturalHeight || 128, dx, dy, ew, wH + wp);
    ctx.drawImage(img, cb.sx, cb.sy, cb.sw, cb.sh, cb.dx, cb.dy, cb.dw, cb.dh);
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
        facadeTile(baseFor(lx), lx - s.x0, sx, sy, ex.dw);
        // Corner pieces sit one tile OUTSIDE the footprint; their buttress shoulder is transparent,
        // so back-fill a south_base under the outboard tile first (no see-through to terrain).
        if (wo && wi.south_corner_west) { const exw = tileExtent(b.x + lx - 1, tilePx, camX, 1); facadeTile(baseFor(lx - 1), 0, exw.dx, sy, exw.dw); facadeTile(wi.south_corner_west, 0, exw.dx, sy, exw.dw); }
        else if (eo && wi.south_corner_east) { const exe = tileExtent(b.x + lx + 1, tilePx, camX, 1); facadeTile(baseFor(lx + 1), 3, exe.dx, sy, exe.dw); facadeTile(wi.south_corner_east, 3, exe.dx, sy, exe.dw); }
      }
    }
  }

  // EAST/WEST side facades — a FULL-HEIGHT upright quoin COLUMN (not a thin rotated strip). The
  // 32x128 edge_ew is a vertical quoin/side-cap; we draw it like a wall (wH tall, stacked per
  // story) on the east + west columns just outside each section, sampling the x=0 quoin column so
  // it reads as a real corner post — killing the square-block look. The WEST edge is mirrored.
  if (wi.edge_ew) {
    const ewX = Math.round(t * EWX);
    const iw = wi.edge_ew.naturalWidth || wi.edge_ew.width || 32, ih = wi.edge_ew.naturalHeight || wi.edge_ew.height || 128;
    const er = ewQuoinRect(wi.edgeIsQuoin, iw, ih);
    for (const s of sections) {
      for (let dy = 0; dy < s.h; dy++) {
        const ely = s.y0 + dy;
        const elxE = s.x0 + s.w, elxW = s.x0 - 1;
        const eOpen = !floorSet.has(elxE + ',' + ely), wOpen = !floorSet.has(elxW + ',' + ely);
        for (let st = 0; st < stories; st++) {
          const sy = tsy(b.y + ely + 1) - wH + Math.round(t * WY) - st * wH;
          // East edge — upright full-height column, quoin-sourced.
          if (eOpen) {
            const exE = tileExtent(b.x + elxE, tilePx, camX, 1);
            const dxE = exE.dx + ewX;
            if (dxE + exE.dw > 0 && dxE < w && sy + wH > 0 && sy < h)
              ctx.drawImage(wi.edge_ew, er[0], er[1], er[2], er[3], dxE, sy, exE.dw, wH + wp);
          }
          // West edge — mirrored quoin.
          if (wOpen) {
            const exW = tileExtent(b.x + elxW, tilePx, camX, 1);
            const dxW = exW.dx - ewX;
            if (dxW + exW.dw > 0 && dxW < w && sy + wH > 0 && sy < h) {
              ctx.save(); ctx.translate(dxW + exW.dw, sy); ctx.scale(-1, 1);
              ctx.drawImage(wi.edge_ew, er[0], er[1], er[2], er[3], 0, 0, exW.dw, wH + wp);
              ctx.restore();
            }
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
        const k = lx + ',' + ly, c = lx - s.x0, wo = !floorSet.has((lx - 1) + ',' + ly), eo = !floorSet.has((lx + 1) + ',' + ly);
        if (wo && wi.south_corner_west) { facadeTile(baseFor(lx), c, sx, sy, ex.dw); const exw = tileExtent(b.x + lx - 1, tilePx, camX, 1); facadeTile(baseFor(lx - 1), 0, exw.dx, sy, exw.dw); facadeTile(wi.south_corner_west, 0, exw.dx, sy, exw.dw); }
        else if (eo && wi.south_corner_east) { facadeTile(baseFor(lx), c, sx, sy, ex.dw); const exe = tileExtent(b.x + lx + 1, tilePx, camX, 1); facadeTile(baseFor(lx + 1), 3, exe.dx, sy, exe.dw); facadeTile(wi.south_corner_east, 3, exe.dx, sy, exe.dw); }
        else if (ground && doorSet.has(k) && dx >= 2 && dx < s.w - 2 && (wi.south_doorway || wi.south_door)) { const ex2 = tileExtent(b.x + lx, tilePx, camX, 2); facadeWide(wi.south_doorway || wi.south_door, sx, sy, ex2.dw); skip.add(dx + 1); }
        else if (win.has(k) && dx >= 2 && dx < s.w - 2 && wi.south_window) { const ex2 = tileExtent(b.x + lx, tilePx, camX, 2); facadeWide(wi.south_window, sx, sy, ex2.dw); skip.add(dx + 1); }
        else facadeTile(baseFor(lx), c, sx, sy, ex.dw);
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
