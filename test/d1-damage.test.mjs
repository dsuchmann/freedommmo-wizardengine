import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';

// d1-damage builds offscreen canvases via OffscreenCanvas/document — shim OffscreenCanvas onto the real
// @napi-rs canvas so the renderer path runs headless in tests (same trick as the d0 test).
globalThis.OffscreenCanvas = class OffscreenCanvas { constructor(w, h) { return createCanvas(w, h); } };

const {
  damageDrivers,
  layerIntensity,
  paintDamagedColumn,
  DAMAGE,
  DAMAGE_LAYER_KEYS,
} = await import('../src/render/dressing/d1-damage.js');

// --- honest driver derivation --------------------------------------------------------------------
test('damageDrivers: wetness tracks biome climate, bounded [0,1], deterministic', () => {
  const desert = damageDrivers('desert');
  const swamp = damageDrivers('swamp');
  assert.ok(swamp.wetness > desert.wetness, `swamp ${swamp.wetness} should be wetter than desert ${desert.wetness}`);
  assert.ok(desert.wetness >= 0 && swamp.wetness <= 1, 'wetness in range');
  assert.deepEqual(damageDrivers('grassland'), damageDrivers('grassland')); // deterministic with no jitter
});

test('damageDrivers: age is HONESTLY ABSENT (null) by default — never fabricated', () => {
  assert.equal(damageDrivers('grassland').age, null);
  assert.equal(damageDrivers('grassland', { age: 0.7 }).age, 0.7); // tuner/opts can preview it
});

test('damageDrivers: freeze-thaw only fires in cold biomes', () => {
  assert.equal(damageDrivers('savanna').freezeThaw, 0);
  assert.ok(damageDrivers('tundra').freezeThaw > 0, 'cold biome has freeze-thaw');
});

test('damageDrivers: per-building jitter varies wetness deterministically', () => {
  const a = damageDrivers('grassland', { bx: 5, by: 9 });
  const b = damageDrivers('grassland', { bx: 5, by: 9 });
  const c = damageDrivers('grassland', { bx: 6, by: 9 });
  assert.equal(a.wetness, b.wetness, 'same building → same wetness');
  assert.ok(a.wetness !== c.wetness, 'different building → different wetness');
});

// --- per-building disrepair baseline (the honest stand-in for the absent age sim) ----------------
test('damageDrivers: disrepair baseline is deterministic, in range, and 0 without building coords', () => {
  assert.equal(damageDrivers('grassland').disrepair, 0, 'no coords → no disrepair (pure-geometry safe)');
  const a = damageDrivers('grassland', { bx: 10, by: 20 });
  const b = damageDrivers('grassland', { bx: 10, by: 20 });
  assert.equal(a.disrepair, b.disrepair, 'same building → same disrepair');
  assert.ok(a.disrepair >= 0 && a.disrepair <= 1, 'in range');
});

test('damageDrivers: disrepair is skewed low — cracks are OCCASIONAL, not universal', () => {
  let cracked = 0; const N = 600;
  for (let i = 0; i < N; i++) {
    const d = damageDrivers('grassland', { bx: i * 13 + 1, by: i * 7 + 5 });
    if (layerIntensity('cracks', d) > 0) cracked++;
  }
  assert.ok(cracked > 0, 'some buildings DO show cracks in-world (D1 is visible)');
  assert.ok(cracked < N * 0.35, `cracks should be a minority, got ${(100 * cracked / N).toFixed(0)}%`);
});

test('damageDrivers: cond = disrepair in-world, but the age preview overrides it', () => {
  const wn = damageDrivers('grassland', { bx: 5, by: 9 });
  assert.equal(wn.cond, wn.disrepair, 'in-world cond is the disrepair baseline');
  const preview = damageDrivers('grassland', { bx: 5, by: 9, age: 0.9 });
  assert.equal(preview.cond, 0.9, 'age preview overrides cond');
});

test('damageDrivers: disrepair amount 0 → wetness-only (no in-world cracks/age-decay)', () => {
  let cracked = 0; const N = 300;
  for (let i = 0; i < N; i++) {
    const d = damageDrivers('grassland', { bx: i * 13 + 1, by: i * 7 + 5, disrepairAmount: 0 });
    if (layerIntensity('cracks', d) > 0) cracked++;
  }
  assert.equal(cracked, 0, 'with disrepair off, no building shows cracks (age honestly absent)');
});

// --- layer gating (the no-mock heart of D1) ------------------------------------------------------
test('layerIntensity: age-driven cracks are 0 while age is absent, but fire once age is present', () => {
  const absent = damageDrivers('grassland');               // age null
  assert.equal(layerIntensity('cracks', absent), 0, 'no faked aging — cracks absent without an age source');
  const aged = damageDrivers('grassland', { age: 0.9 });
  assert.ok(layerIntensity('cracks', aged) > 0, 'cracks appear once age is supplied');
});

test('layerIntensity: wetness-driven runnels render NOW in a wet biome (wetness is derivable)', () => {
  const swamp = damageDrivers('swamp');                    // age still null
  assert.ok(layerIntensity('runnels', swamp) > 0, 'runnels fire from wetness alone');
  const desert = damageDrivers('desert');
  assert.equal(layerIntensity('runnels', desert), 0, 'dry biome stays clean');
});

test('layerIntensity: respects the onset floor and scales with strength', () => {
  const aged = damageDrivers('grassland', { age: 0.9 });
  const lo = layerIntensity('cracks', aged, 0.5);
  const hi = layerIntensity('cracks', aged, 1.0);
  assert.ok(hi > lo, 'intensity scales with master strength');
  assert.ok(hi <= 1, 'bounded');
});

test('every declared layer key resolves to a real layer', () => {
  for (const k of DAMAGE_LAYER_KEYS) assert.ok(layerIntensity(k, damageDrivers('swamp', { age: 1 })) >= 0);
});

// --- paint behavior ------------------------------------------------------------------------------
function paintAndRead(world, opts, only) {
  const saved = {};
  if (only) { for (const k of DAMAGE_LAYER_KEYS) { saved[k] = DAMAGE[k]; DAMAGE[k] = (k === only); } }
  const W = 64, H = 160;
  const cv = createCanvas(W, H);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H); // flat mid-gray wall
  const rect = { dx: 10, top: 10, dw: 44, colH: 130, tilePx: 32 };
  paintDamagedColumn(ctx, rect, world, opts);
  const data = ctx.getImageData(0, 0, W, H).data;
  const at = (x, y) => data[(y * W + x) * 4];
  if (only) for (const k of DAMAGE_LAYER_KEYS) DAMAGE[k] = saved[k];
  return { at, rect };
}
const rowMean = (at, rect, y) => { let s = 0, n = 0; for (let x = rect.dx + 2; x < rect.dx + rect.dw - 2; x++) { s += at(x, y); n++; } return s / n; };
function changed(at, rect) {
  let n = 0;
  for (let y = rect.top + 2; y < rect.top + rect.colH - 2; y += 3)
    for (let x = rect.dx + 2; x < rect.dx + rect.dw - 2; x += 3)
      if (at(x, y) !== 0x80) n++;
  return n;
}

test('paintDamagedColumn: a wet biome visibly decays the wall', () => {
  const { at, rect } = paintAndRead({ wx: 5, wy: 6 }, { biome: 'swamp', strength: 2 });
  assert.ok(changed(at, rect) > 20, 'wet-biome damage changed many pixels');
});

test('paintDamagedColumn: a dry biome with absent age leaves the wall essentially clean (honest absence)', () => {
  const { at, rect } = paintAndRead({ wx: 5, wy: 6 }, { biome: 'desert', strength: 1 });
  assert.ok(changed(at, rect) < 8, 'desert + no age source → near-pristine wall');
});

test('paintDamagedColumn: rot is bottom-weighted (decay heavier toward the plinth)', () => {
  const { at, rect } = paintAndRead({ wx: 5, wy: 6 }, { biome: 'swamp', strength: 2 }, 'rot');
  // aggregate over top-third vs bottom-third rows (the blotch mask is patchy, so single rows are noisy)
  let topSum = 0, tn = 0, botSum = 0, bn = 0;
  for (let y = rect.top + 4; y < rect.top + 34; y += 3) { topSum += rowMean(at, rect, y); tn++; }
  for (let y = rect.top + rect.colH - 34; y < rect.top + rect.colH - 4; y += 3) { botSum += rowMean(at, rect, y); bn++; }
  assert.ok(botSum / bn < topSum / tn, `rot base (${botSum / bn}) should be darker than top (${topSum / tn})`);
});

test('paintDamagedColumn: runnels are top-weighted (eave runoff darker up high)', () => {
  const { at, rect } = paintAndRead({ wx: 5, wy: 6 }, { biome: 'swamp', strength: 3 }, 'runnels');
  let topSum = 0, botSum = 0, n = 0;
  for (let y = rect.top + 4; y < rect.top + 30; y += 3) { topSum += rowMean(at, rect, y); n++; }
  let m = 0; for (let y = rect.top + rect.colH - 30; y < rect.top + rect.colH - 4; y += 3) { botSum += rowMean(at, rect, y); m++; }
  assert.ok(topSum / n < botSum / m, `runnel top (${topSum / n}) should be darker than bottom (${botSum / m})`);
});

test('paintDamagedColumn: deterministic for the same world position', () => {
  const a = paintAndRead({ wx: 5, wy: 6 }, { biome: 'swamp', strength: 2, bx: 3, by: 4 });
  const b = paintAndRead({ wx: 5, wy: 6 }, { biome: 'swamp', strength: 2, bx: 3, by: 4 });
  for (let y = 14; y < 130; y += 11) for (let x = 14; x < 50; x += 7) assert.equal(a.at(x, y), b.at(x, y));
});

test('paintDamagedColumn: strength 0 leaves the wall untouched', () => {
  const { at, rect } = paintAndRead({ wx: 5, wy: 6 }, { biome: 'swamp', strength: 0 });
  for (let y = rect.top + 2; y < rect.top + rect.colH - 2; y += 9)
    for (let x = rect.dx + 2; x < rect.dx + rect.dw - 2; x += 5)
      assert.equal(at(x, y), 0x80, 'untouched at strength 0');
});

test('paintDamagedColumn: no-op when disabled (never touches the ctx)', () => {
  let touched = false;
  const ctx = { createImageData() { touched = true; return {}; }, drawImage() { touched = true; }, save() { touched = true; } };
  paintDamagedColumn(ctx, { dx: 0, top: 0, dw: 32, colH: 128, tilePx: 32 }, { wx: 5, wy: 6 }, { enabled: false });
  assert.equal(touched, false);
});
