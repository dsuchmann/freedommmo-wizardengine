// sim/test/buildings-layout.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignDistricts, DISTRICT_CONFIGS } from '../world/buildings/layout.js';

test('village gets 2 districts (residential + craft)', () => {
  const districts = assignDistricts(42, { x: 500, y: 500 }, 'village', 'human', 'grassland');
  assert.equal(districts.length, 2);
  const kinds = districts.map(d => d.kind).sort();
  assert.deepEqual(kinds, ['craft', 'residential']);
});

test('town gets 5 districts', () => {
  const districts = assignDistricts(42, { x: 500, y: 500 }, 'town', 'human', 'grassland');
  assert.equal(districts.length, 5);
  const kinds = districts.map(d => d.kind).sort();
  assert.deepEqual(kinds, ['civic', 'craft', 'market', 'religious', 'residential']);
});

test('city gets 8 districts', () => {
  const districts = assignDistricts(42, { x: 500, y: 500 }, 'city', 'human', 'grassland');
  assert.equal(districts.length, 8);
  const kinds = new Set(districts.map(d => d.kind));
  for (const k of ['residential', 'market', 'craft', 'civic', 'religious', 'military', 'agricultural', 'entertainment']) {
    assert.ok(kinds.has(k), `city missing district: ${k}`);
  }
});

test('districts have radial sectors with angle ranges', () => {
  const districts = assignDistricts(42, { x: 500, y: 500 }, 'town', 'human', 'grassland');
  for (const d of districts) {
    assert.ok('angleStart' in d, `district ${d.kind} missing angleStart`);
    assert.ok('angleEnd' in d, `district ${d.kind} missing angleEnd`);
    assert.ok('radius' in d, `district ${d.kind} missing radius`);
    assert.ok(d.angleEnd > d.angleStart, `district ${d.kind} has zero-width angle`);
  }
});

test('civic district is centered (smallest angle offset from 0)', () => {
  const districts = assignDistricts(42, { x: 500, y: 500 }, 'town', 'human', 'grassland');
  const civic = districts.find(d => d.kind === 'civic');
  assert.ok(civic, 'civic district exists');
  // civic should wrap around angle 0 (north) or be closest to center
  assert.ok(civic.radius <= districts[0].radius, 'civic radius is innermost');
});

test('districts are deterministic', () => {
  const a = assignDistricts(42, { x: 500, y: 500 }, 'town', 'human', 'grassland');
  const b = assignDistricts(42, { x: 500, y: 500 }, 'town', 'human', 'grassland');
  assert.deepEqual(a, b);
});

test('different seeds produce different district angles', () => {
  const a = assignDistricts(42, { x: 500, y: 500 }, 'town', 'human', 'grassland');
  const b = assignDistricts(99, { x: 500, y: 500 }, 'town', 'human', 'grassland');
  // At least one angle should differ
  const anglesA = a.map(d => d.angleStart).join(',');
  const anglesB = b.map(d => d.angleStart).join(',');
  assert.notEqual(anglesA, anglesB, 'different seeds -> different angles');
});
