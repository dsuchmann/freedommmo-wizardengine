import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPoseEvalPrompt, parseEvalResponse } from '../../src/life/eval/vision-eval.js';

test('buildPoseEvalPrompt returns system + user messages with image placeholder', () => {
  const { system, userContent } = buildPoseEvalPrompt('right_arm_overhead', 'Right arm raised straight overhead');
  assert.ok(system.includes('stick figure'));
  assert.ok(typeof userContent === 'function');
  const msg = userContent('BASE64DATA');
  assert.ok(Array.isArray(msg));
  assert.ok(msg.some(p => p.type === 'image_url' || p.type === 'image'));
});

test('parseEvalResponse extracts score and critique', () => {
  const { score, critique } = parseEvalResponse('Score: 4\nThe arm is raised but slightly angled.');
  assert.strictEqual(score, 4);
  assert.ok(critique.includes('slightly angled'));
});

test('parseEvalResponse handles missing score gracefully', () => {
  const { score, critique } = parseEvalResponse('Looks good overall.');
  assert.strictEqual(score, 0);
  assert.ok(critique.includes('Looks good'));
});
