// sim/test/hydrology.test.js — P2.5: deterministic flow-routed streams. Sources at
// high-elevation/high-moisture jittered-grid points; steepest-descent traces that
// END at open water or max length; channels widen downstream; everything pure
// f(seed, coords) — memoization must not change results vs a cold module.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  streamAt, sourceFor, traceStream, clearHydrologyCache,
  SOURCE_CELL, SOURCE_MIN_ELEV, SOURCE_MIN_MOIST, MAX_STREAM_LEN, MAX_WIDTH,
} from '../../src/world/hydrology.js';
import { sampleClimate } from '../../src/world/biomes.js';

// A wide inland scan rect, east of the coast (grassland x930+). Streams are
// DISCOVERED, not assumed: the scan must find at least one channel tile in a
// region this large IF any source qualifies upstream. If zero streams exist in
// this rect, widen the rect empirically (document the change) — a worldgen with
// no streams anywhere within 1500×600 inland tiles would mean thresholds are
// mis-tuned, which is a real finding to fix in SOURCE_* constants, not in the test.
const SCAN = { x0: 930, y0: -300, w: 1500, h: 600 };

function findStreamTiles(limit = 50) {
  const hits = [];
  for (let y = SCAN.y0; y < SCAN.y0 + SCAN.h; y += 3) {
    for (let x = SCAN.x0; x < SCAN.x0 + SCAN.w; x += 3) {
      const s = streamAt(x, y);
      if (s) { hits.push({ x, y, ...s }); if (hits.length >= limit) return hits; }
    }
  }
  return hits;
}

test('P2.5 sources: jittered-grid candidates qualify only on high elevation + moisture, deterministic', () => {
  let qualified = 0;
  for (let cy = -8; cy < 8; cy++) for (let cx = 9; cx < 30; cx++) {
    const s = sourceFor(cx, cy);
    const s2 = sourceFor(cx, cy);
    assert.deepEqual(s, s2, 'deterministic per cell');
    if (!s) continue;
    qualified++;
    const c = sampleClimate(s.x, s.y);
    assert.ok(c.elevation >= SOURCE_MIN_ELEV, `source (${s.x},${s.y}) elevation qualifies`);
    assert.ok(c.moisture >= SOURCE_MIN_MOIST, `source (${s.x},${s.y}) moisture qualifies`);
    // candidate point lies inside its cell
    assert.ok(s.x >= cx * SOURCE_CELL && s.x < (cx + 1) * SOURCE_CELL);
    assert.ok(s.y >= cy * SOURCE_CELL && s.y < (cy + 1) * SOURCE_CELL);
  }
  assert.ok(qualified >= 1, `at least one qualified source in a 21x16-cell highland scan (got ${qualified})`);
});

test('P2.5 trace: monotone non-increasing elevation (with carve tolerance), ends at water or MAX, widens downstream', () => {
  // find a qualified source
  let src = null;
  outer: for (let cy = -8; cy < 8; cy++) for (let cx = 9; cx < 30; cx++) {
    src = sourceFor(cx, cy); if (src) break outer;
  }
  assert.ok(src, 'a source exists');
  const path = traceStream(src);
  assert.ok(path.length >= 2, 'trace has length');
  assert.ok(path.length <= MAX_STREAM_LEN, 'trace bounded');
  for (let i = 1; i < path.length; i++) {
    // steepest descent with carve tolerance: elevation may rise at most CARVE_EPS per step
    assert.ok(sampleClimate(path[i].x, path[i].y).elevation
      <= sampleClimate(path[i - 1].x, path[i - 1].y).elevation + 0.02 + 1e-9,
      `step ${i} does not climb`);
    // 8-connected steps
    assert.ok(Math.abs(path[i].x - path[i - 1].x) <= 1 && Math.abs(path[i].y - path[i - 1].y) <= 1);
    // width non-decreasing downstream, capped
    assert.ok(path[i].width >= path[i - 1].width && path[i].width <= MAX_WIDTH);
  }
  const last = path[path.length - 1];
  const endsAtWater = sampleClimate(last.x, last.y).elevation < 0.40;
  assert.ok(endsAtWater || path.length === MAX_STREAM_LEN,
    'trace ends at open water or at the length bound (an endorheic dead-end is a real finding — flag it)');
});

test('P2.5 streamAt: channel tiles report width/distance evidence; determinism across cache clear', () => {
  const hits = findStreamTiles(20);
  assert.ok(hits.length >= 1, 'streams discovered in the inland scan rect');
  for (const h of hits) {
    assert.ok(h.width >= 1 && h.width <= MAX_WIDTH, 'width in 1..MAX_WIDTH');
    assert.ok(Number.isInteger(h.dist) && h.dist >= 0, 'distance evidence');
  }
  // memoization must be invisible: clear all caches, re-query, identical
  const before = hits.map(h => ({ x: h.x, y: h.y, width: h.width, dist: h.dist }));
  clearHydrologyCache();
  const after = before.map(h => ({ x: h.x, y: h.y, ...streamAt(h.x, h.y) }));
  assert.deepEqual(after, before, 'cold cache reproduces identical channels');
});

test('P2.5 streamAt: open-water and far-from-channel tiles are null', () => {
  assert.equal(streamAt(0, 0), null, 'ocean is not a stream channel');
  // a known pure-grass tile far from any channel found above — verify against scan
  const hits = findStreamTiles(50);
  const hitSet = new Set(hits.map(h => `${h.x},${h.y}`));
  let probe = null;
  for (let y = 6; y < 14 && !probe; y++) for (let x = 938; x < 954 && !probe; x++) {
    if (!hitSet.has(`${x},${y}`) && streamAt(x, y) === null) probe = { x, y };
  }
  assert.ok(probe, 'at least one inland tile is channel-free');
});
