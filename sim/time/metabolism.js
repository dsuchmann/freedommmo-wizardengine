// The Time Metabolism (spec §1). Lazy stocks: R (linear), body (linear),
// corpse E (exponential, decay counted incrementally on materialization).
import { yieldOf } from '../matter/composition.js';

export const DAY = 86_400;            // ticks (1 tick = 1 sim-second)
export const YEAR = 360 * DAY;

export const CHANNEL_EFF = {          // spec §1.5
  nurture: 0.95, gift: 0.90, trade: 0.85, harvest: 0.50, violence: 0.30,
};

// Initial tunables. Stages: [name, startAgeTicks, demandFactor, burnFactor].
// senescence: { start, stepEvery, burnGrowth, demandDecay } — applied per step event.
// seed: { every, cost, minR, jitter } — reproduction (Task 10).
export const SPECIES = {
  grass: {
    tramplable: true,
    demand: 0.45, burn: 0.30, growFrac: 0.6, maxBody: 200,
    stages: [
      ['seedling', 0,        0.5, 0.6],
      ['growing',  5 * DAY,  0.8, 0.8],
      ['mature',   15 * DAY, 1.0, 1.0],
    ],
    senescence: { start: 60 * DAY, stepEvery: 5 * DAY, burnGrowth: 1.10, demandDecay: 0.93 },
    seed: { every: 12 * DAY, cost: 400, minR: 1200, jitter: 0.3 },
    embodiedDecayDays: 5,
  },
  berry_bush: {
    tramplable: true,
    demand: 0.60, burn: 0.10, growFrac: 0.6, maxBody: 8000,
    stages: [
      ['seedling', 0,         0.4, 0.5],
      ['growing',  30 * DAY,  0.8, 0.8],
      ['mature',   120 * DAY, 1.0, 1.0],
    ],
    senescence: { start: 4 * YEAR, stepEvery: 30 * DAY, burnGrowth: 1.08, demandDecay: 0.95 },
    seed: { every: 90 * DAY, cost: 3000, minR: 10000, jitter: 0.3 },
    embodiedDecayDays: 30,
    pick: { bite: 300 },
  },
  tree: {
    demand: 0.80, burn: 0.08, growFrac: 0.6, maxBody: 50000,
    stages: [
      ['seedling', 0,          0.4, 0.5],
      ['growing',  60 * DAY,   0.8, 0.8],
      ['mature',   1 * YEAR,   1.0, 1.0],
    ],
    senescence: { start: 30 * YEAR, stepEvery: 180 * DAY, burnGrowth: 1.08, demandDecay: 0.96 },
    seed: { every: 180 * DAY, cost: 8000, minR: 30000, jitter: 0.3 },
    embodiedDecayDays: 7,     // halflife; a mature tree's stump (E~1.8M tu) is gone in ~150d (probe 6)
  },
  grazer: {
    demand: 0.10, burn: 0.50, growFrac: 0.4, maxBody: 20000,   // ambient barely feeds it: must graze (Task 11)
    stages: [
      ['seedling', 0,         0.5, 0.5],       // "juvenile"
      ['growing',  60 * DAY,  0.8, 0.8],
      ['mature',   180 * DAY, 1.0, 1.0],
    ],
    senescence: { start: 6 * YEAR, stepEvery: 60 * DAY, burnGrowth: 1.12, demandDecay: 0.95 },
    seed: { every: YEAR, cost: 20000, minR: 60000, jitter: 0.2 },
    embodiedDecayDays: 20,
    graze: { every: 6 * 3600, bite: 600, radius: 3 },   // every 6 sim-hours
  },
};

/** Advance a node's lazy stocks to `tick`. Safe to call repeatedly. */
export function materialize(node, tick, ledger) {
  const dt = tick - node.lastTick;
  if (dt <= 0) return node;
  if (node.type === 'corpse') {
    const h = node.attrs.decayHalflifeTicks;
    const before = node.attrs.E;
    node.attrs.E = before * Math.pow(2, -dt / h);
    const lost = before - node.attrs.E;
    ledger.count('decayed', lost);
    const yieldTbl = yieldOf(node);
    for (const [g, perTu] of Object.entries(yieldTbl))
      ledger.count('grain:decayed:' + g, perTu * lost);
  } else if (node.R != null) {
    node.R += node.r * dt;
    node.attrs.body += (node.attrs.bodyRate ?? 0) * dt;
  }
  node.lastTick = tick;
  return node;
}

/** Move `amount` tu through a typed channel; returns delivered amount. */
export function transfer(amount, channel, ledger) {
  const eff = CHANNEL_EFF[channel];
  if (eff == null) throw new Error(`unknown channel ${channel}`);
  const delivered = amount * eff;
  ledger.count('transferLoss', amount - delivered);
  return delivered;
}

/** Current life stage for a species at a given age (ticks). */
export function stageAt(species, age) {
  const st = SPECIES[species].stages;
  let cur = st[0];
  for (const s of st) if (age >= s[1]) cur = s;
  return cur; // [name, startAge, demandFactor, burnFactor]
}
