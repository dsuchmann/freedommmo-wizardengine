// The Time Metabolism (spec §1). Lazy stocks: R (linear), body (linear),
// corpse E (exponential, decay counted incrementally on materialization).
import { yieldOf } from '../matter/composition.js';

export const DAY = 86_400;            // ticks (1 tick = 1 sim-second)
export const YEAR = 360 * DAY;

export const CHANNEL_EFF = {          // spec §1.5
  nurture: 0.95, gift: 0.90, trade: 0.85, harvest: 0.50, violence: 0.30,
};

// 9-stage humanoid life-stage curve (TIME_SYSTEM burn multipliers 0.2x→2.0x),
// scaled by per-race lifespan. demandFactor = capture curve (children capture
// less, the old capture little).
function humanoid({ lifespan, demand, burn, maxBody, forageBite }) {
  const Y = YEAR * lifespan;
  const r = t => Math.round(t);
  return {
    demand, burn, growFrac: 0.3, maxBody,
    stages: [
      ['infant',      0,         0.30, 0.2],
      ['toddler',     r(2 * Y),  0.45, 0.3],
      ['child',       r(4 * Y),  0.60, 0.4],
      ['adolescent',  r(12 * Y), 0.80, 0.6],
      ['young_adult', r(18 * Y), 1.00, 0.8],
      ['adult',       r(30 * Y), 1.00, 1.0],
      ['middle_aged', r(50 * Y), 0.95, 1.2],
      ['senior',      r(65 * Y), 0.85, 1.5],
      ['elderly',     r(80 * Y), 0.70, 2.0],
    ],
    senescence: { start: r(70 * Y), stepEvery: r(1 * Y), burnGrowth: 1.15, demandDecay: 0.97 },
    graze: { every: 12 * 3600, bite: forageBite, radius: 4 },
    embodiedDecayDays: 25,
  };
}

// — Pass 4 L4: fauna builder. Same Life stack as flora/humanoids; the `instinct`
// block is rule-weighted agency (no LLM, no Mind — L6/L8 honest absences):
//   every: decision cadence (ticks); speed: max move() steps per decision;
//   forage { bite, radius }: bite nearest flora in radius (graze mechanics);
//   hunt { bite, radius, prey: [species] }: approach + bite via violence channel;
//   flee { radius }: step away from any predator-of-me in radius (priority over eating);
//   tame { minOffer }: domestication seam (L4 verb `tame`).
function fauna({ demand, burn, maxBody, growDays, matureDays, senYears, seed, instinct, decayDays }) {
  return {
    demand, burn, growFrac: 0.4, maxBody,
    stages: [
      ['seedling', 0,                0.5, 0.5],
      ['growing',  growDays * DAY,   0.8, 0.8],
      ['mature',   matureDays * DAY, 1.0, 1.0],
    ],
    senescence: { start: senYears * YEAR, stepEvery: 60 * DAY, burnGrowth: 1.12, demandDecay: 0.95 },
    seed, instinct, embodiedDecayDays: decayDays,
  };
}

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
    instinct: { every: 6 * 3600, speed: 2, forage: { bite: 600, radius: 3 }, flee: { radius: 4 } },
  },

  // — Pass 4 L4 fauna. Numbers are initial tunables (grazer precedent).
  rabbit: fauna({
    demand: 0.05, burn: 0.25, maxBody: 1500, growDays: 15, matureDays: 45, senYears: 2,
    seed: { every: 90 * DAY, cost: 4000, minR: 8000, jitter: 0.3 },
    instinct: { every: 6 * 3600, speed: 3, forage: { bite: 250, radius: 3 },
                flee: { radius: 4 }, tame: { minOffer: 2000 } },
    decayDays: 10,
  }),
  deer: fauna({
    demand: 0.12, burn: 0.45, maxBody: 9000, growDays: 45, matureDays: 150, senYears: 5,
    seed: { every: 300 * DAY, cost: 15000, minR: 30000, jitter: 0.25 },
    instinct: { every: 6 * 3600, speed: 3, forage: { bite: 700, radius: 3 },
                flee: { radius: 5 }, tame: { minOffer: 6000 } },
    decayDays: 20,
  }),
  wolf: fauna({
    demand: 0.15, burn: 0.60, maxBody: 7000, growDays: 40, matureDays: 140, senYears: 5,
    seed: { every: 360 * DAY, cost: 18000, minR: 36000, jitter: 0.25 },
    instinct: { every: 12 * 3600, speed: 4,
                hunt: { bite: 1200, radius: 6, prey: ['rabbit', 'deer', 'grazer'] } },
    decayDays: 20,
  }),

  // — Pass 4 L1: humanoid races. Same kernel machinery as all life; stages carry
  // the TIME_SYSTEM 10-stage burn multipliers (fetus omitted: gestation is L5's
  // birth-as-parental-investment — honest absence), senescence carries the
  // TIME_SYSTEM death-scaling (1.15x/year from age 70). No `seed`: people-
  // reproduction (family edges, childhood gating) is L5. `graze` here is the
  // rule-based foraging instinct (grazer precedent) — NOT Agency (L6).
  human: humanoid({ lifespan: 1,   demand: 0.12, burn: 0.45, maxBody: 25000, forageBite: 500 }),
  elf:   humanoid({ lifespan: 5,   demand: 0.10, burn: 0.30, maxBody: 22000, forageBite: 350 }),
  dwarf: humanoid({ lifespan: 2.5, demand: 0.12, burn: 0.40, maxBody: 24000, forageBite: 450 }),
  orc:   humanoid({ lifespan: 0.7, demand: 0.14, burn: 0.55, maxBody: 30000, forageBite: 650 }),
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
