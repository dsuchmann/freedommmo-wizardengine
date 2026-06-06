import { rand2, smoothNoise } from '../core/random.js';
import { paletteFor } from './palette.js';
import { cliffLevel } from '../world/terrain-shaper.js';

var WANG_SUFFIX = '__v000.png';
var TRANSITIONS_BASE = 'assets/pixelab/landscape_v2/transitions/';
var wangImgCache = {};

// Wang tile lookup: corner mask → tile index (0-15)
var CLIFF_CORNER_TO_WANG = [15,14,13,12,11,10,9,8,7,6,5,4,3,2,1,0];

// Mapping from biome to cliff Wang tileset directory
var BIOME_CLIFF = {
  beach: 'beach_cliff',
  desert: 'sand_cliff',
  grassland: 'grass_cliff',
  forest: 'forest_cliff',
  dense_forest: 'forest_cliff',
  tropical_forest: 'forest_cliff',
  taiga: 'snow_cliff',
  savanna: 'savanna_cliff',
  steppe: 'steppe_cliff',
  swamp: 'swamp_cliff',
  tundra: 'tundra_cliff',
  arctic: 'snow_cliff',
  hills: 'hills_cliff',
  mountains: 'stone_cliff',
  volcanic: 'volcanic_cliff',
  mystic: 'mystic_cliff',
  ocean: 'cliff_overlay',
  deep_ocean: 'cliff_overlay',
  shallow_water: 'cliff_overlay',
  river: 'cliff_overlay',
  lake: 'cliff_overlay',
};

export function preloadWangImage(src) {
  var img = new Image();
  img.src = src;
  wangImgCache[src] = img;
}

// Interior tiles source from transition directories.
// wang 6 = left/first biome interior, wang 12 = right/second biome interior.
// Interior tile sources — chosen to match the most natural look for each biome.
// PixelLab: wang_0 = all lower biome, wang_15 = all upper biome.
var BIOME_INTERIOR = {
  beach:         { dir: 'beach_to_river',          mask: 0 },
  desert:        { dir: 'beach_to_desert',         mask: 15 },
  grassland:     { dir: 'forest_to_grassland',     mask: 15 },
  river:         { dir: 'beach_to_river',          mask: 15 },
  swamp:         { dir: 'forest_to_swamp',         mask: 15 },
  forest:        { dir: 'forest_to_grassland',     mask: 0 },
  dense_forest:  { dir: 'dense_forest_to_forest',  mask: 0 },
  tropical_forest:{ dir: 'forest_to_tropical_forest', mask: 15 },
  taiga:         { dir: 'forest_to_taiga',         mask: 15 },
  savanna:       { dir: 'grassland_to_savanna',    mask: 15 },
  steppe:        { dir: 'grassland_to_steppe',     mask: 15 },
  tundra:        { dir: 'arctic_to_tundra',         mask: 15 },
  arctic:        { dir: 'arctic_to_tundra',         mask: 0 },
  hills:         { dir: 'grassland_to_hills',      mask: 15 },
  mountains:     { dir: 'hills_to_mountains',      mask: 15 },
  volcanic:      { dir: 'desert_to_volcanic',      mask: 15 },
  mystic:        { dir: 'grassland_to_mystic',     mask: 15 },
  ocean:         { dir: 'deep_ocean_to_ocean',     mask: 15 },
  deep_ocean:    { dir: 'deep_ocean_to_ocean',     mask: 0 },
  shallow_water: { dir: 'ocean_to_shallow_water',  mask: 15 },
  lake:          { dir: 'lake_to_river',           mask: 0 },
};

// Preload interior tiles for all biomes
for (var b in BIOME_INTERIOR) {
  var ie = BIOME_INTERIOR[b];
  for (var pm = 0; pm < 16; pm++) {
    preloadWangImage(TRANSITIONS_BASE + ie.dir + '/wang/' + ie.dir + '__wang_' + pm + WANG_SUFFIX);
  }
}
// Preload remaining transition dirs not covered by interior sources
var EXTRA_TRANSITION_DIRS = [
  'beach_to_desert','beach_to_grassland','beach_to_forest','beach_to_hills',
  'dense_forest_to_mystic','dense_forest_to_tropical_forest',
  'desert_to_hills','desert_to_savanna',
  'forest_to_dense_forest','forest_to_hills',
  'forest_to_mystic','forest_to_savanna','forest_to_taiga','forest_to_tropical_forest',
  'grassland_to_desert','grassland_to_forest','grassland_to_hills','grassland_to_mystic',
  'grassland_to_savanna','grassland_to_steppe','grassland_to_taiga',
  'hills_to_mountains','hills_to_volcanic',
  'lake_to_forest','lake_to_grassland','lake_to_river','lake_to_shallow_water','lake_to_swamp',
  'mountains_to_snow','mountains_to_volcanic',
  'ocean_to_beach','ocean_to_shallow_water',
  'river_to_forest','river_to_grassland','river_to_hills','river_to_swamp',
  'savanna_to_hills','savanna_to_steppe',
  'shallow_water_to_beach','shallow_water_to_river','shallow_water_to_swamp',
  'steppe_to_desert','steppe_to_hills',
  'swamp_to_beach','swamp_to_dense_forest','swamp_to_forest','swamp_to_grass',
  'swamp_to_taiga','swamp_to_tropical_forest',
  'taiga_to_hills','taiga_to_mountains',
  'tropical_forest_to_mystic',
  'tundra_to_hills','tundra_to_mountains','tundra_to_snow','tundra_to_steppe','tundra_to_taiga'
];
for (var ei = 0; ei < EXTRA_TRANSITION_DIRS.length; ei++) {
  var ed = EXTRA_TRANSITION_DIRS[ei];
  for (var em = 0; em < 16; em++) {
    preloadWangImage(TRANSITIONS_BASE + ed + '/wang/' + ed + '__wang_' + em + WANG_SUFFIX);
  }
}
// Preload all cliff Wang tiles
var cliffSeen = {};
for (var bk in BIOME_CLIFF) {
  var cd = BIOME_CLIFF[bk];
  if (cliffSeen[cd]) continue;
  cliffSeen[cd] = true;
  for (var cm = 0; cm < 16; cm++) {
    preloadWangImage(TRANSITIONS_BASE + cd + '/wang/' + cd + '__wang_' + cm + WANG_SUFFIX);
  }
}

// Water biomes — excluded from cliff rendering, treated as flat level 0
var WATER_BIOMES = { ocean: 1, deep_ocean: 1, shallow_water: 1, river: 1, lake: 1 };

function getWangSrc(tile) {
  var mask = tile.wangEdgeMask;
  if (mask === undefined) mask = 0;
  if (tile.transitionPair) {
    var pair = tile.transitionPair;
    // For flat wang, use alphabetical dir and adjust mask if needed
    var sorted = [pair.from, pair.to].sort();
    var dir = sorted[0] + '_to_' + sorted[1];
    // wangEdgeMask: 1=upper-elevation. If from is alphabetically second,
    // the mask is inverted relative to the alphabetical dir.
    if (pair.from !== sorted[0]) {
      mask = 15 - mask;
    }
    var otherBiome = tile.transitionSide === 'from' ? pair.to : pair.from;
    var myCliffLvl = cliffLevel(tile.climate.elevation);
    var neighborCliffLvl = WATER_BIOMES[otherBiome] ? 0 : myCliffLvl;
    var hasCliffDrop = Math.abs(myCliffLvl - neighborCliffLvl) >= 2;
    var isLandWaterCliff = !WATER_BIOMES[tile.biome] && WATER_BIOMES[otherBiome] && hasCliffDrop;
    if (isLandWaterCliff) {
      var intMask = tile.biome === sorted[0] ? 0 : 15;
      return TRANSITIONS_BASE + dir + '/wang/' + dir + '__wang_' + intMask + WANG_SUFFIX;
    }
    return TRANSITIONS_BASE + dir + '/wang/' + dir + '__wang_' + mask + WANG_SUFFIX;
  }
  // Interior tile — use same tileset as nearest transition for consistency
  if (tile.nearestTransitionPair) {
    var npDir = [tile.nearestTransitionPair.from, tile.nearestTransitionPair.to].sort();
    var nearDir = npDir[0] + '_to_' + npDir[1];
    var intMask = tile.biome === npDir[0] ? 0 : 15;
    return TRANSITIONS_BASE + nearDir + '/wang/' + nearDir + '__wang_' + intMask + WANG_SUFFIX;
  }
  // Deep interior with no nearby transition
  var interior = BIOME_INTERIOR[tile.biome];
  if (interior) {
    return TRANSITIONS_BASE + interior.dir + '/wang/' + interior.dir + '__wang_' + interior.mask + WANG_SUFFIX;
  }
  return null;
}

function paintWangBase(ctx, tile, sx, sy, size) {
  var src = getWangSrc(tile);
  tile.wangSelectedSrc = src;
  if (!src) return;
  var img = wangImgCache[src];
  if (!img || !img.complete || !img.naturalWidth) return;
  ctx.drawImage(img, 0, 0, 32, 32, sx, sy, size, size);
}

export function paintTerrainTile(ctx, tile, sx, sy, size, sun, focusElevation, compositor, timeSeconds, atlas) {
  if (focusElevation === undefined) focusElevation = tile.climate.elevation;
  if (!compositor) compositor = null;
  if (!timeSeconds) timeSeconds = 0;
  if (!atlas) atlas = null;
  const palette = paletteFor(tile.biome);
  const patch = coherentPatch(tile.wx, tile.wy, tile.biome);
  const base = palette[Math.min(palette.length - 1, Math.floor(patch * palette.length))];
  // Water biomes render flat — no elevation shading or depth fade
  const isWater = WATER_BIOMES[tile.biome];
  const elevationShade = isWater ? 0 : (tile.climate.elevation - 0.5) * 0.22;
  const depthFade = isWater ? 0 : Math.max(0, focusElevation - tile.climate.elevation - 0.08) * 0.50;
  const light = Math.max(0, 0.78 + sun.height * 0.22 - depthFade - elevationShade);
  const shaded = shade(base, light);
  ctx.fillStyle = shaded;
  ctx.fillRect(sx, sy, size, size);
  paintWangBase(ctx, tile, sx, sy, size);
}

// Get cliff level for a corner, treating water as flat level 0.
function cornerCliffLevel(elevation, biome) {
  if (WATER_BIOMES[biome]) return 0;
  return cliffLevel(elevation);
}

// Draw cliff face Wang tiles at elevation transitions.
// Uses dual-grid corners: NW=self, NE=E-neighbor, SW=S-neighbor, SE=SE-neighbor.
// Bits set where the corner is at the LOWER elevation level ("from" = lower ground).
// Water tiles never get cliff overlays. Water corners are treated as level 0,
// so coastlines naturally become cliff faces on the land side.
export function paintCliffOverlay(ctx, tile, sx, sy, size, sun) {
  // Never draw cliff overlays on water tiles
  if (WATER_BIOMES[tile.biome]) return;

  var myEl = tile.climate.elevation;
  var nwLevel = cornerCliffLevel(myEl, tile.biome);
  var neLevel = cornerCliffLevel(tile._elE != null ? tile._elE : myEl, tile.neighborE || tile.biome);
  var swLevel = cornerCliffLevel(tile._elS != null ? tile._elS : myEl, tile.neighborS || tile.biome);
  var seLevel = cornerCliffLevel(tile._elSE != null ? tile._elSE : myEl, tile.neighborSE || tile.biome);

  // Skip if all 4 corners are the same level (flat terrain)
  if (nwLevel === neLevel && nwLevel === swLevel && nwLevel === seLevel) return;

  // "from" = lower level. Bits set where corner matches the minimum (lower ground).
  var minLevel = Math.min(nwLevel, neLevel, swLevel, seLevel);
  var cornerMask = 0;
  if (nwLevel === minLevel) cornerMask |= 8;
  if (neLevel === minLevel) cornerMask |= 4;
  if (swLevel === minLevel) cornerMask |= 2;
  if (seLevel === minLevel) cornerMask |= 1;

  if (cornerMask === 0 || cornerMask === 15) return;

  var wangIndex = CLIFF_CORNER_TO_WANG[cornerMask];
  var cliffDir = BIOME_CLIFF[tile.biome] || 'cliff_overlay';
  var src = TRANSITIONS_BASE + cliffDir + '/wang/' + cliffDir + '__wang_' + wangIndex + WANG_SUFFIX;

  var img = wangImgCache[src];
  if (!img || !img.complete || !img.naturalWidth) return;
  ctx.drawImage(img, 0, 0, 32, 32, sx, sy, size, size);
}

function coherentPatch(wx, wy, biome) {
  return Math.abs(smoothNoise(wx * 0.17 + biome.length * 0.3, wy * 0.17 + biome.length * 0.3));
}

export function shade(hex, amount) {
  if (!hex) return '#000';
  var r = parseInt(hex.slice(1, 3), 16);
  var g = parseInt(hex.slice(3, 5), 16);
  var b = parseInt(hex.slice(5, 7), 16);
  return '#' + [r, g, b].map(function(c) { return clamp(Math.floor(c * amount)).toString(16).padStart(2, '0'); }).join('');
}

export function tint(color, tintColor, ambient) {
  if (!color || !tintColor) return '#000';
  if (ambient === undefined) ambient = 1;
  var rgb = parseRgb(color);
  var t = parseRgb(tintColor);
  return '#' + [0, 1, 2].map(function(i) { return clamp(Math.floor(rgb[i] * ambient + t[i] * (1 - ambient))).toString(16).padStart(2, '0'); }).join('');
}

function parseRgb(color) {
  return [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)];
}

function clamp(value) {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}
