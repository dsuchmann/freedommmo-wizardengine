// In-memory hypergraph (hot set). SQLite is durable truth via flush().
// Node: { id, type, bornTick, x, y, R, r, lastTick, ver, createdByEvent, owner, attrs }
// attrs is a plain object (JSON in SQLite). Living state like body/stage/species lives there.

const CELL = 8; // spatial grid cell size in tiles

export class Graph {
  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
    this.byNode = new Map();   // nodeId -> Set<edgeId>
    this.grid = new Map();     // "cx,cy" -> Set<nodeId>
    this.nextNodeId = 1;
    this.nextEdgeId = 1;
    this._boot = false;
  }

  boot(fn) { this._boot = true; try { fn(); } finally { this._boot = false; } }

  _cellKey(x, y) { return `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`; }

  createNode({ type, tick, x = null, y = null, R = null, r = 0, owner = null, attrs = {}, causeEventId = null }) {
    if (causeEventId == null && !this._boot) {
      throw new Error(`provenance: node of type '${type}' has no causal event and is not baseline (spec §5.4)`);
    }
    const node = {
      id: this.nextNodeId++, type, bornTick: tick, x, y,
      R, r, lastTick: tick, ver: 0,
      createdByEvent: causeEventId, owner, attrs,
    };
    this.nodes.set(node.id, node);
    if (x != null) {
      const k = this._cellKey(x, y);
      if (!this.grid.has(k)) this.grid.set(k, new Set());
      this.grid.get(k).add(node.id);
    }
    return node;
  }

  removeNode(id) {
    const n = this.nodes.get(id);
    if (!n) return;
    if (n.x != null) this.grid.get(this._cellKey(n.x, n.y))?.delete(id);
    for (const eid of this.byNode.get(id) ?? []) {
      const edge = this.edges.get(eid);
      if (edge) for (const [mid] of edge.members) this.byNode.get(mid)?.delete(eid);
      this.edges.delete(eid);
    }
    this.byNode.delete(id);
    this.nodes.delete(id);
  }

  createEdge({ type, tick, members, weight = 1, owner = null, attrs = {} }) {
    const edge = { id: this.nextEdgeId++, type, weight, bornTick: tick, owner, attrs, members };
    this.edges.set(edge.id, edge);
    for (const [nid] of members) {
      if (!this.byNode.has(nid)) this.byNode.set(nid, new Set());
      this.byNode.get(nid).add(edge.id);
    }
    return edge;
  }

  edgesOf(nodeId) {
    return [...(this.byNode.get(nodeId) ?? [])].map(id => this.edges.get(id));
  }

  nodesNear(x, y, radius) {
    const out = [];
    const c0x = Math.floor((x - radius) / CELL), c1x = Math.floor((x + radius) / CELL);
    const c0y = Math.floor((y - radius) / CELL), c1y = Math.floor((y + radius) / CELL);
    for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) {
      for (const id of this.grid.get(`${cx},${cy}`) ?? []) {
        const n = this.nodes.get(id);
        const dx = n.x - x, dy = n.y - y;
        if (dx * dx + dy * dy <= radius * radius) out.push(n);
      }
    }
    out.sort((a, b) => a.id - b.id); // deterministic order
    return out;
  }

  flush(db, tick) {
    const tx = db.transaction(() => {
      db.exec('DELETE FROM nodes; DELETE FROM edges; DELETE FROM edge_members;');
      const ni = db.prepare('INSERT INTO nodes(id,type,born_tick,x,y,R,rate,last_tick,created_by_event,owner,attrs) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
      for (const n of this.nodes.values()) {
        ni.run(n.id, n.type, n.bornTick, n.x, n.y, n.R, n.r, n.lastTick, n.createdByEvent, n.owner, JSON.stringify(n.attrs));
      }
      const ei = db.prepare('INSERT INTO edges(id,type,weight,born_tick,owner,attrs) VALUES (?,?,?,?,?,?)');
      const mi = db.prepare('INSERT INTO edge_members(edge_id,node_id,role) VALUES (?,?,?)');
      for (const e of this.edges.values()) {
        ei.run(e.id, e.type, e.weight, e.bornTick, e.owner, JSON.stringify(e.attrs));
        for (const [nid, role] of e.members) mi.run(e.id, nid, role ?? '');
      }
      db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)').run('tick', String(tick));
      db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)').run('nextNodeId', String(this.nextNodeId));
      db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)').run('nextEdgeId', String(this.nextEdgeId));
    });
    tx();
  }
}
