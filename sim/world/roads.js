// sim/world/roads.js — P2: deliberate roads. A group spends pooled time (R) through
// the nurture channel into road_segment matter nodes along a deterministic least-cost
// route. Roads suppress baseline flora ('paved' deltas — P1 'worn' precedent), carry
// traffic without path wear, decay daily when unmaintained (condition is bounded
// non-time state, hp precedent), and return their embodied time to ambient
// ('decayed' counter — decay_gone precedent) when gone; suppression heals, flora
// regrows. Labor-only construction: road_segment has an EMPTY grain yield — no
// conjured stone (material-consuming construction is declared backlog).
// TODO(save/load): road nodes are runtime state — paved deltas persist but the road
// matter nodes do not; rehydrate on load or the deltas can never heal (P1 precedent).
import { planRoute } from './routing.js';
import { tilePlacements } from './baseline.js';
import { transfer, DAY } from '../time/metabolism.js';

export const ROAD_E_PER_TILE = 30;       // tu of group R per tile laid
export const ROAD_CONDITION_MAX = 100;   // bounded state
export const ROAD_DECAY_PER_DAY = 2;     // unmaintained road lasts 50 days
export const MAINTAIN_COST = 5;          // tu to restore a segment to full condition
export const DECAY_INTERVAL = DAY;

/** The road segment on tile (x,y), or undefined. O(nodes) — index when traffic scales. */
export function roadAt(kernel, x, y) {
  for (const n of kernel.graph.nodes.values()) {
    if (n.type === 'matter' && n.attrs.archetype === 'road_segment' && n.x === x && n.y === y) return n;
  }
  return undefined;
}

/** Group `groupId` builds a road from→to along the least-cost route. Refuses (false,
 *  side-effect-free) when the group is missing/underfunded or no land route exists.
 *  Cost = ROAD_E_PER_TILE × tiles WITHOUT an existing segment (idempotent overlap). */
export function buildRoad(kernel, groupId, from, to, tick, opts = {}) {
  const group = kernel.graph.nodes.get(groupId);
  if (!group || group.type !== 'group') return false;
  const route = planRoute(from, to, null, opts);
  if (!route) return false;
  const newTiles = route.filter(t => !roadAt(kernel, t.x, t.y));
  if (newTiles.length === 0) return false;          // nothing to build
  const cost = newTiles.length * ROAD_E_PER_TILE;
  if (group.R < cost) return false;
  const evId = kernel.ledger.emit({
    tick, type: 'road_built', actor: groupId, targets: [],
    attrs: { fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, tiles: newTiles.length, cost },
  });
  for (const t of newTiles) {
    group.R -= ROAD_E_PER_TILE;
    const delivered = transfer(ROAD_E_PER_TILE, 'nurture', kernel.ledger);
    const seg = kernel.graph.createNode({
      type: 'matter', tick, x: t.x, y: t.y, causeEventId: evId,
      attrs: {
        archetype: 'road_segment', E: delivered,
        condition: ROAD_CONDITION_MAX, suppressDeltaIds: [], noFlux: true,
      },
    });
    kernel.ledger.events[evId - 1].targets.push(seg.id);
    for (const p of tilePlacements(t.x, t.y)) {
      const id = kernel.deltas.push({
        tick, x: t.x, y: t.y, target: `placement:${p.key}`, kind: 'paved', attrs: { road: seg.id },
      });
      seg.attrs.suppressDeltaIds.push(id);
    }
    kernel.scheduler.schedule(tick + DECAY_INTERVAL, seg.id, 'road_decay', -1);
  }
  return true;
}

/** Group pays MAINTAIN_COST to restore one segment to full condition. */
export function maintainRoad(kernel, groupId, segId, tick) {
  const group = kernel.graph.nodes.get(groupId);
  const seg = kernel.graph.nodes.get(segId);
  if (!group || group.type !== 'group' || !seg || seg.attrs?.archetype !== 'road_segment') return false;
  if (group.R < MAINTAIN_COST) return false;
  kernel.ledger.emit({
    tick, type: 'road_maintained', actor: groupId, targets: [segId], attrs: { cost: MAINTAIN_COST },
  });
  group.R -= MAINTAIN_COST;
  seg.attrs.E += transfer(MAINTAIN_COST, 'nurture', kernel.ledger);
  seg.attrs.condition = ROAD_CONDITION_MAX;
  return true;
}

/** Daily decay. Condition 0 → embodied time returns to ambient, suppression heals, node removed. */
function onRoadDecay(kernel, node, ev) {
  if (!node) return;
  node.attrs.condition = Math.max(0, node.attrs.condition - ROAD_DECAY_PER_DAY);
  if (node.attrs.condition > 0) {
    kernel.scheduler.schedule(ev.tick + DECAY_INTERVAL, node.id, 'road_decay', -1);
    return;
  }
  kernel.ledger.count('decayed', node.attrs.E);          // decay_gone precedent
  node.attrs.E = 0;
  for (const id of node.attrs.suppressDeltaIds) kernel.deltas.remove(id);
  node.attrs.suppressDeltaIds = [];
  kernel.ledger.emit({
    tick: ev.tick, type: 'road_gone', targets: [node.id],
    attrs: { x: node.x, y: node.y },
  });
  kernel.graph.removeNode(node.id);
}

export function registerRoads(kernel) {
  kernel.on('road_decay', onRoadDecay);
}
