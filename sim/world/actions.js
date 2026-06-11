// Player verbs (spec §3.2 intents, probe 6). The player is a time WALLET:
// no metabolism, no flux capture — body/embodiment is S4, honestly absent.
// Matter seam: every harvest event records species + magnitude so the future
// S3 Matter pass can derive grain yields from the causal ledger.
import { SPECIES, transfer } from '../time/metabolism.js';
import { die } from '../time/lifecycle.js';

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
  kernel.closeSegment(prey, tick);
  const bite = Math.min(sp.pick.bite, prey.attrs.body + Math.max(prey.R, 0));
  if (bite <= 0) return 0;
  const fromBody = Math.min(bite, prey.attrs.body);
  prey.attrs.body -= fromBody;
  prey.R -= (bite - fromBody);
  const gained = transfer(bite, 'harvest', kernel.ledger);
  player.R += gained;
  const evId = kernel.ledger.emit({
    tick, type: 'pick', actor: playerId, targets: [targetId], magnitude: bite,
    attrs: { species: prey.attrs.species },
  });
  if (prey.attrs.body + Math.max(prey.R, 0) <= 1e-9) die(kernel, prey, tick, evId);
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
