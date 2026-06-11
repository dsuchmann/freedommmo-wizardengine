import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { DAY } from '../time/metabolism.js';

test('grazer eats nearby grass: transfer at harvest efficiency, prey can die with cause chain', () => {
  const k = new Kernel({ seed: 11, phi: 4 });
  let grazer;
  k.graph.boot(() => {
    grazer = k.addLiving({ species: 'grazer', x: 5, y: 5, R: 40000, body: 5000, tick: 0, age: 200 * DAY });
    for (let i = 0; i < 6; i++) {
      k.addLiving({ species: 'grass', x: 5 + (i % 3), y: 5 + Math.floor(i / 3), R: 300, body: 400, tick: 0, age: 20 * DAY });
    }
  });
  const start = k.stocks(0);
  k.runTo(30 * DAY);
  const end = k.stocks(30 * DAY);
  const t = k.ledger.totals;
  assert.ok(Math.abs((end - start) - (t.captured - t.burned - t.decayed - t.transferLoss)) < 1e-3,
    'conservation identity holds through harvest-channel transfers');
  const grazes = k.ledger.events.filter(e => e.type === 'graze' && e.actor === grazer.id);
  assert.ok(grazes.length > 0, 'graze events recorded');
  assert.ok(k.ledger.totals.transferLoss > 0, 'harvest channel loses 50%');
  const preyDeaths = k.ledger.events.filter(e => e.type === 'death' && e.causeEventId != null);
  // some grass may be eaten to death; if so the death must chain to a graze event
  for (const d of preyDeaths) {
    const cause = k.ledger.events.find(e => e.id === d.causeEventId);
    assert.equal(cause.type, 'graze');
  }
});

test('grazer starves without flora (ambient demand 0.1 < burn 0.5)', () => {
  const k = new Kernel({ seed: 11, phi: 4 });
  let grazer;
  k.graph.boot(() => {
    grazer = k.addLiving({ species: 'grazer', x: 50, y: 50, R: 5000, body: 100, tick: 0, age: 200 * DAY });
  });
  k.runTo(60 * DAY);
  assert.equal(k.graph.nodes.get(grazer.id), undefined, 'grazer dead');
  assert.ok(k.ledger.events.some(e => e.type === 'death' && e.actor === grazer.id));
});
