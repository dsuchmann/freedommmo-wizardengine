// sim/test/protocol-wire.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeEntity } from '../server/protocol.js';
import { SPECIES, stageAt, DAY } from '../time/metabolism.js';

test('serializeEntity carries placement attrs, bufferDays, ageTicks, senescenceStartTicks', () => {
  const node = { id: 7, type: 'berry_bush', R: 900, x: 3.5, y: 4.25,
    attrs: { species: 'berry_bush', body: 300, birthTick: 0,
             placement: 'f4:3,4:0', field: 'f4', archetype: 'cornflower', biome: 'grassland', variant: 2 } };
  const e = serializeEntity(node, 0);
  assert.equal(e.placement, 'f4:3,4:0');
  assert.equal(e.archetype, 'cornflower');
  assert.equal(e.biome, 'grassland');
  assert.equal(e.variant, 2);
  assert.equal(e.field, 'f4');
  const sp = SPECIES.berry_bush;
  const dailyBurn = sp.burn * stageAt('berry_bush', 0)[3] * DAY;
  assert.ok(Math.abs(e.bufferDays - 900 / dailyBurn) < 1e-9);
  assert.equal(e.ageTicks, 0);                                       // tick - attrs.birthTick
  assert.equal(e.senescenceStartTicks, sp.senescence?.start);        // omitted (undefined) if species has none — JSON cannot carry Infinity
});

test('serializeEntity stays lean for unwired entities (no placement keys)', () => {
  const node = { id: 8, type: 'grass', R: 10, x: 0, y: 0, attrs: { species: 'grass', body: 5, birthTick: 0 } };
  const e = serializeEntity(node, 0);
  assert.equal('placement' in e, false);
  assert.ok(typeof e.bufferDays === 'number');   // bufferDays for ALL living entities (taxonomy needs it)
});
