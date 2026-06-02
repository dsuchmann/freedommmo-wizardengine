import { rand2, smoothNoise } from '../core/random.js';
import { paletteFor } from './palette.js';

const SWAMP_WANG_PREFIX = 'assets/pixelab/landscape_v2/base/swamp_wet_mud/wang/swamp_wet_mud__wang_';
const SWAMP_WANG_SUFFIX = '__v000.png';
const TRANSITIONS_BASE = 'assets/pixelab/landscape_v2/transitions/';

// Transition dirs: neighbor biome → transition folder name
var TRANSITION_DIRS = {
  'beach': 'swamp_to_beach',
  'forest': 'swamp_to_forest',
  'dense_forest': 'swamp_to_dense_forest',
  'tropical_forest': 'swamp_to_tropical_forest',
  'grassland': 'swamp_to_grass',
  'river': 'swamp_to_river',
  'lake': 'swamp_to_lake',
  'shallow_water': 'swamp_to_shallow_water',
};

// Preload Wang canvases: keyed by "full_path" → canvas
var wangCanvasCache = {};

function loadWangCanvas(fullPath) {
  if (wangCanvasCache[fullPath] !== undefined) return wangCanvasCache[fullPath];
  wangCanvasCache[fullPath] = null; // mark pending
  try {
    var img = new Image();
    img.onload = function() {
      var cv = document.createElement('canvas');
      cv.width = img.naturalWidth;
      cv.height = img.naturalHeight;
      cv.getContext('2d').drawImage(img, 0, 0);
      wangCanvasCache[fullPath] = cv;
    };
    img.src = fullPath;
  } catch (e) { /* worker */ }
  return null;
}

function wangPathForMask(baseDir, prefix, mask) {
  return TRANSITIONS_BASE + baseDir + '/wang/' + prefix + '_wang_' + mask + SWAMP_WANG_SUFFIX;
}

function paintSwampWangBase(ctx, tile, sx, sy, size) {
  if (tile.biome !== 'swamp') return;
  var mask = tile.wangEdgeMask;
  if (mask === undefined) mask = 0;
  
  // Determine the transition biome(s) on active edges
  var edgeBiomes = {};
  if ((mask & 1) && tile.neighborW) edgeBiomes[tile.neighborW] = true;
  if ((mask & 2) && tile.neighborS) edgeBiomes[tile.neighborS] = true;
  if ((mask & 4) && tile.neighborE) edgeBiomes[tile.neighborE] = true;
  if ((mask & 8) && tile.neighborN) edgeBiomes[tile.neighborN] = true;
  
  var keys = Object.keys(edgeBiomes);
  // Single biome transition
  if (keys.length === 1 || keys.length === 0) {
    var toBiome = keys[0] || null;
    var prefix, src;
    if (toBiome && TRANSITION_DIRS[toBiome]) {
      prefix = 'swamp_to_' + toBiome;
      src = wangPathForMask(TRANSITION_DIRS[toBiome], prefix, mask);
    } else {
      src = SWAMP_WANG_PREFIX + mask + SWAMP_WANG_SUFFIX;
    }
    var cv = wangCanvasCache[src];
    if (cv === undefined) loadWangCanvas(src);
    if (!cv) return;
    ctx.drawImage(cv, 0, 0, cv.width, cv.height, sx, sy, size, size);
  }
}

export function paintTerrainTile(ctx, tile, sx, sy, size, sun, focusElevation = tile.climate.elevation, compositor = null, timeSeconds = 0, atlas = null) {
  const palette = paletteFor(tile.biome);
  const patch = coherentPatch(tile.wx, tile.wy, tile.biome);
  const base = palette[Math.min(palette.length - 1, Math.floor(patch * palette.length))];
  const elevationShade = (tile.climate.elevation - 0.5) * 0.22;
  const depthFade = Math.max(0, focusElevation - tile.climate.elevation - 0.08) * 0.50;
  ctx.fillStyle = tint(shade(base, elevationShade + depthFade), sun.tint, sun.ambient);
  ctx.fillRect(sx, sy, size, size);
  paintSwampWangBase(ctx, tile, sx, sy, size);
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
