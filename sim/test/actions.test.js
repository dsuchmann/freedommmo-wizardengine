// sim/test/actions.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { createPlayer, pick, chop } from '../world/actions.js';
import { SPECIES, DAY } from '../time/metabolism.js';

function world() {
  const k = new Kernel({ seed: 3, bounds: { x0: 0, y0: 0, w: 8, h: 8 } });
  let bush, tree;
  k.graph.boot(() => {
    bush = k.addLiving({ species: 'berry_bush', x: 2, y: 2, R: 8000, body: 4000, tick: 0, age: 200 * DAY });
    tree = k.addLiving({ species: 'tree', x: 5, y: 5, R: 20000, body: 30000, tick: 0, age: 400 * DAY });
  });
  return { k, bush, tree };
}

test('pick moves time from bush to player through harvest channel', () => {
  const { k, bush } = world();
  const player = createPlayer(k, 0);
  assert.equal(player.attrs.noFlux, true);
  const gained = pick(k, player.id, bush.id, 0);
  assert.ok(gained > 0);
  assert.equal(player.R, gained);
  assert.ok(Math.abs(gained / SPECIES.berry_bush.pick.bite - 0.5) < 1e-9); // harvest eff 0.5
  const ev = k.ledger.events.at(-1);
  assert.equal(ev.type, 'pick');
  assert.equal(ev.attrs.species, 'berry_bush');   // matter seam: species recorded
});

test('chop kills the tree, writes a felled delta, corpse decay heals it', () => {
  const { k, tree } = world();
  const player = createPlayer(k, 0);
  chop(k, player.id, tree.id, 0);
  assert.equal(k.graph.nodes.get(tree.id), undefined);          // tree is dead
  const corpse = [...k.graph.nodes.values()].find(n => n.type === 'corpse');
  assert.ok(corpse, 'stump corpse exists');
  assert.equal(k.deltas.list.length, 1);
  assert.equal(k.deltas.list[0].kind, 'felled');
  assert.ok(corpse.attrs.healDeltaId === k.deltas.list[0].id);
  k.runTo(2 * 360 * DAY);                                        // long enough for decay_gone
  assert.equal(k.deltas.list.filter(d => d.kind === 'felled').length, 0);  // healed
  assert.ok(k.ledger.events.some(e => e.type === 'delta_healed'));
});

test('chop death is causally chained to the chop event', () => {
  const { k, tree } = world();
  const player = createPlayer(k, 0);
  chop(k, player.id, tree.id, 0);
  const chopEv = k.ledger.events.find(e => e.type === 'chop');
  const deathEv = k.ledger.events.find(e => e.type === 'death');
  assert.equal(deathEv.causeEventId, chopEv.id);
});
