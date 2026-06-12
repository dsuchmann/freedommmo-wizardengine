// Player verbs (spec §3.2 intents, probe 6). The player is a time WALLET:
// no metabolism, no flux capture — body/embodiment is S4, honestly absent.
// Matter seam: every harvest event records species + magnitude so the future
// S3 Matter pass can derive grain yields from the causal ledger.
import { SPECIES, transfer } from '../time/metabolism.js';
import { die } from '../time/lifecycle.js';
import { compositionOf, grainsForBite } from '../matter/composition.js';

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
  }
  nextItemId = max + 1;
}

export function createPlayer(kernel, tick) {
  const evId = kernel.ledger.emit({ tick, type: 'player_join' });
  const player = kernel.graph.createNode({
    type: 'player', tick, x: null, y: null, R: 0, causeEventId: evId,
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
