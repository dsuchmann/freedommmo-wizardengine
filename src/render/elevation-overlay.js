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
      const west = sampleElevation(chunkStore, tx - 1, ty, tile.elevation);
      const south = sampleElevation(chunkStore, tx, ty + 1, tile.elevation);
      const north = sampleElevation(chunkStore, tx, ty - 1, tile.elevation);
      const gradient = Math.hypot(east - west, south - north);
      const slope = ((tile.elevation - east) * sun.shadowX + (tile.elevation - south) * sun.shadowY) * 2.6;
      const contour = Math.floor(tile.elevation * 14) !== Math.floor((tile.elevation - 0.018) * 14) ? 0.14 : 0;
      const cliff = gradient > 0.085;
      const sx = Math.floor(tx * tilePx - camX);
      const sy = Math.floor(ty * tilePx - camY);
      const size = Math.ceil(tilePx);
      if (slope + contour > 0.018) {
        ctx.fillStyle = `rgba(255,245,205,${Math.min(0.24, slope + contour)})`;
        ctx.fillRect(sx, sy, size, Math.max(1, size * 0.18));
      }
      const shade = Math.max(0, -slope) * 0.26;
      if (shade > 0.01) {
        ctx.fillStyle = `rgba(0,0,0,${shade})`;
        ctx.fillRect(sx, sy + size * 0.62, size, Math.max(1, size * 0.38));
      }
      if (cliff) {
        const dirX = Math.sign(east - west);
        const dirY = Math.sign(south - north);
        ctx.fillStyle = `rgba(20,18,18,${Math.min(0.46, gradient * 3.2)})`;
        ctx.fillRect(sx + Math.max(0, dirX) * size * 0.55, sy + Math.max(0, dirY) * size * 0.55, Math.max(2, size * (dirX ? 0.45 : 1)), Math.max(2, size * (dirY ? 0.45 : 0.28)));
        ctx.strokeStyle = `rgba(255,238,190,${Math.min(0.32, gradient * 2.4)})`;
        ctx.lineWidth = Math.max(1, size * 0.08);
        ctx.beginPath();
        ctx.moveTo(sx + size * 0.12, sy + size * 0.18);
        ctx.lineTo(sx + size * 0.88, sy + size * 0.18);
        ctx.stroke();
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
