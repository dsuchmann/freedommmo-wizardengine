import { WORLD } from '../core/constants.js';
import { sampleRegionalMapChunk } from './regional-map.js';

export class OvermapController {
  constructor(element, player, chunkStore) {
    this.element = element;
    this.player = player;
    this.chunkStore = chunkStore;
    this.visible = true;
    this.expanded = false;
    this.wrap = element.parentElement;
    // Render the overmap at half display resolution; CSS scales it to 304px.
    // This avoids a 300k+ sample burst every time the player enters a chunk.
    this.smallSize = 152;
    this.expandedSize = 600;
    this.size = this.smallSize;
    // chunkScale: chunks per pixel. 2 = every pixel covers 2 chunks (zoomed out).
    // 1 = one pixel per chunk (full detail).
    this.smallScale = 2;
    this.expandedScale = 1;
    this.chunkScale = this.smallScale;
    this.sampleChunks = this.size;
    this.lastCenter = '';
    this.redrawNeeded = true;
    this.lastFullRedrawAt = 0;
    this.baseCanvas = document.createElement('canvas');
    this.baseCanvas.width = this.size;
    this.baseCanvas.height = this.size;
    this.baseCtx = this.baseCanvas.getContext('2d', { alpha: false, willReadFrequently: false });
    element.width = this.size;
    element.height = this.size;
    element.addEventListener('click', event => this.teleportFromClick(event));
  }

  toggle() {
    this.visible = !this.visible;
    this.element.style.display = this.visible ? 'block' : 'none';
    if (!this.visible && this.expanded) this.toggleExpand();
  }

  toggleExpand() {
    if (!this.visible) return;
    this.expanded = !this.expanded;
    this.wrap.classList.toggle('expanded', this.expanded);
    this.size = this.expanded ? this.expandedSize : this.smallSize;
    this.chunkScale = this.expanded ? this.expandedScale : this.smallScale;
    this.sampleChunks = this.size;
    this.element.width = this.size;
    this.element.height = this.size;
    this.baseCanvas.width = this.size;
    this.baseCanvas.height = this.size;
    this.lastCenter = '';
    this.redrawNeeded = true;
    this.draw(true);
  }

  teleportFromClick(event) {
    const rect = this.element.getBoundingClientRect();
    const px = Math.floor((event.clientX - rect.left) / rect.width * this.size);
    const py = Math.floor((event.clientY - rect.top) / rect.height * this.size);
    const { pcx, pcy } = this.playerChunk();
    const targetCx = pcx + (px - Math.floor(this.size / 2)) * this.chunkScale;
    const targetCy = pcy + (py - Math.floor(this.size / 2)) * this.chunkScale;
    this.player.x = targetCx * WORLD.chunkSize + WORLD.chunkSize / 2;
    this.player.y = targetCy * WORLD.chunkSize + WORLD.chunkSize / 2;
    this.redrawNeeded = true;
    this.chunkStore.streamAround(this.player.x, this.player.y);
  }

  draw(force = false) {
    if (!this.visible) return;
    const ctx = this.element.getContext('2d', { alpha: false, willReadFrequently: false });
    const { pcx, pcy } = this.playerChunk();
    const centerKey = `${pcx},${pcy}`;
    if (!force && !this.redrawNeeded && centerKey === this.lastCenter) {
      this.drawOverlay(ctx, pcx, pcy);
      return;
    }
    // Full overmap redraws are expensive; defer/throttle them so crossing a
    // chunk boundary never coincides with a costly 152x152 regional resample.
    const now = performance.now();
    if (!force && centerKey !== this.lastCenter && now - this.lastFullRedrawAt < 1200) {
      this.drawOverlay(ctx, pcx, pcy);
      return;
    }
    this.lastFullRedrawAt = now;
    this.lastCenter = centerKey;
    this.redrawNeeded = false;
    const image = ctx.createImageData(this.size, this.size);
    const half = Math.floor(this.size / 2);

    for (let py = 0; py < this.size; py++) {
      for (let px = 0; px < this.size; px++) {
        const cx = pcx + (px - half) * this.chunkScale;
        const cy = pcy + (py - half) * this.chunkScale;
        const sample = sampleRegionalMapChunk(cx, cy);
        const rgb = hexToRgb(sample.definition.color);
        const east = sampleRegionalMapChunk(cx + this.chunkScale, cy).climate.elevation;
        const south = sampleRegionalMapChunk(cx, cy + this.chunkScale).climate.elevation;
        const hill = Math.max(-35, Math.min(45, (sample.climate.elevation - 0.5) * 80 + (sample.climate.elevation - east) * 180 + (sample.climate.elevation - south) * 140));
        const index = (py * this.size + px) * 4;
        image.data[index] = clamp(rgb.r + hill);
        image.data[index + 1] = clamp(rgb.g + hill);
        image.data[index + 2] = clamp(rgb.b + hill);
        image.data[index + 3] = 255;
      }
    }

    this.baseCtx.putImageData(image, 0, 0);
    ctx.drawImage(this.baseCanvas, 0, 0);
    this.drawOverlay(ctx, pcx, pcy);
  }

  playerChunk() {
    return {
      pcx: Math.floor(this.player.x / WORLD.chunkSize),
      pcy: Math.floor(this.player.y / WORLD.chunkSize)
    };
  }

  drawOverlay(ctx, pcx, pcy) {
    if (this.baseCanvas) ctx.drawImage(this.baseCanvas, 0, 0);
    const c = Math.floor(this.size / 2);
    const scale = this.chunkScale;
    const loadedRadius = Math.max(1, Math.ceil(WORLD.loadRadius / scale));
    const loadedSize = loadedRadius * 2 + 1;

    // Distance rings in chunk units, scaled to pixels.
    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    ctx.lineWidth = 1;
    for (const chunkDist of [16, 32, 64, 128, 256]) {
      const r = chunkDist / scale;
      if (r > this.size) continue;
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Current loaded chunk window.
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

    // Text diagnostics live in the main HUD only; keep minimap visual-only.
  }
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function clamp(value) {
  return Math.max(0, Math.min(255, value | 0));
}
