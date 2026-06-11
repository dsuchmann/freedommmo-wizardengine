import { EventHeap } from './heap.js';

// Priority queue of due events with stale-version filtering (spec §4.1, §5.5).
export class Scheduler {
  constructor() { this.heap = new EventHeap(); }

  schedule(tick, nodeId, kind, ver) {
    this.heap.push({ tick: Math.ceil(tick), nodeId, kind, ver });
  }

  /** Pop next event due at or before `tick` that is still fresh, else undefined. */
  nextDue(tick, isFresh) {
    while (this.heap.size > 0 && this.heap.peek().tick <= tick) {
      const ev = this.heap.pop();
      if (isFresh(ev)) return ev;
    }
    return undefined;
  }

  /** Persist the heap array verbatim (its order IS deterministic state). */
  flush(db) {
    const tx = db.transaction(() => {
      db.exec('DELETE FROM sched;');
      const ins = db.prepare('INSERT INTO sched(idx,tick,node_id,kind,ver) VALUES (?,?,?,?,?)');
      this.heap.a.forEach((e, i) => ins.run(i, e.tick, e.nodeId, e.kind, e.ver));
    });
    tx();
  }

  load(db) {
    this.heap.a = db.prepare('SELECT tick, node_id, kind, ver FROM sched ORDER BY idx').all()
      .map(r => ({ tick: r.tick, nodeId: r.node_id, kind: r.kind, ver: r.ver }));
    // already a valid heap (stored verbatim) — no rebuild needed
  }

  /** Evict events that can never fire. Safe at any time: freshness is monotone
   *  (node ids never reused, ver only grows), so removing permanently-stale
   *  events cannot change the pop sequence. */
  compact(isFresh) {
    this.heap.rebuild(this.heap.a.filter(isFresh));
  }
}
