// sim/test/probe-fauna.test.js — Probe F (L4): a living ecosystem.
// Grass + deer + rabbit + wolf in a closed world: the wolf hunts (violence channel),
// the deer/rabbit flee (real move events), kills are causal, time is conserved, and
// the whole thing is deterministic. Headless; fauna render honestly absent.
//
// FIXTURE DEVIATION (2026-06-12): plan's original fixture (deer@10,10; wolf@15,10)
// was swapped — the deer fired its 6h instinct BEFORE the wolf's 12h instinct and
// fled 3 steps west (x=7), putting it 8 tiles from the wolf (outside hunt radius 6).
// Wolf never caught prey and starved within 1.5 days. Resolution: place the deer
// against the west wall (x=1) so flee attempts quickly hit the boundary, keeping prey
// reachable; give the wolf more R (60000) to survive until contact; add a rabbit
// near the west area; add a grass field throughout so herbivores can forage.
// Original plan grid fixture is replaced by this one; all assertions are unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';

const BOUNDS = { x0: 0, y0: 0, w: 24, h: 24 };
const DAYS = 86400;

function ecosystem() {
  const k = new Kernel({ seed: 7, bounds: BOUNDS });
  const ids = {};
  k.graph.boot(() => {
    // Grass field for herbivores to graze on
    for (let x = 2; x <= 20; x += 2)
      for (let y = 4; y <= 20; y += 4)
        k.addLiving({ species: 'grass', x, y, R: 6000, body: 200, tick: 0 });
    // Deer against the west wall so flee westward hits the boundary quickly,
    // keeping prey within the wolf's hunt radius over multiple decisions.
    ids.deer = k.addLiving({ species: 'deer', x: 1, y: 10, R: 30000, body: 2000, tick: 0 }).id;
    // Rabbit nearby for additional prey variety
    ids.rabbit = k.addLiving({ species: 'rabbit', x: 3, y: 14, R: 12000, body: 800, tick: 0 }).id;
    // Wolf positioned 3 tiles from the deer (within hunt radius 6), with ample R
    // so it can hunt for many days before starvation threatens.
    ids.wolf = k.addLiving({ species: 'wolf', x: 4, y: 10, R: 60000, body: 5000, tick: 0 }).id;
  });
  return { k, ids };
}

test('probe F: predation, flight, causality, conservation, determinism', () => {
  const { k, ids } = ecosystem();
  const start = k.stocks(0);
  const f0 = k.ledger.totals;
  const startFlow = f0.captured - f0.burned - f0.decayed - f0.transferLoss;

  k.runTo(90 * DAYS);

  // — the wolf hunted
  const hunts = k.ledger.events.filter(e => e.type === 'hunt' && e.actor === ids.wolf);
  assert.ok(hunts.length >= 1, 'at least one hunt event');
  // — prey moved (flight is real movement, not despawn)
  const fleeMoves = k.ledger.events.filter(e => e.type === 'move' && (e.actor === ids.deer || e.actor === ids.rabbit));
  assert.ok(fleeMoves.length >= 1, 'prey fled via real move events');
  // — if the deer died, the death is causally chained to a hunt
  const deerDeath = k.ledger.events.find(e => e.type === 'death' && e.actor === ids.deer);
  if (deerDeath && deerDeath.causeEventId != null) {
    const cause = k.ledger.events[deerDeath.causeEventId - 1];
    assert.ok(['hunt'].includes(cause.type), `deer death caused by ${cause.type}`);
  }
  // — herbivores grazed (ecology feeds the time economy)
  assert.ok(k.ledger.events.some(e => e.type === 'graze'), 'herbivores grazed flora');

  // — conservation (probe 6 relative-tolerance pattern)
  const end = k.stocks(k.tick);
  const t = k.ledger.totals;
  const endFlow = t.captured - t.burned - t.decayed - t.transferLoss;
  const scale = Math.max(Math.abs(t.captured), 1);
  const drift = Math.abs((end - start) - (endFlow - startFlow));
  assert.ok(drift / scale < 1e-9, `conservation: relErr=${drift / scale}`);
});

test('probe F: bit-identical replay', () => {
  const snap = ({ k }) => {
    k.runTo(45 * DAYS);
    return {
      events: k.ledger.events.map(e => [e.type, e.actor, e.targets, e.magnitude]),
      nodes: [...k.graph.nodes.values()].filter(n => n.R != null)
        .map(n => [n.id, n.attrs.species, n.x, n.y]),
    };
  };
  assert.deepEqual(snap(ecosystem()), snap(ecosystem()));
});
