// D2 PLACED GROWTH — bracket / shelf FUNGUS (d2-fungus.js). Covers the PURE pieces: the honest DAMP-TIMBER
// host gate, the disrepair-driven incidence, determinism, and that a forced shelf actually paints tan-brown
// pixels onto the wall. The in-GL paint is verified in-game (mechanism A, like D0/D1/D2-vines).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
globalThis.OffscreenCanvas = class OffscreenCanvas { constructor(w, h) { return createCanvas(w, h); } };

const {
  fungusApplies, fungusIncidence, fungusDrivers, placeFungusAt, paintFungus, FUNGUS, FUNGUS_DEFAULTS,
} = await import('../src/render/dressing/d2-fungus.js');

const CFG = FUNGUS_DEFAULTS;

test('FUNGUS_DEFAULTS is frozen and FUNGUS is a live mutable copy', () => {
  assert.ok(Object.isFrozen(FUNGUS_DEFAULTS), 'defaults frozen');
  assert.equal(FUNGUS.wetGate, FUNGUS_DEFAULTS.wetGate, 'live config seeded from defaults');
  assert.ok(!Object.isFrozen(FUNGUS), 'live config mutable (the tuner edits it)');
});

test('fungusApplies: HARD-gated to damp timber — wet timber yes, dry timber / stone no', () => {
  assert.ok(fungusApplies('grassland', 'timber_frame', 0.7, CFG), 'wet timber → fungus');
  assert.ok(fungusApplies('swamp', 'wattle_daub', 0.95, CFG), 'wet daub timber → fungus');
  assert.equal(fungusApplies('grassland', 'timber_frame', 0.2, CFG), false, 'DRY timber → none (needs rot)');
  assert.equal(fungusApplies('grassland', 'fieldstone', 0.9, CFG), false, 'wet STONE → none (not wood)');
  assert.equal(fungusApplies('dense_forest', 'sandstone', 0.9, CFG), false, 'wet sandstone → none');
});

test('fungusApplies: respects the wetGate threshold exactly (>= gate)', () => {
  const g = CFG.wetGate;
  assert.equal(fungusApplies('grassland', 'plank', g - 0.01, CFG), false, 'just below gate → none');
  assert.ok(fungusApplies('grassland', 'plank', g, CFG), 'at the gate → present');
});

test('fungusApplies: force overrides the host+wet gate (tuner A/B preview)', () => {
  assert.ok(fungusApplies('desert', 'fieldstone', 0.0, { ...CFG, force: true }), 'force → applies on any wall');
});

test('fungusApplies: REAL placement honors the manifest only:[...] biome allowlist (frozen/arid dropped)', () => {
  // arctic + tundra sit at wetness exactly 0.5 (== wetGate) on damp timber, so the wet gate ALONE would leak
  // fungus into frozen biomes — the biome drop must override it (no rotting-timber fungus in arid/frozen).
  for (const b of ['arctic', 'tundra', 'desert', 'volcanic', 'savanna', 'steppe'])
    assert.equal(fungusApplies(b, 'timber_frame', 0.9, CFG), false, `${b} is dropped (manifest only:[...])`);
  for (const b of ['grassland', 'forest', 'dense_forest', 'swamp', 'mystic', 'taiga'])
    assert.ok(fungusApplies(b, 'timber_frame', 0.9, CFG), `${b} is an allowed fungus biome`);
});

test('fungusIncidence: rises with disrepair (abandoned-role bias); force pins to 1', () => {
  const clean = fungusIncidence(0, CFG);
  const worn = fungusIncidence(0.9, CFG);
  assert.ok(clean < 0.2, `clean low, got ${clean}`);
  assert.ok(worn > clean + 0.3, `worn much higher, got ${worn} vs ${clean}`);
  assert.equal(fungusIncidence(0, { ...CFG, force: true }), 1, 'force → incidence 1');
});

test('fungusDrivers: wetness tracks biome (shared with D1/D2); disrepair deterministic', () => {
  assert.ok(fungusDrivers('swamp', { bx: 1, by: 2 }).wetness > fungusDrivers('desert', { bx: 1, by: 2 }).wetness);
  const a = fungusDrivers('grassland', { bx: 5, by: 9 }), b = fungusDrivers('grassland', { bx: 5, by: 9 });
  assert.equal(a.disrepair, b.disrepair, 'disrepair is world-locked deterministic');
});

test('placeFungusAt: deterministic, gated by host, and forced → always', () => {
  const drivers = { wetness: 0.8, disrepair: 0.9 };
  const a = placeFungusAt('grassland', 'timber_frame', drivers, 12345, CFG);
  const b = placeFungusAt('grassland', 'timber_frame', drivers, 12345, CFG);
  assert.equal(a, b, 'same seed → same decision (world-locked)');
  // dry/stone host never places regardless of incidence
  assert.equal(placeFungusAt('grassland', 'fieldstone', drivers, 12345, CFG), false, 'stone host → never');
  assert.equal(placeFungusAt('grassland', 'timber_frame', { wetness: 0.1, disrepair: 0.9 }, 1, CFG), false, 'dry → never');
  assert.equal(placeFungusAt('grassland', 'fieldstone', { wetness: 0, disrepair: 0 }, 1, { ...CFG, force: true }), true, 'force → always');
});

test('placeFungusAt: most clean wet-timber sockets stay BARE (honest sparse incidence)', () => {
  let placed = 0;
  const drivers = { wetness: 0.7, disrepair: 0 };           // damp timber, but well-maintained
  for (let s = 0; s < 40; s++) if (placeFungusAt('grassland', 'timber_frame', drivers, 1000 + s * 7, CFG)) placed++;
  assert.ok(placed < 12, `most clean damp-timber sockets bare, got ${placed}/40`);
});

test('paintFungus: no-op on a headless ctx (no beginPath) and on zero size — never throws', () => {
  let touched = false;
  const headless = { save() { touched = true; } };           // no beginPath → bail
  paintFungus(headless, 40, 100, 30, 7, FUNGUS);
  assert.equal(touched, false, 'headless ctx → no-op');
  const real = createCanvas(64, 64).getContext('2d');
  paintFungus(real, 32, 50, 0, 7, FUNGUS);                   // zero size → no-op (no throw)
  paintFungus(real, 32, 50, 30, 7, { ...FUNGUS, strength: 0 }); // zero strength → no-op
  assert.ok(true, 'survived');
});

test('paintFungus: a forced shelf actually paints tan-brown fungus pixels onto the wall', () => {
  const W = 96, H = 96, cv = createCanvas(W, H), ctx = cv.getContext('2d');
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H);       // neutral grey wall
  paintFungus(ctx, W / 2, 78, 54, 4242, FUNGUS);
  const data = ctx.getImageData(0, 0, W, H).data;
  let tan = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    // tan/brown turkeytail: warm (R>B), mid-bright, not the flat grey wall
    if (r > b + 16 && r > g - 4 && r > 70 && b < 200 && !(r === g && g === b)) tan++;
  }
  assert.ok(tan > 60, `shelf should paint tan-brown pixels, got ${tan}`);
});

test('paintFungus: deterministic — same seed paints identical pixels (world-locked bake)', () => {
  const mk = () => { const cv = createCanvas(96, 96), c = cv.getContext('2d'); c.fillStyle = '#777'; c.fillRect(0, 0, 96, 96); paintFungus(c, 48, 80, 50, 999, FUNGUS); return cv.getContext('2d').getImageData(0, 0, 96, 96).data; };
  const a = mk(), b = mk();
  assert.deepEqual(Buffer.from(a.buffer), Buffer.from(b.buffer), 'same seed → identical bake (pan-stable)');
});

test('paintFungus: ink stays within the declared footprint (size wide, grows UP from baseY)', () => {
  // The socket placement relies on the cluster fitting size × ~0.66·size, centred at x, sitting ON baseY.
  // Verify no painted pixel escapes that box (apart from the thin contact shadow just below baseY).
  const W = 160, H = 160, cx = 80, baseY = 110, size = 54;
  const cv = createCanvas(W, H), c = cv.getContext('2d');
  c.fillStyle = '#808080'; c.fillRect(0, 0, W, H);
  paintFungus(c, cx, baseY, size, 4242, { ...FUNGUS, maxShelves: 4, minShelves: 4 });
  const d = c.getImageData(0, 0, W, H).data;
  let minX = W, maxX = 0, minY = H, maxY = 0;
  for (let y = 0; y < H; y++) for (let xp = 0; xp < W; xp++) {
    const i = (y * W + xp) * 4;
    if (!(d[i] === 128 && d[i + 1] === 128 && d[i + 2] === 128)) { if (xp < minX) minX = xp; if (xp > maxX) maxX = xp; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  assert.ok(minX >= cx - size * 0.6 && maxX <= cx + size * 0.6, `width within size, x [${minX},${maxX}]`);
  assert.ok(minY >= baseY - size * 0.75, `grows UP, top ${minY} not above baseY-0.75·size`);
  assert.ok(maxY <= baseY + size * 0.2, `bottom near baseY (contact shadow), ${maxY}`);
});

test('paintFungus: the shelf-count knob changes the bake (deterministic per cfg)', () => {
  const bake = (cfg) => { const cv = createCanvas(96, 96), c = cv.getContext('2d'); c.fillStyle = '#808080'; c.fillRect(0, 0, 96, 96); paintFungus(c, 48, 84, 54, 31, cfg); return Buffer.from(c.getImageData(0, 0, 96, 96).data.buffer); };
  const one = bake({ ...FUNGUS, minShelves: 1, maxShelves: 1 });
  const four = bake({ ...FUNGUS, minShelves: 4, maxShelves: 4 });
  assert.ok(!one.equals(four), 'a 1-shelf and a 4-shelf bake differ');
});
