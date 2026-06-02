import { rand2, smoothNoise } from '../core/random.js';
import { paletteFor } from './palette.js';

export function paintTerrainTile(ctx, tile, sx, sy, size, sun, focusElevation = tile.climate.elevation, compositor = null, timeSeconds = 0, atlas = null) {
  const palette = paletteFor(tile.biome);
  const patch = coherentPatch(tile.wx, tile.wy, tile.biome);
  const base = palette[Math.min(palette.length - 1, Math.floor(patch * palette.length))];
  const elevationShade = (tile.climate.elevation - 0.5) * 0.22;
  const depthFade = Math.max(0, focusElevation - tile.climate.elevation - 0.08) * 0.50;
  ctx.fillStyle = tint(shade(base, elevationShade + depthFade), sun.tint, sun.ambient);
  ctx.fillRect(sx, sy, size, size);
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
