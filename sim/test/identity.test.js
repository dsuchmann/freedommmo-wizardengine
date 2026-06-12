import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { YEAR } from '../time/metabolism.js';
import {
  RACES, TRAITS, ATTRIBUTES, RACE_ATTR_MODIFIERS,
  traitsOf, attributesOf, nameOf, identityOf,
} from '../life/identity.js';

test('L1: traitsOf is deterministic, full-vocabulary, signed [-1,1]', () => {
  const a = traitsOf(7, 42);
  const b = traitsOf(7, 42);
  assert.deepEqual(a, b);
  assert.deepEqual(Object.keys(a), TRAITS);
  assert.equal(TRAITS.length, 10);
  for (const t of TRAITS) assert.ok(a[t] >= -1 && a[t] <= 1, t);
  assert.notDeepEqual(traitsOf(7, 43), a, 'different entity, different personality');
  assert.notDeepEqual(traitsOf(8, 42), a, 'different world, different personality');
});

test('L1: attributesOf respects race modifiers and clamps to [0,1]', () => {
  const a = attributesOf(7, 42, 'human');
  assert.deepEqual(Object.keys(a), ATTRIBUTES);
  for (const k of ATTRIBUTES) assert.ok(a[k] >= 0 && a[k] <= 1, k);
  // same rng base, so the orc differs from the human by exactly the modifier (pre-clamp):
  const o = attributesOf(7, 42, 'orc');
  const delta = o.strength - a.strength;
  if (o.strength < 1 && a.strength > 0) {
    assert.ok(Math.abs(delta - RACE_ATTR_MODIFIERS.orc.strength) < 1e-12);
  }
});

test('L1: nameOf is deterministic, per-race flavored, and varies by entity', () => {
  assert.equal(nameOf(7, 42, 'dwarf'), nameOf(7, 42, 'dwarf'));
  assert.notEqual(nameOf(7, 42, 'dwarf'), nameOf(7, 99, 'dwarf'));
  for (const r of RACES) {
    const n = nameOf(7, 42, r);
    assert.ok(typeof n === 'string' && n.length >= 3, r);
    assert.ok(/^[A-Z]/.test(n), 'capitalized');
  }
});

test('L1: identityOf — full identity for humanoids, null for flora/fauna', () => {
  const k = new Kernel({ seed: 7, phi: 4, bounds: { x0: 0, y0: 0, w: 8, h: 8 } });
  let h, g;
  k.graph.boot(() => {
    h = k.addLiving({ species: 'human', x: 2, y: 2, R: 50000, body: 15000, tick: 0, age: 35 * YEAR });
    g = k.addLiving({ species: 'grass', x: 4, y: 4, R: 800, body: 10, tick: 0 });
  });
  const id = identityOf(k, h);
  assert.equal(id.race, 'human');
  assert.equal(id.stage, 'adult');
  assert.equal(id.name, nameOf(7, h.id, 'human'));
  assert.deepEqual(id.traits, traitsOf(7, h.id));
  assert.deepEqual(id.attributes, attributesOf(7, h.id, 'human'));
  assert.equal(identityOf(k, g), null, 'grass has no personhood');
});
