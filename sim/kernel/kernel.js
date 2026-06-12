import { Graph } from '../store/graph.js';
import { Ledger } from '../store/ledger.js';
import { Deltas } from '../store/deltas.js';
import { FluxField } from '../time/flux.js';
import { Scheduler } from './scheduler.js';
import { SPECIES, materialize, stageAt } from '../time/metabolism.js';
import { registerLifecycle } from '../time/lifecycle.js';
import { registerAggregates } from '../lod/aggregate.js';
import { registerPaths } from '../world/paths.js';
import { registerRoads } from '../world/roads.js';
import { registerCrossings } from '../world/crossings.js';
import { registerBuildings } from '../world/buildings.js';

export class Kernel {
  constructor({ seed, phi = 4, bounds = null }) {
    this.seed = seed;
    this.tick = 0;
    this.bounds = bounds;   // {x0,y0,w,h} or null = unbounded; seeds outside bounds fail to establish
    this.graph = new Graph();
    this.ledger = new Ledger();
    this.deltas = new Deltas();
    this.flux = new FluxField({ phi });
    this.scheduler = new Scheduler();
    this.handlers = new Map();   // kind -> (kernel, node, ev) => void
    registerLifecycle(this);
    registerAggregates(this);
    registerPaths(this);
    registerRoads(this);
    registerCrossings(this);
    registerBuildings(this);
  }

  on(kind, fn) { this.handlers.set(kind, fn); }

  /** Create a living node (inside boot scope or with causeEventId) and wire it in. */
  addLiving({ species, x, y, R, body, tick, age = 0, causeEventId = null }) {
    const node = this.graph.createNode({
      type: species, tick, x, y, R, causeEventId,
      attrs: { species, body, bodyRate: 0, cap: 0, burn: 0, birthTick: tick - age },
    });
    this.flux.enter(node.id, x, y, 0);
    this.reRateTileOf(node.id, tick);
    this._scheduleLifecycle(node, tick);   // provided by lifecycle registration
    return node;
  }

  materialized(id) {
    const n = this.graph.nodes.get(id);
    return n ? materialize(n, this.tick, this.ledger) : undefined;
  }

  /** Close the open rate segment for a node: materialize + accrue counters. */
  closeSegment(node, tick) {
    const dt = tick - node.lastTick;
    if (dt > 0 && node.R != null) {
      this.ledger.count('captured', (node.attrs.cap ?? 0) * dt);
      this.ledger.count('burned', (node.attrs.burn ?? 0) * dt);
    }
    materialize(node, tick, this.ledger);
  }

  /** Recompute rates for every occupant of the tile containing node `id`. */
  reRateTileOf(id, tick) {
    const n = this.graph.nodes.get(id);
    if (!n || n.x == null || n.attrs?.noFlux) return;
    // 1. update this node's demand, 2. re-rate all tile occupants (rationing shifts)
    for (const occId of this.flux.occupantsOf(n.x, n.y)) {
      const occ = this.graph.nodes.get(occId);
      if (occ?.R != null) this._reRateOne(occ, tick);
    }
  }

  _reRateOne(node, tick) {
    this.closeSegment(node, tick);
    const sp = SPECIES[node.attrs.species];
    const age = tick - node.attrs.birthTick;
    const [, , dF, bF] = stageAt(node.attrs.species, age);
    const sen = node.attrs.sen ?? { burnMul: 1, demandMul: 1 };
    const demand = sp.demand * dF * sen.demandMul;
    node.attrs.demand = demand;   // persisted so loadKernel can rebuild the flux field
    this.flux.updateDemand(node.id, demand);
    const cap = this.flux.captureOf(node.id);
    const burn = sp.burn * bF * sen.burnMul;
    const net = cap - burn;
    const grow = net > 0 && node.attrs.sen == null && node.attrs.body < sp.maxBody
      ? sp.growFrac * net : 0;
    node.attrs.cap = cap;
    node.attrs.burn = burn;
    node.attrs.bodyRate = grow;
    node.r = net - grow;
    node.ver++;
    if (node.r < 0) {
      if (node.R > 0) {
        this.scheduler.schedule(Math.max(tick + 1, tick + node.R / -node.r), node.id, 'death_check', node.ver);
      } else {
        // R already exhausted AND rate still negative; die immediately
        this.scheduler.schedule(tick, node.id, 'death_check', node.ver);
      }
    }
    if (grow > 0) {  // body-full crossing: growth stops, surplus reroutes to R
      this.scheduler.schedule(Math.max(tick + 1, tick + (sp.maxBody - node.attrs.body) / grow), node.id, 'body_full', node.ver);
    }
  }

  /** World stocks at `tick`: ΣR + Σbody (living) + ΣE (corpses), materialized.
   *  Living nodes are closed (captured/burned accrued) so the conservation identity holds.
   *  NOTE: destructive audit — materializes every node (mutates R/body/E/lastTick, accrues
   *  counters). Only call at the current sim tick (e.g. right after runTo), never mid-run
   *  at a past tick, or the skipped interval's accrual is lost. */
  stocks(tick) {
    let s = 0;
    for (const n of this.graph.nodes.values()) {
      if (n.type === 'corpse') {
        materialize(n, tick, this.ledger);
        s += n.attrs.E;
      } else if (n.type === 'aggregate') {
        for (const p of Object.values(n.attrs.pops)) s += p.sumR + p.sumBody + p.detritusE;
      } else if (n.type === 'matter') {
        // Static matter nodes (F3): no metabolism, E is conserved as-is.
        s += n.attrs.E ?? 0;
      } else if (n.type === 'building') {
        // P4 runtime buildings hold paid embodied time (boot buildings have no E → ?? 0).
        s += n.attrs.E ?? 0;
      } else if (n.R != null) {
        this.closeSegment(n, tick);
        s += n.R + n.attrs.body;
      }
      // Inventory items (any node type, incl. players): embodied time waiting to be eaten.
      if (n.attrs?.inventory) {
        for (const item of n.attrs.inventory) s += item.E;
      }
      // Equipped items are still player-held stock (M5): equip moves items between
      // containers, never out of the world.
      if (n.attrs?.equipment) {
        for (const item of Object.values(n.attrs.equipment)) s += item.E;
      }
    }
    return s;
  }

  /** Brute-force mode for probe 5: process events normally, but ALSO force a
      re-rate of every living node every `step` ticks. closeSegment inside
      _reRateOne folds the elapsed segment into (R, lastTick) and the ledger
      counters at every step, so eager mode exercises MANY short segments where
      lazy mode uses few long ones. Final state must agree within float tolerance. */
  runEagerTo(targetTick, step = 3600) {
    for (let t = this.tick + step; t <= targetTick; t += step) {
      this.runTo(t);
      for (const n of [...this.graph.nodes.values()].sort((a, b) => a.id - b.id)) {
        if (n.R != null) this._reRateOne(n, t);
        else if (n.type === 'corpse') this.materialized(n.id);
      }
    }
    this.runTo(targetTick);
  }

  runTo(targetTick) {
    const isFresh = e => {
      const n = this.graph.nodes.get(e.nodeId);
      return n != null && (e.ver === -1 || e.ver === n.ver);
    };
    for (;;) {
      const ev = this.scheduler.nextDue(targetTick, isFresh);
      if (!ev) break;
      this.tick = ev.tick;
      const node = this.graph.nodes.get(ev.nodeId);
      const h = this.handlers.get(ev.kind);
      if (h) h(this, node, ev);
      const sz = this.scheduler.heap.size;
      if (sz > 4096 && sz > 8 * this.graph.nodes.size) this.scheduler.compact(isFresh);
    }
    this.tick = targetTick;
  }
}
