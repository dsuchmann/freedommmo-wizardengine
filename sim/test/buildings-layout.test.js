// sim/test/buildings-layout.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignDistricts, DISTRICT_CONFIGS, generateRoadSpines } from '../world/buildings/layout.js';

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

// ── Task 2: Road spines ──────────────────────────────────────────────

test('road spines: village has at least 1 spine', () => {
  const districts = assignDistricts(42, { x: 500, y: 500 }, 'village', 'human', 'grassland');
  const spines = generateRoadSpines(42, { x: 500, y: 500 }, districts);
  assert.ok(spines.length >= 1, 'at least 1 road spine');
});

test('road spines: town has at least 3 spines', () => {
  const districts = assignDistricts(42, { x: 500, y: 500 }, 'town', 'human', 'grassland');
  const spines = generateRoadSpines(42, { x: 500, y: 500 }, districts);
  assert.ok(spines.length >= 3, `only ${spines.length} spines`);
});

test('each spine is an array of {x,y} waypoints', () => {
  const districts = assignDistricts(42, { x: 500, y: 500 }, 'village', 'human', 'grassland');
  const spines = generateRoadSpines(42, { x: 500, y: 500 }, districts);
  for (const spine of spines) {
    assert.ok(Array.isArray(spine.points), 'spine has points array');
    assert.ok(spine.points.length >= 2, 'spine has at least 2 waypoints');
    for (const p of spine.points) {
      assert.ok(typeof p.x === 'number' && typeof p.y === 'number', 'waypoint has x,y');
    }
    assert.ok(spine.tier, 'spine has tier (street/alley)');
  }
});

test('primary spine passes through settlement center', () => {
  const site = { x: 500, y: 500 };
  const districts = assignDistricts(42, site, 'town', 'human', 'grassland');
  const spines = generateRoadSpines(42, site, districts);
  const primary = spines.find(s => s.tier === 'street');
  assert.ok(primary, 'has a primary street');
  // At least one waypoint should be at or near center
  const nearCenter = primary.points.some(p =>
    Math.abs(p.x - site.x) <= 3 && Math.abs(p.y - site.y) <= 3);
  assert.ok(nearCenter, 'primary street passes near center');
});

test('road spines are deterministic', () => {
  const districts = assignDistricts(42, { x: 500, y: 500 }, 'town', 'human', 'grassland');
  const a = generateRoadSpines(42, { x: 500, y: 500 }, districts);
  const b = generateRoadSpines(42, { x: 500, y: 500 }, districts);
  assert.deepEqual(a, b);
});
