// D2 PLACED GROWTH — wall weeds & tufts (d2-tufts.js). Covers the PURE pieces: honest incidence (dry+clean
// near-bare, wet/worn weedy, force pins to 1), deterministic per-socket presence, the universal biome reskin
// (every biome resolves a skin; arid biomes default to the wilting climate look; mystic glow is deferred not
// faked), and that paintTuft actually paints living pixels into the wall bitmap (mechanism A) while no-opping
// on a headless ctx. The in-GL look is verified in-game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
globalThis.OffscreenCanvas = class OffscreenCanvas { constructor(w, h) { return createCanvas(w, h); } };

const {
  tuftDrivers, tuftSkin, tuftIncidence, tuftPresent, paintTuft, TUFTS, TUFTS_DEFAULTS,
} = await import('../src/render/dressing/d2-tufts.js');

const CFG = TUFTS_DEFAULTS;

test('TUFTS_DEFAULTS is frozen and TUFTS is a live mutable copy', () => {
  assert.ok(Object.isFrozen(TUFTS_DEFAULTS));
  assert.equal(TUFTS.baseChance, TUFTS_DEFAULTS.baseChance);
  assert.notEqual(TUFTS, TUFTS_DEFAULTS); // separate object
});

test('tuftIncidence: dry+clean is low, wet+worn is high, force pins to 1', () => {
  const dry = tuftIncidence({ wetness: 0.05, disrepair: 0 }, CFG);
  const wetWorn = tuftIncidence({ wetness: 0.9, disrepair: 0.8 }, CFG);
  assert.ok(dry < 0.15, `dry+clean low, got ${dry}`);
  assert.ok(wetWorn > dry + 0.4, `wet+worn much higher, got ${wetWorn} vs ${dry}`);
  assert.ok(wetWorn <= CFG.maxChance + 1e-9, `clamped to maxChance, got ${wetWorn}`);
  assert.equal(tuftIncidence({ wetness: 0, disrepair: 0 }, { ...CFG, force: true }), 1);
});

test('tuftIncidence: wetness below the onset contributes nothing (honest root threshold)', () => {
  const below = tuftIncidence({ wetness: CFG.wetOnset - 0.05, disrepair: 0 }, CFG);
  const atBase = tuftIncidence({ wetness: 0, disrepair: 0 }, CFG);
  assert.equal(below, atBase, 'no wetness term until wetness clears the onset');
  assert.ok(Math.abs(below - CFG.baseChance) < 1e-9, 'equals baseChance with no disrepair');
});

test('tuftPresent: deterministic per seed, and most dry+clean sockets are bare (honest absence)', () => {
  const dry = { wetness: 0.1, disrepair: 0 };
  for (let s = 0; s < 5; s++) // same seed → same answer, every time
    assert.equal(tuftPresent(s * 1234 + 7, dry, CFG), tuftPresent(s * 1234 + 7, dry, CFG));
  let present = 0;
  for (let s = 0; s < 60; s++) if (tuftPresent(s * 977 + 3, dry, CFG)) present++;
  assert.ok(present < 18, `most dry+clean sockets bare, got ${present}/60`); // ~10% baseChance → well under 18
});

test('tuftPresent: a wet+worn wall is weedy; force makes every socket carry one; enabled:false → none', () => {
  const wet = { wetness: 0.95, disrepair: 0.85 };
  let present = 0;
  for (let s = 0; s < 60; s++) if (tuftPresent(s * 31 + 1, wet, CFG)) present++;
  assert.ok(present > 30, `wet+worn weedy, got ${present}/60`);
  for (let s = 0; s < 10; s++) assert.equal(tuftPresent(s, { wetness: 0, disrepair: 0 }, { ...CFG, force: true }), true);
  for (let s = 0; s < 10; s++) assert.equal(tuftPresent(s, wet, { ...CFG, enabled: false }), false);
});

test('tuftSkin: universal — every buildable biome resolves a non-null skin; unknown falls back to grass', () => {
  const biomes = ['grassland', 'desert', 'tundra', 'arctic', 'swamp', 'mystic', 'savanna', 'steppe',
    'forest', 'dense_forest', 'tropical_forest', 'taiga', 'hills', 'mountains', 'beach', 'lake', 'river', 'volcanic'];
  for (const b of biomes) {
    const sk = tuftSkin(b);
    assert.ok(sk && sk.bladeDark && sk.bladeMid && sk.bladeLight, `${b} has a blade palette`);
    assert.ok(/^#[0-9a-fA-F]{6}$/.test(sk.bladeDark), `${b} bladeDark is a clean hex, got ${sk.bladeDark}`);
    assert.ok(/^#[0-9a-fA-F]{6}$/.test(sk.bladeMid), `${b} bladeMid is a clean hex, got ${sk.bladeMid}`);
    assert.ok(/^#[0-9a-fA-F]{6}$/.test(sk.bladeLight), `${b} bladeLight is a clean hex, got ${sk.bladeLight}`);
    assert.ok(['normal', 'wilting', 'cushion'].includes(sk.state), `${b} has a known state`);
    assert.ok(sk.n >= 3 && sk.h > 0, `${b} has blades + height`);
  }
  const unknown = tuftSkin('nonexistent_biome');
  assert.equal(unknown.family, 'grass'); // grass_default fallback
});

test('tuftSkin: arid biomes default to the WILTING climate look; cold biomes to CUSHION (honest, not a faked season)', () => {
  for (const b of ['desert', 'savanna', 'steppe', 'volcanic']) assert.equal(tuftSkin(b).state, 'wilting', `${b} wilting`);
  for (const b of ['tundra', 'arctic', 'mountains']) assert.equal(tuftSkin(b).state, 'cushion', `${b} cushion`);
  assert.equal(tuftSkin('grassland').state, 'normal');
  assert.equal(tuftSkin('dense_forest').state, 'normal');
});

test('tuftSkin: mystic flags glow (deferred) but is NOT specially lit here — renders as a normal-state tuft', () => {
  const m = tuftSkin('mystic');
  assert.equal(m.glow, true, 'mystic skin marks glow for the future lit-multiplier');
  assert.equal(m.state, 'normal', 'glow is deferred, not faked via a brightened state');
});

test('tuftDrivers: wetness tracks biome (shared with D1/D2), disrepair deterministic, skin attached', () => {
  assert.ok(tuftDrivers('swamp', { bx: 1, by: 2 }).wetness > tuftDrivers('desert', { bx: 1, by: 2 }).wetness);
  const a = tuftDrivers('grassland', { bx: 5, by: 9 }), b = tuftDrivers('grassland', { bx: 5, by: 9 });
  assert.equal(a.disrepair, b.disrepair);
  assert.ok(a.skin && a.skin.family === 'grass', 'skin is attached to the drivers');
  // season/age is honestly absent → not returned
  assert.equal(a.season, undefined);
  assert.equal(a.age, undefined);
});

test('paintTuft: no-op on a headless ctx / zero size / disabled (never throws)', () => {
  // headless ctx (no beginPath/quadraticCurveTo) → bail without touching it
  let touched = false;
  const headless = { save() { touched = true; } };
  paintTuft(headless, 50, 100, 24, 12345, { skin: tuftSkin('grassland') });
  assert.equal(touched, false, 'headless ctx → no-op');
  // a real ctx but zero size / disabled → no draw, no throw
  const ctx = createCanvas(64, 64).getContext('2d');
  paintTuft(ctx, 32, 60, 0, 7, { skin: tuftSkin('grassland') });
  paintTuft(ctx, 32, 60, 24, 7, { skin: tuftSkin('grassland'), enabled: false });
});

test('paintTuft: a tuft actually paints living (green-ish) pixels rooted at the base', () => {
  const W = 96, H = 120, cv = createCanvas(W, H), ctx = cv.getContext('2d');
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H);
  const baseY = 100, x = 48, size = 40;
  paintTuft(ctx, x, baseY, size, 0xBEEF, { skin: tuftSkin('grassland'), strength: 1 });
  const data = ctx.getImageData(0, 0, W, H).data;
  let green = 0, aboveBase = 0;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const i = (py * W + px) * 4;
      // green-dominant pixel that differs from the flat grey background
      if (data[i + 1] > data[i] + 10 && data[i + 1] > data[i + 2] + 6) { green++; if (py < baseY) aboveBase++; }
    }
  }
  assert.ok(green > 30, `tuft should paint green blades, got ${green}`);
  assert.ok(aboveBase > green * 0.6, `blades grow UP from the root (most green above baseY), got ${aboveBase}/${green}`);
});

test('paintTuft: deterministic — same seed paints identical pixels; different seed differs', () => {
  const render = (seed) => {
    const cv = createCanvas(80, 100), ctx = cv.getContext('2d');
    ctx.fillStyle = '#777'; ctx.fillRect(0, 0, 80, 100);
    paintTuft(ctx, 40, 88, 36, seed, { skin: tuftSkin('grassland'), strength: 1 });
    return Buffer.from(ctx.getImageData(0, 0, 80, 100).data);
  };
  assert.ok(render(0x1234).equals(render(0x1234)), 'same seed → identical bake (world-locked, pan-stable)');
  assert.ok(!render(0x1234).equals(render(0x9999)), 'different seed → different tuft');
});

test('paintTuft: a flowerless skin (steppe) paints grass but no warm flower centre', () => {
  const W = 80, H = 100, cv = createCanvas(W, H), ctx = cv.getContext('2d');
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H);
  paintTuft(ctx, 40, 88, 36, 0xABCD, { skin: tuftSkin('steppe'), strength: 1 });
  const data = ctx.getImageData(0, 0, W, H).data;
  let warmCentre = 0;
  for (let i = 0; i < data.length; i += 4) // the flower centre is a strong warm yellow (R&G high, B low)
    if (data[i] > 200 && data[i + 1] > 190 && data[i + 2] < 170) warmCentre++;
  assert.equal(warmCentre, 0, `steppe (flower:null) paints no flower centre, got ${warmCentre}`);
});
