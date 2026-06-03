import { rand2, smoothNoise } from '../core/random.js';
import { paletteFor } from './palette.js';

var SWAMP_WANG_SUFFIX = '__v000.png';
var TRANSITIONS_BASE = 'assets/pixelab/landscape_v2/transitions/';
var wangImgCache = {};
function preloadWangImage(src) {
  var img = new Image();
  img.src = src;
  wangImgCache[src] = img;
}
var BASE_WANG_PREFIX = {
  swamp: 'assets/pixelab/landscape_v2/base/swamp_wet_mud/wang/swamp_wet_mud__wang_',
  beach: 'assets/pixelab/landscape_v2/base/beach/wang/beach__wang_',
  forest: 'assets/pixelab/landscape_v2/base/forest/wang/forest__wang_',
  dense_forest: 'assets/pixelab/landscape_v2/base/dense_forest/wang/dense_forest__wang_',
  tropical_forest: 'assets/pixelab/landscape_v2/base/tropical_forest/wang/tropical_forest__wang_',
  taiga: 'assets/pixelab/landscape_v2/base/taiga/wang/taiga__wang_',
  grassland: 'assets/pixelab/landscape_v2/base/grassland/wang/grassland__wang_',
  savanna: 'assets/pixelab/landscape_v2/base/savanna/wang/savanna__wang_',
  steppe: 'assets/pixelab/landscape_v2/base/steppe/wang/steppe__wang_',
  desert: 'assets/pixelab/landscape_v2/base/desert/wang/desert__wang_',
  tundra: 'assets/pixelab/landscape_v2/base/tundra/wang/tundra__wang_',
  arctic: 'assets/pixelab/landscape_v2/base/arctic/wang/arctic__wang_',
  hills: 'assets/pixelab/landscape_v2/base/hills/wang/hills__wang_',
  mountains: 'assets/pixelab/landscape_v2/base/mountains/wang/mountains__wang_',
  volcanic: 'assets/pixelab/landscape_v2/base/volcanic/wang/volcanic__wang_',
  mystic: 'assets/pixelab/landscape_v2/base/mystic/wang/mystic__wang_',
  ocean: 'assets/pixelab/landscape_v2/base/ocean/wang/ocean__wang_',
  deep_ocean: 'assets/pixelab/landscape_v2/base/deep_ocean/wang/deep_ocean__wang_',
  shallow_water: 'assets/pixelab/landscape_v2/base/shallow_water/wang/shallow_water__wang_',
  lake: 'assets/pixelab/landscape_v2/base/lake/wang/lake__wang_',
  river: 'assets/pixelab/landscape_v2/base/river/wang/river__wang_'
};
for (var preloadMask = 0; preloadMask < 16; preloadMask++) {
  for (var biomeKey in BASE_WANG_PREFIX) {
    preloadWangImage(BASE_WANG_PREFIX[biomeKey] + preloadMask + SWAMP_WANG_SUFFIX);
  }
  // Preload all transition Wang tiles
  var transKeys = ['beach_to_desert','beach_to_grassland','deep_ocean_to_ocean','dense_forest_to_mystic','dense_forest_to_tropical_forest','desert_to_hills','desert_to_savanna','desert_to_volcanic','forest_to_dense_forest','forest_to_hills','forest_to_mystic','forest_to_taiga','forest_to_tropical_forest','grassland_to_forest','grassland_to_hills','grassland_to_mystic','grassland_to_savanna','grassland_to_steppe','hills_to_mountains','hills_to_volcanic','lake_to_forest','lake_to_grassland','lake_to_river','lake_to_shallow_water','lake_to_swamp','mountains_to_snow','mountains_to_volcanic','ocean_to_beach','ocean_to_shallow_water','river_to_forest','river_to_grassland','river_to_hills','river_to_swamp','savanna_to_hills','savanna_to_steppe','shallow_water_to_beach','shallow_water_to_river','shallow_water_to_swamp','steppe_to_desert','steppe_to_hills','swamp_to_beach','swamp_to_dense_forest','swamp_to_forest','swamp_to_grass','swamp_to_taiga','swamp_to_tropical_forest','taiga_to_hills','taiga_to_mountains','tropical_forest_to_mystic','tundra_to_hills','tundra_to_mountains','tundra_to_snow','tundra_to_steppe','tundra_to_taiga'];
  for (var t = 0; t < transKeys.length; t++) {
    preloadWangImage(TRANSITIONS_BASE + transKeys[t] + '/wang/' + transKeys[t] + '__wang_' + preloadMask + SWAMP_WANG_SUFFIX);
  }
}

function getWangSrc(tile) {
  var mask = tile.wangEdgeMask;
  if (mask === undefined) mask = 0;
  if (tile.transitionPair) {
    var transitionMask = mask;
    // For non-edge interior tiles (only corner diffs), use filler mask
    var hasDirectEdge = (tile.neighborN && tile.neighborN !== tile.biome) ||
                         (tile.neighborW && tile.neighborW !== tile.biome) ||
                         (tile.neighborE && tile.neighborE !== tile.biome) ||
                         (tile.neighborS && tile.neighborS !== tile.biome);
    if (!hasDirectEdge && (mask === 0 || mask === 5 || mask === 10 || mask === 1 || mask === 4 || mask === 6)) {
      transitionMask = tile.transitionSide === 'to' ? 12 : 6;
    } else if (mask === 0 || mask === 6) {
      transitionMask = tile.transitionSide === 'to' ? 12 : 6;
    }
    return TRANSITIONS_BASE + tile.transitionPair.dir + '/wang/' + tile.transitionPair.dir + '__wang_' + transitionMask + SWAMP_WANG_SUFFIX;
  }
  var prefix = BASE_WANG_PREFIX[tile.biome];
  return prefix ? prefix + mask + SWAMP_WANG_SUFFIX : null;
}

function paintWangBase(ctx, tile, sx, sy, size) {
  var src = getWangSrc(tile);
  tile.wangSelectedSrc = src;
  if (!src) return;
  var img = wangImgCache[src];
  if (!img || !img.complete || !img.naturalWidth) return;
  ctx.drawImage(img, 0, 0, 32, 32, sx, sy, size, size);
}

export function paintTerrainTile(ctx, tile, sx, sy, size, sun, focusElevation = tile.climate.elevation, compositor = null, timeSeconds = 0, atlas = null) {
  const palette = paletteFor(tile.biome);
  const patch = coherentPatch(tile.wx, tile.wy, tile.biome);
  const base = palette[Math.min(palette.length - 1, Math.floor(patch * palette.length))];
  const elevationShade = (tile.climate.elevation - 0.5) * 0.22;
  const depthFade = Math.max(0, focusElevation - tile.climate.elevation - 0.08) * 0.50;
  ctx.fillStyle = tint(shade(base, elevationShade + depthFade), sun.tint, sun.ambient);
  ctx.fillRect(sx, sy, size, size);
  paintWangBase(ctx, tile, sx, sy, size);
}

function coherentPatch(wx, wy, biome) {
  const base = smoothNoise(wx, wy, 4, 1000 + biome.length);
  const detail = smoothNoise(wx, wy, 8, 2000 + biome.length) * 0.3;
  return Math.max(0, Math.min(1, (base + detail) * 0.5 + 0.5));
}

export function shade(hex, amount) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${clamp(r + amount)},${clamp(g + amount)},${clamp(b + amount)})`;
}

export function tint(color, tintColor, ambient = 1) {
  if (!tintColor) return color;
  const [cr, cg, cb] = parseRgb(color);
  return `rgb(${Math.floor(cr * ambient)},${Math.floor(cg * ambient)},${Math.floor(cb * ambient)})`;
}

function parseRgb(color) {
  const m = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (m) return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
  return [128, 128, 128];
}

function clamp(value) {
  return Math.max(0, Math.min(255, Math.floor(value)));
}
