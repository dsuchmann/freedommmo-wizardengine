import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FluxField } from '../time/flux.js';

test('lone occupant captures its full demand', () => {
  const f = new FluxField({ phi: 4 });
  f.enter(1, 10, 10, 0.5);
  assert.equal(f.captureOf(1), 0.5);
});

test('over-demand rations proportionally, total never exceeds phi', () => {
  const f = new FluxField({ phi: 4 });
  f.enter(1, 5, 5, 3);
  f.enter(2, 5, 5, 3);
  f.enter(3, 5, 5, 2);   // Σdemand = 8 > φ = 4
  const total = f.captureOf(1) + f.captureOf(2) + f.captureOf(3);
  assert.ok(Math.abs(total - 4) < 1e-9);
  assert.ok(Math.abs(f.captureOf(1) - 3 * 4 / 8) < 1e-9);
});

test('leave frees share; occupantsOf reports tile members', () => {
  const f = new FluxField({ phi: 4 });
  f.enter(1, 5, 5, 3);
  f.enter(2, 5, 5, 3);
  f.leave(2);
  assert.equal(f.captureOf(1), 3);
  assert.deepEqual(f.occupantsOf(5, 5), [1]);
});

test('updateDemand re-rations the tile', () => {
  const f = new FluxField({ phi: 4 });
  f.enter(1, 0, 0, 2);
  f.enter(2, 0, 0, 2);
  f.updateDemand(1, 6);   // Σ = 8 → rationed
  assert.ok(Math.abs(f.captureOf(1) - 6 * 4 / 8) < 1e-9);
});
