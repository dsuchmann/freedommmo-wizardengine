import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { YEAR } from '../time/metabolism.js';
import {
  PARTS, PART_BONE, BODY_TYPES, AGE_BANDS, ageBandOf,
  bodyPlanOf, partKey,
} from '../life/body.js';

test('L2a: 14 manifest parts, each mapped to a rig bone', () => {
  assert.equal(PARTS.length, 14);
  assert.deepEqual([...PARTS].sort(), [
    'arm_fore_l', 'arm_fore_r', 'arm_upper_l', 'arm_upper_r',
    'foot_l', 'foot_r', 'hand_l', 'hand_r', 'head',
    'shin_l', 'shin_r', 'thigh_l', 'thigh_r', 'torso',
  ].sort());
  for (const p of PARTS) assert.ok(typeof PART_BONE[p] === 'string', p);
});

test('L2a: age bands cover every humanoid stage', () => {
  const stages = ['infant', 'toddler', 'child', 'adolescent', 'young_adult',
    'adult', 'middle_aged', 'senior', 'elderly'];
  for (const s of stages) assert.ok(AGE_BANDS.includes(ageBandOf(s)), s);
  assert.equal(ageBandOf('child'), 'child');
  assert.equal(ageBandOf('adult'), 'adult');
  assert.equal(ageBandOf('elderly'), 'elder');
});

test('L2a: bodyPlanOf is deterministic, race-scaled, attribute-girthed; null for flora', () => {
  const k = new Kernel({ seed: 7, phi: 4, bounds: { x0: 0, y0: 0, w: 8, h: 8 } });
  let dwarf, orc, grass;
  k.graph.boot(() => {
    dwarf = k.addLiving({ species: 'dwarf', x: 2, y: 2, R: 50000, body: 14000, tick: 0, age: 100 * YEAR });
    orc   = k.addLiving({ species: 'orc',   x: 4, y: 2, R: 50000, body: 16000, tick: 0, age: 25 * YEAR });
    grass = k.addLiving({ species: 'grass', x: 6, y: 2, R: 800, body: 10, tick: 0 });
  });
  const d1 = bodyPlanOf(k, dwarf), d2 = bodyPlanOf(k, dwarf);
  assert.deepEqual(d1, d2, 'deterministic');
  assert.equal(bodyPlanOf(k, grass), null, 'flora has no body plan');
  assert.equal(d1.race, 'dwarf');
  assert.ok(BODY_TYPES.includes(d1.bodyType));
  assert.ok(AGE_BANDS.includes(d1.ageBand));
  const o = bodyPlanOf(k, orc);
  assert.ok(o.scale.height > d1.scale.height, 'orc taller than dwarf (race base)');
  assert.ok(d1.scale.height > 0.5 && d1.scale.height < 1.5);
  assert.ok(o.scale.girth >= 0.9 && o.scale.girth <= 1.3, 'girth from attributes, bounded');
  for (const p of PARTS) assert.ok(o.parts[p].scale > 0, p);
});

test('L2a: children are smaller than adults of the same entity-rng', () => {
  const k = new Kernel({ seed: 7, phi: 4, bounds: { x0: 0, y0: 0, w: 8, h: 8 } });
  let kid, grown;
  k.graph.boot(() => {
    kid   = k.addLiving({ species: 'human', x: 2, y: 2, R: 50000, body: 5000,  tick: 0, age: 6 * YEAR });
    grown = k.addLiving({ species: 'human', x: 4, y: 2, R: 50000, body: 15000, tick: 0, age: 35 * YEAR });
  });
  assert.ok(bodyPlanOf(k, kid).scale.height < bodyPlanOf(k, grown).scale.height);
});

test('L2a: partKey addresses are stable and enumerable', () => {
  assert.equal(partKey('human', 'average', 'adult', 'torso', 's'),
    'human/average/adult/torso/s');
  // wave-1 vocabulary: 14 parts x 4 directions for one race/type/band
  const keys = new Set();
  for (const p of PARTS) for (const d of ['n', 's', 'e', 'w'])
    keys.add(partKey('human', 'average', 'adult', p, d));
  assert.equal(keys.size, 56);
});
