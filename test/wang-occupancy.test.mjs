import { test } from 'node:test';
import assert from 'node:assert/strict';
import { occupancyGrid } from '../scripts/lib/wang-occupancy.mjs';
import { COLLIDABLE_WANG, registerWangOccupancy, wangBlocksAt, _resetWangCollision } from '../src/world/wang-collision.js';

function mask(rows) { // 32x32 from 32 strings of length 32
  const alpha = new Uint8Array(32 * 32);
  rows.forEach((r, y) => { for (let x = 0; x < 32; x++) alpha[y * 32 + x] = r[x] === '#' ? 255 : 0; });
  return { w: 32, h: 32, alpha };
}

test('occupancyGrid: a left-edge wall band occupies only the left cell columns', () => {
  const rows = [];
  for (let y = 0; y < 32; y++) rows.push('########' + ' '.repeat(24)); // 8px wall on the left
  const g = occupancyGrid(mask(rows));
  assert.equal(g.length, 64);
  for (let cy = 0; cy < 8; cy++) {
    assert.equal(g[cy * 8 + 0], 1);   // cols 0-1 cover px 0-7
    assert.equal(g[cy * 8 + 1], 1);
    assert.equal(g[cy * 8 + 4], 0);   // middle is open
    assert.equal(g[cy * 8 + 7], 0);
  }
});

test('occupancyGrid: minFrac gate ignores stray pixels', () => {
  const rows = Array.from({ length: 32 }, () => ' '.repeat(32).split(''));
  rows[0][0] = '#'; // single pixel
  const g = occupancyGrid(mask(rows.map(r => r.join(''))), { minFrac: 0.15 });
  assert.equal(g[0], 0);
});

test('COLLIDABLE_WANG starts empty; lookup is inert until a set registers', () => {
  _resetWangCollision();
  assert.deepEqual(Object.keys(COLLIDABLE_WANG), []);
  assert.equal(wangBlocksAt('any_set', 5, 0.1, 0.1), false);
  // synthetic registration (the P4 path): wang index 3 blocks its left columns
  const strip = new Uint8Array(64);
  for (let cy = 0; cy < 8; cy++) { strip[cy * 8] = 1; strip[cy * 8 + 1] = 1; }
  registerWangOccupancy('synthetic_cliff', { 3: strip });
  assert.equal(wangBlocksAt('synthetic_cliff', 3, 0.05, 0.5), true);   // u=0.05 -> col 0
  assert.equal(wangBlocksAt('synthetic_cliff', 3, 0.9, 0.5), false);   // open side
  assert.equal(wangBlocksAt('synthetic_cliff', 7, 0.05, 0.5), false);  // unregistered index
  _resetWangCollision();
});
