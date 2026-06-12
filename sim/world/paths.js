// sim/world/paths.js — P1: worn paths. Traffic wears tiles; wear tramples flora
// (causal death through the conserved corpse pipeline — NEVER raw node deletion)
// and suppresses baseline placements via 'worn' deltas; wear fades daily and
// healed deltas let the baseline regrow (ghost paths). Wear is not time (M2/M5
// hp precedent): zero ledger terms. Pure consumption of claims/deltas/scheduler.
import { tilePlacements } from './baseline.js';
import { SPECIES, DAY } from '../time/metabolism.js';
import { die } from '../time/lifecycle.js';

export const WEAR_PER_STEP = 1;
export const WORN_THRESHOLD = 20;   // steps needed to wear a path bare
export const FADE_PER_DAY = 2;      // untrafficked wear lost per day
export const WEAR_MAX = 100;        // bounded state
export const FADE_INTERVAL = DAY;

/** The path node on tile (x,y), or undefined. O(nodes) — fine at probe scale; index at P4. */
export function pathAt(kernel, x, y) {
  for (const n of kernel.graph.nodes.values()) {
    if (n.type === 'path' && n.x === x && n.y === y) return n;
  }
  return undefined;
}

/** Record one traffic step on (x,y), caused by ledger event `evId` (a 'move').
 *  Lazily creates the tile's path node; adds wear; tramples + suppresses when
 *  the threshold is crossed (idempotent: only on the crossing). */
export function recordTraffic(kernel, x, y, evId, tick) {
  let path = pathAt(kernel, x, y);
  const isNew = !path;
  if (isNew) {
    path = kernel.graph.createNode({
      type: 'path', tick, x, y, R: null, causeEventId: evId,
      attrs: { wear: 0, suppressDeltaIds: [], noFlux: true },
    });
    kernel.scheduler.schedule(tick + FADE_INTERVAL, path.id, 'path_fade', -1);
  }
  const before = path.attrs.wear;
  path.attrs.wear = Math.min(WEAR_MAX, before + WEAR_PER_STEP);
  if (!isNew && before === 0) {
    // fade handler stopped rescheduling at wear 0 — re-arm
    kernel.scheduler.schedule(tick + FADE_INTERVAL, path.id, 'path_fade', -1);
  }
  if (before < WORN_THRESHOLD && path.attrs.wear >= WORN_THRESHOLD) {
    wearBare(kernel, path, evId, tick);
  }
  return path;
}

/** Threshold crossing: trample tramplable living flora (conserved causal death)
 *  and suppress this tile's baseline placements until the path heals. */
function wearBare(kernel, path, evId, tick) {
  const { x, y } = path;
  // 1. trample living flora on the tile (flux occupants are living non-players)
  for (const occId of [...kernel.flux.occupantsOf(x, y)]) {
    const occ = kernel.graph.nodes.get(occId);
    if (!occ || !SPECIES[occ.attrs?.species]?.tramplable) continue;
    const tEv = kernel.ledger.emit({
      tick, type: 'trample', actor: null, targets: [occId],
      attrs: { species: occ.attrs.species, x, y, causeEventId: evId },
    });
    die(kernel, occ, tick, tEv);   // corpse decays through existing machinery — conserved
  }
  // 2. suppress baseline placements (re-materialization stops until healed)
  for (const p of tilePlacements(x, y)) {
    const id = kernel.deltas.push({
      tick, x, y, target: `placement:${p.key}`, kind: 'worn', attrs: { pathNode: path.id },
    });
    path.attrs.suppressDeltaIds.push(id);
  }
}

/** Daily fade. When wear drops below threshold, heal all suppression deltas. */
function onPathFade(kernel, node, ev) {
  if (!node) return;
  node.attrs.wear = Math.max(0, node.attrs.wear - FADE_PER_DAY);
  if (node.attrs.wear < WORN_THRESHOLD && node.attrs.suppressDeltaIds.length > 0) {
    for (const id of node.attrs.suppressDeltaIds) {
      kernel.deltas.remove(id);
      kernel.ledger.emit({
        tick: ev.tick, type: 'path_healed', actor: null, targets: [node.id],
        attrs: { deltaId: id, x: node.x, y: node.y },
      });
    }
    node.attrs.suppressDeltaIds = [];
  }
  if (node.attrs.wear > 0) {
    kernel.scheduler.schedule(ev.tick + FADE_INTERVAL, node.id, 'path_fade', -1);
  }
  // wear 0: stop rescheduling — recordTraffic re-arms on next traffic.
}

export function registerPaths(kernel) {
  kernel.on('path_fade', onPathFade);
}
