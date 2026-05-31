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
    const record = { ...def, image, loaded: false, failed: false };
    image.onload = () => { record.loaded = true; };
    image.onerror = () => { record.failed = true; };
    image.src = def.src;
    this.sheets.set(def.id, record);
    for (const row of def.rows ?? []) {
      this.frames.set(row.id, { sheetId: def.id, row: row.row, cell: def.cell ?? 32, frames: row.frames ?? def.frames ?? 8 });
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
    const cell = frame.cell;
    return {
      image: sheet.image,
      sx: (Math.floor(frameIndex) % frame.frames) * cell,
      sy: frame.row * cell,
      sw: cell,
      sh: cell
    };
  }

  stats() {
    let loaded = 0;
    let failed = 0;
    for (const sheet of this.sheets.values()) {
      if (sheet.loaded) loaded++;
      if (sheet.failed) failed++;
    }
    return { sheets: this.sheets.size, loaded, failed, frames: this.frames.size };
  }
}
