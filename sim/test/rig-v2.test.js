// sim/test/rig-v2.test.js
// Pose-level regression guard for the canonical-humanoid-rig evolution.
// The contract: the canonical rig (humanoid.v2.json) must produce IDENTICAL
// world poses to v1 for every bone the 944 choreography programs drive, while
// only ADDING bones and freezing the geometry of every existing bone.
// Authored against the CURRENT v1 rig (src/life/rigs/humanoid.json) so the
// sanity tests are green today; the equivalence test guards the v2 edit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { solvePose } from '../../src/life/pose.js';
import { validateRig, applyProportions } from '../../src/life/rig.js';
import { solveSockets } from '../../src/life/sockets.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const V2_PATH = join(ROOT, 'src/life/rigs/humanoid.v2.json');
const loadRigRaw = () => JSON.parse(readFileSync(join(ROOT, 'src/life/rigs/humanoid.json'), 'utf8'));
const loadRigV2 = () => JSON.parse(readFileSync(V2_PATH, 'utf8'));

// Flatten every `pose` op across ALL choreography programs into a list of
// {file, joints:{boneName: deg}} states. `sequence`/`parallel` carry `children`.
function allPoseStates() {
  const dir = join(ROOT, 'src/life/choreography');
  const states = [];
  for (const f of readdirSync(dir).filter(n => n.endsWith('.json'))) {
    const prog = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.op === 'pose' && node.joints) states.push({ file: f, joints: node.joints });
      for (const c of node.children ?? []) walk(c);
    };
    walk(prog.root);
  }
  return states;
}

// The set of bones any program actually drives (the contract surface).
function drivenBones(states) {
  const s = new Set();
  for (const st of states) for (const b of Object.keys(st.joints)) s.add(b);
  return s;
}

const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('regression fixture: capture v1 world poses for every driven bone', () => {
  const rig = loadRigRaw();
  const states = allPoseStates();
  assert.ok(states.length > 100, `expected many pose states, got ${states.length}`);
  const driven = drivenBones(states);
  // Every driven bone must exist in the rig (sanity).
  for (const b of driven) assert.ok(rig.bones[b], `program drives unknown bone ${b}`);
  // Solve a representative state and confirm finite output (smoke).
  const solved = solvePose(rig, states[0].joints);
  for (const b of driven) {
    assert.ok(Number.isFinite(solved[b].origin.x), `non-finite origin for ${b}`);
  }
});

test('v2 preserves v1 world pose for every driven bone, across all programs', () => {
  if (!existsSync(V2_PATH)) {
    assert.fail('humanoid.v2.json not yet authored (Task 2)');
  }
  const v1 = loadRigRaw(), v2 = loadRigV2();

  // v2 only ADDS bones: every v1 bone must still exist in v2.
  for (const b of Object.keys(v1.bones)) {
    assert.ok(v2.bones[b], `v2 dropped v1 bone ${b} (must only ADD bones)`);
  }

  // Existing bones are geometrically frozen: identical length + pivot.
  for (const b of Object.keys(v1.bones)) {
    assert.equal(v2.bones[b].length, v1.bones[b].length, `${b} length changed (must be frozen)`);
    assert.deepEqual(v2.bones[b].pivot, v1.bones[b].pivot, `${b} pivot changed (must be frozen)`);
  }

  // World-pose equivalence for every driven bone across every program state.
  const states = allPoseStates();
  const driven = drivenBones(states);
  for (const st of states) {
    const s1 = solvePose(v1, st.joints);
    const s2 = solvePose(v2, st.joints);
    for (const b of driven) {
      assert.ok(approx(s1[b].origin.x, s2[b].origin.x, 1e-4), `${st.file} ${b} origin.x drift`);
      assert.ok(approx(s1[b].origin.y, s2[b].origin.y, 1e-4), `${st.file} ${b} origin.y drift`);
      assert.ok(approx(s1[b].worldDeg, s2[b].worldDeg, 1e-4), `${st.file} ${b} worldDeg drift`);
    }
  }
});

test('v2 rig is valid under the extended validator', () => {
  const v2 = loadRigV2();
  assert.deepEqual(validateRig(v2), []);   // [] = no violations
});

test('v1 rig still valid (back-compat)', () => {
  assert.deepEqual(validateRig(loadRigRaw()), []);   // [] = no violations
});

// --- Task 4: per-entity proportion scaling -------------------------------
test('applyProportions scales bone lengths/pivots and lowers/raises feet', () => {
  const v2 = loadRigV2();
  const child = applyProportions(v2, { all: 0.5 });          // half-size
  assert.equal(child.bones.thigh_l.length, v2.bones.thigh_l.length * 0.5);
  // identity vector is a no-op
  const same = applyProportions(v2, {});
  assert.equal(same.bones.thigh_l.length, v2.bones.thigh_l.length);
  // foot tip y scales with the body (grounding stays consistent)
  const restJoints = {};
  const tallFoot = solvePose(v2, restJoints).foot_l.tip.y;
  const shortFoot = solvePose(child, restJoints).foot_l.tip.y;
  assert.ok(Math.abs(shortFoot) < Math.abs(tallFoot), 'smaller body → foot closer to root');
});

// --- Task 5: socket world-transform resolution --------------------------
test('solveSockets places each socket on its bone with offset + rotation', () => {
  const v2 = loadRigV2();
  const solved = solvePose(v2, {});
  const sk = solveSockets(v2, solved);
  for (const name of Object.keys(v2.sockets)) {
    assert.ok(Number.isFinite(sk[name].origin.x), `socket ${name} unresolved`);
    assert.ok(Number.isFinite(sk[name].rot), `socket ${name} no rotation`);
  }
  // grip_r rides hand_r: its origin is within the hand bone span
  const hr = solved.hand_r;
  const span = Math.hypot(hr.tip.x - hr.origin.x, hr.tip.y - hr.origin.y) + 5;
  assert.ok(Math.hypot(sk.grip_r.origin.x - hr.origin.x, sk.grip_r.origin.y - hr.origin.y) <= span);
});
