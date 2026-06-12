// sim/test/routing.test.js — P2: deterministic A* over terrain cost; water impassable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tileCost, planRoute, WATER_BIOMES } from '../world/routing.js';

const GRASS_BOUNDS = { x0: 938, y0: 6, w: 16, h: 8 };   // pure grassland (south of river wedge)

test('P2 tileCost: grassland cheap, water impassable (Infinity)', () => {
  assert.equal(tileCost(940, 8), 1);                  // grassland movementCost 1
  assert.equal(tileCost(0, 0), Infinity);             // ocean
  assert.equal(tileCost(930, 0), Infinity);           // river wedge
});

test('P2 planRoute: straight line on uniform grassland, endpoints included', () => {
  const route = planRoute({ x: 940, y: 8 }, { x: 946, y: 8 }, GRASS_BOUNDS);
  assert.ok(route, 'route found');
  assert.deepEqual(route[0], { x: 940, y: 8 });
  assert.deepEqual(route.at(-1), { x: 946, y: 8 });
  assert.equal(route.length, 7, 'orthogonal straight line on uniform cost');
  for (let i = 1; i < route.length; i++) {
    const d = Math.abs(route[i].x - route[i-1].x) + Math.abs(route[i].y - route[i-1].y);
    assert.equal(d, 1, '4-connected steps only');
  }
});

test('P2 planRoute: detours around the river wedge — no route tile is water', () => {
  // Wedge ≈ x925-937 × y0-5 (shrinks eastward; y0 is river through ≈x937).
  const bounds = { x0: 925, y0: 0, w: 30, h: 12 };
  const route = planRoute({ x: 930, y: 8 }, { x: 944, y: 0 }, bounds);
  assert.ok(route, 'route exists around the wedge');
  for (const t of route) {
    assert.ok(tileCost(t.x, t.y) !== Infinity, `route avoids water at ${t.x},${t.y}`);
  }
});

test('P2 planRoute: unreachable (destination on water / walled off) → null, never a fake route', () => {
  assert.equal(planRoute({ x: 940, y: 8 }, { x: 0, y: 0 }, { x0: 0, y0: 0, w: 950, h: 16 }), null,
    'ocean destination refused');
  assert.equal(planRoute({ x: 0, y: 0 }, { x: 5, y: 5 }, { x0: 0, y0: 0, w: 8, h: 8 }), null,
    'ocean origin refused');
});

test('P2 determinism: same inputs → identical route, twice', () => {
  const bounds = { x0: 925, y0: 0, w: 30, h: 12 };
  const a = planRoute({ x: 930, y: 8 }, { x: 944, y: 0 }, bounds);
  const b = planRoute({ x: 930, y: 8 }, { x: 944, y: 0 }, bounds);
  assert.deepEqual(a, b);
});
