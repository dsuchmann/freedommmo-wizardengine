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

  var result = { layout: layout, floorIndex: floorIndex };
  _layoutCache.set(mk, result);
  if (_layoutCache.size > 200) _layoutCache.clear();
  return result;
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
      // Check with margin
      for (var cdy = -CLAIM_MARGIN; cdy <= CLAIM_MARGIN; cdy++) {
        for (var cdx = -CLAIM_MARGIN; cdx <= CLAIM_MARGIN; cdx++) {
          if (entry.floorIndex.has((wx + cdx) + ',' + (wy + cdy))) return true;
        }
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

/** All floor tile URLs for preloading. */
export function getAllFloorTileURLs() {
  var urls = [];
  for (var mat in FLOOR_TILE_MAP) {
    urls.push(FLOOR_TILE_MAP[mat]);
  }
  // Building wall cliff tiles (wang 1-14 numbered)
  for (var i = 1; i <= 14; i++) {
    urls.push('/assets/pixelab/buildings/wall_cliff_stone/wall_cliff_stone__wang_' + i + '.png');
  }
  return urls;
}
