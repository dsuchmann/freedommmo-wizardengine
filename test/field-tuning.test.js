// test/field-tuning.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIELD_TUNING, setFieldTuning, tuneSize, tuneBiomeDensity, tuneObjDensity, tuneAnimEnabled, tuneStateWeights, rollWeighted, F2_STATE_ORDER, F2_STATE_DEFAULTS,
  F4_STATE_ORDER, F4_STATE_DEFAULTS, F5_STATE_ORDER, f5StateDefaults, maxSizeMul } from '../src/world/field-tuning.js';

test('defaults are all 1.0', () => {
  setFieldTuning(null);
  assert.equal(tuneSize('f3', 'grassland', 'field_stone', 4, 10, 20, 9570), 1);
  assert.equal(tuneBiomeDensity('f3', 'grassland'), 1);
  assert.equal(tuneObjDensity('f3', 'grassland', 'field_stone'), 1);
});

test('size multiplies master x biome x object x variant', () => {
  setFieldTuning({ f4: { size: 2, biomes: { taiga: { size: 0.5, objects: {
    snow_fern: { size: 3, variants: { 7: { size: 0.25 } } } } } } } });
  // 2 * 0.5 * 3 * 0.25 = 0.75
  assert.ok(Math.abs(tuneSize('f4', 'taiga', 'snow_fern', 7, 5, 5, 9720) - 0.75) < 1e-9);
  // unknown variant: 2 * 0.5 * 3 = 3
  assert.ok(Math.abs(tuneSize('f4', 'taiga', 'snow_fern', 8, 5, 5, 9720) - 3) < 1e-9);
  // unknown object: 2 * 0.5 = 1
  assert.ok(Math.abs(tuneSize('f4', 'taiga', 'other', 0, 5, 5, 9720) - 1) < 1e-9);
});

test('size range rolls deterministically within [min,max]', () => {
  setFieldTuning({ f2: { biomes: { grassland: { objects: {
    tall_grass_blade: { variants: { 3: { sizeMin: 0.8, sizeMax: 1.2 } } } } } } } });
  const a = tuneSize('f2', 'grassland', 'tall_grass_blade', 3, 100, 200, 7600);
  const b = tuneSize('f2', 'grassland', 'tall_grass_blade', 3, 100, 200, 7600);
  assert.equal(a, b); // same coords + salt -> same roll
  assert.ok(a >= 0.8 && a <= 1.2);
  const c = tuneSize('f2', 'grassland', 'tall_grass_blade', 3, 101, 200, 7600);
  assert.notEqual(a, c); // different tile -> (almost surely) different roll
});

test('density: biome part and object part are separate', () => {
  setFieldTuning({ f3: { density: 2, biomes: { desert: { density: 0.5, objects: {
    bleached_bone: { density: 0.25 } } } } } });
  assert.equal(tuneBiomeDensity('f3', 'desert'), 1);       // master 2 x biome 0.5
  assert.equal(tuneBiomeDensity('f3', 'tundra'), 2);       // master only (no biome node)
  assert.equal(tuneObjDensity('f3', 'desert', 'bleached_bone'), 0.25);
  assert.equal(tuneObjDensity('f3', 'desert', 'other'), 1);
});

test('setFieldTuning replaces tree and live-binding updates', () => {
  setFieldTuning({ f4: { size: 5 } });
  assert.equal(FIELD_TUNING.f4.size, 5);
  // null resets to baked defaults (not empty objects): f3 is empty, f5 has baked entries
  setFieldTuning(null);
  assert.deepEqual(FIELD_TUNING.f3, {});  // f3 calibration was entirely empty objects — pruned
  // f5 has baked grassland densities; spot-check hay_bale size = 0.35
  assert.equal(FIELD_TUNING.f5.biomes.grassland.objects.hay_bale.size, 0.35);
  // live override with size:5 merged over defaults; spot-check sibling biome not affected
  setFieldTuning({ f4: { size: 5 } });
  assert.equal(FIELD_TUNING.f4.size, 5);
});

test('anim categories default enabled, disable per object x category', () => {
  setFieldTuning({ f2: { biomes: { forest: { objects: {
    tree_stump: { anims: { wind_sway: false } } } } } } });
  assert.equal(tuneAnimEnabled('f2', 'forest', 'tree_stump', 'wind_sway'), false);
  assert.equal(tuneAnimEnabled('f2', 'forest', 'tree_stump', 'player_walk'), true);
  assert.equal(tuneAnimEnabled('f2', 'forest', 'fern_patch', 'wind_sway'), true);
  assert.equal(tuneAnimEnabled('f4', 'forest', 'tree_stump', 'wind_sway'), true);
  setFieldTuning(null);
  assert.equal(tuneAnimEnabled('f2', 'forest', 'tree_stump', 'wind_sway'), true);
});

test('tuneStateWeights cascade: object > biome > master > defaults', () => {
  const d = { base: 60, cracked: 38, enchanted: 2 };
  setFieldTuning(null);
  assert.deepEqual(tuneStateWeights('f5', 'grassland', 'field_boulder', d), d);
  setFieldTuning({ f5: { states: { base: 1 } } });
  assert.deepEqual(tuneStateWeights('f5', 'grassland', 'field_boulder', d), { base: 1 });
  setFieldTuning({ f5: { states: { base: 1 }, biomes: { grassland: { states: { cracked: 1 } } } } });
  assert.deepEqual(tuneStateWeights('f5', 'grassland', 'field_boulder', d), { cracked: 1 });
  assert.deepEqual(tuneStateWeights('f5', 'desert', 'mesa_rock', d), { base: 1 }); // master still wins elsewhere
  setFieldTuning({ f5: { biomes: { grassland: { states: { cracked: 1 },
    objects: { field_boulder: { states: { enchanted: 1 } } } } } } });
  assert.deepEqual(tuneStateWeights('f5', 'grassland', 'field_boulder', d), { enchanted: 1 });
  setFieldTuning(null);
});

test('rollWeighted: normalized thresholds in declared order, zero-weight skipped', () => {
  const w = { a: 15, b: 55, c: 20, d: 10 };
  const order = ['a', 'b', 'c', 'd'];
  assert.equal(rollWeighted(w, order, 0.0), 'a');
  assert.equal(rollWeighted(w, order, 0.149), 'a');
  assert.equal(rollWeighted(w, order, 0.15), 'b');
  assert.equal(rollWeighted(w, order, 0.699), 'b');
  assert.equal(rollWeighted(w, order, 0.70), 'c');
  assert.equal(rollWeighted(w, order, 0.899), 'c');
  assert.equal(rollWeighted(w, order, 0.9), 'd');
  assert.equal(rollWeighted(w, order, 0.999), 'd');
  // weights needn't sum to 100 — relative
  assert.equal(rollWeighted({ a: 1, b: 1 }, ['a', 'b'], 0.49), 'a');
  assert.equal(rollWeighted({ a: 1, b: 1 }, ['a', 'b'], 0.51), 'b');
  // missing keys count as 0
  assert.equal(rollWeighted({ b: 1 }, ['a', 'b'], 0.0), 'b');
  // all-zero/empty -> first entry (degenerate, never crash)
  assert.equal(rollWeighted({}, ['a', 'b'], 0.5), 'a');
});

test('per-field state defaults match the historical hardcoded splits', () => {
  assert.deepEqual(F2_STATE_ORDER, ['seedling', 'normal', 'wilting', 'dead']);
  assert.deepEqual(F2_STATE_DEFAULTS, { seedling: 15, normal: 55, wilting: 20, dead: 10 });
  assert.deepEqual(F4_STATE_ORDER, ['seedling', 'base', 'wilting', 'dead', 'enchanted']);
  assert.deepEqual(F4_STATE_DEFAULTS, { seedling: 15, base: 55, wilting: 20, dead: 8, enchanted: 2 });
  assert.deepEqual(F5_STATE_ORDER, ['base', 'cracked', 'mossy_overgrown', 'burned', 'frozen', 'destroyed', 'enchanted']);
  // F5 defaults: base 60 / weathered 32 split over biome subset / destroyed 6 / enchanted 2
  const g = f5StateDefaults('grassland');
  assert.equal(g.base, 60); assert.equal(g.destroyed, 6); assert.equal(g.enchanted, 2);
  assert.equal(Object.values(g).reduce((a, b) => a + b, 0), 100);
  const a = f5StateDefaults('arctic');
  assert.equal(a.frozen, 16); assert.equal(a.cracked, 16); assert.equal(a.burned, undefined);
});

test('setFieldTuning normalizes f5', () => {
  setFieldTuning({ f5: { size: 2 } });
  assert.equal(FIELD_TUNING.f5.size, 2);
  // null resets to baked defaults — f5 now has calibrated biome entries
  setFieldTuning(null);
  // baked f5 grassland hay_bale size = 0.35 (from 2026-06-12 calibration)
  assert.equal(FIELD_TUNING.f5.biomes.grassland.objects.hay_bale.size, 0.35);
  // f3 has no calibrated values, remains empty
  assert.deepEqual(FIELD_TUNING.f3, {});
});

test('maxSizeMul: baked defaults give worst-case from calibration', () => {
  setFieldTuning(null);
  // Baked f5 defaults include arctic/frozen_ruin size=1.75 (largest in calibration).
  // No master size node, so maxSizeMul = 1.75.
  assert.equal(maxSizeMul('f5'), 1.75);
  // f2/f3/f4 have no size multipliers > 1 in calibration defaults
  assert.equal(maxSizeMul('f2'), 1);
  assert.equal(maxSizeMul('f3'), 1);
  assert.equal(maxSizeMul('f4'), 1);
});

test('maxSizeMul: multiplies worst-case master/biome/object/variant', () => {
  setFieldTuning({ f5: { size: 2, biomes: {
    grassland: { size: 2, objects: {
      boulder: { sizeMin: 0.5, sizeMax: 2, variants: { 1: { size: 1.5 } } }
    } },
    desert: { size: 1.25 }
  } } });
  // live: 2 (master) * 2 (worst biome) * 2 (sizeMax) * 1.5 (variant) = 12
  // baked arctic/frozen_ruin size=1.75 merges under these — grassland live wins
  assert.equal(maxSizeMul('f5'), 12);
  setFieldTuning(null);
});

test('fresh state (setFieldTuning null): f5 grassland hay_bale size and anim from baked defaults', () => {
  setFieldTuning(null);
  // Calibration: f5.biomes.grassland.objects.hay_bale = { size: 0.35, density: 0.55, anims: { wind_sway: false } }
  // hay_bale has no biome-level size node, only object-level size 0.35
  // tuneSize: master(1) * biome(1, no biome size) * object(0.35) = 0.35
  assert.equal(tuneSize('f5', 'grassland', 'hay_bale', 0, 0, 0, 9999), 0.35);
  // wind_sway is baked false for f5 grassland hay_bale (F5 no-wind-anims policy)
  assert.equal(tuneAnimEnabled('f5', 'grassland', 'hay_bale', 'wind_sway'), false);
});

test('live override wins over baked defaults, sibling keys from defaults are preserved', () => {
  // Live sets hay_bale size to 1; defaults have density 0.55
  setFieldTuning({ f5: { biomes: { grassland: { objects: { hay_bale: { size: 1 } } } } } });
  // live size wins
  assert.equal(tuneSize('f5', 'grassland', 'hay_bale', 0, 0, 0, 9999), 1);
  // default density still applies (sibling key preserved via merge)
  assert.equal(tuneObjDensity('f5', 'grassland', 'hay_bale'), 0.55);
  setFieldTuning(null);
});
