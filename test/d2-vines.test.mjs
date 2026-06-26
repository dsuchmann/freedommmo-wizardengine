// D2 PLACED GROWTH — the spline-assembly engine (vine-spline.js) + the ivy renderer drivers (d2-vines.js).
// Covers the PURE pieces: honest incidence, determinism, climb cap, aperture routing. The in-GL paint is
// verified in-game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
globalThis.OffscreenCanvas = class OffscreenCanvas { constructor(w, h) { return createCanvas(w, h); } };

const { buildVineSystem, vineIncidence, VINE_CFG_DEFAULTS } = await import('../src/render/dressing/vine-spline.js');
const { vineDrivers, paintVines } = await import('../src/render/dressing/d2-vines.js');

const CFG = VINE_CFG_DEFAULTS;
const KEY = { bx: 100, by: 200, runY: 3, seed: 42 };
const wide = { wTiles: 8, hTiles: 8, blocked: [], key: KEY, cfg: CFG };

test('vineIncidence: dry+clean is low, wet+worn is high, force pins to 1', () => {
  const dry = vineIncidence({ wetness: 0.1, disrepair: 0 }, CFG);
  const wetWorn = vineIncidence({ wetness: 0.9, disrepair: 0.8 }, CFG);
  assert.ok(dry < 0.2, `dry+clean low, got ${dry}`);
  assert.ok(wetWorn > dry + 0.4, 'wet+worn much higher');
  assert.equal(vineIncidence({ wetness: 0, disrepair: 0 }, { ...CFG, force: true }), 1);
});

test('buildVineSystem: deterministic for the same key+drivers+cfg', () => {
  const a = buildVineSystem({ ...wide, drivers: { wetness: 0.8, disrepair: 0.5 } });
  const b = buildVineSystem({ ...wide, drivers: { wetness: 0.8, disrepair: 0.5 } });
  assert.deepEqual(a, b);
});

test('buildVineSystem: a dry clean wall is usually bare; forced → present with 1..maxRoots', () => {
  let present = 0;
  for (let s = 0; s < 30; s++) // sample many walls — most dry+clean ones carry no vine (honest absence)
    if (buildVineSystem({ ...wide, key: { ...KEY, bx: 100 + s }, drivers: { wetness: 0.15, disrepair: 0 } }).present) present++;
  assert.ok(present < 12, `most dry+clean walls bare, got ${present}/30 present`);
  const f = buildVineSystem({ ...wide, cfg: { ...CFG, force: true }, drivers: { wetness: 0.2, disrepair: 0 } });
  assert.ok(f.present && f.roots.length >= 1 && f.roots.length <= CFG.maxRoots, 'forced → 1..maxRoots roots');
});

test('buildVineSystem: a present plant has a base, a climbing stem, and leaves', () => {
  const sys = buildVineSystem({ ...wide, cfg: { ...CFG, force: true }, drivers: { wetness: 0.9, disrepair: 0.6 } });
  assert.ok(sys.present && sys.roots.length);
  for (const p of sys.roots) {
    assert.equal(p.kind, 'ivy');
    assert.ok(p.stem.length > 1, 'stem is a polyline');
    assert.ok(p.leaves.length > 0, 'ivy carries leaves');
    assert.deepEqual(p.base, { x: p.base.x, y: 0 }); // base sits on the ground line
    assert.ok(p.base.x >= 0 && p.base.x <= wide.wTiles);
  }
});

test('climb cap: every stem/fork point stays within the wall height', () => {
  const sys = buildVineSystem({ ...wide, hTiles: 6, cfg: { ...CFG, force: true }, drivers: { wetness: 1, disrepair: 1 } });
  for (const p of sys.roots)
    for (const poly of [p.stem, ...p.forks])
      for (const pt of poly) {
        assert.ok(pt.y >= 0 && pt.y <= 6 + 1e-6, `y in [0,6], got ${pt.y}`);
        assert.ok(pt.x >= -0.01 && pt.x <= wide.wTiles + 0.01, `x in run, got ${pt.x}`);
      }
});

test('aperture routing: no stem/fork point lands inside a door/window blocked span', () => {
  const blocked = [{ x0: 3.2, x1: 4.8 }];           // a central aperture column
  const sys = buildVineSystem({ wTiles: 8, hTiles: 8, blocked, key: KEY, cfg: { ...CFG, force: true, maxRoots: 3 }, drivers: { wetness: 1, disrepair: 1 } });
  let inside = 0;
  for (const p of sys.roots)
    for (const poly of [p.stem, ...p.forks])
      for (const pt of poly)
        if (pt.x > 3.2 && pt.x < 4.8) inside++;
  assert.equal(inside, 0, `vine must route AROUND the aperture, ${inside} points inside`);
});

test('too-small a wall grows nothing (honest)', () => {
  assert.equal(buildVineSystem({ wTiles: 0.4, hTiles: 8, key: KEY, cfg: { ...CFG, force: true } }).present, false);
  assert.equal(buildVineSystem({ wTiles: 8, hTiles: 1.0, key: KEY, cfg: { ...CFG, force: true } }).present, false);
});

test('vineDrivers: wetness tracks biome (shared with D1/D2); disrepair deterministic', () => {
  assert.ok(vineDrivers('dense_forest', { bx: 1, by: 2 }).wetness > vineDrivers('desert', { bx: 1, by: 2 }).wetness);
  const a = vineDrivers('grassland', { bx: 5, by: 9 }), b = vineDrivers('grassland', { bx: 5, by: 9 });
  assert.equal(a.disrepair, b.disrepair);
});

test('paintVines: no-op on an absent system or a headless ctx (never throws)', () => {
  let touched = false;
  const realCtx = createCanvas(64, 160).getContext('2d');
  paintVines(realCtx, { leftX: 0, baseY: 150, tilePx: 32 }, { present: false, roots: [] }, { strength: 1 }); // absent → no draw
  const headless = { save() { touched = true; } };                                                          // no beginPath → bail
  const sys = buildVineSystem({ ...wide, cfg: { ...CFG, force: true }, drivers: { wetness: 1, disrepair: 1 } });
  paintVines(headless, { leftX: 0, baseY: 150, tilePx: 32 }, sys, { strength: 1 });
  assert.equal(touched, false, 'headless ctx (no beginPath) → no-op');
});

test('paintVines: a forced vine actually paints green onto the wall', () => {
  const W = 96, H = 200, cv = createCanvas(W, H), ctx = cv.getContext('2d');
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H);
  const sys = buildVineSystem({ wTiles: 3, hTiles: 5, blocked: [], key: KEY, cfg: { ...CFG, force: true, maxRoots: 3 }, drivers: { wetness: 1, disrepair: 1 } });
  paintVines(ctx, { leftX: 4, baseY: 190, tilePx: 30 }, sys, { strength: 1, ...defaultColors() });
  const data = ctx.getImageData(0, 0, W, H).data;
  let green = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i + 1] > data[i] + 12 && data[i + 1] > data[i + 2] + 12) green++;
  assert.ok(green > 40, `vine should paint green pixels, got ${green}`);
});

function defaultColors() {
  return { stemDark: '#2c3a1a', stemLight: '#46602a', leaf0: '#3a6326', leaf1: '#557f33', leaf2: '#74a046', rootColor: '#37291a' };
}
