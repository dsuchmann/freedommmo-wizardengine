// sim/test/buildings-layout.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignDistricts, DISTRICT_CONFIGS, generateRoadSpines, placeBuildings, layoutSettlement } from '../world/buildings/layout.js';
import { siteBuildable } from '../world/buildings/terrain-suitability.js';

test('village gets 2 districts (residential + craft)', () => {
  const districts = assignDistricts(42, { x: 1460, y: 768 }, 'village', 'human', 'grassland');
  assert.equal(districts.length, 2);
  const kinds = districts.map(d => d.kind).sort();
  assert.deepEqual(kinds, ['craft', 'residential']);
});

test('town gets 5 districts', () => {
  const districts = assignDistricts(42, { x: 1460, y: 768 }, 'town', 'human', 'grassland');
  assert.equal(districts.length, 5);
  const kinds = districts.map(d => d.kind).sort();
  assert.deepEqual(kinds, ['civic', 'craft', 'market', 'religious', 'residential']);
});

test('city gets 8 districts', () => {
  const districts = assignDistricts(42, { x: 1460, y: 768 }, 'city', 'human', 'grassland');
  assert.equal(districts.length, 8);
  const kinds = new Set(districts.map(d => d.kind));
  for (const k of ['residential', 'market', 'craft', 'civic', 'religious', 'military', 'agricultural', 'entertainment']) {
    assert.ok(kinds.has(k), `city missing district: ${k}`);
  }
});

test('districts have radial sectors with angle ranges', () => {
  const districts = assignDistricts(42, { x: 1460, y: 768 }, 'town', 'human', 'grassland');
  for (const d of districts) {
    assert.ok('angleStart' in d, `district ${d.kind} missing angleStart`);
    assert.ok('angleEnd' in d, `district ${d.kind} missing angleEnd`);
    assert.ok('radius' in d, `district ${d.kind} missing radius`);
    assert.ok(d.angleEnd > d.angleStart, `district ${d.kind} has zero-width angle`);
  }
});

test('civic district is centered (smallest angle offset from 0)', () => {
  const districts = assignDistricts(42, { x: 1460, y: 768 }, 'town', 'human', 'grassland');
  const civic = districts.find(d => d.kind === 'civic');
  assert.ok(civic, 'civic district exists');
  // civic should wrap around angle 0 (north) or be closest to center
  assert.ok(civic.radius <= districts[0].radius, 'civic radius is innermost');
});

test('districts are deterministic', () => {
  const a = assignDistricts(42, { x: 1460, y: 768 }, 'town', 'human', 'grassland');
  const b = assignDistricts(42, { x: 1460, y: 768 }, 'town', 'human', 'grassland');
  assert.deepEqual(a, b);
});

test('different seeds produce different district angles', () => {
  const a = assignDistricts(42, { x: 1460, y: 768 }, 'town', 'human', 'grassland');
  const b = assignDistricts(99, { x: 1460, y: 768 }, 'town', 'human', 'grassland');
  // At least one angle should differ
  const anglesA = a.map(d => d.angleStart).join(',');
  const anglesB = b.map(d => d.angleStart).join(',');
  assert.notEqual(anglesA, anglesB, 'different seeds -> different angles');
});

// ── Task 2: Road spines ──────────────────────────────────────────────

test('road spines: village has at least 1 spine', () => {
  const districts = assignDistricts(42, { x: 1460, y: 768 }, 'village', 'human', 'grassland');
  const spines = generateRoadSpines(42, { x: 1460, y: 768 }, districts);
  assert.ok(spines.length >= 1, 'at least 1 road spine');
});

test('road spines: town has at least 3 spines', () => {
  const districts = assignDistricts(42, { x: 1460, y: 768 }, 'town', 'human', 'grassland');
  const spines = generateRoadSpines(42, { x: 1460, y: 768 }, districts);
  assert.ok(spines.length >= 3, `only ${spines.length} spines`);
});

test('each spine is an array of {x,y} waypoints', () => {
  const districts = assignDistricts(42, { x: 1460, y: 768 }, 'village', 'human', 'grassland');
  const spines = generateRoadSpines(42, { x: 1460, y: 768 }, districts);
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
  const site = { x: 1460, y: 768 };
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
  const districts = assignDistricts(42, { x: 1460, y: 768 }, 'town', 'human', 'grassland');
  const a = generateRoadSpines(42, { x: 1460, y: 768 }, districts);
  const b = generateRoadSpines(42, { x: 1460, y: 768 }, districts);
  assert.deepEqual(a, b);
});

// ── Task 3: Building placement ───────────────────────────────────────

// NOTE: placement is terrain-aware (siteBuildable) since 2026-06-20, so these tests plant the
// settlement at a verified INLAND buildable site (1460,768). The old (500,500) was shallow water
// on a mountain slope — placement now correctly refuses to build there.

test('placeBuildings: never places a building on water or a cliff (water-aware)', () => {
  // A coastal site (1200,640) where many candidate positions fall in water — every PLACED
  // building must still be on buildable ground, so the resolver's relocation never has to fire.
  const site = { x: 1200, y: 640 };
  const d = assignDistricts(42, site, 'town', 'human', 'grassland');
  const s = generateRoadSpines(42, site, d);
  const buildings = placeBuildings(42, site, 'town', 'human', d, s);
  assert.ok(buildings.length > 0, 'expected some buildings on the land portion of a coastal site');
  for (const b of buildings) {
    assert.ok(siteBuildable(b.x, b.y, b.footprint), `building at ${b.x},${b.y} on unbuildable terrain`);
  }
});

test('placeBuildings: village produces at least 5 buildings', () => {
  const districts = assignDistricts(42, { x: 1460, y: 768 }, 'village', 'human', 'grassland');
  const spines = generateRoadSpines(42, { x: 1460, y: 768 }, districts);
  const buildings = placeBuildings(42, { x: 1460, y: 768 }, 'village', 'human', districts, spines);
  assert.ok(buildings.length >= 5, `only ${buildings.length} buildings in village`);
});

test('placeBuildings: town produces more buildings than village', () => {
  const vd = assignDistricts(42, { x: 1460, y: 768 }, 'village', 'human', 'grassland');
  const vs = generateRoadSpines(42, { x: 1460, y: 768 }, vd);
  const vb = placeBuildings(42, { x: 1460, y: 768 }, 'village', 'human', vd, vs);

  const td = assignDistricts(42, { x: 1460, y: 768 }, 'town', 'human', 'grassland');
  const ts = generateRoadSpines(42, { x: 1460, y: 768 }, td);
  const tb = placeBuildings(42, { x: 1460, y: 768 }, 'town', 'human', td, ts);

  assert.ok(tb.length > vb.length, `town (${tb.length}) should have more buildings than village (${vb.length})`);
});

test('placeBuildings: each building has position, footprint, and district', () => {
  const districts = assignDistricts(42, { x: 1460, y: 768 }, 'town', 'human', 'grassland');
  const spines = generateRoadSpines(42, { x: 1460, y: 768 }, districts);
  const buildings = placeBuildings(42, { x: 1460, y: 768 }, 'town', 'human', districts, spines);
  for (const b of buildings) {
    assert.ok(typeof b.x === 'number', `building missing x`);
    assert.ok(typeof b.y === 'number', `building missing y`);
    assert.ok(b.footprint, 'building missing footprint');
    assert.ok(b.footprint.typeId, 'footprint missing typeId');
    assert.ok(b.district, 'building missing district assignment');
  }
});

test('placeBuildings: no two buildings overlap', () => {
  const districts = assignDistricts(42, { x: 1460, y: 768 }, 'city', 'human', 'grassland');
  const spines = generateRoadSpines(42, { x: 1460, y: 768 }, districts);
  const buildings = placeBuildings(42, { x: 1460, y: 768 }, 'city', 'human', districts, spines);
  // Collect all occupied tiles
  const occupied = new Set();
  for (const b of buildings) {
    const bb = b.footprint.boundingBox;
    for (let dy = 0; dy < bb.h; dy++) {
      for (let dx = 0; dx < bb.w; dx++) {
        const key = `${b.x + dx},${b.y + dy}`;
        assert.ok(!occupied.has(key), `overlap at ${key} (building ${b.footprint.typeId})`);
        occupied.add(key);
      }
    }
  }
});

test('placeBuildings: anchor building is first in its district', () => {
  const districts = assignDistricts(42, { x: 1460, y: 768 }, 'town', 'human', 'grassland');
  const spines = generateRoadSpines(42, { x: 1460, y: 768 }, districts);
  const buildings = placeBuildings(42, { x: 1460, y: 768 }, 'town', 'human', districts, spines);
  // The civic district's first building should be the town_hall
  const civicBuildings = buildings.filter(b => b.district === 'civic');
  if (civicBuildings.length > 0) {
    assert.equal(civicBuildings[0].footprint.typeId, 'town_hall',
      'civic anchor is town_hall');
  }
});

test('placeBuildings: deterministic', () => {
  const d = assignDistricts(42, { x: 1460, y: 768 }, 'town', 'human', 'grassland');
  const s = generateRoadSpines(42, { x: 1460, y: 768 }, d);
  const a = placeBuildings(42, { x: 1460, y: 768 }, 'town', 'human', d, s);
  const b = placeBuildings(42, { x: 1460, y: 768 }, 'town', 'human', d, s);
  assert.deepEqual(a, b);
});

test('placeBuildings: buildings within settlement radius', () => {
  const site = { x: 1460, y: 768 };
  const districts = assignDistricts(42, site, 'village', 'human', 'grassland');
  const spines = generateRoadSpines(42, site, districts);
  const buildings = placeBuildings(42, site, 'village', 'human', districts, spines);
  const maxR = Math.max(...districts.map(d => d.radius));
  for (const b of buildings) {
    const dx = b.x - site.x, dy = b.y - site.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    assert.ok(dist <= maxR + 20, `building at distance ${dist} exceeds radius ${maxR}`);
  }
});

// ── Task 4: layoutSettlement ─────────────────────────────────────────

test('layoutSettlement returns complete catalog', () => {
  const layout = layoutSettlement(42, { x: 1460, y: 768 }, 'town', 'human', 'grassland');
  assert.ok(layout.districts.length > 0, 'has districts');
  assert.ok(layout.buildings.length > 0, 'has buildings');
  assert.ok(layout.spines.length > 0, 'has road spines');
  assert.ok(layout.site, 'has site');
  assert.equal(layout.tier, 'town');
  assert.equal(layout.race, 'human');
});

test('layoutSettlement is deterministic', () => {
  const a = layoutSettlement(42, { x: 1460, y: 768 }, 'town', 'human', 'grassland');
  const b = layoutSettlement(42, { x: 1460, y: 768 }, 'town', 'human', 'grassland');
  assert.equal(a.buildings.length, b.buildings.length);
  for (let i = 0; i < a.buildings.length; i++) {
    assert.equal(a.buildings[i].x, b.buildings[i].x);
    assert.equal(a.buildings[i].y, b.buildings[i].y);
    assert.equal(a.buildings[i].footprint.typeId, b.buildings[i].footprint.typeId);
  }
});

test('layoutSettlement can be queried by tile', () => {
  const layout = layoutSettlement(42, { x: 1460, y: 768 }, 'village', 'human', 'grassland');
  // Pick a known building position and query it
  if (layout.buildings.length > 0) {
    const b = layout.buildings[0];
    const result = layout.queryTile(b.x, b.y);
    assert.ok(result, 'tile query returns something at building position');
    assert.equal(result.type, 'building');
    assert.equal(result.building.footprint.typeId, b.footprint.typeId);
  }
});

test('layoutSettlement queryTile returns null for empty tile', () => {
  const layout = layoutSettlement(42, { x: 1460, y: 768 }, 'village', 'human', 'grassland');
  // Far from settlement -- should be null
  const result = layout.queryTile(0, 0);
  assert.equal(result, null);
});

test('layoutSettlement queryTile identifies road tiles', () => {
  const layout = layoutSettlement(42, { x: 1460, y: 768 }, 'town', 'human', 'grassland');
  // Walk along a spine and check that at least one tile returns road
  let foundRoad = false;
  if (layout.spines.length > 0) {
    const spine = layout.spines[0];
    for (const p of spine.points) {
      const r = layout.queryTile(p.x, p.y);
      if (r && r.type === 'road') { foundRoad = true; break; }
    }
  }
  assert.ok(foundRoad, 'at least one spine waypoint is a road tile');
});

// ── Task 6: Integration -- layout + territory ────────────────────────
import { computeTerritory } from '../world/territory.js';

test('integration: layout fits within territory', () => {
  const site = { x: 1460, y: 768 };
  const layout = layoutSettlement(42, site, 'town', 'human', 'grassland');
  const territory = computeTerritory(42, site, 'town');
  // Every building should be inside the territory
  let insideCount = 0;
  for (const b of layout.buildings) {
    if (territory.tiles.has(`${b.x},${b.y}`)) insideCount++;
  }
  const pct = insideCount / layout.buildings.length;
  assert.ok(pct >= 0.7, `only ${(pct * 100).toFixed(0)}% of buildings inside territory`);
});

test('integration: territory boundary is not a rectangle', () => {
  const territory = computeTerritory(42, { x: 1460, y: 768 }, 'town');
  assert.ok(territory.boundary.size > 0, 'has boundary tiles');
  // Boundary should not be a perfect rectangle border
  const bPoints = [...territory.boundary].map(k => k.split(',').map(Number));
  const xs = bPoints.map(p => p[0]);
  const ys = bPoints.map(p => p[1]);
  const uniqueXs = new Set(xs).size;
  const uniqueYs = new Set(ys).size;
  // A rectangle boundary has only 2 unique x values (left, right edges) for horizontal runs
  // and 2 unique y values for vertical runs. Organic shape has many more.
  assert.ok(uniqueXs > 4, `boundary has only ${uniqueXs} unique x coords -- too rectangular`);
  assert.ok(uniqueYs > 4, `boundary has only ${uniqueYs} unique y coords -- too rectangular`);
});
