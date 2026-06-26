import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';

globalThis.OffscreenCanvas = class OffscreenCanvas { constructor(w, h) { return createCanvas(w, h); } };

const {
  growthDrivers, layerCoverage, isStoneSlug, paintGrowthColumn, GROWTH, GROWTH_LAYER_KEYS,
} = await import('../src/render/dressing/d2-growth.js');

test('isStoneSlug: mineral hosts are stone; pure timber is not', () => {
  for (const s of ['fieldstone', 'cob', 'sandstone', 'amethyst_ashlar', 'wattle_daub'])
    assert.equal(isStoneSlug(s), true, `${s} should be stone-ish`);
  for (const s of ['hewn_plank', 'log_cabin', 'pine_plank', ''])
    assert.equal(isStoneSlug(s), false, `${s} should NOT be stone`);
});

test('growthDrivers: wetness tracks biome (shared with D1); lichenRnd deterministic', () => {
  assert.ok(growthDrivers('dense_forest').wetness > growthDrivers('desert').wetness);
  const a = growthDrivers('grassland', { bx: 5, by: 9 }), b = growthDrivers('grassland', { bx: 5, by: 9 });
  assert.equal(a.lichenRnd, b.lichenRnd);
  assert.ok(a.lichenRnd >= 0 && a.lichenRnd <= 1);
});

test('growthDrivers: water proximity raises wetness (so moss can grow waterfront in any biome)', () => {
  const dry = growthDrivers('desert');
  const shore = growthDrivers('desert', { waterProximity: 1 });
  assert.ok(shore.wetness > dry.wetness + 0.5);
});

test('layerCoverage moss: zero in dry biomes (honest), present in wet biomes, scales with wetness', () => {
  assert.equal(layerCoverage('moss', growthDrivers('desert')), 0, 'no moss on a dry desert wall');
  assert.equal(layerCoverage('moss', growthDrivers('savanna')), 0, 'savanna (0.20) below the 0.35 onset → none');
  assert.ok(layerCoverage('moss', growthDrivers('dense_forest')) > 0.2, 'dense_forest is mossy');
  const shore = growthDrivers('desert', { waterProximity: 1 });
  assert.ok(layerCoverage('moss', shore) > 0.3, 'a waterfront desert wall grows moss');
});

test('layerCoverage lichen: present on most stone walls, fainter on timber, tolerates dry', () => {
  const dryStone = growthDrivers('hills', { bx: 3, by: 7 });
  assert.ok(layerCoverage('lichen', dryStone, true) > layerCoverage('lichen', dryStone, false), 'stone hosts more lichen');
  assert.ok(layerCoverage('lichen', growthDrivers('desert', { bx: 1, by: 1 }), true) > 0, 'lichen colonizes dry stone too');
});

// --- paint behavior ---
function paintAndRead(world, opts, onlyKey) {
  const saved = {};
  if (onlyKey) for (const k of GROWTH_LAYER_KEYS) { saved[k] = GROWTH[k]; GROWTH[k] = (k === onlyKey); }
  const W = 64, H = 160;
  const cv = createCanvas(W, H); const ctx = cv.getContext('2d');
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H);
  const rect = { dx: 10, top: 10, dw: 44, colH: 130, tilePx: 32 };
  paintGrowthColumn(ctx, rect, world, opts);
  const data = ctx.getImageData(0, 0, W, H).data;
  const at = (x, y) => [data[(y * W + x) * 4], data[(y * W + x) * 4 + 1], data[(y * W + x) * 4 + 2]];
  if (onlyKey) for (const k of GROWTH_LAYER_KEYS) GROWTH[k] = saved[k];
  return { at, rect };
}
const greenness = (rgb) => rgb[1] - (rgb[0] + rgb[2]) / 2; // how much the pixel leans green
function rowGreen(at, rect, y) { let s = 0, n = 0; for (let x = rect.dx + 2; x < rect.dx + rect.dw - 2; x++) { s += greenness(at(x, y)); n++; } return s / n; }

test('paintGrowthColumn: a wet biome greens the wall (moss)', () => {
  const { at, rect } = paintAndRead({ wx: 5, wy: 6 }, { biome: 'dense_forest', bx: 3, by: 4, strength: 2 }, 'moss');
  let green = 0, n = 0;
  for (let y = rect.top + 4; y < rect.top + rect.colH - 4; y += 4) { green += rowGreen(at, rect, y); n++; }
  assert.ok(green / n > 1, `dense_forest wall should read greener, got ${(green / n).toFixed(2)}`);
});

test('paintGrowthColumn: moss is bottom-weighted (greener near the damp base)', () => {
  const { at, rect } = paintAndRead({ wx: 5, wy: 6 }, { biome: 'dense_forest', bx: 3, by: 4, strength: 2 }, 'moss');
  let top = 0, tn = 0, bot = 0, bn = 0;
  for (let y = rect.top + 4; y < rect.top + 34; y += 3) { top += rowGreen(at, rect, y); tn++; }
  for (let y = rect.top + rect.colH - 34; y < rect.top + rect.colH - 4; y += 3) { bot += rowGreen(at, rect, y); bn++; }
  assert.ok(bot / bn > top / tn, `base (${(bot / bn).toFixed(2)}) should be greener than top (${(top / tn).toFixed(2)})`);
});

test('paintGrowthColumn: a dry desert wall stays essentially clean (honest absence of moss)', () => {
  const { at, rect } = paintAndRead({ wx: 5, wy: 6 }, { biome: 'desert', bx: 9, by: 9, strength: 1 }, 'moss');
  let changed = 0;
  for (let y = rect.top + 2; y < rect.top + rect.colH - 2; y += 3)
    for (let x = rect.dx + 2; x < rect.dx + rect.dw - 2; x += 3)
      if (at(x, y)[1] !== 0x80) changed++;
  assert.ok(changed < 8, 'no moss on a dry desert wall');
});

test('paintGrowthColumn: deterministic + no-op when disabled', () => {
  const a = paintAndRead({ wx: 5, wy: 6 }, { biome: 'dense_forest', bx: 3, by: 4, strength: 2 });
  const b = paintAndRead({ wx: 5, wy: 6 }, { biome: 'dense_forest', bx: 3, by: 4, strength: 2 });
  for (let y = 14; y < 130; y += 13) for (let x = 14; x < 50; x += 9) assert.deepEqual(a.at(x, y), b.at(x, y));
  let touched = false;
  const ctx = { createImageData() { touched = true; return {}; }, drawImage() { touched = true; }, save() { touched = true; } };
  paintGrowthColumn(ctx, { dx: 0, top: 0, dw: 32, colH: 128, tilePx: 32 }, { wx: 5, wy: 6 }, { enabled: false });
  assert.equal(touched, false);
});
