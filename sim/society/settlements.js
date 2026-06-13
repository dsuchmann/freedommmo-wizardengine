// sim/society/settlements.js — P3: settlement founding (provenance rule: no town
// without a founder — a real group node), territory, district zoning, and plot
// OWNERSHIP PRIMITIVES (the data shape Economy later animates). Founding is a
// declaration: zero time moves (declared — physical construction is P4 labor).
// Settlements write NO suppression deltas: a territory is zoned land, not bare
// dirt — baseline flora keeps materializing until P4 buildings claim tiles.
// HONEST ABSENCES: no population/growth (P5), no markets (Economy), no buildings
// at founding (P4). TODO(save/load): settlement/plot nodes are runtime state and
// do not survive kernel reconstruction — rehydrate on load (P1/P2 precedent).
import { scoreSite } from './suitability.js';
import { tileCost } from '../world/routing.js';

export const TERRITORY_W = 12;
export const TERRITORY_H = 10;
export const PLOT_W = 5;          // hut footprint (M4 blueprint)
export const PLOT_H = 4;

/** TERRITORY_W×TERRITORY_H rect centered on (x,y). */
function territoryAround(x, y) {
  return {
    x0: x - Math.floor(TERRITORY_W / 2), y0: y - Math.floor(TERRITORY_H / 2),
    w: TERRITORY_W, h: TERRITORY_H,
  };
}

function overlaps(a, b) {
  return a.x0 < b.x0 + b.w && b.x0 < a.x0 + a.w && a.y0 < b.y0 + b.h && b.y0 < a.y0 + a.h;
}

/** Found a settlement at `site` by group `groupId`. Returns the settlement node, or
 *  null (side-effect-free, zero events) on: missing/non-group founder, water site,
 *  or territory overlapping an existing settlement. */
export function foundSettlement(kernel, groupId, site, tick) {
  const group = kernel.graph.nodes.get(groupId);
  if (!group || group.type !== 'group') return null;
  const scored = scoreSite(kernel, site.x, site.y);
  if (!scored) return null;                      // water site
  const territory = territoryAround(site.x, site.y);
  for (const n of kernel.graph.nodes.values()) {
    if (n.type === 'settlement' && overlaps(territory, n.attrs.territory)) return null;
  }
  // Zoning: split territory into west=residential / east=craft halves. Reason codes
  // are zoning rationale (world-compiler discipline), derived from the site score.
  const wWest = Math.ceil(territory.w / 2);
  const districts = [
    { kind: 'residential', rect: { x0: territory.x0, y0: territory.y0, w: wWest, h: territory.h },
      reason: `nearest water access (water score ${scored.reasons.water.score.toFixed(2)})` },
    { kind: 'craft', rect: { x0: territory.x0 + wWest, y0: territory.y0, w: territory.w - wWest, h: territory.h },
      reason: 'set apart from dwellings (smoke/noise); P4 workshops land here' },
  ];
  const evId = kernel.ledger.emit({
    tick, type: 'settlement_founded', actor: groupId, targets: [],
    attrs: { x: site.x, y: site.y, score: scored.score, reasons: scored.reasons },
  });
  const settlement = kernel.graph.createNode({
    type: 'settlement', tick, x: site.x, y: site.y, causeEventId: evId,
    attrs: { tier: 'village', founderGroup: groupId, territory, districts,
             reasons: scored.reasons, noFlux: true },
  });
  kernel.ledger.events[evId - 1].targets.push(settlement.id);
  // Plots: PLOT_W×PLOT_H grid packed into the residential district, land tiles only
  // (a plot containing water is not deeded). Owned by the founder group initially.
  const res = districts[0].rect;
  for (let py = res.y0; py + PLOT_H <= res.y0 + res.h; py += PLOT_H) {
    for (let px = res.x0; px + PLOT_W <= res.x0 + res.w; px += PLOT_W) {
      let land = true;
      for (let yy = py; yy < py + PLOT_H && land; yy++)
        for (let xx = px; xx < px + PLOT_W && land; xx++)
          if (tileCost(xx, yy) === Infinity) land = false;
      if (!land) continue;
      const plot = kernel.graph.createNode({
        type: 'plot', tick, x: px, y: py, causeEventId: evId,
        attrs: { rect: { x0: px, y0: py, w: PLOT_W, h: PLOT_H }, settlement: settlement.id,
                 district: 'residential', owner: groupId, noFlux: true },
      });
      kernel.ledger.events[evId - 1].targets.push(plot.id);
    }
  }
  return settlement;
}

/** Founder group deeds a plot to a member. Refuses (false, side-effect-free) unless
 *  the group currently owns the plot and all nodes exist. The Economy seam. */
export function assignPlot(kernel, groupId, plotId, memberId, tick) {
  const group = kernel.graph.nodes.get(groupId);
  const plot = kernel.graph.nodes.get(plotId);
  const member = kernel.graph.nodes.get(memberId);
  if (!group || group.type !== 'group' || !plot || plot.type !== 'plot' || !member) return false;
  if (plot.attrs.owner !== groupId) return false;
  kernel.ledger.emit({
    tick, type: 'plot_assigned', actor: groupId, targets: [plotId, memberId],
    attrs: { from: groupId, to: memberId },
  });
  plot.attrs.owner = memberId;
  return true;
}
