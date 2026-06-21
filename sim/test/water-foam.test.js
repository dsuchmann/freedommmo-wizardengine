// sim/test/water-foam.test.js — pure shaping math for the shoreline foam pass.
// The DRAW step needs a canvas, but the foam profile + open-water detection are
// pure f(distance-to-land, neighbourhood) and fully testable here. These guard the
// three properties the user asked for: band hugs the waterline (not 1 tile inboard),
// overall strength is gentle, and narrow channels don't blow out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  foamProfile, buildWaterSAT, waterFracAt, channelOpenScale, FOAM_DEFAULTS,
} from '../../src/render/water-wave-overlay.js';

// ── foamProfile: distance-to-land → base intensity ───────────────────────
test('foamProfile: pure land (dtl 0, not transition) casts no foam', () => {
  assert.equal(foamProfile(0, false, FOAM_DEFAULTS.width), 0);
});

test('foamProfile: the transition (sand/water) tile carries surf, but modest', () => {
  const t = foamProfile(0, true, FOAM_DEFAULTS.width);
  assert.ok(t > 0.2 && t < 0.5, `transition foam ${t} should be a modest wash, not a blowout`);
});

test('foamProfile: peak is at the first water tile (the break), not deep water', () => {
  const peak = foamProfile(1, false, FOAM_DEFAULTS.width);
  assert.ok(peak > foamProfile(2, false, FOAM_DEFAULTS.width));
  assert.ok(peak > foamProfile(3, false, FOAM_DEFAULTS.width));
  // and the peak itself is gentle — never the old 0.9 white-out
  assert.ok(peak <= 0.7, `peak ${peak} should stay well below a full white-out`);
});

test('foamProfile: monotonic falloff into open water', () => {
  const w = FOAM_DEFAULTS.width;
  let prev = foamProfile(1, false, w);
  for (let dtl = 2; dtl <= 6; dtl++) {
    const v = foamProfile(dtl, false, w);
    assert.ok(v <= prev + 1e-9, `dtl ${dtl}: ${v} should not exceed ${prev}`);
    prev = v;
  }
});

test('foamProfile: foam vanishes beyond the band width', () => {
  const w = 2.5;
  assert.equal(foamProfile(1 + w, false, w), 0);
  assert.equal(foamProfile(10, false, w), 0);
});

test('foamProfile: wider width spreads the band further out', () => {
  const narrow = foamProfile(3, false, 1.5);
  const wide = foamProfile(3, false, 4.0);
  assert.ok(wide > narrow, `wide ${wide} should reach further than narrow ${narrow} at dtl 3`);
});

// ── water summed-area table + neighbourhood fraction ─────────────────────
function gridSAT(rows) {
  // rows: array of strings, 'W' = water, '.' = land. Returns {sat, cs, isW}.
  const cs = rows.length;
  const flat = rows.join('').split('');
  const isW = (i) => (flat[i] === 'W' ? 1 : 0);
  return { sat: buildWaterSAT(isW, cs), cs };
}

test('waterFracAt: all-water window reads 1.0', () => {
  const { sat, cs } = gridSAT(['WWWWW', 'WWWWW', 'WWWWW', 'WWWWW', 'WWWWW']);
  assert.equal(waterFracAt(sat, cs, 2, 2, 2), 1);
});

test('waterFracAt: all-land window reads 0', () => {
  const { sat, cs } = gridSAT(['.....', '.....', '.....', '.....', '.....']);
  assert.equal(waterFracAt(sat, cs, 2, 2, 2), 0);
});

test('waterFracAt: a 1-wide vertical channel reads low (narrow water)', () => {
  // single column of water through the middle
  const { sat, cs } = gridSAT(['..W..', '..W..', '..W..', '..W..', '..W..']);
  const frac = waterFracAt(sat, cs, 2, 2, 2); // 5 of 25 cells water
  assert.ok(Math.abs(frac - 5 / 25) < 1e-6, `channel frac ${frac} ≈ 0.2`);
});

test('waterFracAt: a broad coast (half water) reads ~0.5', () => {
  const { sat, cs } = gridSAT(['WWWWW', 'WWWWW', 'WWWWW', '.....', '.....']);
  // window centred on the waterline row (y=2): rows 0..4 → 3 water rows of 5 = 0.6
  const frac = waterFracAt(sat, cs, 2, 2, 2);
  assert.ok(frac >= 0.5 && frac <= 0.65, `coast frac ${frac} should be ~0.6`);
});

test('waterFracAt: window clamps at grid edges (no out-of-bounds)', () => {
  const { sat, cs } = gridSAT(['WWWWW', 'WWWWW', 'WWWWW', 'WWWWW', 'WWWWW']);
  assert.equal(waterFracAt(sat, cs, 0, 0, 2), 1); // corner, clamped 3x3 all water
});

// ── channelOpenScale: narrow channels dim toward the floor ───────────────
test('channelOpenScale: a thin channel (low fraction) dims to the floor', () => {
  const s = channelOpenScale(0.20, FOAM_DEFAULTS.openMin);
  assert.ok(Math.abs(s - FOAM_DEFAULTS.openMin) < 1e-6, `${s} should clamp to openMin`);
});

test('channelOpenScale: an open coast (high fraction) keeps full strength', () => {
  assert.ok(channelOpenScale(0.6, FOAM_DEFAULTS.openMin) > 0.95);
});

test('channelOpenScale: monotonic in fraction, bounded [openMin, 1]', () => {
  let prev = -1;
  for (let f = 0; f <= 1.0001; f += 0.1) {
    const s = channelOpenScale(f, FOAM_DEFAULTS.openMin);
    assert.ok(s >= FOAM_DEFAULTS.openMin - 1e-9 && s <= 1 + 1e-9, `scale ${s} in range`);
    assert.ok(s >= prev - 1e-9, `non-decreasing at frac ${f}`);
    prev = s;
  }
});

test('channelOpenScale: openMin=0 lets a fully-enclosed channel drop foam entirely', () => {
  assert.equal(channelOpenScale(0.1, 0), 0);
});
