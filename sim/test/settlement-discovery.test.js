import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  discoverSettlementsInMacroRange, suppressBySpacing, siteForMacro, MACRO_TILES,
} from '../world/buildings/settlement-discovery.js';

const SEED = 42;
// A macro range around the populated spawn area (player spawns inside a settlement
// near tile ~1329,742 = macro ~20,11).
const RANGE = [15, 6, 25, 16];

test('discoverSettlementsInMacroRange finds settlements and is deterministic', () => {
  const a = discoverSettlementsInMacroRange(SEED, ...RANGE);
  const b = discoverSettlementsInMacroRange(SEED, ...RANGE);
  assert.ok(a.length > 0, 'expected at least one settlement in the populated range');
  assert.deepEqual(a, b, 'discovery must be deterministic');
  for (const s of a) {
    for (const k of ['mx', 'my', 'x', 'y', 'tier', 'race', 'name']) {
      assert.ok(s[k] !== undefined, `settlement missing field ${k}`);
    }
  }
});

test('seed is actually threaded (different seed => different result)', () => {
  const a = discoverSettlementsInMacroRange(42, ...RANGE);
  const c = discoverSettlementsInMacroRange(7, ...RANGE);
  assert.notDeepEqual(a, c, 'seed 7 must not equal seed 42');
});

test('siteForMacro matches the canonical offset formula', () => {
  for (const [mx, my] of [[0, 0], [20, 11], [-3, 5], [7, -2]]) {
    const cx = mx * MACRO_TILES + Math.floor(MACRO_TILES / 2);
    const cy = my * MACRO_TILES + Math.floor(MACRO_TILES / 2);
    const s = siteForMacro(SEED, mx, my);
    assert.equal(s.cx, cx);
    assert.equal(s.cy, cy);
    // x,y are cx/cy plus a seeded offset within +-MACRO_TILES*0.25
    assert.ok(Math.abs(s.x - cx) <= MACRO_TILES * 0.25 + 1);
    assert.ok(Math.abs(s.y - cy) <= MACRO_TILES * 0.25 + 1);
  }
});

test('suppressBySpacing reduces overlap, keeps the largest, does not mutate', () => {
  const raw = discoverSettlementsInMacroRange(SEED, ...RANGE);
  const before = JSON.parse(JSON.stringify(raw));
  const kept = suppressBySpacing(raw);
  assert.deepEqual(raw, before, 'input must not be mutated');
  assert.ok(kept.length <= raw.length, 'suppression cannot add settlements');
  // No two kept settlements are closer than the smaller-spacing*0.7 floor (30*0.7=21).
  for (let i = 0; i < kept.length; i++) {
    for (let j = i + 1; j < kept.length; j++) {
      const d = Math.abs(kept[i].x - kept[j].x) + Math.abs(kept[i].y - kept[j].y);
      assert.ok(d >= 21, `kept settlements too close: ${d}`);
    }
  }
  assert.deepEqual(suppressBySpacing(raw), kept, 'suppression must be deterministic');
});
