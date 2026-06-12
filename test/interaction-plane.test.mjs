import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VERBS, CATEGORIES, verbById } from '../src/world/interaction-taxonomy.js';
import { verbsFor, traversalVerbs, REGISTRY } from '../src/world/interaction-registry.js';

test('taxonomy: every verb is a well-formed record in a known category', () => {
  assert.ok(VERBS.length >= 20);
  for (const v of VERBS) {
    assert.match(v.id, /^[a-z]+\.[a-z-]+$/);
    assert.ok(CATEGORIES.includes(v.category), v.id);
    assert.ok(v.owner === 'client' || v.owner === 'sim', v.id);
    assert.ok(Array.isArray(v.preconditions), v.id);
  }
  assert.equal(verbById('traversal.stand-on').owner, 'client');
  assert.equal(verbById('manipulation.destroy').owner, 'sim');
});

test('traversal verbs auto-fill from volume geometry', () => {
  assert.deepEqual(traversalVerbs(null), []);
  const trunk = { solidH: Infinity, topZ: null, rampW: 0.5, rampH: 0.3, overheadZ: 2, overheadR: 2 };
  assert.deepEqual(traversalVerbs(trunk), ['traversal.walk-up', 'traversal.shelter-under']);
  const stump = { solidH: 0.5, topZ: 0.5, rampW: 0, rampH: 0, overheadZ: null, overheadR: 0 };
  assert.deepEqual(traversalVerbs(stump), ['traversal.jump-over', 'traversal.stand-on']);
});

test('registry: semantic verbs start honestly absent', () => {
  assert.deepEqual(REGISTRY, {});   // no placeholder interactions, ever
  const stump = { solidH: 0.5, topZ: 0.5, rampW: 0, rampH: 0, overheadZ: null, overheadR: 0 };
  assert.deepEqual(verbsFor('forest_oak', 'stump', stump),
    ['traversal.jump-over', 'traversal.stand-on']);
  assert.deepEqual(verbsFor('mystery_altar', null, null), []); // geometry until sim gives meaning
});
