import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveShape, realizeFootprintFromShape, boundsForSizeTier, SIZE_TIERS,
} from '../world/buildings/shapes.js';
import { generatePattern } from '../world/buildings/patterns.js';

const key = (x, y) => `${x},${y}`;

function tilesOf(sections) {
  const set = new Set();
  for (const s of sections)
    for (let y = s.y0; y < s.y0 + s.h; y++)
      for (let x = s.x0; x < s.x0 + s.w; x++) set.add(key(x, y));
  return set;
}

function isConnected(sections) {
  const set = tilesOf(sections);
  if (set.size === 0) return false;
  const start = set.values().next().value;
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const [x, y] = stack.pop().split(',').map(Number);
    for (const k of [key(x + 1, y), key(x - 1, y), key(x, y + 1), key(x, y - 1)]) {
      if (set.has(k) && !seen.has(k)) { seen.add(k); stack.push(k); }
    }
  }
  return seen.size === set.size;
}

test('size tiers are monotone non-decreasing in w/h', () => {
  for (let i = 1; i < SIZE_TIERS.length; i++) {
    const a = boundsForSizeTier(SIZE_TIERS[i - 1]);
    const b = boundsForSizeTier(SIZE_TIERS[i]);
    assert.ok(b.minW >= a.minW && b.maxW >= a.maxW, `${SIZE_TIERS[i]} W not >= ${SIZE_TIERS[i - 1]}`);
    assert.ok(b.minH >= a.minH && b.maxH >= a.maxH, `${SIZE_TIERS[i]} H not >= ${SIZE_TIERS[i - 1]}`);
    assert.ok(b.minW > a.maxW * 0 + a.minW, 'midpoint grows');
  }
});

test('resolveShape is deterministic', () => {
  for (const t of ['house', 'shop', 'manor']) {
    assert.deepEqual(resolveShape(123, t, 'city', 0.8), resolveShape(123, t, 'city', 0.8));
  }
});

test('seed produces archetype variety (not one shape for all)', () => {
  const seen = new Set();
  for (let s = 0; s < 80; s++) seen.add(resolveShape(s, 'manor', 'city', 0.7).archetype);
  assert.ok(seen.size >= 4, `expected variety, saw only ${[...seen].join(',')}`);
});

test('high centrality + capital unlocks the sprawling compounds at least sometimes', () => {
  const seen = new Set();
  for (let s = 0; s < 200; s++) seen.add(resolveShape(s, { maxW: 26 }, 'world_capital', 1).archetype);
  const compounds = ['twinWing', 'doubleCourt', 'campus', 'longArcade'];
  assert.ok(compounds.some(c => seen.has(c)), `no compound shapes appeared: ${[...seen].join(',')}`);
});

test('primitive realization is byte-identical to patterns.generatePattern', () => {
  for (let s = 0; s < 120; s++) {
    const shape = resolveShape(s, 'house', 'town', 0.5);
    if (shape.kind !== 'primitive') continue;
    const realized = realizeFootprintFromShape(shape, s + 7);
    const direct = generatePattern(shape.pattern, shape.w, shape.h, s + 7);
    assert.deepEqual(realized.sections, direct.sections, `archetype ${shape.archetype}`);
  }
});

test('every realized footprint (primitive AND compound) is one connected section-union', () => {
  for (let s = 0; s < 150; s++) {
    const shape = resolveShape(s, { maxW: 28 }, 'world_capital', 1);
    const { sections } = realizeFootprintFromShape(shape, s * 3 + 1);
    assert.ok(sections.length > 0, `${shape.archetype}/${s}: no sections`);
    assert.ok(isConnected(sections), `${shape.archetype}/${s}: disconnected footprint`);
  }
});

test('compound generators are deterministic and stay within their bounding box', () => {
  for (const arch of ['twinWing', 'doubleCourt', 'campus', 'longArcade']) {
    const shape = { archetype: arch, kind: 'compound', pattern: null, sizeTier: 'large', w: 26, h: 20 };
    const a = realizeFootprintFromShape(shape, 55);
    const b = realizeFootprintFromShape(shape, 55);
    assert.deepEqual(a, b, `${arch} not deterministic`);
    for (const sec of a.sections) {
      assert.ok(sec.x0 >= 0 && sec.y0 >= 0 && sec.x0 + sec.w <= shape.w && sec.y0 + sec.h <= shape.h,
        `${arch}: section ${JSON.stringify(sec)} outside ${shape.w}x${shape.h}`);
    }
  }
});
