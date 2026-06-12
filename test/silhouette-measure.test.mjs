import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureSilhouette } from '../scripts/lib/silhouette-measure.mjs';

// Build { w, h, alpha } from ASCII art rows ('#' = opaque).
function mask(rows) {
  const h = rows.length, w = rows[0].length;
  const alpha = new Uint8Array(w * h);
  rows.forEach((r, y) => { for (let x = 0; x < w; x++) alpha[y * w + x] = r[x] === '#' ? 255 : 0; });
  return { w, h, alpha };
}

test('T-shaped tree: wide canopy, narrow trunk, flared base', () => {
  // 16 wide x 32 tall: canopy rows 0-11 width 16, trunk rows 12-27 width 4 centered, base rows 28-31 width 8
  const rows = [];
  for (let y = 0; y < 12; y++) rows.push('#'.repeat(16));
  for (let y = 12; y < 28; y++) rows.push('      ####      ');
  for (let y = 28; y < 32; y++) rows.push('    ########    ');
  const sil = measureSilhouette(mask(rows), [0, 0, 16, 32]);
  assert.equal(sil.visH, 32);
  assert.equal(sil.baseW, 8);           // bottom 15% of 32 = rows 28-31 -> width 8
  assert.equal(sil.coreW, 4);           // narrowest row in the 20%-60%-from-bottom band
  assert.equal(sil.coreX, 8);           // trunk centered (center of minimal row, rounded)
  assert.equal(sil.bands.length, 16);
  assert.equal(sil.bands[0], 16);       // top band = canopy
  assert.equal(sil.bands[15], 8);       // bottom band = base flare
});

test('dome boulder: monotonically widening downward', () => {
  const rows = [];
  for (let y = 0; y < 16; y++) {
    const w = 2 + Math.floor(y * 14 / 15); // 2 -> 16
    const pad = Math.floor((16 - w) / 2);
    rows.push(' '.repeat(pad) + '#'.repeat(w) + ' '.repeat(16 - pad - w));
  }
  const sil = measureSilhouette(mask(rows), [0, 0, 16, 16]);
  assert.equal(sil.visH, 16);
  assert.equal(sil.baseW, 16);
  assert.ok(sil.coreW >= 7 && sil.coreW <= 12); // mid-band of the dome
});

test('trim offset: measures inside the trim window only', () => {
  // 8x8 opaque square at (4,4) inside a 16x16 image
  const rows = [];
  for (let y = 0; y < 16; y++) {
    rows.push(y >= 4 && y < 12 ? '    ########    ' : ' '.repeat(16));
  }
  const sil = measureSilhouette(mask(rows), [4, 4, 8, 8]);
  assert.equal(sil.visH, 8);
  assert.equal(sil.baseW, 8);
  assert.equal(sil.bands[0], 8);
});

test('empty trim returns null', () => {
  assert.equal(measureSilhouette(mask([' '.repeat(4), ' '.repeat(4)]), null), null);
});
