// sim/test/chronicle-races.test.js — P3 L1a: biome-anchored race table tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RACES, biomeAffinities, macroCellPeoples } from '../chronicle/races.js';

const HABITABLE_BIOMES = [
  'volcanic', 'mystic', 'swamp', 'mountains', 'hills',
  'forest', 'dense_forest', 'tropical_forest',
  'desert', 'savanna', 'steppe', 'grassland',
  'tundra', 'taiga', 'arctic', 'beach',
];

const FORBIDDEN = ['orc', 'elf', 'dwarf', 'goblin', 'hobbit', 'halfling', 'gnome', 'troll'];

test('every listed habitable biome has at least one race with weight >= 0.5', () => {
  for (const biome of HABITABLE_BIOMES) {
    const affs = biomeAffinities(biome);
    const strong = affs.filter(a => a.weight >= 0.5);
    assert.ok(strong.length > 0, `biome ${biome} needs a race with weight >= 0.5, got ${JSON.stringify(affs)}`);
  }
});

test('no forbidden race names', () => {
  for (const [raceId, race] of Object.entries(RACES)) {
    const lower = race.name.toLowerCase();
    for (const f of FORBIDDEN) {
      assert.ok(!lower.includes(f), `race ${raceId} name "${race.name}" contains forbidden "${f}"`);
    }
    const descLower = race.desc.toLowerCase();
    for (const f of FORBIDDEN) {
      assert.ok(!descLower.includes(f), `race ${raceId} desc contains forbidden "${f}"`);
    }
  }
});

test('humans exist with broad affinities', () => {
  assert.ok(RACES.human, 'human race defined');
  assert.ok(RACES.human.affinities.length >= 5, 'humans have broad affinities');
});

test('biomeAffinities returns sorted by weight desc', () => {
  for (const biome of HABITABLE_BIOMES) {
    const affs = biomeAffinities(biome);
    for (let i = 1; i < affs.length; i++) {
      assert.ok(affs[i - 1].weight >= affs[i].weight, `${biome}: not sorted at index ${i}`);
    }
  }
});

test('macroCellPeoples is deterministic', () => {
  const epochs = [{ type: 'creation', age: 5, severity: 0.3 }];
  const a = macroCellPeoples(42, '8,0', epochs);
  const b = macroCellPeoples(42, '8,0', epochs);
  assert.deepEqual(a, b, 'same seed+key+epochs → same result');
});

test('macroCellPeoples varies with seed', () => {
  const epochs = [{ type: 'creation', age: 5, severity: 0.3 }];
  // Scan several macro-cells to find divergence
  let differ = false;
  for (let mx = 5; mx < 20; mx++) {
    const a = macroCellPeoples(42, `${mx},0`, epochs);
    const b = macroCellPeoples(999, `${mx},0`, epochs);
    if (JSON.stringify(a) !== JSON.stringify(b)) { differ = true; break; }
  }
  assert.ok(differ, 'different seeds should produce different peoples somewhere');
});
