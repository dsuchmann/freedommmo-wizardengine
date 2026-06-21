// sim/test/occluder-rects.test.js — pure rect math + headless draw of the building wall engine.
//
// Locks the asset-independent geometry fixes in src/render/building-occluder.js:
//   FIX 1 (vertical stretch): the legacy (non-pilot) facade crop must sample the FULL 32x128 source
//     (0,0,W,128) — NOT the old (0,8,W,112) 16-row strip stretched into the 4-tile dest (~14% too
//     tall). Asserted on cropBox (pure) AND on the emitted drawImage source-rect of the real engine.
//
// The engine integration drives the REAL drawWalls() through a recording-canvas shim + an Image
// shim so the stone_brick fallback (building-renderer.getWallImg) resolves headlessly (precedent:
// sim/test/water-foam-render.test.js drives the real foam pass through a recording ctx).

import { test } from 'node:test';
import assert from 'node:assert/strict';

// --- DOM/Image shim (set BEFORE importing the render modules, like water-foam-render.test.js) ---
// Image: any .src synchronously "loads" as a 32x128 strip so getWallImg returns a usable sprite.
globalThis.window = globalThis.window || {};
globalThis.Image = class {
  constructor() { this.complete = false; this.naturalWidth = 0; this.naturalHeight = 0; }
  set src(v) { this._src = v; this.naturalWidth = 32; this.naturalHeight = 128; this.complete = true; if (this.onload) this.onload(); }
  get src() { return this._src; }
};

const { cropBox, drawWalls } = await import('../../src/render/building-occluder.js');
const { ensureFloorImages } = await import('../../src/render/building-renderer.js');
ensureFloorImages(); // populates the stone_brick fallback wall sprites via the Image shim

// Recording 2D context: captures every drawImage's 9 args (img, sx,sy,sw,sh, dx,dy,dw,dh).
function recCtx() {
  const calls = [];
  return {
    globalCompositeOperation: 'source-over', imageSmoothingEnabled: false, fillStyle: '#000',
    drawImage(...a) { calls.push(a); },
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    translate() {}, rotate() {}, scale() {}, fillRect() {},
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    _calls: calls,
  };
}

// ── FIX 1: cropBox is isotropic (full height, no 16-row strip) ─────────────────────────
test('cropBox crops the FULL source (no 0,8,...,112 strip) so source aspect == dest aspect', () => {
  const c = cropBox(32, 128, 100, 50, 32, 128);
  assert.equal(c.sy, 0, 'crops from row 0, not row 8');
  assert.equal(c.sh, 128, 'crops the full 128 source rows, not 112');
  assert.equal(c.sx, 0);
  assert.equal(c.sw, 32);
  // anisotropy = (sw/sh)/(dw/dh) must be ~1 (was 128/112 ≈ 1.143 with the old crop->full-dest)
  const aniso = (c.sw / c.sh) / (c.dw / c.dh);
  assert.ok(Math.abs(aniso - 1) < 0.02, `aspect must match within 2%, got ${aniso}`);
});

// ── ENGINE INTEGRATION: drive the REAL drawWalls() and inspect emitted draws ────────────
// A 3-wide x 2-deep single-storey fallback building (no biome/wallSlug → stone_brick path,
// isPilot=false because the shim sprite is 32 wide < 96). No doors → plain south_base run.
function fakeBuilding(w = 3, h = 2) {
  return {
    x: 100, y: 100, biome: null, wallSlug: null,
    footprint: { boundingBox: { w, h }, sections: [{ x0: 0, y0: 0, w, h }], doors: [] },
  };
}

// Camera placed so the building (world tile x≈100,y≈100) lands near the top-left of the viewport.
const TILEPX = 62.4;
const CAMX = Math.round(100 * TILEPX) - 80; // building left edge ~80px from screen-left
const CAMY = Math.round(100 * TILEPX) - 300; // wall top (rises wH=250 above baseline) on-screen

test('drawWalls (real engine) emits the FULL (0,0,32,128) source rect — no 16-row strip (fix #1)', () => {
  const ctx = recCtx();
  drawWalls(ctx, fakeBuilding(), CAMX, CAMY, TILEPX, 1200, 900);
  assert.ok(ctx._calls.length > 0, 'engine emitted at least one drawImage');
  // Every legacy facade draw must crop (0,0,32,128) — never (0,8,*,112).
  for (const a of ctx._calls) {
    if (a[8] < 100) continue; // skip the thin E/W edge trim (rotated strip, small dest height)
    assert.equal(a[1], 0, 'source x = 0');
    assert.equal(a[2], 0, `source y must be 0 (full height), got ${a[2]}`);
    assert.equal(a[3], 32, 'source w = 32 (full strip width)');
    assert.equal(a[4], 128, `source h must be 128 (full height), got ${a[4]}`);
  }
});

test('drawWalls runs clean (no throw) on a fallback stone_brick building', () => {
  const ctx = recCtx();
  assert.doesNotThrow(() => drawWalls(ctx, fakeBuilding(), 0, 0, 32, 800, 600));
});
