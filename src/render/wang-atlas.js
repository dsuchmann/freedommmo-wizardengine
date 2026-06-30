// src/render/wang-atlas.js
// Owns the GL atlas of 32x32 Wang base tiles, keyed (biome-asset, wang level, cornerMask). Pure slot key
// below is unit-tested; the GL build/upload (a later task) attaches to the WangAtlas class.
export function wangSlotKey(biomeAsset, level, cornerMask) {
  return biomeAsset + '|' + level + '|' + (cornerMask & 63);
}

/**
 * WangAtlas — owns the GL Wang-tile atlas (one RGBA8 texture, default 2048²).
 * Slot 0 is RESERVED = empty/none; real tiles receive slots 1, 2, 3, …
 * The index-map texels (see src/render/gpu-terrain-index.js) store these slot
 * integers so the terrain shader can look up the correct 32×32 tile in one UV
 * indirection. UVs use a half-texel inset (s = 0.5 / atlasSize) so NEAREST
 * sampling never bleeds into the adjacent tile's 1-px gutter column.
 */
export class WangAtlas {
  constructor(gl, atlasSize = 2048) {
    this.gl = gl;
    this.atlasSize = atlasSize;
    this.cell = 33; // 32px tile + 1px gutter

    // Shelf-packer state (mirrors gl-compositor atlasStrip)
    this._shelfX = 1;
    this._shelfY = 1;
    this._shelfH = 0;

    // Slot registry: wangSlotKey → {slot, u0, v0}
    this._slots = new Map();
    this._nextSlot = 1; // slot 0 is RESERVED = empty/none; never assigned

    // Allocate the atlas texture once
    this._tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, atlasSize, atlasSize, 0,
                  gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /**
   * Pack one 32×32 imageBitmap into the atlas and return its integer slot.
   * Idempotent: the same (biomeAsset, level, cornerMask) always returns the
   * same slot on subsequent calls without re-uploading.
   * Returns 0 if the atlas is full (caller should treat as "no tile").
   */
  add(biomeAsset, level, cornerMask, imageBitmap) {
    const key = wangSlotKey(biomeAsset, level, cornerMask);
    const existing = this._slots.get(key);
    if (existing) return existing.slot;

    const A = this.atlasSize;

    // Wrap to next shelf when this tile won't fit horizontally
    if (this._shelfX + 32 > A) {
      this._shelfY += this._shelfH + 1;
      this._shelfX = 1;
      this._shelfH = 0;
    }
    // Atlas full — return 0, don't crash
    if (this._shelfY + 32 > A) return 0;

    const x0 = this._shelfX, y0 = this._shelfY;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    try {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, gl.RGBA, gl.UNSIGNED_BYTE, imageBitmap);
    } catch (e) {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      return 0;
    }
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    // Advance shelf cursor; update running shelf height
    this._shelfX += this.cell;
    if (32 > this._shelfH) this._shelfH = 32;

    // Compute UVs with half-texel inset (NEAREST — avoids gutter bleed)
    const s = 0.5;
    const u0 = (x0 + s) / A;
    const v0 = (y0 + s) / A;
    const slot = this._nextSlot++;
    this._slots.set(key, { slot, u0, v0 });
    return slot;
  }

  /** Return {u0, v0} for a slot integer, or {u0:0, v0:0} for slot 0 / unknown. */
  slotUV(slot) {
    if (!slot) return { u0: 0, v0: 0 };
    for (const entry of this._slots.values()) {
      if (entry.slot === slot) return { u0: entry.u0, v0: entry.v0 };
    }
    return { u0: 0, v0: 0 };
  }

  /** Return the underlying GL texture handle. */
  texture() {
    return this._tex;
  }

  /**
   * Return a plain-object snapshot suitable for postMessage to workers and
   * for handing to the compositor so they can resolve slot integers to UVs
   * without holding a reference to this object or the GL context.
   */
  serializeMeta() {
    const slots = {};
    for (const [key, val] of this._slots) {
      slots[key] = val;
    }
    return { cell: this.cell, atlasSize: this.atlasSize, slots };
  }
}
