import { WORLD } from '../core/constants.js';
import { classifyBiome } from './biomes.js';
import { getWorldSeed } from '../core/world-seed.js';
import { auditBiomesAround } from './biome-audit.js';

export class OvermapController {
  constructor(element, player, chunkStore) {
    this.element = element;
    this.player = player;
    this.chunkStore = chunkStore;
    this.visible = true;
    this.size = 304;
    this.sampleChunks = 96;
    this.lastCenter = '';
    this.redrawNeeded = true;
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
    this.redrawNeeded = true;
    this.chunkStore.streamAround(this.player.x, this.player.y);
  }

  draw(force = false) {
    if (!this.visible) return;
    const ctx = this.element.getContext('2d');
    const pcx = Math.floor(this.player.x / WORLD.chunkSize);
    const pcy = Math.floor(this.player.y / WORLD.chunkSize);
    const centerKey = `${Math.floor(pcx / 4)},${Math.floor(pcy / 4)}`;
    if (!force && !this.redrawNeeded && centerKey === this.lastCenter) {
      this.drawPositionOverlay(ctx, pcx, pcy);
      return;
    }
    this.lastCenter = centerKey;
    this.redrawNeeded = false;
    const image = ctx.createImageData(this.size, this.size);

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
    this.baseImage = ctx.getImageData(0, 0, this.size, this.size);
    this.drawPositionOverlay(ctx, pcx, pcy);
  }

  drawPositionOverlay(ctx, pcx, pcy) {
    if (this.baseImage) ctx.putImageData(this.baseImage, 0, 0);
    const c = this.size / 2;
    ctx.strokeStyle = 'rgba(255,255,255,.22)';
    ctx.lineWidth = 1;
    for (const chunks of [8, 16, 32, 48]) {
      const r = chunks / this.sampleChunks * this.size;
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.beginPath();
    ctx.moveTo(c, 0);
    ctx.lineTo(c, this.size);
    ctx.moveTo(0, c);
    ctx.lineTo(this.size, c);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(c - 3, c - 10, 6, 20);
    ctx.fillRect(c - 10, c - 3, 20, 6);
    ctx.strokeStyle = '#0b1720';
    ctx.lineWidth = 2;
    ctx.strokeRect(c - 7, c - 7, 14, 14);
    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    ctx.strokeRect(0, 0, this.size, this.size);
    const audit = auditBiomesAround(this.player, this.sampleChunks, 4);
    ctx.fillStyle = 'rgba(0,0,0,.62)';
    ctx.fillRect(6, this.size - 48, 192, 42);
    ctx.fillStyle = '#e8f6ff';
    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.fillText(`seed ${getWorldSeed()} chunk ${pcx}, ${pcy}`, 10, this.size - 34);
    ctx.fillText(`seen ${audit.seen.length}/${audit.spec.length} biomes`, 10, this.size - 21);
    ctx.fillText(`missing ${audit.missing.slice(0, 4).join(', ') || 'none'}`, 10, this.size - 9);
  }
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function clamp(value) {
  return Math.max(0, Math.min(255, value | 0));
}
