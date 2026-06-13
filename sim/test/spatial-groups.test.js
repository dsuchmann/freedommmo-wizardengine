import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBones, expandCompound, isCompound, BODY_GROUPS } from '../../src/life/eval/spatial-groups.js';
import { readFileSync } from 'node:fs';

const rig = JSON.parse(readFileSync('src/life/rigs/humanoid.json', 'utf8'));

test('resolveBones returns correct bones for individual groups', () => {
  assert.deepStrictEqual(resolveBones('left_arm'), ['arm_u_l', 'arm_f_l', 'hand_l']);
  assert.deepStrictEqual(resolveBones('torso'), ['spine']);
  assert.deepStrictEqual(resolveBones('head'), ['head']);
});

test('resolveBones expands compound groups', () => {
  const both = resolveBones('both_arms');
  assert.ok(both.includes('arm_u_l'));
  assert.ok(both.includes('arm_u_r'));
  assert.ok(both.includes('hand_l'));
  assert.ok(both.includes('hand_r'));
  assert.strictEqual(both.length, 6);
});

test('resolveBones throws on unknown group', () => {
  assert.throws(() => resolveBones('nonexistent'), /unknown/i);
});

test('all bones in all groups exist in the rig', () => {
  for (const [name, bones] of Object.entries(BODY_GROUPS)) {
    for (const b of bones) {
      assert.ok(rig.bones[b], `${name}: bone ${b} not in rig`);
    }
  }
});

test('expandCompound returns individual groups for compounds', () => {
  assert.deepStrictEqual(expandCompound('both_arms'), ['left_arm', 'right_arm']);
  assert.deepStrictEqual(expandCompound('left_arm'), ['left_arm']);
});

test('isCompound identifies compound groups', () => {
  assert.strictEqual(isCompound('both_arms'), true);
  assert.strictEqual(isCompound('left_arm'), false);
  assert.strictEqual(isCompound('full_body'), true);
});
