import { WORLD } from '../core/constants.js';
import { classifyBiome } from './biomes.js';

export class OvermapController {
  constructor(element, player, chunkStore) {
    this.element = element;
    this.player = player;
    this.chunkStore = chunkStore;
    this.visible = true;
    this.size = 176;
    this.sampleChunks = 48;
    element.width = this.size;
    element.height = this.size;
    element.addEventListener('click', event => this.teleportFromClick(event));
  }

  toggle() {
    this.visible = !this.visible;
    this.element.style.display = this.visible ? 'block' : 'none';
  }

  teleportFromClick(event) {
    const rect = this.element.getBoundingClientRect();
    const nx = (event.clientX - rect.left) / rect.width - 0.5;
    const ny = (event.clientY - rect.top) / rect.height - 0.5;
    const pcx = Math.floor(this.player.x / WORLD.chunkSize);
    const pcy = Math.floor(this.player.y / WORLD.chunkSize);
    const targetCx = pcx + Math.round(nx * this.sampleChunks);
    const targetCy = pcy + Math.round(ny * this.sampleChunks);
    this.player.x = targetCx * WORLD.chunkSize + WORLD.chunkSize / 2;
    this.player.y = targetCy * WORLD.chunkSize + WORLD.chunkSize / 2;
    this.chunkStore.streamAround(this.player.x, this.player.y);
  }

  draw() {
    if (!this.visible) return;
    const ctx = this.element.getContext('2d');
    const image = ctx.createImageData(this.size, this.size);
    const pcx = Math.floor(this.player.x / WORLD.chunkSize);
    const pcy = Math.floor(this.player.y / WORLD.chunkSize);

    for (let py = 0; py < this.size; py++) {
      for (let px = 0; px < this.size; px++) {
        const ox = (px / this.size - 0.5) * this.sampleChunks;
        const oy = (py / this.size - 0.5) * this.sampleChunks;
        const wx = Math.floor((pcx + ox) * WORLD.chunkSize + WORLD.chunkSize / 2);
        const wy = Math.floor((pcy + oy) * WORLD.chunkSize + WORLD.chunkSize / 2);
        const sample = classifyBiome(wx, wy);
        const rgb = hexToRgb(sample.definition.color);
        const hill = Math.max(-35, Math.min(45, (sample.climate.elevation - 0.5) * 95));
        const index = (py * this.size + px) * 4;
        image.data[index] = clamp(rgb.r + hill);
        image.data[index + 1] = clamp(rgb.g + hill);
        image.data[index + 2] = clamp(rgb.b + hill);
        image.data[index + 3] = 255;
      }
    }

    ctx.putImageData(image, 0, 0);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(this.size / 2 - 4, this.size / 2 - 4, 8, 8);
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.strokeRect(0, 0, this.size, this.size);
  }
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function clamp(value) {
  return Math.max(0, Math.min(255, value | 0));
}
