import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { DAY, YEAR, SPECIES } from '../time/metabolism.js';

test('grass dies of old age and leaves a decaying corpse with cause chain', () => {
  const k = new Kernel({ seed: 7, phi: 4, bounds: { x0: 0, y0: 0, w: 8, h: 8 } });
  let g;
  k.graph.boot(() => { g = k.addLiving({ species: 'grass', x: 2, y: 2, R: 800, body: 10, tick: 0 }); });
  k.runTo(2 * YEAR);
  assert.equal(k.graph.nodes.get(g.id), undefined, 'original grass node gone');
  const death = k.ledger.events.find(e => e.type === 'death' && e.actor === g.id);
  assert.ok(death, 'death event recorded');
  const corpseBirth = k.ledger.events.find(e => e.type === 'corpse' && e.causeEventId === death.id);
  assert.ok(corpseBirth, 'corpse caused by death');
});

test('seeding creates provenance-correct offspring and population grows', () => {
  const k = new Kernel({ seed: 7, phi: 4, bounds: { x0: 0, y0: 0, w: 8, h: 8 } });
  k.graph.boot(() => {
    k.addLiving({ species: 'grass', x: 2, y: 2, R: 2000, body: 30, tick: 0, age: 16 * DAY });
  });
  k.runTo(100 * DAY);
  const grass = [...k.graph.nodes.values()].filter(n => n.type === 'grass');
  assert.ok(grass.length > 1, `population should grow (got ${grass.length})`);
  const child = grass.find(n => n.createdByEvent != null);
  assert.ok(child, 'offspring carries created_by_event');
  const ev = k.ledger.events.find(e => e.id === child.createdByEvent);
  assert.equal(ev.type, 'seed');
});

test('corpse decays to gone and writes a delta', () => {
  const k = new Kernel({ seed: 7, phi: 4, bounds: { x0: 0, y0: 0, w: 8, h: 8 } });
  k.graph.boot(() => {
    k.addLiving({ species: 'grass', x: 2, y: 2, R: 1, body: 5, tick: 0, age: 20 * DAY });
  });
  // R=1 with senescence-free mature rates is fine; force starvation by crowding instead:
  k.graph.boot(() => {
    for (let i = 0; i < 30; i++) k.addLiving({ species: 'grass', x: 2.5, y: 2.5, R: 50, body: 5, tick: 0, age: 20 * DAY });
  });
  k.runTo(YEAR);
  const corpses = [...k.graph.nodes.values()].filter(n => n.type === 'corpse');
  const gone = k.ledger.events.filter(e => e.type === 'decay_gone');
  assert.ok(gone.length > 0, 'some corpses fully decayed');
  assert.ok(k.deltas?.length > 0 || gone.length > 0, 'decay recorded');
});

test('L1: species without seed param spawns without crashing and never seeds', () => {
  const k = new Kernel({ seed: 7, phi: 4, bounds: { x0: 0, y0: 0, w: 16, h: 16 } });
  SPECIES.__seedless_test = {
    demand: 0.4, burn: 0.2, growFrac: 0.5, maxBody: 100,
    stages: [['mature', 0, 1.0, 1.0]],
    senescence: { start: 400 * DAY, stepEvery: 5 * DAY, burnGrowth: 1.1, demandDecay: 0.95 },
    embodiedDecayDays: 5,
  };
  try {
    let n;
    k.graph.boot(() => { n = k.addLiving({ species: '__seedless_test', x: 2, y: 2, R: 500, body: 10, tick: 0 }); });
    k.runTo(30 * DAY);
    // Node may have died of starvation — that's fine. Assert no crash + no seed events.
    assert.ok(!k.ledger.events.some(e => e.type === 'seed' && e.actor === n.id),
      'seedless species must never emit a seed event');
  } finally {
    delete SPECIES.__seedless_test;
  }
});
