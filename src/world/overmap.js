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
    // A teleport is a discontinuity: force the destination's biome + F2-F6 asset preload NOW.
    // Without this the only preload is the throttled 128-frame initPreload tick (gated by a
    // 15-chunk guard), so decoration sprites are missing — sometimes permanently — after a jump.
    const provider = this.chunkStore.provider;
    if (provider && provider.initPreload) provider.initPreload(this.player.x, this.player.y, true);
  }

  draw(force = false) {
    if (!this.visible) return;
    const ctx = this.element.getContext('2d', { alpha: false, willReadFrequently: false });
    const { pcx, pcy } = this.playerChunk();
    const cs = this.chunkScale;
    // Snap the base-map center to a chunkScale-aligned chunk grid. Then a recenter is
    // always a whole-PIXEL shift (cs chunks == 1 base pixel), so we can SCROLL the cached
    // image and resample only the newly-exposed strip instead of the whole 152x152 grid.
    // (Without the snap, a 1-chunk recenter at chunkScale=2 is a half-pixel shift and the
    // scrolled image would sample the wrong chunk parity.) A walk probe measured the old
    // full resample at ~925-1075ms SYNCHRONOUS on the rAF thread per recenter — the 1200ms
    // throttle only capped its frequency. The strip path is a few rows of work per recenter.
    const bcx = Math.round(pcx / cs) * cs;
    const bcy = Math.round(pcy / cs) * cs;

    const noBase = this.baseCx === undefined || this.baseCy === undefined;
    const dpx = noBase ? 0 : (this.baseCx - bcx) / cs;
    const dpy = noBase ? 0 : (this.baseCy - bcy) / cs;
    // A jump larger than the map can't be scrolled (no overlap) — full resample. This is
    // the first build, an expand (force), and teleports; not the walking hot path.
    const farJump = noBase || Math.abs(dpx) >= this.size || Math.abs(dpy) >= this.size;

    if (force || this.redrawNeeded || farJump) {
      this._resampleRect(bcx, bcy, 0, 0, this.size, this.size);
      this.baseCx = bcx; this.baseCy = bcy;
      this.redrawNeeded = false;
    } else if (dpx !== 0 || dpy !== 0) {
      // Scroll the cached base by the integer-pixel delta, then fill the exposed L-strip.
      this.baseCtx.drawImage(this.baseCanvas, dpx, dpy);
      this.baseCx = bcx; this.baseCy = bcy;
      if (dpx > 0) this._resampleRect(bcx, bcy, 0, 0, dpx, this.size);
      else if (dpx < 0) this._resampleRect(bcx, bcy, this.size + dpx, 0, -dpx, this.size);
      if (dpy > 0) this._resampleRect(bcx, bcy, 0, 0, this.size, dpy);
      else if (dpy < 0) this._resampleRect(bcx, bcy, 0, this.size + dpy, this.size, -dpy);
    }
    this.lastCenter = `${pcx},${pcy}`;
    this.drawOverlay(ctx, pcx, pcy);
  }

  // Resample the [x0,x0+w) x [y0,y0+h) window of the base image, sampling regional chunks
  // around the snapped center (bcx,bcy). Pulled out of draw() so a recenter can refill just
  // the newly-exposed strip. Cost scales with w*h, so a 1-pixel scroll is ~one row of work.
  _resampleRect(bcx, bcy, x0, y0, w, h) {
    if (w <= 0 || h <= 0) return;
    const cs = this.chunkScale;
    const half = Math.floor(this.size / 2);
    const image = this.baseCtx.createImageData(w, h);
    const data = image.data;
    for (let yy = 0; yy < h; yy++) {
      const py = y0 + yy;
      for (let xx = 0; xx < w; xx++) {
        const px = x0 + xx;
        const cx = bcx + (px - half) * cs;
        const cy = bcy + (py - half) * cs;
        const sample = sampleRegionalMapChunk(cx, cy);
        const rgb = hexToRgb(sample.definition.color);
        const east = sampleRegionalMapChunk(cx + cs, cy).climate.elevation;
        const south = sampleRegionalMapChunk(cx, cy + cs).climate.elevation;
        const hill = Math.max(-35, Math.min(45, (sample.climate.elevation - 0.5) * 80 + (sample.climate.elevation - east) * 180 + (sample.climate.elevation - south) * 140));
        const idx = (yy * w + xx) * 4;
        data[idx] = clamp(rgb.r + hill);
        data[idx + 1] = clamp(rgb.g + hill);
        data[idx + 2] = clamp(rgb.b + hill);
        data[idx + 3] = 255;
      }
    }
    this.baseCtx.putImageData(image, x0, y0);
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

    // Structure markers (debug, gated on the sim debug overlay toggle, key 9).
    // HONEST LIMIT: the sim only sends entities inside the attention bubble —
    // distant settlements are absent here, never synthesized.
    const dbg = (typeof window !== 'undefined') ? window._simDebugOverlay : null;
    const sim = (typeof window !== 'undefined') ? window._simClient : null;
    if (dbg?.isEnabled() && sim?.entities) {
      const chunkPx = tile => ({
        x: c + (tile.x / WORLD.chunkSize - pcx) / this.chunkScale,
        y: c + (tile.y / WORLD.chunkSize - pcy) / this.chunkScale,
      });
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      for (const e of sim.entities.values()) {
        if (e.type !== 'settlement' || !e.territory) continue;
        const p = chunkPx(e);
        if (p.x < 0 || p.y < 0 || p.x > this.size || p.y > this.size) continue;
        ctx.fillStyle = e.tier === 'ghost' ? 'rgba(160,160,160,0.95)' : '#ffd24a';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillText(e.tier.toUpperCase(), p.x, p.y - 5);
      }
    }

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
