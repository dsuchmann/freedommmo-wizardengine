import assert from 'node:assert';
import { soilIdForBiome, SOIL_IDS } from '../src/render/wang-image-list.js';

// 0 reserved = "no soil". Every known biome gets a stable, distinct, nonzero id.
assert.strictEqual(soilIdForBiome('nonexistent_biome'), 0, 'unknown biome → 0 (no soil)');
assert.ok(soilIdForBiome('grassland') > 0, 'grassland has soil');
assert.ok(soilIdForBiome('desert') > 0, 'desert has soil');
assert.notStrictEqual(soilIdForBiome('grassland'), soilIdForBiome('desert'), 'distinct biomes → distinct ids');
// Ids are 1-based, all within 16-bit range.
for (const b of Object.keys(SOIL_IDS)) {
  const id = SOIL_IDS[b];
  assert.ok(id >= 1 && id <= 0xffff, `${b} id in range: ${id}`);
}
console.log('PASS soil-ids');
