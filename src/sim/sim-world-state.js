// src/sim/sim-world-state.js — placementKey → render override, derived from sim truth alone.
import { spineStateOf, visualStateOf } from '../world/asset-state-taxonomy.js';

export class SimWorldState {
  constructor() { this._map = new Map(); this.version = 0; }
  /** Rebuild from a SimClient-shaped {entities, deltas}. Cheap: bubble-sized. */
  update({ entities, deltas }) {
    const next = new Map();
    for (const d of deltas) {
      if (d.target?.startsWith('placement:'))
        next.set(d.target.slice('placement:'.length), { visual: null, removed: true, entityId: null });
    }
    for (const e of entities.values()) {
      if (!e.placement) continue;
      if (e.type === 'matter') { next.set(e.placement, { visual: 'base', removed: false, entityId: e.id, entityType: 'matter' }); continue; }
      const spine = spineStateOf({ stage: e.stage, ageTicks: e.ageTicks ?? 0,
        senescenceStartTicks: e.senescenceStartTicks ?? Infinity, bufferDays: e.bufferDays ?? null });
      next.set(e.placement, { visual: visualStateOf(spine), removed: false, entityId: e.id, entityType: e.type ?? 'flora' });
    }
    this._map = next; this.version++;
  }
  overrideFor(key) { return this._map.get(key) ?? null; }
}
