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

test('pick with overdrafted prey.R mints no phantom time', () => {
  // Regression for C1: if prey.R is negative (post-closeSegment tick overshoot),
  // the harvester must gain only from body + 0, not body + |negativeR|.
  //
  // Isolated world: just bush + player, no tree, so conservation accounting is simple.
  const k = new Kernel({ seed: 3, bounds: { x0: 0, y0: 0, w: 8, h: 8 } });
  let bush;
  k.graph.boot(() => {
    bush = k.addLiving({ species: 'berry_bush', x: 2, y: 2, R: 8000, body: 4000, tick: 0, age: 200 * DAY });
  });
  const player = createPlayer(k, 0);

  // closeSegment at tick=0 is a no-op (dt=0); do it explicitly to match pick's first call.
  k.closeSegment(bush, 0);

  // Inject the honest overdraft state: as if Math.ceil in the scheduler fired 1 tick late,
  // driving R slightly negative. The overdraft is un-counted from burned (as die() does).
  const overdraft = 5;
  bush.R = -overdraft;
  k.ledger.count('burned', -overdraft);

  // Snapshot AFTER injecting overdraft (at this point the ledger reflects the honest state).
  // At tick=0 everything is open at lastTick=0, so stocks = direct sum (no accrual needed).
  // stocksBefore accounts for the negative R: bush contributes R=-5, body=4000.
  const stocksBefore = (bush.R + bush.attrs.body) + player.R;
  const t0 = { ...k.ledger.totals };

  const gained = pick(k, player.id, bush.id, 0);

  // 1. Gained must equal bite * harvest_eff where bite used only body (R clamped to 0).
  const sp = SPECIES.berry_bush;
  const expectedBite = Math.min(sp.pick.bite, bush.attrs.body + gained / 0.5);  // back-derive? No:
  // simpler: with R=0 after correction, bite = min(sp.pick.bite, body_before) = sp.pick.bite
  // (body=4000 >> sp.pick.bite which is small). So just check gained === sp.pick.bite * 0.5.
  const expectedGained2 = sp.pick.bite * 0.5;
  assert.ok(Math.abs(gained - expectedGained2) < 1e-9,
    `gained ${gained} should be ${expectedGained2} (no phantom from negative R)`);

  // 2. prey.R must be ≥ 0 after pick (overdraft corrected, bite drawn from body only).
  assert.ok(bush.R >= 0, `prey.R should be ≥ 0 after pick, got ${bush.R}`);

  // 3. Conservation identity: Δstocks = captured − burned − decayed − transferLoss.
  // All operations happened at tick=0 so no open segment accrual. Sum manually.
  const bushNode = k.graph.nodes.get(bush.id);   // may be dead (killed by die() if body~=0)
  const corpseNode = [...k.graph.nodes.values()].find(n => n.type === 'corpse');
  const stocksAfter = (bushNode ? bushNode.R + bushNode.attrs.body : 0)
    + (corpseNode ? corpseNode.attrs.E : 0)
    + player.R;
  const t1 = k.ledger.totals;
  const lhs = stocksAfter - stocksBefore;
  const rhs = (t1.captured - t0.captured)
    - (t1.burned - t0.burned)
    - (t1.decayed - t0.decayed)
    - (t1.transferLoss - t0.transferLoss);
  assert.ok(Math.abs(lhs - rhs) < 1e-9,
    `conservation violated after pick with negative R: Δstocks=${lhs} flows=${rhs}`);
});
