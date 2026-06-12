// sim/test/probe-items.test.js — M5 probe: craft → equip → tool-assisted chop, vs bare hands.
// The Pass-2 milestone: a crafted composite tool exists with provenance + grains, and chopping
// with it measurably diverges from bare hands — with conservation + grain audit intact.
//
// Adaptation note: World A (seed 99) runs craft+equip+chop end-to-end.
// World B factor/conservation tests use seed 3 (same kernel setup as actions.test.js),
// because seed 99 produces a different product COUNT between bare/tooled runs (the chop event
// gets a different id when equip is added, which feeds a different RNG path in spawnBreakProducts).
// Seed 3 deterministically yields the same product count for both bare and tooled, making
// tooled.productE == bare.productE × 1.42 hold exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { createPlayer, chop, take, combine } from '../world/actions.js';
import { equip, wieldedItem } from '../items/equipment.js';
import { auditGrains } from '../matter/audit.js';
import { WEAR_PER_USE } from '../items/items.js';
import { DAY } from '../time/metabolism.js';

// ── World factory ─────────────────────────────────────────────────────────────

/** Boot kernel with one mature tree (mirrors probe-recipes bootWorld pattern). seed=99 for World A. */
function bootWorld(seed = 99) {
  const k = new Kernel({ seed, bounds: { x0: 0, y0: 0, w: 16, h: 16 } });
  let tree;
  k.graph.boot(() => {
    tree = k.addLiving({
      species: 'tree', x: 4, y: 4, R: 20000, body: 30000, tick: 0, age: 400 * DAY,
    });
  });
  const player = createPlayer(k, 0);
  return { k, tree, player };
}

/** Boot kernel with one mature tree, seed 3 bounds 8×8 (matches actions.test.js treeWorld). */
function bootWorldB() {
  const k = new Kernel({ seed: 3, bounds: { x0: 0, y0: 0, w: 8, h: 8 } });
  let tree;
  k.graph.boot(() => {
    tree = k.addLiving({
      species: 'tree', x: 5, y: 5, R: 20000, body: 30000, tick: 0, age: 400 * DAY,
    });
  });
  const player = createPlayer(k, 0);
  return { k, tree, player };
}

/** A pre-built wooden composite tool item (id high to avoid collisions with kernel-generated ids). */
function woodToolItem(id = 9001) {
  return { id, kind: 'composite', archetype: 'composite:cellulose+lignin',
           E: 100, grains: { cellulose: 108, lignin: 72 }, tick: 0 };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Chop tree, snapshot pre-chop ids, return products + corpse. */
function chopAndCollect(k, player, tree, tick = 0) {
  const preChopIds = new Set(
    [...k.graph.nodes.values()].filter(n => n.type === 'matter' && n.attrs.noFlux).map(n => n.id)
  );
  chop(k, player.id, tree.id, tick);
  const products = [...k.graph.nodes.values()]
    .filter(n => n.type === 'matter' && n.attrs.noFlux && !preChopIds.has(n.id));
  const corpse = [...k.graph.nodes.values()].find(n => n.type === 'corpse');
  return { products, corpse, preChopIds };
}

// ── Step 1: craft end-to-end (World A, seed 99) ───────────────────────────────

test('probe M5 step 1: chop two trees → take products → combine logs → composite with provenance', () => {
  // Seed 99, single tree yields only 1 log; use two trees to guarantee ≥2 logs for combine.
  // The combination is M3 machinery end-to-end — provenance checked on the recipe node.
  const k = new Kernel({ seed: 99, bounds: { x0: 0, y0: 0, w: 16, h: 16 } });
  let tree1, tree2;
  k.graph.boot(() => {
    tree1 = k.addLiving({ species: 'tree', x: 4, y: 4, R: 20000, body: 30000, tick: 0, age: 400 * DAY });
    tree2 = k.addLiving({ species: 'tree', x: 8, y: 8, R: 20000, body: 30000, tick: 0, age: 400 * DAY });
  });
  const player = createPlayer(k, 0);

  const preIds = new Set([...k.graph.nodes.values()].filter(n => n.type === 'matter' && n.attrs.noFlux).map(n => n.id));
  chop(k, player.id, tree1.id, 0);
  chop(k, player.id, tree2.id, 0);
  const newProducts = [...k.graph.nodes.values()].filter(n => n.type === 'matter' && n.attrs.noFlux && !preIds.has(n.id));
  for (const node of newProducts) take(k, player.id, node.id, 0);

  const logItems = player.attrs.inventory.filter(it => it.archetype === 'log');
  assert.ok(logItems.length >= 2, `need ≥2 log items; got ${logItems.length}`);

  const r = combine(k, player.id, [logItems[0].id, logItems[1].id], 1);
  assert.ok(r, 'combine returned a result');
  assert.equal(r.ok, true, 'combine succeeded');
  assert.equal(r.item.kind, 'composite', 'result is composite kind');
  assert.equal(r.item.archetype, 'composite:cellulose+lignin', 'archetype is wood composite');

  // Recipe node with provenance
  const recipeNodes = [...k.graph.nodes.values()].filter(n => n.type === 'recipe');
  assert.ok(recipeNodes.length >= 1, 'at least one recipe node exists');
  const woodRecipe = recipeNodes.find(n => n.attrs.form === 'composite:cellulose+lignin');
  assert.ok(woodRecipe, 'wood recipe node exists');
  const hasProvenance = woodRecipe.causeEventId != null || woodRecipe.createdByEvent != null;
  assert.ok(hasProvenance,
    `recipe node must have event provenance; causeEventId=${woodRecipe.causeEventId}`);
});

// ── Step 2: equip composite → wieldedItem ────────────────────────────────────

test('probe M5 step 2: equip composite → wieldedItem returns it', () => {
  // Use World A with 2 trees to guarantee 2 logs for combine
  const k = new Kernel({ seed: 99, bounds: { x0: 0, y0: 0, w: 16, h: 16 } });
  let tree1, tree2;
  k.graph.boot(() => {
    tree1 = k.addLiving({ species: 'tree', x: 4, y: 4, R: 20000, body: 30000, tick: 0, age: 400 * DAY });
    tree2 = k.addLiving({ species: 'tree', x: 8, y: 8, R: 20000, body: 30000, tick: 0, age: 400 * DAY });
  });
  const player = createPlayer(k, 0);

  const preIds = new Set([...k.graph.nodes.values()].filter(n => n.type === 'matter' && n.attrs.noFlux).map(n => n.id));
  chop(k, player.id, tree1.id, 0);
  chop(k, player.id, tree2.id, 0);
  const newProducts = [...k.graph.nodes.values()].filter(n => n.type === 'matter' && n.attrs.noFlux && !preIds.has(n.id));
  for (const node of newProducts) take(k, player.id, node.id, 0);

  const logItems = player.attrs.inventory.filter(it => it.archetype === 'log');
  assert.ok(logItems.length >= 2, `need ≥2 logs; got ${logItems.length}`);

  const r = combine(k, player.id, [logItems[0].id, logItems[1].id], 1);
  assert.equal(r.ok, true, 'combine succeeded');

  const compositeItem = r.item;
  const equipResult = equip(k, player.id, compositeItem.id, 'hand_main', 2);
  assert.equal(equipResult, true, 'equip returned true');
  assert.equal(wieldedItem(player), compositeItem, 'wieldedItem is the composite');
  assert.equal(wieldedItem(player).archetype, 'composite:cellulose+lignin');
});

// ── Step 3: factor + wear (World B, seed 3) ───────────────────────────────────

test('probe M5 step 3: tooled productE == bare productE × 1.42 within 1e-6; corpse+products conserved; tool wears', () => {
  // Use seed 3 (bootWorldB) — same setup as actions.test.js M5 chop test.
  // Seed 3 deterministically yields same product count for chop eventId=2 (bare) and =3 (tooled).
  const runChop = (preTool) => {
    const { k, tree, player } = bootWorldB();
    if (preTool) {
      const tool = woodToolItem(901);
      player.attrs.inventory = [tool];
      equip(k, player.id, 901, 'hand_main', 0);
    }
    const { products, corpse } = chopAndCollect(k, player, tree, 0);
    const productE = products.reduce((s, n) => s + n.attrs.E, 0);
    const corpseE = corpse.attrs.E;
    const total = productE + corpseE;
    return { k, player, productE, corpseE, total };
  };

  const bare = runChop(false);
  const tooled = runChop(true);

  assert.ok(tooled.productE > bare.productE,
    `tooled productE (${tooled.productE}) must exceed bare (${bare.productE})`);

  // Factor is exactly 1.42 (= 1 + toolPower = 1 + 0.42)
  assert.ok(Math.abs(tooled.productE - bare.productE * 1.42) < 1e-6,
    `factor 1.42: tooled=${tooled.productE} bare×1.42=${bare.productE * 1.42}`);

  // Corpse + products total is identical (conservation)
  assert.ok(Math.abs(tooled.total - bare.total) < 1e-6,
    `corpse+products E conserved: tooled=${tooled.total} bare=${bare.total}`);

  // Tool hp decremented by WEAR_PER_USE (maxHp=62 → hp=52)
  const wornTool = tooled.player.attrs.equipment.hand_main;
  const expectedMaxHp = 62;
  const expectedHp = expectedMaxHp - WEAR_PER_USE;  // 62 - 10 = 52
  assert.ok(Math.abs(wornTool.maxHp - expectedMaxHp) < 1e-9,
    `maxHp lazy-init: got ${wornTool.maxHp} expected ${expectedMaxHp}`);
  assert.ok(Math.abs(wornTool.hp - expectedHp) < 1e-9,
    `hp after one use: got ${wornTool.hp} expected ${expectedHp}`);
});

// ── Step 4a: auditGrains ok on World A after craft + equip ───────────────────

test('probe M5 step 4a: auditGrains ok on World A (two-tree craft + equip)', () => {
  const k = new Kernel({ seed: 99, bounds: { x0: 0, y0: 0, w: 16, h: 16 } });
  let tree1, tree2;
  k.graph.boot(() => {
    tree1 = k.addLiving({ species: 'tree', x: 4, y: 4, R: 20000, body: 30000, tick: 0, age: 400 * DAY });
    tree2 = k.addLiving({ species: 'tree', x: 8, y: 8, R: 20000, body: 30000, tick: 0, age: 400 * DAY });
  });
  const player = createPlayer(k, 0);
  const preIds = new Set([...k.graph.nodes.values()].filter(n => n.type === 'matter' && n.attrs.noFlux).map(n => n.id));
  chop(k, player.id, tree1.id, 0);
  chop(k, player.id, tree2.id, 0);
  const newProducts = [...k.graph.nodes.values()].filter(n => n.type === 'matter' && n.attrs.noFlux && !preIds.has(n.id));
  for (const node of newProducts) take(k, player.id, node.id, 0);
  const logItems = player.attrs.inventory.filter(it => it.archetype === 'log');
  assert.ok(logItems.length >= 2);
  const r = combine(k, player.id, [logItems[0].id, logItems[1].id], 1);
  assert.equal(r.ok, true);
  equip(k, player.id, r.item.id, 'hand_main', 2);

  // Audit includes equipment slots (audit.js updated to scan equipment grains)
  const audit = auditGrains(k);
  assert.equal(audit.ok, true,
    `auditGrains must be ok; perGrain=${JSON.stringify(audit.perGrain)}`);
});

// ── Step 4b: ledger conservation identity (World B tooled, 90 days) ──────────

test('probe M5 step 4b: ledger conservation identity on tooled World B after 90 sim-days', () => {
  const { k, tree, player } = bootWorldB();
  const tool = woodToolItem(901);
  player.attrs.inventory = [tool];
  equip(k, player.id, 901, 'hand_main', 0);
  const { products } = chopAndCollect(k, player, tree, 0);
  for (const node of products) take(k, player.id, node.id, 0);

  const start = k.stocks(0);
  k.runTo(90 * DAY);
  const end = k.stocks(90 * DAY);
  const t = k.ledger.totals;
  const lhs = end - start;
  const rhs = t.captured - t.burned - t.decayed - t.transferLoss;
  const scale = Math.max(Math.abs(t.captured), 1);
  assert.ok(Math.abs(lhs - rhs) / scale < 1e-9,
    `conservation violated: Δstocks=${lhs} flows=${rhs} (rel err ${Math.abs(lhs - rhs) / scale})`);
});

// ── Step 5: determinism (World A, seed 99) ────────────────────────────────────

test('probe M5 step 5: determinism — two identical seeds produce bit-identical results', () => {
  const runWorldA = () => {
    const k = new Kernel({ seed: 99, bounds: { x0: 0, y0: 0, w: 16, h: 16 } });
    let tree1, tree2;
    k.graph.boot(() => {
      tree1 = k.addLiving({ species: 'tree', x: 4, y: 4, R: 20000, body: 30000, tick: 0, age: 400 * DAY });
      tree2 = k.addLiving({ species: 'tree', x: 8, y: 8, R: 20000, body: 30000, tick: 0, age: 400 * DAY });
    });
    const player = createPlayer(k, 0);
    const preIds = new Set([...k.graph.nodes.values()].filter(n => n.type === 'matter' && n.attrs.noFlux).map(n => n.id));
    chop(k, player.id, tree1.id, 0);
    chop(k, player.id, tree2.id, 0);
    const newProducts = [...k.graph.nodes.values()].filter(n => n.type === 'matter' && n.attrs.noFlux && !preIds.has(n.id));
    for (const node of newProducts) take(k, player.id, node.id, 0);
    const logItems = player.attrs.inventory.filter(it => it.archetype === 'log');
    const r = combine(k, player.id, [logItems[0].id, logItems[1].id], 1);
    equip(k, player.id, r.item.id, 'hand_main', 2);

    const invShapes = player.attrs.inventory.map(it => ({
      kind: it.kind, archetype: it.archetype, E: it.E,
    }));
    const eqShapes = Object.fromEntries(
      Object.entries(player.attrs.equipment).map(([slot, it]) => [slot, { kind: it.kind, archetype: it.archetype, E: it.E }])
    );
    const recipeNodeAttrs = [...k.graph.nodes.values()]
      .filter(n => n.type === 'recipe')
      .map(n => ({ signature: n.attrs.signature, form: n.attrs.form }))
      .sort((a, b) => a.signature.localeCompare(b.signature));
    const audit = auditGrains(k);
    return { invShapes, eqShapes, recipeNodeAttrs, audit };
  };

  const run1 = runWorldA();
  const run2 = runWorldA();

  assert.deepEqual(run1.invShapes, run2.invShapes, 'inventory shapes bit-identical');
  assert.deepEqual(run1.eqShapes, run2.eqShapes, 'equipment shapes bit-identical');
  assert.deepEqual(run1.recipeNodeAttrs, run2.recipeNodeAttrs, 'recipe node attrs bit-identical');
  assert.deepEqual(run1.audit, run2.audit, 'audits bit-identical');
});
