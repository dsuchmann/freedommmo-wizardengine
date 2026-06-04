import { WORLD } from '../core/constants.js';
import { paletteFor } from './palette.js';
import { catalogWangTerrainDefs } from '../assets/catalog-wang-terrain-defs.js';

const imageCache = new Map();
let preloaded = false;

const debugMaskData = new Map();

export function getDebugWangData(chunkKey) {
  return debugMaskData.get(chunkKey);
}

export function setDebugWangData(chunkKey, data) {
  debugMaskData.set(chunkKey, data);
}

export function clearDebugWangData() {
  debugMaskData.clear();
}

export function preloadWangTiles() {
  if (preloaded) return;
  preloaded = true;
  const dirs = new Set();
  for (const def of Object.values(catalogWangTerrainDefs)) {
    if (def?.dir) dirs.add(def.dir);
  }
  for (const dir of dirs) {
    for (let mask = 0; mask < 16; mask++) {
      cachedImage(`${dir}/wang_${mask}.png`);
    }
  }
}

const chunkStoreRef = { current: null };

export function setChunkStore(store) {
  chunkStoreRef.current = store;
}

export function paintWangTerrainChunk(ctx, chunk, sun) {
  // Performance-critical: Wang art is currently only a placeholder overlay and
  // doing 4096 mask/image checks per chunk causes visible chunk-load stutter.
  // Keep lightweight cliff edges and minimal debug data; biome transitions are
  // owned by per-tile biome assignment until real Wang art is enabled.
  paintCliffEdges(ctx, chunk, sun);
  const key = `${chunk.cx},${chunk.cy}`;
  debugMaskData.set(key, null);
  return null;
}

/** Helper: get palette color as rgba string for a biome */
function palColor(biome, idx) {
  try { const p = paletteFor(biome); const c = p[idx] || p[0] || '#5fa64b';
    const r = parseInt(c.slice(1,3),16), g = parseInt(c.slice(3,5),16), b = parseInt(c.slice(5,7),16);
    return { r, g, b, hex: c }; } catch (_) { return { r:95, g:166, b:75, hex:'#5fa64b' }; }
}

/**
 * Paint a smooth per-tile biome transition gradient based on the Wang mask.
 * For tiles at biome boundaries, paints a linear gradient across the tile
 * blending the two biomes' palette colors. This replaces the empty PNG Wang tiles.
 */
function paintWangTransition(ctx, tile, mask, sx, sy, size, chunk, x, y) {
  if (mask === 15 || mask < 0 || mask > 15) return;

  // Get tile's own color
  const own = palColor(tile.biome, 1);

  // Find first differing diagonal corner to get neighbor's color
  const dirs = [[8,-1,-1],[4,1,-1],[2,-1,1],[1,1,1]];
  let nb = null;
  for (const [bit, dx, dy] of dirs) {
    if (!(mask & bit)) {
      const b = safeBiome(chunk, chunk.cx, chunk.cy, x + dx, y + dy, tile.biome);
      nb = palColor(b, 1);
      break;
    }
  }
  if (!nb) return;

  // Determine transition direction from which corners differ
  // bit8=NW, bit4=NE, bit2=SW, bit1=SE
  const n = !(mask & 8) && !(mask & 4); // top edge diff
  const s = !(mask & 2) && !(mask & 1); // bottom edge diff
  const w = !(mask & 8) && !(mask & 2); // left edge diff
  const e = !(mask & 4) && !(mask & 1); // right edge diff
  // Single corners
  const nw = !(mask & 8) && (mask & 4) && (mask & 2) && (mask & 1);
  const ne = (mask & 8) && !(mask & 4) && (mask & 2) && (mask & 1);
  const sw = (mask & 8) && (mask & 4) && !(mask & 2) && (mask & 1);
  const se = (mask & 8) && (mask & 4) && (mask & 2) && !(mask & 1);

  ctx.save();

  // Paint a smooth linear gradient from the neighbor's color toward the tile's color
  let x0 = sx, y0 = sy, x1 = sx + size, y1 = sy + size;
  if (n) { x0 = sx; y0 = sy; x1 = sx + size; y1 = sy; }
  else if (s) { x0 = sx; y0 = sy + size; x1 = sx + size; y1 = sy + size; }
  else if (w) { x0 = sx; y0 = sy; x1 = sx; y1 = sy + size; }
  else if (e) { x0 = sx + size; y0 = sy; x1 = sx + size; y1 = sy + size; }
  else if (nw) { x0 = sx; y0 = sy; x1 = sx + size * 0.5; y1 = sy + size * 0.5; }
  else if (ne) { x0 = sx + size; y0 = sy; x1 = sx + size * 0.5; y1 = sy + size * 0.5; }
  else if (sw) { x0 = sx; y0 = sy + size; x1 = sx + size * 0.5; y1 = sy + size * 0.5; }
  else if (se) { x0 = sx + size; y0 = sy + size; x1 = sx + size * 0.5; y1 = sy + size * 0.5; }
  else {
    // Diagonal cross or other pattern — fall back to center gradient
    x0 = sx + size * 0.5; y0 = sy + size * 0.5;
    x1 = sx + size * 0.5; y1 = sy + size * 0.5;
  }

  const grad = ctx.createLinearGradient(x0, y0, x1, y1);
  grad.addColorStop(0, `rgb(${nb.r},${nb.g},${nb.b})`);
  grad.addColorStop(0.5, `rgb(${Math.round((nb.r+own.r)/2)},${Math.round((nb.g+own.g)/2)},${Math.round((nb.b+own.b)/2)})`);
  grad.addColorStop(1, `rgb(${own.r},${own.g},${own.b})`);
  ctx.fillStyle = grad;
  ctx.globalAlpha = 0.55;
  ctx.fillRect(sx, sy, size, size);
  ctx.restore();
}

function paintWangTile(ctx, chunk, x, y, tile, sx, sy, size) {
  const def = catalogWangTerrainDefs[tile.biome];
  if (!def?.dir) return false;
  const biome = tile.biome;
  const cxs = chunk.cx, cys = chunk.cy;
  const mask = cornerWangMask(chunk, cxs, cys, x, y, biome);
  // Try to draw the PNG Wang tile (they're mostly transparent placeholders)
  const src = `${def.dir}/wang_${mask}.png`;
  const image = cachedImage(src);
  if (image?.complete && image.naturalWidth) {
    const sw = image.naturalWidth || image.width;
    const sh = image.naturalHeight || image.height;
    if (sw && sh) ctx.drawImage(image, 0, 0, sw, sh, sx, sy, size, size);
  }
  // Wang PNGs currently act as optional overlay only. Do not generate
  // procedural transition geometry here; biome assignment owns transitions.
  return Boolean(image?.complete);
}

/** Cross-chunk safe tile lookup */
function safeTileAt(store, worldX, worldY) {
  const cx = Math.floor(worldX / WORLD.chunkSize);
  const cy = Math.floor(worldY / WORLD.chunkSize);
  const lx = worldX - cx * WORLD.chunkSize;
  const ly = worldY - cy * WORLD.chunkSize;
  const neighbor = store.getVisible(cx, cy);
  if (!neighbor) return null;
  return neighbor.tiles[ly * WORLD.chunkSize + lx] ?? null;
}

function safeBiome(chunk, cxs, cys, xx, yy, ownBiome) {
  if (xx >= 0 && xx < WORLD.chunkSize && yy >= 0 && yy < WORLD.chunkSize) {
    return chunk.tiles[yy * WORLD.chunkSize + xx]?.biome;
  }
  const store = chunkStoreRef.current;
  if (store) {
    const neighborTile = safeTileAt(store, cxs * WORLD.chunkSize + xx, cys * WORLD.chunkSize + yy);
    if (neighborTile) return neighborTile.biome;
  }
  return ownBiome;
}

export function cornerWangMask(chunk, cxs, cys, x, y, biome) {
  const nw = safeBiome(chunk, cxs, cys, x - 1, y - 1, biome) === biome ? 8 : 0;
  const ne = safeBiome(chunk, cxs, cys, x + 1, y - 1, biome) === biome ? 4 : 0;
  const sw = safeBiome(chunk, cxs, cys, x - 1, y + 1, biome) === biome ? 2 : 0;
  const se = safeBiome(chunk, cxs, cys, x + 1, y + 1, biome) === biome ? 1 : 0;
  return nw | ne | sw | se;
}

function safeElevation(chunk, cxs, cys, xx, yy, fallback) {
  if (xx >= 0 && xx < WORLD.chunkSize && yy >= 0 && yy < WORLD.chunkSize) {
    const t = chunk.tiles[yy * WORLD.chunkSize + xx];
    return t?.climate?.elevation ?? fallback;
  }
  const store = chunkStoreRef.current;
  if (store) {
    const t = safeTileAt(store, cxs * WORLD.chunkSize + xx, cys * WORLD.chunkSize + yy);
    return t?.climate?.elevation ?? fallback;
  }
  return fallback;
}

function elevationDrop(a, b) {
  const diff = a - b;
  if (diff < 0.008) return 0;
  return diff;
}

function paintCliffEdges(ctx, chunk, sun) {
  const size = WORLD.tileSize;
  const cxs = chunk.cx, cys = chunk.cy;
  for (let y = 0; y < WORLD.chunkSize; y++) {
    for (let x = 0; x < WORLD.chunkSize; x++) {
      const tile = chunk.tiles[y * WORLD.chunkSize + x];
      if (!tile?.climate) continue;
      const level = tile.climate.elevation;
      const sx = x * size;
      const sy = y * size;
      const southLevel = safeElevation(chunk, cxs, cys, x, y + 1, level);
      const eastLevel = safeElevation(chunk, cxs, cys, x + 1, y, level);
      const dropSouth = elevationDrop(level, southLevel);
      const dropEast = elevationDrop(level, eastLevel);
      if (dropSouth > 0) drawCliffFace(ctx, sx, sy + size * 0.62, size, size * 0.38, dropSouth, sun);
      if (dropEast > 0) drawCliffSide(ctx, sx + size * 0.72, sy + size * 0.12, size * 0.28, size * 0.76, dropEast, sun);
    }
  }
}

function drawCliffFace(ctx, x, y, w, h, drop, sun) {
  const img = cachedImage('assets/catalog/terrain_objects/mineral/cliff_face/cliff_face/intact/base.png');
  const dropScale = Math.min(3.0, drop * 8 + 0.6);
  if (img?.complete && img.naturalWidth) {
    ctx.drawImage(img, 0, 0, img.naturalWidth || img.width, img.naturalHeight || img.height, x, y, w, h * dropScale);
    return;
  }
  ctx.fillStyle = `rgba(59,74,43,${0.42 + Math.min(0.30, drop * 1.2)})`;
  ctx.fillRect(x, y, w, h * dropScale);
  ctx.strokeStyle = `rgba(24,34,21,${0.38 + (sun?.ambient ?? 1) * 0.10})`;
  ctx.lineWidth = Math.max(1, w * 0.035);
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(x + (w * i) / 4, y + h * 0.08);
    ctx.lineTo(x + (w * (i - 0.35)) / 4, y + h * 0.92);
    ctx.stroke();
  }
}

function drawCliffSide(ctx, x, y, w, h, drop, sun) {
  const dropScale = Math.min(1.5, drop * 4 + 0.4);
  ctx.fillStyle = `rgba(38,55,31,${0.32 + Math.min(0.28, drop * 1.0)})`;
  ctx.fillRect(x, y, w, h * dropScale);
  ctx.strokeStyle = `rgba(15,25,16,${0.32 + (sun?.ambient ?? 1) * 0.08})`;
  ctx.lineWidth = Math.max(1, w * 0.14);
  ctx.beginPath();
  ctx.moveTo(x + w * 0.25, y + h * 0.08);
  ctx.lineTo(x + w * 0.72, y + h * 0.92);
  ctx.stroke();
}

function cachedImage(src) {
  let record = imageCache.get(src);
  if (record) return record;
  const img = new Image();
  img.decoding = 'async';
  img.loading = 'eager';
  img.src = src;
  imageCache.set(src, img);
  return img;
}

function paintFlatFallback(ctx, tile, sx, sy, size) {
  const palette = paletteFor(tile.biome);
  ctx.fillStyle = palette[1] ?? palette[0] ?? '#5fa64b';
  ctx.fillRect(sx, sy, size, size);
}
