import { WORLD } from '../core/constants.js';
import { floorDiv } from '../world/chunk.js';

export function drawElevationOverlay(ctx, chunkStore, camX, camY, w, h, sun, camera) {
  if (!camera?.showElevationOverlay) return;
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
      const terrain = chunk.tiles[ly * WORLD.chunkSize + lx];
      const level = terrain.layers?.[7]?.plateauLevel ?? Math.max(0, Math.min(4, Math.floor((tile.elevation - 0.36) / 0.115)));
      const eastLevel = samplePlateau(chunkStore, tx + 1, ty, level);
      const westLevel = samplePlateau(chunkStore, tx - 1, ty, level);
      const southLevel = samplePlateau(chunkStore, tx, ty + 1, level);
      const northLevel = samplePlateau(chunkStore, tx, ty - 1, level);
      const gradient = Math.hypot(east - west, south - north);
      const slope = ((tile.elevation - east) * sun.shadowX + (tile.elevation - south) * sun.shadowY) * 2.6;
      const contour = Math.floor(tile.elevation * 14) !== Math.floor((tile.elevation - 0.018) * 14) ? 0.14 : 0;
      const cliff = gradient > 0.085 || terrain.terrainForm === 'cliff';
      const step = terrain.terrainForm === 'step';
      const lowerSouth = level > southLevel;
      const lowerEast = level > eastLevel;
      const lowerWest = level > westLevel;
      const lowerNorth = level > northLevel;
      const sx = Math.floor(tx * tilePx - camX);
      const sy = Math.floor(ty * tilePx - camY);
      const size = Math.ceil(tilePx);
      if (slope + contour > 0.018) {
        ctx.fillStyle = `rgba(255,245,205,${Math.min(0.24, slope + contour)})`;
        ctx.fillRect(sx, sy, size, Math.max(1, size * 0.18));
      }
      const shade = Math.max(0, -slope) * 0.26;
      if (shade > 0.01) {
        ctx.fillStyle = `rgba(48,52,48,${shade})`;
        ctx.fillRect(sx, sy + size * 0.62, size, Math.max(1, size * 0.38));
      }
      if (level > 0) {
        ctx.fillStyle = `rgba(255,255,255,${Math.min(0.10, level * 0.018)})`;
        ctx.fillRect(sx, sy, size, size);
      }
      if (lowerSouth || lowerEast || lowerWest || lowerNorth) {
        const drop = Math.max(level - southLevel, level - eastLevel, level - westLevel, level - northLevel);
        ctx.fillStyle = `rgba(35,24,18,${Math.min(0.88, 0.46 + drop * 0.20)})`;
        if (lowerSouth) ctx.fillRect(sx, sy + size * 0.46, size, size * 0.54);
        if (lowerEast) ctx.fillRect(sx + size * 0.52, sy, size * 0.48, size);
        if (lowerWest) ctx.fillRect(sx, sy, size * 0.48, size);
        if (lowerNorth) ctx.fillRect(sx, sy, size, size * 0.44);
        ctx.strokeStyle = `rgba(255,232,170,${Math.min(0.45, 0.18 + drop * 0.12)})`;
        ctx.lineWidth = Math.max(1, size * 0.08);
        ctx.beginPath();
        if (lowerSouth) { ctx.moveTo(sx, sy + size * 0.46); ctx.lineTo(sx + size, sy + size * 0.46); }
        if (lowerEast) { ctx.moveTo(sx + size * 0.52, sy); ctx.lineTo(sx + size * 0.52, sy + size); }
        if (lowerWest) { ctx.moveTo(sx + size * 0.48, sy); ctx.lineTo(sx + size * 0.48, sy + size); }
        if (lowerNorth) { ctx.moveTo(sx, sy + size * 0.44); ctx.lineTo(sx + size, sy + size * 0.44); }
        ctx.stroke();
      }
      if (step && !cliff) {
        ctx.strokeStyle = 'rgba(70,45,30,0.34)';
        ctx.lineWidth = Math.max(1, size * 0.10);
        ctx.beginPath();
        ctx.moveTo(sx + size * 0.08, sy + size * 0.62);
        ctx.lineTo(sx + size * 0.92, sy + size * 0.62);
        ctx.stroke();
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

function samplePlateau(chunkStore, tx, ty, fallback) {
  const cx = floorDiv(tx, WORLD.chunkSize);
  const cy = floorDiv(ty, WORLD.chunkSize);
  const chunk = chunkStore.getIfReady(cx, cy);
  if (!chunk) return fallback;
  const lx = tx - cx * WORLD.chunkSize;
  const ly = ty - cy * WORLD.chunkSize;
  return chunk.tiles[ly * WORLD.chunkSize + lx]?.layers?.[7]?.plateauLevel ?? fallback;
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
