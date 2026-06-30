import assert from 'node:assert';
import { encodeTexel, decodeTexel } from '../src/render/gpu-terrain-index.js';

// A texel packs: baseSlot (0..4095), transitionSlot (0..4095, 0=none), soilId (0..15) into RGBA8.
const cases = [
  { baseSlot: 0, transitionSlot: 0, soilId: 0 },
  { baseSlot: 4095, transitionSlot: 4095, soilId: 15 },
  { baseSlot: 1234, transitionSlot: 77, soilId: 9 },
];
for (const c of cases) {
  const rgba = encodeTexel(c.baseSlot, c.transitionSlot, c.soilId);
  assert.strictEqual(rgba.length, 4, 'texel is RGBA');
  const d = decodeTexel(rgba);
  assert.deepStrictEqual(d, c, `round-trip ${JSON.stringify(c)}`);
}
console.log('PASS gpu-terrain-index');
