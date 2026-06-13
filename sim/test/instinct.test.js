// sim/test/instinct.test.js — L4 instinct rules: forage parity, hunt, flee, determinism.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';

const BOUNDS = { x0: 0, y0: 0, w: 30, h: 30 };
const mk = () => new Kernel({ seed: 7, bounds: BOUNDS });

test('forage: grazer instinct bites nearest flora exactly like legacy graze', () => {
  const k = mk();
  let grazer, grass;
  k.graph.boot(() => {
    grass = k.addLiving({ species: 'grass', x: 11, y: 10, R: 5000, body: 150, tick: 0 });
    grazer = k.addLiving({ species: 'grazer', x: 10, y: 10, R: 30000, body: 5000, tick: 0 });
  });
  k.runTo(7 * 3600);   // past one 6h instinct cadence
  const grazes = k.ledger.events.filter(e => e.type === 'graze' && e.actor === grazer.id);
  assert.ok(grazes.length >= 1, 'grazer foraged');
  assert.equal(grazes[0].targets[0], grass.id);
  assert.equal(grazes[0].magnitude, 600);   // full bite — grass had body+R >= bite
});

test('hunt: wolf approaches and bites deer through the violence channel; kill is causal', () => {
  const k = mk();
  let wolf, deer;
  k.graph.boot(() => {
    // Deer against the west wall (x=1) so flee attempts hit the boundary and wolf can close in.
    deer = k.addLiving({ species: 'deer', x: 1, y: 10, R: 20000, body: 6000, tick: 0 });
    wolf = k.addLiving({ species: 'wolf', x: 3, y: 10, R: 40000, body: 5000, tick: 0 });
  });
  k.runTo(80 * 3600);   // several 12h wolf decisions; deer trapped against wall, wolf closes in
  const hunts = k.ledger.events.filter(e => e.type === 'hunt' && e.actor === wolf.id);
  assert.ok(hunts.length >= 1, 'wolf hunted');
  const death = k.ledger.events.find(e => e.type === 'death' && e.actor === deer.id);
  if (death && death.causeEventId != null) {   // assert causality when the kill happened (starvation deaths have null cause)
    assert.ok(hunts.some(h => h.id === death.causeEventId), 'death caused by a hunt event');
  }
  const wolfMoves = k.ledger.events.filter(e => e.type === 'move' && e.actor === wolf.id);
  assert.ok(wolfMoves.length >= 1, 'wolf moved toward prey');
});

test('flee: deer steps away from a wolf inside its flee radius before eating', () => {
  const k = mk();
  let deer;
  k.graph.boot(() => {
    k.addLiving({ species: 'grass', x: 10, y: 11, R: 5000, body: 150, tick: 0 });
    deer = k.addLiving({ species: 'deer', x: 10, y: 10, R: 50000, body: 8000, tick: 0 });
    k.addLiving({ species: 'wolf', x: 13, y: 10, R: 1, body: 1, tick: 0 });   // starving wolf: dies fast, but present at first deer decision
  });
  k.runTo(7 * 3600);   // one deer decision with wolf at Chebyshev 3 <= flee.radius 5
  const deerMoves = k.ledger.events.filter(e => e.type === 'move' && e.actor === deer.id);
  assert.ok(deerMoves.length >= 1, 'deer fled');
  assert.ok(deerMoves[0].attrs.toX < 10, 'first flee step moves away from the wolf (west, x decreases)');
  const deerGrazes = k.ledger.events.filter(e => e.type === 'graze' && e.actor === deer.id);
  assert.equal(deerGrazes.length, 0, 'flee preempts forage in the same decision');
});

test('determinism: two identically-seeded ecosystems are event-identical', () => {
  const run = () => {
    const k = mk();
    k.graph.boot(() => {
      for (let x = 6; x <= 14; x += 2) k.addLiving({ species: 'grass', x, y: 12, R: 4000, body: 150, tick: 0 });
      k.addLiving({ species: 'deer', x: 10, y: 10, R: 40000, body: 6000, tick: 0 });
      k.addLiving({ species: 'wolf', x: 15, y: 10, R: 30000, body: 5000, tick: 0 });
    });
    k.runTo(30 * 86400);
    return k.ledger.events.map(e => [e.type, e.actor, e.targets, e.magnitude]);
  };
  assert.deepEqual(run(), run());
});
