// sim/test/probe-objects.test.js — M2 probe: closed object transformation graph
// Scenario: boulder strike until terminal, tree chop/take, auditGrains identity holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { createPlayer, strike, chop, take } from '../world/actions.js';
import { OBJECT_DEFS, TERMINAL, defOf } from '../matter/objects.js';
import { auditGrains } from '../matter/audit.js';
import { DAY } from '../time/metabolism.js';

function makeKernel(seed = 42) {
  return new Kernel({ seed, bounds: { x0: 0, y0: 0, w: 16, h: 16 } });
}

/** Boot a kernel with boulder (E=5000, archetype='boulder_small') + a living tree. */
function bootWorld(seed = 42) {
  const k = makeKernel(seed);
  let boulder, tree;
  k.graph.boot(() => {
    boulder = k.graph.createNode({
      type: 'matter', tick: 0, x: 4, y: 4, R: null,
      attrs: { archetype: 'boulder_small', E: 5000, noFlux: true },
    });
    tree = k.addLiving({
      species: 'tree', x: 8, y: 8, R: 20000, body: 30000, tick: 0, age: 400 * DAY,
    });
  });
  const player = createPlayer(k, 0);
  return { k, boulder, tree, player };
}

// ── Step 1: Strike boulder until cracked ─────────────────────────────────────
test('probe M2 step 1: strike boulder → cracked delta written', () => {
  const { k, boulder, player } = bootWorld();
  // boulder_small resolves to boulder def: maxHp=100, sharp resist=0.2
  // Need hp <= 75 (cracked). From 100: need taken > 25 → amount=200 → taken=40, hp=60 → cracked
  const result = strike(k, player.id, boulder.id, 'sharp', 200, 0);
  assert.ok(result, 'strike returned a result');
  assert.equal(result.stage, 'cracked', 'stage is cracked');
  assert.equal(result.destroyed, false);
  const damaged = k.deltas.list.find(d => d.kind === 'damaged');
  assert.ok(damaged, 'damaged delta written');
  assert.equal(damaged.attrs.stage, 'cracked');
});

// ── Step 2: Continue to shatter — E conservation + catalog membership ─────────
test('probe M2 step 2: blunt to shatter — parent gone, Σ E == 5000, products in catalog', () => {
  const { k, boulder, player } = bootWorld();
  const parentE = boulder.attrs.E;
  let result;
  for (let i = 0; i < 100; i++) {
    result = strike(k, player.id, boulder.id, 'blunt', 100, i);
    if (result?.destroyed) break;
  }
  assert.ok(result?.destroyed, 'boulder shattered');
  assert.equal(k.graph.nodes.get(boulder.id), undefined, 'parent node removed');
  assert.ok(result.products.length > 0, 'products spawned');
  // Exact E conservation
  const sumE = result.products.reduce((s, n) => s + n.attrs.E, 0);
  assert.equal(sumE, parentE, `Σ product E (${sumE}) === parent E (${parentE})`);
  // All products in catalog or terminal
  for (const n of result.products) {
    const cls = n.attrs.archetype;
    assert.ok(OBJECT_DEFS[cls] || TERMINAL.has(cls), `product archetype '${cls}' in catalog or terminal`);
  }
});

// ── Step 3: Closure walk — strike products until only terminals remain ─────────
test('probe M2 step 3: closure walk terminates < 200 strikes, Σ terminal E == 5000', () => {
  const { k, boulder, player } = bootWorld();
  const totalE = boulder.attrs.E;  // 5000

  // Shatter the boulder first
  for (let i = 0; i < 100; i++) {
    const r = strike(k, player.id, boulder.id, 'blunt', 100, i);
    if (r?.destroyed) break;
  }

  // Closure walk: repeatedly strike the largest non-terminal matter node
  let strikes = 0;
  const MAX_STRIKES = 200;
  while (strikes < MAX_STRIKES) {
    const nonTerminals = [...k.graph.nodes.values()]
      .filter(n => n.type === 'matter' && !TERMINAL.has(n.attrs.archetype) && defOf(n.attrs.archetype)?.maxHp);
    if (nonTerminals.length === 0) break;
    // Pick the largest non-terminal to ensure progress
    nonTerminals.sort((a, b) => b.attrs.E - a.attrs.E);
    const target = nonTerminals[0];
    strike(k, player.id, target.id, 'blunt', 1000, strikes + 1000);
    strikes++;
  }

  assert.ok(strikes < MAX_STRIKES, `closure walk terminated in ${strikes} strikes (< ${MAX_STRIKES})`);

  // Only terminal nodes remain
  const remaining = [...k.graph.nodes.values()].filter(n => n.type === 'matter');
  for (const n of remaining) {
    assert.ok(TERMINAL.has(n.attrs.archetype), `remaining node archetype '${n.attrs.archetype}' is terminal`);
  }

  // Σ terminal E == 5000 (exact)
  const terminalSumE = remaining.reduce((s, n) => s + n.attrs.E, 0);
  assert.equal(terminalSumE, totalE, `Σ terminal E (${terminalSumE}) === original E (${totalE})`);
});

// ── Step 4: Chop tree → products + stump; take log → auditGrains ok ──────────
test('probe M2 step 4: chop tree + take log → auditGrains ok', () => {
  const { k, tree, player } = bootWorld();
  // Chop the living tree
  chop(k, player.id, tree.id, 0);
  const corpse = [...k.graph.nodes.values()].find(n => n.type === 'corpse');
  assert.ok(corpse, 'stump corpse created');
  // Find a log product
  const logNode = [...k.graph.nodes.values()].find(n => n.type === 'matter' && n.attrs.archetype === 'log');
  assert.ok(logNode, 'log product spawned');
  // Take the log into inventory
  const item = take(k, player.id, logNode.id, 0);
  assert.ok(item, 'take returned item');
  assert.equal(item.archetype, 'log');
  assert.ok(k.graph.nodes.get(logNode.id) === undefined, 'log node removed');
  // Grain conservation identity still holds
  const audit = auditGrains(k);
  assert.ok(audit.ok === true,
    `auditGrains ok should be true; perGrain=${JSON.stringify(audit.perGrain, null, 2)}`);
});

// ── Step 5: Determinism ───────────────────────────────────────────────────────
test('probe M2 step 5: determinism — two identical seeds yield bit-identical results', () => {
  function runFullScenario(seed) {
    const { k, boulder, tree, player } = bootWorld(seed);
    const boulderE = boulder.attrs.E;

    // Shatter boulder + closure walk
    for (let i = 0; i < 100; i++) {
      const r = strike(k, player.id, boulder.id, 'blunt', 100, i);
      if (r?.destroyed) break;
    }
    let strikes = 0;
    while (strikes < 200) {
      const nonTerminals = [...k.graph.nodes.values()]
        .filter(n => n.type === 'matter' && !TERMINAL.has(n.attrs.archetype) && defOf(n.attrs.archetype)?.maxHp);
      if (nonTerminals.length === 0) break;
      nonTerminals.sort((a, b) => b.attrs.E - a.attrs.E);
      strike(k, player.id, nonTerminals[0].id, 'blunt', 1000, strikes + 1000);
      strikes++;
    }

    // Collect terminal state
    const terminals = [...k.graph.nodes.values()]
      .filter(n => n.type === 'matter')
      .map(n => ({ archetype: n.attrs.archetype, E: n.attrs.E }))
      .sort((a, b) => a.archetype.localeCompare(b.archetype) || a.E - b.E);

    // Chop tree + take log
    chop(k, player.id, tree.id, 1);
    const logNode = [...k.graph.nodes.values()].find(n => n.type === 'matter' && n.attrs.archetype === 'log');
    if (logNode) take(k, player.id, logNode.id, 1);

    const audit = auditGrains(k);
    return { terminals, audit };
  }

  const run1 = runFullScenario(42);
  const run2 = runFullScenario(42);
  assert.deepEqual(run1.terminals, run2.terminals, 'terminal (archetype, E) pairs are bit-identical');
  assert.deepEqual(run1.audit, run2.audit, 'audits are bit-identical');
});
