import { WORLD } from '../core/constants.js';
import { floorDiv } from '../world/chunk.js';

export class CanvasRenderer {
  constructor(canvas, statsElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.statsElement = statsElement;
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    this.canvas.width = Math.floor(window.innerWidth * window.devicePixelRatio);
    this.canvas.height = Math.floor(window.innerHeight * window.devicePixelRatio);
    this.ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
  }

  draw(chunkStore, player, lighting) {
    const ctx = this.ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const sun = lighting.sun();
    ctx.fillStyle = '#071019';
    ctx.fillRect(0, 0, w, h);

    const camX = player.x * WORLD.tileSize - w / 2;
    const camY = player.y * WORLD.tileSize - h / 2;
    const minTX = Math.floor(camX / WORLD.tileSize) - 1;
    const minTY = Math.floor(camY / WORLD.tileSize) - 1;
    const maxTX = Math.ceil((camX + w) / WORLD.tileSize) + 1;
    const maxTY = Math.ceil((camY + h) / WORLD.tileSize) + 1;

    for (let ty = minTY; ty <= maxTY; ty++) {
      for (let tx = minTX; tx <= maxTX; tx++) {
        const cx = floorDiv(tx, WORLD.chunkSize);
        const cy = floorDiv(ty, WORLD.chunkSize);
        const lx = tx - cx * WORLD.chunkSize;
        const ly = ty - cy * WORLD.chunkSize;
        const chunk = chunkStore.get(cx, cy);
        const renderTile = chunk.renderTiles[ly * WORLD.chunkSize + lx];
        const east = chunkStore.tileAt(tx + 1, ty).climate.elevation;
        const south = chunkStore.tileAt(tx, ty + 1).climate.elevation;
        const slope = ((renderTile.elevation - east) * sun.shadowX + (renderTile.elevation - south) * sun.shadowY) * 1.8;
        const contour = Math.floor(renderTile.elevation * 18) !== Math.floor((renderTile.elevation - 0.012) * 18) ? 0.10 : 0;
        ctx.fillStyle = tint(shade(renderTile.color, (renderTile.elevation - 0.5) * 0.30 + slope + contour), sun.tint, sun.ambient);
        const sx = Math.floor(tx * WORLD.tileSize - camX);
        const sy = Math.floor(ty * WORLD.tileSize - camY - elevationLift(renderTile.elevation));
        ctx.fillRect(sx, sy, WORLD.tileSize, WORLD.tileSize + Math.ceil(elevationLift(renderTile.elevation) * 0.35));
      }
    }

    this.drawObjects(chunkStore, camX, camY, w, h, sun);
    this.drawPlayer(w, h);
    this.drawAtmosphere(sun, w, h);
  }

  drawObjects(chunkStore, camX, camY, w, h, sun) {
    const ctx = this.ctx;
    for (const chunk of chunkStore.chunks.values()) {
      for (const object of chunk.objects) {
        const tile = chunk.tiles[object.y * WORLD.chunkSize + object.x];
        const sx = (chunk.cx * WORLD.chunkSize + object.x) * WORLD.tileSize - camX;
        const sy = (chunk.cy * WORLD.chunkSize + object.y) * WORLD.tileSize - camY - elevationLift(tile.climate.elevation);
        if (sx < -20 || sy < -20 || sx > w + 20 || sy > h + 20) continue;
        ctx.fillStyle = `rgba(0,0,0,${0.28 * (1 - sun.height)})`;
        ctx.fillRect(sx + sun.shadowX * 12, sy + sun.shadowY * 12 + 10, 12, 5);
        drawObject(ctx, object.kind, sx, sy);
      }
    }
  }

  drawPlayer(w, h) {
    const ctx = this.ctx;
    ctx.fillStyle = '#f6f1d0';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1b1b1b';
    ctx.stroke();
  }

  drawAtmosphere(sun, w, h) {
    const ctx = this.ctx;
    ctx.fillStyle = `rgba(12,18,42,${Math.max(0, 0.36 - sun.height * 0.34)})`;
    ctx.fillRect(0, 0, w, h);
  }

  hud(chunkStore, player, lighting) {
    const tile = chunkStore.tileAt(player.x, player.y);
    const sun = lighting.sun();
    this.statsElement.innerHTML = `WASD/arrows move · R reset · M map · L pause sun<br>click overmap to teleport · position autosaves<br>seed ${WORLD.seed} · chunks ${chunkStore.chunks.size}<br>tile ${Math.floor(player.x)}, ${Math.floor(player.y)} · chunk ${floorDiv(player.x)}, ${floorDiv(player.y)}<br>biome ${tile.biome} · material ${tile.material}<br>surface ${tile.layers[3].detail}<br>elev ${tile.climate.elevation.toFixed(2)} lift ${elevationLift(tile.climate.elevation).toFixed(1)}<br>moist ${tile.climate.moisture.toFixed(2)} heat ${tile.climate.heat.toFixed(2)}<br>${sun.label} · light ${sun.ambient.toFixed(2)} · sun height ${sun.height.toFixed(2)}`;
  }
}

function drawObject(ctx, kind, sx, sy) {
  if (kind === 'tree') {
    ctx.fillStyle = '#12391f';
    ctx.beginPath();
    ctx.arc(sx + 8, sy + 8, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6b4928';
    ctx.fillRect(sx + 6, sy + 8, 4, 7);
  } else if (kind.includes('rock')) {
    ctx.fillStyle = '#555a5f';
    ctx.fillRect(sx + 4, sy + 5, 9, 8);
  } else if (kind === 'flower') {
    ctx.fillStyle = '#ffd6f2';
    ctx.fillRect(sx + 7, sy + 7, 3, 3);
  } else if (kind.includes('shrub') || kind === 'reed' || kind === 'grass_tuft') {
    ctx.fillStyle = '#244f27';
    ctx.fillRect(sx + 5, sy + 6, 7, 7);
  } else {
    ctx.fillStyle = '#7b5b35';
    ctx.fillRect(sx + 5, sy + 6, 8, 5);
  }
}

function elevationLift(elevation) {
  return Math.max(0, elevation - 0.35) * 18;
}

function tint(color, tintColor, ambient) {
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

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  r = Math.max(0, Math.min(255, r + amount * 255));
  g = Math.max(0, Math.min(255, g + amount * 255));
  b = Math.max(0, Math.min(255, b + amount * 255));
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
