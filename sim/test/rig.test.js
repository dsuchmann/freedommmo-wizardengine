import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRig, validateRig, comOf, HUMANOID_BONES } from '../../src/life/rig.js';

test('L2a: humanoid rig loads and passes validation', () => {
  const rig = loadRig('humanoid');
  assert.equal(rig.id, 'humanoid');
  assert.deepEqual(validateRig(rig), []);   // [] = no violations
});

test('L2a: rig carries the X2 minimum humanoid bone set', () => {
  const rig = loadRig('humanoid');
  for (const b of HUMANOID_BONES) assert.ok(rig.bones[b], b);
  assert.equal(rig.bones.root.parent, null);
  // tree integrity: every non-root parent exists; no cycles
  for (const [name, bone] of Object.entries(rig.bones)) {
    if (name === 'root') continue;
    assert.ok(rig.bones[bone.parent], `${name} parent ${bone.parent}`);
    let p = bone.parent, hops = 0;
    while (p !== null) { p = rig.bones[p].parent; assert.ok(++hops < 20, `${name} acyclic`); }
  }
});

test('L2a: joints, effectors, look-at, gaits are complete and sane', () => {
  const rig = loadRig('humanoid');
  for (const [name, j] of Object.entries(rig.joints)) {
    assert.ok(rig.bones[name], `joint ${name} has a bone`);
    assert.ok(j.min < j.max, `${name} limits ordered`);
    assert.ok(j.stiffness > 0 && j.stiffness <= 1, `${name} stiffness (0,1]`);
  }
  for (const eff of ['hand_l', 'hand_r', 'foot_l', 'foot_r', 'mouth']) {
    assert.ok(rig.effectors[eff], eff);
    assert.ok(rig.bones[rig.effectors[eff].bone], `${eff} bone exists`);
    assert.ok(rig.effectors[eff].reach > 0, `${eff} reach positive`);
  }
  const wsum = rig.lookAt.reduce((s, [, w]) => s + w, 0);
  assert.ok(Math.abs(wsum - 1) < 1e-9, 'look-at weights sum to 1');
  for (const [b] of rig.lookAt) assert.ok(rig.bones[b], `look-at bone ${b}`);
  for (const g of ['walk', 'run']) {
    assert.ok(rig.gaits[g] && rig.gaits[g].cycleTicks > 0, g);
  }
});

test('L2a: COM is computed from bone masses and sits inside the body', () => {
  const rig = loadRig('humanoid');
  const com = comOf(rig);
  const totalMass = Object.values(rig.bones).reduce((s, b) => s + b.mass, 0);
  assert.ok(totalMass > 0);
  // COM y between feet (0) and head top — roughly torso height
  assert.ok(com.y > 10 && com.y < 40, `com.y=${com.y}`);
  assert.ok(Math.abs(com.x) < 2, `com.x≈0 (symmetric rig), got ${com.x}`);
});

test('L2a: validateRig reports violations instead of throwing', () => {
  const rig = loadRig('humanoid');
  const broken = JSON.parse(JSON.stringify(rig));
  broken.bones.arm_u_l.parent = 'nonexistent';
  delete broken.joints.spine;
  broken.joints.head = { min: 50, max: -50, stiffness: 2 };
  const v = validateRig(broken);
  assert.ok(v.length >= 3, `found ${v.length} violations`);
  assert.ok(v.every(x => typeof x === 'string'));
});
