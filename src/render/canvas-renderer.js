import { WORLD } from '../core/constants.js';
import { getWorldSeed } from '../core/world-seed.js';
import { floorDiv } from '../world/chunk.js';
import { auditBiomesAround } from '../world/biome-audit.js';
import { paintTerrainTile, shade, tint } from './tile-painter.js';

export class CanvasRenderer {
  constructor(canvas, statsElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.statsElement = statsElement;
    this.lastAudit = null;
    this.lastAuditAt = 0;
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    this.canvas.width = Math.floor(window.innerWidth * window.devicePixelRatio);
    this.canvas.height = Math.floor(window.innerHeight * window.devicePixelRatio);
    this.ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
  }

  draw(chunkStore, player, lighting, camera) {
    const ctx = this.ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const sun = lighting.sun();
    const tilePx = WORLD.tileSize * camera.zoom;
    const focusTile = chunkStore.tileAt(player.x, player.y);
    ctx.fillStyle = '#071019';
    ctx.fillRect(0, 0, w, h);

    const camX = player.x * tilePx - w / 2;
    const camY = player.y * tilePx - h / 2;
    const minTX = Math.floor(camX / tilePx) - 1;
    const minTY = Math.floor(camY / tilePx) - 1;
    const maxTX = Math.ceil((camX + w) / tilePx) + 1;
    const maxTY = Math.ceil((camY + h) / tilePx) + 1;

    for (let ty = minTY; ty <= maxTY; ty++) {
      for (let tx = minTX; tx <= maxTX; tx++) {
        const cx = floorDiv(tx, WORLD.chunkSize);
        const cy = floorDiv(ty, WORLD.chunkSize);
        const lx = tx - cx * WORLD.chunkSize;
        const ly = ty - cy * WORLD.chunkSize;
        const chunk = chunkStore.get(cx, cy);
        const renderTile = chunk.renderTiles[ly * WORLD.chunkSize + lx];
        const east = lx < WORLD.chunkSize - 1 ? chunk.renderTiles[ly * WORLD.chunkSize + lx + 1].elevation : renderTile.elevation;
        const south = ly < WORLD.chunkSize - 1 ? chunk.renderTiles[(ly + 1) * WORLD.chunkSize + lx].elevation : renderTile.elevation;
        const slope = ((renderTile.elevation - east) * sun.shadowX + (renderTile.elevation - south) * sun.shadowY) * 1.8;
        const contour = Math.floor(renderTile.elevation * 18) !== Math.floor((renderTile.elevation - 0.012) * 18) ? 0.10 : 0;
        const tile = chunk.tiles[ly * WORLD.chunkSize + lx];
        const sx = Math.floor(tx * tilePx - camX);
        const sy = Math.floor(ty * tilePx - camY - elevationLift(renderTile.elevation) * camera.zoom);
        const tileSize = Math.ceil(tilePx);
        paintTerrainTile(ctx, tile, sx, sy, tileSize, sun, focusTile.climate.elevation);
        if (slope + contour > 0.015) {
          ctx.fillStyle = `rgba(255,255,220,${Math.min(0.18, slope + contour)})`;
          ctx.fillRect(sx, sy, tileSize, Math.max(1, tileSize * 0.18));
        }
        ctx.fillStyle = `rgba(0,0,0,${Math.max(0, -slope) * 0.18})`;
        ctx.fillRect(sx, sy + tileSize * 0.75, tileSize, Math.max(1, tileSize * 0.25));
      }
    }

    this.drawObjects(chunkStore, camX, camY, w, h, sun, camera);
    this.drawDepthBokeh(chunkStore, player, focusTile, camera, camX, camY, w, h);
    this.drawPlayer(w, h, camera.zoom);
    this.drawAtmosphere(sun, w, h);
  }

  drawObjects(chunkStore, camX, camY, w, h, sun, camera) {
    const ctx = this.ctx;
    for (const chunk of chunkStore.chunks.values()) {
      for (const object of chunk.objects) {
        const tile = chunk.tiles[object.y * WORLD.chunkSize + object.x];
        const tilePx = WORLD.tileSize * camera.zoom;
        const sx = (chunk.cx * WORLD.chunkSize + object.x) * tilePx - camX;
        const sy = (chunk.cy * WORLD.chunkSize + object.y) * tilePx - camY - elevationLift(tile.climate.elevation) * camera.zoom;
        if (sx < -20 || sy < -20 || sx > w + 20 || sy > h + 20) continue;
        ctx.fillStyle = `rgba(0,0,0,${0.28 * (1 - sun.height)})`;
        ctx.fillRect(sx + sun.shadowX * 12 * camera.zoom, sy + sun.shadowY * 12 * camera.zoom + 10 * camera.zoom, 12 * camera.zoom, 5 * camera.zoom);
        drawObject(ctx, object.kind, sx, sy, camera.zoom);
      }
    }
  }

  drawDepthBokeh(chunkStore, player, focusTile, camera, camX, camY, w, h) {
    if (focusTile.climate.elevation < 0.58) return;
    const ctx = this.ctx;
    const tilePx = WORLD.tileSize * camera.zoom;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const chunk of chunkStore.chunks.values()) {
      for (const object of chunk.objects) {
        const tile = chunk.tiles[object.y * WORLD.chunkSize + object.x];
        const drop = focusTile.climate.elevation - tile.climate.elevation;
        if (drop < 0.16) continue;
        const sx = (chunk.cx * WORLD.chunkSize + object.x) * tilePx - camX;
        const sy = (chunk.cy * WORLD.chunkSize + object.y) * tilePx - camY;
        if (sx < -30 || sy < -30 || sx > w + 30 || sy > h + 30) continue;
        const distance = Math.hypot(player.x - tile.wx, player.y - tile.wy);
        if (distance < 18) continue;
        ctx.fillStyle = `rgba(210,230,255,${Math.min(0.16, drop * 0.18)})`;
        ctx.beginPath();
        ctx.arc(sx + tilePx / 2, sy + tilePx / 2, Math.min(14, 3 + drop * 18) * camera.zoom, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawPlayer(w, h, zoom) {
    const ctx = this.ctx;
    ctx.fillStyle = '#f6f1d0';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 7 * zoom, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1b1b1b';
    ctx.stroke();
  }

  drawAtmosphere(sun, w, h) {
    const ctx = this.ctx;
    ctx.fillStyle = `rgba(12,18,42,${Math.max(0, 0.36 - sun.height * 0.34)})`;
    ctx.fillRect(0, 0, w, h);
  }

  hud(chunkStore, player, lighting, camera, perf) {
    const tile = chunkStore.tileAt(player.x, player.y);
    const sun = lighting.sun();
    const now = performance.now();
    if (!this.lastAudit || now - this.lastAuditAt > 1500) {
      this.lastAudit = auditBiomesAround(player, 96, 8);
      this.lastAuditAt = now;
    }
    const audit = this.lastAudit;
    const topBiomes = audit.seen.slice(0, 6).map(entry => `${entry.id} ${(entry.pct * 100).toFixed(0)}%`).join(', ');
    const chunkStats = chunkStore.stats();
    const workerLine = `workers ${chunkStats.workers} · pending ${chunkStats.pending} · ready ${chunkStats.ready}`;
    const perfLine = perf ? `<br>fps ${perf.fps.toFixed(0)} · update ${perf.updateMs.toFixed(1)}ms · draw ${perf.drawMs.toFixed(1)}ms · ${workerLine}` : '';
    this.statsElement.innerHTML = `WASD/arrows move · mousewheel zoom · R reset<br>M map · L pause sun · click overmap teleport<br>seed ${getWorldSeed()} · chunks ${chunkStore.chunks.size} · zoom ${camera.zoom.toFixed(2)}${perfLine}<br>tile ${Math.floor(player.x)}, ${Math.floor(player.y)} · chunk ${floorDiv(player.x)}, ${floorDiv(player.y)}<br>biome ${tile.biome} · material ${tile.material}<br>surface ${tile.layers[3].detail}<br>elev ${tile.climate.elevation.toFixed(2)} lift ${elevationLift(tile.climate.elevation).toFixed(1)}<br>moist ${tile.climate.moisture.toFixed(2)} heat ${tile.climate.heat.toFixed(2)}<br>${sun.label} · light ${sun.ambient.toFixed(2)} · sun height ${sun.height.toFixed(2)}<br>overmap biomes ${audit.seen.length}/${audit.spec.length}: ${topBiomes}<br>missing: ${audit.missing.join(', ') || 'none'}`;
  }
}

function drawObject(ctx, kind, sx, sy, zoom = 1) {
  if (kind === 'tree') {
    ctx.fillStyle = '#12391f';
    ctx.beginPath();
    ctx.arc(sx + 8 * zoom, sy + 8 * zoom, 7 * zoom, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6b4928';
    ctx.fillRect(sx + 6 * zoom, sy + 8 * zoom, 4 * zoom, 7 * zoom);
  } else if (kind.includes('rock')) {
    ctx.fillStyle = '#555a5f';
    ctx.fillRect(sx + 4 * zoom, sy + 5 * zoom, 9 * zoom, 8 * zoom);
  } else if (kind === 'flower') {
    ctx.fillStyle = '#ffd6f2';
    ctx.fillRect(sx + 7 * zoom, sy + 7 * zoom, 3 * zoom, 3 * zoom);
  } else if (kind.includes('shrub') || kind === 'reed' || kind === 'grass_tuft') {
    ctx.fillStyle = '#244f27';
    ctx.fillRect(sx + 5 * zoom, sy + 6 * zoom, 7 * zoom, 7 * zoom);
  } else {
    ctx.fillStyle = '#7b5b35';
    ctx.fillRect(sx + 5 * zoom, sy + 6 * zoom, 8 * zoom, 5 * zoom);
  }
}

function elevationLift(elevation) {
  return Math.max(0, elevation - 0.35) * 18;
}

