// src/render/building-tiles.js — TILE-CORPUS wall renderer.
//
// Draws a building's SOUTH wall by MIRROR-tiling one base wall-tile per material (base·flip·base·flip…)
// across the footprint width, stacked per storey, with door/window OVERLAYS at the footprint's aperture
// tiles. The base tile (256px = 4 tiles wide × 4 tall @ 64px/tile, native alpha) is never modified, so
// walls are perfectly seamless + consistent. Routes through the same offscreen-canvas → GL scene FBO as
// the old wall path (drawBuildingTextured calls this, then the procedural roof). window._tileWalls flag.

import { WALL_CONFIG } from './wall-config.js';
import { buildingFloors } from './building-shadow.js';

const TILE_ROOT = '/assets/pixelab/buildings/tiles/';
const getDIR = (biome) => TILE_ROOT + (biome || 'grassland') + '/';
// Per-biome tile-material map: a building's world-gen wallSlug → tile-corpus FOLDER name. Desert's world-gen
// slugs differ from the folder names, so this also reconciles them (smooth_adobe→adobe, sandstone_block→
// sandstone, mudbrick_plaster→mudbrick, carved_rock→reed_palm). A biome ABSENT here is not tiled — its
// buildings keep the legacy procedural wall path.
const TILE_MATERIALS = {
  grassland: { timber_frame: 'timber_frame', fieldstone: 'fieldstone', cob: 'cob', wattle_daub: 'wattle_daub' },
  desert: { sandstone_block: 'sandstone', smooth_adobe: 'adobe', mudbrick_plaster: 'mudbrick', carved_rock: 'reed_palm' },
  // Mystic (3rd biome) — world-gen wallSlugs already equal the tile-corpus folder names, so this is an identity map.
  mystic: { moonstone: 'moonstone', starlit_marble: 'starlit_marble', amethyst_ashlar: 'amethyst_ashlar', wardweave_lattice: 'wardweave_lattice' },
  // forest + volcanic (4th/5th) — slugs already match the building-materials.json plan, so identity maps.
  forest: { log_cabin: 'log_cabin', hewn_plank: 'hewn_plank', timber_frame_daub: 'timber_frame_daub', bark_slab: 'bark_slab' },
  volcanic: { basalt_block: 'basalt_block', obsidian_inlay: 'obsidian_inlay', fire_glazed_brick: 'fire_glazed_brick', ashcrete: 'ashcrete' },
  // biomes 6+ (2026-06-24 full sweep) — slugs already match the building-materials.json plan, identity maps.
  mountains: { granite_ashlar: 'granite_ashlar', stacked_slate: 'stacked_slate', timber_rubble: 'timber_rubble', dwarven_cut_stone: 'dwarven_cut_stone' },
  hills: { drystone: 'drystone', limewashed_cottage: 'limewashed_cottage', hillstone_block: 'hillstone_block', slate_hung: 'slate_hung' },
  taiga: { stacked_log: 'stacked_log', pine_plank: 'pine_plank', pitch_sealed_timber: 'pitch_sealed_timber', log_and_daub: 'log_and_daub' },
  dense_forest: { mossy_timber: 'mossy_timber', dark_stained_log: 'dark_stained_log', root_and_earth: 'root_and_earth', deep_bark_plank: 'deep_bark_plank' },
  savanna: { ochre_adobe: 'ochre_adobe', mud_brick_coursed: 'mud_brick_coursed', thorn_wattle: 'thorn_wattle', woven_grass_panel: 'woven_grass_panel' },
  steppe: { rammed_earth: 'rammed_earth', felt_frame: 'felt_frame', sod_brick: 'sod_brick', dry_brick: 'dry_brick' },
  swamp: { weathered_plank: 'weathered_plank', mangrove_log: 'mangrove_log', mud_reed_daub: 'mud_reed_daub', mossy_stilt_frame: 'mossy_stilt_frame' },
  tundra: { turf_block: 'turf_block', whalebone_hide: 'whalebone_hide', stacked_stone: 'stacked_stone', peat_block: 'peat_block' },
  arctic: { ice_block: 'ice_block', packed_snow: 'packed_snow', driftwood_hide: 'driftwood_hide', frozen_timber: 'frozen_timber' },
  tropical_forest: { bamboo: 'bamboo', woven_palm: 'woven_palm', hardwood_plank: 'hardwood_plank', raised_stilt: 'raised_stilt' },
  beach: { coral_block: 'coral_block', bleached_plank: 'bleached_plank', palm_thatch_panel: 'palm_thatch_panel', shell_tabby: 'shell_tabby' },
  river: { river_stone_daub: 'river_stone_daub', tarred_plank: 'tarred_plank', wattle_daub_frame: 'wattle_daub_frame', mossy_millstone: 'mossy_millstone' },
  lake: { log_cabin: 'log_cabin', cedar_board_batten: 'cedar_board_batten', lake_fieldstone: 'lake_fieldstone', stilt_piling: 'stilt_piling' },
  shallow_water: { driftwood_patchwork: 'driftwood_patchwork', woven_reed_panel: 'woven_reed_panel', weathered_boardwalk_plank: 'weathered_boardwalk_plank', wattle_shell_daub: 'wattle_shell_daub' },
  ocean: { tarred_timber_stilt: 'tarred_timber_stilt', rope_lashed_log: 'rope_lashed_log', net_draped_plank: 'net_draped_plank', weathered_shiplap: 'weathered_shiplap' },
  deep_ocean: { barnacled_piling: 'barnacled_piling', riveted_iron_plate: 'riveted_iron_plate', tarred_clinker_hull: 'tarred_clinker_hull', whalebone_frame: 'whalebone_frame' },
};
const BIOME_FALLBACK = {
  grassland: 'fieldstone', desert: 'adobe', mystic: 'moonstone', forest: 'log_cabin', volcanic: 'basalt_block',
  mountains: 'granite_ashlar', hills: 'drystone', taiga: 'stacked_log', dense_forest: 'mossy_timber',
  savanna: 'ochre_adobe', steppe: 'rammed_earth', swamp: 'weathered_plank', tundra: 'turf_block',
  arctic: 'ice_block', tropical_forest: 'bamboo', beach: 'coral_block', river: 'river_stone_daub',
  lake: 'log_cabin', shallow_water: 'driftwood_patchwork', ocean: 'tarred_timber_stilt', deep_ocean: 'barnacled_piling',
};
const _img = new Map();
function img(url) { let im = _img.get(url); if (!im) { im = new Image(); im.src = url; _img.set(url, im); } return (im.complete && im.naturalWidth) ? im : null; }

// Sampled SOLID tones for the opaque wall backfill: the wall mid-tone (central rows) and the foundation
// tone (bottom rows) of a material's base tile. Cached per (biome,material). Filled BEHIND the tiles so any
// residual gap (sub-pixel mirror seam, a holey tile) shows wall colour, never terrain. NEVER the gable.
const _wallTones = new Map();
function wallTones(key, baseImg) {
  let tn = _wallTones.get(key);
  if (tn) return tn;
  try {
    const W = baseImg.naturalWidth, H = baseImg.naturalHeight;
    const c = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(W, H) : document.createElement('canvas');
    c.width = W; c.height = H;
    const cx = c.getContext('2d'); cx.drawImage(baseImg, 0, 0);
    const avg = (y0, y1) => {
      const yy = Math.max(0, Math.round(y0)), hh = Math.max(1, Math.round(y1) - yy);
      const d = cx.getImageData(0, yy, W, hh).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 200) continue; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      return n ? `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})` : 'rgb(48,46,50)';
    };
    tn = { wall: avg(H * 0.30, H * 0.70), foundation: avg(H * 0.86, H) };
  } catch { tn = { wall: 'rgb(56,52,58)', foundation: 'rgb(46,44,50)' }; }
  _wallTones.set(key, tn);
  return tn;
}
const FOUNDATION_FRAC = 0.18; // bottom share of a ground-storey tile occupied by the foundation course

// Animation frames (full wall-with-aperture tiles, one per swing step) generated by animate_object and
// stored at <material>/anim/<kind>/frame_NNN.png. The door PLAYS on player proximity: far = frame 0
// (closed), near = last frame (open). Returns the frame image (or null until that frame loads).
const ANIM_FRAMES = 9;
function animFrame(biome, mat, kind, idx) {
  return img(getDIR(biome) + mat + '/anim/' + kind + '/frame_' + String(idx).padStart(3, '0') + '.png');
}
// 0 (closed, player far) → 1 (open, player at the door). World-tile distance ramp.
function doorOpenAmount(b, d) {
  const p = (typeof window !== 'undefined') && window._player;
  if (!p || typeof p.x !== 'number') return 0;
  const dist = Math.hypot((b.x + d.x + 0.5) - p.x, (b.y + d.y + 0.5) - p.y);
  const R_OPEN = 4.0, R_FULL = 1.5;   // starts opening at 4 tiles, fully open within 1.5
  return Math.max(0, Math.min(1, (R_OPEN - dist) / (R_OPEN - R_FULL)));
}

// Draw one aperture tile (door/window) clipped to its span, keeping its FULL width inside the run (nudge
// inward near a wall end so it's never cut off). Module-level so both the bake (drawBuildingTiles) and the
// live door overlay (drawDoorsLive) share the EXACT same geometry.
function _drawAperture(ctx, tile, cx, top, spanTiles, left, right, t, wH, segW) {
  const clipW = Math.round(spanTiles * t);
  const half = clipW / 2;
  if (left != null && right != null && right - left >= clipW) {
    if (cx - half < left) cx = left + half;          // near the WEST end → nudge east so it fits
    else if (cx + half > right) cx = right - half;   // near the EAST end → nudge west so it fits
  }
  let cl = cx - half, cr = cx + half;
  if (left != null && cl < left) cl = left;
  if (right != null && cr > right) cr = right;
  if (cr <= cl) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(cl, top, cr - cl, wH); ctx.clip();
  ctx.drawImage(tile, 0, 0, tile.naturalWidth, tile.naturalHeight, cx - segW / 2, top, segW, wH);
  ctx.restore();
}

// LIVE DOOR SWING — draw ONLY the open door frame(s) for a building, at proximity, into ctx (which the caller
// has shifted so building screen coords land in a building-local canvas). The cached building sprite bakes the
// door CLOSED; this paints the open swing over it each frame so it animates without re-baking the static sprite.
// Returns true if any door drew OPEN (so the caller can skip an empty quad). Mirrors the door geometry in
// drawBuildingTiles exactly (same runs / groundline / aperture clamp).
export function drawDoorsLive(ctx, b, camX, camY, tilePx, w, h) {
  if (typeof window !== 'undefined' && window._tileWalls === false) return false;
  const bb = b.footprint && b.footprint.boundingBox; if (!bb) return false;
  const mat = materialOf(b); if (!mat) return false;
  const D = getDIR(b.biome);
  const doorTile = img(D + mat + '/ground_door__v0.png'); if (!doorTile) return false; // door material not loaded → leave the baked closed door
  const fp = b.footprint;
  const runs = southRuns(fp); if (!runs.length) return false;
  const t = tilePx;
  const wH = Math.round(t * WALL_CONFIG.wallHeight);
  const WY = WALL_CONFIG.wallYOffset;
  const segW = Math.round(4 * t);
  ctx.imageSmoothingEnabled = false;
  const runGroundY = (y) => Math.round((b.y + y + 1) * t - camY) + Math.round(t * WY);
  const runFor = (ax, ay) => runs.find(r => r.y === ay && ax >= r.x0 && ax < r.x1) || runs[runs.length - 1];
  const runEdges = (r) => ({ left: Math.round((b.x + r.x0) * t - camX), right: Math.round((b.x + r.x1) * t - camX) });
  let anyOpen = false;
  for (const d of (fp.doors || [])) {
    const fi = Math.round(doorOpenAmount(b, d) * (ANIM_FRAMES - 1));
    if (fi <= 0) continue;                                         // closed → the baked sprite already shows it
    const frame = animFrame(b.biome, mat, 'door', fi); if (!frame) continue; // that swing frame not loaded yet
    const r = runFor(d.x, d.y);
    const gY = runGroundY(r.y);
    const { left, right } = runEdges(r);
    _drawAperture(ctx, frame, Math.round((b.x + d.x + 0.5) * t - camX), gY - wH, 2.6, left, right, t, wH, segW);
    anyOpen = true;
  }
  return anyOpen;
}

// Resolve a building to its tile-corpus FOLDER name, or null if its biome isn't tiled (→ legacy wall path).
export function materialOf(b) {
  if (typeof window !== 'undefined' && window._tileMaterial) return window._tileMaterial;
  const map = TILE_MATERIALS[b && b.biome];
  if (!map) return null;
  const s = ((b && b.wallSlug) || '').toLowerCase();
  return map[s] || BIOME_FALLBACK[b.biome] || null;
}
// Tile walls cover the biomes present in TILE_MATERIALS (grassland + desert). Gated by (biome, wallSlug) so
// every other biome keeps its own legacy wall path instead of inheriting grassland tiles.
export function isTiledBuilding(b) {
  if (typeof window !== 'undefined' && window._tileMaterial) return true; // console override forces it
  return !!materialOf(b);
}
export function tileMaterialReady(b) { const m = materialOf(b); return !!(m && img(getDIR(b && b.biome) + m + '/ground_plain__v0.png')); }
// FULL readiness: every tile this building will DRAW is loaded — base + end corners, the upper-storey tile (if
// multi-storey), and the door/window state tiles (only if the footprint HAS doors/windows). The building sprite
// cache gates on this so it never FREEZES a half-loaded (walls-only) bake into a permanent sprite — it re-bakes
// until this returns true. (Optional dressing props are excluded — a 404/absent prop must not block forever.)
export function tileImagesReady(b) {
  const mat = materialOf(b); if (!mat) return false;
  const D = getDIR(b && b.biome);
  const has = (name) => !!img(D + mat + '/' + name);
  if (!has('ground_plain__v0.png')) return false;
  const leftC = has('ground_left_corner__v0.png') || has('left_corner__v0.png');
  const rightC = has('ground_right_corner__v0.png') || has('right_corner__v0.png');
  if (!leftC || !rightC) return false;
  const fp = (b && b.footprint) || {};
  const stories = Math.max(1, buildingFloors(b));
  if (stories > 1 && !has('upper_plain__v0.png')) return false;
  if ((fp.doors || []).length && !has('ground_door__v0.png')) return false;
  if ((fp.windows || []).length) {
    if (!has('ground_window__v0.png')) return false;
    if (stories > 1 && !has('upper_window__v0.png')) return false;
  }
  return true;
}
// The plain-wall + window tiles for this building's material, or null if its biome isn't tiled. The
// dressing socket-index diffs these two (the window is a state OF the plain wall) to measure the opening.
export function windowTilePaths(b) {
  const mat = materialOf(b); if (!mat) return null;
  const D = getDIR(b.biome);
  return { plain: D + mat + '/ground_plain__v0.png', window: D + mat + '/ground_window__v0.png' };
}
export function hasTileWall(b) {
  if (typeof window !== 'undefined' && window._tileWalls === false) return false;
  return isTiledBuilding(b) && tileMaterialReady(b);
}

// Footprint tile set in LOCAL 0-based coords (matching the renderer's b.x+local / footprint.doors[].x
// convention). The building's actual shape lives in footprint.sections (rect/L/T/courtyard/round/...).
function footprintSet(fp) {
  const set = new Set();
  for (const s of (fp.sections || [])) for (let y = s.y0; y < s.y0 + s.h; y++) for (let x = s.x0; x < s.x0 + s.w; x++) set.add(x + ',' + y);
  return set;
}
// SOUTH-FACING perimeter runs: contiguous spans of tiles whose south neighbour is OUTSIDE the footprint.
// Each run is one visible front-wall segment, so the renderer draws the building's TRUE outline (an L/T/
// round building's stepped front) instead of one bounding-box rectangle. Sorted north→south so nearer
// (front) walls draw over farther ones.
export function southRuns(fp) {
  const set = footprintSet(fp);
  const byY = new Map();
  for (const key of set) {
    const c = key.indexOf(','); const x = +key.slice(0, c), y = +key.slice(c + 1);
    if (set.has(x + ',' + (y + 1))) continue;          // tile to the south → interior edge, not a front wall
    if (!byY.has(y)) byY.set(y, []); byY.get(y).push(x);
  }
  const runs = [];
  for (const [y, xs] of byY) {
    xs.sort((a, b) => a - b);
    let s = xs[0], p = xs[0];
    // interiorLeft/Right: a building cell beside the run end (same row) => concave INTERIOR junction
    // (wall continues, must stay solid); absent => TRUE outer edge (grass beyond, keep alpha silhouette).
    const mk = (x0, x1) => ({ y, x0, x1, interiorLeft: set.has((x0 - 1) + ',' + y), interiorRight: set.has(x1 + ',' + y) });
    for (let i = 1; i < xs.length; i++) { if (xs[i] === p + 1) p = xs[i]; else { runs.push(mk(s, p + 1)); s = p = xs[i]; } }
    runs.push(mk(s, p + 1));
  }
  runs.sort((a, b) => a.y - b.y);
  return runs;
}

/** Draw the building's per-section south walls + aperture overlays. Returns true if drawn. */
export function drawBuildingTiles(ctx, b, camX, camY, tilePx, w, h) {
  if (typeof window !== 'undefined' && window._tileWalls === false) return false;
  const bb = b.footprint && b.footprint.boundingBox; if (!bb) return false;
  const mat = materialOf(b); if (!mat) return false;
  const D = getDIR(b.biome);
  const base = img(D + mat + '/ground_plain__v0.png'); if (!base) return false;
  const tones = wallTones(b.biome + '/' + mat, base);
  const upper = img(D + mat + '/upper_plain__v0.png') || base;   // stackable storey (no foundation)
  const leftC = img(D + mat + '/ground_left_corner__v0.png') || img(D + mat + '/left_corner__v0.png');     // flat finished west end (+foundation)
  const rightC = img(D + mat + '/ground_right_corner__v0.png') || img(D + mat + '/right_corner__v0.png');  // flat finished east end (+foundation)
  const upperLeftC = img(D + mat + '/upper_left_corner__v0.png') || leftC;   // upper-storey end (no foundation)
  const upperRightC = img(D + mat + '/upper_right_corner__v0.png') || rightC;
  // PER-MATERIAL apertures: the real generated state tiles (4-tile-wide wall with the aperture baked in),
  // NOT a shared overlay or composited leaf. Door reaches the ground; window sits at its baked height.
  const doorTile = img(D + mat + '/ground_door__v0.png');
  const winTile = img(D + mat + '/ground_window__v0.png');
  // NO fallback to the GROUND window: it carries the foundation stone course, which would flash on the
  // upper floor while the upper tile async-loads (and the aperture is simply skipped until it's ready).
  const upperWinTile = img(D + mat + '/upper_window__v0.png');

  const t = tilePx;
  const wH = Math.round(t * WALL_CONFIG.wallHeight);                 // one storey = 4 tiles
  const WY = WALL_CONFIG.wallYOffset;
  const stories = Math.max(1, buildingFloors(b));
  const segW = Math.round(4 * t);                                   // base tile spans 4 tiles
  if (Math.round((b.x + bb.w) * t - camX) < 0 || Math.round(b.x * t - camX) > w) return true; // off-screen
  const fp = b.footprint;
  const runs = southRuns(fp);                                       // true outline → one wall per front run
  if (!runs.length) return true;
  const runGroundY = (y) => Math.round((b.y + y + 1) * t - camY) + Math.round(t * WY);

  ctx.imageSmoothingEnabled = false;
  // One FRONT-WALL SEGMENT per south-facing run, so L/T/round/courtyard footprints draw their real stepped
  // outline (mirror-tiled wall + finished end corners), not one bounding-box rectangle over empty notches.
  const drawRun = (left, right, groundY, interiorLeft, interiorRight) => {
    for (let st = 0; st < stories; st++) {
      const tile = st === 0 ? base : upper;
      const top = groundY - (st + 1) * wH;
      if (top + wH < 0 || top > h) continue;
      // Only TRUE outer ends get the alpha-trimmed finished corner (its transparent outer edge reveals
      // terrain past the building). An INTERIOR junction (a wing meeting the trunk) must stay solid wall,
      // so there we draw NO corner and let the opaque base run flush to the edge — else terrain shows through.
      const lc = (st === 0 ? leftC : upperLeftC), rc = (st === 0 ? rightC : upperRightC);
      const useLC = !!lc && !interiorLeft;
      const useRC = !!rc && !interiorRight;
      const cw = Math.max(1, Math.min(segW, (right - left) / 2));
      const bL = useLC ? left + cw : left;   // base starts after a real corner; flush at an interior end
      const bR = useRC ? right - cw : right;  // base ends before a real corner; flush at an interior end
      // OPAQUE BACKFILL — behind the base span (flush into interior junctions, inset at true edges so the
      // corner's alpha silhouette is preserved). Catches residual mirror-seam / holey-tile gaps.
      if (bR > bL) {
        ctx.fillStyle = tones.wall;
        ctx.fillRect(bL, top, bR - bL, wH);
        if (st === 0) { const fH = Math.round(wH * FOUNDATION_FRAC); ctx.fillStyle = tones.foundation; ctx.fillRect(bL, top + wH - fH, bR - bL, fH); }
      }
      // SYMMETRIC mirror-tiling (palindrome about the run centre) — unchanged.
      const nSeg = Math.max(1, Math.ceil((bR - bL) / segW));
      const flipAt = (j) => { const m = nSeg - 1 - j; return j <= m ? (j % 2 === 1) : ((m % 2) !== 1); };
      let seg = 0;
      for (let x = bL; x < bR; x += segW) {
        const drawW = Math.min(segW, bR - x);
        ctx.save();
        ctx.beginPath(); ctx.rect(x, top, drawW, wH); ctx.clip();
        if (flipAt(seg)) { ctx.translate(x + segW, top); ctx.scale(-1, 1); ctx.drawImage(tile, 0, 0, tile.naturalWidth, tile.naturalHeight, 0, 0, segW, wH); }
        else { ctx.drawImage(tile, 0, 0, tile.naturalWidth, tile.naturalHeight, x, top, segW, wH); }
        ctx.restore();
        seg++;
      }
      if (useLC) { const sw = lc.naturalWidth * (cw / segW); ctx.drawImage(lc, 0, 0, sw, lc.naturalHeight, left, top, cw, wH); }
      if (useRC) { const sw = rc.naturalWidth * (cw / segW); ctx.drawImage(rc, rc.naturalWidth - sw, 0, sw, rc.naturalHeight, right - cw, top, cw, wH); }
    }
  };
  for (const r of runs) drawRun(Math.round((b.x + r.x0) * t - camX), Math.round((b.x + r.x1) * t - camX), runGroundY(r.y), r.interiorLeft, r.interiorRight);

  // PER-MATERIAL APERTURES — drawn on the run at the aperture's row, at that run's ground line (so apertures
  // sit on the correct stepped wall, not the bbox). Real generated state tiles, clipped to their span.
  const runFor = (ax, ay) => runs.find(r => r.y === ay && ax >= r.x0 && ax < r.x1) || runs[runs.length - 1];
  // Keep an aperture's FULL span inside its run so a door/window on the run's EDGE tile is never CUT OFF
  // (all biomes). When there is room, SHIFT the aperture inward so its whole width fits — entry is forgiving
  // (step onto the footprint), so the small visual shift doesn't affect walking in. Only if the run is too
  // narrow for the full span do we fall back to clamping the clip (tiny buildings). This replaces the old
  // clip-clamp that cut the door off when it landed near the wall end.
  const drawAperture = (tile, cx, top, spanTiles, left, right) => _drawAperture(ctx, tile, cx, top, spanTiles, left, right, t, wH, segW);
  const runEdges = (r) => ({ left: Math.round((b.x + r.x0) * t - camX), right: Math.round((b.x + r.x1) * t - camX) });
  // DOORS — ground storey only. The cached building sprite bakes the door CLOSED (the static door tile); the
  // live swing is painted each frame as a dynamic depth overlay (drawDoorsLive) so it animates WITHOUT re-baking
  // the expensive static sprite. Baking closed keeps the wall complete even if the dynamic overlay is off.
  if (doorTile) for (const d of (fp.doors || [])) {
    const r = runFor(d.x, d.y);
    const gY = runGroundY(r.y);
    const { left, right } = runEdges(r);
    drawAperture(doorTile, Math.round((b.x + d.x + 0.5) * t - camX), gY - wH, 2.6, left, right); // CLOSED; swing = drawDoorsLive
  }
  // WINDOWS — on EVERY storey (stacked in vertical columns at each window x).
  for (const wn of (fp.windows || [])) {
    const r = runFor(wn.x, wn.y);
    const gY = runGroundY(r.y);
    const { left, right } = runEdges(r);
    const cx = Math.round((b.x + wn.x + 0.5) * t - camX);
    for (let st = 0; st < stories; st++) { const wt = st === 0 ? winTile : upperWinTile; if (wt) drawAperture(wt, cx, gY - (st + 1) * wH, 2.0, left, right); }
  }
  return true;
}
