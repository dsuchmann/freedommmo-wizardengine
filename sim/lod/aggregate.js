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

/** Senescence multipliers at a mean age, computed analytically (mirrors sen_step compounding). */
function senMuls(sp, meanAge) {
  if (meanAge <= sp.senescence.start) return { burnMul: 1, demandMul: 1 };
  const steps = (meanAge - sp.senescence.start) / sp.senescence.stepEvery;
  return { burnMul: sp.senescence.burnGrowth ** steps, demandMul: sp.senescence.demandDecay ** steps };
}

/** Advance one region's populations by dt ticks. Conservation-exact: every stock change
 *  has a matching counter increment in the same call. */
export function stepAggregate(kernel, node, tick, dt) {
  const pops = node.attrs.pops;
  for (const p of Object.values(pops)) p.ageSum += p.count * dt;   // aging first

  // Per-species flux rationing: each species competes only with itself for its share of regionPhi.
  // This mirrors individual simulation where each entity occupies its own tile and only
  // co-occupants of the same tile compete. Cross-species competition is negligible in
  // low-density spawns so each species effectively has the full regionPhi available.
  // Statistical LOD: senescence is not tracked at aggregate tier (individual-tier concern).
  // Each species is rationed against its own per-region flux budget (not cross-species),
  // mirroring individual simulation where entities on separate tiles don't compete.
  const regionPhi = kernel.flux.phi * REGION * REGION;
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
      const ration = demands[species] > regionPhi ? regionPhi / demands[species] : 1;
      const captured = demands[species] * ration * dt;
      const burnDemand = sp.burn * stageAt(species, meanAge)[3] * p.count * dt;
      // Burn only what exists (the individual-tier overdraft rule, applied up front).
      const burned = Math.min(burnDemand, p.sumR + captured);
      kernel.ledger.count('captured', captured);
      kernel.ledger.count('burned', burned);
      let net = captured - burned;
      if (net > 0) {
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
      // Births: mature individuals reproduce when per-capita reserves exceed seeding floor.
      if (p.count > 0) {
        const mAge = p.ageSum / p.count;
        if (stageAt(species, mAge)[0] === 'mature' && p.sumR >= sp.seed.cost) {
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
