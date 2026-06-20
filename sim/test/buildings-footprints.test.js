// sim/test/buildings-footprints.test.js — Phase A Tasks 2 + 3: pattern + footprint tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePattern } from '../world/buildings/patterns.js';
import { generateFootprint } from '../world/buildings/footprints.js';
import { BUILDING_TYPES, typeById } from '../world/buildings/taxonomy.js';

// ── Task 2: pattern generators ────────────────────────────────────────

test('rect: 1 section, correct size', () => {
  const r = generatePattern('rect', 8, 6, 42);
  assert.equal(r.sections.length, 1);
  assert.equal(r.sections[0].w, 8);
  assert.equal(r.sections[0].h, 6);
  assert.equal(r.sections[0].x0, 0);
  assert.equal(r.sections[0].y0, 0);
});

test('L: 2 sections, area < w*h', () => {
  const r = generatePattern('L', 10, 8, 99);
  assert.equal(r.sections.length, 2);
  const area = r.sections.reduce((s, sec) => s + sec.w * sec.h, 0);
  assert.ok(area < 10 * 8, `L area ${area} should be < ${10 * 8}`);
});

test('T: 2 sections', () => {
  const r = generatePattern('T', 10, 8, 77);
  assert.equal(r.sections.length, 2);
});

test('courtyard: 4+ sections', () => {
  const r = generatePattern('courtyard', 12, 10, 55);
  assert.ok(r.sections.length >= 4, `courtyard has ${r.sections.length} sections`);
});

test('winged: 3+ sections', () => {
  const r = generatePattern('winged', 12, 8, 33);
  assert.ok(r.sections.length >= 3, `winged has ${r.sections.length} sections`);
});

test('round: sections exist', () => {
  const r = generatePattern('round', 8, 8, 44);
  assert.ok(r.sections.length >= 1);
});

test('compound: 3+ sections', () => {
  const r = generatePattern('compound', 14, 10, 22);
  assert.ok(r.sections.length >= 3, `compound has ${r.sections.length} sections`);
});

test('deterministic: same seed same result', () => {
  const a = generatePattern('L', 10, 8, 123);
  const b = generatePattern('L', 10, 8, 123);
  assert.deepStrictEqual(a, b);
});

test('deterministic: different seed different result', () => {
  const a = generatePattern('L', 10, 8, 100);
  const b = generatePattern('L', 10, 8, 200);
  // extremely unlikely to match
  const eq = JSON.stringify(a) === JSON.stringify(b);
  assert.ok(!eq, 'different seeds should usually produce different patterns');
});

test('all section dims positive', () => {
  const patterns = ['rect', 'L', 'T', 'courtyard', 'winged', 'round', 'compound'];
  for (const p of patterns) {
    const r = generatePattern(p, 14, 12, 42);
    for (const s of r.sections) {
      assert.ok(s.w > 0, `${p} section w=${s.w}`);
      assert.ok(s.h > 0, `${p} section h=${s.h}`);
    }
  }
});

// ── Task 3: footprint generator ───────────────────────────────────────

test('house has walls, doors, floors, features', () => {
  const fp = generateFootprint(42, 'house');
  assert.ok(fp !== null);
  assert.equal(fp.typeId, 'house');
  assert.equal(fp.category, 'residential');
  assert.ok(fp.walls.length > 0, 'house needs walls');
  assert.ok(fp.doors.length >= 1, 'house needs at least 1 door');
  assert.ok(fp.floors.length > 0, 'house needs floors');
  assert.ok(fp.features.length > 0, 'house needs features');
  assert.ok(fp.boundingBox.w > 0);
  assert.ok(fp.boundingBox.h > 0);
});

test('footprint deterministic: same seed same result', () => {
  const a = generateFootprint(777, 'cottage');
  const b = generateFootprint(777, 'cottage');
  assert.deepStrictEqual(a, b);
});

test('footprint different seeds differ', () => {
  const a = generateFootprint(100, 'cottage');
  const b = generateFootprint(200, 'cottage');
  const eq = JSON.stringify(a) === JSON.stringify(b);
  assert.ok(!eq, 'different seeds should produce different footprints');
});

test('walls and floors do not overlap', () => {
  const fp = generateFootprint(42, 'inn');
  const wallSet = new Set(fp.walls.map(w => `${w.x},${w.y}`));
  for (const f of fp.floors) {
    assert.ok(!wallSet.has(`${f.x},${f.y}`), `floor at ${f.x},${f.y} overlaps a wall`);
  }
});

test('doors are on perimeter (adjacent to outside)', () => {
  const fp = generateFootprint(42, 'blacksmith');
  // doors should be at positions that were originally walls (perimeter)
  // they sit on the boundary of the footprint
  const allKeys = new Set();
  for (const s of fp.sections) {
    for (let y = s.y0; y < s.y0 + s.h; y++)
      for (let x = s.x0; x < s.x0 + s.w; x++)
        allKeys.add(`${x},${y}`);
  }
  for (const d of fp.doors) {
    // door must have at least one 4-neighbour outside the footprint
    const neighbors = [
      `${d.x},${d.y-1}`, `${d.x},${d.y+1}`,
      `${d.x-1},${d.y}`, `${d.x+1},${d.y}`,
    ];
    const hasOutside = neighbors.some(n => !allKeys.has(n));
    assert.ok(hasOutside, `door at ${d.x},${d.y} not on perimeter`);
  }
});

test('every building type produces valid footprint', () => {
  for (const id of Object.keys(BUILDING_TYPES)) {
    const fp = generateFootprint(42, id);
    assert.ok(fp !== null, `${id} returned null`);
    assert.ok(fp.sections.length >= 1, `${id} has no sections`);
    assert.ok(fp.boundingBox.w > 0 && fp.boundingBox.h > 0, `${id} bad bbox`);
  }
});

test('race-specific footprints include race field', () => {
  const fp = generateFootprint(42, 'crystal_nexus');
  assert.equal(fp.race, 'veylith');
  const fp2 = generateFootprint(42, 'ember_forge');
  assert.equal(fp2.race, 'ignaar');
});

test('size within type range across 20 seeds', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const fp = generateFootprint(seed, 'house');
    const type = BUILDING_TYPES.house;
    assert.ok(fp.boundingBox.w >= type.minW && fp.boundingBox.w <= type.maxW,
      `seed ${seed}: w=${fp.boundingBox.w} outside [${type.minW},${type.maxW}]`);
    assert.ok(fp.boundingBox.h >= type.minH && fp.boundingBox.h <= type.maxH,
      `seed ${seed}: h=${fp.boundingBox.h} outside [${type.minH},${type.maxH}]`);
  }
});

test('open-air buildings have no walls', () => {
  const fp = generateFootprint(42, 'market_stall');
  assert.equal(fp.walls.length, 0, 'open building should have no walls');
  assert.ok(fp.floors.length > 0, 'open building should have floors');
});

test('unknown typeId returns null', () => {
  const fp = generateFootprint(42, 'does_not_exist');
  assert.equal(fp, null);
});

test('generateFootprint: interior meets the function minimum (feature-rich types get more floor)', () => {
  for (const typeId of ['cottage', 'manor', 'temple', 'blacksmith']) {
    let minSeen = Infinity;
    for (let s = 0; s < 12; s++) {
      const fp = generateFootprint(s * 1000 + 7, typeId, 'human');
      if (!fp) continue;
      minSeen = Math.min(minSeen, fp.floors.length);
    }
    const req = (typeById(typeId).features || []).filter(f => f.required).length;
    assert.ok(minSeen >= Math.max(9, 4 + req * 3), `${typeId} floor=${minSeen} below function minimum`);
  }
});
