export class ImageAtlas {
  constructor(sheetDefs = []) {
    this.cell = 32;
    this.sheets = new Map();
    this.frames = new Map();
    for (const def of sheetDefs) this.register(def);
  }

  register(def) {
    const image = new Image();
    image.decoding = 'async';
    image.loading = 'eager';
    const record = { ...def, image, loaded: false, failed: false, requestedAt: performance.now?.() ?? Date.now() };
    image.onload = () => { record.loaded = true; record.loadedAt = performance.now?.() ?? Date.now(); };
    image.onerror = () => { record.failed = true; record.failedAt = performance.now?.() ?? Date.now(); console.warn('[assets] failed to load', def.id, def.src); };
    image.src = def.src;
    this.sheets.set(def.id, record);
    for (const row of def.rows ?? []) {
      this.frames.set(row.id, { sheetId: def.id, row: row.row, col: row.col ?? 0, x: row.x, y: row.y, w: row.w, h: row.h, cell: def.cell ?? 32, frames: row.frames ?? def.frames ?? 8, fullImage: row.fullImage ?? def.fullImage ?? false });
    }
  }

  has(id) {
    const frame = this.frames.get(id);
    if (!frame) return false;
    const sheet = this.sheets.get(frame.sheetId);
    return Boolean(sheet?.loaded && !sheet.failed);
  }

  frame(id, frameIndex = 0) {
    const frame = this.frames.get(id);
    if (!frame) return null;
    const sheet = this.sheets.get(frame.sheetId);
    if (!sheet?.loaded || sheet.failed) return null;
    if (frame.fullImage) {
      return { image: sheet.image, sx: 0, sy: 0, sw: sheet.image.naturalWidth || sheet.image.width, sh: sheet.image.naturalHeight || sheet.image.height };
    }
    if (Number.isFinite(frame.x) && Number.isFinite(frame.y)) {
      return { image: sheet.image, sx: frame.x, sy: frame.y, sw: frame.w ?? frame.cell, sh: frame.h ?? frame.cell };
    }
    const cell = frame.cell;
    return {
      image: sheet.image,
      sx: ((Math.floor(frameIndex) % frame.frames) + frame.col) * cell,
      sy: frame.row * cell,
      sw: cell,
      sh: cell
    };
  }

  sourceForFrame(id) {
    const frame = this.frames.get(id);
    const sheet = frame ? this.sheets.get(frame.sheetId) : null;
    return sheet?.src ?? null;
  }

  stats() {
    let loaded = 0;
    let failed = 0;
    const failedSources = [];
    for (const sheet of this.sheets.values()) {
      if (sheet.loaded) loaded++;
      if (sheet.failed) {
        failed++;
        if (failedSources.length < 20) failedSources.push(sheet.src);
      }
    }
    return { sheets: this.sheets.size, loaded, failed, frames: this.frames.size, failedSources };
  }
}
