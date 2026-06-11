// sim/lod/aggregate.js — statistical-tier aggregate nodes (spec §4.2).
// One node per 16×16-tile region; per-species buckets {count,sumR,sumBody,ageSum,detritusE}.
// Aggregates are step-discrete: stocks AND ledger counters change only at agg_step,
// so the conservation identity holds exactly at every tick.
import { DAY } from '../time/metabolism.js';

export const REGION = 16;            // tiles per region side (2×2 graph grid cells)
export const AGG_STEP = DAY;         // statistical step cadence (coarse events, spec §4.2)

export const regionKeyOf = (x, y) => `${Math.floor(x / REGION)},${Math.floor(y / REGION)}`;
export const regionOrigin = key => key.split(',').map(n => Number(n) * REGION);

/** The aggregate node for a region, or undefined. (It sits exactly at the region center.) */
export function aggregateOf(kernel, regionKey) {
  const [x0, y0] = regionOrigin(regionKey);
  return kernel.graph.nodesNear(x0 + REGION / 2, y0 + REGION / 2, 0.5)
    .find(n => n.type === 'aggregate' && n.attrs.region === regionKey);
}

/** Create an aggregate node (inside boot scope or with a causal event) and schedule its first step. */
export function createAggregate(kernel, regionKey, pops, tick, causeEventId) {
  const [x0, y0] = regionOrigin(regionKey);
  const node = kernel.graph.createNode({
    type: 'aggregate', tick, x: x0 + REGION / 2, y: y0 + REGION / 2,
    causeEventId, attrs: { region: regionKey, pops },
  });
  kernel.scheduler.schedule(tick + AGG_STEP, node.id, 'agg_step', -1);
  return node;
}
