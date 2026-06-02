import { rand2, smoothNoise } from '../core/random.js';
import { paletteFor } from './palette.js';
import { paintMicroLayers } from './micro-layer-painter.js';

// ============================================================
// Layer 1: PixelLab variant overlay — per-tile random texture
// ============================================================
const pixelLabImageCache = new Map();

function pixelLabImage(src) {
  if (!src) return null;
  if (pixelLabImageCache.has(src)) return pixelLabImageCache.get(src);
  const img = new Image();
  img.src = src;
  pixelLabImageCache.set(src, img);
  return img;
}

const PIXEL_BASE_TILE_VARIANTS = { 'swamp/wet_mud': [] };
(function () {
  for (let i = 0; i < 16; i++) {
    const v = String(i).padStart(3, '0');
    PIXEL_BASE_TILE_VARIANTS['swamp/wet_mud'].push(
      'assets/pixelab/landscape_v2/base/swamp_wet_mud/tiles/swamp_wet_mud__tile__v' + v + '.png'
    );
  }
})();

function paintSwampPixelLabOverlay(ctx, tile, sx, sy, size) {
  if (tile.biome !== 'swamp') return;
  const variants = PIXEL_BASE_TILE_VARIANTS['swamp/wet_mud'];
  if (!variants || !variants.length) return;
  const idx = Math.floor(rand2(tile.wx, tile.wy, 16000) * variants.length);
  const src = variants[idx];
  const img = pixelLabImage(src);
  if (!img || !img.naturalWidth) return;
  ctx.save();
  ctx.globalAlpha = 0.30 + rand2(tile.wx, tile.wy, 16001) * 0.10;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 2, 2, img.naturalWidth - 4, img.naturalHeight - 4, sx, sy, size, size);
  ctx.restore();
}

// ============================================================
// Terrain tile painter
// ============================================================
export function paintTerrainTile(ctx, tile, sx, sy, size, sun, focusElevation, compositor, timeSeconds, atlas) {
  if (!ctx || !tile) return;
  if (focusElevation === undefined) focusElevation = tile.climate.elevation;
  const palette = paletteFor(tile.biome);
  const patch = coherentPatch(tile.wx, tile.wy, tile.biome);
  const base = palette[Math.min(palette.length - 1, Math.floor(patch * palette.length))];
  const e = tile.climate.elevation;
  const elevationShade = (e - 0.5) * 0.22;
  const depthFade = Math.max(0, (focusElevation || e) - e - 0.08) * 0.50;
  const stableSun = { ambient: 0.92, tint: { r: 1, g: 1, b: 1 } };
  ctx.fillStyle = tint(shade(base, elevationShade + depthFade), stableSun.tint, stableSun.ambient);
  ctx.fillRect(sx, sy, size, size);

  paintSwampPixelLabOverlay(ctx, tile, sx, sy, size);
  paintBiomeTexture(ctx, tile, sx, sy, size, sun);
  paintMicroLayers(ctx, tile, sx, sy, size, sun, timeSeconds, atlas);
  elevationLift(ctx, tile, sx, sy, size, sun, focusElevation);

  const signature = compositor ? compositor.terrainSignature(tile) : null;
  if (signature && atlas) {
    paintCompositorDebugLayer(ctx, signature, sx, sy, size);
  }
}

export function shade(hex, amount) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 'rgb(' + clamp(r + amount) + ',' + clamp(g + amount) + ',' + clamp(b + amount) + ')';
}

export function tint(color, tintColor, ambient) {
  if (!tintColor) return color;
  if (ambient === undefined) ambient = 1;
  const parts = parseRgb(color);
  return 'rgb(' +
    Math.floor(parts[0] * tintColor.r * ambient) + ',' +
    Math.floor(parts[1] * tintColor.g * ambient) + ',' +
    Math.floor(parts[2] * tintColor.b * ambient) + ')';
}

export function parseRgb(color) {
  const m = color.match(/[\d.]+/g) || [];
  return [parseInt(m[0]) || 0, parseInt(m[1]) || 0, parseInt(m[2]) || 0];
}

function clamp(value) {
  if (typeof value !== 'number' || isNaN(value)) return 0;
  return Math.max(0, Math.min(255, Math.floor(value)));
}

function coherentPatch(wx, wy, biome) {
  return smoothNoise(wx * 0.1, wy * 0.1, 3, wx * 997 + wy * 313);
}

function detailDensity(biome) {
  if (biome === 'swamp' || biome === 'forest' || biome === 'dense_forest' || biome === 'tropical_forest') return 0.85;
  if (biome === 'desert' || biome === 'arctic') return 0.20;
  return 0.50;
}

export function paintCompositorDebugLayer(ctx, signature, sx, sy, size) {
  const hash = signature.variant % 360;
  ctx.fillStyle = 'hsla(' + hash + ',45%,62%,0.08)';
  ctx.fillRect(sx, sy, size, size);
  if (signature.layers.indexOf('cliff_wall') !== -1) {
    ctx.fillStyle = 'rgba(40,45,42,.16)';
    ctx.fillRect(sx, sy + size * 0.55, size, size * 0.45);
  }
}

export function paintBiomeTexture(ctx, tile, sx, sy, size, sun) {
  const rng = tile.wx * 313 + tile.wy * 997;
  for (let i = 0; i < 6; i++) {
    const x = sx + ((rng + i * 53) % size);
    const y = sy + ((rng + i * 97) % size);
    const r = ((rng + i * 31) % 100) / 100;
    if (tile.biome === 'swamp') {
      ctx.fillStyle = 'rgba(20,40,20,' + (0.03 + r * 0.06).toFixed(3) + ')';
      ctx.fillRect(x, y, Math.max(1, size * 0.05), Math.max(1, size * 0.03));
    } else if (tile.biome === 'desert') {
      ctx.fillStyle = 'rgba(160,140,100,' + (0.02 + r * 0.06).toFixed(3) + ')';
      ctx.fillRect(x, y, Math.max(1, size * 0.06), Math.max(1, size * 0.02));
    }
  }
}

function elevationLift(ctx, tile, sx, sy, size, sun, focusElevation) {
  const e = tile.climate ? tile.climate.elevation : 0.5;
  const shape = smoothNoise(tile.wx, tile.wy, 4, 22000);
  const slope = Math.abs(e - (focusElevation || 0.5)) / 0.35;
  if (shape > 0.35 && e > 0.45) {
    ctx.fillStyle = 'rgba(60,50,40,' + Math.min(0.08, slope * 0.04).toFixed(3) + ')';
    ctx.fillRect(sx + size * 0.2, sy + size * 0.6, size * 0.6, size * 0.06);
  }
  if (tile.biome === 'forest' || tile.biome === 'swamp') {
    const rng = tile.wx * 149 + tile.wy * 251;
    const r = ((rng + 5000) % 100) / 100;
    if (r < 0.15) {
      ctx.fillStyle = 'rgba(30,70,30,' + (0.05 + r).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(sx + size * 0.5, sy + size * 0.5, size * (0.12 + r * 0.08), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
