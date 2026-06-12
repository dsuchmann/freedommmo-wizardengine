// test/field-tuning.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIELD_TUNING, setFieldTuning, tuneSize, tuneBiomeDensity, tuneObjDensity, tuneAnimEnabled } from '../src/world/field-tuning.js';

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
  assert.equal(tuneBiomeDensity('f3', 'desert'), 1);      // 2 * 0.5
  assert.equal(tuneObjDensity('f3', 'desert', 'bleached_bone'), 0.25);
  assert.equal(tuneObjDensity('f3', 'desert', 'other'), 1);
});

test('setFieldTuning replaces tree and live-binding updates', () => {
  setFieldTuning({ f4: { size: 5 } });
  assert.equal(FIELD_TUNING.f4.size, 5);
  setFieldTuning(null);
  assert.deepEqual(FIELD_TUNING, { f2: {}, f3: {}, f4: {} });
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
