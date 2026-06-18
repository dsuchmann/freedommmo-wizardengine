import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floorCount, floorStackPlan, MAX_FLOORS } from '../world/buildings/building-floors.js';

test('floorCount is deterministic', () => {
  const a = floorCount(42, 5, 9, 'apartment', 'city', 0.6);
  const b = floorCount(42, 5, 9, 'apartment', 'city', 0.6);
  assert.deepEqual(a, b);
});

test('aboveGroundFloors === count of indices >= 0; ground always exists; capped 1..100', () => {
  for (let n = 0; n < 400; n++) {
    const bx = (n * 13) % 211, by = (n * 29) % 197;
    const cat = ['apartment', 'residential', 'house', 'commercial', 'civic', 'religious', 'military'][n % 7];
    const tier = ['hamlet', 'village', 'town', 'city', 'metropolis', 'world_capital'][n % 6];
    const { floorRange, aboveGroundFloors } = floorCount(42, bx, by, cat, tier, (n % 10) / 10);
    const [min, max] = floorRange;
    assert.ok(min <= 0, `minFloor must be <= 0 (got ${min})`);
    assert.ok(max >= 0, `ground (index 0) must exist (maxFloor ${max})`);
    assert.equal(max + 1, aboveGroundFloors, 'aboveGroundFloors must equal count of indices >= 0');
    assert.ok(aboveGroundFloors >= 1 && aboveGroundFloors <= MAX_FLOORS, `out of range: ${aboveGroundFloors}`);
  }
});

test('mean floor count increases with settlement tier', () => {
  const meanFor = (tier) => {
    let sum = 0, n = 0;
    for (let i = 0; i < 300; i++) {
      const r = floorCount(42, (i * 17) % 223, (i * 41) % 199, 'apartment', tier, 0.8);
      sum += r.aboveGroundFloors; n++;
    }
    return sum / n;
  };
  const low = meanFor('hamlet');
  const high = meanFor('metropolis');
  assert.ok(high > low, `metropolis (${high.toFixed(2)}) should be taller than hamlet (${low.toFixed(2)})`);
});

test('floorStackPlan covers the range with a use per index', () => {
  const plan = floorStackPlan(42, [-1, 3], 'apartment');
  assert.equal(plan.length, 5);
  assert.deepEqual(plan.map(p => p.index), [-1, 0, 1, 2, 3]);
  for (const p of plan) assert.ok(p.use, `index ${p.index} missing use`);
  assert.equal(plan[0].use, 'storage', 'basement of apartment = storage');
  assert.equal(plan[1].use, 'lobby', 'ground of apartment = lobby');
  assert.equal(plan[4].use, 'residential', 'top of apartment = residential');
});

test('floorStackPlan: religious basement=crypt, ground=hall; shop ground=shopfront', () => {
  const temple = floorStackPlan(42, [-1, 1], 'religious');
  assert.equal(temple[0].use, 'crypt');
  assert.equal(temple[1].use, 'hall');
  const shop = floorStackPlan(42, [0, 1], 'commercial');
  assert.equal(shop[0].use, 'shopfront');
});
