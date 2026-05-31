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

  draw(chunkStore, player) {
    const ctx = this.ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;
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
        const renderTile = chunkStore.get(cx, cy).renderTiles[ly * WORLD.chunkSize + lx];
        ctx.fillStyle = shade(renderTile.color, (renderTile.elevation - 0.5) * 0.28);
        ctx.fillRect(Math.floor(tx * WORLD.tileSize - camX), Math.floor(ty * WORLD.tileSize - camY), WORLD.tileSize, WORLD.tileSize);
      }
    }

    this.drawObjects(chunkStore, camX, camY, w, h);
    this.drawPlayer(w, h);
  }

  drawObjects(chunkStore, camX, camY, w, h) {
    for (const chunk of chunkStore.chunks.values()) {
      for (const object of chunk.objects) {
        const sx = (chunk.cx * WORLD.chunkSize + object.x) * WORLD.tileSize - camX;
        const sy = (chunk.cy * WORLD.chunkSize + object.y) * WORLD.tileSize - camY;
        if (sx < -20 || sy < -20 || sx > w + 20 || sy > h + 20) continue;
        drawObject(this.ctx, object.kind, sx, sy);
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

  hud(chunkStore, player) {
    const tile = chunkStore.tileAt(player.x, player.y);
    this.statsElement.innerHTML = `WASD / arrows to move<br>seed ${WORLD.seed} · chunks ${chunkStore.chunks.size}<br>tile ${Math.floor(player.x)}, ${Math.floor(player.y)} · chunk ${floorDiv(player.x)}, ${floorDiv(player.y)}<br>biome ${tile.biome} · material ${tile.material}<br>surface ${tile.layers[3].detail}<br>elev ${tile.climate.elevation.toFixed(2)} moist ${tile.climate.moisture.toFixed(2)} heat ${tile.climate.heat.toFixed(2)}`;
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
