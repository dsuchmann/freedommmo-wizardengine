import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';

// d0-weathering builds offscreen canvases via OffscreenCanvas/document — shim OffscreenCanvas onto the
// real @napi-rs canvas so the renderer path runs headless in tests.
globalThis.OffscreenCanvas = class OffscreenCanvas { constructor(w, h) { return createCanvas(w, h); } };

const {
  weatheringCoverage,
  grimeProfile,
  tileFbm,
  paintWeatheredColumn,
} = await import('../src/render/dressing/d0-weathering.js');

test('weatheringCoverage is deterministic and within [0,1]', () => {
  const a = weatheringCoverage(10, 20, { strength: 1, seed: 7 });
  const b = weatheringCoverage(10, 20, { strength: 1, seed: 7 });
  assert.equal(a, b);
  assert.ok(a >= 0 && a <= 1, `coverage ${a} out of range`);
});

test('weatheringCoverage scales with strength; 0 strength → 0', () => {
  assert.equal(weatheringCoverage(3, 4, { strength: 0, seed: 1 }), 0);
  const lo = weatheringCoverage(3, 4, { strength: 0.5, seed: 1 });
  const hi = weatheringCoverage(3, 4, { strength: 1.0, seed: 1 });
  assert.ok(hi >= lo, `hi ${hi} should be >= lo ${lo}`);
});

test('grimeProfile is bottom-weighted, bounded, and spreads to grimeFrac at the top', () => {
  assert.equal(grimeProfile(0, 0.4), 1);          // full at the base
  assert.ok(Math.abs(grimeProfile(1, 0.4) - 0.4) < 1e-9); // = grimeFrac at the top
  const mid = grimeProfile(0.5, 0.4);
  assert.ok(grimeProfile(0, 0.4) >= mid && mid >= grimeProfile(1, 0.4), 'monotonic non-increasing');
  assert.equal(grimeProfile(1, 1), 1);            // grimeFrac=1 → uniform
  assert.ok(grimeProfile(0.5, 0) >= 0 && grimeProfile(0.5, 0) <= 1, 'bounded');
});

test('tileFbm is seamless (wraps at the texture period) and in [0,1]', () => {
  for (const y of [0, 13, 64, 127]) {
    const a = tileFbm(0, y, 0x6a, 7);
    const b = tileFbm(128, y, 0x6a, 7); // +TEX → identical sample (tileable)
    assert.ok(Math.abs(a - b) < 1e-9, `seam at y=${y}: ${a} vs ${b}`);
    assert.ok(a >= 0 && a <= 1, `range ${a}`);
  }
});

// --- the core requirement: organic 2D scatter, NOT vertical bands ---
function paintAndRead(opts) {
  const W = 64, H = 140;
  const cv = createCanvas(W, H);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H); // flat mid-gray wall
  const rect = { dx: 10, top: 10, dw: 40, colH: 120, tilePx: 32 };
  paintWeatheredColumn(ctx, rect, { wx: 5, wy: 6 }, opts);
  const data = ctx.getImageData(0, 0, W, H).data;
  const at = (x, y) => data[(y * W + x) * 4]; // red channel
  return { at, rect };
}

test('paintWeatheredColumn produces a 2D field (varies across X within a row — not a uniform stripe)', () => {
  const { at, rect } = paintAndRead({ strength: 2, seed: 7, grimeMax: 0.6, toneMax: 0.3, grimeFrac: 0.4 });
  // For each row in the column, measure variance across X. A flat per-column fill would give ~0.
  let rowsWithVariation = 0, sampledRows = 0;
  for (let y = rect.top + 5; y < rect.top + rect.colH - 5; y += 6) {
    sampledRows++;
    const vals = [];
    for (let x = rect.dx + 1; x < rect.dx + rect.dw - 1; x++) vals.push(at(x, y));
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const varc = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
    if (varc > 1.0) rowsWithVariation++;
  }
  assert.ok(rowsWithVariation >= sampledRows * 0.6,
    `expected most rows to vary across X (organic), got ${rowsWithVariation}/${sampledRows}`);
});

test('paintWeatheredColumn is bottom-weighted (grime darker near the base)', () => {
  const { at, rect } = paintAndRead({ strength: 2, seed: 7, grimeMax: 0.7, toneMax: 0, grimeFrac: 0.3 });
  const rowMean = (y) => { let s = 0, n = 0; for (let x = rect.dx + 1; x < rect.dx + rect.dw - 1; x++) { s += at(x, y); n++; } return s / n; };
  const topMean = rowMean(rect.top + 8);
  const botMean = rowMean(rect.top + rect.colH - 8);
  assert.ok(botMean < topMean, `base (${botMean}) should be darker than top (${topMean})`);
});

test('paintWeatheredColumn is deterministic for the same world position', () => {
  const a = paintAndRead({ strength: 2, seed: 7, grimeMax: 0.6, toneMax: 0.3 });
  const b = paintAndRead({ strength: 2, seed: 7, grimeMax: 0.6, toneMax: 0.3 });
  for (let y = 12; y < 128; y += 11) for (let x = 12; x < 48; x += 7) assert.equal(a.at(x, y), b.at(x, y));
});

test('paintWeatheredColumn leaves the wall untouched at strength 0', () => {
  const { at, rect } = paintAndRead({ strength: 0, seed: 7 });
  for (let y = rect.top + 2; y < rect.top + rect.colH - 2; y += 9)
    for (let x = rect.dx + 2; x < rect.dx + rect.dw - 2; x += 5)
      assert.equal(at(x, y), 0x80, 'background unchanged when strength 0');
});

test('paintWeatheredColumn is a no-op when disabled', () => {
  let touched = false;
  const ctx = { createPattern() { touched = true; return {}; }, drawImage() { touched = true; }, save() { touched = true; } };
  paintWeatheredColumn(ctx, { dx: 0, top: 0, dw: 32, colH: 128, tilePx: 32 }, { wx: 5, wy: 6 }, { enabled: false });
  assert.equal(touched, false);
});
