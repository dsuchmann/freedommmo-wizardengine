import assert from 'node:assert';
import { gcLumIdForBiome, GC_LUM_IDS, GC_LUM, gcLumSwatchURL } from '../src/render/wang-image-list.js';

// grassland (and other all-sprite-gc biomes) have NO gc-luminance → id 0.
assert.strictEqual(gcLumIdForBiome('grassland'), 0, 'grassland has no gc-luminance');
assert.strictEqual(gcLumIdForBiome('forest'), 0, 'forest has no gc-luminance');
assert.strictEqual(gcLumIdForBiome('nonexistent'), 0, 'unknown biome → 0');
// The 11 luminance biomes get stable, distinct, nonzero ids.
assert.ok(gcLumIdForBiome('beach') > 0, 'beach has gc-luminance');
assert.ok(gcLumIdForBiome('ocean') > 0, 'ocean has gc-luminance');
assert.notStrictEqual(gcLumIdForBiome('beach'), gcLumIdForBiome('ocean'), 'distinct ids');
assert.strictEqual(Object.keys(GC_LUM).length, 11, '11 gc-luminance biomes');
for (const b of Object.keys(GC_LUM_IDS)) {
  assert.ok(GC_LUM_IDS[b] >= 1 && GC_LUM_IDS[b] <= 0xffff, `${b} id in range`);
}
// Swatch URL is the biome's gc object v000, or null for non-luminance biomes.
assert.ok(gcLumSwatchURL('beach').includes('wet_sand'), 'beach swatch url');
assert.strictEqual(gcLumSwatchURL('grassland'), null, 'no swatch for grassland');
console.log('PASS gc-lum-ids');
