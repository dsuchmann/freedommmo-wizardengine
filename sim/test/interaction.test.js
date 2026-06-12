// sim/test/interaction.test.js — pure material math; no kernel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRAINS } from '../matter/grains.js';
import { mergeGrains, adhesionOf, combineOutcome, signatureOf, INTERACTION } from '../matter/interaction.js';

test('every grain has an adhesion in [0,1]', () => {
  for (const [g, def] of Object.entries(GRAINS)) {
    assert.ok(typeof def.adhesion === 'number' && def.adhesion >= 0 && def.adhesion <= 1, g);
  }
});

test('mergeGrains sums unit-for-unit (conservation by construction)', () => {
  const m = mergeGrains([{ cellulose: 2, lignin: 1 }, { cellulose: 1, stone: 4 }]);
  assert.deepEqual(m, { cellulose: 3, lignin: 1, stone: 4 });
});

test('wood + wood binds (lignin is a natural glue): ok, composite form from top-2 grains', () => {
  const wood = { cellulose: 6, lignin: 4 };           // log yield shape
  const out = combineOutcome([wood, wood]);
  assert.equal(out.ok, true);
  assert.equal(out.form, 'composite:cellulose+lignin'); // sorted alphabetically
  assert.deepEqual(out.merged, { cellulose: 12, lignin: 8 });
});

test('stone + stone fails (zero adhesion): ruined form, grains still merged', () => {
  const out = combineOutcome([{ stone: 10 }, { stone: 10 }]);
  assert.equal(out.ok, false);
  assert.equal(out.form, 'ruined_mash');
  assert.deepEqual(out.merged, { stone: 20 });
});

test('sugary mixtures fail on stability, not adhesion (berry-harvest shape)', () => {
  const berry = { cellulose: 5, sugar: 3, fibre: 2 };
  const out = combineOutcome([berry, berry]);
  assert.ok(adhesionOf(out.merged) >= INTERACTION.minBind, 'sticky enough');
  assert.equal(out.ok, false, 'but too unstable');     // stability 0.37 < 0.4
});

test('outcome is pure and deterministic (same inputs → identical result, no RNG)', () => {
  const a = combineOutcome([{ cellulose: 6, lignin: 4 }, { fibre: 8, cellulose: 2 }]);
  const b = combineOutcome([{ cellulose: 6, lignin: 4 }, { fibre: 8, cellulose: 2 }]);
  assert.deepEqual(a, b);
});

test('signatureOf is order-independent and class-based', () => {
  const log = { kind: 'matter', archetype: 'log' };
  const log2 = { kind: 'matter', archetype: 'log' };   // distinct items, same class
  const grass = { kind: 'harvest', species: 'grass', archetype: null };
  assert.equal(signatureOf([log, grass]), signatureOf([grass, log2]));
  assert.equal(signatureOf([log, log2]), 'log+log');
  // archetype CLASS, not instance: boulder_small and boulder_mossy are both 'boulder'
  assert.equal(signatureOf([{ archetype: 'boulder_small' }, { archetype: 'boulder_mossy' }]), 'boulder+boulder');
});

test('combineOutcome([]) → ruined_mash with empty merged (empty list edge case)', () => {
  const out = combineOutcome([]);
  assert.equal(out.ok, false);
  assert.equal(out.form, 'ruined_mash');
  assert.deepEqual(out.merged, {});
});

test('adhesionOf edge cases: empty composition and unknown grain both return 0', () => {
  assert.equal(adhesionOf({}), 0);
  assert.equal(adhesionOf({ unknown_grain: 5 }), 0);
});

test('combineOutcome is insertion-order independent (same result regardless of key order)', () => {
  assert.deepEqual(
    combineOutcome([{ cellulose: 6, lignin: 4 }]),
    combineOutcome([{ lignin: 4, cellulose: 6 }])
  );
});
