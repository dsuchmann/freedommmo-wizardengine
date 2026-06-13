// sim/world/crossings.js — P2.5: fords & bridges (world-compiler L10 "no road crosses
// impassable cells without crossing feature"). A group pays embodied time (nurture
// 0.95) to place a crossing matter node ON a stream tile; planRoute crosses water
// ONLY through crossing tiles (opts.crossings whitelist — routing stays pure; the
// caller derives the whitelist from the kernel via crossingsOf). Condition decays
// daily; unmaintained crossings wash away (E → 'decayed', node removed).
// Fords only on narrow channels (width ≤ FORD_MAX_WIDTH); bridges any width.
// NO suppression deltas: crossings sit on water — no baseline placement exists there.
// TODO(save/load): crossing nodes are runtime state (same rehydration backlog as
// roads/paths/settlements).
import { transfer, DAY } from '../time/metabolism.js';
import { streamAt } from '../../src/world/hydrology.js';

export const FORD_COST = 40;
export const BRIDGE_COST = 150;
export const FORD_MAX_WIDTH = 3;
export const CROSSING_CONDITION_MAX = 100;
export const CROSSING_DECAY_PER_DAY = 2;
export const MAINTAIN_COST = 5;
const DECAY_INTERVAL = DAY;

/** Return the live crossing node at tile (x,y), or undefined. */
function crossingAt(kernel, x, y) {
  for (const n of kernel.graph.nodes.values()) {
    if (n.type === 'matter' &&
        (n.attrs.archetype === 'ford' || n.attrs.archetype === 'bridge') &&
        n.x === x && n.y === y) return n;
  }
  return undefined;
}

/** Group `groupId` builds a ford or bridge on a stream tile.
 *  Refuses (null, side-effect-free) when:
 *  - group missing or not type 'group'
 *  - tile not a stream (streamAt returns null)
 *  - kind 'ford' and stream width > FORD_MAX_WIDTH
 *  - kind not 'ford' or 'bridge'
 *  - a live crossing already exists on this tile
 *  - group.R < cost
 *  Returns the matter node on success. */
export function buildCrossing(kernel, groupId, tile, kind, tick) {
  const group = kernel.graph.nodes.get(groupId);
  if (!group || group.type !== 'group') return null;
  if (kind !== 'ford' && kind !== 'bridge') return null;
  const stream = streamAt(tile.x, tile.y);
  if (!stream) return null;
  if (kind === 'ford' && stream.width > FORD_MAX_WIDTH) return null;
  if (crossingAt(kernel, tile.x, tile.y)) return null;
  const cost = kind === 'ford' ? FORD_COST : BRIDGE_COST;
  if (group.R < cost) return null;

  group.R -= cost;
  const E = transfer(cost, 'nurture', kernel.ledger);
  const evId = kernel.ledger.emit({
    tick, type: `${kind}_built`, actor: groupId, targets: [],
    attrs: { x: tile.x, y: tile.y, width: stream.width },
  });
  const node = kernel.graph.createNode({
    type: 'matter', tick, x: tile.x, y: tile.y, causeEventId: evId,
    attrs: { archetype: kind, E, condition: CROSSING_CONDITION_MAX, noFlux: true },
  });
  kernel.ledger.events[evId - 1].targets.push(node.id);
  kernel.scheduler.schedule(tick + DECAY_INTERVAL, node.id, 'crossing_decay', -1);
  return node;
}

/** Group pays MAINTAIN_COST to restore one crossing to full condition. */
export function maintainCrossing(kernel, groupId, crossingId, tick) {
  const group = kernel.graph.nodes.get(groupId);
  const node = kernel.graph.nodes.get(crossingId);
  if (!group || group.type !== 'group') return false;
  if (!node || (node.attrs?.archetype !== 'ford' && node.attrs?.archetype !== 'bridge')) return false;
  if (group.R < MAINTAIN_COST) return false;
  group.R -= MAINTAIN_COST;
  node.attrs.E += transfer(MAINTAIN_COST, 'nurture', kernel.ledger);
  node.attrs.condition = CROSSING_CONDITION_MAX;
  kernel.ledger.emit({
    tick, type: 'crossing_maintained', actor: groupId, targets: [crossingId],
    attrs: { cost: MAINTAIN_COST },
  });
  return true;
}

/** Daily decay handler. Condition 0 → embodied time returns to ambient, node removed. */
function onCrossingDecay(kernel, node, ev) {
  if (!node) return;
  node.attrs.condition = Math.max(0, node.attrs.condition - CROSSING_DECAY_PER_DAY);
  if (node.attrs.condition > 0) {
    kernel.scheduler.schedule(ev.tick + DECAY_INTERVAL, node.id, 'crossing_decay', -1);
    return;
  }
  kernel.ledger.count('decayed', node.attrs.E);
  node.attrs.E = 0;
  kernel.ledger.emit({
    tick: ev.tick, type: 'crossing_gone', targets: [node.id],
    attrs: { x: node.x, y: node.y },
  });
  kernel.graph.removeNode(node.id);
}

/** Set of 'x,y' strings for all live crossing nodes (ford or bridge). */
export function crossingsOf(kernel) {
  const out = new Set();
  for (const n of kernel.graph.nodes.values()) {
    if (n.type === 'matter' &&
        (n.attrs.archetype === 'ford' || n.attrs.archetype === 'bridge')) {
      out.add(`${n.x},${n.y}`);
    }
  }
  return out;
}

export function registerCrossings(kernel) {
  kernel.on('crossing_decay', onCrossingDecay);
}
