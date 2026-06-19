// sim/test/building-shadow.test.js — pure geometry of the building ground-shadow pass.
// The DRAW step needs a canvas, but the projection + hull are pure f(building, sun, cam)
// and fully testable here. Sun fixtures mirror real lighting.js outputs (src/world/lighting.js:
// shadowX is signed/unnormalized, shadowY 0.38..0.85, shadowLength 0.9 noon .. 3.75 dusk).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  convexHull, shadowProjection, buildingFloors, buildingShadowHull, MAX_LENGTH_TILES,
  southFacadeColumns, facadeRect, pointInHull, computeHulls, drapeRects,
} from '../../src/render/building-shadow.js';
import { WALL_CONFIG } from '../../src/render/wall-config.js';
import { buildingNode } from '../world/buildings/blueprint-node.js';

// Real sun shapes at three times of day (see lighting.js:112-138).
const NOON = { shadowX: 0,    shadowY: 0.38, shadowLength: 0.9,  ambient: 1.00, isDaytime: true };
const DAWN = { shadowX: -2.6, shadowY: 0.85, shadowLength: 3.75, ambient: 0.50, isDaytime: true };
const DUSK = { shadowX: 2.6,  shadowY: 0.85, shadowLength: 3.75, ambient: 0.24, isDaytime: true };

function polyArea(h) { // shoelace
  let a = 0;
  for (let i = 0; i < h.length; i++) { const p = h[i], q = h[(i + 1) % h.length]; a += p.x * q.y - q.x * p.y; }
  return Math.abs(a / 2);
}
function fakeB(w, h, floors) {
  return { x: 0, y: 0, footprint: { boundingBox: { w, h }, node: { payload: { aboveGroundFloors: floors } } } };
}
// fake with sections (needed for façade-column + drape geometry)
function fakeBS(x, y, w, h, floors) {
  return {
    x, y,
    footprint: {
      boundingBox: { w, h }, sections: [{ x0: 0, y0: 0, w, h }],
      node: { payload: { aboveGroundFloors: floors } },
    },
  };
}

// ── convex hull ───────────────────────────────────────────────────────
test('convexHull of a square returns its 4 corners (area preserved)', () => {
  const h = convexHull([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]);
  assert.equal(h.length, 4);
  assert.equal(polyArea(h), 100);
});

test('convexHull drops an interior point', () => {
  const h = convexHull([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 5, y: 5 }]);
  assert.equal(h.length, 4);
  assert.equal(polyArea(h), 100);
});

// ── projection direction ──────────────────────────────────────────────
test('shadowProjection points straight down at noon (shadowX≈0)', () => {
  const { projX, projY } = shadowProjection(NOON, 1, 64, 1);
  assert.ok(Math.abs(projX) < 1e-6, 'no horizontal component at noon');
  assert.ok(projY > 0, 'projects downward (south) on screen');
});

test('shadowProjection leans west at dawn, east at dusk (away from the sun)', () => {
  assert.ok(shadowProjection(DAWN, 1, 64, 1).projX < 0, 'dawn sun in the east -> shadow west');
  assert.ok(shadowProjection(DUSK, 1, 64, 1).projX > 0, 'dusk sun in the west -> shadow east');
});

// ── projection length (height + sun elevation) ────────────────────────
test('shadow length grows with floor count', () => {
  assert.ok(shadowProjection(NOON, 3, 64, 1).lengthTiles > shadowProjection(NOON, 1, 64, 1).lengthTiles);
});

test('shadow length grows as the sun lowers (dusk longer than noon)', () => {
  assert.ok(shadowProjection(DUSK, 1, 64, 1).lengthTiles > shadowProjection(NOON, 1, 64, 1).lengthTiles);
});

test('shadow length is clamped for very tall buildings at dusk', () => {
  assert.ok(shadowProjection(DUSK, 12, 64, 1).lengthTiles <= MAX_LENGTH_TILES + 1e-9);
});

test('projection scales with tilePx (screen px) and scale knob', () => {
  assert.ok(shadowProjection(NOON, 1, 128, 1).projY > shadowProjection(NOON, 1, 64, 1).projY);
  assert.ok(shadowProjection(NOON, 1, 64, 2).projY > shadowProjection(NOON, 1, 64, 1).projY);
});

// ── floor extraction ──────────────────────────────────────────────────
test('buildingFloors reads aboveGroundFloors, defaults to 1, caps at 12', () => {
  assert.equal(buildingFloors({ footprint: { node: { payload: { aboveGroundFloors: 5 } } } }), 5);
  assert.equal(buildingFloors({ footprint: { boundingBox: { w: 2, h: 2 } } }), 1); // no node -> 1
  assert.equal(buildingFloors({ footprint: { node: { payload: { aboveGroundFloors: 99 } } } }), 12);
  assert.equal(buildingFloors({}), 1);
  assert.equal(buildingFloors(null), 1);
});

test('buildingFloors works against a real BlueprintNode payload', () => {
  const node = buildingNode(1337, { bx: 0, by: 8, typeId: 'commercial', category: 'commercial', tier: 'town', centrality: 0.85 });
  assert.ok(buildingFloors({ x: 0, y: 0, footprint: { boundingBox: { w: 6, h: 6 }, node } }) >= 1);
});

// ── full hull ─────────────────────────────────────────────────────────
test('hull includes the footprint and extends south at noon', () => {
  const hull = buildingShadowHull(fakeB(4, 3, 1), NOON, 64, 0, 0, 1);
  const minY = Math.min(...hull.map(p => p.y)), maxY = Math.max(...hull.map(p => p.y));
  assert.ok(minY <= 1e-6, 'hull includes the north footprint edge (y=0)');
  assert.ok(maxY > 3 * 64, 'shadow extends south of the footprint bottom (h=3 tiles -> 192px)');
});

test('taller buildings cast a longer shadow', () => {
  const maxY = (b) => Math.max(...buildingShadowHull(b, NOON, 64, 0, 0, 1).map(p => p.y));
  assert.ok(maxY(fakeB(4, 3, 5)) > maxY(fakeB(4, 3, 1)), 'more floors -> shadow reaches further');
});

test('dawn shadow reaches west of the footprint left edge', () => {
  const hull = buildingShadowHull(fakeB(4, 3, 3), DAWN, 64, 0, 0, 1);
  assert.ok(Math.min(...hull.map(p => p.x)) < 0, 'shadow reaches west (x<0) of the left edge');
});

test('hull area exceeds the footprint area (shadow adds cast region)', () => {
  const fpArea = 4 * 64 * 3 * 64;
  assert.ok(polyArea(buildingShadowHull(fakeB(4, 3, 2), DUSK, 64, 0, 0, 1)) > fpArea);
});

// ── phase 2: façade columns + drape ───────────────────────────────────
test('southFacadeColumns: one column per width tile, base just past the section', () => {
  const cols = southFacadeColumns(fakeBS(0, 0, 4, 3, 1));
  assert.equal(cols.length, 4);
  for (let i = 0; i < 4; i++) assert.equal(cols[i].wx, i);
  assert.equal(cols[0].baseWorldY, 3); // y0(0)+h(3) — the row just south of the footprint
});

test('facadeRect matches the worker stack: height = stories*wallHeight*tilePx, bottom = base+yOff', () => {
  const r = facadeRect(3, 0, 2, 64, 0, 0); // baseWorldY=3, wx=0, 2 stories, tilePx=64
  const wHpx = 64 * WALL_CONFIG.wallHeight, yOff = 64 * WALL_CONFIG.wallYOffset;
  assert.equal(r.w, 64);
  assert.equal(r.h, 2 * wHpx);
  assert.equal(r.y + r.h, 3 * 64 + yOff); // bottom edge sits at the footprint south edge + wallYOffset
  assert.equal(r.x, 0);
});

test('facadeRect grows taller with more stories', () => {
  assert.ok(facadeRect(3, 0, 5, 64, 0, 0).h > facadeRect(3, 0, 1, 64, 0, 0).h);
});

test('pointInHull: inside vs outside a square hull', () => {
  const sq = convexHull([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]);
  assert.ok(pointInHull(5, 5, sq));
  assert.ok(!pointInHull(20, 5, sq));
});

test('drape: a tall building over a neighbour in its shadow drenches that neighbour façade', () => {
  // A is tall at the origin; at noon its shadow projects straight down (south).
  const A = fakeBS(0, 0, 4, 3, 6);
  const B = fakeBS(0, 4, 4, 3, 1); // directly south, within A's noon shadow reach
  const buildings = [A, B];
  const hulls = computeHulls(buildings, NOON, 64, 0, 0, 1);
  const rects = drapeRects(buildings, hulls, 64, 0, 0);
  assert.ok(rects.length > 0, 'B columns are drenched by A shadow');
});

test('drape: a far-away neighbour is NOT drenched', () => {
  const A = fakeBS(0, 0, 4, 3, 6);
  const B = fakeBS(40, 0, 4, 3, 1); // far east — A noon shadow points south, never reaches B
  const hulls = computeHulls([A, B], NOON, 64, 0, 0, 1);
  assert.equal(drapeRects([A, B], hulls, 64, 0, 0).length, 0);
});

test('drape: a lone building never drenches itself', () => {
  const A = fakeBS(0, 0, 4, 3, 6);
  const hulls = computeHulls([A], DUSK, 64, 0, 0, 1);
  assert.equal(drapeRects([A], hulls, 64, 0, 0).length, 0);
});
