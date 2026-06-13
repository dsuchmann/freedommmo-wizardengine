import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileInstruction, compileSpatialProgram } from '../../src/life/eval/spatial-compiler.js';
import { readFileSync } from 'node:fs';

const rig = JSON.parse(readFileSync('src/life/rigs/humanoid.json', 'utf8'));

test('raise left_arm 1.0 → arm_u_l: -170', () => {
  const { joints } = compileInstruction({ part: 'left_arm', action: 'raise', amount: 1.0 }, rig);
  assert.strictEqual(joints.arm_u_l, -170);
});

test('raise right_arm 0.5 → arm_u_r: 85', () => {
  const { joints } = compileInstruction({ part: 'right_arm', action: 'raise', amount: 0.5 }, rig);
  assert.strictEqual(joints.arm_u_r, 85);
});

test('bend left_leg 1.0 → shin_l: 140', () => {
  const { joints } = compileInstruction({ part: 'left_leg', action: 'bend', amount: 1.0 }, rig);
  assert.strictEqual(joints.shin_l, 140);
});

test('extend right_arm 0.6 → arm_u_r: 54, arm_f_r: 0', () => {
  const { joints } = compileInstruction({ part: 'right_arm', action: 'extend', amount: 0.6 }, rig);
  assert.strictEqual(joints.arm_u_r, 54);
  assert.strictEqual(joints.arm_f_r, 0);
});

test('zHint passes through', () => {
  const { zHints } = compileInstruction({ part: 'left_arm', action: 'raise', amount: 0.5, zHint: 'front' }, rig);
  assert.strictEqual(zHints.left_arm, 'front');
});

test('compound group both_arms expands', () => {
  const { joints } = compileInstruction({ part: 'both_arms', action: 'raise', amount: 1.0 }, rig);
  assert.strictEqual(joints.arm_u_l, -170);
  assert.strictEqual(joints.arm_u_r, 170);
});

test('torso lower → spine: -30 at amount 1.0', () => {
  const { joints } = compileInstruction({ part: 'torso', action: 'lower', amount: 1.0 }, rig);
  assert.strictEqual(joints.spine, -30);
});

test('head raise → head: 60 at amount 1.0', () => {
  const { joints } = compileInstruction({ part: 'head', action: 'raise', amount: 1.0 }, rig);
  assert.strictEqual(joints.head, 60);
});

test('compileSpatialProgram produces valid DSL', () => {
  const choreo = {
    id: 'test_wave', kind: 'gesture',
    steps: [
      { part: 'right_arm', action: 'raise', amount: 0.8, ticks: 4 },
      { part: 'right_arm', action: 'lower', amount: 1.0, ticks: 4 },
    ],
  };
  const program = compileSpatialProgram(choreo, rig);
  assert.strictEqual(program.id, 'test_wave');
  assert.strictEqual(program.root.op, 'sequence');
  assert.strictEqual(program.root.children.length, 2);
  assert.strictEqual(program.root.children[0].op, 'pose');
  assert.ok(program.root.children[0].joints.arm_u_r > 100);
});

test('extend south-facing produces minimal rotation + auto zHint front', () => {
  const { joints, zHints } = compileInstruction(
    { part: 'right_arm', action: 'extend', amount: 1.0 }, rig, {}, 's'
  );
  // South: depthFactor=0.15, so 90*0.15=13.5 → rounds to 14
  assert.ok(joints.arm_u_r <= 20, `south extend should be small, got ${joints.arm_u_r}`);
  assert.strictEqual(zHints.right_arm, 'front', 'auto Z hint should be front');
});

test('extend east-facing produces full rotation, no auto zHint', () => {
  const { joints, zHints } = compileInstruction(
    { part: 'right_arm', action: 'extend', amount: 1.0 }, rig, {}, 'e'
  );
  assert.strictEqual(joints.arm_u_r, 90);
  assert.strictEqual(zHints.right_arm, undefined, 'no auto Z hint for profile');
});

test('compileSpatialProgram handles parallel', () => {
  const choreo = {
    id: 'test_par', steps: [
      { type: 'parallel', steps: [
        { part: 'left_arm', action: 'raise', amount: 1.0, ticks: 3 },
        { part: 'right_arm', action: 'raise', amount: 1.0, ticks: 3 },
      ]},
    ],
  };
  const program = compileSpatialProgram(choreo, rig);
  assert.strictEqual(program.root.children[0].op, 'parallel');
  assert.strictEqual(program.root.children[0].children.length, 2);
});
