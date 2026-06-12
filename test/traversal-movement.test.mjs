import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMovement } from '../src/physics/movement.js';

// Stub chunkStore: all tiles walkable, no legacy objects, forest biome.
const open = { tileAt: () => ({ walkable: true, biome: 'forest', transitionPair: null }), getIfReady: () => null };
const player = (x, y, z = 0) => ({ x, y, z, vz: 0 });

// volumeSource injection: tests provide volumes directly (real source = decoration placements).
const trunk = { x: 5, y: 5, baseRX: 0.4, baseRY: 0.24, rampW: 0.8, rampH: 0.3,
                solidH: Infinity, topZ: null, overheadZ: 2.0, overheadR: 2.5 };
const stump = { x: 5, y: 5, baseRX: 0.4, baseRY: 0.24, rampW: 0, rampH: 0,
                solidH: 0.5, topZ: 0.5, overheadZ: null, overheadR: 0 };
const src = (vols) => () => vols;

test('solid core blocks horizontally and slides', () => {
  const p = player(3.5, 5);
  resolveMovement(p, open, 2.0, 0, src([trunk]));   // try to step through the trunk
  assert.ok(p.x < 5 - 0.4, `clamped before core, got x=${p.x}`);
  const q = player(3.5, 4.9);
  resolveMovement(q, open, 2.0, 0.05, src([trunk]));
  assert.ok(q.y !== 4.9 || q.x < 5, 'slides along, not frozen');
});

test('ramp raises floorZ walking inward; clear ground floor is 0', () => {
  // outer ramp ry = baseRY + rampW*0.6 = 0.72 — start inside it
  const p = player(5, 5.6);                          // south of center, inside ramp annulus
  resolveMovement(p, open, 0, -0.01, src([trunk]));
  assert.ok(p.floorZ > 0 && p.floorZ <= 0.3, `on roots floorZ=${p.floorZ}`);
  const q = player(20, 20);
  resolveMovement(q, open, 0, 0, src([trunk]));
  assert.equal(q.floorZ, 0);
});

test('standable top supports at topZ; below topZ the solid blocks instead', () => {
  const p = player(4.0, 5, 0.6);                     // airborne above stump height
  resolveMovement(p, open, 1.0, 0, src([stump]));    // move over the stump while high
  assert.ok(Math.abs(p.x - 5.0) < 0.01, 'passes over short solid when z > solidH');
  assert.equal(p.floorZ, 0.5, 'floor under player is the stump top');
  const q = player(4.0, 5, 0);                       // grounded: blocked
  resolveMovement(q, open, 1.0, 0, src([stump]));
  assert.ok(q.x < 5 - 0.4, 'grounded player blocked by stump side');
});

test('jump-over: z above finite solidH passes; infinite solidH never passes', () => {
  const p = player(4.0, 5, 1.0);
  resolveMovement(p, open, 1.0, 0, src([stump]));
  assert.ok(p.x > 4.9, 'clears the stump mid-jump');
  const q = player(4.0, 5, 1.0);
  resolveMovement(q, open, 1.0, 0, src([trunk]));
  assert.ok(q.x < 5 - 0.4, 'trunk blocks at any z');
});

test('underCanopy flag set inside overhead footprint below overheadZ', () => {
  const p = player(5, 6.2, 0);                       // on roots, under canopy radius
  resolveMovement(p, open, 0, 0, src([trunk]));
  assert.equal(p.underCanopy, true);
  const q = player(5, 6.2, 0);
  resolveMovement(q, open, 0, 0, src([stump]));
  assert.equal(q.underCanopy, false);
});

test('legacy objects and tile walkability still apply', () => {
  const blockedTile = { tileAt: () => ({ walkable: false }), getIfReady: () => null };
  const p = player(1, 1);
  resolveMovement(p, blockedTile, 1, 0, src([]));
  assert.equal(p.x, 1);
});
