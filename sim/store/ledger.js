// Append-only causal ledger (spec §2.7) + conservation counters (probe 1).

const COUNTERS = ['captured', 'burned', 'decayed', 'transferLoss'];

export class Ledger {
  constructor() {
    this.events = [];
    this.nextEventId = 1;
    this.totals = Object.fromEntries(COUNTERS.map(k => [k, 0]));
  }

  emit({ tick, type, actor = null, targets = [], magnitude = null, causeEventId = null, attrs = {} }) {
    const id = this.nextEventId++;
    this.events.push({ id, tick, type, actor, targets, magnitude, causeEventId, attrs });
    return id;
  }

  count(counter, amount) {
    // Named counters are whitelisted; grain:* counters are auto-registered on first use.
    if (!(counter in this.totals)) {
      if (counter.startsWith('grain:')) this.totals[counter] = 0;
      else throw new Error(`unknown counter ${counter}`);
    }
    this.totals[counter] += amount;
  }

  flush(db) {
    const tx = db.transaction(() => {
      db.exec('DELETE FROM events; DELETE FROM event_targets;');
      const ei = db.prepare('INSERT INTO events(id,tick,type,actor,magnitude,cause_event_id,attrs) VALUES (?,?,?,?,?,?,?)');
      const ti = db.prepare('INSERT INTO event_targets(event_id,node_id) VALUES (?,?)');
      for (const e of this.events) {
        ei.run(e.id, e.tick, e.type, e.actor, e.magnitude, e.causeEventId, JSON.stringify(e.attrs));
        for (const t of e.targets) ti.run(e.id, t);
      }
      db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)')
        .run('totals', JSON.stringify(this.totals));
      db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)')
        .run('nextEventId', String(this.nextEventId));
    });
    tx();
  }
}
