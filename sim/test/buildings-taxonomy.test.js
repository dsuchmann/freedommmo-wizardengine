// sim/test/buildings-taxonomy.test.js — Phase A Task 1: building taxonomy tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES, BUILDING_TYPES, typesInCategory, typeById, typesForTier,
} from '../world/buildings/taxonomy.js';

test('all 10 categories present', () => {
  assert.equal(CATEGORIES.length, 10);
  const expected = [
    'residential', 'commercial', 'craft', 'agricultural',
    'civic', 'religious', 'military', 'infrastructure',
    'entertainment', 'race_specific',
  ];
  for (const cat of expected) {
    assert.ok(CATEGORIES.includes(cat), `missing category: ${cat}`);
  }
});

test('70+ building types defined', () => {
  const count = Object.keys(BUILDING_TYPES).length;
  assert.ok(count >= 70, `expected 70+ types, got ${count}`);
});

test('every type has required fields', () => {
  const requiredFields = ['category', 'name', 'patterns', 'minW', 'minH', 'maxW', 'maxH', 'features', 'tier'];
  for (const [id, type] of Object.entries(BUILDING_TYPES)) {
    for (const field of requiredFields) {
      assert.ok(field in type, `${id} missing field: ${field}`);
    }
    assert.ok(Array.isArray(type.patterns), `${id}.patterns not array`);
    assert.ok(type.patterns.length >= 1, `${id} has no patterns`);
    assert.ok(type.minW <= type.maxW, `${id} minW > maxW`);
    assert.ok(type.minH <= type.maxH, `${id} minH > maxH`);
    assert.ok(['village', 'town', 'city'].includes(type.tier), `${id} bad tier: ${type.tier}`);
    assert.ok(CATEGORIES.includes(type.category), `${id} bad category: ${type.category}`);
    for (const f of type.features) {
      assert.ok('type' in f && 'required' in f, `${id} feature missing type/required`);
    }
  }
});

test('every category has 3+ types', () => {
  for (const cat of CATEGORIES) {
    const types = typesInCategory(cat);
    assert.ok(types.length >= 3, `category ${cat} has only ${types.length} types`);
  }
});

test('typeById returns correct type or null', () => {
  const hut = typeById('hut');
  assert.ok(hut !== null);
  assert.equal(hut.name, 'Hut');
  assert.equal(hut.category, 'residential');

  const missing = typeById('nonexistent_building');
  assert.equal(missing, null);
});

test('typesInCategory returns decorated objects with id', () => {
  const crafts = typesInCategory('craft');
  assert.ok(crafts.length >= 3);
  for (const c of crafts) {
    assert.ok('id' in c, 'missing id field');
    assert.equal(c.category, 'craft');
  }
});

test('typesForTier — village subset of town subset of city', () => {
  const village = typesForTier('village');
  const town = typesForTier('town');
  const city = typesForTier('city');
  assert.ok(village.length > 0);
  assert.ok(town.length >= village.length);
  assert.ok(city.length >= town.length);
  // every village type id should appear in town and city
  const townIds = new Set(town.map(t => t.id));
  const cityIds = new Set(city.map(t => t.id));
  for (const v of village) {
    assert.ok(townIds.has(v.id), `village type ${v.id} missing from town tier`);
    assert.ok(cityIds.has(v.id), `village type ${v.id} missing from city tier`);
  }
});

test('race-specific types have race field', () => {
  const raceTypes = typesInCategory('race_specific');
  assert.ok(raceTypes.length >= 8, `expected 8+ race types, got ${raceTypes.length}`);
  for (const rt of raceTypes) {
    assert.ok('race' in rt, `race-specific type ${rt.id} missing race field`);
    assert.ok(typeof rt.race === 'string' && rt.race.length > 0, `${rt.id} race field empty`);
  }
});

test('open-air types have open: true', () => {
  const openTypes = Object.entries(BUILDING_TYPES).filter(([, t]) => t.open === true);
  assert.ok(openTypes.length >= 5, `expected 5+ open types, got ${openTypes.length}`);
});
