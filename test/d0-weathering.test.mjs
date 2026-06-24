import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  weatheringCoverage,
  grimeAlpha,
  paintWeatheredColumn,
} from '../src/render/dressing/d0-weathering.js';

test('weatheringCoverage is deterministic and within [0,1]', () => {
  const a = weatheringCoverage(10, 20, { strength: 1, seed: 7 });
  const b = weatheringCoverage(10, 20, { strength: 1, seed: 7 });
  assert.equal(a, b);
  assert.ok(a >= 0 && a <= 1, `coverage ${a} out of range`);
});

test('weatheringCoverage scales with strength; 0 strength → 0', () => {
  assert.equal(weatheringCoverage(3, 4, { strength: 0, seed: 1 }), 0);
  const lo = weatheringCoverage(3, 4, { strength: 0.5, seed: 1 });
  const hi = weatheringCoverage(3, 4, { strength: 1.0, seed: 1 });
  assert.ok(hi >= lo, `hi ${hi} should be >= lo ${lo}`);
});

test('grimeAlpha is bottom-weighted, bounded, and 0 at/above grimeFrac', () => {
  const opts = { grimeFrac: 0.5, grimeMax: 0.6 };
  const bottom = grimeAlpha(0.0, 1, opts);
  const mid = grimeAlpha(0.25, 1, opts);
  assert.ok(bottom >= mid, 'heavier at the bottom');
  assert.equal(grimeAlpha(0.5, 1, opts), 0);
  assert.equal(grimeAlpha(0.8, 1, opts), 0);
  assert.ok(bottom <= 1 && bottom >= 0);
});

function recordingCtx() {
  const calls = [];
  return {
    calls,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000',
    save() {},
    restore() {},
    fillRect(x, y, w, h) {
      calls.push({ x, y, w, h, alpha: this.globalAlpha, op: this.globalCompositeOperation });
    },
  };
}

test('paintWeatheredColumn paints grime heavier near the bottom', () => {
  const ctx = recordingCtx();
  const rect = { dx: 0, top: 0, dw: 32, colH: 128 };
  paintWeatheredColumn(ctx, rect, { wx: 5, wy: 6 }, {
    enabled: true, strength: 1, grimeFrac: 0.5, grimeMax: 0.6, toneMax: 0.18, bands: 6, seed: 2,
  });
  const grime = ctx.calls.filter((c) => c.op === 'multiply');
  assert.ok(grime.length > 0, 'paints grime bands');
  grime.sort((a, b) => b.y - a.y); // largest y (bottom) first
  assert.ok(grime[0].alpha >= grime[grime.length - 1].alpha, 'bottom band darker than top band');
});

test('paintWeatheredColumn is a no-op when disabled', () => {
  const ctx = recordingCtx();
  paintWeatheredColumn(ctx, { dx: 0, top: 0, dw: 32, colH: 128 }, { wx: 5, wy: 6 }, {
    enabled: false, strength: 1, seed: 2,
  });
  assert.equal(ctx.calls.length, 0);
});
