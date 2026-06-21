// roof-uv.test.js — continuity of the slope-space texture UV.
// Two stacked tiles on the same south face: tile A nearer the eave (run 0..1), tile B
// one tile up the slope (run 1..2). The UV's v at A's ridge edge must equal v at B's
// eave edge => courses are continuous across the boundary (no per-tile band restart).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slopeUV } from '../../tools/roof/roof-renderer.js';

const A = { slopeAxis: { dir: 'n', run: 0, runMax: 4 }, distEdge: 1 };
const B = { slopeAxis: { dir: 'n', run: 1, runMax: 4 }, distEdge: 2 };

test('slopeUV v is continuous across a tile boundary', () => {
  const a = slopeUV(A), b = slopeUV(B);
  // A spans v0..v1; B spans v1..v2; A.v1 === B.v0
  assert.ok(Math.abs(a.v1 - b.v0) < 1e-9, `A.v1 ${a.v1} == B.v0 ${b.v0}`);
});

test('slopeUV maps eave run=0 to v0=0 and advances monotonically', () => {
  const a = slopeUV(A);
  assert.equal(a.v0, 0);
  assert.ok(a.v1 > a.v0, 'v advances up the slope');
});

test('slopeUV degrades gracefully when slopeAxis is absent', () => {
  const t = { distEdge: 3 }; // no slopeAxis
  const r = slopeUV(t);
  assert.ok(Number.isFinite(r.v0) && Number.isFinite(r.v1), 'finite UV without slopeAxis');
  assert.ok(['n', 's', 'e', 'w'].includes(r.dir), 'a default dir');
});
