import assert from 'node:assert';
import { buildChunkIndex } from '../src/render/worker-chunk-renderer.js';
// Flat grassland interior: getWangSrc returns the BIOME_INTERIOR url for grassland; slotResolver maps it → 1.
const chunk = { cx: 0, cy: 0, tiles: Array.from({length: 4}, () => ({ biome: 'grassland' })) };
let seenUrl = null;
const slotResolver = (src) => { seenUrl = src; return 1; };
const buf = buildChunkIndex(chunk, { size: 2, slotResolver, soilResolver: () => 0 });
assert.ok(buf instanceof Uint8Array, 'returns Uint8Array');
assert.strictEqual(buf.length, 2*2*4, 'RGBA per tile');
assert.strictEqual(buf[0], 1, 'baseSlot low byte = 1');
assert.ok(typeof seenUrl === 'string' && seenUrl.includes('__wang_'), 'resolver got a wang URL: ' + seenUrl);
console.log('PASS build-chunk-index');
