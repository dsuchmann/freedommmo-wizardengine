// sim/test/buildings-footprints.test.js — Phase A Tasks 2 + 3: pattern + footprint tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePattern } from '../world/buildings/patterns.js';

// ── Task 2: pattern generators ────────────────────────────────────────

test('rect: 1 section, correct size', () => {
  const r = generatePattern('rect', 8, 6, 42);
  assert.equal(r.sections.length, 1);
  assert.equal(r.sections[0].w, 8);
  assert.equal(r.sections[0].h, 6);
  assert.equal(r.sections[0].x0, 0);
  assert.equal(r.sections[0].y0, 0);
});

test('L: 2 sections, area < w*h', () => {
  const r = generatePattern('L', 10, 8, 99);
  assert.equal(r.sections.length, 2);
  const area = r.sections.reduce((s, sec) => s + sec.w * sec.h, 0);
  assert.ok(area < 10 * 8, `L area ${area} should be < ${10 * 8}`);
});

test('T: 2 sections', () => {
  const r = generatePattern('T', 10, 8, 77);
  assert.equal(r.sections.length, 2);
});

test('courtyard: 4+ sections', () => {
  const r = generatePattern('courtyard', 12, 10, 55);
  assert.ok(r.sections.length >= 4, `courtyard has ${r.sections.length} sections`);
});

test('winged: 3+ sections', () => {
  const r = generatePattern('winged', 12, 8, 33);
  assert.ok(r.sections.length >= 3, `winged has ${r.sections.length} sections`);
});

test('round: sections exist', () => {
  const r = generatePattern('round', 8, 8, 44);
  assert.ok(r.sections.length >= 1);
});

test('compound: 3+ sections', () => {
  const r = generatePattern('compound', 14, 10, 22);
  assert.ok(r.sections.length >= 3, `compound has ${r.sections.length} sections`);
});

test('deterministic: same seed same result', () => {
  const a = generatePattern('L', 10, 8, 123);
  const b = generatePattern('L', 10, 8, 123);
  assert.deepStrictEqual(a, b);
});

test('deterministic: different seed different result', () => {
  const a = generatePattern('L', 10, 8, 100);
  const b = generatePattern('L', 10, 8, 200);
  // extremely unlikely to match
  const eq = JSON.stringify(a) === JSON.stringify(b);
  assert.ok(!eq, 'different seeds should usually produce different patterns');
});

test('all section dims positive', () => {
  const patterns = ['rect', 'L', 'T', 'courtyard', 'winged', 'round', 'compound'];
  for (const p of patterns) {
    const r = generatePattern(p, 14, 12, 42);
    for (const s of r.sections) {
      assert.ok(s.w > 0, `${p} section w=${s.w}`);
      assert.ok(s.h > 0, `${p} section h=${s.h}`);
    }
  }
});
