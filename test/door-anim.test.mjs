// Door proximity-animation, after the building-sprite-cache regression fix: the live swing frame is baked INTO
// the building sprite (so it inherits the wall's weathering/scale/depth) and the cache re-bakes whenever the
// frame index changes. These cover the PURE pieces that decide WHICH frame (doorFrameIndex) and WHERE the
// aperture lands (aperturePlacement); the bake re-trigger is covered in building-sprite-cache.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aperturePlacement, doorFrameIndex } from '../src/render/building-tiles.js';

// --- aperturePlacement: the single clamp shared by the baked door + the live overlay (must agree exactly) ---
test('aperturePlacement: centered door in a wide run → no shift, symmetric clip', () => {
  const r = aperturePlacement(100, 80, 0, 400);
  assert.deepEqual([r.cx, r.cl, r.cr], [100, 60, 140]);
});
test('aperturePlacement: door near the WEST end → shifts inward so the full span fits', () => {
  const r = aperturePlacement(10, 80, 0, 400);   // cx-half = -30 < 0 → cx = left+half = 40
  assert.deepEqual([r.cx, r.cl, r.cr], [40, 0, 80]);
});
test('aperturePlacement: door near the EAST end → shifts inward', () => {
  const r = aperturePlacement(390, 80, 0, 400);  // cx+half = 430 > 400 → cx = right-half = 360
  assert.deepEqual([r.cx, r.cl, r.cr], [360, 320, 400]);
});
test('aperturePlacement: run too narrow for the span → clip to the run (no shift)', () => {
  const r = aperturePlacement(50, 80, 30, 90);   // run width 60 < clipW 80 → clamp only
  assert.deepEqual([r.cl, r.cr], [30, 90]);
});

// --- doorFrameIndex: 0..8 from player proximity, forced to 0 (closed) during the static cache bake ---
const B = { x: 100, y: 100 };
const D = { x: 1, y: 0 };                          // door centre at world (101.5, 100.5)

test('doorFrameIndex: closed (0) when the player position is unknown', () => {
  globalThis.window = undefined;
  assert.equal(doorFrameIndex(B, D), 0);
});
test('doorFrameIndex: far → closed, at-door → fully open, mid → ramps', () => {
  globalThis.window = { _player: { x: 101.5, y: 110 } };    // ~9.5 tiles (> R_OPEN 4) → closed
  assert.equal(doorFrameIndex(B, D), 0);
  globalThis.window = { _player: { x: 101.5, y: 100.5 } };  // on the door → full open → ANIM_FRAMES-1
  assert.equal(doorFrameIndex(B, D), 8);
  globalThis.window = { _player: { x: 101.5, y: 103.25 } }; // dist 2.75 → (4-2.75)/2.5 = 0.5 → round(0.5*8) = 4
  assert.equal(doorFrameIndex(B, D), 4);
  globalThis.window = undefined;
});
