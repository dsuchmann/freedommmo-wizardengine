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
import { drawBuildingTiles, isTiledBuilding, materialOf, tileImagesReady, drawDoorsLive, doorSwingSig } from './building-tiles.js';
import { renderOn } from './building-render-flags.js';
import { paintWeatheredColumn } from './dressing/d0-weathering.js';
import { paintDamagedColumn } from './dressing/d1-damage.js';
import { drawD1Chips } from './dressing/d1-chips.js';
import { paintGrowthColumn, isStoneSlug } from './dressing/d2-growth.js';
import { isWaterTile } from '../../sim/world/buildings/terrain-suitability.js';
import { drawD3Props, drawBakedAwnings } from './dressing/d3-props.js';
import { drawVinePass } from './dressing/vine-render.js';
import { onSceneDiscontinuity } from '../core/scene-teardown.js';

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

// Average opaque colour of a wall image, cached per-image — used to tint the procedural aperture
// frame to a darker shade of the actual wall tone at runtime (so door/window frames seat into the
// wall whatever the swatch tone is). Returns { frame, shadow } CSS colours or a safe grey default.
const _toneCache = new WeakMap();
let _toneCv = null, _toneCx = null;
function wallTone(img) {
  if (!img || !img.naturalWidth) return { frame: '#6b6b6b', shadow: '#3c3c3c' };
  const hit = _toneCache.get(img);
  if (hit) return hit;
  try {
    if (!_toneCv) { _toneCv = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(16, 16) : document.createElement('canvas'); _toneCv.width = 16; _toneCv.height = 16; _toneCx = _toneCv.getContext('2d', { willReadFrequently: true }); }
    _toneCx.clearRect(0, 0, 16, 16);
    _toneCx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, 16, 16);
    const d = _toneCx.getImageData(0, 0, 16, 16).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 40) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    if (!n) return { frame: '#6b6b6b', shadow: '#3c3c3c' };
    r /= n; g /= n; b /= n;
    const clamp = (v) => Math.max(0, Math.min(255, v | 0));
    const frame = `rgb(${clamp(r * 0.62)},${clamp(g * 0.62)},${clamp(b * 0.62)})`;
    const shadow = `rgb(${clamp(r * 0.34)},${clamp(g * 0.34)},${clamp(b * 0.34)})`;
    const tone = { frame, shadow };
    _toneCache.set(img, tone);
    return tone;
  } catch { return { frame: '#6b6b6b', shadow: '#3c3c3c' }; }
}

// Cutaway shape — radial by default (consistent with the interior). Live-tunable from the
// console: window._occluderSpot.mode = 'band' | 'circle', radii, or .enabled = false.
export const SPOT = { mode: 'circle', radiusTiles: 2.6, bandHalfTiles: 1.7, enabled: true, clipBelowFeetTiles: 0.4 };
if (typeof window !== 'undefined') window._occluderSpot = SPOT;

// Window-as-OBJECT fit: draw a proper window object (transparent surround) over a CLEAN wall tile at
// proper proportion + position — replacing the old baked south_window facade (which read as a squished
// oval) and the legacy cutout. Live-tunable from the console (window._windowFit).
export const WINDOW_FIT = { wTiles: 1.3, hTiles: 1.5, yFrac: 0.32, enabled: true };
if (typeof window !== 'undefined') window._windowFit = WINDOW_FIT;

// Roof engine (the SAME module the worker bakes with) — lazy + guarded so a roof failure never
// breaks the frame (mirrors roof-overlay.js).
let _roof = null, _roofLoading = false, _roofFailed = false;
function ensureRoof() {
  if (_roof || _roofLoading || _roofFailed) return;
  _roofLoading = true;
  import('../../tools/roof/roof-ingame.js').then(m => { _roof = m; }).catch(() => { _roofFailed = true; }).finally(() => { _roofLoading = false; });
}

// Bake-state for the building sprite cache: { complete, sig }. complete = is the TEXTURED silhouette fully
// renderable RIGHT NOW (all wall/aperture tiles loaded AND the roof engine loaded)? The cache re-bakes until
// complete so it never FREEZES a half-loaded (walls-only / no-roof) sprite — tiles + the roof module load async,
// so the first drawable frame is walls-only and that must NOT be the permanent bake. sig is '' for now (Step 1:
// the door + props are baked FROZEN — no per-frame re-bake yet). Kicks ensureRoof so the roof starts loading.
export function buildingBakeState(b) {
  let complete = true;
  try {
    if (isTiledBuilding(b)) {
      if (!tileImagesReady(b)) complete = false;
      else if (renderOn('roof')) {
        ensureRoof();
        if (!_roof) complete = false;                            // roof ENGINE still loading → bake again later
        else if (b.roofSlug && !roofTexFor(b)) complete = false; // roof TEXTURE still loading → else it bakes a flat
                                                                 // procedural base colour ("green roof") and freezes
      }
    } else {
      complete = !!getWallImg('south_base'); // legacy wall path needs the stone_brick fallback loaded
    }
    // NOTE: do NOT compute buildVineSplines() here. buildingBakeState runs EVERY FRAME for EVERY building (it's
    // the cache's validity check), so any non-trivial work here is a per-frame CPU cost on the hot path (2026-06-26
    // perf bug: a vine gate here dropped a town to 20fps). The vine art (small, on disk) decodes well within the
    // multi-frame window the tiles+roof completeness already provides, so a separate vine wait isn't worth it.
  } catch { complete = true; } // never block forever on a predicate error
  return { complete, sig: '' };
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
  if (!(b && b.biome && b.roofSlug)) return null;
  const dir = roofAssetDir(b.biome, b.roofSlug);
  // Rotate roof_top variants per building (deterministic by footprint position) so a town shows VARIETY instead
  // of one repeated tile. .get lazy-loads each variant; try the hashed one first, then fall through to whatever
  // variants exist (v000 base) so a slug with fewer variants still renders.
  // Biome-wide curated roof-pool size (every roofSlug shares the same pool; rotate this many per building for town
  // variety). desert = 8 (mud + sandstone-slabs); mystic = 48 (geode + amethyst + silver-thatch, slate excluded —
  // user-curated 2026-06-24). Default 8. The fall-through loop still renders slugs with fewer variants on disk.
  const ROOF_NV = { desert: 8, mystic: 48 };
  const NV = ROOF_NV[b.biome] || 8; // roof_top__v000..v0(NV-1)
  const h = Math.abs((((b.x | 0) * 73856093) ^ ((b.y | 0) * 19349663)) >>> 0) % NV;
  for (let k = 0; k < NV; k++) { const img = _imageCache.get(dir + roofTextureFile((h + k) % NV)); if (img) return img; }
  return null;
}
// Per-material eave/rake trim board (ROOF lane draws it on the skirt; degrades to procedural fasciaColor if absent).
function roofFasciaFor(b) {
  return (b && b.biome && b.roofSlug) ? _imageCache.get(roofAssetDir(b.biome, b.roofSlug) + ROOF_FASCIA_FILE) : null;
}
// Per-WALL-MATERIAL gable tile (the wall carried up into the south roof→wall triangle). Keyed on the building's
// WALL material (materialOf) from the tiles corpus — NOT the roof material. Null until the image lazy-loads or for
// non-tiled biomes → drawSkirt falls back to the procedural solid fill. Shares the one-frame-lazy _imageCache.
const TILE_GABLE_ROOT = '/assets/pixelab/buildings/tiles/';
function gableTexFor(b) {
  if (!(b && b.biome)) return null;
  const mat = materialOf(b);
  return mat ? _imageCache.get(TILE_GABLE_ROOT + b.biome + '/' + mat + '/gable__v0.png') : null;
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
// The grassland "structured" wall materials — buildings that get the dedicated foundation /
// cap / quoin / window-object pieces + procedural door+window frames + suppressed legacy facade
// (continuous seamless body wall with seated apertures). Started as the cob pilot; now applies to
// all four grassland materials. Gated by (biome,wallSlug) so other biomes keep their facade look.
const STRUCTURED_WALLS = { grassland: new Set(['cob', 'fieldstone', 'wattle_daub', 'timber_frame']) };
export function isStructured(b) {
  return !!(b && b.biome && b.wallSlug && STRUCTURED_WALLS[b.biome] && STRUCTURED_WALLS[b.biome].has(b.wallSlug));
}
// Back-compat alias: the original cob predicate. Now true for any structured grassland material.
export function isCob(b) { return isStructured(b); }
// Load a structured trim piece (foundation/cap/quoin/window-obj) by bare filename. These live
// outside the wallPieceFile naming scheme. Loads from the building's OWN material dir; if that
// material doesn't ship its own trim piece (e.g. timber reusing the grey stone foundation/cap/
// quoin), falls back to the cob pilot's grey-stone piece. Null until loaded (one-frame lazy).
const COB_DIR = wallAssetDir('grassland', 'cob');
function cobPiece(b, file) {
  if (!isStructured(b) || !b.biome) return null;
  return _imageCache.get(wallAssetDir(b.biome, b.wallSlug) + file) || _imageCache.get(COB_DIR + file);
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
    // ── Structured-wall extras (grassland cob/fieldstone/wattle/timber; null elsewhere) ──
    // Per-material trim if present, else the cob grey-stone piece (see cobPiece fallback).
    cob: isStructured(b),
    cob_foundation: cobPiece(b, 'south_foundation__normal.png'), // seamless ground band
    cob_cap: cobPiece(b, 'south_cap__normal.png'),               // seamless top coping
    cob_quoin: cobPiece(b, 'south_quoin__normal.png'),           // vertical corner post
    cob_window: cobPiece(b, 'south_window_obj__normal.png'),     // window OBJECT (transparent surround)
  };
}

// Procedural jamb+lintel frame around an aperture (door/window) so the opening seats into the wall
// instead of floating. Draws ONLY a few-px border (never clears the centre — the wall must stay
// opaque; the window object / door leaf fills the opening). `frameCol` is a darker shade of the
// wall tone, `shadowCol` a deeper inner-reveal line. (x,y,w,h) is the OPENING rect in screen px;
// `px` the frame thickness. Border is drawn OUTSIDE the opening (jambs left/right, lintel top,
// sill bottom) so it overlaps the wall, not the glass.
function drawApertureFrame(ctx, x, y, w, h, frameCol, shadowCol, px) {
  ctx.save();
  const f = Math.max(2, Math.round(px));
  // jamb boards (left/right) + lintel (top) + sill (bottom) — frame colour
  ctx.fillStyle = frameCol;
  ctx.fillRect(x - f, y - f, w + 2 * f, f);          // lintel (top)
  ctx.fillRect(x - f, y + h, w + 2 * f, f);          // sill (bottom)
  ctx.fillRect(x - f, y, f, h);                      // left jamb
  ctx.fillRect(x + w, y, f, h);                      // right jamb
  // inner reveal line (1px, darker) hugging the opening so it reads recessed
  ctx.fillStyle = shadowCol;
  ctx.fillRect(x - 1, y - 1, w + 2, 1);
  ctx.fillRect(x - 1, y + h, w + 2, 1);
  ctx.fillRect(x - 1, y, 1, h);
  ctx.fillRect(x + w, y, 1, h);
  ctx.restore();
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

// Per-building memoised floor-occupancy Set (keys "lx,ly" of every footprint tile). The footprint
// sections are STATIC building geometry, so the identical Set was being rebuilt every frame in
// drawWalls + all three dressing passes (5 O(n²) rebuilds/building/frame). Cache it on the building,
// invalidated by the sections-array IDENTITY (a regenerated footprint swaps the array reference →
// rebuild). The Set is only ever read (.has) by callers, never mutated, so sharing is safe.
function floorSetFor(b) {
  const fp = b && b.footprint;
  const sections = (fp && fp.sections) || [];
  if (b._floorSetCache && b._floorSetSrc === sections) return b._floorSetCache;
  const set = new Set();
  for (const s of sections) for (let dy = 0; dy < s.h; dy++) for (let dx = 0; dx < s.w; dx++) set.add((s.x0 + dx) + ',' + (s.y0 + dy));
  b._floorSetCache = set;
  b._floorSetSrc = sections;
  return set;
}
// Per-building memoised door Set (keys "lx,ly"). doors are static footprint geometry; same identity-
// keyed cache + read-only-share rationale as floorSetFor.
function doorSetFor(b) {
  const fp = b && b.footprint;
  const doors = (fp && fp.doors) || [];
  if (b._doorSetCache && b._doorSetSrc === doors) return b._doorSetCache;
  const set = new Set(doors.map(d => d.x + ',' + d.y));
  b._doorSetCache = set;
  b._doorSetSrc = doors;
  return set;
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
  const floorSet = floorSetFor(b);
  const doorSet = doorSetFor(b);

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
  // Cob uses the dedicated grey QUOIN on the E/W edges for its corners, so suppress the brown
  // timber south_corner_west/east pieces (they clash with the grey stone) — back-fill the outboard
  // tile with clean body instead. Other materials keep their authored corner pieces.
  const scw = wi.cob ? null : wi.south_corner_west;
  const sce = wi.cob ? null : wi.south_corner_east;
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
        if (wo && scw) { const exw = tileExtent(b.x + lx - 1, tilePx, camX, 1); facadeTile(baseFor(lx - 1), 0, exw.dx, sy, exw.dw); facadeTile(scw, 0, exw.dx, sy, exw.dw); }
        else if (eo && sce) { const exe = tileExtent(b.x + lx + 1, tilePx, camX, 1); facadeTile(baseFor(lx + 1), 3, exe.dx, sy, exe.dw); facadeTile(sce, 3, exe.dx, sy, exe.dw); }
        else if (wi.cob && wo) { const exw = tileExtent(b.x + lx - 1, tilePx, camX, 1); facadeTile(baseFor(lx - 1), 0, exw.dx, sy, exw.dw); }
        else if (wi.cob && eo) { const exe = tileExtent(b.x + lx + 1, tilePx, camX, 1); facadeTile(baseFor(lx + 1), 3, exe.dx, sy, exe.dw); }
      }
    }
  }

  // EAST/WEST side facades — a FULL-HEIGHT upright quoin COLUMN (not a thin rotated strip). The
  // 32x128 edge_ew is a vertical quoin/side-cap; we draw it like a wall (wH tall, stacked per
  // story) on the east + west columns just outside each section, sampling the x=0 quoin column so
  // it reads as a real corner post — killing the square-block look. The WEST edge is mirrored.
  // Cob uses the dedicated grey-stone QUOIN post (a clean full-height corner column) in place of the
  // generic edge_ew strip; sample its whole width (it IS the post, no inner quoin column to crop).
  const ewImg = (wi.cob && wi.cob_quoin) ? wi.cob_quoin : wi.edge_ew;
  const ewIsQuoin = (wi.cob && wi.cob_quoin) ? false : wi.edgeIsQuoin;
  if (ewImg) {
    const ewX = Math.round(t * EWX);
    const iw = ewImg.naturalWidth || ewImg.width || 32, ih = ewImg.naturalHeight || ewImg.height || 128;
    const er = ewQuoinRect(ewIsQuoin, iw, ih);
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
              ctx.drawImage(ewImg, er[0], er[1], er[2], er[3], dxE, sy, exE.dw, wH + wp);
          }
          // West edge — mirrored quoin.
          if (wOpen) {
            const exW = tileExtent(b.x + elxW, tilePx, camX, 1);
            const dxW = exW.dx - ewX;
            if (dxW + exW.dw > 0 && dxW < w && sy + wH > 0 && sy < h) {
              ctx.save(); ctx.translate(dxW + exW.dw, sy); ctx.scale(-1, 1);
              ctx.drawImage(ewImg, er[0], er[1], er[2], er[3], 0, 0, exW.dw, wH + wp);
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
        if (wo && scw) { facadeTile(baseFor(lx), c, sx, sy, ex.dw); const exw = tileExtent(b.x + lx - 1, tilePx, camX, 1); facadeTile(baseFor(lx - 1), 0, exw.dx, sy, exw.dw); facadeTile(scw, 0, exw.dx, sy, exw.dw); }
        else if (eo && sce) { facadeTile(baseFor(lx), c, sx, sy, ex.dw); const exe = tileExtent(b.x + lx + 1, tilePx, camX, 1); facadeTile(baseFor(lx + 1), 3, exe.dx, sy, exe.dw); facadeTile(sce, 3, exe.dx, sy, exe.dw); }
        // For cob, back-fill the outboard corner tile with clean body (grey quoin from the E/W pass
        // provides the post) — but still let a door/window tile fall through to its own branch.
        else if (wi.cob && wo && !(ground && doorSet.has(k)) && !win.has(k)) { facadeTile(baseFor(lx), c, sx, sy, ex.dw); const exw = tileExtent(b.x + lx - 1, tilePx, camX, 1); facadeTile(baseFor(lx - 1), 0, exw.dx, sy, exw.dw); }
        else if (wi.cob && eo && !(ground && doorSet.has(k)) && !win.has(k)) { facadeTile(baseFor(lx), c, sx, sy, ex.dw); const exe = tileExtent(b.x + lx + 1, tilePx, camX, 1); facadeTile(baseFor(lx + 1), 3, exe.dx, sy, exe.dw); }
        // ── STRUCTURED door: clean body across a 2-tile cell + a procedural jamb/lintel frame around
        // the opening (the door LEAF is drawn separately by door-leaves.js, swung on its hinge). NO
        // baked south_doorway facade — the wall stays a continuous body with a framed opening. Fires
        // at ANY valid south-perimeter door position (incl. dx=0 / the east edge): the 2-tile door
        // cell shifts INWARD when the door sits on a section edge so the frame + body never spill off
        // the wall. door-leaves.js already swings the leaf at every fp.door, so it now seats in a
        // real framed opening everywhere, not just mid-span. ─────────────────────────────────────
        else if (wi.cob && ground && doorSet.has(k)) {
          // pick the 2-tile cell: prefer (lx, lx+1); if lx is the east-most column, use (lx-1, lx).
          const eastEdge = (dx >= s.w - 1) || floorSet.has((lx + 1) + ',' + ly);
          const cellLx = eastEdge ? lx - 1 : lx;
          const cellC = cellLx - s.x0;
          const ex2 = tileExtent(b.x + cellLx, tilePx, camX, 2);
          const cellSx = tileExtent(b.x + cellLx, tilePx, camX, 1).dx;
          // clean body across both cell tiles
          facadeTile(baseFor(cellLx), cellC, cellSx, sy, tileExtent(b.x + cellLx, tilePx, camX, 1).dw);
          const exB = tileExtent(b.x + cellLx + 1, tilePx, camX, 1);
          facadeTile(baseFor(cellLx + 1), cellC + 1, exB.dx, sy, exB.dw);
          const tone = wallTone(wi.south_base);
          const oW = Math.round(ex2.dw * 0.56), oH = Math.round(wH * 0.82);
          const oX = cellSx + Math.round((ex2.dw - oW) / 2), oY = sy + wH - oH; // bottom-aligned doorway
          drawApertureFrame(ctx, oX, oY, oW, oH, tone.frame, tone.shadow, Math.max(2, Math.round(t * 0.07)));
          if (!eastEdge) skip.add(dx + 1); // the forward cell partner is painted here; skip its own pass
        }
        // ── COB window: clean body + a small framed window OBJECT in the upper-middle of ONE tile. ─
        else if (wi.cob && win.has(k) && dx >= 1 && dx < s.w - 1) {
          facadeTile(baseFor(lx), c, sx, sy, ex.dw);
          const tone = wallTone(wi.south_base);
          const oW = Math.round(ex.dw * 0.62), oH = Math.round(wH * 0.30);
          const oX = sx + Math.round((ex.dw - oW) / 2), oY = sy + Math.round(wH * 0.26);
          drawApertureFrame(ctx, oX, oY, oW, oH, tone.frame, tone.shadow, Math.max(2, Math.round(t * 0.06)));
          if (wi.cob_window) ctx.drawImage(wi.cob_window, 0, 0, wi.cob_window.naturalWidth, wi.cob_window.naturalHeight, oX, oY, oW, oH);
        }
        else if (!wi.cob && ground && doorSet.has(k) && dx >= 2 && dx < s.w - 2 && (wi.south_doorway || wi.south_door)) { const ex2 = tileExtent(b.x + lx, tilePx, camX, 2); facadeWide(wi.south_doorway || wi.south_door, sx, sy, ex2.dw); skip.add(dx + 1); }
        else if (!wi.cob && win.has(k) && dx >= 2 && dx < s.w - 2 && wi.south_window) { const ex2 = tileExtent(b.x + lx, tilePx, camX, 2); facadeWide(wi.south_window, sx, sy, ex2.dw); skip.add(dx + 1); }
        else facadeTile(baseFor(lx), c, sx, sy, ex.dw);
      }
    }
  }

  // ── COB foundation + cap trim (post-pass) ────────────────────────────────────────────────────
  // Draw the heavy grey-stone FOUNDATION band across the bottom of the GROUND story and the coping
  // CAP across the top of the TOP story, on every exposed south/north perimeter column. Drawn last
  // so they sit cleanly over the body tiling. Tiled per-column so they span any building width.
  if (wi.cob && (wi.cob_foundation || wi.cob_cap)) {
    const fH = wi.cob_foundation ? Math.max(6, Math.round(t * 0.42)) : 0;  // foundation band height (px)
    const cH = wi.cob_cap ? Math.max(5, Math.round(t * 0.26)) : 0;         // cap band height (px)
    const drawCol = (wx, sy0base, dw) => {
      const dx = Math.round(wx * tilePx - camX);
      if (dx + dw < 0 || dx > w) return;
      if (wi.cob_foundation) { const fy = sy0base + wH - fH; if (fy + fH > 0 && fy < h) ctx.drawImage(wi.cob_foundation, 0, 0, wi.cob_foundation.naturalWidth, wi.cob_foundation.naturalHeight, dx, fy, dw, fH); }
    };
    const drawCap = (wx, syTopBase, dw) => {
      const dx = Math.round(wx * tilePx - camX);
      if (dx + dw < 0 || dx > w) return;
      if (wi.cob_cap) { const cy = syTopBase; if (cy + cH > 0 && cy < h) ctx.drawImage(wi.cob_cap, 0, 0, wi.cob_cap.naturalWidth, wi.cob_cap.naturalHeight, dx, cy, dw, cH); }
    };
    for (const s of sections) {
      // SOUTH perimeter columns
      const lr = s.y0 + s.h - 1, fbY = b.y + s.y0 + s.h;
      for (let dx = 0; dx < s.w; dx++) {
        const lx = s.x0 + dx;
        if (floorSet.has(lx + ',' + (lr + 1))) continue;       // south neighbour is inside → not a south face
        const ex = tileExtent(b.x + lx, tilePx, camX, 1);
        const groundBase = tsy(fbY) - wH + Math.round(t * WY);                 // ground story top (st=0)
        const topBase = tsy(fbY) - wH + Math.round(t * WY) - (stories - 1) * wH; // top story top
        drawCol(b.x + lx, groundBase, ex.dw);
        drawCap(b.x + lx, topBase, ex.dw);
      }
      // NORTH perimeter columns (cap only — foundation reads on the visible south face; the north
      // ground band is hidden behind the building, so cap the top to finish the silhouette).
      const nr = s.y0;
      for (let dx = 0; dx < s.w; dx++) {
        const lx = s.x0 + dx;
        if (floorSet.has(lx + ',' + (nr - 1))) continue;
        const ex = tileExtent(b.x + lx, tilePx, camX, 1);
        const topBase = tsy(b.y + nr) - wH + Math.round(t * NY) - (stories - 1) * wH;
        drawCap(b.x + lx, topBase, ex.dw);
      }
    }
  }
}

// D0 WEATHERING post-pass — tint each exposed SOUTH perimeter wall COLUMN with procedural ground grime +
// tonal variation. Mechanism A: painted into the silhouette ctx, so it rides the GL present pass (lighting/
// CRT/day-night) — never a 2D overlay. Walks the same south-perimeter columns as the cob-foundation pass.
function drawWeatheringPass(ctx, b, camX, camY, tilePx, w, h, colSet) {
  if (!renderOn('weathering')) return;
  const fp = b && b.footprint, sections = (fp && fp.sections) || [];
  if (!sections.length) return;
  const t = Math.round(tilePx);
  const wH = Math.round(tilePx * WALL_CONFIG.wallHeight);
  const WY = WALL_CONFIG.wallYOffset;
  const stories = buildingFloors(b);
  const material = materialOf(b); // pass to the weathering pass so pale woven/thatch walls get gentler grime
  const tsy = (wy) => Math.round(wy * tilePx - camY);
  const floorSet = floorSetFor(b);
  for (const s of sections) {
    const lr = s.y0 + s.h - 1, fbY = b.y + s.y0 + s.h;
    for (let dx = 0; dx < s.w; dx++) {
      const lx = s.x0 + dx;
      if (floorSet.has(lx + ',' + (lr + 1))) continue; // south neighbour inside → not a south face
      const ex = tileExtent(b.x + lx, tilePx, camX, 1);
      const groundTop = tsy(fbY) - wH + Math.round(t * WY);
      const colTop = groundTop - (stories - 1) * wH;
      const colH = stories * wH;
      if (ex.dx + ex.dw < 0 || ex.dx > w || colTop + colH < 0 || colTop > h) continue;
      if (colSet && !colSet.has(lx)) continue; // door-only repaint: grime just the door's columns (caller passes a colSet)
      paintWeatheredColumn(ctx, { dx: ex.dx, top: colTop, dw: ex.dw, colH, tilePx }, { wx: b.x + lx, wy: fbY }, { material });
    }
  }
}

// Honest water-proximity for a building, cached on the building (terrain never changes): the Chebyshev
// distance to the nearest basin-water tile (river/lake/coast) within a small radius, mapped to [0,1]
// (1 = water immediately adjacent). Buildings are filtered OFF water but can sit beside it, so this is a
// real hydrology signal → a waterfront building rots/runnels in ANY biome. 0 when no water is near or the
// classifier is unavailable (honest absence → biome-climate wetness only).
const WATER_PROX_R = 10;
function buildingWaterProximity(b) {
  if (b._d1WaterProx !== undefined) return b._d1WaterProx;
  let prox = 0;
  try {
    const bb = b && b.footprint && b.footprint.boundingBox;
    if (bb) {
      const x0 = b.x, y0 = b.y, x1 = b.x + bb.w - 1, y1 = b.y + bb.h - 1;
      let found = 0;
      for (let r = 1; r <= WATER_PROX_R && !found; r++) {
        for (let x = x0 - r; x <= x1 + r && !found; x++) if (isWaterTile(x, y0 - r) || isWaterTile(x, y1 + r)) found = r;
        for (let y = y0 - r; y <= y1 + r && !found; y++) if (isWaterTile(x0 - r, y) || isWaterTile(x1 + r, y)) found = r;
      }
      if (found) prox = 1 - (found - 1) / WATER_PROX_R; // adjacent → 1.0, at the radius edge → ~0.1
    }
  } catch { prox = 0; } // classifier not available client-side → no water signal (honest)
  b._d1WaterProx = prox;
  return prox;
}

// D1 DAMAGE post-pass — paint procedural structural decay (cracks/flaking/rot/runnels/rust) over the
// SAME south-perimeter wall columns as weathering, AFTER it (damage rides on top of grime). Mechanism A:
// into the silhouette ctx → GL present pass, never a 2D overlay. Drivers are honest: wetness derives from
// the building's biome AND its real water-proximity (waterfront buildings rot/runnel in any biome); a
// per-building disrepair baseline drives cracks/flaking; age is honestly absent (tuner-preview only).
function drawDamagePass(ctx, b, camX, camY, tilePx, w, h, colSet) {
  if (!renderOn('damage')) return;
  const fp = b && b.footprint, sections = (fp && fp.sections) || [];
  if (!sections.length) return;
  const t = Math.round(tilePx);
  const wH = Math.round(tilePx * WALL_CONFIG.wallHeight);
  const WY = WALL_CONFIG.wallYOffset;
  const stories = buildingFloors(b);
  const material = materialOf(b);
  const waterProximity = buildingWaterProximity(b);
  const tsy = (wy) => Math.round(wy * tilePx - camY);
  const floorSet = floorSetFor(b);
  for (const s of sections) {
    const fbY = b.y + s.y0 + s.h;
    for (let dx = 0; dx < s.w; dx++) {
      const lx = s.x0 + dx;
      if (floorSet.has(lx + ',' + (s.y0 + s.h))) continue; // south neighbour inside → not a south face
      const ex = tileExtent(b.x + lx, tilePx, camX, 1);
      const groundTop = tsy(fbY) - wH + Math.round(t * WY);
      const colTop = groundTop - (stories - 1) * wH;
      const colH = stories * wH;
      if (ex.dx + ex.dw < 0 || ex.dx > w || colTop + colH < 0 || colTop > h) continue;
      if (colSet && !colSet.has(lx)) continue; // door-only repaint: damage just the door's columns
      paintDamagedColumn(ctx, { dx: ex.dx, top: colTop, dw: ex.dw, colH, tilePx },
        { wx: b.x + lx, wy: fbY }, { biome: b.biome, bx: b.x | 0, by: b.y | 0, material, waterProximity });
    }
  }
}

// D2 SURFACE-GROWTH post-pass — paint procedural moss + lichen over the SAME south-perimeter wall columns,
// AFTER weathering+damage (growth colonises the aged surface). Mechanism A → GL present pass. Honest drivers:
// lichen = stable per-surface random + mild wetness, boosted on stone hosts; moss = wetness (biome + water
// proximity), bottom-weighted, lush only in wet biomes (the sunny south face stays modest).
function drawGrowthPass(ctx, b, camX, camY, tilePx, w, h, colSet) {
  if (!renderOn('growth')) return;
  const fp = b && b.footprint, sections = (fp && fp.sections) || [];
  if (!sections.length) return;
  const t = Math.round(tilePx);
  const wH = Math.round(tilePx * WALL_CONFIG.wallHeight);
  const WY = WALL_CONFIG.wallYOffset;
  const stories = buildingFloors(b);
  const stone = isStoneSlug(materialOf(b) || b.wallSlug || '');
  const waterProximity = buildingWaterProximity(b);
  const tsy = (wy) => Math.round(wy * tilePx - camY);
  const floorSet = floorSetFor(b);
  for (const s of sections) {
    const fbY = b.y + s.y0 + s.h;
    for (let dx = 0; dx < s.w; dx++) {
      const lx = s.x0 + dx;
      if (floorSet.has(lx + ',' + (s.y0 + s.h))) continue; // south neighbour inside → not a south face
      const ex = tileExtent(b.x + lx, tilePx, camX, 1);
      const groundTop = tsy(fbY) - wH + Math.round(t * WY);
      const colTop = groundTop - (stories - 1) * wH;
      const colH = stories * wH;
      if (ex.dx + ex.dw < 0 || ex.dx > w || colTop + colH < 0 || colTop > h) continue;
      if (colSet && !colSet.has(lx)) continue; // door-only repaint: growth just the door's columns
      paintGrowthColumn(ctx, { dx: ex.dx, top: colTop, dw: ex.dw, colH, tilePx },
        { wx: b.x + lx, wy: fbY }, { biome: b.biome, bx: b.x | 0, by: b.y | 0, stone, waterProximity });
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
    if (_roof && renderOn('roof')) { try { _roof.drawRoofForBuilding(o, b, camX, camY, tilePx, { stories: buildingFloors(b), northGapTiles: northGapTiles(b), imageCache: _imageCache, roofTexture: roofTexFor(b), roofFascia: roofFasciaFor(b), gableTex: gableTexFor(b) }); } catch { /* skip roof */ } }
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
  // TILE-CORPUS path: mirror-tiled wall tile per material + aperture overlays, capped by the
  // procedural roof. When the tile set is loaded for this building, draw it + the roof and return.
  ensureRoof();
  // Roof respects its OWN layer flag — the procedural roof rides along with the wall path, so without this
  // gate it would draw even when the roof layer is off (leaking an un-tuned, wall-misaligned roof over the
  // walls). With roof off, walls show clean; we align the roof eaves to the walls when the roof layer is on.
  const drawRoof = () => { if (_roof && renderOn('roof')) { try { _roof.drawRoofForBuilding(ctx, b, camX, camY, tilePx, { stories: buildingFloors(b), northGapTiles: northGapTiles(b), imageCache: _imageCache, roofTexture: roofTexFor(b), roofFascia: roofFasciaFor(b), gableTex: gableTexFor(b) }); } catch { /* skip roof */ } } };
  // D3 wall attachments + the door SWING are NO LONGER baked here — they ANIMATE (banner/sign sway, lantern
  // flicker, door open/close), and a baked-in prop/door FREEZES in the cached sprite. They're drawn LIVE each
  // frame as a per-building depth quad (drawBuildingDynamicInto → glc.drawBuildingPropsSprite) AFTER the building
  // sprites — see canvas-renderer. The bake holds the CLOSED door (so the wall is complete) + static walls/roof.
  // The roof now terminates at the wall top (no south overhang), so wall-mounted props sit cleanly under it.
  // D1 sprite-chips (plank gaps / patches) — gated with the rest of D1 damage; before the roof like the walls.
  const drawChips = () => { if (renderOn('damage')) { try { drawD1Chips(ctx, b, camX, camY, tilePx, w, h); } catch { /* skip chips */ } } };
  // D2 PLACED vines climb the wall — baked here (BEFORE the roof) so the eave occludes the top and the static
  // stem rides the cached sprite. Painted after the D2 coverage growth so ivy sits over moss/lichen.
  const drawVines = () => { if (renderOn('vines')) { try { drawVinePass(ctx, b, camX, camY, tilePx, w, h); } catch { /* skip vines */ } } };
  // D3 awnings bake BEFORE the roof (like vines) so the eave overhangs the door-head canopy and it projects out
  // from UNDERNEATH the roof, not over it (user 2026-06-27). All OTHER props stay on the live dynamic overlay.
  const drawAwnings = () => { if (renderOn('attachments')) { try { drawBakedAwnings(ctx, b, camX, camY, tilePx, w, h); } catch { /* skip awnings */ } } };
  if (drawBuildingTiles(ctx, b, camX, camY, tilePx, w, h)) { if (b) b._wallPath = 'tiles'; drawWeatheringPass(ctx, b, camX, camY, tilePx, w, h); drawDamagePass(ctx, b, camX, camY, tilePx, w, h); drawGrowthPass(ctx, b, camX, camY, tilePx, w, h); drawChips(); drawVines(); drawAwnings(); drawRoof(); return true; }
  // A grassland TILE-CORPUS building whose tiles aren't loaded yet must NOT fall to the legacy
  // strip path — drawWalls would stamp a stone_brick 32px strip STRETCHED over the footprint (the
  // melted/stretched single-building artifact). Stay invisible this frame; it flips to mirror-tiled
  // walls the moment its own tiles finish loading. Only genuinely non-tiled biomes use drawWalls.
  if (isTiledBuilding(b)) { if (b) b._wallPath = 'none'; return false; }
  if (!getWallImg('south_base')) { if (b) b._wallPath = 'none'; return false; } // legacy fallback (assets not loaded yet)
  if (b) b._wallPath = 'legacy';
  drawWalls(ctx, b, camX, camY, tilePx, w, h);
  drawWeatheringPass(ctx, b, camX, camY, tilePx, w, h);
  drawDamagePass(ctx, b, camX, camY, tilePx, w, h);
  drawGrowthPass(ctx, b, camX, camY, tilePx, w, h);
  drawChips();
  drawVines();
  drawAwnings();
  drawRoof();
  return true;
}

// LIVE DYNAMIC BUILDING LAYER — the parts that ANIMATE and so can't live in the frozen cached sprite: the door
// SWING (proximity) + the D3 props (banner/sign sway, lantern flicker; both time-driven). CRITICAL: this renders
// in the cached sprite's OWN cropped local frame at the sprite's `builtTilePx` (localCam = b.{x,y}*builtTilePx −
// {ax,ay}, canvas = the sprite's {w,h}). The caller then draws the returned canvas at the EXACT same screen rect
// as the sprite quad (destX, destY, w·sc, h·sc). So the live open door registers PIXEL-EXACTLY over the baked
// closed door at ANY zoom — drawing at the live tilePx instead let the baked door peek at the door's top/bottom
// once zoom ≠ bake-zoom (the NEAREST scale tradeoff). Returns the shared scratch canvas (re-specified per
// building; upload it before the next call) or null when nothing dynamic this frame.
let _bpCv = null, _bpCx = null;
let _dmCv = null, _dmCx = null; // door-silhouette mask: weather the LIVE door swing to match the baked closed door
// Per-building cache of the WEATHERED LIVE-DOOR layer, keyed by the building anchor + its door-swing sig.
// Re-dressing the door (3 per-pixel weathering/damage/growth passes over the WHOLE façade) is the expensive
// part of the dynamic layer; it's DETERMINISTIC and changes ONLY when a door's discrete frame index steps
// (~8 times across an approach), so bake it once per (building, sig) and reuse it every frame the player holds
// position — instead of repainting the façade at 60Hz, which collapsed FPS to <20 whenever a door was open.
// Props (banner sway / lantern flicker) stay per-frame; they're cheap. Only OPEN-door buildings are ever
// stored, so it stays tiny; a crude cap-clear bounds it as the player roams a town.
const _doorDynCache = new Map(); // "x,y" -> { canvas, sig, w, h }
const _DOOR_DYN_CAP = 96;

// Bound these per-URL / per-coord caches: clear them on every far teleport (scene discontinuity)
// so roaming biomes can't grow them unbounded. _tex holds lazy Images (drop src to free); the
// _doorDynCache holds per-building canvases (just clear).
onSceneDiscontinuity(function () {
  for (const im of _tex.values()) { try { if (im) im.src = ''; } catch (e) {} }
  _tex.clear();
  _doorDynCache.clear();
});

// (Re)bake one building's weathered live door into its OWN canvas (the heavy path — run only on a frame step).
// Returns the canvas, or null if the door asset isn't loaded yet / nothing opened.
function _renderWeatheredDoor(b, localCamX, localCamY, builtTilePx, cw, ch) {
  const dc = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(cw, ch)
    : (typeof document !== 'undefined') ? document.createElement('canvas') : null;
  if (!dc) return null;
  if (dc.width !== cw || dc.height !== ch) { dc.width = cw; dc.height = ch; }
  const o = dc.getContext('2d'); if (!o) return null;
  o.setTransform(1, 0, 0, 1, 0, 0); o.globalCompositeOperation = 'source-over';
  o.clearRect(0, 0, cw, ch); o.imageSmoothingEnabled = false;
  if (!drawDoorsLive(o, b, localCamX, localCamY, builtTilePx, cw, ch)) return null; // asset not loaded → baked closed door shows
  // The baked CLOSED door carries the building's D0/D1/D2 dressing (drawBuildingTextured runs weathering/damage/
  // growth before caching). The live swing is drawn fresh, so without this it would lose that grime and visibly
  // "lighten" the instant it opens. Re-run the SAME passes in the SAME local frame, then mask back to the door
  // silhouette so ONLY the door is tinted. (This is the cost we now amortise across the held-open frames.)
  if (renderOn('weathering') || renderOn('damage') || renderOn('growth')) {
    try {
      if (!_dmCv) { _dmCv = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(cw, ch) : (typeof document !== 'undefined') ? document.createElement('canvas') : null; if (_dmCv) _dmCx = _dmCv.getContext('2d'); }
      if (_dmCv && _dmCx) {
        if (_dmCv.width !== cw || _dmCv.height !== ch) { _dmCv.width = cw; _dmCv.height = ch; }
        _dmCx.setTransform(1, 0, 0, 1, 0, 0); _dmCx.globalCompositeOperation = 'source-over';
        _dmCx.clearRect(0, 0, cw, ch); _dmCx.drawImage(dc, 0, 0); // snapshot the door-only silhouette
        // Only the door's columns can survive the silhouette mask, so grime ONLY those — running the full-façade
        // coverage here (~85ms on a big building) is what tanked FPS while a door was open. A fixed ~6-column span
        // around each door over-covers any door width (the mask trims the rest), so the rebuild cost is CONSTANT
        // (door columns) instead of scaling with building width.
        let colSet = null;
        const doors = b.footprint && b.footprint.doors;
        if (doors && doors.length) { colSet = new Set(); for (const d of doors) { const x0 = d.x | 0; for (let lx = x0 - 2; lx <= x0 + 3; lx++) colSet.add(lx); } }
        drawWeatheringPass(o, b, localCamX, localCamY, builtTilePx, cw, ch, colSet);
        drawDamagePass(o, b, localCamX, localCamY, builtTilePx, cw, ch, colSet);
        drawGrowthPass(o, b, localCamX, localCamY, builtTilePx, cw, ch, colSet);
        o.save(); o.globalCompositeOperation = 'destination-in'; o.drawImage(_dmCv, 0, 0); o.restore();
      }
    } catch { /* dressing the live door is best-effort */ }
  }
  return dc;
}

export function drawBuildingDynamicInto(b, localCamX, localCamY, builtTilePx, cw, ch) {
  const wantWalls = renderOn('walls'), wantProps = renderOn('attachments');
  if ((!wantWalls && !wantProps) || !b || !b.footprint) return null;
  if (!(cw > 0) || !(ch > 0) || cw > 8192 || ch > 8192) return null;
  if (!_bpCv) {
    _bpCv = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(cw, ch)
      : (typeof document !== 'undefined') ? document.createElement('canvas') : null;
    if (!_bpCv) return null;
    _bpCx = _bpCv.getContext('2d');
  }
  if (_bpCv.width !== cw || _bpCv.height !== ch) { _bpCv.width = cw; _bpCv.height = ch; } // resize also clears
  const o = _bpCx; if (!o) return null;
  o.setTransform(1, 0, 0, 1, 0, 0); o.globalCompositeOperation = 'source-over';
  o.clearRect(0, 0, cw, ch); o.imageSmoothingEnabled = false;
  // Render in the sprite's local frame (same camera + builtTilePx the bake used) so draws land exactly where the
  // baked sprite has them — the open door covers the baked closed door, props sit on the same wall pixels.
  let drew = false;
  if (wantWalls) {
    try {
      const sig = doorSwingSig(b); // '' while every door is shut → the baked closed door already shows it
      if (sig) {
        const key = b.x + ',' + b.y;
        let entry = _doorDynCache.get(key);
        if (!entry || entry.sig !== sig || entry.w !== cw || entry.h !== ch) {
          const dc = _renderWeatheredDoor(b, localCamX, localCamY, builtTilePx, cw, ch); // heavy — only on a frame step
          entry = dc ? { canvas: dc, sig, w: cw, h: ch } : null;
          if (entry) {
            if (_doorDynCache.size > _DOOR_DYN_CAP) _doorDynCache.clear(); // crude bound (only open-door blds stored)
            _doorDynCache.set(key, entry);
          } else {
            _doorDynCache.delete(key);
          }
        }
        if (entry) { o.drawImage(entry.canvas, 0, 0); drew = true; } // reuse the cached weathered door (the perf win)
      }
    } catch { /* skip */ }
  }
  if (wantProps) { try { drawD3Props(o, b, localCamX, localCamY, builtTilePx, cw, ch, 'all'); drew = true; } catch { /* skip */ } }
  if (!drew) return null; // nothing dynamic this frame (door closed, props off) → skip the quad
  return _bpCv;
}
