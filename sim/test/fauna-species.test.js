// sim/test/fauna-species.test.js — L4 fauna table invariants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPECIES } from '../time/metabolism.js';
import { SPECIES_YIELD } from '../matter/composition.js';

const FAUNA = ['rabbit', 'deer', 'wolf', 'grazer'];

test('fauna rows: complete metabolism schema + spine-vocabulary stages', () => {
  for (const name of FAUNA) {
    const sp = SPECIES[name];
    assert.ok(sp, `${name} exists`);
    for (const f of ['demand', 'burn', 'growFrac', 'maxBody', 'embodiedDecayDays'])
      assert.equal(typeof sp[f], 'number', `${name}.${f}`);
    assert.ok(sp.senescence && sp.seed, `${name} ages and reproduces`);
    for (const [stage] of sp.stages)
      assert.ok(['seedling', 'growing', 'mature'].includes(stage), `${name} stage ${stage} in spine vocabulary`);
    assert.ok(sp.instinct && sp.instinct.every > 0 && sp.instinct.speed >= 0, `${name} has instinct cadence`);
    assert.ok(!sp.graze, `${name} migrated off the legacy graze field`);
  }
});

test('every fauna is herbivore or predator, never neither', () => {
  for (const name of FAUNA) {
    const i = SPECIES[name].instinct;
    assert.ok(i.forage || i.hunt, `${name} eats something`);
    if (i.hunt) for (const prey of i.hunt.prey)
      assert.ok(SPECIES[prey], `${name} prey ${prey} is a real species`);
    if (i.flee) assert.ok(i.flee.radius > 0);
    if (i.tame) assert.ok(i.tame.minOffer > 0);
  }
});

test('fauna feed the economy: yield rows exist', () => {
  for (const name of FAUNA) {
    assert.ok(SPECIES_YIELD[name], `${name} yield row`);
  }
});

test('humanoid foraging still uses the legacy graze field (migrates at L6)', () => {
  for (const r of ['human', 'elf', 'dwarf', 'orc']) assert.ok(SPECIES[r].graze, `${r}.graze`);
});
