// src/render/building-tile-query.js — Pure building floor query for chunk workers.
// No DOM, no kernel state. Works in both main thread and Web Workers.
// Returns floor material (or null) for any world tile position.

import { rand, mix } from '../../sim/kernel/rng.js';
import { REGION } from '../../sim/lod/aggregate.js';
import { worldEpochs } from '../../sim/chronicle/epochs.js';
import { macroCellPeoples } from '../../sim/chronicle/races.js';
import { regionChronicle, settlementState, chronicleTier } from '../../sim/chronicle/chronicle.js';
import { layoutSettlement } from '../../sim/world/buildings/layout.js';
import { classifyBiome } from '../world/biomes.js';
import { getWorldSeed } from '../core/world-seed.js';

var MACRO = 4;
var MACRO_TILES = MACRO * REGION;  // 64 tiles per side
var WATER = { ocean: 1, deep_ocean: 1, lake: 1, river: 1, shallow_water: 1, stream: 1 };

// ── Caches (pure functions, safe to memoize) ────────────────────────

var _epochCache = null;   // { seed, epochs }
var _layoutCache = new Map();  // macroKey -> { layout, floorIndex } or null

function cachedEpochs(seed) {
  if (_epochCache && _epochCache.seed === seed) return _epochCache.epochs;
  var e = worldEpochs(seed);
  _epochCache = { seed: seed, epochs: e };
  return e;
}

/** Compute layout for a macro-cell. Returns { layout, floorIndex } or null.
 *  floorIndex: Map<"wx,wy" -> { material, tileKind }> for fast tile queries. */
function cachedLayout(seed, mx, my) {
  var mk = mx + ',' + my;
  if (_layoutCache.has(mk)) return _layoutCache.get(mk);

  var cx = mx * MACRO_TILES + Math.floor(MACRO_TILES / 2);
  var cy = my * MACRO_TILES + Math.floor(MACRO_TILES / 2);
  var biome = classifyBiome(cx, cy);
  var epochs = cachedEpochs(seed);
  var peoples = macroCellPeoples(seed, mk, epochs, biome);
  var chronicle = regionChronicle(seed, mk, peoples, biome.climate);
  var state = settlementState(chronicle);

  if (state === 'wilderness' || state === 'ruined') {
    _layoutCache.set(mk, null);
    if (_layoutCache.size > 200) _layoutCache.clear();
    return null;
  }

  // Find site — same logic as genesis.js findSiteInMacro
  var ox = Math.floor((rand(seed, mx * 7 + 1, my * 13 + 2) - 0.5) * MACRO_TILES * 0.5);
  var oy = Math.floor((rand(seed, mx * 11 + 3, my * 17 + 4) - 0.5) * MACRO_TILES * 0.5);
  var siteX = cx + ox, siteY = cy + oy;

  var siteBiome = classifyBiome(siteX, siteY);
  if (WATER[siteBiome.id]) {
    _layoutCache.set(mk, null);
    if (_layoutCache.size > 200) _layoutCache.clear();
    return null;
  }

  var tier = chronicleTier(chronicle, seed, mk);
  var foundingEv = null;
  for (var i = 0; i < chronicle.length; i++) {
    if (chronicle[i].type === 'ancient_founding' || chronicle[i].type === 'founding') {
      foundingEv = chronicle[i]; break;
    }
  }
  var race = foundingEv ? foundingEv.raceId : (peoples[0] ? peoples[0].raceId : 'human');

  var layout;
  try { layout = layoutSettlement(seed, { x: siteX, y: siteY }, tier, race, siteBiome.id); }
  catch (e) {
    _layoutCache.set(mk, null);
    if (_layoutCache.size > 200) _layoutCache.clear();
    return null;
  }

  // Build per-tile floor index from sections (not bounding box)
  var floorIndex = new Map();
  var buildings = layout.buildings;
  var maxB = Math.min(buildings.length, 80);
  for (var bi = 0; bi < maxB; bi++) {
    var b = buildings[bi];
    var fp = b.footprint;
    var mat = (fp.interior && fp.interior.floor && fp.interior.floor.material) || 'wood_plank';
    var sections = fp.sections;
    for (var si = 0; si < sections.length; si++) {
      var sec = sections[si];
      for (var dy = 0; dy < sec.h; dy++) {
        for (var dx = 0; dx < sec.w; dx++) {
          var wx = b.x + sec.x0 + dx;
          var wy = b.y + sec.y0 + dy;
          // Check if this tile is wall, door, or floor
          var lx = wx - b.x, ly = wy - b.y;
          var isWall = false;
          for (var wi = 0; wi < fp.walls.length; wi++) {
            if (fp.walls[wi].x === lx && fp.walls[wi].y === ly) { isWall = true; break; }
          }
          var isDoor = false;
          for (var di = 0; di < fp.doors.length; di++) {
            if (fp.doors[di].x === lx && fp.doors[di].y === ly) { isDoor = true; break; }
          }
          var tileKind = isDoor ? 'door' : isWall ? 'wall' : 'floor';
          floorIndex.set(wx + ',' + wy, { material: mat, tileKind: tileKind });
        }
      }
    }
  }

  // Build wall index: which world tiles have wall sprites hanging below/beside them.
  // Walls are keyed by the floor tile that owns them (the tile at the edge of the building).
  var wallIndex = new Map();
  for (var bi2 = 0; bi2 < maxB; bi2++) {
    var b2 = buildings[bi2];
    var fp2 = b2.footprint;
    var floorSet2 = new Set();
    for (var si2 = 0; si2 < fp2.sections.length; si2++) {
      var sec2 = fp2.sections[si2];
      for (var dy2 = 0; dy2 < sec2.h; dy2++)
        for (var dx2 = 0; dx2 < sec2.w; dx2++)
          floorSet2.add((sec2.x0 + dx2) + ',' + (sec2.y0 + dy2));
    }
    var doorSet2 = new Set();
    for (var di2 = 0; di2 < fp2.doors.length; di2++)
      doorSet2.add(fp2.doors[di2].x + ',' + fp2.doors[di2].y);

    for (var si3 = 0; si3 < fp2.sections.length; si3++) {
      var sec3 = fp2.sections[si3];
      var lastRow = sec3.y0 + sec3.h - 1;

      // ── South wall tiles ──
      // Build window positions for this section
      var windowPos = new Set();
      var interval = 0;
      for (var dx3 = 0; dx3 < sec3.w; dx3++) {
        var slx = sec3.x0 + dx3, sly = lastRow;
        if (floorSet2.has(slx + ',' + (sly + 1))) { interval++; continue; }
        if (doorSet2.has(slx + ',' + sly)) { interval = 0; continue; }
        if (dx3 < 2 || dx3 >= sec3.w - 2) { interval++; continue; }
        if (doorSet2.has((slx - 1) + ',' + sly) || doorSet2.has((slx + 1) + ',' + sly)) { interval++; continue; }
        interval++;
        if (interval % 3 === 0) windowPos.add(slx + ',' + sly);
      }

      for (var dx4 = 0; dx4 < sec3.w; dx4++) {
        var wlx = sec3.x0 + dx4, wly = lastRow;
        if (floorSet2.has(wlx + ',' + (wly + 1))) continue;
        var wwx = b2.x + wlx, wwy = b2.y + wly;
        // Skip if already assigned (right half of a 2-wide sprite)
        if (wallIndex.has(wwx + ',' + wwy)) continue;

        var westOut = !floorSet2.has((wlx - 1) + ',' + wly);
        var eastOut = !floorSet2.has((wlx + 1) + ',' + wly);
        var wKey = wlx + ',' + wly;

        if (westOut) {
          // Corner: base at this tile, corner piece 1 tile outside building
          wallIndex.set(wwx + ',' + wwy, { sprite: 'south_base', edge: 'south', spriteW: 1, half: null });
          wallIndex.set((wwx - 1) + ',' + wwy, { sprite: 'south_corner_west', edge: 'south', spriteW: 1, half: null });
        } else if (eastOut) {
          wallIndex.set(wwx + ',' + wwy, { sprite: 'south_base', edge: 'south', spriteW: 1, half: null });
          wallIndex.set((wwx + 1) + ',' + wwy, { sprite: 'south_corner_east', edge: 'south', spriteW: 1, half: null });
        } else if (doorSet2.has(wKey) && dx4 >= 2 && dx4 < sec3.w - 2) {
          // 2-wide door: LEFT half at this tile, RIGHT half at next tile
          wallIndex.set(wwx + ',' + wwy, { sprite: 'south_door', edge: 'south', spriteW: 2, half: 'left' });
          wallIndex.set((wwx + 1) + ',' + wwy, { sprite: 'south_door', edge: 'south', spriteW: 2, half: 'right' });
        } else if (windowPos.has(wKey) && dx4 >= 2 && dx4 < sec3.w - 2) {
          // 2-wide window: LEFT half at this tile, RIGHT half at next tile
          wallIndex.set(wwx + ',' + wwy, { sprite: 'south_window', edge: 'south', spriteW: 2, half: 'left' });
          wallIndex.set((wwx + 1) + ',' + wwy, { sprite: 'south_window', edge: 'south', spriteW: 2, half: 'right' });
        } else {
          wallIndex.set(wwx + ',' + wwy, { sprite: 'south_base', edge: 'south', spriteW: 1, half: null });
        }
      }

      // ── North wall tiles ──
      var northRow = sec3.y0;
      for (var dx5 = 0; dx5 < sec3.w; dx5++) {
        var nlx = sec3.x0 + dx5, nly = northRow;
        if (floorSet2.has(nlx + ',' + (nly - 1))) continue;
        var nwx = b2.x + nlx, nwy = b2.y + nly;
        var nWestOut = !floorSet2.has((nlx - 1) + ',' + nly);
        var nEastOut = !floorSet2.has((nlx + 1) + ',' + nly);

        // North walls with corner extension
        var nKey = nwx + ',' + nwy;
        if (!wallIndex.has(nKey)) {
          if (nWestOut) {
            wallIndex.set(nKey, { sprite: 'south_base', edge: 'north', spriteW: 1 });
            var nwKey = (nwx - 1) + ',' + nwy;
            if (!wallIndex.has(nwKey)) wallIndex.set(nwKey, { sprite: 'south_corner_west', edge: 'north', spriteW: 1 });
          } else if (nEastOut) {
            wallIndex.set(nKey, { sprite: 'south_base', edge: 'north', spriteW: 1 });
            var neKey = (nwx + 1) + ',' + nwy;
            if (!wallIndex.has(neKey)) wallIndex.set(neKey, { sprite: 'south_corner_east', edge: 'north', spriteW: 1 });
          } else {
            wallIndex.set(nKey, { sprite: 'south_base', edge: 'north', spriteW: 1 });
          }
        }
      }

      // ── East/West edge tiles ──
      for (var dy3 = 0; dy3 < sec3.h; dy3++) {
        // East edge
        var elx = sec3.x0 + sec3.w, ely = sec3.y0 + dy3;
        if (!floorSet2.has(elx + ',' + ely)) {
          var ewx = b2.x + elx, ewy = b2.y + ely;
          var eKey = ewx + ',' + ewy;
          if (!wallIndex.has(eKey)) {
            wallIndex.set(eKey, { sprite: 'edge_ew', edge: 'east', spriteW: 1 });
          }
        }
        // West edge
        var wlx2 = sec3.x0 - 1, wly2 = sec3.y0 + dy3;
        if (!floorSet2.has(wlx2 + ',' + wly2)) {
          var wwx2 = b2.x + wlx2, wwy2 = b2.y + wly2;
          var wKey2 = wwx2 + ',' + wwy2;
          if (!wallIndex.has(wKey2)) {
            wallIndex.set(wKey2, { sprite: 'edge_ew', edge: 'west', spriteW: 1 });
          }
        }
      }
    }
  }

  var result = { layout: layout, floorIndex: floorIndex, wallIndex: wallIndex };
  _layoutCache.set(mk, result);
  if (_layoutCache.size > 200) _layoutCache.clear();
  return result;
}

/**
 * Get all buildings near a chunk (for the wall post-pass).
 * Returns an array of building objects from layoutSettlement.
 */
export function getBuildingsNearChunk(chunkCX, chunkCY, chunkSize) {
  var seed = getWorldSeed();
  var x0 = chunkCX * chunkSize, y0 = chunkCY * chunkSize;
  var mx0 = Math.floor(x0 / MACRO_TILES) - 1;
  var my0 = Math.floor(y0 / MACRO_TILES) - 1;
  var buildings = [];
  for (var dmy = 0; dmy <= 2; dmy++) {
    for (var dmx = 0; dmx <= 2; dmx++) {
      var entry = cachedLayout(seed, mx0 + dmx, my0 + dmy);
      if (entry && entry.layout && entry.layout.buildings) {
        for (var i = 0; i < entry.layout.buildings.length; i++) {
          buildings.push(entry.layout.buildings[i]);
        }
      }
    }
  }
  return buildings;
}

/**
 * Query whether a world tile (wx, wy) is inside a building.
 * Returns { material, tileKind } or null.
 * Pure f(seed, wx, wy) — safe for workers.
 */
export function queryBuildingTile(wx, wy) {
  var seed = getWorldSeed();
  // Determine which macro-cell this tile belongs to
  var mx = Math.floor(wx / MACRO_TILES);
  var my = Math.floor(wy / MACRO_TILES);

  // Check this macro-cell and neighbors (buildings near edges can cross boundaries)
  for (var dmy = -1; dmy <= 1; dmy++) {
    for (var dmx = -1; dmx <= 1; dmx++) {
      var entry = cachedLayout(seed, mx + dmx, my + dmy);
      if (!entry) continue;
      var hit = entry.floorIndex.get(wx + ',' + wy);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Query whether a world tile (wx, wy) should have a wall sprite drawn.
 * Returns { sprite, edge, spriteW } or null.
 *   sprite: 'south_base' | 'south_window' | 'south_door' | 'south_corner_west' |
 *           'south_corner_east' | 'edge_ew'
 *   edge:   'south' | 'north' | 'east' | 'west'
 *   spriteW: width in tiles (1 or 2 for door/window)
 * Pure f(seed, wx, wy) — safe for workers.
 */
export function queryBuildingWall(wx, wy) {
  var seed = getWorldSeed();
  var mx = Math.floor(wx / MACRO_TILES);
  var my = Math.floor(wy / MACRO_TILES);

  for (var dmy = -1; dmy <= 1; dmy++) {
    for (var dmx = -1; dmx <= 1; dmx++) {
      var entry = cachedLayout(seed, mx + dmx, my + dmy);
      if (!entry) continue;
      var hit = entry.wallIndex.get(wx + ',' + wy);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Check if a world tile is claimed by any building (including margin).
 * Used to suppress F3 scatter on building footprints.
 */
var CLAIM_MARGIN = 2;

export function isBuildingClaimed(wx, wy) {
  var seed = getWorldSeed();
  var mx = Math.floor(wx / MACRO_TILES);
  var my = Math.floor(wy / MACRO_TILES);

  for (var dmy = -1; dmy <= 1; dmy++) {
    for (var dmx = -1; dmx <= 1; dmx++) {
      var entry = cachedLayout(seed, mx + dmx, my + dmy);
      if (!entry) continue;
      // Check floor tiles with margin
      for (var cdy = -CLAIM_MARGIN; cdy <= CLAIM_MARGIN; cdy++) {
        for (var cdx = -CLAIM_MARGIN; cdx <= CLAIM_MARGIN; cdx++) {
          if (entry.floorIndex.has((wx + cdx) + ',' + (wy + cdy))) return true;
        }
      }
      // Check wall tiles (including corners that extend outside building)
      if (entry.wallIndex.has(wx + ',' + wy)) return true;
      // North wall extends upward — suppress F2/F3 for 4 tiles above any north wall tile
      for (var nUp = 1; nUp <= 4; nUp++) {
        var belowKey = wx + ',' + (wy + nUp);
        var belowHit = entry.wallIndex.get(belowKey);
        if (belowHit && belowHit.edge === 'north') return true;
      }
    }
  }
  return false;
}

// ── Floor tile URLs for worker preloading ────────────────────────────

// Solid interior tile per material — no transition edges.
// wang_7 for wood_plank is user-confirmed good.
// wang_7 for all materials: these are solid interior tiles in PixelLab's
// wang scheme (mask 7 = NW+NE+SW corners all "upper" biome = full interior).
var FLOOR_TILE_MAP = {
  wood_plank:  '/assets/pixelab/buildings/floors/wood_plank/wood_plank__wang_7.png',
  stone_slab:  '/assets/pixelab/buildings/floors/stone_slab/stone_slab__wang_7.png',
  marble:      '/assets/pixelab/buildings/floors/marble_white/marble_white__wang_7.png',
  packed_dirt: '/assets/pixelab/buildings/floors/packed_dirt/packed_dirt__wang_7.png',
  terracotta:  '/assets/pixelab/buildings/floors/terracotta/terracotta__wang_7.png',
};

// Aliases: materials without their own art reuse another material's tile
var FLOOR_ALIASES = {
  marble_white: 'marble',
  tile_ceramic: 'terracotta',
  cobblestone: 'stone_slab',
  stone_slab_grey: 'stone_slab',
  wood_plank_light: 'wood_plank',
  wood_plank_dark: 'wood_plank',
  reed_mat: 'packed_dirt',
  carpet_wool: 'wood_plank',
  carpet_silk: 'wood_plank',
  crystal_slab: 'stone_slab',
  volcanic_stone: 'stone_slab',
  moss_carpet: 'packed_dirt',
  living_wood: 'wood_plank',
  carved_stone: 'stone_slab',
  sand_tile: 'packed_dirt',
  ice_floor: 'stone_slab',
  driftwood: 'wood_plank',
};

/** Resolve material id to the floor tile URL. */
export function floorTileUrl(material) {
  var url = FLOOR_TILE_MAP[material];
  if (url) return url;
  var alias = FLOOR_ALIASES[material];
  if (alias) return FLOOR_TILE_MAP[alias] || FLOOR_TILE_MAP.wood_plank;
  return FLOOR_TILE_MAP.wood_plank;  // fallback
}

// ── Wall tile URL map ───────────────────────────────────────────────
var WALL_TILE_BASE = '/assets/pixelab/buildings/walls/stone_brick_tiles/';
var WALL_SPRITE_MAP = {
  south_base:         WALL_TILE_BASE + 'south_base.png',         // 32x128
  south_window:       WALL_TILE_BASE + 'south_window.png',       // 64x128
  south_door:         WALL_TILE_BASE + 'south_door.png',         // 64x128
  south_corner_west:  WALL_TILE_BASE + 'south_corner_west.png',  // 32x128
  south_corner_east:  WALL_TILE_BASE + 'south_corner_east.png',  // 32x128
  edge_ew:            WALL_TILE_BASE + 'edge_ew.png',            // 32x32
};

// Source dimensions for each wall sprite (width x height in pixels)
var WALL_SPRITE_SRC = {
  south_base:        { w: 32,  h: 128 },
  south_window:      { w: 64,  h: 128 },
  south_door:        { w: 64,  h: 128 },
  south_corner_west: { w: 32,  h: 128 },
  south_corner_east: { w: 32,  h: 128 },
  edge_ew:           { w: 32,  h: 32  },
};

/** Resolve wall sprite name to URL. */
export function wallTileUrl(spriteName) {
  return WALL_SPRITE_MAP[spriteName] || WALL_SPRITE_MAP.south_base;
}

/** Get source dimensions for a wall sprite. */
export function wallSpriteSrc(spriteName) {
  return WALL_SPRITE_SRC[spriteName] || WALL_SPRITE_SRC.south_base;
}

/** All floor tile URLs for preloading. */
export function getAllFloorTileURLs() {
  var urls = [];
  for (var mat in FLOOR_TILE_MAP) {
    urls.push(FLOOR_TILE_MAP[mat]);
  }
  // Building wall cliff tiles (wang 0-15)
  for (var i = 0; i <= 15; i++) {
    urls.push('/assets/pixelab/buildings/wall_cliff_stone/wall_cliff_stone__wang_' + i + '.png');
  }
  // Wall face sprites (old path, kept for backward compat)
  urls.push('/assets/pixelab/buildings/walls/stone_brick/wall_plain.png');
  urls.push('/assets/pixelab/buildings/walls/stone_brick/wall_window.png');
  urls.push('/assets/pixelab/buildings/walls/stone_brick/wall_door.png');
  // Wall tile sprites (stone_brick_tiles — used by chunk pipeline)
  var WALL_BASE = '/assets/pixelab/buildings/walls/stone_brick_tiles/';
  urls.push(WALL_BASE + 'south_base.png');
  urls.push(WALL_BASE + 'south_window.png');
  urls.push(WALL_BASE + 'south_door.png');
  urls.push(WALL_BASE + 'south_corner_west.png');
  urls.push(WALL_BASE + 'south_corner_east.png');
  urls.push(WALL_BASE + 'edge_ew.png');
  return urls;
}
