// Persistent overrides of baseline — the world's scars (spec §5.2).
// Deltas heal: remove(id) deletes a delta when regrowth/decay pays it off.
export class Deltas {
  constructor() {
    this.list = [];          // { id, tick, x, y, target, kind, attrs }
    this.nextDeltaId = 1;
  }

  push({ tick, x = null, y = null, target, kind, attrs = {} }) {
    const id = this.nextDeltaId++;
    this.list.push({ id, tick, x, y, target, kind, attrs });
    return id;
  }

  remove(id) {
    const i = this.list.findIndex(d => d.id === id);
    if (i >= 0) this.list.splice(i, 1);
  }

  flush(db) {
    const tx = db.transaction(() => {
      db.exec('DELETE FROM deltas;');
      const ins = db.prepare('INSERT INTO deltas(id,tick,x,y,target,kind,attrs) VALUES (?,?,?,?,?,?,?)');
      for (const d of this.list) ins.run(d.id, d.tick, d.x, d.y, d.target, d.kind, JSON.stringify(d.attrs));
      db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)').run('nextDeltaId', String(this.nextDeltaId));
    });
    tx();
  }

  static load(db) {
    const d = new Deltas();
    d.list = db.prepare('SELECT * FROM deltas ORDER BY id').all()
      .map(r => ({ id: r.id, tick: r.tick, x: r.x, y: r.y, target: r.target, kind: r.kind, attrs: JSON.parse(r.attrs) }));
    const meta = db.prepare('SELECT value FROM meta WHERE key=?').get('nextDeltaId');
    d.nextDeltaId = meta ? Number(meta.value) : (d.list.at(-1)?.id ?? 0) + 1;
    return d;
  }
}
