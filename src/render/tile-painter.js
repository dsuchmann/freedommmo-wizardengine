import { rand2, smoothNoise } from '../core/random.js';
import { paletteFor } from './palette.js';
import { cliffLevel } from '../world/terrain-shaper.js';

var WANG_SUFFIX = '__v000.png';
var TRANSITIONS_BASE = 'assets/pixelab/landscape_v2/transitions/';
var wangImgCache = {};

// Wang tile lookup: corner mask → tile index (0-15)
var CLIFF_CORNER_TO_WANG = [12,13,0,3,8,1,14,5,15,4,11,2,9,10,7,6];

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
var BIOME_INTERIOR = {
  beach:         { dir: 'beach_to_desert',    mask: 6 },
  desert:        { dir: 'beach_to_desert',    mask: 12 },
  grassland:     { dir: 'beach_to_grassland', mask: 12 },
  river:         { dir: 'beach_to_river',     mask: 12 },
  swamp:         { dir: 'swamp_to_beach',     mask: 6 },
  forest:        { dir: 'swamp_to_forest',    mask: 12 },
  dense_forest:  { dir: 'swamp_to_dense_forest', mask: 12 },
  tropical_forest:{ dir: 'swamp_to_tropical_forest', mask: 12 },
  taiga:         { dir: 'swamp_to_taiga',     mask: 12 },
  savanna:       { dir: 'desert_to_savanna',  mask: 12 },
  steppe:        { dir: 'grassland_to_steppe',mask: 12 },
  tundra:        { dir: 'tundra_to_hills',    mask: 6 },
  arctic:        { dir: 'tundra_to_snow',     mask: 12 },
  hills:         { dir: 'desert_to_hills',    mask: 12 },
  mountains:     { dir: 'hills_to_mountains', mask: 12 },
  volcanic:      { dir: 'desert_to_volcanic', mask: 12 },
  mystic:        { dir: 'dense_forest_to_mystic', mask: 12 },
  ocean:         { dir: 'deep_ocean_to_ocean',mask: 12 },
  deep_ocean:    { dir: 'deep_ocean_to_ocean',mask: 6 },
  shallow_water: { dir: 'lake_to_shallow_water', mask: 12 },
  lake:          { dir: 'lake_to_swamp',      mask: 6 },
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
  'dense_forest_to_tropical_forest','forest_to_dense_forest','forest_to_hills',
  'forest_to_mystic','forest_to_taiga','forest_to_tropical_forest',
  'grassland_to_forest','grassland_to_hills','grassland_to_mystic',
  'grassland_to_savanna','hills_to_volcanic','lake_to_forest',
  'lake_to_grassland','lake_to_river','mountains_to_snow',
  'mountains_to_volcanic','ocean_to_beach','ocean_to_shallow_water',
  'river_to_forest','river_to_grassland','river_to_hills',
  'river_to_swamp','savanna_to_hills','savanna_to_steppe',
  'shallow_water_to_beach','shallow_water_to_river','shallow_water_to_swamp',
  'steppe_to_desert','steppe_to_hills','swamp_to_grass',
  'taiga_to_hills','taiga_to_mountains','tropical_forest_to_mystic',
  'tundra_to_mountains','tundra_to_steppe','tundra_to_taiga'
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

function getWangSrc(tile) {
  var mask = tile.wangEdgeMask;
  if (mask === undefined) mask = 0;
  if (tile.transitionPair) {
    return TRANSITIONS_BASE + tile.transitionPair.dir + '/wang/' + tile.transitionPair.dir + '__wang_' + mask + WANG_SUFFIX;
  }
  // Interior tile — use same tileset as nearest transition for consistency
  if (tile.nearestTransitionPair) {
    var intMask = tile.nearestTransitionSide === 'from' ? 6 : 12;
    return TRANSITIONS_BASE + tile.nearestTransitionPair.dir + '/wang/' + tile.nearestTransitionPair.dir + '__wang_' + intMask + WANG_SUFFIX;
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
  const elevationShade = (tile.climate.elevation - 0.5) * 0.22;
  const depthFade = Math.max(0, focusElevation - tile.climate.elevation - 0.08) * 0.50;
  const light = Math.max(0, 0.78 + sun.height * 0.22 - depthFade - elevationShade);
  const shaded = shade(base, light);
  ctx.fillStyle = shaded;
  ctx.fillRect(sx, sy, size, size);
  paintWangBase(ctx, tile, sx, sy, size);
}

// Draw cliff face Wang tiles on the lower side of an elevation step.
// Uses biome-specific cliff tilesets; falls back to generic cliff_overlay.
export function paintCliffOverlay(ctx, tile, sx, sy, size, sun) {
  var myEl = tile.climate.elevation;
  var myLevel = cliffLevel(myEl);

  // Corner mask: NW=tile(compare N elev), NE=E-neighbor, SW=S-neighbor, SE=SE-neighbor
  // Bits set when corner neighbor is on a HIGHER cliff level
  var cornerMask = 0;
  if (myLevel < cliffLevel(tile._elN  || myEl)) cornerMask |= 8;
  if (myLevel < cliffLevel(tile._elE  || myEl)) cornerMask |= 4;
  if (myLevel < cliffLevel(tile._elS  || myEl)) cornerMask |= 2;
  if (myLevel < cliffLevel(tile._elSE || myEl)) cornerMask |= 1;

  if (cornerMask === 0) return;

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
