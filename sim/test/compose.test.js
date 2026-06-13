import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compilePlan } from '../../src/life/eval/compile-plan.js';
import { readFileSync } from 'node:fs';

const poses = JSON.parse(readFileSync('src/life/choreography/poses.json', 'utf8'));

test('compilePlan converts pose refs to DSL program', () => {
  const plan = {
    id: 'test_wave', kind: 'gesture',
    steps: [
      { pose: 'right_arm_overhead', ticks: 6 },
      { pose: 'right_arm_wave_high', ticks: 3 },
      { pose: 'right_arm_wave_low', ticks: 2 },
      { pose: 'rest', ticks: 6 },
    ],
  };
  const program = compilePlan(plan, poses);
  assert.strictEqual(program.id, 'test_wave');
  assert.strictEqual(program.root.op, 'sequence');
  assert.strictEqual(program.root.children.length, 4);
  assert.deepStrictEqual(program.root.children[0].joints, { arm_u_r: 150 });
  assert.strictEqual(program.root.children[0].ticks, 6);
  assert.deepStrictEqual(program.root.children[3].joints, {});
});

test('compilePlan throws on unknown pose ref', () => {
  const plan = {
    id: 'bad', kind: 'gesture',
    steps: [{ pose: 'nonexistent_pose', ticks: 3 }],
  };
  assert.throws(() => compilePlan(plan, poses), /unknown pose/i);
});

test('compilePlan detects NEW: prefix and returns missing poses', () => {
  const plan = {
    id: 'novel', kind: 'gesture',
    steps: [
      { pose: 'rest', ticks: 3 },
      { pose: 'NEW:arms stretched wide to both sides', ticks: 5 },
      { pose: 'rest', ticks: 3 },
    ],
  };
  const result = compilePlan(plan, poses);
  assert.ok(result.missingPoses);
  assert.strictEqual(result.missingPoses.length, 1);
  assert.ok(result.missingPoses[0].includes('arms stretched wide'));
});
