import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRIMITIVES, validateProgram, stableStringify, hashProgram, variantOf, loadProgram,
} from '../life/motion/program.js';

test('primitive table covers exactly the spec §4 ops', () => {
  assert.deepEqual(Object.keys(PRIMITIVES).sort(), [
    'attach', 'balance', 'detach', 'emit', 'ik_reach', 'locomote',
    'look_at', 'parallel', 'pose', 'sequence', 'wait',
  ]);
});

test('validateProgram rejects structural garbage, accepts the library', () => {
  assert.ok(validateProgram({ id: 'x', kind: 'gesture', variant: { time: [1, 1], amplitude: [1, 1] },
    root: { op: 'wait', ticks: 1 } }).length === 0);
  assert.ok(validateProgram({ root: { op: 'nope' } }).length > 0);          // unknown op
  assert.ok(validateProgram({ id: 'x', kind: 'gesture',
    root: { op: 'pose', joints: { spine: 5 } } }).length > 0);              // pose missing ticks
  assert.ok(validateProgram({ id: 'x', kind: 'gesture',
    root: { op: 'sequence' } }).length > 0);                                // sequence missing children
  for (const id of ['wave', 'nervous_glance', 'sit_down', 'dance_improvised']) {
    assert.deepEqual(validateProgram(loadProgram(id)), [], id);
  }
});

test('stableStringify is key-order independent; hash is stable uint32', () => {
  assert.equal(stableStringify({ b: 1, a: { d: 2, c: 3 } }), stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  const h = hashProgram(loadProgram('wave'));
  assert.equal(h, hashProgram(loadProgram('wave')));
  assert.ok(Number.isInteger(h) && h >= 0 && h < 2 ** 32);
  assert.notEqual(h, hashProgram(loadProgram('sit_down')));
});

test('variantOf is deterministic per (seed, entity, program) and stays in bounds', () => {
  const p = loadProgram('wave');
  const a = variantOf(7, 42, p), b = variantOf(7, 42, p), c = variantOf(7, 43, p);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.ok(a.timeScale >= p.variant.time[0] && a.timeScale <= p.variant.time[1]);
  assert.ok(a.amplitudeScale >= p.variant.amplitude[0] && a.amplitudeScale <= p.variant.amplitude[1]);
});
