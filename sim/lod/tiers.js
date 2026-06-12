// sim/lod/tiers.js — promotion/demotion between tiers, as ledger events (spec §4.3).
import { REGION, regionKeyOf, regionOrigin, aggregateOf, createAggregate, stepAggregateTo } from './aggregate.js';

const NEVER_DEMOTE = new Set(['player', 'group', 'corpse', 'aggregate']);
const HALF = REGION / 2;
const RADIUS = HALF * Math.SQRT2 + 1e-9;   // circumscribes the region square

function regionNodes(kernel, regionKey) {
  const [x0, y0] = regionOrigin(regionKey);
  return kernel.graph.nodesNear(x0 + HALF, y0 + HALF, RADIUS)
    .filter(n => regionKeyOf(n.x, n.y) === regionKey);
}

/** Fold every unpinned individual in a region into the region aggregate.
 *  Returns the aggregate (or null if nothing was folded). */
export function demoteRegion(kernel, regionKey, tick) {
  const victims = regionNodes(kernel, regionKey)
    .filter(n => n.R != null && !NEVER_DEMOTE.has(n.type) && !n.attrs.pinned && !n.attrs.noFlux);
  if (victims.length === 0) return null;
  const pops = {};
  for (const n of victims) {
    kernel.closeSegment(n, tick);
    if (n.R < 0) { kernel.ledger.count('burned', n.R); n.R = 0; }   // scheduler-ceil overdraft correction
    const p = pops[n.attrs.species] ??= { count: 0, sumR: 0, sumBody: 0, ageSum: 0, detritusE: 0 };
    p.count++; p.sumR += n.R; p.sumBody += n.attrs.body;
    p.ageSum += tick - n.attrs.birthTick;
    kernel.flux.leave(n.id);
    kernel.graph.removeNode(n.id);                                   // scheduled events go stale
  }
  const evId = kernel.ledger.emit({
    tick, type: 'demote',
    attrs: { region: regionKey, counts: Object.fromEntries(Object.entries(pops).map(([s, p]) => [s, p.count])) },
  });
  let agg = aggregateOf(kernel, regionKey);
  if (agg) {
    stepAggregateTo(kernel, agg, tick);                              // bring current before merging
    if (!kernel.graph.nodes.get(agg.id)) agg = null;                 // it may have emptied out
  }
  if (agg) {
    for (const [s, p] of Object.entries(pops)) {
      const t = agg.attrs.pops[s] ??= { count: 0, sumR: 0, sumBody: 0, ageSum: 0, detritusE: 0 };
      t.count += p.count; t.sumR += p.sumR; t.sumBody += p.sumBody; t.ageSum += p.ageSum;
    }
  } else {
    agg = createAggregate(kernel, regionKey, pops, tick, evId);
  }
  kernel.ledger.events[evId - 1].targets.push(agg.id);               // events array is id-ordered (id starts at 1)
  // Survivors (pinned) get the freed flux: re-rate everything still living in the region.
  for (const n of regionNodes(kernel, regionKey)) {
    if (n.R != null && !n.attrs.noFlux) kernel._reRateOne(n, tick);
  }
  return agg;
}
