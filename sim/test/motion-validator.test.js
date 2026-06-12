// sim/test/motion-validator.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRig } from '../../src/life/rig.js';
import { loadProgram } from '../life/motion/program.js';
import { validateChoreography } from '../life/motion/validator.js';

const rig = loadRig('humanoid');
const prog = (kind, root, variant = { time: [1, 1], amplitude: [1, 1] }) =>
  ({ id: 't', kind, variant, root });

test('the authored library validates OK', () => {
  for (const id of ['wave', 'nervous_glance', 'sit_down', 'dance_improvised']) {
    assert.deepEqual(validateChoreography(rig, loadProgram(id)), { verdict: 'OK', path: null }, id);
  }
});

test('joint limit violation is caught — including via amplitude hi-bound', () => {
  const over = prog('gesture', { op: 'pose', joints: { spine: 45 }, ticks: 10 });
  assert.deepEqual(validateChoreography(rig, over), { verdict: 'LIMIT_VIOLATION', path: 'root' });
  // 28 is legal at amplitude 1, but 28×1.2 = 33.6 > 30 max
  const sneaky = prog('gesture', { op: 'pose', joints: { spine: 28 }, ticks: 10 },
    { time: [1, 1], amplitude: [1, 1.2] });
  assert.equal(validateChoreography(rig, sneaky).verdict, 'LIMIT_VIOLATION');
});

test('continuity: too-fast transition violates', () => {
  const fast = prog('gesture', { op: 'pose', joints: { arm_u_r: 150 }, ticks: 2 });  // 75°/tick
  assert.deepEqual(validateChoreography(rig, fast), { verdict: 'LIMIT_VIOLATION', path: 'root' });
});

test('balance: heavy one-sided lean while standing is UNBALANCED; sit kind is exempt', () => {
  // both legs swung one way moves the support interval away from the COM
  const lean = { op: 'pose', joints: { thigh_l: 30, thigh_r: 30, shin_l: 100, shin_r: 100 }, ticks: 8 };
  assert.equal(validateChoreography(rig, prog('gesture', lean)).verdict, 'UNBALANCED');
  assert.equal(validateChoreography(rig, prog('sit', lean)).verdict, 'OK');
});

test('ik_reach: unreachable target is OUT_OF_REACH with path', () => {
  const p = prog('gesture', { op: 'sequence', children: [
    { op: 'wait', ticks: 1 },
    { op: 'ik_reach', effector: 'hand_r', target: { x: 99, y: 99 } },
  ] });
  assert.deepEqual(validateChoreography(rig, p), { verdict: 'OUT_OF_REACH', path: 'root.children[1]' });
});

test('attach: requires world context naming a takeable, in-range entity', () => {
  const p = prog('gesture', { op: 'attach', entity: 5, effector: 'hand_r' });
  assert.equal(validateChoreography(rig, p).verdict, 'WORLD_REJECTED');           // no ctx
  const okCtx = { takeable: id => id === 5, inRange: () => true };
  assert.equal(validateChoreography(rig, p, okCtx).verdict, 'OK');
  const farCtx = { takeable: id => id === 5, inRange: () => false };
  assert.equal(validateChoreography(rig, p, farCtx).verdict, 'WORLD_REJECTED');
});
