// Ambient time-flux per tile (spec §1.1). Occupants demand capture;
// over-subscribed tiles ration proportionally. Pure bookkeeping —
// the kernel reacts to membership/demand changes by re-rating occupants.

export class FluxField {
  constructor({ phi = 4 } = {}) {
    this.phi = phi;             // tu/sec per tile (biome modulation arrives in Plan B/C)
    this.tiles = new Map();     // "tx,ty" -> Map<nodeId, demand>
    this.where = new Map();     // nodeId -> "tx,ty"
  }

  _key(x, y) { return `${Math.floor(x)},${Math.floor(y)}`; }

  enter(nodeId, x, y, demand) {
    const k = this._key(x, y);
    if (!this.tiles.has(k)) this.tiles.set(k, new Map());
    this.tiles.get(k).set(nodeId, demand);
    this.where.set(nodeId, k);
  }

  leave(nodeId) {
    const k = this.where.get(nodeId);
    if (k == null) return;
    this.tiles.get(k).delete(nodeId);
    this.where.delete(nodeId);
  }

  updateDemand(nodeId, demand) {
    const k = this.where.get(nodeId);
    if (k != null) this.tiles.get(k).set(nodeId, demand);
  }

  captureOf(nodeId) {
    const k = this.where.get(nodeId);
    if (k == null) return 0;
    const tile = this.tiles.get(k);
    let sum = 0;
    for (const d of tile.values()) sum += d;
    const demand = tile.get(nodeId);
    return sum <= this.phi ? demand : demand * this.phi / sum;
  }

  occupantsOf(x, y) {
    return [...(this.tiles.get(this._key(x, y))?.keys() ?? [])].sort((a, b) => a - b);
  }
}
