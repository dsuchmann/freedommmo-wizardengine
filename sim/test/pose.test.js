// sim/test/pose.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRig, restPos } from '../../src/life/rig.js';
import { REST_UP, MAX_DEG_PER_TICK, solvePose, comAt, supportOf, ikReach2, IK_CHAINS } from '../../src/life/pose.js';

const rig = loadRig('humanoid');

test('solvePose at all-zero joints reproduces rest positions', () => {
  const solved = solvePose(rig, {});
  for (const bone of Object.keys(rig.bones)) {
    const r = restPos(rig, bone);
    assert.ok(Math.abs(solved[bone].origin.x - r.x) < 1e-9, `${bone} x`);
    assert.ok(Math.abs(solved[bone].origin.y - r.y) < 1e-9, `${bone} y`);
  }
  // tips: spine/head point up, others down
  assert.ok(Math.abs(solved.spine.tip.y - (22 + 16)) < 1e-9);
  assert.ok(Math.abs(solved.hand_r.tip.y - 18) < 1e-9);
  assert.ok(Math.abs(solved.foot_l.tip.y - (-2)) < 1e-9);
});

test('rotating a parent joint carries children (90° arm raise)', () => {
  // arm_u_r at +90 CCW: rest dir (0,-1) rotates to (1,0) — the arm goes horizontal.
  const solved = solvePose(rig, { arm_u_r: 90 });
  // shoulder fixed at (6,36); forearm origin = shoulder + R(90)·(0,-8)
  assert.ok(Math.abs(solved.arm_u_r.origin.x - 6) < 1e-9);
  assert.ok(Math.abs(solved.arm_u_r.origin.y - 36) < 1e-9);
  const fo = solved.arm_f_r.origin;
  const d = Math.hypot(fo.x - 6, fo.y - 36);
  assert.ok(Math.abs(d - 8) < 1e-9, 'forearm origin stays 8 from shoulder');
  assert.ok(Math.abs(fo.y - 36) < 1e-9, 'at 90° the upper arm is horizontal');
  // whole chain rigid: hand tip distance from shoulder unchanged vs rest (18 = 8+7+3)
  const tip = solved.hand_r.tip;
  assert.ok(Math.abs(Math.hypot(tip.x - 6, tip.y - 36) - 18) < 1e-9);
});

test('comAt at rest matches rig.comOf-style mass weighting and moves with pose', () => {
  const rest = comAt(rig, solvePose(rig, {}));
  assert.ok(rest.mass > 0 && Math.abs(rest.x) < 1e-9, 'symmetric rig: COM on centerline');
  const leaned = comAt(rig, solvePose(rig, { spine: 30 }));
  assert.notEqual(Math.round(leaned.x * 1000), 0, 'leaning the spine moves COM off centerline');
});

test('supportOf gives foot-tip x-interval with margin; balance detection works', () => {
  const solved = solvePose(rig, {});
  const s = supportOf(rig, solved);
  assert.ok(s.minX < -3 + 0.001 && s.maxX > 3 - 0.001, 'covers both rest foot tips ±margin');
  const com = comAt(rig, solved);
  assert.ok(com.x >= s.minX && com.x <= s.maxX, 'rest pose is balanced');
});

test('ikReach2 solves reachable targets round-trip and refuses unreachable', () => {
  for (const [effector, chain] of Object.entries(IK_CHAINS)) {
    // pick a known-reachable pose, FK it, then ask IK to find it back
    const probe = effector.startsWith('hand')
      ? { [chain[0]]: effector === 'hand_l' ? -60 : 60, [chain[1]]: effector === 'hand_l' ? -40 : 40 }
      : { [chain[0]]: -45, [chain[1]]: 30 };
    const solved = solvePose(rig, probe);
    const target = solved[chain[1]].tip;   // distal bone tip = chain end
    const angles = ikReach2(rig, effector, target);
    assert.ok(angles, `${effector}: reachable target solved`);
    const re = solvePose(rig, angles);
    const got = re[chain[1]].tip;
    assert.ok(Math.hypot(got.x - target.x, got.y - target.y) < 1e-6, `${effector} round-trip`);
  }
  assert.equal(ikReach2(rig, 'hand_r', { x: 500, y: 500 }), null, 'unreachable → null');
});

test('constants', () => {
  assert.deepEqual(REST_UP, ['spine', 'head']);
  assert.equal(MAX_DEG_PER_TICK, 30);
});
