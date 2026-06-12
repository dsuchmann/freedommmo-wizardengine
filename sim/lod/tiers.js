// sim/lod/tiers.js — promotion/demotion between tiers, as ledger events (spec §4.3).
import { REGION, regionKeyOf, regionOrigin, aggregateOf, createAggregate, stepAggregateTo } from './aggregate.js';
import { SPECIES, DAY } from '../time/metabolism.js';
import { rand } from '../kernel/rng.js';

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

const SPECIES_IDX = Object.fromEntries(Object.keys(SPECIES).map((s, i) => [s, i + 1]));

/** Materialize a region's aggregate into individuals, honoring count/sumR/sumBody exactly
 *  (spec §4.3: counts and aggregate truth are honored, never contradicted).
 *  Returns the created nodes ([] if the region has no aggregate). */
export function promoteRegion(kernel, regionKey, tick) {
  const agg = aggregateOf(kernel, regionKey);
  if (!agg) return [];
  stepAggregateTo(kernel, agg, tick);                     // settle the partial day first
  if (!kernel.graph.nodes.get(agg.id)) return [];         // it emptied out while stepping
  const [x0, y0] = regionOrigin(regionKey);
  const pops = agg.attrs.pops;
  const evId = kernel.ledger.emit({
    tick, type: 'promote', targets: [agg.id],
    attrs: { region: regionKey, counts: Object.fromEntries(Object.entries(pops).map(([s, p]) => [s, p.count])) },
  });
  const made = [];
  for (const [species, p] of Object.entries(pops)) {
    const sIdx = SPECIES_IDX[species] * 1_000_000;
    if (p.count > 0) {
      // Deterministic weights, normalized → ΣR_i = sumR and Σbody_i = sumBody exactly.
      const wR = [], wB = [];
      let WR = 0, WB = 0;
      for (let i = 0; i < p.count; i++) {
        wR[i] = 0.5 + rand(kernel.seed, agg.id, sIdx + i * 8 + 1); WR += wR[i];
        wB[i] = 0.5 + rand(kernel.seed, agg.id, sIdx + i * 8 + 2); WB += wB[i];
      }
      const meanAge = p.ageSum / p.count;
      for (let i = 0; i < p.count; i++) {
        made.push(kernel.addLiving({
          species,
          x: x0 + rand(kernel.seed, agg.id, sIdx + i * 8 + 3) * REGION,
          y: y0 + rand(kernel.seed, agg.id, sIdx + i * 8 + 4) * REGION,
          R: p.sumR * wR[i] / WR,
          body: p.sumBody * wB[i] / WB,
          tick,
          age: Math.max(0, Math.floor(meanAge * (0.6 + 0.8 * rand(kernel.seed, agg.id, sIdx + i * 8 + 5)))),
          causeEventId: evId,
        }));
      }
    }
    // Dead mass becomes a real decaying corpse (the region's accumulated dead).
    if (p.detritusE > 0.5) {
      const sp = SPECIES[species];
      const halflife = sp.embodiedDecayDays * DAY;
      const corpseEv = kernel.ledger.emit({ tick, type: 'corpse', causeEventId: evId });
      const corpse = kernel.graph.createNode({
        type: 'corpse', tick, x: x0 + HALF, y: y0 + HALF, causeEventId: corpseEv,
        attrs: { E: p.detritusE, decayHalflifeTicks: halflife, of: species },
      });
      kernel.scheduler.schedule(tick + halflife * Math.log2(p.detritusE / 0.5), corpse.id, 'decay_gone', -1);
    } else if (p.detritusE > 0) {
      kernel.ledger.count('decayed', p.detritusE);
    }
  }
  kernel.graph.removeNode(agg.id);                         // pending agg_step goes stale
  return made;
}

/** Reconciles region tiers around attention-bubble centers (spec §4.2).
 *  full ≤ fullR regions (Chebyshev), procedural ≤ ringR, statistical beyond.
 *  Demotion only beyond demoteR (> ringR) — hysteresis prevents boundary thrash.
 *  Full and procedural tiers run identical dynamics in Pass 1: the differences the
 *  spec assigns (LLM vs rule-based Agency, coarser Agency events) have no consumer
 *  yet — Agency is honestly absent (§6.1). The tier labels are the seam. */
export class TierManager {
  constructor(kernel, { fullR = 2, ringR = 4, demoteR = 5 } = {}) {
    this.kernel = kernel;
    this.fullR = fullR; this.ringR = ringR; this.demoteR = demoteR;
    this.tiers = new Map();   // regionKey -> 'full' | 'procedural'; absent = statistical
    for (const n of kernel.graph.nodes.values()) {       // seed from boot-time individuals
      if (n.R != null && n.x != null && !n.attrs.noFlux) this.tiers.set(regionKeyOf(n.x, n.y), 'procedural');
    }
  }

  _dist(regionKey, centers) {
    const [rx, ry] = regionKey.split(',').map(Number);
    let best = Infinity;
    for (const c of centers) {
      const d = Math.max(Math.abs(rx - Math.floor(c.x / REGION)), Math.abs(ry - Math.floor(c.y / REGION)));
      if (d < best) best = d;
    }
    return best;
  }

  /** Reconcile around centers ([{x,y}] in tile coords). Safe to call every pump. */
  update(centers, tick) {
    if (centers.length === 0) return;
    for (const c of centers) {                            // promote the ring
      const cx = Math.floor(c.x / REGION), cy = Math.floor(c.y / REGION);
      for (let ry = cy - this.ringR; ry <= cy + this.ringR; ry++) {
        for (let rx = cx - this.ringR; rx <= cx + this.ringR; rx++) {
          const key = `${rx},${ry}`;
          if (aggregateOf(this.kernel, key)) promoteRegion(this.kernel, key, tick);
          this.tiers.set(key, 'procedural');              // label refined below
        }
      }
    }
    for (const key of [...this.tiers.keys()]) {           // re-label + demote stragglers
      const d = this._dist(key, centers);
      if (d > this.demoteR) {
        demoteRegion(this.kernel, key, tick);             // null when only pinned/empty — fine
        this.tiers.delete(key);
      } else {
        this.tiers.set(key, d <= this.fullR ? 'full' : 'procedural');
      }
    }
  }
}
