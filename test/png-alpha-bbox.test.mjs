import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { alphaBBoxFromBuffer } from '../scripts/lib/png-alpha-bbox.mjs';

// Minimal PNG encoder (RGBA8, filter 0 per scanline) for synthetic fixtures.
function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])), 8 + data.length);
  return out;
}
function makePng(w, h, rgbaAt) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 4); // raw[row] = 0 (filter None)
    for (let x = 0; x < w; x++) rgbaAt(x, y).copy(raw, row + 1 + x * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const CLEAR = Buffer.from([0, 0, 0, 0]), SOLID = Buffer.from([10, 200, 30, 255]);

test('bbox of an opaque rect inside transparent padding', () => {
  // 16x12 image, opaque pixels x in [3,9], y in [2,7]
  const png = makePng(16, 12, (x, y) => (x >= 3 && x <= 9 && y >= 2 && y <= 7) ? SOLID : CLEAR);
  assert.deepEqual(alphaBBoxFromBuffer(png), { x: 3, y: 2, w: 7, h: 6 });
});

test('fully transparent image yields null', () => {
  assert.equal(alphaBBoxFromBuffer(makePng(8, 8, () => CLEAR)), null);
});

test('fully opaque image yields full extent', () => {
  assert.deepEqual(alphaBBoxFromBuffer(makePng(5, 4, () => SOLID)), { x: 0, y: 0, w: 5, h: 4 });
});

test('single opaque pixel', () => {
  const png = makePng(6, 6, (x, y) => (x === 4 && y === 1) ? SOLID : CLEAR);
  assert.deepEqual(alphaBBoxFromBuffer(png), { x: 4, y: 1, w: 1, h: 1 });
});
