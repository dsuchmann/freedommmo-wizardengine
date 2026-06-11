// World equation persistence (spec §5.1, §3.4): everything a Kernel needs to
// resume bit-identically. Flush order: ledger BEFORE graph (FK created_by_event).
//
// better-sqlite3 promotes nested db.transaction() calls to SAVEPOINTs automatically,
// so the outer transaction here wraps all inner flushes atomically. meta.tick is
// written LAST as the checkpoint commit marker: a crash mid-checkpoint leaves the
// previous tick value (or none), so boot ignores the partial write and falls back
// to the prior checkpoint or a fresh world.
import { Kernel } from '../kernel/kernel.js';
import { Ledger } from './ledger.js';
import { Deltas } from './deltas.js';

export function checkpoint(kernel, db) {
  db.transaction(() => {
    kernel.ledger.flush(db);            // events first (FK target for nodes.created_by_event)
    kernel.graph.flush(db);
    kernel.deltas.flush(db);
    kernel.scheduler.flush(db);
    const meta = db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)');
    meta.run('seed', String(kernel.seed));
    meta.run('phi', String(kernel.flux.phi));
    meta.run('bounds', JSON.stringify(kernel.bounds));
    // tick is written LAST: it is the checkpoint's commit marker. A crash
    // mid-checkpoint leaves the previous tick, so the partial write is ignored
    // (boot treats the world as at the older checkpoint; WAL keeps it readable).
    meta.run('tick', String(kernel.tick));
  })();
}

export function loadKernel(db) {
  const get = key => db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value;
  const kernel = new Kernel({
    seed: Number(get('seed')),
    phi: Number(get('phi')),
    bounds: JSON.parse(get('bounds') ?? 'null'),
  });
  kernel.tick = Number(get('tick'));

  // graph — restore nodes
  for (const r of db.prepare('SELECT * FROM nodes ORDER BY id').all()) {
    const node = {
      id: r.id, type: r.type, bornTick: r.born_tick, x: r.x, y: r.y,
      R: r.R, r: r.rate, lastTick: r.last_tick, ver: r.ver,
      createdByEvent: r.created_by_event, owner: r.owner, attrs: JSON.parse(r.attrs),
    };
    kernel.graph.nodes.set(node.id, node);
    if (node.x != null) {
      const k = kernel.graph._cellKey(node.x, node.y);
      if (!kernel.graph.grid.has(k)) kernel.graph.grid.set(k, new Set());
      kernel.graph.grid.get(k).add(node.id);
    }
  }
  // graph — restore edges
  for (const r of db.prepare('SELECT * FROM edges ORDER BY id').all()) {
    const members = db.prepare('SELECT node_id, role FROM edge_members WHERE edge_id=? ORDER BY node_id, role').all(r.id)
      .map(m => [m.node_id, m.role]);
    const edge = { id: r.id, type: r.type, weight: r.weight, bornTick: r.born_tick, owner: r.owner, attrs: JSON.parse(r.attrs), members };
    kernel.graph.edges.set(edge.id, edge);
    for (const [nid] of members) {
      if (!kernel.graph.byNode.has(nid)) kernel.graph.byNode.set(nid, new Set());
      kernel.graph.byNode.get(nid).add(edge.id);
    }
  }
  kernel.graph.nextNodeId = Number(get('nextNodeId'));
  kernel.graph.nextEdgeId = Number(get('nextEdgeId'));

  // ledger — restore events
  kernel.ledger = new Ledger();
  const targets = new Map();
  for (const t of db.prepare('SELECT event_id, node_id FROM event_targets ORDER BY rowid').all()) {
    if (!targets.has(t.event_id)) targets.set(t.event_id, []);
    targets.get(t.event_id).push(t.node_id);
  }
  for (const r of db.prepare('SELECT * FROM events ORDER BY id').all()) {
    kernel.ledger.events.push({
      id: r.id, tick: r.tick, type: r.type, actor: r.actor, targets: targets.get(r.id) ?? [],
      magnitude: r.magnitude, causeEventId: r.cause_event_id, attrs: JSON.parse(r.attrs),
    });
  }
  kernel.ledger.nextEventId = Number(get('nextEventId'));
  kernel.ledger.totals = JSON.parse(get('totals'));

  // deltas + scheduler
  kernel.deltas = Deltas.load(db);
  kernel.scheduler.load(db);

  // flux: living nodes re-enter with their persisted demand (set by _reRateOne).
  // Sorted by id so float accumulation order in flux tile sums is deterministic.
  // Guard: noFlux nodes (e.g. wallet-style nodes added in Task 4) must never capture flux.
  const living = [...kernel.graph.nodes.values()].sort((a, b) => a.id - b.id);
  for (const n of living) {
    if (n.attrs.noFlux) continue;
    if (n.R != null) kernel.flux.enter(n.id, n.x, n.y, n.attrs.demand ?? 0);
  }
  return kernel;
}
