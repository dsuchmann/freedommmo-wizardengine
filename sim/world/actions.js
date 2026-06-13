// Player verbs (spec §3.2 intents, probe 6). The player is a time WALLET:
// no metabolism, no flux capture — body/embodiment is S4, honestly absent.
// Matter seam: every harvest event records species + magnitude so the future
// S3 Matter pass can derive grain yields from the causal ledger.
import { SPECIES, transfer } from '../time/metabolism.js';
import { recordTraffic } from './paths.js';
import { die } from '../time/lifecycle.js';
import { compositionOf, grainsForBite } from '../matter/composition.js';
import { defOf, stageFor, damageTaken, OBJECT_DEFS } from '../matter/objects.js';
import { randRange } from '../kernel/rng.js';
import { combineOutcome, signatureOf } from '../matter/interaction.js';
import { canonicalizeRecipe } from '../matter/recipes.js';
import { toolPowerOf, maxHpOf, WEAR_PER_USE } from '../items/items.js';
import { wieldedItem } from '../items/equipment.js';
import { buildingStampAt } from './buildings.js';

// Item id counter. Module-level; starts at 1 for fresh kernels.
// After loadKernel, call initItemIdFromKernel(kernel) to avoid collisions.
let nextItemId = 1;

/** Derive nextItemId from all inventory items already in the graph (call after loadKernel). */
export function initItemIdFromKernel(kernel) {
  let max = 0;
  for (const n of kernel.graph.nodes.values()) {
    for (const item of (n.attrs?.inventory ?? [])) {
      if (item.id > max) max = item.id;
    }
    for (const item of Object.values(n.attrs?.equipment ?? {})) {
      if (item.id > max) max = item.id;
    }
  }
  nextItemId = max + 1;
}

export function createPlayer(kernel, tick, pos = null) {
  const evId = kernel.ledger.emit({ tick, type: 'player_join' });
  const player = kernel.graph.createNode({
    type: 'player', tick, x: pos?.x ?? null, y: pos?.y ?? null, R: 0, causeEventId: evId,
    attrs: { body: 0, cap: 0, burn: 0, noFlux: true },
  });
  kernel.ledger.events[evId - 1].targets.push(player.id);
  return player;
}

/** Harvest a bite from a pickable plant into the player's wallet. Returns tu gained (0 if invalid). */
export function pick(kernel, playerId, targetId, tick) {
  const player = kernel.graph.nodes.get(playerId);
  const prey = kernel.graph.nodes.get(targetId);
  if (!player || !prey || prey.R == null) return 0;
  const sp = SPECIES[prey.attrs.species];
  if (!sp?.pick) return 0;
  prey.attrs.pinned = true;   // named in a player ledger event → pinned individual (spec §4.3)
  kernel.closeSegment(prey, tick);
  // Correct any scheduler-ceil overdraft before computing bite (prevents phantom time minting).
  if (prey.R < 0) {
    kernel.ledger.count('burned', prey.R);   // prey.R is negative — decrements burned
    prey.R = 0;
  }
  const bite = Math.min(sp.pick.bite, prey.attrs.body + prey.R);
  if (bite <= 0) return 0;
  const fromBody = Math.min(bite, prey.attrs.body);
  prey.attrs.body -= fromBody;
  prey.R -= (bite - fromBody);
  const gained = transfer(bite, 'harvest', kernel.ledger);
  player.R += gained;
  for (const [g, u] of Object.entries(grainsForBite(prey.attrs.species, bite)))
    kernel.ledger.count('grain:metabolized:' + g, u);
  const evId = kernel.ledger.emit({
    tick, type: 'pick', actor: playerId, targets: [targetId], magnitude: bite,
    attrs: { species: prey.attrs.species },
  });
  if (prey.attrs.body + prey.R <= 1e-9) die(kernel, prey, tick, evId);
  else kernel.reRateTileOf(targetId, tick);
  return gained;
}

/** Fell a living plant: causal death + felled delta that heals when the stump decays. */
export function chop(kernel, playerId, targetId, tick) {
  const target = kernel.graph.nodes.get(targetId);
  if (!target || target.R == null) return false;
  const { x, y } = target;
  const species = target.attrs.species;
  const evId = kernel.ledger.emit({
    tick, type: 'chop', actor: playerId, targets: [targetId],
    attrs: { species },
  });
  const corpse = die(kernel, target, tick, evId);
  if (corpse) {
    const deltaId = kernel.deltas.push({ tick, x, y, target: `node:${targetId}`, kind: 'felled', attrs: { species } });
    corpse.attrs.healDeltaId = deltaId;
    // If this species has onChop products (e.g. tree → logs + branches),
    // spawn them from corpse E and subtract their E from the stump corpse.
    const onChop = OBJECT_DEFS[species]?.onChop;
    if (onChop) {
      // Tool modulation (M5): recovery scales with the wielded item's derived hardness.
      // Bare hands → factor exactly 1 (pre-M5 behavior). Shattered tools assist nothing.
      const player = kernel.graph.nodes.get(playerId);
      const tool = wieldedItem(player);
      let factor = 1;
      if (tool) {
        if (tool.maxHp == null) { tool.maxHp = maxHpOf(tool); tool.hp = tool.maxHp; }
        const broken = tool.maxHp <= 0 || stageFor(tool.hp, tool.maxHp) === 'shattered';
        if (!broken) {
          factor = 1 + toolPowerOf(tool);
          // cap: expanded products must leave the corpse a remainder (Σ eFrac×factor ≤ 0.9)
          const maxSum = onChop.reduce((s, row) => s + row.count[1] * row.eFrac, 0);
          if (maxSum * factor > 0.9) factor = 0.9 / maxSum;
          tool.hp = Math.max(0, tool.hp - WEAR_PER_USE);   // wear: hp is not E, no ledger
        }
      }
      const table = factor === 1 ? onChop
        : onChop.map(row => ({ ...row, eFrac: row.eFrac * factor }));
      const products = spawnBreakProducts(kernel, corpse, table, evId, tick, corpse.attrs.E, false);
      const productSumE = products.reduce((s, n) => s + n.attrs.E, 0);
      corpse.attrs.E -= productSumE;
    }
  }
  return true;
}

/** Harvest a bite from a living plant into player inventory as embodied time (lossy: harvest channel).
 *  Mirrors pick's closeSegment + overdraft logic exactly to avoid conservation drift. */
export function harvest(kernel, playerId, targetId, tick) {
  const player = kernel.graph.nodes.get(playerId);
  const prey = kernel.graph.nodes.get(targetId);
  if (!player || !prey || prey.R == null) return null;
  const sp = SPECIES[prey.attrs.species];
  if (!sp?.pick) return null;
  prey.attrs.pinned = true;   // named in a player ledger event → pinned individual (spec §4.3)
  kernel.closeSegment(prey, tick);
  // Correct any scheduler-ceil overdraft before computing bite (prevents phantom time minting).
  if (prey.R < 0) {
    kernel.ledger.count('burned', prey.R);   // prey.R is negative — decrements burned
    prey.R = 0;
  }
  const bite = Math.min(sp.pick.bite, prey.attrs.body + prey.R);
  if (bite <= 0) return null;
  const fromBody = Math.min(bite, prey.attrs.body);
  prey.attrs.body -= fromBody;
  prey.R -= (bite - fromBody);
  const delivered = transfer(bite, 'harvest', kernel.ledger);
  const grains = grainsForBite(prey.attrs.species, bite);
  const item = { id: nextItemId++, kind: 'harvest', species: prey.attrs.species ?? null,
                 archetype: prey.attrs.archetype ?? null, E: delivered, grains, tick };
  (player.attrs.inventory ??= []).push(item);
  const harvestEvId = kernel.ledger.emit({
    tick, type: 'harvest', actor: playerId, targets: [targetId], magnitude: bite,
    attrs: { species: prey.attrs.species ?? null },
  });
  if (prey.attrs.body + prey.R <= 1e-9) die(kernel, prey, tick, harvestEvId);
  else kernel.reRateTileOf(targetId, tick);
  return item;
}

/** Take a whole matter node (F3) into inventory losslessly; writes a placement delta so
 *  the object stays gone across re-boots. Matter nodes have no metabolism (noFlux). */
export function take(kernel, playerId, targetId, tick) {
  const player = kernel.graph.nodes.get(playerId);
  const node = kernel.graph.nodes.get(targetId);
  if (!player || !node || node.type !== 'matter') return null;
  const grains = compositionOf(node);   // snapshot BEFORE removeNode
  const evId = kernel.ledger.emit({
    tick, type: 'take', actor: playerId, targets: [targetId], magnitude: node.attrs.E,
    attrs: { archetype: node.attrs.archetype ?? null },
  });
  if (node.attrs.placement) {
    kernel.deltas.push({ tick, x: node.x, y: node.y,
                         target: 'placement:' + node.attrs.placement,
                         kind: 'taken', attrs: { archetype: node.attrs.archetype ?? null } });
  }
  const item = { id: nextItemId++, kind: 'matter', archetype: node.attrs.archetype ?? null,
                 E: node.attrs.E, grains, tick };
  (player.attrs.inventory ??= []).push(item);
  kernel.graph.removeNode(targetId);
  return item;
}

/**
 * Module-private: spawn break products from a parent matter node (or corpse).
 * Counts resolved via kernel seeded RNG keyed to (causeEventId, productIndex) — deterministic.
 * Location: module-private in actions.js (design choice recorded per M2 plan).
 *
 * Two modes controlled by `remainderToLast`:
 *   true  (breakProducts) — all-but-last get eFrac * parentE; last gets parentE − Σ others (exact partition).
 *   false (onChop)        — every product gets exactly eFrac * parentE; caller keeps the remainder.
 *
 * @param {object}  kernel
 * @param {object}  parent            — must have .x, .y
 * @param {Array}   table             — [{class, count:[lo,hi], eFrac}]
 * @param {number}  causeEventId
 * @param {number}  tick
 * @param {number}  parentE           — E to partition
 * @param {boolean} remainderToLast   — true for breakProducts, false for onChop
 * @returns {Array} created matter nodes
 */
function spawnBreakProducts(kernel, parent, table, causeEventId, tick, parentE, remainderToLast) {
  const { x, y } = parent;
  // Expand table rows, resolving count ranges via RNG.
  const expanded = [];  // { cls, eFrac }
  for (let pi = 0; pi < table.length; pi++) {
    const p = table[pi];
    const [lo, hi] = p.count;
    const count = lo === hi ? lo : Math.floor(randRange(kernel.seed, causeEventId, pi, lo, hi + 1));
    for (let ci = 0; ci < count; ci++) {
      expanded.push({ cls: p.class, eFrac: p.eFrac });
    }
  }
  if (expanded.length === 0) return [];

  const assigned = [];
  let sumAssigned = 0;

  if (remainderToLast) {
    // breakProducts mode: all-but-last get eFrac * parentE; last gets remainder.
    for (let i = 0; i < expanded.length - 1; i++) {
      const e = expanded[i].eFrac * parentE;
      if (e <= 1e-9) continue;
      assigned.push({ cls: expanded[i].cls, E: e });
      sumAssigned += e;
    }
    const remainder = parentE - sumAssigned;
    const lastIdx = expanded.length - 1;
    if (remainder > 1e-9) {
      assigned.push({ cls: expanded[lastIdx].cls, E: remainder });
    } else if (assigned.length > 0) {
      // remainder ≤ 0: fold into previous
      assigned[assigned.length - 1].E += remainder;
    }
  } else {
    // onChop mode: every product gets exactly eFrac * parentE; stump keeps the rest.
    for (const row of expanded) {
      const e = row.eFrac * parentE;
      if (e <= 1e-9) continue;
      assigned.push({ cls: row.cls, E: e });
      sumAssigned += e;
    }
    // (caller subtracts sumAssigned from corpse.attrs.E)
  }

  // Create matter nodes
  const nodes = [];
  for (const a of assigned) {
    const node = kernel.graph.createNode({
      type: 'matter', tick, x, y,
      causeEventId,
      attrs: { archetype: a.cls, E: a.E, noFlux: true },
    });
    nodes.push(node);
  }
  return nodes;
}

/** Strike a matter node with typed damage. Stage changes write a 'damaged' delta;
 *  shatter partitions E into break products (closed graph) and removes the parent. */
export function strike(kernel, playerId, targetId, damageType, amount, tick) {
  const node = kernel.graph.nodes.get(targetId);
  if (!node || node.type !== 'matter') return null;
  const def = defOf(node.attrs.archetype);
  if (!def?.maxHp) return null;                       // terminal or undamageable: honest no-op
  if (node.attrs.hp == null) node.attrs.hp = def.maxHp;   // lazy init
  const before = stageFor(node.attrs.hp, def.maxHp);
  const taken = damageTaken(def, damageType, amount);
  if (taken <= 0) return { stage: before, destroyed: false, products: [] };
  node.attrs.hp = Math.max(0, node.attrs.hp - taken);
  const after = stageFor(node.attrs.hp, def.maxHp);
  const evId = kernel.ledger.emit({
    tick, type: 'strike', actor: playerId, targets: [targetId], magnitude: taken,
    attrs: { archetype: node.attrs.archetype ?? null, damageType, stage: after },
  });
  if (after === before && after !== 'shattered') return { stage: after, destroyed: false, products: [] };
  if (after !== 'shattered') {
    // stage changed: persistent visual delta (renderer binds when damage sprites exist — W1)
    kernel.deltas.push({ tick, x: node.x, y: node.y,
      target: node.attrs.placement ? 'placement:' + node.attrs.placement : `node:${targetId}`,
      kind: 'damaged', attrs: { stage: after, archetype: node.attrs.archetype ?? null } });
    return { stage: after, destroyed: false, products: [] };
  }
  // SHATTER: spawn products partitioning E exactly, then remove parent.
  const products = spawnBreakProducts(kernel, node, def.breakProducts, evId, tick, node.attrs.E, true);
  if (node.attrs.placement) {
    kernel.deltas.push({ tick, x: node.x, y: node.y, target: 'placement:' + node.attrs.placement,
      kind: 'destroyed', attrs: { archetype: node.attrs.archetype ?? null } });
  }
  kernel.graph.removeNode(targetId);
  return { stage: 'shattered', destroyed: true, products };
}

/** Combine ≥2 inventory items: outcome derived from grain math ALONE (no recipe lookup —
 *  physics always works; recipe nodes are knowledge, not permission). Conservation by
 *  construction: output item carries Σ E and merged grains whether it succeeds or ruins.
 *  First success per signature canonicalizes a recipe node (provenance = this event). */
export function combine(kernel, playerId, itemIds, tick) {
  const player = kernel.graph.nodes.get(playerId);
  const inv = player?.attrs.inventory ?? [];
  if (!Array.isArray(itemIds) || itemIds.length < 2) return null;
  if (new Set(itemIds).size !== itemIds.length) return null;
  const picked = itemIds.map(id => inv.find(it => it.id === id));
  if (picked.some(it => !it)) return null;            // all-or-nothing: validate before consuming
  const signature = signatureOf(picked);
  const out = combineOutcome(picked.map(it => it.grains ?? {}));
  const E = picked.reduce((s, it) => s + it.E, 0);
  for (const id of itemIds) inv.splice(inv.findIndex(it => it.id === id), 1);
  const evId = kernel.ledger.emit({
    tick, type: 'combine', actor: playerId, targets: [], magnitude: E,
    attrs: { signature, form: out.form, ok: out.ok },
  });
  const recipeId = out.ok ? canonicalizeRecipe(kernel, signature, out.form, playerId, evId, tick) : null;
  const item = { id: nextItemId++, kind: out.ok ? 'composite' : 'ruined',
                 archetype: out.form, E, grains: out.merged, tick };
  inv.push(item);
  return { ok: out.ok, item, recipeId };
}

/** One-tile step for a positioned actor. Refuses (false) when the actor is missing,
 *  unpositioned, or the step is not exactly one tile (Chebyshev 1).
 *  Position is spatial state, not embodiment (S4 honestly absent): zero time cost in P1 —
 *  movement metabolism is the Time Metabolism's job in a later pass, declared, not faked. */
export function move(kernel, actorId, dx, dy, tick) {
  const actor = kernel.graph.nodes.get(actorId);
  if (!actor || actor.x == null || actor.y == null) return false;
  if (!Number.isInteger(dx) || !Number.isInteger(dy)) return false;
  if (Math.max(Math.abs(dx), Math.abs(dy)) !== 1) return false;
  const toX = actor.x + dx, toY = actor.y + dy;
  // Walls are impassable claims (P4): a non-walkable building stamp refuses the step.
  const stamp = buildingStampAt(kernel, toX, toY);
  if (stamp && !stamp.walkable) return false;
  const evId = kernel.ledger.emit({
    tick, type: 'move', actor: actorId, targets: [],
    attrs: { fromX: actor.x, fromY: actor.y, toX, toY },
  });
  actor.x = toX; actor.y = toY;
  recordTraffic(kernel, toX, toY, evId, tick);
  return true;
}

/** Domesticate an adjacent tameable animal by investing R through the nurture channel.
 *  L4 (atlas S4 fauna row): the edge is the system — herding/loyalty/upkeep are honest
 *  absences. Refuses (false): missing nodes, not fauna/tameable, offer < species minOffer,
 *  not adjacent (Chebyshev 1), player can't pay, or already domesticated. */
export function tame(kernel, playerId, targetId, offer, tick) {
  const player = kernel.graph.nodes.get(playerId);
  const animal = kernel.graph.nodes.get(targetId);
  if (!player || !animal || animal.R == null) return false;
  const sp = SPECIES[animal.attrs.species];
  const tameSpec = sp?.instinct?.tame;
  if (!tameSpec || offer < tameSpec.minOffer || player.R < offer) return false;
  if (Math.max(Math.abs(player.x - animal.x), Math.abs(player.y - animal.y)) > 1) return false;
  for (const eid of kernel.graph.byNode.get(targetId) ?? []) {
    if (kernel.graph.edges.get(eid)?.type === 'domestic') return false;   // one owner
  }
  kernel.closeSegment(animal, tick);
  animal.attrs.pinned = true;            // named in a player ledger event (spec §4.3)
  player.R -= offer;
  const delivered = transfer(offer, 'nurture', kernel.ledger);
  animal.R += delivered;
  kernel.graph.createEdge({ type: 'domestic', tick, members: [[playerId, 'owner'], [targetId, 'animal']] });
  kernel.ledger.emit({ tick, type: 'tame', actor: playerId, targets: [targetId], magnitude: offer });
  kernel.reRateTileOf(targetId, tick);
  return true;
}

/** Eat an inventory item: converts its E to player R through the harvest transfer channel (lossy). */
export function eat(kernel, playerId, itemId, tick) {
  const player = kernel.graph.nodes.get(playerId);
  const inv = player?.attrs.inventory ?? [];
  const i = inv.findIndex(it => it.id === itemId);
  if (i < 0) return 0;
  const [item] = inv.splice(i, 1);
  const gained = transfer(item.E, 'harvest', kernel.ledger);
  player.R += gained;
  if (item.grains) {
    for (const [g, u] of Object.entries(item.grains))
      kernel.ledger.count('grain:metabolized:' + g, u);
  }
  kernel.ledger.emit({ tick, type: 'eat', actor: playerId, targets: [], magnitude: item.E });
  return gained;
}
