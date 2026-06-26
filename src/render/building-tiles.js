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
// STATIC-DOOR BAKE MODE: the building sprite cache bakes each building's silhouette ONCE and never rebuilds
// (perf: no per-frame full-screen repaint). A proximity door swing is per-frame, so it MUST NOT bake into that
// static sprite — it would freeze at the bake-time frame (closed, since the building is first seen far away).
// So the cache wraps its bake in setStaticDoorBake(true): the door bakes CLOSED, and the live frame is drawn
// separately on top each frame as its own GL sprite (building-door-overlay.js). The non-cached A/B paths
// (building-layer / building-depth direct calls) leave this false and keep their inline per-frame door swing.
let _staticDoorBake = false;
export function setStaticDoorBake(on) { _staticDoorBake = !!on; }
// Live door swing frame index [0..ANIM_FRAMES-1] for door `d` of building `b`. 0 in static-bake mode (closed)
// or when the player position is unknown. Exported pure so the door-overlay + tests share ONE definition.
export function doorFrameIndex(b, d) {
  if (_staticDoorBake) return 0;
  return Math.round(doorOpenAmount(b, d) * (ANIM_FRAMES - 1));
}
// Clamp an aperture's [cx±half] span inside the run [left,right] — SHIFT inward when there's room, else clip.
// Pure: the single source of truth for door/window placement, shared by drawAperture (bake) AND doorAnimRects
// (the live door-overlay sprite), so the overlay lands EXACTLY where the baked closed door was. Returns the
// final centre + the clipped visible edges {cx, cl, cr} (cr<=cl ⇒ nothing visible).
export function aperturePlacement(cx, clipW, left, right) {
  const half = clipW / 2;
  if (left != null && right != null && right - left >= clipW) {
    if (cx - half < left) cx = left + half;
    else if (cx + half > right) cx = right - half;
  }
  let cl = cx - half, cr = cx + half;
  if (left != null && cl < left) cl = left;
  if (right != null && cr > right) cr = right;
  return { cx, cl, cr };
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
// FULL readiness: every tile this building will actually DRAW is loaded — base + end corners, the upper-storey
// tile (if multi-storey), and the door/window state tiles (only if the footprint HAS doors/windows). Mirrors
// the img() lookups in drawBuildingTiles so it can't disagree. The building sprite cache gates on this: it must
// NOT freeze a half-loaded bake (walls before the windows/doors/roof finish async-loading) into a permanent
// walls-only sprite — it re-bakes until this returns true. (Optional dressing PROPS are intentionally excluded:
// a 404/absent prop variant must not block the structural bake forever.)
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
    for (let i = 1; i < xs.length; i++) { if (xs[i] === p + 1) p = xs[i]; else { runs.push({ y, x0: s, x1: p + 1 }); s = p = xs[i]; } }
    runs.push({ y, x0: s, x1: p + 1 });
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
  const fpSet = footprintSet(fp);                                   // membership test: a run-end abutting ANOTHER footprint tile is an internal junction (tile seamlessly), not a real building edge (finished corner)
  const fpMinY = (fp.sections && fp.sections.length) ? Math.min(...fp.sections.map((s) => s.y0)) : 0;
  // A run-end is a REAL building edge (→ finished, alpha-trimmed corner) only if the column just OUTSIDE it has
  // NO footprint tile at the run's row OR ANY row NORTH of it. At a +/T/L junction the flanking section sits at a
  // DIFFERENT (higher) row, so a same-row check misses it and the transparent corner reveals terrain = a "pillar
  // not connected" seam. Walking up to fpMinY catches it → use the plain base there so the wall connects. (user 2026-06-25)
  const wallContinues = (col, y) => { for (let yy = fpMinY; yy <= y; yy++) if (fpSet.has(col + ',' + yy)) return true; return false; };
  const runGroundY = (y) => Math.round((b.y + y + 1) * t - camY) + Math.round(t * WY);

  ctx.imageSmoothingEnabled = false;
  // One FRONT-WALL SEGMENT per south-facing run, so L/T/round/courtyard footprints draw their real stepped
  // outline (mirror-tiled wall + finished end corners), not one bounding-box rectangle over empty notches.
  const drawRun = (left, right, groundY, leftEdge, rightEdge) => {
    for (let st = 0; st < stories; st++) {
      const tile = st === 0 ? base : upper;
      const top = groundY - (st + 1) * wH;
      if (top + wH < 0 || top > h) continue;
      // FINISHED END CORNERS provide the wall at the run's ends; the mirror-tiled BASE fills ONLY the gap
      // between them. CRUCIAL: the corner tile's OUTER edge is alpha-trimmed (transparent, so the world's
      // terrain shows past the building edge instead of a black outline). If the base wall were drawn UNDER
      // the corner, that opaque base would bleed through the corner's transparent edge (the "other texture
      // behind the column edge" bug). So inset the base by the corner width on each capped end.
      // Finished END corner ONLY where the run-end is a REAL building edge (abuts landscape). At an INTERNAL
      // junction (a +/T/L footprint where this run-end meets another section), the corner's alpha-trimmed outer
      // edge would reveal terrain = a "disconnected pillar" seam — so use NO corner there and let the plain base
      // tile fill flush to the boundary, connecting seamlessly into the adjacent section. (user 2026-06-25)
      const lc = leftEdge ? (st === 0 ? leftC : upperLeftC) : null;
      const rc = rightEdge ? (st === 0 ? rightC : upperRightC) : null;
      const cw = Math.max(1, Math.min(segW, (right - left) / 2));
      const bL = lc ? left + cw : left;   // base starts after the left corner
      const bR = rc ? right - cw : right;  // base ends before the right corner
      // SYMMETRIC mirror-tiling: the per-segment flip is a PALINDROME about the run centre, so the wall reads
      // the same left↔right and its mirror-join "studs" land the same distance from each end (beside BOTH
      // flanking windows, not just one). Condition f(j) = !f(nSeg-1-j): even seg counts already alternate
      // symmetrically (NFNF); odd counts pivot on a centre tile (the building's centreline).
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
      // ground storey carries the foundation; upper storeys don't. Corner art scaled to cw; its OUTER edge
      // lands exactly at the run edge (left / right) so its alpha-trimmed outline reveals terrain.
      if (lc) { const sw = lc.naturalWidth * (cw / segW); ctx.drawImage(lc, 0, 0, sw, lc.naturalHeight, left, top, cw, wH); }
      if (rc) { const sw = rc.naturalWidth * (cw / segW); ctx.drawImage(rc, rc.naturalWidth - sw, 0, sw, rc.naturalHeight, right - cw, top, cw, wH); }
    }
  };
  for (const r of runs) {
    // A run covers tiles x0..x1-1; its WEST neighbour is x0-1, its EAST neighbour is x1. If that neighbour tile
    // is in the footprint, this end butts another section (internal junction → plain wall); else it's a real edge.
    const leftEdge = !wallContinues(r.x0 - 1, r.y);
    const rightEdge = !wallContinues(r.x1, r.y);
    drawRun(Math.round((b.x + r.x0) * t - camX), Math.round((b.x + r.x1) * t - camX), runGroundY(r.y), leftEdge, rightEdge);
  }

  // PER-MATERIAL APERTURES — drawn on the run at the aperture's row, at that run's ground line (so apertures
  // sit on the correct stepped wall, not the bbox). Real generated state tiles, clipped to their span.
  const runFor = (ax, ay) => runs.find(r => r.y === ay && ax >= r.x0 && ax < r.x1) || runs[runs.length - 1];
  // Keep an aperture's FULL span inside its run so a door/window on the run's EDGE tile is never CUT OFF
  // (all biomes). When there is room, SHIFT the aperture inward so its whole width fits — entry is forgiving
  // (step onto the footprint), so the small visual shift doesn't affect walking in. Only if the run is too
  // narrow for the full span do we fall back to clamping the clip (tiny buildings). This replaces the old
  // clip-clamp that cut the door off when it landed near the wall end.
  const drawAperture = (tile, cx, top, spanTiles, left, right) => {
    const clipW = Math.round(spanTiles * t);
    const p = aperturePlacement(cx, clipW, left, right);
    if (p.cr <= p.cl) return;
    ctx.save();
    ctx.beginPath(); ctx.rect(p.cl, top, p.cr - p.cl, wH); ctx.clip();
    ctx.drawImage(tile, 0, 0, tile.naturalWidth, tile.naturalHeight, p.cx - segW / 2, top, segW, wH);
    ctx.restore();
  };
  const runEdges = (r) => ({ left: Math.round((b.x + r.x0) * t - camX), right: Math.round((b.x + r.x1) * t - camX) });
  // DOORS — ground storey only. PROXIMITY DOOR ANIMATION: swing frame from player distance; fall back to
  // the closed static tile until that frame loads (frame 0 == closed == static tile).
  if (doorTile) for (const d of (fp.doors || [])) {
    const r = runFor(d.x, d.y);
    const gY = runGroundY(r.y);
    const { left, right } = runEdges(r);
    const fi = doorFrameIndex(b, d);                    // 0 (closed) in static-bake mode → overlay animates on top
    const frame = (fi > 0 && animFrame(b.biome, mat, 'door', fi)) || doorTile;
    drawAperture(frame, Math.round((b.x + d.x + 0.5) * t - camX), gY - wH, 2.6, left, right); // door span ~2.5 tiles, clamped to the run
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

// LIVE DOOR-OVERLAY rects — the per-door geometry the door-overlay sprite (building-door-overlay.js) needs to
// draw the CURRENT swing frame on top of the cached (closed-door) static building. Mirrors the door block above
// + the drawAperture clamp EXACTLY (via the shared aperturePlacement) so the overlay registers on the baked
// door. Returns [] when not a tiled building, it has no doors, the base/frame isn't loaded yet, or every door
// is CLOSED (fi==0 ⇒ the baked closed door already reads → no overlay). Each entry is in SCREEN px at the
// current camera/zoom: { idx, fi, img, cl, cr, top, wH, srcX, srcW, srcH }.
export function doorAnimRects(b, camX, camY, tilePx) {
  const fp = b && b.footprint; if (!fp || !(fp.doors && fp.doors.length)) return [];
  const mat = materialOf(b); if (!mat) return [];
  const D = getDIR(b.biome);
  if (!img(D + mat + '/ground_door__v0.png')) return [];           // base door tile not loaded → nothing to overlay yet
  const t = tilePx;
  const wH = Math.round(t * WALL_CONFIG.wallHeight);
  const WY = WALL_CONFIG.wallYOffset;
  const segW = Math.round(4 * t);
  const runs = southRuns(fp); if (!runs.length) return [];
  const runFor = (ax, ay) => runs.find(r => r.y === ay && ax >= r.x0 && ax < r.x1) || runs[runs.length - 1];
  const out = [];
  let di = 0;
  for (const d of fp.doors) {
    const idx = di++;
    const fi = doorFrameIndex(b, d);
    if (fi <= 0) continue;                                          // closed → baked door reads; no overlay
    const frame = animFrame(b.biome, mat, 'door', fi); if (!frame) continue; // that frame not loaded → baked closed door shows
    const r = runFor(d.x, d.y);
    const gY = Math.round((b.y + r.y + 1) * t - camY) + Math.round(t * WY);
    const left = Math.round((b.x + r.x0) * t - camX), right = Math.round((b.x + r.x1) * t - camX);
    const cx0 = Math.round((b.x + d.x + 0.5) * t - camX);
    const p = aperturePlacement(cx0, Math.round(2.6 * t), left, right);
    if (p.cr <= p.cl) continue;
    const destX0 = p.cx - segW / 2;                                 // where the full 4-tile frame would be drawn
    const iw = frame.naturalWidth, ih = frame.naturalHeight;
    out.push({
      idx, fi, img: frame, cl: p.cl, cr: p.cr, top: gY - wH, wH,
      srcX: (p.cl - destX0) / segW * iw,                            // sub-rect of the frame revealed by the clip [cl..cr]
      srcW: (p.cr - p.cl) / segW * iw, srcH: ih,
    });
  }
  return out;
}
