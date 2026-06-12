// sim/test/baseline.test.js — the sim enumerates the renderer's own deterministic placements.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tilePlacements, placementKey } from '../world/baseline.js';

test('placements are deterministic and carry stable keys', () => {
  const a = tilePlacements(120, 80);
  const b = tilePlacements(120, 80);
  assert.deepEqual(a, b);                                  // pure function of (wx, wy)
  for (const p of a) {
    assert.match(p.key, /^f[34]:120,80:\d+$/);
    assert.ok(p.field === 'f3' || p.field === 'f4');
    assert.ok(typeof p.archetype === 'string' && p.archetype.length > 0);
    assert.ok(typeof p.biome === 'string');
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y)); // world-tile coords (fractional)
  }
});

test('keys are unique within a region and stable across tiles', () => {
  const keys = new Set();
  let n = 0;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    for (const p of tilePlacements(x, y)) { keys.add(p.key); n++; }
  }
  assert.equal(keys.size, n);
});

test('placementKey is the shared contract', () => {
  assert.equal(placementKey('f4', 3, 7, 2), 'f4:3,7:2');
});
