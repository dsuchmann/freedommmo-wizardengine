// sim/test/actions.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { createPlayer, pick, chop, harvest, take, eat, strike, combine } from '../world/actions.js';
import { equip } from '../items/equipment.js';
import { auditGrains } from '../matter/audit.js';
import { SPECIES, DAY } from '../time/metabolism.js';
import { grainsForBite, compositionOf } from '../matter/composition.js';
import { OBJECT_DEFS, TERMINAL } from '../matter/objects.js';

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
// The corpse is created via the REAL path (chop -> die()) so species propagates correctly.
test('corpse decay increments grain:decayed counters proportional to E lost', () => {
  const { k, tree } = world();
  const player = createPlayer(k, 0);
  chop(k, player.id, tree.id, 0);
  const corpse = [...k.graph.nodes.values()].find(n => n.type === 'corpse');
  assert.ok(corpse, 'corpse created by chop/die');
  assert.equal(corpse.attrs.species, 'tree', 'corpse carries species from die()');

  const E0 = corpse.attrs.E;
  k.runTo(7 * DAY);   // one half-life: decay_gone not yet (fires much later); force materialization
  // materialize directly to advance E and count grain:decayed
  k.materialized(corpse.id);
  const lost = E0 - corpse.attrs.E;
  assert.ok(lost > 0, 'E decreased');

  // tree species: cellulose 0.006 + lignin 0.004 per tu — must appear; stone must NOT.
  const expectedCellulose = 0.006 * lost;
  const expectedLignin = 0.004 * lost;
  assert.ok(Math.abs(k.ledger.totals['grain:decayed:cellulose'] - expectedCellulose) < 1e-6,
    `cellulose decayed: got ${k.ledger.totals['grain:decayed:cellulose']} expected ~${expectedCellulose}`);
  assert.ok(Math.abs(k.ledger.totals['grain:decayed:lignin'] - expectedLignin) < 1e-6,
    `lignin decayed: got ${k.ledger.totals['grain:decayed:lignin']} expected ~${expectedLignin}`);
  // stone must NOT appear (default yield fall-through would produce it before the fix)
  assert.ok(!k.ledger.totals['grain:decayed:stone'],
    `stone should not appear for a tree corpse, got ${k.ledger.totals['grain:decayed:stone']}`);
});

// ── Task 2: strike verb ────────────────────────────────────────────────────────

function strikeWorld() {
  const k = new Kernel({ seed: 42, bounds: { x0: 0, y0: 0, w: 8, h: 8 } });
  let boulder, stoneNode, dustNode;
  k.graph.boot(() => {
    boulder = k.graph.createNode({
      type: 'matter', tick: 0, x: 2, y: 2, R: null,
      attrs: { archetype: 'boulder', E: 5000, noFlux: true },
    });
    stoneNode = k.graph.createNode({
      type: 'matter', tick: 0, x: 3, y: 3, R: null,
      attrs: { archetype: 'stone_dust', E: 100, noFlux: true },
    });
    dustNode = k.graph.createNode({
      type: 'matter', tick: 0, x: 4, y: 4, R: null,
      attrs: { archetype: 'totally_unknown', E: 100, noFlux: true },
    });
  });
  const player = createPlayer(k, 0);
  return { k, boulder, stoneNode, dustNode, player };
}

// (a) strike below stage boundary → stage 'cracked', damaged delta written, hp persisted
test('strike(a): strike below stage boundary → cracked, damaged delta, hp persisted', () => {
  const { k, boulder, player } = strikeWorld();
  // boulder maxHp=100; sharp resistance=0.2. To land in cracked (hp <=75 but >40):
  // need taken = 0.2 * amount; to go just below 75 from 100: need taken > 25 → amount > 125
  // Use amount=200: taken = 40; hp after = 60 → cracked
  const result = strike(k, player.id, boulder.id, 'sharp', 200, 0);
  assert.ok(result, 'strike returned result');
  assert.equal(result.stage, 'cracked');
  assert.equal(result.destroyed, false);
  assert.deepEqual(result.products, []);
  // hp persisted on node
  assert.ok(boulder.attrs.hp != null, 'hp initialized');
  assert.ok(boulder.attrs.hp < 75, 'hp below 75 → cracked');
  // damaged delta written
  const damaged = k.deltas.list.find(d => d.kind === 'damaged');
  assert.ok(damaged, 'damaged delta exists');
  assert.equal(damaged.attrs.stage, 'cracked');
});

// (b) repeated strikes to shatter → parent removed, products with Σ E == parent E, provenance
test('strike(b): shatter → parent removed, products Σ E == parent E, all in catalog', () => {
  const { k, boulder, player } = strikeWorld();
  const parentE = boulder.attrs.E;
  // Keep striking until destroyed (blunt at high amount)
  let result;
  for (let i = 0; i < 50; i++) {
    result = strike(k, player.id, boulder.id, 'blunt', 100, i);
    if (result?.destroyed) break;
  }
  assert.ok(result?.destroyed, 'boulder was destroyed');
  assert.equal(k.graph.nodes.get(boulder.id), undefined, 'parent node removed');
  assert.ok(result.products.length > 0, 'products spawned');
  // Σ E == parent E
  const sumE = result.products.reduce((s, n) => s + n.attrs.E, 0);
  assert.ok(Math.abs(sumE - parentE) < 1e-9, `Σ E ${sumE} == parent E ${parentE}`);
  // all products have catalog def or terminal
  for (const n of result.products) {
    const cls = n.attrs.archetype;
    assert.ok(OBJECT_DEFS[cls] || TERMINAL.has(cls), `product ${cls} in catalog or terminal`);
  }
  // all products carry createdByEvent
  for (const n of result.products) {
    assert.ok(n.createdByEvent != null, `product has createdByEvent`);
  }
  // all products are inert matter (noFlux)
  for (const n of result.products) {
    assert.equal(n.attrs.noFlux, true, `product ${n.attrs.archetype} has noFlux`);
  }
});

// (c) strike on terminal and unknown-def archetype returns null
test('strike(c): terminal and unknown-def archetype returns null', () => {
  const { k, stoneNode, dustNode, player } = strikeWorld();
  const r1 = strike(k, player.id, stoneNode.id, 'blunt', 50, 0);
  assert.equal(r1, null, 'terminal returns null');
  const r2 = strike(k, player.id, dustNode.id, 'blunt', 50, 0);
  assert.equal(r2, null, 'unknown-def returns null');
});

// (d) unknown damage type → zero damage, no stage change, no delta
test('strike(d): unknown damage type → zero damage, no stage change, no delta', () => {
  const { k, boulder, player } = strikeWorld();
  const result = strike(k, player.id, boulder.id, 'poison', 100, 0);
  assert.ok(result, 'result returned');
  assert.equal(result.stage, 'intact', 'still intact');
  assert.equal(result.destroyed, false);
  assert.deepEqual(result.products, []);
  const damaged = k.deltas.list.find(d => d.kind === 'damaged');
  assert.equal(damaged, undefined, 'no damaged delta');
});

// (e) determinism: same scenario twice → identical product counts and E values
test('strike(e): determinism — identical product counts and E across fresh kernels', () => {
  function runScenario(seed) {
    const k = new Kernel({ seed, bounds: { x0: 0, y0: 0, w: 8, h: 8 } });
    let boulder;
    k.graph.boot(() => {
      boulder = k.graph.createNode({
        type: 'matter', tick: 0, x: 2, y: 2, R: null,
        attrs: { archetype: 'boulder', E: 5000, noFlux: true },
      });
    });
    const player = createPlayer(k, 0);
    let result;
    for (let i = 0; i < 50; i++) {
      result = strike(k, player.id, boulder.id, 'blunt', 100, i);
      if (result?.destroyed) break;
    }
    return result.products.map(n => ({ archetype: n.attrs.archetype, E: n.attrs.E }))
      .sort((a, b) => a.archetype.localeCompare(b.archetype) || a.E - b.E);
  }
  const run1 = runScenario(42);
  const run2 = runScenario(42);
  assert.deepEqual(run1, run2, 'determinism: two runs with same seed produce identical products');
});

// ── Task 3: chop yields products (trees) ─────────────────────────────────────

// (f) chop a mature tree → corpse + ≥1 log + ≥2 branches; corpse.E + Σ product E == pre-chop E
test('chop(f): chop tree → corpse + ≥1 log + ≥2 branches; E conservation', () => {
  const { k, tree } = world();
  const player = createPlayer(k, 0);
  // Pre-chop E = body + R (what die() will compute as corpse E before products)
  // die() does: closeSegment + R correction, then E = R + body; corpse.attrs.E = E.
  // We call closeSegment at tick=0 (no accrual) so E = tree.R + tree.attrs.body.
  const preChopE = tree.R + tree.attrs.body;
  chop(k, player.id, tree.id, 0);
  // stump corpse
  const corpse = [...k.graph.nodes.values()].find(n => n.type === 'corpse');
  assert.ok(corpse, 'stump corpse exists');
  // product matter nodes
  const matterNodes = [...k.graph.nodes.values()].filter(n => n.type === 'matter' && n.attrs.noFlux);
  const logs = matterNodes.filter(n => n.attrs.archetype === 'log');
  const branches = matterNodes.filter(n => n.attrs.archetype === 'branch');
  assert.ok(logs.length >= 1, `≥1 log, got ${logs.length}`);
  assert.ok(branches.length >= 2, `≥2 branches, got ${branches.length}`);
  // conservation: corpse.E + Σ product E == preChopE
  const productSumE = matterNodes.reduce((s, n) => s + n.attrs.E, 0);
  const totalE = corpse.attrs.E + productSumE;
  assert.ok(Math.abs(totalE - preChopE) < 1e-6,
    `E conservation: corpse ${corpse.attrs.E} + products ${productSumE} = ${totalE} ≠ preChop ${preChopE}`);
  // every product matter node carries provenance
  for (const n of matterNodes) {
    assert.ok(n.createdByEvent != null, `chop product ${n.attrs.archetype} has createdByEvent`);
  }
  // existing probe-6 seam: felled delta + healDeltaId
  const felledDelta = k.deltas.list.find(d => d.kind === 'felled');
  assert.ok(felledDelta, 'felled delta still exists');
  assert.ok(corpse.attrs.healDeltaId === felledDelta.id, 'healDeltaId wired');
});

// (g) chop grass → no products, unchanged behavior
test('chop(g): chop grass → no products, unchanged behavior', () => {
  const k = new Kernel({ seed: 5, bounds: { x0: 0, y0: 0, w: 8, h: 8 } });
  let grass;
  k.graph.boot(() => {
    grass = k.addLiving({ species: 'grass', x: 1, y: 1, R: 2000, body: 1000, tick: 0, age: 50 * DAY });
  });
  const player = createPlayer(k, 0);
  chop(k, player.id, grass.id, 0);
  assert.equal(k.graph.nodes.get(grass.id), undefined, 'grass removed');
  const matterNodes = [...k.graph.nodes.values()].filter(n => n.type === 'matter' && n.attrs.noFlux);
  assert.equal(matterNodes.length, 0, 'no matter product nodes spawned for grass');
});

// ── Task 3 (M3): combine verb ──────────────────────────────────────────────────

test('combine: wood+wood → composite item, Σ E and Σ grains exact, recipe canonicalized', () => {
  const k = new Kernel({ seed: 11, bounds: { x0: 0, y0: 0, w: 8, h: 8 } });
  let log1, log2;
  k.graph.boot(() => {
    log1 = k.graph.createNode({
      type: 'matter', tick: 0, x: 1, y: 1, R: null,
      attrs: { archetype: 'log', E: 40, noFlux: true },
    });
    log2 = k.graph.createNode({
      type: 'matter', tick: 0, x: 2, y: 1, R: null,
      attrs: { archetype: 'log', E: 60, noFlux: true },
    });
  });
  const player = createPlayer(k, 0);
  const item1 = take(k, player.id, log1.id, 0);
  const item2 = take(k, player.id, log2.id, 0);
  const before = auditGrains(k);
  assert.equal(before.ok, true);
  const r = combine(k, player.id, [item1.id, item2.id], 0);
  assert.equal(r.ok, true);
  assert.equal(r.item.kind, 'composite');
  assert.equal(r.item.archetype, 'composite:cellulose+lignin');
  assert.equal(r.item.E, 100);                                   // exact, === (40 + 60)
  // grains: 0.006×100 cellulose, 0.004×100 lignin — float addition across two items,
  // so compare with a tiny epsilon (NOT deepEqual: 0.24+0.36 may not be bitwise 0.6)
  assert.ok(Math.abs(r.item.grains.cellulose - 0.6) < 1e-12);
  assert.ok(Math.abs(r.item.grains.lignin - 0.4) < 1e-12);
  assert.equal(player.attrs.inventory.length, 1);                // inputs consumed
  assert.ok(r.recipeId && k.graph.nodes.get(r.recipeId).type === 'recipe');
  assert.equal(auditGrains(k).ok, true);                         // identity untouched
  const ev = k.ledger.events.at(-1);
  assert.equal(ev.type, 'combine');
  assert.equal(ev.attrs.ok, true);
});

test('combine: stone+stone → ruined item, everything conserved, NO recipe node', () => {
  const k = new Kernel({ seed: 12, bounds: { x0: 0, y0: 0, w: 8, h: 8 } });
  let peb1, peb2;
  k.graph.boot(() => {
    peb1 = k.graph.createNode({
      type: 'matter', tick: 0, x: 1, y: 1, R: null,
      attrs: { archetype: 'pebble', E: 300, noFlux: true },
    });
    peb2 = k.graph.createNode({
      type: 'matter', tick: 0, x: 2, y: 1, R: null,
      attrs: { archetype: 'pebble', E: 500, noFlux: true },
    });
  });
  const player = createPlayer(k, 0);
  const p1 = take(k, player.id, peb1.id, 0);
  const p2 = take(k, player.id, peb2.id, 0);
  const p1E = p1.E;
  const p2E = p2.E;
  const r = combine(k, player.id, [p1.id, p2.id], 0);
  assert.equal(r.ok, false);
  assert.equal(r.item.kind, 'ruined');
  assert.equal(r.item.archetype, 'ruined_mash');
  assert.equal(r.item.E, p1E + p2E);
  assert.equal(r.recipeId, null);
  assert.equal([...k.graph.nodes.values()].filter(n => n.type === 'recipe').length, 0);
  assert.equal(auditGrains(k).ok, true);
  // ruined items are still matter: eating one metabolizes its grains and audit still holds
  eat(k, player.id, r.item.id, 1);
  assert.equal(auditGrains(k).ok, true);
});

test('combine: validation — needs ≥2 distinct ids all present in THIS player inventory', () => {
  const k = new Kernel({ seed: 13, bounds: { x0: 0, y0: 0, w: 8, h: 8 } });
  let log1, log2;
  k.graph.boot(() => {
    log1 = k.graph.createNode({
      type: 'matter', tick: 0, x: 1, y: 1, R: null,
      attrs: { archetype: 'log', E: 50, noFlux: true },
    });
    log2 = k.graph.createNode({
      type: 'matter', tick: 0, x: 2, y: 1, R: null,
      attrs: { archetype: 'log', E: 50, noFlux: true },
    });
  });
  const player = createPlayer(k, 0);
  const item1 = take(k, player.id, log1.id, 0);
  const item2 = take(k, player.id, log2.id, 0);
  const invLenBefore = player.attrs.inventory.length;
  assert.equal(combine(k, player.id, [item1.id], 0), null);            // too few
  assert.equal(combine(k, player.id, [item1.id, item1.id], 0), null);  // duplicate id
  assert.equal(combine(k, player.id, [item1.id, 99999], 0), null);     // missing item
  assert.equal(player.attrs.inventory.length, invLenBefore, 'failed validation must not consume items');
});

test('combine: repeat success reuses the canonical recipe node (no duplicates)', () => {
  const k = new Kernel({ seed: 14, bounds: { x0: 0, y0: 0, w: 8, h: 8 } });
  let l1, l2, l3, l4;
  k.graph.boot(() => {
    l1 = k.graph.createNode({ type: 'matter', tick: 0, x: 1, y: 1, R: null, attrs: { archetype: 'log', E: 10, noFlux: true } });
    l2 = k.graph.createNode({ type: 'matter', tick: 0, x: 2, y: 1, R: null, attrs: { archetype: 'log', E: 10, noFlux: true } });
    l3 = k.graph.createNode({ type: 'matter', tick: 0, x: 3, y: 1, R: null, attrs: { archetype: 'log', E: 10, noFlux: true } });
    l4 = k.graph.createNode({ type: 'matter', tick: 0, x: 4, y: 1, R: null, attrs: { archetype: 'log', E: 10, noFlux: true } });
  });
  const player = createPlayer(k, 0);
  const w1 = take(k, player.id, l1.id, 0);
  const w2 = take(k, player.id, l2.id, 0);
  const w3 = take(k, player.id, l3.id, 0);
  const w4 = take(k, player.id, l4.id, 0);
  const r1 = combine(k, player.id, [w1.id, w2.id], 0);
  const r2 = combine(k, player.id, [w3.id, w4.id], 1);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(r2.recipeId, r1.recipeId, 'same signature → same canonical node');
  assert.equal([...k.graph.nodes.values()].filter(n => n.type === 'recipe').length, 1);
  assert.deepEqual(k.graph.nodes.get(r1.recipeId).attrs.knownBy, [player.id], 'no duplicate knower');
  assert.equal(player.attrs.inventory.filter(it => it.kind === 'composite').length, 2);
});

// ── M5 Task 3: tool-modulated chop + wear ─────────────────────────────────────

/** A wooden composite tool: cellulose:lignin 108:72 (unit-weighted hardness=0.42, stability → maxHp=62). */
function woodTool() {
  return { id: 901, kind: 'composite', archetype: 'composite:cellulose+lignin',
           E: 100, grains: { cellulose: 108, lignin: 72 }, tick: 0 };
}

/** Boot a world with one tree (mirrors world() but returns just k+tree, no bush for clarity). */
function treeWorld() {
  const k = new Kernel({ seed: 3, bounds: { x0: 0, y0: 0, w: 8, h: 8 } });
  let tree;
  k.graph.boot(() => {
    tree = k.addLiving({ species: 'tree', x: 5, y: 5, R: 20000, body: 30000, tick: 0, age: 400 * DAY });
  });
  return { k, tree };
}

/** Boot a world with two trees at distinct positions. */
function twoTreeWorld() {
  const k = new Kernel({ seed: 3, bounds: { x0: 0, y0: 0, w: 8, h: 8 } });
  let tree1, tree2;
  k.graph.boot(() => {
    tree1 = k.addLiving({ species: 'tree', x: 2, y: 2, R: 20000, body: 30000, tick: 0, age: 400 * DAY });
    tree2 = k.addLiving({ species: 'tree', x: 5, y: 5, R: 20000, body: 30000, tick: 0, age: 400 * DAY });
  });
  return { k, tree1, tree2 };
}

test('M5 chop: wielded wooden composite recovers more product E than bare hands (deterministic)', () => {
  const run = withTool => {
    const { k, tree } = treeWorld();
    const p = createPlayer(k, 0);
    if (withTool) {
      p.attrs.inventory = [woodTool()];
      equip(k, p.id, 901, 'hand_main', 0);
    }
    // Snapshot matter nodes that existed BEFORE chop (none in this world — treeWorld has no matter nodes)
    const preChopMatterIds = new Set(
      [...k.graph.nodes.values()].filter(n => n.type === 'matter' && n.attrs.noFlux).map(n => n.id)
    );
    chop(k, p.id, tree.id, 0);
    const products = [...k.graph.nodes.values()].filter(n => n.type === 'matter' && n.attrs.noFlux && !preChopMatterIds.has(n.id));
    const corpse = [...k.graph.nodes.values()].find(n => n.type === 'corpse');
    return { productE: products.reduce((s, n) => s + n.attrs.E, 0),
             corpseE: corpse.attrs.E,
             total: products.reduce((s, n) => s + n.attrs.E, 0) + corpse.attrs.E };
  };
  const bare = run(false);
  const tooled = run(true);
  assert.ok(tooled.productE > bare.productE, 'tool recovers more product E than bare hands');
  assert.ok(Math.abs(tooled.total - bare.total) < 1e-6,
    `corpse+products E is conserved: tooled=${tooled.total} bare=${bare.total}`);
  // factor for this tool is exactly 1 + toolPower = 1 + 0.42 = 1.42
  assert.ok(Math.abs(tooled.productE - bare.productE * 1.42) < 1e-6,
    `factor is exactly 1.42: tooled=${tooled.productE} bare×1.42=${bare.productE * 1.42}`);
});

test('M5 wear: tool hp decrements per assisted chop; shattered tool gives factor 1 and no wear', () => {
  // Run A: equip tool, chop tree1 (wear), force hp=0, chop tree2 (shattered → factor 1).
  const { k, tree1, tree2 } = twoTreeWorld();
  const p = createPlayer(k, 0);
  const tool = woodTool();
  p.attrs.inventory = [tool];
  equip(k, p.id, 901, 'hand_main', 0);

  // Chop tree1 with the wooden tool to trigger lazy-init and wear.
  chop(k, p.id, tree1.id, 0);
  const worn = p.attrs.equipment.hand_main;
  assert.ok(Math.abs(worn.maxHp - 62) < 1e-9, `maxHp lazy-init: got ${worn.maxHp} expected 62`);
  assert.ok(Math.abs(worn.hp - 52) < 1e-9, `hp after one use: got ${worn.hp} expected 52 (62 − 10)`);

  // Force tool to shattered state (stageFor(0, 62) = 'shattered').
  worn.hp = 0;

  // Chop tree2 with the shattered tool — record product E for tree2.
  const preChop2Ids = new Set(
    [...k.graph.nodes.values()].filter(n => n.type === 'matter' && n.attrs.noFlux).map(n => n.id)
  );
  chop(k, p.id, tree2.id, 0);
  const products2 = [...k.graph.nodes.values()].filter(n => n.type === 'matter' && n.attrs.noFlux && !preChop2Ids.has(n.id));
  const shatteredProductE = products2.reduce((s, n) => s + n.attrs.E, 0);
  // No further wear when shattered.
  assert.ok(Math.abs(worn.hp - 0) < 1e-9, `shattered tool hp stays 0: got ${worn.hp}`);

  // Run B (reference, bit-identical event history): same two-tree world, same equip call (to match
  // event ids), but tool is pre-shattered before any chop so ALL chops use factor 1 (bare hands).
  const { k: kB, tree1: tB1, tree2: tB2 } = twoTreeWorld();
  const pB = createPlayer(kB, 0);
  const toolB = woodTool();
  pB.attrs.inventory = [toolB];
  equip(kB, pB.id, 901, 'hand_main', 0);  // same event emitted → event IDs match run A
  // pre-shatter before touching any tree: hp=0, maxHp set to match lazy-init value
  pB.attrs.equipment.hand_main.maxHp = 62;
  pB.attrs.equipment.hand_main.hp = 0;
  chop(kB, pB.id, tB1.id, 0);   // factor 1 (shattered), same causeEventId as run A
  const preChop2IdsB = new Set(
    [...kB.graph.nodes.values()].filter(n => n.type === 'matter' && n.attrs.noFlux).map(n => n.id)
  );
  chop(kB, pB.id, tB2.id, 0);
  const products2B = [...kB.graph.nodes.values()].filter(n => n.type === 'matter' && n.attrs.noFlux && !preChop2IdsB.has(n.id));
  const bareProductE = products2B.reduce((s, n) => s + n.attrs.E, 0);

  // Shattered tool → factor 1 → product E matches bare-hands exactly (bit-identical).
  assert.ok(Math.abs(shatteredProductE - bareProductE) < 1e-6,
    `shattered tool gives factor 1: got=${shatteredProductE} bare=${bareProductE}`);
});

test('M5 chop bare-hands regression: identical to pre-M5 behavior (factor exactly 1)', () => {
  // Mirrors existing chop(f) test: no equipment → products and conservation identical.
  const { k, tree } = treeWorld();
  const player = createPlayer(k, 0);
  const preChopE = tree.R + tree.attrs.body;
  chop(k, player.id, tree.id, 0);
  const corpse = [...k.graph.nodes.values()].find(n => n.type === 'corpse');
  assert.ok(corpse, 'stump corpse exists');
  const matterNodes = [...k.graph.nodes.values()].filter(n => n.type === 'matter' && n.attrs.noFlux);
  const logs = matterNodes.filter(n => n.attrs.archetype === 'log');
  const branches = matterNodes.filter(n => n.attrs.archetype === 'branch');
  assert.ok(logs.length >= 1, `≥1 log, got ${logs.length}`);
  assert.ok(branches.length >= 2, `≥2 branches, got ${branches.length}`);
  const productSumE = matterNodes.reduce((s, n) => s + n.attrs.E, 0);
  const totalE = corpse.attrs.E + productSumE;
  assert.ok(Math.abs(totalE - preChopE) < 1e-6,
    `E conservation (bare hands): corpse ${corpse.attrs.E} + products ${productSumE} = ${totalE} ≠ preChop ${preChopE}`);
  for (const n of matterNodes) {
    assert.ok(n.createdByEvent != null, `chop product ${n.attrs.archetype} has createdByEvent`);
  }
});
