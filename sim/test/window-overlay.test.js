// sim/test/window-overlay.test.js — window-as-object overlay builder (closed→shutters transform).
//
// Locks: (1) windowPlacements mirrors the occluder's iv%3 south-wall window rule (same tiles);
// (2) openAmount goes closed(0) far -> open(1) near by proximity; (3) honest absence — the builder
// returns null until the overlay assets resolve (no fake window).
import { test } from 'node:test';
import assert from 'node:assert/strict';

// DOM shims set BEFORE importing the render module.
globalThis.window = globalThis.window || {};
globalThis.OffscreenCanvas = undefined;
globalThis.document = { createElement() {
  const calls = [];
  return { width: 0, height: 0, getContext: () => ({
    setTransform() {}, clearRect() {}, save() {}, restore() {}, translate() {}, scale() {},
    drawImage(...a) { calls.push(a); }, globalAlpha: 1, imageSmoothingEnabled: false, _calls: calls }) };
} };

const { windowPlacements, openAmount, buildWindowOverlayBitmap } = await import('../../src/render/window-overlay.js');

function fp(w) { return { boundingBox: { w, h: 4 }, sections: [{ x0: 0, y0: 0, w, h: 4 }], doors: [] }; }

test('windowPlacements matches the occluder iv%3 window rule (interior band only)', () => {
  const b = { x: 0, y: 0, footprint: fp(12) };
  const set = windowPlacements(b);
  assert.ok(set.size >= 1, 'at least one window placed on a 12-wide wall');
  for (const k of set) {
    const lx = Number(k.split(',')[0]);
    assert.ok(lx >= 2 && lx <= 9, `window ${k} inside the windowable band [2, w-2)`);
  }
});

test('openAmount: closed(0) far -> open(1) near, monotone in between', () => {
  assert.equal(openAmount(99), 0);   // far -> closed
  assert.equal(openAmount(0), 1);    // adjacent -> fully open
  const mid = openAmount(2.0);
  assert.ok(mid > 0 && mid < 1, 'mid distance partly open');
  assert.ok(openAmount(1.5) > openAmount(2.5), 'closer is more open');
});

test('buildWindowOverlayBitmap returns null with no resolvable assets (honest absence)', () => {
  // building with no biome/wallSlug -> winImg resolves nothing -> null (no fake window)
  const b = { x: 0, y: 0, biome: null, wallSlug: null, windowShape: 'arched', footprint: fp(8) };
  const out = buildWindowOverlayBitmap([b], 0, 0, 32, 800, 600, { x: 1, y: 5 });
  assert.equal(out, null);
});
