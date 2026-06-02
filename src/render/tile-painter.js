import { rand2, smoothNoise } from '../core/random.js';
import { paletteFor } from './palette.js';

var SWAMP_WANG_PREFIX = 'assets/pixelab/landscape_v2/base/swamp_wet_mud/wang/swamp_wet_mud__wang_';
var SWAMP_WANG_SUFFIX = '__v000.png';
var TRANSITIONS_BASE = 'assets/pixelab/landscape_v2/transitions/';
var wangImgCache = {};
var TRANSITION_DIRS = {
  beach: 'swamp_to_beach',
  forest: 'swamp_to_forest',
  dense_forest: 'swamp_to_dense_forest',
  tropical_forest: 'swamp_to_tropical_forest',
  grassland: 'swamp_to_grass'
};

function getWangSrc(tile) {
  var mask = tile.wangEdgeMask;
  if (mask === undefined) mask = 0;
  if (tile.biome === 'swamp') {
    if (mask === 6) return TRANSITIONS_BASE + 'swamp_to_beach/wang/swamp_to_beach__wang_6' + SWAMP_WANG_SUFFIX;
    var nb = tile.neighborW !== 'swamp' ? tile.neighborW : (tile.neighborS !== 'swamp' ? tile.neighborS : (tile.neighborN !== 'swamp' ? tile.neighborN : (tile.neighborSW !== 'swamp' ? tile.neighborSW : (tile.neighborNW !== 'swamp' ? tile.neighborNW : null))));
    if (nb && TRANSITION_DIRS[nb]) {
      return TRANSITIONS_BASE + TRANSITION_DIRS[nb] + '/wang/' + TRANSITION_DIRS[nb] + '__wang_' + mask + SWAMP_WANG_SUFFIX;
    }
    return SWAMP_WANG_PREFIX + mask + SWAMP_WANG_SUFFIX;
  }
  if (tile.biome === 'beach') {
    if (tile.neighborN === 'swamp' || tile.neighborNE === 'swamp' || tile.neighborE === 'swamp' || tile.neighborSE === 'swamp' || tile.neighborS === 'swamp' || tile.neighborSW === 'swamp' || tile.neighborW === 'swamp' || tile.neighborNW === 'swamp') {
      return TRANSITIONS_BASE + 'swamp_to_beach/wang/swamp_to_beach__wang_' + mask + SWAMP_WANG_SUFFIX;
    }
    return 'assets/pixelab/landscape_v2/base/beach/wang/beach__wang_' + mask + SWAMP_WANG_SUFFIX;
  }
  return null;
}

function paintWangBase(ctx, tile, sx, sy, size) {
  if (tile.biome !== 'swamp' && tile.biome !== 'beach') return;
  var src = getWangSrc(tile);
  tile.wangSelectedSrc = src;
  if (!src) return;
  var img = wangImgCache[src];
  if (!img) {
    img = new Image();
    img.src = src;
    wangImgCache[src] = img;
  }
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
