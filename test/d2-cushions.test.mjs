// D2 SURFACE GROWTH — raised moss CUSHIONS (d2-cushions.js): the sprite half of the moss hybrid that sits ON
// the d2-growth moss film. Tests the HONEST GATE (only where moss coverage > ~0.6, never on a dry/cold wall),
// determinism + world-locking, the per-biome viridian skin, and that paint actually deposits green pixels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
globalThis.OffscreenCanvas = class OffscreenCanvas { constructor(w, h) { return createCanvas(w, h); } };

const {
  cushionDrivers, cushionsPresent, cushionCount, mossCoverage, paintCushions,
  CUSHIONS, CUSHIONS_DEFAULTS,
} = await import('../src/render/dressing/d2-cushions.js');

const RECT = { dx: 4, top: 10, dw: 60, colH: 160, tilePx: 32 };
const WORLD = { wx: 100, wy: 200 };

test('mossCoverage replicates the d2-growth film: 0 below 0.35 wetness, ramps to 1', () => {
  assert.equal(mossCoverage(0.2), 0, 'dry → no film');
  assert.equal(mossCoverage(0.35), 0, 'onset at 0.35');
  assert.ok(mossCoverage(0.7) > 0.4 && mossCoverage(0.7) < 0.6, 'mid wetness → mid coverage');
  assert.equal(mossCoverage(1.0), 1, 'saturated → full film');
});

test('cushionDrivers: wet biome has high coverage; a dropped (dry/cold) biome is honestly zero', () => {
  const wet = cushionDrivers('dense_forest', { bx: 1, by: 2 });
  const dry = cushionDrivers('desert', { bx: 1, by: 2 });
  const cold = cushionDrivers('arctic', { bx: 3, by: 4 });
  assert.ok(wet.coverage > 0.5, `dense_forest lush, got ${wet.coverage}`);
  assert.equal(dry.coverage, 0, 'desert moss dropped → coverage 0');
  assert.equal(dry.dropped, true, 'desert flagged dropped');
  assert.equal(cold.coverage, 0, 'arctic moss dropped → coverage 0');
  assert.equal(wet.viridian, true, 'dense_forest gets the deep-viridian skin');
  assert.equal(cushionDrivers('grassland', { bx: 1, by: 2 }).viridian, false, 'grassland = standard green');
});

test('cushionsPresent: NEVER on a dry wall; present only where the film exceeds the gate', () => {
  // honest core contract — a dry/cold biome carries no cushions even if forced
  assert.equal(cushionsPresent(cushionDrivers('desert', { bx: 1, by: 1 }), CUSHIONS), false);
  assert.equal(cushionsPresent(cushionDrivers('desert', { bx: 1, by: 1 }), { ...CUSHIONS, force: true }), false,
    'force cannot resurrect a dropped biome');
  // a low-coverage temperate wall sits below the gate → absent; a high-coverage wet wall → present
  assert.equal(cushionsPresent({ coverage: 0.3, dropped: false }, CUSHIONS), false, 'below gate → absent');
  assert.equal(cushionsPresent({ coverage: 0.85, dropped: false }, CUSHIONS), true, 'above gate → present');
  assert.equal(cushionsPresent({ coverage: 0.3, dropped: false }, { ...CUSHIONS, force: true }), true,
    'force places where SOME film exists');
  assert.equal(cushionsPresent({ coverage: 0, dropped: false }, { ...CUSHIONS, force: true }), false,
    'force with zero film still → nothing (no moss → no cushion)');
});

test('cushionCount: 0 when absent, ≥1 and capped when present, scales with lushness', () => {
  assert.equal(cushionCount({ coverage: 0.3, dropped: false }, RECT, CUSHIONS), 0, 'below gate → 0');
  assert.equal(cushionCount(cushionDrivers('desert', { bx: 2, by: 2 }), RECT, CUSHIONS), 0, 'dropped → 0');
  const mid = cushionCount({ coverage: 0.65, dropped: false, viridian: false }, RECT, CUSHIONS);
  const lush = cushionCount({ coverage: 0.98, dropped: false, viridian: false }, RECT, CUSHIONS);
  assert.ok(mid >= 1, `present → at least 1, got ${mid}`);
  assert.ok(lush >= mid, `lusher film → at least as many, ${lush} vs ${mid}`);
  const viri = cushionCount({ coverage: 0.98, dropped: false, viridian: true }, RECT, CUSHIONS);
  assert.ok(viri >= lush, 'viridian biome is lumpier (≥ standard)');
  assert.ok(viri <= 28, 'hard-capped');
});

test('cushionCount: zero-width column → 0 (honest, no divide blow-up)', () => {
  assert.equal(cushionCount({ coverage: 0.9, dropped: false }, { ...RECT, dw: 0 }, CUSHIONS), 0);
});

test('cushionDrivers is deterministic + world-locked (same coords → identical)', () => {
  const a = cushionDrivers('grassland', { bx: 5, by: 9, waterProximity: 0.2 });
  const b = cushionDrivers('grassland', { bx: 5, by: 9, waterProximity: 0.2 });
  assert.deepEqual(a, b);
  // different building coords → (generally) different wetness jitter, but same biome family bounds
  const c = cushionDrivers('grassland', { bx: 6, by: 9, waterProximity: 0.2 });
  assert.ok(typeof c.coverage === 'number');
});

test('DEFAULTS frozen; live CUSHIONS mirrors them; gate ≈ 0.6', () => {
  assert.ok(Object.isFrozen(CUSHIONS_DEFAULTS), 'CUSHIONS_DEFAULTS frozen');
  assert.equal(CUSHIONS_DEFAULTS.gate, 0.6);
  assert.equal(CUSHIONS.gate, CUSHIONS_DEFAULTS.gate, 'live config seeded from defaults');
});

test('paintCushions: no-op on a dry/cold biome, headless ctx, or zero size (never throws)', () => {
  const ctx = createCanvas(80, 200).getContext('2d');
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, 80, 200);
  const before = ctx.getImageData(0, 0, 80, 200).data.slice();
  paintCushions(ctx, RECT, WORLD, { biome: 'desert', bx: 1, by: 1, strength: 1 });        // moss dropped
  const after = ctx.getImageData(0, 0, 80, 200).data;
  let changed = 0; for (let i = 0; i < after.length; i++) if (after[i] !== before[i]) changed++;
  assert.equal(changed, 0, 'desert wall stays untouched (honest — no moss cushions)');

  let touched = false;
  const headless = { beginPath() { touched = true; } }; // no ellipse → bail before any draw
  paintCushions(headless, RECT, WORLD, { biome: 'swamp', bx: 1, by: 1, strength: 1 });
  assert.equal(touched, false, 'headless ctx → no-op');

  // zero-sized column → no-op
  paintCushions(ctx, { ...RECT, dw: 0 }, WORLD, { biome: 'swamp', bx: 1, by: 1, strength: 1 });
});

test('paintCushions: a wet biome actually paints green moss onto the wall', () => {
  const W = 80, H = 200, cv = createCanvas(W, H), ctx = cv.getContext('2d');
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H);
  paintCushions(ctx, RECT, WORLD, { biome: 'dense_forest', bx: 10, by: 20, strength: 1, force: true });
  const data = ctx.getImageData(0, 0, W, H).data;
  let green = 0;
  for (let i = 0; i < data.length; i += 4)
    if (data[i + 1] > data[i] + 10 && data[i + 1] > data[i + 2] + 10) green++;
  assert.ok(green > 40, `cushions should paint green pixels, got ${green}`);
});

test('paintCushions: cushions cluster LOW in the damp base band (not the upper wall)', () => {
  const W = 80, H = 200, cv = createCanvas(W, H), ctx = cv.getContext('2d');
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H);
  const rect = { dx: 4, top: 10, dw: 60, colH: 160, tilePx: 32 };
  paintCushions(ctx, rect, WORLD, { biome: 'swamp', bx: 11, by: 21, strength: 1, force: true });
  const data = ctx.getImageData(0, 0, W, H).data;
  const groundY = rect.top + rect.colH;        // 170
  const bandTop = groundY - rect.colH * CUSHIONS.bandFrac; // ~102
  let lowGreen = 0, highGreen = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (data[i + 1] > data[i] + 10 && data[i + 1] > data[i + 2] + 10) {
      if (y >= bandTop - 8) lowGreen++; else highGreen++;  // small margin for shadow/cap overshoot
    }
  }
  assert.ok(lowGreen > 0, 'cushions present in the base band');
  assert.ok(lowGreen > highGreen, `cushions cluster low: ${lowGreen} low vs ${highGreen} high`);
});

test('paintCushions is deterministic — same inputs paint identical pixels (bakes once)', () => {
  const mk = () => { const c = createCanvas(80, 200), x = c.getContext('2d'); x.fillStyle = '#808080'; x.fillRect(0, 0, 80, 200); return { c, x }; };
  const a = mk(), b = mk();
  const opts = { biome: 'dense_forest', bx: 12, by: 22, strength: 1, force: true };
  paintCushions(a.x, RECT, WORLD, opts);
  paintCushions(b.x, RECT, WORLD, opts);
  const da = a.x.getImageData(0, 0, 80, 200).data, db = b.x.getImageData(0, 0, 80, 200).data;
  let diff = 0; for (let i = 0; i < da.length; i++) if (da[i] !== db[i]) diff++;
  assert.equal(diff, 0, 'identical inputs → identical bake (world-locked determinism)');
});
