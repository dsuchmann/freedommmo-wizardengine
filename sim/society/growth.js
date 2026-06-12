// sim/society/growth.js — P5: settlements grow and decline through scheduled,
// rule-based group decisions paid from real pooled time. One decision per
// interval, fixed priority (maintain → clear → hut → forge → expand → idle),
// every decision a provenanced growth_decision event with a reason code.
// HONEST ABSENCES: no population pressure (no NPCs until Pass 4 Life — surplus
// is the only driver); no farms (no cultivation system — declared backlog); no
// politics (fixed rules, declared); no save/load rehydration of the schedule.
// The group is a DECLARED collective laborer: clearing uses the real chop/take
// verbs with the group as actor (chop reads only the wielded tool; take stores
// into attrs.inventory, which stocks() counts) — conserving, bodies come later.
import { chop, take } from '../world/actions.js';

export const GROWTH_INTERVAL_DAYS = 10;   // one decision every 10 days
export const RESERVE_FLOOR = 200;         // surplus gate for NEW construction
export const MAINTAIN_AT = 60;            // maintain when condition drops below

function inRect(x, y, r) {
  return x >= r.x0 && x < r.x0 + r.w && y >= r.y0 && y < r.y0 + r.h;
}

/** Module-private: clear every materialized placement (and loose debris) in rect
 *  with real verbs, the group acting as collective laborer. Returns count of
 *  placements cleared. Mirrors the probe-buildings clearing pattern. */
function clearLand(kernel, groupId, rect, tick) {
  let cleared = 0;
  for (const n of [...kernel.graph.nodes.values()]) {
    if (!n.attrs?.placement || !inRect(n.x, n.y, rect)) continue;
    if (n.type === 'matter') { if (take(kernel, groupId, n.id, tick)) cleared++; }
    else if (chop(kernel, groupId, n.id, tick)) cleared++;
  }
  // chop leaves corpses/products (not placements) on the tiles; salvage them too.
  for (const n of [...kernel.graph.nodes.values()]) {
    if (n.type !== 'matter' || n.attrs.placement || !inRect(n.x, n.y, rect)) continue;
    take(kernel, groupId, n.id, tick);
  }
  return cleared;
}

/** Group clears a plot it owns. Returns cleared count, or null (side-effect-free)
 *  on missing/non-group actor, missing/non-plot target, or non-owned plot. */
export function clearPlot(kernel, groupId, plotId, tick) {
  const group = kernel.graph.nodes.get(groupId);
  const plot = kernel.graph.nodes.get(plotId);
  if (!group || group.type !== 'group' || !plot || plot.type !== 'plot') return null;
  if (plot.attrs.owner !== groupId) return null;
  return clearLand(kernel, groupId, plot.attrs.rect, tick);
}
