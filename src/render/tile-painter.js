import { rand2 } from '../core/random.js';
import { paletteFor } from './palette.js';
import { paintMicroLayers } from './micro-layer-painter.js';

export function paintTerrainTile(ctx, tile, sx, sy, size, sun, focusElevation = tile.climate.elevation, compositor = null, timeSeconds = 0, atlas = null) {
  const signature = compositor?.terrainSignature(tile);
  const palette = paletteFor(tile.biome);
  const micro = rand2(tile.wx, tile.wy, 1200);
  const base = palette[Math.min(palette.length - 1, Math.floor(micro * palette.length))];
  const elevationShade = (tile.climate.elevation - 0.5) * 0.22;
  const depthFade = Math.max(0, focusElevation - tile.climate.elevation - 0.08) * 0.50;
  ctx.fillStyle = tint(shade(base, elevationShade + depthFade), sun.tint, sun.ambient);
  ctx.fillRect(sx, sy, size, size);
  paintBiomeTexture(ctx, tile, sx, sy, size, sun);
  paintMicroLayers(ctx, tile, sx, sy, size, sun, timeSeconds, atlas);
}

function paintCompositorDebugLayer(ctx, signature, sx, sy, size) {
  const hash = signature.variant % 360;
  ctx.fillStyle = `hsla(${hash}, 45%, 62%, 0.08)`;
  ctx.fillRect(sx, sy, size, size);
  if (signature.layers.includes('cliff_wall')) {
    ctx.fillStyle = 'rgba(0,0,0,.16)';
    ctx.fillRect(sx, sy + size * 0.55, size, size * 0.45);
  }
}

function paintBiomeTexture(ctx, tile, sx, sy, size, sun) {
  const density = detailDensity(tile.biome);
  const count = Math.max(1, Math.floor(size * size * density));
  for (let i = 0; i < count; i++) {
    const r = rand2(tile.wx, tile.wy, 1300 + i * 17);
    const x = sx + Math.floor(rand2(tile.wx, tile.wy, 1400 + i) * size);
    const y = sy + Math.floor(rand2(tile.wx, tile.wy, 1500 + i) * size);
    if (tile.biome.includes('ocean') || tile.biome === 'shallow_water' || tile.biome === 'river' || tile.biome === 'lake') {
      ctx.fillStyle = `rgba(180,230,245,${0.08 + r * 0.10})`;
      ctx.fillRect(x, y, Math.max(1, size * 0.35), 1);
    } else if (tile.biome === 'forest' || tile.biome === 'dense_forest' || tile.biome === 'taiga' || tile.biome === 'tropical_forest') {
      ctx.fillStyle = tint(r > 0.5 ? '#16351f' : '#6f8c3c', sun.tint, sun.ambient * 0.95);
      ctx.fillRect(x, y, Math.max(1, size * 0.12), Math.max(1, size * 0.20));
    } else if (tile.biome === 'mystic') {
    ctx.fillStyle = `rgba(130,90,255,${0.10 + r * 0.18})`;
    ctx.fillRect(x, y, Math.max(1, size * 0.16), Math.max(1, size * 0.16));
    ctx.fillStyle = `rgba(80,255,220,${0.08 + r * 0.12})`;
    ctx.fillRect(x + 1, y, 1, Math.max(1, size * 0.30));
  } else if (tile.biome === 'beach' || tile.biome === 'desert') {
      ctx.fillStyle = `rgba(255,235,170,${0.10 + r * 0.16})`;
      ctx.fillRect(x, y, Math.max(1, size * 0.12), 1);
    } else if (tile.biome === 'mountains' || tile.biome === 'hills' || tile.biome === 'volcanic') {
      ctx.fillStyle = tint(r > 0.5 ? '#383838' : '#b3b3aa', sun.tint, sun.ambient * 0.88);
      ctx.fillRect(x, y, Math.max(1, size * 0.18), Math.max(1, size * 0.12));
    } else {
      ctx.fillStyle = tint(r > 0.55 ? '#c8d96a' : '#3c7d35', sun.tint, sun.ambient);
      ctx.fillRect(x, y, Math.max(1, size * 0.10), Math.max(1, size * 0.16));
    }
  }
}

function detailDensity(biome) {
  if (biome === 'dense_forest' || biome === 'tropical_forest') return 0.014;
  if (biome === 'forest' || biome === 'taiga' || biome === 'grassland') return 0.010;
  if (biome.includes('ocean') || biome === 'river' || biome === 'lake') return 0.004;
  if (biome === 'desert' || biome === 'beach') return 0.005;
  return 0.007;
}

export function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  r = Math.max(0, Math.min(255, r + amount * 255));
  g = Math.max(0, Math.min(255, g + amount * 255));
  b = Math.max(0, Math.min(255, b + amount * 255));
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

export function tint(color, tintColor, ambient) {
  const rgb = parseRgb(color);
  return `rgb(${clamp(rgb.r * tintColor.r * ambient)},${clamp(rgb.g * tintColor.g * ambient)},${clamp(rgb.b * tintColor.b * ambient)})`;
}

function parseRgb(color) {
  if (color.startsWith('rgb')) {
    const parts = color.match(/\d+/g).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2] };
  }
  const n = parseInt(color.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function clamp(value) {
  return Math.max(0, Math.min(255, value | 0));
}
