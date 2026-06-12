// sim/lod/aggregate.js — statistical-tier aggregate nodes (spec §4.2).
// One node per 16×16-tile region; per-species buckets {count,sumR,sumBody,ageSum,detritusE}.
// Aggregates are step-discrete: stocks AND ledger counters change only at agg_step,
// so the conservation identity holds exactly at every tick.
import { DAY, SPECIES, stageAt, transfer } from '../time/metabolism.js';
import { rand } from '../kernel/rng.js';

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

/** Deterministic stochastic rounding: floor(x) + Bernoulli(frac) from (seed, ids). */
function stochRound(seed, a, b, x) {
  const fl = Math.floor(x);
  return fl + (rand(seed, a, b) < x - fl ? 1 : 0);
}

/** Advance one region's populations by dt ticks. Conservation-exact: every stock change
 *  has a matching counter increment in the same call.
 *
 *  Capture rationing (tile-occupancy model): each individual occupies one tile and captures
 *  at most phi from it. When the region is over-occupied (totalCount > REGION²), tiles are
 *  shared proportionally by species count, so total captured across all species is bounded
 *  by regionPhi. In the sparse case every species gets its own occupied-tile budget. */
export function stepAggregate(kernel, node, tick, dt) {
  const pops = node.attrs.pops;
  for (const p of Object.values(pops)) p.ageSum += p.count * dt;   // aging first

  // Compute totalCount once for the tile-occupancy budget (fix 4).
  const totalCount = Object.values(pops).reduce((s, p) => s + p.count, 0);

  const demands = {};
  for (const [species, p] of Object.entries(pops)) {
    if (p.count <= 0) { demands[species] = 0; continue; }
    const sp = SPECIES[species];
    const meanAge = p.ageSum / p.count;
    demands[species] = sp.demand * stageAt(species, meanAge)[2] * p.count;
  }

  for (const [species, p] of Object.entries(pops)) {
    const sp = SPECIES[species];
    if (p.count > 0) {
      const meanAge = p.ageSum / p.count;
      // Tile-occupancy capture budget: sparse → own tiles; over-occupied → proportional share.
      const tiles_s = totalCount > REGION * REGION ? REGION * REGION * p.count / totalCount : p.count;
      const budget_s = kernel.flux.phi * tiles_s;
      const ration = demands[species] > budget_s ? budget_s / demands[species] : 1;
      const captured = demands[species] * ration * dt;
      const burnDemand = sp.burn * stageAt(species, meanAge)[3] * p.count * dt;
      // Burn only what exists (the individual-tier overdraft rule, applied up front).
      const burned = Math.min(burnDemand, p.sumR + captured);
      kernel.ledger.count('captured', captured);
      kernel.ledger.count('burned', burned);
      let net = captured - burned;
      // Growth into body only while pre-senescent (mirrors individual-tier lifecycle).
      if (net > 0 && meanAge <= sp.senescence.start) {
        const grow = Math.min(sp.growFrac * net, Math.max(0, p.count * sp.maxBody - p.sumBody));
        p.sumBody += grow; net -= grow;
      }
      p.sumR += net;   // ≥ 0 by construction of `burned`
      // Starvation: the fraction whose burn went unmet dies; bodies persist as detritus.
      if (burned < burnDemand - 1e-9) {
        const deaths = Math.min(p.count,
          stochRound(kernel.seed, node.id, tick + 7, p.count * (burnDemand - burned) / burnDemand));
        if (deaths > 0) {
          const mAge = p.ageSum / p.count, mBody = p.sumBody / p.count;
          p.count -= deaths;
          p.ageSum -= deaths * mAge;
          p.sumBody -= deaths * mBody;
          p.detritusE += deaths * mBody;
          kernel.ledger.emit({ tick, type: 'agg_deaths', targets: [node.id], magnitude: deaths, attrs: { species } });
        }
      }
      // Births: mature individuals reproduce when per-capita reserves exceed the seeding floor.
      if (p.count > 0) {
        const mAge = p.ageSum / p.count;
        if (stageAt(species, mAge)[0] === 'mature' && p.sumR / p.count >= sp.seed.minR) {
          const maxAffordable = Math.floor(p.sumR / sp.seed.cost);
          const births = Math.min(
            stochRound(kernel.seed, node.id, tick + 11, p.count * dt / sp.seed.every),
            maxAffordable);
          if (births > 0) {
            const cost = births * sp.seed.cost;
            p.sumR -= cost;
            const delivered = transfer(cost, 'nurture', kernel.ledger);
            p.sumR += delivered * 0.7;
            p.sumBody += delivered * 0.3;
            p.count += births;            // newborns at age 0: ageSum unchanged
          }
        }
      }
    }
    // Detritus decays like a corpse pool.
    if (p.detritusE > 0) {
      const f = Math.pow(2, -dt / (sp.embodiedDecayDays * DAY));
      kernel.ledger.count('decayed', p.detritusE * (1 - f));
      p.detritusE *= f;
    }
    if (p.count <= 0 && p.detritusE <= 0.5) {
      kernel.ledger.count('decayed', p.detritusE);
      delete pops[species];
    }
  }
  if (Object.keys(pops).length === 0) kernel.graph.removeNode(node.id);  // pending agg_step goes stale
}

/** Bring an aggregate current (used by demote-merge and promote). */
export function stepAggregateTo(kernel, node, tick) {
  const dt = tick - node.lastTick;
  if (dt > 0) { stepAggregate(kernel, node, tick, dt); node.lastTick = tick; }
}

export function registerAggregates(kernel) {
  kernel.on('agg_step', (k, node, ev) => {
    stepAggregateTo(k, node, ev.tick);
    if (k.graph.nodes.get(node.id)) k.scheduler.schedule(ev.tick + AGG_STEP, node.id, 'agg_step', -1);
  });
}
