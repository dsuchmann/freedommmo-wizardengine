// Ambient time-flux per tile (spec §1.1). Occupants demand capture;
// over-subscribed tiles ration proportionally. Pure bookkeeping —
// the kernel reacts to membership/demand changes by re-rating occupants.

export class FluxField {
  constructor({ phi = 4 } = {}) {
    this.phi = phi;             // tu/sec per tile (biome modulation arrives in Plan B/C)
    this.tiles = new Map();     // "tx,ty" -> Map<nodeId, demand>
    this.sums  = new Map();     // "tx,ty" -> total demand (canonical; recomputed on each mutation)
    this.where = new Map();     // nodeId -> "tx,ty"
  }

  _key(x, y) { return `${Math.floor(x)},${Math.floor(y)}`; }

  // Recompute the tile sum from scratch, iterating occupants in ascending nodeId order.
  // This makes the sum a pure function of the current occupant set — independent of
  // the history of enter/leave/updateDemand calls and therefore restore-identical.
  _resum(k) {
    const occupants = this.tiles.get(k);
    if (!occupants || occupants.size === 0) { this.sums.set(k, 0); return; }
    const ids = [...occupants.keys()].sort((a, b) => a - b);
    let s = 0;
    for (const id of ids) s += occupants.get(id);
    this.sums.set(k, s);
  }

  enter(nodeId, x, y, demand) {
    const k = this._key(x, y);
    if (!this.tiles.has(k)) { this.tiles.set(k, new Map()); }
    this.tiles.get(k).set(nodeId, demand);
    this._resum(k);
    this.where.set(nodeId, k);
  }

  leave(nodeId) {
    const k = this.where.get(nodeId);
    if (k == null) return;
    this.tiles.get(k).delete(nodeId);
    this._resum(k);
    this.where.delete(nodeId);
  }

  updateDemand(nodeId, demand) {
    const k = this.where.get(nodeId);
    if (k != null) {
      this.tiles.get(k).set(nodeId, demand);
      this._resum(k);
    }
  }

  captureOf(nodeId) {
    const k = this.where.get(nodeId);
    if (k == null) return 0;
    const demand = this.tiles.get(k).get(nodeId) ?? 0;
    const sum = this.sums.get(k) ?? 0;
    return sum <= this.phi ? demand : demand * this.phi / sum;
  }

  occupantsOf(x, y) {
    return [...(this.tiles.get(this._key(x, y))?.keys() ?? [])].sort((a, b) => a - b);
  }
}
