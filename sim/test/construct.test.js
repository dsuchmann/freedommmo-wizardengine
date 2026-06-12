// sim/test/construct.test.js — M4: compileBlueprint creates real kernel nodes under provenance rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { compileBlueprint } from '../world/construct.js';

function makeKernel(seed = 7) {
  return new Kernel({ seed, bounds: { x0: 0, y0: 0, w: 32, h: 32 } });
}

test('compile hut at boot: one building node with stamps + footprint, noFlux', () => {
  const k = makeKernel();
  let buildings;
  k.graph.boot(() => { buildings = compileBlueprint(k, 'hut', { x: 4, y: 4 }, 0); });
  assert.equal(buildings.length, 1);
  const b = buildings[0];
  assert.equal(b.type, 'building');
  assert.equal(b.attrs.noFlux, true);
  assert.deepEqual(b.attrs.footprint, { x0: 4, y0: 4, w: 5, h: 4 });
  assert.equal(b.attrs.stamps.length, 20);
  assert.equal(b.attrs.template, 'hut');
  assert.deepEqual(b.attrs.npcSlots, [{ role: 'resident', workplace: null, sleep: 'bedroll' }]);
});

test('compile hut: interior features become inert matter nodes with declared E, linked to building', () => {
  const k = makeKernel();
  let buildings;
  k.graph.boot(() => { buildings = compileBlueprint(k, 'hut', { x: 4, y: 4 }, 0); });
  const features = [...k.graph.nodes.values()]
    .filter(n => n.type === 'matter' && n.attrs.building === buildings[0].id);
  assert.equal(features.length, 2);
  const hearth = features.find(f => f.attrs.archetype === 'hearth');
  assert.ok(hearth, 'hearth materialized');
  assert.deepEqual({ x: hearth.x, y: hearth.y }, { x: 5, y: 5 });
  assert.equal(hearth.attrs.noFlux, true);
  assert.ok(hearth.attrs.E > 0, 'features carry declared embodied time');
  assert.equal(hearth.attrs.provides, 'heat');
});

test('compile compound: one building node PER LEAF (groups are not entities)', () => {
  const k = makeKernel();
  let buildings;
  k.graph.boot(() => { buildings = compileBlueprint(k, 'compound', { x: 2, y: 2 }, 0); });
  assert.equal(buildings.length, 2);
  const types = [...k.graph.nodes.values()].filter(n => n.type === 'building');
  assert.equal(types.length, 2, 'no third group node');
});

test('provenance enforced: compiling outside boot without causeEventId throws', () => {
  const k = makeKernel();
  assert.throws(() => compileBlueprint(k, 'hut', { x: 4, y: 4 }, 0), /provenance/);
});

test('provenance: causal event id is recorded on building and feature nodes', () => {
  const k = makeKernel();
  // ledger.emit (sim/store/ledger.js:12) returns the new event ID (a number).
  const evId = k.ledger.emit({ tick: 0, type: 'construct', actor: null, targets: [], magnitude: 0, attrs: { template: 'hut' } });
  const buildings = compileBlueprint(k, 'hut', { x: 4, y: 4 }, 0, evId);
  assert.equal(buildings[0].createdByEvent, evId);
  const features = [...k.graph.nodes.values()]
    .filter(n => n.type === 'matter' && n.attrs.building === buildings[0].id);
  for (const f of features) assert.equal(f.createdByEvent, evId);
});

test('stocks include feature E; building node itself holds no stock', () => {
  const k = makeKernel();
  k.graph.boot(() => { compileBlueprint(k, 'hut', { x: 4, y: 4 }, 0); });
  const s = k.stocks(0);
  // hut features: hearth 150 + bedroll 60 (FEATURE_E table)
  assert.equal(s, 210);
});

test('determinism: two kernels, same compile → deepEqual building attrs', () => {
  const mk = () => {
    const k = makeKernel();
    let b;
    k.graph.boot(() => { b = compileBlueprint(k, 'compound', { x: 2, y: 2 }, 0); });
    return b.map(n => ({ type: n.type, x: n.x, y: n.y, attrs: n.attrs }));
  };
  assert.deepEqual(mk(), mk());
});
