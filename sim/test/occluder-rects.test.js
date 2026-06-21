// sim/test/occluder-rects.test.js — pure rect math + headless draw of the building wall engine.
//
// Locks the two asset-independent geometry fixes in src/render/building-occluder.js:
//   FIX 1 (vertical stretch): the legacy (non-pilot) facade crop must sample the FULL 32x128 source
//     (0,0,W,128) — NOT the old (0,8,W,112) 16-row strip stretched into the 4-tile dest (~14% too
//     tall). Asserted on cropBox (pure) AND on the emitted drawImage source-rect of the real engine.
//   FIX 2 (tile seams): adjacent tiles' dest-x extents must be CONTIGUOUS (tile N's dx+dw == tile
//     N+1's dx) — no fixed t+wp pad over a rounded origin that double-paints a seam column at
//     non-integer tilePx. Asserted on tileExtent (pure) AND on the real engine's south-wall draws.
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
// No OffscreenCanvas / document needed for drawWalls (caller passes the ctx in).

const { cropBox, tileExtent, drawWalls, runBondVariant, ewQuoinRect } = await import('../../src/render/building-occluder.js');
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

// ── FIX 2: tileExtent — adjacent tiles share their boundary pixel (no gap, no overlap) ──
test('tileExtent: adjacent tiles share their boundary (no gap, no overlap)', () => {
  const tilePx = 62.4, camX = 137.7; // non-integer tilePx — where the old +wp pad double-painted
  for (let wx = 5; wx < 12; wx++) {
    const a = tileExtent(wx, tilePx, camX, 1);
    const b = tileExtent(wx + 1, tilePx, camX, 1);
    assert.equal(a.dx + a.dw, b.dx, `tile ${wx} right edge must equal tile ${wx + 1} left edge`);
    assert.ok(a.dw >= 1, 'extent at least 1px');
  }
});

test('tileExtent: a 2-span piece exactly bridges two single-tile boundaries (no pad)', () => {
  const tilePx = 62.4, camX = 137.7, wx = 7;
  const span2 = tileExtent(wx, tilePx, camX, 2);
  const t0 = tileExtent(wx, tilePx, camX, 1);
  const t1 = tileExtent(wx + 1, tilePx, camX, 1);
  assert.equal(span2.dx, t0.dx, '2-span starts at the same left boundary');
  assert.equal(span2.dx + span2.dw, t1.dx + t1.dw, '2-span ends at the second tile right boundary');
  assert.equal(span2.dw, t0.dw + t1.dw, '2-span width is exactly the two single-tile widths combined');
});

test('tileExtent: boundary widths vary (not the fixed old t+wp pad) across columns', () => {
  // At a non-integer tilePx the per-column boundary width alternates 62/63, so the FIXED old
  // dest width (round(62.4)+1 = 63) was wrong on ~half the columns — the source of the seam.
  const tilePx = 62.4, camX = 137.7, oldPad = Math.round(tilePx) + 1; // 63
  const widths = new Set();
  for (let wx = 5; wx < 20; wx++) widths.add(tileExtent(wx, tilePx, camX, 1).dw);
  assert.ok(widths.size > 1, 'boundary widths vary by column (a fixed pad cannot be right for all)');
  assert.ok([...widths].some(dw => dw !== oldPad), 'some column width differs from the old fixed pad');
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
    assert.equal(a[1], 0, 'source x = 0');
    assert.equal(a[2], 0, `source y must be 0 (full height), got ${a[2]}`);
    assert.equal(a[3], 32, 'source w = 32 (full strip width)');
    assert.equal(a[4], 128, `source h must be 128 (full height), got ${a[4]}`);
  }
});

test('drawWalls (real engine): adjacent south-wall tiles are dest-x contiguous — no seam (fix #2)', () => {
  const ctx = recCtx();
  const b = fakeBuilding(5, 2); // 5-wide so we get several interior base tiles in a row
  drawWalls(ctx, b, CAMX, CAMY, TILEPX, 1200, 900);
  assert.ok(ctx._calls.length > 0, 'engine emitted draws');

  // The emitted dest-x extents must equal the boundary-derived extents (NOT the old fixed pad),
  // proving the engine threads tileExtent through. For each world column the engine draws a tile
  // at the rounded boundary dx with a boundary-derived width.
  const oldPad = Math.round(TILEPX) + 1; // 63 — the pre-fix fixed dest width

  // Isolate ONE full-height wall row (the north run): full wall height dh (excludes the thin E/W
  // edge trim, dh≈26) and single-tile width (excludes the 2-span door/window). Group by dest-y so
  // we compare a single contiguous horizontal run; pick the row with the most columns.
  const fullH = Math.max(...ctx._calls.map(a => a[8])); // 251 — the wall height in px
  const rows = new Map();
  for (const a of ctx._calls) {
    const dx = a[5], dy = a[6], dw = a[7], dh = a[8];
    if (dh !== fullH) continue;               // skip the thin E/W edge trim
    if (dw > Math.ceil(TILEPX) + 1) continue; // skip the 2-span door/window pieces
    const row = rows.get(dy) || new Map();
    if (!row.has(dx)) row.set(dx, dw);        // de-dupe corner+base stacked on one column
    rows.set(dy, row);
  }
  // Pick the row with the most distinct columns (the full north or south run).
  let best = null;
  for (const row of rows.values()) if (!best || row.size > best.size) best = row;
  const cols = [...best.entries()].map(([dx, dw]) => ({ dx, dw })).sort((p, q) => p.dx - q.dx);
  assert.ok(cols.length >= 3, `expected several single-tile columns, got ${cols.length}`);

  // Contiguity: each tile's right edge meets the next tile's left edge exactly (no seam, no gap).
  for (let i = 0; i + 1 < cols.length; i++) {
    const gap = cols[i + 1].dx - (cols[i].dx + cols[i].dw);
    assert.equal(gap, 0, `emitted tiles must be contiguous (col ${i}->${i + 1}: gap ${gap})`);
  }

  // And the engine's widths are boundary-derived, not the constant old pad: with a non-integer
  // tilePx the boundary widths vary by column, so they CANNOT all equal the old fixed 63.
  const widths = new Set(cols.map(c => c.dw));
  assert.ok(widths.size > 1 || !widths.has(oldPad),
    'widths vary by column / are not the old fixed pad (boundary-derived)');
});

test('drawWalls runs clean (no throw) on a fallback stone_brick building', () => {
  const ctx = recCtx();
  assert.doesNotThrow(() => drawWalls(ctx, fakeBuilding(), 0, 0, 32, 800, 600));
});

// ── FIX 3: runBondVariant — deterministic per-column variant pick (breaks the 32px repeat) ──
test('runBondVariant is deterministic and in-range; not constant across columns', () => {
  // 1 variant -> always 0 (no run-bond art)
  for (let c = 0; c < 10; c++) assert.equal(runBondVariant(c, 1), 0);
  // n variants -> stable per column, within [0,n)
  const seen = new Set();
  for (let c = 0; c < 64; c++) {
    const v = runBondVariant(c, 4);
    assert.ok(v >= 0 && v < 4, `variant in range for col ${c}`);
    assert.equal(runBondVariant(c, 4), v, 'deterministic for the same column');
    seen.add(v);
  }
  assert.ok(seen.size > 1, 'variants actually vary across columns (not a fixed repeat)');
});

// ── FIX 4: ewQuoinRect — quoin column for the structured strip, whole tile for the flat trim ──
test('ewQuoinRect samples the x=0 quoin column for a structured strip, whole face otherwise', () => {
  assert.deepEqual(ewQuoinRect(true, 32, 128), [0, 0, 16, 128], 'quoin strip -> left 16px column');
  assert.deepEqual(ewQuoinRect(false, 32, 32), [0, 0, 32, 32], 'flat trim -> whole face');
});
