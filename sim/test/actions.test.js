// sim/test/actions.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { createPlayer, pick, chop, harvest, take, eat } from '../world/actions.js';
import { SPECIES, DAY } from '../time/metabolism.js';
import { grainsForBite, compositionOf } from '../matter/composition.js';

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

// ── Task 4: grain transfer wiring ─────────────────────────────────────────────

// (a) harvest item grains proportional to bite
test('harvest item carries grains proportional to bite magnitude', () => {
  const { k, bush } = world();
  const player = createPlayer(k, 0);
  const item = harvest(k, player.id, bush.id, 0);
  assert.ok(item, 'harvest returned an item');
  assert.ok(item.grains, 'item.grains present');
  const bite = SPECIES.berry_bush.pick.bite;
  const expected = grainsForBite('berry_bush', bite);
  for (const [g, u] of Object.entries(expected)) {
    assert.ok(Math.abs(item.grains[g] - u) < 1e-9, `grain ${g}: got ${item.grains[g]} expected ${u}`);
  }
  // cellulose and sugar are both in berry_bush yield
  assert.ok(item.grains.cellulose > 0, 'item has cellulose');
  assert.ok(item.grains.sugar > 0, 'item has sugar');
});

// (b) take item grains equal compositionOf the node pre-removal
test('take item grains equal compositionOf the matter node before removal', () => {
  const k = new Kernel({ seed: 3, bounds: { x0: 0, y0: 0, w: 8, h: 8 } });
  let rock;
  k.graph.boot(() => {
    rock = k.graph.createNode({
      type: 'matter', tick: 0, x: 3, y: 3, R: null,
      attrs: { archetype: 'boulder_small', E: 1000, noFlux: true },
    });
  });
  const player = createPlayer(k, 0);
  const expectedGrains = compositionOf(rock);   // snapshot before take
  const item = take(k, player.id, rock.id, 0);
  assert.ok(item, 'take returned item');
  assert.ok(item.grains, 'item.grains present');
  assert.deepEqual(item.grains, expectedGrains);
  // rock node must be removed
  assert.equal(k.graph.nodes.has(rock.id), false);
});

// (c) pick increments grain:metabolized:* by grainsForBite amounts
test('pick increments grain:metabolized counters by grainsForBite amounts', () => {
  const { k, bush } = world();
  const player = createPlayer(k, 0);
  const bite = SPECIES.berry_bush.pick.bite;
  const expected = grainsForBite('berry_bush', bite);
  pick(k, player.id, bush.id, 0);
  for (const [g, u] of Object.entries(expected)) {
    const counterKey = 'grain:metabolized:' + g;
    assert.ok(counterKey in k.ledger.totals, `counter ${counterKey} exists`);
    assert.ok(Math.abs(k.ledger.totals[counterKey] - u) < 1e-9,
      `${counterKey}: got ${k.ledger.totals[counterKey]} expected ${u}`);
  }
});

// (d) eat moves item grains into grain:metabolized:*
test('eat moves item grains into grain:metabolized counters', () => {
  const { k } = world();
  const player = createPlayer(k, 0);
  const grains = { cellulose: 1.5, sugar: 0.9 };
  player.attrs.inventory ??= [];
  player.attrs.inventory.push({ id: 99, kind: 'harvest', E: 200, grains, tick: 0 });
  eat(k, player.id, 99, 0);
  assert.ok(Math.abs(k.ledger.totals['grain:metabolized:cellulose'] - 1.5) < 1e-9);
  assert.ok(Math.abs(k.ledger.totals['grain:metabolized:sugar'] - 0.9) < 1e-9);
});

// (e) corpse decay over sim-days increments grain:decayed:* proportional to E lost
test('corpse decay increments grain:decayed counters proportional to E lost', () => {
  const k = new Kernel({ seed: 3, bounds: { x0: 0, y0: 0, w: 8, h: 8 } });
  let corpse;
  const HALFLIFE = 7 * DAY;
  const GONE_THRESHOLD = 0.5;
  k.graph.boot(() => {
    corpse = k.graph.createNode({
      type: 'corpse', tick: 0, x: 3, y: 3, R: null, r: 0,
      attrs: { species: 'tree', E: 10000, decayHalflifeTicks: HALFLIFE },
    });
    // Schedule the decay_gone event so the scheduler can fire and materialize will be called.
    const goneTick = HALFLIFE * Math.log2(10000 / GONE_THRESHOLD);
    k.scheduler.schedule(goneTick, corpse.id, 'decay_gone', -1);
  });
  const E0 = corpse.attrs.E;
  k.runTo(7 * DAY);   // one half-life: decay_gone not yet (fires much later); force materialization
  // materialize directly to advance E and count grain:decayed
  k.materialized(corpse.id);
  const lost = E0 - corpse.attrs.E;
  assert.ok(lost > 0, 'E decreased');
  // tree species: cellulose 0.006 + lignin 0.004 per tu
  const expectedCellulose = 0.006 * lost;
  const expectedLignin = 0.004 * lost;
  assert.ok(Math.abs(k.ledger.totals['grain:decayed:cellulose'] - expectedCellulose) < 1e-6,
    `cellulose decayed: got ${k.ledger.totals['grain:decayed:cellulose']} expected ~${expectedCellulose}`);
  assert.ok(Math.abs(k.ledger.totals['grain:decayed:lignin'] - expectedLignin) < 1e-6,
    `lignin decayed: got ${k.ledger.totals['grain:decayed:lignin']} expected ~${expectedLignin}`);
});
