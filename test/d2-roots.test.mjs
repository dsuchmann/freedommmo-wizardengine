// D2 PLACED GROWTH — climbing ROOTS (d2-roots.js): a LEAFLESS woody climber reusing the vine-spline engine.
// Covers the PURE pieces: honest incidence (~half ivy's), determinism, MID-wall cap (not the eave), branchier
// forks, leafless render (paints WOODY brown, no green), permafrost drop, and the per-RUN geometry contract.
// The in-GL paint is verified in-game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
globalThis.OffscreenCanvas = class OffscreenCanvas { constructor(w, h) { return createCanvas(w, h); } };

const { buildVineSystem, VINE_CFG_DEFAULTS } = await import('../src/render/dressing/vine-spline.js');
const {
  getRootSystem, paintRoots, rootDrivers, rootsApplies, rootsHosts, rootsBiomeSkin,
  ROOTS, ROOTS_DEFAULTS,
} = await import('../src/render/dressing/d2-roots.js');

const KEY = { bx: 100, by: 200, runY: 3, seed: 42 };

// A fake building for getRootSystem (it reads b.x|0, b.y|0 and caches on b._d2Roots).
function fakeB(x = 100, y = 200, biome = 'grassland') { return { x, y, biome }; }

test('ROOTS_DEFAULTS is frozen and is ~half ivy incidence, mid-wall cap, branchier, lower drift', () => {
  assert.ok(Object.isFrozen(ROOTS_DEFAULTS), 'DEFAULTS frozen');
  assert.ok(ROOTS_DEFAULTS.baseChance < VINE_CFG_DEFAULTS.baseChance, 'lower base incidence than ivy');
  assert.ok(Math.abs(ROOTS_DEFAULTS.baseChance - VINE_CFG_DEFAULTS.baseChance * 0.5) < 1e-9, '~half ivy incidence');
  assert.ok(ROOTS_DEFAULTS.capMaxFrac <= 0.6, 'capped at/below mid-wall, never the eave');
  assert.ok(ROOTS_DEFAULTS.forkChance > VINE_CFG_DEFAULTS.forkChance, 'branchier than ivy');
  assert.ok(ROOTS_DEFAULTS.driftTiles < VINE_CFG_DEFAULTS.driftTiles, 'lower drift (hugs the wall)');
  assert.ok(ROOTS_DEFAULTS.maxRoots <= VINE_CFG_DEFAULTS.maxRoots, 'fewer systems per wall than ivy');
});

test('rootsApplies: dropped in permafrost biomes (honest absence), present elsewhere', () => {
  assert.equal(rootsApplies('arctic'), false);
  assert.equal(rootsApplies('tundra'), false);
  for (const b of ['grassland', 'forest', 'dense_forest', 'swamp', 'volcanic', 'mystic', 'desert'])
    assert.equal(rootsApplies(b), true, `${b} keeps roots`);
});

test('rootsHosts: stone/earth walls host, fresh plaster does not', () => {
  assert.ok(rootsHosts('fieldstone'));
  assert.ok(rootsHosts('cob'));
  assert.ok(rootsHosts('rammed_earth'));
  assert.equal(rootsHosts('plaster'), false);
  assert.equal(rootsHosts('whitewash'), false);
});

test('rootsBiomeSkin: wet biomes are darker + forkier; mystic has NO glow (deferred, dark for now)', () => {
  const grass = rootsBiomeSkin('grassland');
  const swamp = rootsBiomeSkin('swamp');
  const mystic = rootsBiomeSkin('mystic');
  assert.ok(swamp.forkBoost > grass.forkBoost, 'wet biomes fork more');
  // dark wet roots: swamp tendril darker (lower luminance) than pale grassland
  const lum = (hex) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
  assert.ok(lum(swamp.tendrilDark) < lum(grass.tendrilDark), 'swamp roots darker than grassland');
  // mystic is rendered DARK (glow-veined lit-multiplier deferred) — no bright emissive color
  assert.ok(lum(mystic.tendrilDark) < 0x80 * 3, 'mystic rendered dark for now (glow deferred)');
  // unknown biome falls back, never throws
  assert.ok(rootsBiomeSkin('not_a_biome').tendrilDark, 'fallback skin exists');
});

test('rootDrivers: wetness tracks biome (shared with D1); disrepair deterministic; NO tree-proximity key', () => {
  assert.ok(rootDrivers('dense_forest', { bx: 1, by: 2 }).wetness > rootDrivers('desert', { bx: 1, by: 2 }).wetness);
  const a = rootDrivers('grassland', { bx: 5, by: 9 }), b = rootDrivers('grassland', { bx: 5, by: 9 });
  assert.equal(a.disrepair, b.disrepair);
  // tree-proximity is honestly ABSENT — it must NOT appear as a fabricated driver
  assert.equal('treeProximity' in a, false, 'no faked tree-proximity driver');
  assert.equal('proximity' in a, false, 'no faked proximity driver');
});

test('getRootSystem: deterministic for the same building+geom+drivers', () => {
  const geom = { wTiles: 8, hTiles: 8, blocked: [], runY: 3 };
  const a = getRootSystem(fakeB(), geom, { biome: 'swamp', seed: 7 });
  const b = getRootSystem(fakeB(), geom, { biome: 'swamp', seed: 7 });
  assert.deepEqual(a, b);
});

test('getRootSystem: permafrost biome yields an absent system (no roots in frozen ground)', () => {
  const geom = { wTiles: 8, hTiles: 8, blocked: [], runY: 3 };
  const sys = getRootSystem(fakeB(100, 200, 'arctic'), geom, { biome: 'arctic', seed: 7 });
  assert.equal(sys.present, false);
  assert.equal(sys.roots.length, 0);
});

test('getRootSystem: lower incidence than the equivalent ivy system on the same damp wall', () => {
  // sample many walls; roots (~half ivy incidence) must be present on fewer of them than ivy would be.
  let rootsPresent = 0, vinesPresent = 0;
  const drivers = { wetness: 0.6, disrepair: 0.2 };
  for (let s = 0; s < 60; s++) {
    const b = fakeB(100 + s, 200, 'grassland');
    const geom = { wTiles: 8, hTiles: 8, blocked: [], runY: 3 };
    if (getRootSystem(b, geom, { biome: 'grassland', waterProximity: 0, seed: 1 }).present) rootsPresent++;
    // equivalent ivy via the raw engine at default ivy cfg, decorrelated stream like the renderer uses
    const v = buildVineSystem({ wTiles: 8, hTiles: 8, blocked: [], drivers, cfg: VINE_CFG_DEFAULTS,
      key: { bx: 100 + s, by: 200, runY: 3, seed: 1 } });
    if (v.present) vinesPresent++;
  }
  assert.ok(rootsPresent < vinesPresent, `roots (${rootsPresent}) rarer than ivy (${vinesPresent})`);
});

test('getRootSystem: forced root system caps at MID-wall — every point stays below ~0.6 of wall height', () => {
  const hTiles = 6;
  const sys = getRootSystem(fakeB(), { wTiles: 8, hTiles, blocked: [], runY: 3 },
    { biome: 'swamp', seed: 7, force: false }); // force via the live cfg below
  // force through the config object the way the renderer would (window._roots is ROOTS here)
  ROOTS.force = true;
  try {
    const f = getRootSystem(fakeB(50, 60), { wTiles: 8, hTiles, blocked: [], runY: 1 }, { biome: 'swamp', seed: 7 });
    assert.ok(f.present, 'forced → present');
    const capFrac = ROOTS_DEFAULTS.capMaxFrac; // 0.55
    for (const p of f.roots)
      for (const poly of [p.stem, ...p.forks])
        for (const pt of poly)
          assert.ok(pt.y <= hTiles * capFrac + 0.6 + 1e-6, `y ${pt.y} stays near mid-wall (<= ${hTiles * capFrac})`);
  } finally { ROOTS.force = false; }
  assert.ok(sys, 'unforced call returned a system object');
});

test('getRootSystem: a forced system is branchier than the ivy default (more forks per plant on average)', () => {
  ROOTS.force = true;
  try {
    let rootForks = 0, rootPlants = 0, vineForks = 0, vinePlants = 0;
    for (let s = 0; s < 40; s++) {
      const r = getRootSystem(fakeB(100 + s, 300), { wTiles: 8, hTiles: 8, blocked: [], runY: 2 },
        { biome: 'swamp', seed: 3 });
      for (const p of r.roots) { rootForks += p.forks.length; rootPlants++; }
      const v = buildVineSystem({ wTiles: 8, hTiles: 8, blocked: [], drivers: { wetness: 0.9, disrepair: 0.4 },
        cfg: { ...VINE_CFG_DEFAULTS, force: true }, key: { bx: 100 + s, by: 300, runY: 2, seed: 3 } });
      for (const p of v.roots) { vineForks += p.forks.length; vinePlants++; }
    }
    const rootAvg = rootForks / Math.max(1, rootPlants);
    const vineAvg = vineForks / Math.max(1, vinePlants);
    assert.ok(rootAvg > vineAvg, `roots branchier: ${rootAvg.toFixed(2)} forks/plant vs ivy ${vineAvg.toFixed(2)}`);
  } finally { ROOTS.force = false; }
});

test('aperture routing carries through the engine: no point lands inside a door/window span', () => {
  ROOTS.force = true;
  try {
    const blocked = [{ x0: 3.2, x1: 4.8 }];
    const sys = getRootSystem(fakeB(7, 11), { wTiles: 8, hTiles: 8, blocked, runY: 0 }, { biome: 'swamp', seed: 5 });
    let inside = 0;
    for (const p of sys.roots)
      for (const poly of [p.stem, ...p.forks])
        for (const pt of poly)
          if (pt.x > 3.2 && pt.x < 4.8) inside++;
    assert.equal(inside, 0, `roots route AROUND the aperture, ${inside} points inside`);
  } finally { ROOTS.force = false; }
});

test('paintRoots: no-op on an absent system or a headless ctx (never throws)', () => {
  let touched = false;
  const realCtx = createCanvas(64, 160).getContext('2d');
  paintRoots(realCtx, { leftX: 0, baseY: 150, tilePx: 32 }, { present: false, roots: [] }, ROOTS_DEFAULTS, { biome: 'grassland' });
  const headless = { save() { touched = true; } }; // no beginPath → bail before save
  ROOTS.force = true;
  let sys;
  try { sys = getRootSystem(fakeB(1, 1), { wTiles: 6, hTiles: 6, blocked: [], runY: 0 }, { biome: 'swamp', seed: 9 }); }
  finally { ROOTS.force = false; }
  paintRoots(headless, { leftX: 0, baseY: 150, tilePx: 32 }, sys, ROOTS_DEFAULTS, { biome: 'swamp' });
  assert.equal(touched, false, 'headless ctx (no beginPath) → no-op');
});

test('paintRoots: a forced root system paints WOODY BROWN pixels and NO green foliage (leafless)', () => {
  const W = 96, H = 200, cv = createCanvas(W, H), ctx = cv.getContext('2d');
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H);
  ROOTS.force = true;
  let sys;
  try { sys = getRootSystem(fakeB(123, 456), { wTiles: 3, hTiles: 5, blocked: [], runY: 0 }, { biome: 'grassland', seed: 11 }); }
  finally { ROOTS.force = false; }
  paintRoots(ctx, { leftX: 4, baseY: 190, tilePx: 30 }, sys, ROOTS_DEFAULTS, { biome: 'grassland' });
  const data = ctx.getImageData(0, 0, W, H).data;
  let woody = 0, green = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], bl = data[i + 2];
    // woody brown: red-dominant, warm (r > g > b-ish), and not the flat #808080 background
    if (r > bl + 10 && r >= g && Math.abs(r - 0x80) + Math.abs(g - 0x80) + Math.abs(bl - 0x80) > 20) woody++;
    // green foliage signature (what ivy would paint) — must be essentially zero here
    if (g > r + 12 && g > bl + 12) green++;
  }
  assert.ok(woody > 30, `roots should paint woody-brown pixels, got ${woody}`);
  assert.equal(green, 0, `leafless climber paints NO green foliage, got ${green}`);
});
