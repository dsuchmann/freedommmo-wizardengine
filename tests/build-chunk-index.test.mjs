import assert from 'node:assert';
import { buildChunkIndex } from '../src/render/worker-chunk-renderer.js';
// Fake 2x2 chunk of one biome; slotResolver returns a deterministic integer per (asset,level,mask).
const chunk = { cx: 0, cy: 0, tiles: Array.from({length: 4}, () => ({ biome: 'grassland', elevation: 0 })) };
const slotResolver = (asset, level, mask) => 1; // every base tile → slot 1
const buf = buildChunkIndex(chunk, { size: 2, slotResolver, soilResolver: () => 0 });
assert.ok(buf instanceof Uint8Array, 'returns Uint8Array');
assert.strictEqual(buf.length, 2 * 2 * 4, 'RGBA per tile');
assert.strictEqual(buf[0], 1, 'baseSlot low byte = 1');
console.log('PASS build-chunk-index');
