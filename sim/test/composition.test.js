// sim/test/composition.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPECIES_YIELD, ARCHETYPE_YIELD, compositionOf, grainsForBite, propertiesOf } from '../matter/composition.js';
import { SPECIES } from '../time/metabolism.js';
import { GRAINS } from '../matter/grains.js';

test('every kernel species and yield table entry is well-formed', () => {
  for (const sp of Object.keys(SPECIES)) {
    assert.ok(SPECIES_YIELD[sp], `species ${sp} has a yield table`);
  }
  for (const tbl of [...Object.values(SPECIES_YIELD), ...Object.values(ARCHETYPE_YIELD)]) {
    for (const [g, perTu] of Object.entries(tbl)) {
      assert.ok(GRAINS[g], `grain type ${g} exists in registry`);
      assert.ok(perTu > 0);
    }
  }
});

test('compositionOf derives lazily from node state — no storage, deterministic', () => {
  const bush = { type: 'living', R: 500, attrs: { species: 'berry_bush', body: 4000 } };
  const c1 = compositionOf(bush);
  const c2 = compositionOf(bush);
  assert.deepEqual(c1, c2);
  // grass yield: grains scale linearly with body
  const small = compositionOf({ type: 'living', attrs: { species: 'grass', body: 100 } });
  const big   = compositionOf({ type: 'living', attrs: { species: 'grass', body: 200 } });
  for (const g of Object.keys(small)) assert.ok(Math.abs(big[g] - 2 * small[g]) < 1e-9);
});

test('matter and corpse nodes derive from archetype/species + E', () => {
  const rock = { type: 'matter', attrs: { archetype: 'boulder_small', E: 1000 } };
  const c = compositionOf(rock);
  assert.ok(c.stone > 0);
  const corpse = { type: 'corpse', attrs: { species: 'tree', E: 2000 } };
  assert.ok(compositionOf(corpse).lignin > 0);
});

test('grainsForBite: transfer-point grains proportional to bite magnitude', () => {
  const g300 = grainsForBite('berry_bush', 300);
  const g600 = grainsForBite('berry_bush', 600);
  for (const k of Object.keys(g300)) assert.ok(Math.abs(g600[k] - 2 * g300[k]) < 1e-9);
});

test('propertiesOf: composition-weighted emergent properties', () => {
  const p = propertiesOf({ stone: 10 });
  assert.ok(Math.abs(p.stability - 0.97) < 1e-9);     // pure stone = stone's stability
  assert.ok(Math.abs(p.purity - 0.5) < 1e-9);
  assert.ok(p.totalUnits === 10 && p.energy === 100); // 10 units * 10 tu/unit
  const mix = propertiesOf({ cellulose: 5, lignin: 5 });
  assert.ok(mix.stability > 0.5 && mix.stability < 0.8); // weighted between components
  assert.deepEqual(propertiesOf({}), { totalUnits: 0, energy: 0, purity: 0, resonance: 0, stability: 0 });
});

test('interior-feature archetypes have explicit EMPTY yields (labor-only, no conjured stone)', () => {
  for (const arch of ['hearth', 'bedroll', 'furnace', 'anvil']) {
    const node = { type: 'matter', attrs: { archetype: arch, E: 100 } };
    assert.deepEqual(compositionOf(node), {},
      `${arch} must yield no grains — longest-prefix fallthrough to default would conjure stone`);
  }
});
