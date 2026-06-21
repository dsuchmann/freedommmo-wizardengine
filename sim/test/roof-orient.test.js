// roof-orient.test.js — PER-FACET texture orientation. Problem B from live feedback:
// "fix the DIRECTION of the tiles based on the direction the roof is FLOWING." Each
// facet must orient its texture courses along its OWN eave (perpendicular to its
// down-slope). On a hip the front/left/right facets flow in DIFFERENT directions, so
// the renderer must derive the v-axis (eave->ridge) and u-axis (along-eave) PER FACET
// from the tile's downhill dir — not a single global grid-y mapping.
//
// slopeFrame(t, quad) returns, for the tile's facet, which quad edge vectors carry the
// down-slope (v, eave->ridge) and the along-eave (u) directions, plus the source-window
// orientation. We verify it picks the grid-Y edge for N/S facets and the grid-X edge
// for E/W facets — i.e. the texture genuinely rotates to follow each facet's slope.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slopeFrame } from '../../tools/roof/roof-renderer.js';

// a unit quad in projection space: TL=(0,0) TR=(10,0) BR=(10,10) BL=(0,10).
// grid-+x edge = TL->TR = (10,0); grid-+y edge = TL->BL = (0,10).
const Q = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

function frameFor(dir) {
  return slopeFrame({ dir, slopeAxis: { dir, run: 1, runMax: 4 }, gx: 3, gy: 4 }, Q);
}

test('N/S facets: v-axis (eave->ridge) follows the grid-Y quad edge', () => {
  for (const dir of ['n', 's']) {
    const f = frameFor(dir);
    // v edge should be vertical (grid-Y): |dy| >> |dx|
    assert.ok(Math.abs(f.vEdge.y) > Math.abs(f.vEdge.x), `${dir} v-axis is vertical`);
    // u edge should be horizontal (along the eave / ridge)
    assert.ok(Math.abs(f.uEdge.x) > Math.abs(f.uEdge.y), `${dir} u-axis is horizontal`);
  }
});

test('E/W facets: v-axis (eave->ridge) ROTATES to follow the grid-X quad edge', () => {
  for (const dir of ['e', 'w']) {
    const f = frameFor(dir);
    // v edge should now be horizontal (grid-X) — the texture flows sideways down the
    // E/W slope, NOT the same vertical orientation as the front facet.
    assert.ok(Math.abs(f.vEdge.x) > Math.abs(f.vEdge.y), `${dir} v-axis rotated to horizontal`);
    assert.ok(Math.abs(f.uEdge.y) > Math.abs(f.uEdge.x), `${dir} u-axis is vertical (along eave)`);
  }
});

test('a west facet and a south facet do NOT share the same v-axis orientation', () => {
  const s = frameFor('s'), w = frameFor('w');
  const sVert = Math.abs(s.vEdge.y) > Math.abs(s.vEdge.x);
  const wVert = Math.abs(w.vEdge.y) > Math.abs(w.vEdge.x);
  assert.notEqual(sVert, wVert, 'south and west facets flow in different directions');
});

test('slopeFrame returns a finite origin + non-degenerate edges for every dir', () => {
  for (const dir of ['n', 's', 'e', 'w']) {
    const f = frameFor(dir);
    assert.ok(Number.isFinite(f.origin.x) && Number.isFinite(f.origin.y), `${dir} origin finite`);
    const uLen = Math.hypot(f.uEdge.x, f.uEdge.y), vLen = Math.hypot(f.vEdge.x, f.vEdge.y);
    assert.ok(uLen > 1e-6 && vLen > 1e-6, `${dir} edges non-degenerate`);
  }
});
