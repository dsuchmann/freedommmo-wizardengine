// sim/test/probe-recipes.test.js — M3 probe: the headless experimenter
// Scenario: boot kernel with tree + pebbles; create player; chop + take products;
// systematically combine all distinct unordered pairs; assert discovery + conservation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { createPlayer, chop, take, combine } from '../world/actions.js';
import { auditGrains } from '../matter/audit.js';
import { knowsRecipe, teachRecipe } from '../matter/recipes.js';
import { DAY } from '../time/metabolism.js';

function makeKernel(seed = 99) {
  return new Kernel({ seed, bounds: { x0: 0, y0: 0, w: 16, h: 16 } });
}

/** Boot kernel with a mature tree + several pebble matter nodes. */
function bootWorld(seed = 99) {
  const k = makeKernel(seed);
  let tree, peb1, peb2, peb3;
  k.graph.boot(() => {
    tree = k.addLiving({
      species: 'tree', x: 4, y: 4, R: 20000, body: 30000, tick: 0, age: 400 * DAY,
    });
    peb1 = k.graph.createNode({
      type: 'matter', tick: 0, x: 6, y: 6, R: null,
      attrs: { archetype: 'pebble', E: 200, noFlux: true },
    });
    peb2 = k.graph.createNode({
      type: 'matter', tick: 0, x: 7, y: 6, R: null,
      attrs: { archetype: 'pebble', E: 200, noFlux: true },
    });
    peb3 = k.graph.createNode({
      type: 'matter', tick: 0, x: 8, y: 6, R: null,
      attrs: { archetype: 'pebble', E: 200, noFlux: true },
    });
  });
  const player = createPlayer(k, 0);
  return { k, tree, peb1, peb2, peb3, player };
}

/** Run the full experimenter scenario; return attempt records + recipe attrs + audit. */
function runScenario(seed = 99) {
  const { k, tree, peb1, peb2, peb3, player } = bootWorld(seed);

  // Step 1: chop tree → corpse + products; take all matter products + pebbles into inventory
  chop(k, player.id, tree.id, 0);
  const chopProducts = [...k.graph.nodes.values()]
    .filter(n => n.type === 'matter' && n.attrs.noFlux);
  for (const node of chopProducts) {
    take(k, player.id, node.id, 0);
  }
  // Take pebbles (only those still in graph — take removes them)
  for (const pebNode of [peb1, peb2, peb3]) {
    if (k.graph.nodes.has(pebNode.id)) take(k, player.id, pebNode.id, 0);
  }

  const inventory = player.attrs.inventory;

  // Track total E that entered inventory (snapshot after all takes)
  const totalEIn = inventory.reduce((s, it) => s + it.E, 0);

  // Step 2: systematically attempt all distinct unordered pairs
  const attempts = [];
  let tick = 1;
  // We'll work on a fresh copy of the inventory each iteration since combine mutates it
  // Loop until no pairs with ≥2 items of distinct kind remain (simple greedy: group by archetype class)
  // Actually, simpler: attempt all pairs from a snapshot of ids taken at step-start
  // We need to rebuild pairs from whatever is in inventory at each step.
  // Strategy: group items by archetype signature class; pick one from each group; pair across groups.
  // Simplest: snapshot initial ids, try each unordered pair once.
  const initialIds = inventory.map(it => it.id);
  for (let i = 0; i < initialIds.length; i++) {
    for (let j = i + 1; j < initialIds.length; j++) {
      const id1 = initialIds[i], id2 = initialIds[j];
      // Check if both still in inventory
      const it1 = inventory.find(it => it.id === id1);
      const it2 = inventory.find(it => it.id === id2);
      if (!it1 || !it2) continue;
      const r = combine(k, player.id, [id1, id2], tick++);
      if (r) {
        attempts.push({ signature: k.ledger.events.at(-1).attrs.signature, ok: r.ok, form: r.item.archetype });
      }
    }
  }

  // Audit
  const audit = auditGrains(k);
  const totalEAfter = player.attrs.inventory.reduce((s, it) => s + it.E, 0);

  // Sorted recipe node attrs (knowledge private — just signature+form)
  const recipeAttrs = [...k.graph.nodes.values()]
    .filter(n => n.type === 'recipe')
    .map(n => ({ signature: n.attrs.signature, form: n.attrs.form }))
    .sort((a, b) => a.signature.localeCompare(b.signature));

  return { k, player, attempts, audit, recipeAttrs, totalEIn, totalEAfter, tick };
}

// ── Step 2: at least one success and one failure ───────────────────────────────
test('probe M3 step 2: ≥1 success (log pair → composite) and ≥1 failure (pebble pair → ruined)', () => {
  const { attempts } = runScenario();
  assert.ok(attempts.length >= 3, `experimenter must exercise ≥3 pairs, got ${attempts.length}`);
  const successes = attempts.filter(a => a.ok);
  const failures = attempts.filter(a => !a.ok);
  assert.ok(successes.length >= 1,
    `expected ≥1 success; attempts: ${JSON.stringify(attempts)}`);
  assert.ok(failures.length >= 1,
    `expected ≥1 failure; attempts: ${JSON.stringify(attempts)}`);
  // wood pair succeeds
  const woodSuccess = successes.find(a => a.form === 'composite:cellulose+lignin');
  assert.ok(woodSuccess, `wood+wood should yield composite:cellulose+lignin; successes=${JSON.stringify(successes)}`);
  // pebble pair fails
  const pebbleFailure = failures.find(a => a.form === 'ruined_mash');
  assert.ok(pebbleFailure, `pebble+pebble should yield ruined_mash; failures=${JSON.stringify(failures)}`);
});

// ── Step 3: exactly ONE recipe node per successful signature ───────────────────
test('probe M3 step 3: exactly ONE recipe node per successful signature, with provenance + knownBy', () => {
  const { k, player, attempts } = runScenario();
  const successfulSigs = new Set(attempts.filter(a => a.ok).map(a => a.signature));
  const recipeNodes = [...k.graph.nodes.values()].filter(n => n.type === 'recipe');
  assert.equal(recipeNodes.length, successfulSigs.size,
    `recipe node count (${recipeNodes.length}) must equal distinct successful signatures (${successfulSigs.size})`);
  for (const node of recipeNodes) {
    assert.ok(successfulSigs.has(node.attrs.signature), `recipe node signature ${node.attrs.signature} is a successful sig`);
    // provenance: causeEventId or createdByEvent set
    const hasProvenance = node.causeEventId != null || node.createdByEvent != null;
    assert.ok(hasProvenance, `recipe node ${node.id} must have event provenance`);
    // knownBy contains player
    assert.ok(node.attrs.knownBy.includes(player.id), `recipe ${node.attrs.signature} knownBy includes player`);
  }
});

// ── Step 4: conservation — auditGrains ok + Σ inventory E exact ───────────────
test('probe M3 step 4: auditGrains ok after all attempts; Σ inventory E exactly conserved', () => {
  const { audit, totalEIn, totalEAfter } = runScenario();
  assert.equal(audit.ok, true,
    `auditGrains must be ok; perGrain=${JSON.stringify(audit.perGrain)}`);
  assert.equal(totalEAfter, totalEIn,
    `Σ inventory E must be conserved: before=${totalEIn} after=${totalEAfter}`);
});

// ── Step 5: teach recipe ───────────────────────────────────────────────────────
test('probe M3 step 5: teachRecipe transfers knowledge; teach event in ledger; second player can learn', () => {
  const { k, player, attempts } = runScenario();
  const successfulAttempt = attempts.find(a => a.ok);
  assert.ok(successfulAttempt, 'need a successful attempt to teach');
  const sig = successfulAttempt.signature;

  const player2 = createPlayer(k, 100);
  assert.equal(knowsRecipe(k, player2.id, sig), false, 'p2 does not know recipe yet');

  // Non-knower cannot teach
  const p3 = createPlayer(k, 101);
  assert.equal(teachRecipe(k, p3.id, player2.id, sig, 101), false, 'non-knower cannot teach');

  // Teacher (player) can teach player2
  const result = teachRecipe(k, player.id, player2.id, sig, 102);
  assert.equal(result, true, 'teach succeeded');
  assert.equal(knowsRecipe(k, player2.id, sig), true, 'p2 now knows recipe');

  // teach event in ledger
  const teachEv = k.ledger.events.findLast(e => e.type === 'teach');
  assert.ok(teachEv, 'teach event emitted');
  assert.equal(teachEv.actor, player.id);
  assert.deepEqual(teachEv.targets, [player2.id]);
  assert.equal(teachEv.attrs.signature, sig);
});

// ── Step 6: determinism ────────────────────────────────────────────────────────
test('probe M3 step 6: determinism — two identical seeds produce bit-identical results', () => {
  const run1 = runScenario(99);
  const run2 = runScenario(99);
  assert.deepEqual(run1.attempts, run2.attempts, 'attempt records are bit-identical');
  assert.deepEqual(run1.recipeAttrs, run2.recipeAttrs, 'recipe node attrs are bit-identical');
  assert.deepEqual(run1.audit, run2.audit, 'audits are bit-identical');
  assert.equal(run1.totalEIn, run2.totalEIn, 'totalEIn identical');
  assert.equal(run1.totalEAfter, run2.totalEAfter, 'totalEAfter identical');
});
