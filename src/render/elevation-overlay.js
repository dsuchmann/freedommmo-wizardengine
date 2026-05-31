import { WORLD } from '../core/constants.js';
import { floorDiv } from '../world/chunk.js';

export function drawElevationOverlay(ctx, chunkStore, camX, camY, w, h, sun, camera) {
  const tilePx = WORLD.tileSize * camera.zoom;
  const minTX = Math.floor(camX / tilePx) - 1;
  const minTY = Math.floor(camY / tilePx) - 1;
  const maxTX = Math.ceil((camX + w) / tilePx) + 1;
  const maxTY = Math.ceil((camY + h) / tilePx) + 1;
  ctx.save();
  for (let ty = minTY; ty <= maxTY; ty++) {
    for (let tx = minTX; tx <= maxTX; tx++) {
      const cx = floorDiv(tx, WORLD.chunkSize);
      const cy = floorDiv(ty, WORLD.chunkSize);
      const chunk = chunkStore.getIfReady(cx, cy);
      if (!chunk) continue;
      const lx = tx - cx * WORLD.chunkSize;
      const ly = ty - cy * WORLD.chunkSize;
      const tile = chunk.renderTiles[ly * WORLD.chunkSize + lx];
      const east = sampleElevation(chunkStore, tx + 1, ty, tile.elevation);
      const south = sampleElevation(chunkStore, tx, ty + 1, tile.elevation);
      const slope = ((tile.elevation - east) * sun.shadowX + (tile.elevation - south) * sun.shadowY) * 1.8;
      const contour = Math.floor(tile.elevation * 18) !== Math.floor((tile.elevation - 0.012) * 18) ? 0.08 : 0;
      const sx = Math.floor(tx * tilePx - camX);
      const sy = Math.floor(ty * tilePx - camY);
      const size = Math.ceil(tilePx);
      if (slope + contour > 0.018) {
        ctx.fillStyle = `rgba(255,245,205,${Math.min(0.16, slope + contour)})`;
        ctx.fillRect(sx, sy, size, Math.max(1, size * 0.16));
      }
      const shade = Math.max(0, -slope) * 0.16;
      if (shade > 0.01) {
        ctx.fillStyle = `rgba(0,0,0,${shade})`;
        ctx.fillRect(sx, sy + size * 0.70, size, Math.max(1, size * 0.30));
      }
    }
  }
  ctx.restore();
}

function sampleElevation(chunkStore, tx, ty, fallback) {
  const cx = floorDiv(tx, WORLD.chunkSize);
  const cy = floorDiv(ty, WORLD.chunkSize);
  const chunk = chunkStore.getIfReady(cx, cy);
  if (!chunk) return fallback;
  const lx = tx - cx * WORLD.chunkSize;
  const ly = ty - cy * WORLD.chunkSize;
  return chunk.renderTiles[ly * WORLD.chunkSize + lx]?.elevation ?? fallback;
}
