import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SLOTS } from '../items/equipment.js';
import { PARTS, SLOT_ANCHOR, composeLayers, partKey } from '../life/body.js';

const plan = {
  race: 'human', stage: 'adult', ageBand: 'adult', bodyType: 'average',
  scale: { height: 1, girth: 1 },
  parts: Object.fromEntries(PARTS.map(p => [p, { scale: 1 }])),
};

test('L2a: every equipment slot anchors to a body part', () => {
  for (const slot of Object.keys(SLOTS)) {
    assert.ok(PARTS.includes(SLOT_ANCHOR[slot]), `${slot} → ${SLOT_ANCHOR[slot]}`);
  }
});

test('L2a: bare-body composition emits all 14 parts, strictly z-ordered, per direction', () => {
  for (const d of ['n', 's', 'e', 'w', 'se', 'sw', 'ne', 'nw']) {
    const layers = composeLayers(plan, {}, d);
    assert.equal(layers.length, 14, d);
    assert.deepEqual([...layers.map(l => l.part)].sort(),
      [...PARTS].sort(), `${d}: all parts present`);
    for (let i = 1; i < layers.length; i++) {
      assert.ok(layers[i].z > layers[i - 1].z, `${d}: strict z order`);
    }
    assert.equal(layers.find(l => l.part === 'torso').key,
      partKey('human', 'average', 'adult', 'torso', d));
  }
});

test('L2a: facing direction flips near/far limb stacking', () => {
  const east = composeLayers(plan, {}, 'e');
  const west = composeLayers(plan, {}, 'w');
  const zOf = (layers, p) => layers.find(l => l.part === p).z;
  // facing east: right side is near (drawn above torso), left side far
  assert.ok(zOf(east, 'arm_upper_r') > zOf(east, 'torso'));
  assert.ok(zOf(east, 'arm_upper_l') < zOf(east, 'torso'));
  // facing west: mirrored
  assert.ok(zOf(west, 'arm_upper_l') > zOf(west, 'torso'));
  assert.ok(zOf(west, 'arm_upper_r') < zOf(west, 'torso'));
  // diagonals: near side (right for se/ne, left for sw/nw) above torso, far below
  const se = composeLayers(plan, {}, 'se'), sw = composeLayers(plan, {}, 'sw');
  const ne = composeLayers(plan, {}, 'ne'), nw = composeLayers(plan, {}, 'nw');
  assert.ok(zOf(se, 'arm_upper_r') > zOf(se, 'torso'));
  assert.ok(zOf(se, 'arm_upper_l') < zOf(se, 'torso'));
  assert.ok(zOf(sw, 'arm_upper_l') > zOf(sw, 'torso'));
  assert.ok(zOf(sw, 'arm_upper_r') < zOf(sw, 'torso'));
  assert.ok(zOf(ne, 'arm_upper_r') > zOf(ne, 'torso'));
  assert.ok(zOf(ne, 'arm_upper_l') < zOf(ne, 'torso'));
  assert.ok(zOf(nw, 'arm_upper_l') > zOf(nw, 'torso'));
  assert.ok(zOf(nw, 'arm_upper_r') < zOf(nw, 'torso'));
  // s-biased diagonals draw head last (front view); n-biased draw legs in front
  assert.ok(zOf(se, 'head') > zOf(se, 'hand_r'));
  assert.ok(zOf(ne, 'foot_r') > zOf(ne, 'head'));
});

test('L2a: worn items interleave by SLOTS.layer above their anchor part', () => {
  const equipment = {
    chest: { id: 901, attrs: { archetype: 'tunic' } },
    torso_under: { id: 902, attrs: { archetype: 'shirt' } },
    head: { id: 903, attrs: { archetype: 'cap' } },
  };
  const layers = composeLayers(plan, equipment, 's');
  assert.equal(layers.length, 17);   // 14 parts + 3 worn
  const z = name => layers.find(l => l.slot === name || l.part === name).z;
  // both worn torso layers sit above the torso part, under-layer below outer
  assert.ok(z('torso_under') > z('torso'));
  assert.ok(z('chest') > z('torso_under'));
  const head = layers.find(l => l.part === 'head');
  const cap = layers.find(l => l.slot === 'head');
  assert.ok(cap.z > head.z, 'cap above head part');
  assert.equal(cap.item, 903, 'item id carried for the renderer');
});

test('L2a: composition is pure data — stable under repeat, no rig/kernel needed', () => {
  const a = composeLayers(plan, {}, 'n');
  const b = composeLayers(plan, {}, 'n');
  assert.deepEqual(a, b);
});

test('composeLayers with zHint "front" moves right_arm group above torso (south)', () => {
  const zHints = { right_arm: 'front' };
  const layers = composeLayers(plan, {}, 's', zHints);
  const zOf = p => layers.find(l => l.part === p).z;
  const torsoZ = zOf('torso');
  // All right_arm parts must be above torso
  assert.ok(zOf('arm_upper_r') > torsoZ, 'arm_upper_r > torso');
  assert.ok(zOf('arm_fore_r') > torsoZ, 'arm_fore_r > torso');
  assert.ok(zOf('hand_r') > torsoZ, 'hand_r > torso');
  // Left arm must remain below torso (south default: left side far)
  assert.ok(zOf('arm_upper_l') < torsoZ, 'arm_upper_l < torso (unchanged)');
});

test('composeLayers with zHint "behind" moves left_arm group below torso (south)', () => {
  // South default already has left arm below torso — verify "behind" keeps it there
  // and that the mechanism works by testing with east (where left arm is naturally far/below)
  const zHints = { left_arm: 'behind' };
  // East: left arm is naturally below torso. Apply hint to confirm it stays below.
  const layersE = composeLayers(plan, {}, 'e', zHints);
  const zOfE = p => layersE.find(l => l.part === p).z;
  assert.ok(zOfE('arm_upper_l') < zOfE('torso'), 'arm_upper_l < torso (east, behind)');
  // Also verify: without the hint, east has right arm above torso — hint for right_arm
  // "front" should keep/push it above.
  const layersEFront = composeLayers(plan, {}, 'e', { right_arm: 'front' });
  const zOfEF = p => layersEFront.find(l => l.part === p).z;
  assert.ok(zOfEF('arm_upper_r') > zOfEF('torso'), 'arm_upper_r > torso (east, front hint)');
});

test('composeLayers zHints do not affect unmentioned groups', () => {
  const zHints = { right_arm: 'front' };
  const base = composeLayers(plan, {}, 's');
  const hinted = composeLayers(plan, {}, 's', zHints);
  const zOf = (layers, p) => layers.find(l => l.part === p).z;
  // Torso z is unchanged
  assert.equal(zOf(hinted, 'torso'), zOf(base, 'torso'), 'torso z unchanged');
  // Head z is unchanged
  assert.equal(zOf(hinted, 'head'), zOf(base, 'head'), 'head z unchanged');
  // Left arm z is unchanged
  assert.equal(zOf(hinted, 'arm_upper_l'), zOf(base, 'arm_upper_l'), 'arm_upper_l z unchanged');
});
