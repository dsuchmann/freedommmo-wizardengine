// sim/test/stream-biome.test.js — P2.5: the stream channel layer in classifyBiome.
// Additive: basin water ids unchanged everywhere (empirical P2/P3 geography intact);
// stream tiles get id 'stream' on land only; routing treats streams as water.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyBiome } from '../../src/world/biomes.js';
import { streamAt } from '../../src/world/hydrology.js';
import { tileCost, WATER_BIOMES } from '../world/routing.js';

test('P2.5 stream layer: channel tiles classify as stream; id carries the hydrology evidence', () => {
  // discover a stream tile (same scan approach as hydrology.test.js)
  let tile = null;
  outer: for (let y = -300; y < 300; y += 3) for (let x = 930; x < 2430; x += 3) {
    if (streamAt(x, y)) { tile = { x, y }; break outer; }
  }
  assert.ok(tile, 'a stream tile exists inland');
  const b = classifyBiome(tile.x, tile.y);
  assert.equal(b.id, 'stream');
  assert.ok(b.definition.movementCost >= 1, 'stream has a definition');
  assert.ok(b.climate.stream, 'climate carries stream evidence {width, dist}');
  assert.ok(b.climate.stream.width >= 1);
});

test('P2.5 additive guarantee: every empirically-known water/land tile keeps its pre-stream id', () => {
  // P2/P3 geography must be untouched (these ids back routing/suitability/probe tests)
  assert.equal(classifyBiome(930, 0).id !== 'stream' && WATER_BIOMES.has(classifyBiome(930, 0).id), true,
    'river wedge tile is still basin water');
  const grass = classifyBiome(940, 8);
  assert.ok(!WATER_BIOMES.has(grass.id), '(940,8) still land');     // P3 founding site
  const grass2 = classifyBiome(953, 0);
  assert.ok(!WATER_BIOMES.has(grass2.id), '(953,0) still land');    // P3 probe site2
  assert.equal(classifyBiome(0, 0).id, classifyBiome(0, 0).id, 'pure');
  // open water never re-classifies as stream
  assert.notEqual(classifyBiome(0, 0).id, 'stream');
});

test('P2.5 routing: stream tiles are impassable water by default', () => {
  assert.ok(WATER_BIOMES.has('stream'), 'stream in the impassable set');
  let tile = null;
  outer: for (let y = -300; y < 300; y += 3) for (let x = 930; x < 2430; x += 3) {
    if (streamAt(x, y)) { tile = { x, y }; break outer; }
  }
  assert.equal(tileCost(tile.x, tile.y), Infinity, 'stream tile costs Infinity without a crossing');
});
