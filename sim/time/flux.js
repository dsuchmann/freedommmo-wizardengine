// Ambient time-flux per tile (spec §1.1). Occupants demand capture;
// over-subscribed tiles ration proportionally. Pure bookkeeping —
// the kernel reacts to membership/demand changes by re-rating occupants.

export class FluxField {
  constructor({ phi = 4 } = {}) {
    this.phi = phi;             // tu/sec per tile (biome modulation arrives in Plan B/C)
    this.tiles = new Map();     // "tx,ty" -> Map<nodeId, demand>
    this.sums  = new Map();     // "tx,ty" -> total demand (cached for O(1) captureOf)
    this.where = new Map();     // nodeId -> "tx,ty"
  }

  _key(x, y) { return `${Math.floor(x)},${Math.floor(y)}`; }

  enter(nodeId, x, y, demand) {
    const k = this._key(x, y);
    if (!this.tiles.has(k)) { this.tiles.set(k, new Map()); this.sums.set(k, 0); }
    this.tiles.get(k).set(nodeId, demand);
    this.sums.set(k, (this.sums.get(k) ?? 0) + demand);
    this.where.set(nodeId, k);
  }

  leave(nodeId) {
    const k = this.where.get(nodeId);
    if (k == null) return;
    const demand = this.tiles.get(k).get(nodeId) ?? 0;
    this.tiles.get(k).delete(nodeId);
    this.sums.set(k, (this.sums.get(k) ?? 0) - demand);
    this.where.delete(nodeId);
  }

  updateDemand(nodeId, demand) {
    const k = this.where.get(nodeId);
    if (k != null) {
      const old = this.tiles.get(k).get(nodeId) ?? 0;
      this.tiles.get(k).set(nodeId, demand);
      this.sums.set(k, (this.sums.get(k) ?? 0) - old + demand);
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
