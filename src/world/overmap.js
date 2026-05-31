import { WORLD } from '../core/constants.js';
import { getWorldSeed } from '../core/world-seed.js';
import { auditBiomesAround } from './biome-audit.js';
import { sampleRegionalMapChunk } from './regional-map.js';

export class OvermapController {
  constructor(element, player, chunkStore) {
    this.element = element;
    this.player = player;
    this.chunkStore = chunkStore;
    this.visible = true;
    this.size = 304;
    this.sampleChunks = this.size; // Spec-accurate local view: one overmap canvas pixel = one chunk.
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
    const px = Math.floor((event.clientX - rect.left) / rect.width * this.size);
    const py = Math.floor((event.clientY - rect.top) / rect.height * this.size);
    const { pcx, pcy } = this.playerChunk();
    const targetCx = pcx + (px - Math.floor(this.size / 2));
    const targetCy = pcy + (py - Math.floor(this.size / 2));
    this.player.x = targetCx * WORLD.chunkSize + WORLD.chunkSize / 2;
    this.player.y = targetCy * WORLD.chunkSize + WORLD.chunkSize / 2;
    this.redrawNeeded = true;
    this.chunkStore.streamAround(this.player.x, this.player.y);
  }

  draw(force = false) {
    if (!this.visible) return;
    const ctx = this.element.getContext('2d');
    const { pcx, pcy } = this.playerChunk();
    const centerKey = `${pcx},${pcy}`;
    if (!force && !this.redrawNeeded && centerKey === this.lastCenter) {
      this.drawOverlay(ctx, pcx, pcy);
      return;
    }
    this.lastCenter = centerKey;
    this.redrawNeeded = false;
    const image = ctx.createImageData(this.size, this.size);
    const half = Math.floor(this.size / 2);

    for (let py = 0; py < this.size; py++) {
      for (let px = 0; px < this.size; px++) {
        const cx = pcx + px - half;
        const cy = pcy + py - half;
        const sample = sampleRegionalMapChunk(cx, cy);
        const rgb = hexToRgb(sample.definition.color);
        const east = sampleRegionalMapChunk(cx + 1, cy).climate.elevation;
        const south = sampleRegionalMapChunk(cx, cy + 1).climate.elevation;
        const hill = Math.max(-35, Math.min(45, (sample.climate.elevation - 0.5) * 80 + (sample.climate.elevation - east) * 180 + (sample.climate.elevation - south) * 140));
        const index = (py * this.size + px) * 4;
        image.data[index] = clamp(rgb.r + hill);
        image.data[index + 1] = clamp(rgb.g + hill);
        image.data[index + 2] = clamp(rgb.b + hill);
        image.data[index + 3] = 255;
      }
    }

    ctx.putImageData(image, 0, 0);
    this.baseImage = ctx.getImageData(0, 0, this.size, this.size);
    this.drawOverlay(ctx, pcx, pcy);
  }

  playerChunk() {
    return {
      pcx: Math.floor(this.player.x / WORLD.chunkSize),
      pcy: Math.floor(this.player.y / WORLD.chunkSize)
    };
  }

  drawOverlay(ctx, pcx, pcy) {
    if (this.baseImage) ctx.putImageData(this.baseImage, 0, 0);
    const c = Math.floor(this.size / 2);
    const loadedRadius = WORLD.loadRadius;
    const loadedSize = loadedRadius * 2 + 1;

    // Distance rings are chunk distances because one overmap pixel is one chunk.
    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    ctx.lineWidth = 1;
    for (const chunks of [16, 32, 64, 128]) {
      ctx.beginPath();
      ctx.arc(c, c, chunks, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Current loaded chunk window: exactly the chunk radius currently streamed around the player.
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    ctx.fillRect(c - loadedRadius, c - loadedRadius, loadedSize, loadedSize);
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(c - loadedRadius - 0.5, c - loadedRadius - 0.5, loadedSize + 1, loadedSize + 1);

    // Current chunk is a single overmap pixel. The player marker is deliberately exaggerated around it.
    ctx.fillStyle = '#fffb9a';
    ctx.fillRect(c, c, 1, 1);
    ctx.strokeStyle = '#0b1720';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(c - 10, c);
    ctx.lineTo(c - 3, c);
    ctx.moveTo(c + 4, c);
    ctx.lineTo(c + 11, c);
    ctx.moveTo(c, c - 10);
    ctx.lineTo(c, c - 3);
    ctx.moveTo(c, c + 4);
    ctx.lineTo(c, c + 11);
    ctx.stroke();
    ctx.strokeStyle = '#fffb9a';
    ctx.lineWidth = 1;
    ctx.strokeRect(c - 3.5, c - 3.5, 8, 8);

    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    ctx.strokeRect(0, 0, this.size, this.size);

    const audit = auditBiomesAround(this.player, this.sampleChunks, 8);
    ctx.fillStyle = 'rgba(0,0,0,.66)';
    ctx.fillRect(6, this.size - 62, 232, 56);
    ctx.fillStyle = '#e8f6ff';
    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.fillText(`seed ${getWorldSeed()} · chunk ${pcx}, ${pcy}`, 10, this.size - 48);
    ctx.fillText(`1 map pixel = 1 chunk = ${WORLD.chunkSize}×${WORLD.chunkSize} tiles`, 10, this.size - 35);
    ctx.fillText(`loaded window ${loadedSize}×${loadedSize} chunks`, 10, this.size - 22);
    ctx.fillText(`seen ${audit.seen.length}/${audit.spec.length} · missing ${audit.missing.slice(0, 3).join(', ') || 'none'}`, 10, this.size - 9);
  }
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function clamp(value) {
  return Math.max(0, Math.min(255, value | 0));
}
