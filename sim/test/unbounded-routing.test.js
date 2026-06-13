import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRoute, tileCost } from '../world/routing.js';

function landPairNear(x0, y0) {
  let a = null;
  for (let y = y0; y < y0 + 200 && !a; y++) for (let x = x0; x < x0 + 200 && !a; x++) {
    if (tileCost(x, y) !== Infinity && tileCost(x + 3, y) !== Infinity
      && tileCost(x + 1, y) !== Infinity && tileCost(x + 2, y) !== Infinity) {
      a = { from: { x, y }, to: { x: x + 3, y } };
    }
  }
  return a;
}

test('planRoute with null bounds routes far from origin', () => {
  const pair = landPairNear(50_000, -50_000);
  assert.ok(pair, 'expected land within the 200x200 scan window at +50k,-50k');
  const route = planRoute(pair.from, pair.to, null);
  assert.ok(route, 'route exists with null bounds');
  assert.deepEqual(route[0], pair.from);
  assert.deepEqual(route[route.length - 1], pair.to);
});

test('planRoute null-bounds result matches a generous explicit bounds', () => {
  const pair = landPairNear(7_000, 7_000);
  assert.ok(pair);
  const b = { x0: 6_900, y0: 6_900, w: 500, h: 500 };
  assert.deepEqual(planRoute(pair.from, pair.to, null), planRoute(pair.from, pair.to, b));
});
