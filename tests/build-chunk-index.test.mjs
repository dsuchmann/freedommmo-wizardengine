import assert from 'node:assert';
import { buildChunkIndex } from '../src/render/worker-chunk-renderer.js';
// Flat grassland interior: getWangSrc → BIOME_INTERIOR url for grassland; slotResolver → 1234 (> 255,
// proving we now store the FULL 16-bit slot, not just a low byte). soilResolver → 21.
const chunk = { cx: 0, cy: 0, tiles: Array.from({ length: 4 }, () => ({ biome: 'grassland' })) };
let seenUrl = null;
const slotResolver = (src) => { seenUrl = src; return 1234; };
const buf = buildChunkIndex(chunk, { size: 2, slotResolver, soilResolver: () => 21 });
assert.ok(buf instanceof Uint16Array, 'returns Uint16Array');
assert.strictEqual(buf.length, 2 * 2 * 4, 'RGBA per tile');
assert.strictEqual(buf[0], 1234, 'R = full 16-bit base slot');
assert.strictEqual(buf[2], 21, 'B = soil id');
assert.strictEqual(buf[3], 0, 'A reserved = 0');
assert.ok(typeof seenUrl === 'string' && seenUrl.includes('__wang_'), 'resolver got a wang URL: ' + seenUrl);
console.log('PASS build-chunk-index');
