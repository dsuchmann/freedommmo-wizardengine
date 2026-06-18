// sim/test/buildings-unit-vertical.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unitSubFloorCount, selectPrivateStair } from '../world/buildings/unit-vertical.js';

const rect = (w, h) => { const t = []; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) t.push({ x, y }); return t; };

test('ineligible unit kinds never go multi-floor', () => {
  const tiles = rect(4, 3); // 12 tiles
  for (const k of ['lobby', 'storage', 'hall', 'crypt', 'gallery', 'house', 'room'])
    for (let s = 0; s < 50; s++)
      assert.equal(unitSubFloorCount(s, k, tiles), 1, `${k} must stay single-floor`);
});

test('small eligible units stay single-floor (no room for a stair + content on two levels)', () => {
  const tiny = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]; // 3 tiles
  for (let s = 0; s < 50; s++) assert.equal(unitSubFloorCount(s, 'shop', tiny), 1);
});

test('eligible large units are a deterministic minority of multi-floor (exactly 2 sub-floors)', () => {
  const tiles = rect(4, 3);
  let multi = 0; const N = 400;
  for (let s = 0; s < N; s++) {
    const c = unitSubFloorCount(s, 'shop', tiles);
    assert.ok(c === 1 || c === 2, 'sub-floor count is 1 or 2 (depth <= 1)');
    if (c === 2) multi++;
  }
  assert.ok(multi > 0, 'some eligible units go multi-floor');
  assert.ok(multi < N * 0.5, 'multi-floor units are a minority');
  assert.equal(unitSubFloorCount(7, 'shop', tiles), unitSubFloorCount(7, 'shop', tiles), 'deterministic');
});

test('private stair is a tile of the unit, deterministic', () => {
  const tiles = [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 2 }, { x: 4, y: 3 }];
  const s = selectPrivateStair(tiles);
  assert.ok(tiles.some(t => t.x === s.x && t.y === s.y), 'stair is one of the unit tiles');
  assert.deepEqual(selectPrivateStair(tiles), s, 'deterministic');
  assert.equal(selectPrivateStair([]), null, 'empty unit → null');
});
