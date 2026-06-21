// sim/test/water-foam-render.test.js — headless integration of the foam pass.
// Drives the REAL drawWaterWaveOverlay through a recording-canvas shim (no DOM),
// proving the three user-facing fixes hold through the whole pipeline:
//   1. foam never blows out to solid white (alpha stays gentle),
//   2. an open coast reads stronger than a 1-tile channel (no narrow-channel white-out),
//   3. the call runs clean in GL-scene mode (the mode the screenshot was taken in).
import { test } from 'node:test';
import assert from 'node:assert/strict';

// --- minimal DOM/canvas shim (set BEFORE importing the overlay's draw path) ---
function recordingCtx() {
  return {
    globalAlpha: 1, globalCompositeOperation: 'source-over', imageSmoothingEnabled: false,
    fillStyle: '#000', filter: 'none',
    _lastFoam: null,
    save() {}, restore() {}, beginPath() {}, arc() {}, fill() {}, fillRect() {},
    translate() {}, rotate() {}, drawImage() {},
    createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData(img) { this._lastFoam = img; },
  };
}
const waveCtx = recordingCtx();
globalThis.window = {};
globalThis.document = {
  createElement() { return { width: 0, height: 0, getContext: () => waveCtx }; },
};

const { drawWaterWaveOverlay } = await import('../../src/render/water-wave-overlay.js');

const CS = 64; // WORLD.chunkSize

function buildScene() {
  const tiles = new Array(CS * CS);
  for (let y = 0; y < CS; y++) {
    for (let x = 0; x < CS; x++) {
      let biome = 'grassland';
      let transitionPair = null;
      if (x < 20) biome = 'shallow_water';                 // open coast: big water body on the left
      else if (x === 20) transitionPair = { a: 'shallow_water', b: 'grassland' }; // sand edge
      if (x === 40 && y >= 10 && y <= 50) biome = 'shallow_water'; // a 1-tile-wide channel
      tiles[y * CS + x] = { biome, transitionPair, shoreAngle: 0, shoreDistance: 50 };
    }
  }
  return { tiles };
}

test('foam pass runs clean in GL mode and stays gentle, dimming narrow channels', () => {
  const chunk = buildScene();
  const chunkStore = { getIfReady: (cx, cy) => (cx === 0 && cy === 0 ? chunk : null) };
  const tilePx = 8;
  const chunkPx = Math.round(CS * tilePx); // 512
  const visibleChunks = [{ cx: 0, cy: 0, key: '0,0', sx: 0, sy: 0, dw: chunkPx, dh: chunkPx }];
  const ctx = recordingCtx();

  // glMode = true (skips the soft-light wave pass), sun = null. Must not throw.
  assert.doesNotThrow(() =>
    drawWaterWaveOverlay(ctx, visibleChunks, chunkStore, tilePx, 512, 512,
      3.0 /* timeSeconds */, null /* wind */, true /* glMode */, null /* sun */));

  const foam = waveCtx._lastFoam;
  assert.ok(foam, 'foam image data was produced');
  // visW = visH = 64 (tMinX/tMinY = 0 for a chunk at screen origin filling the viewport)
  const visW = foam.width;
  const A = (tx, ty) => foam.data[(ty * visW + tx) * 4 + 3];

  // 1. No blow-out anywhere: alpha well under solid white (old peak hit 0.9*255≈230).
  let maxA = 0;
  for (let i = 3; i < foam.data.length; i += 4) maxA = Math.max(maxA, foam.data[i]);
  assert.ok(maxA <= 150, `peak foam alpha ${maxA} should stay gentle (<=150)`);
  assert.ok(maxA > 0, 'some foam should exist');

  // 2. Open coast edge (x=19, water touching the sand at x=20) >> 1-tile channel (x=40).
  const coast = A(19, 30);
  const channel = A(40, 30);
  assert.ok(coast > 0, `coast foam ${coast} should be present`);
  assert.ok(coast > channel + 20,
    `open coast ${coast} should clearly exceed the 1-tile channel ${channel}`);
});
