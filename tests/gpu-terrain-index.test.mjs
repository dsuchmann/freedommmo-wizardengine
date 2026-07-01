import assert from 'node:assert';
import { encodeTexel, decodeTexel } from '../src/render/gpu-terrain-index.js';

// Widened texel: 16 bits per channel. R=baseSlot, G=cliffSlot, B=soilId, A=gcLumId.
// Slots 0..65535; ids 0..65535 (only ~21 biomes used, but full range round-trips).
const cases = [
  { baseSlot: 0, cliffSlot: 0, soilId: 0, gcLumId: 0 },
  { baseSlot: 65535, cliffSlot: 65535, soilId: 65535, gcLumId: 65535 },
  { baseSlot: 1234, cliffSlot: 77, soilId: 9, gcLumId: 5 },
  { baseSlot: 5000, cliffSlot: 0, soilId: 21, gcLumId: 0 }, // > old 12-bit ceiling (4095)
];
for (const c of cases) {
  const t = encodeTexel(c.baseSlot, c.cliffSlot, c.soilId, c.gcLumId);
  assert.strictEqual(t.length, 4, 'texel is RGBA');
  const d = decodeTexel(t);
  assert.strictEqual(d.baseSlot, c.baseSlot, `base ${JSON.stringify(c)}`);
  assert.strictEqual(d.cliffSlot, c.cliffSlot, `cliff ${JSON.stringify(c)}`);
  assert.strictEqual(d.soilId, c.soilId, `soil ${JSON.stringify(c)}`);
  assert.strictEqual(d.gcLumId, c.gcLumId, `gcLum ${JSON.stringify(c)}`);
}
// Back-compat: omitting gcLumId → A=0.
const t0 = encodeTexel(1, 2, 3);
assert.strictEqual(t0[3], 0, 'gcLumId defaults to 0 when omitted');
console.log('PASS gpu-terrain-index');
