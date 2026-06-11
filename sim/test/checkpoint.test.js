// sim/test/checkpoint.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../store/db.js';
import { Scheduler } from '../kernel/scheduler.js';
import { Kernel } from '../kernel/kernel.js';
import { DAY } from '../time/metabolism.js';

test('scheduler heap round-trips through SQLite preserving array order', () => {
  const db = openDb(':memory:');
  const s = new Scheduler();
  s.schedule(50, 3, 'seed', -1);
  s.schedule(10, 1, 'death_check', 4);
  s.schedule(10, 2, 'stage', -1);
  s.flush(db);
  const s2 = new Scheduler();
  s2.load(db);
  assert.deepEqual(s2.heap.a, s.heap.a);   // exact array order, not just heap order
});

test('node ver and flux demand survive flush', () => {
  const db = openDb(':memory:');
  const k = new Kernel({ seed: 7, bounds: { x0: 0, y0: 0, w: 4, h: 4 } });
  k.graph.boot(() => { k.addLiving({ species: 'grass', x: 1, y: 1, R: 500, body: 20, tick: 0 }); });
  k.runTo(20 * DAY);
  const live = [...k.graph.nodes.values()].filter(m => m.R != null && m.attrs.demand != null).sort((a, b) => a.id - b.id)[0];
  assert.ok(live, 'a re-rated living node exists at day 20');
  assert.ok(live.ver >= 0);
  assert.ok(typeof live.attrs.demand === 'number'); // _reRateOne must record it
  k.graph.flush(db, k.tick);
  const row = db.prepare('SELECT ver, attrs FROM nodes WHERE id=?').get(live.id);
  assert.equal(row.ver, live.ver);
  assert.equal(JSON.parse(row.attrs).demand, live.attrs.demand);
});
