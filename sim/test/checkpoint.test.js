// sim/test/checkpoint.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../store/db.js';
import { Scheduler } from '../kernel/scheduler.js';
import { Kernel } from '../kernel/kernel.js';
import { DAY } from '../time/metabolism.js';
import { checkpoint, loadKernel } from '../store/checkpoint.js';
import { spawnMeadow } from '../world/spawn.js';
import { canonicalDump } from '../store/db.js';

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
  k.graph.flush(db);
  const row = db.prepare('SELECT ver, attrs FROM nodes WHERE id=?').get(live.id);
  assert.equal(row.ver, live.ver);
  assert.equal(JSON.parse(row.attrs).demand, live.attrs.demand);
});

test('checkpoint at day 30, load, run to day 60 === straight run to day 60', () => {
  const bounds = { x0: 0, y0: 0, w: 12, h: 12 };
  const mk = () => { const k = new Kernel({ seed: 99, bounds }); spawnMeadow(k, bounds); return k; };

  const straight = mk();
  straight.runTo(60 * DAY);

  const split = mk();
  split.runTo(30 * DAY);
  const db = openDb(':memory:');
  checkpoint(split, db);
  const resumed = loadKernel(db);
  assert.equal(resumed.tick, 30 * DAY);
  resumed.runTo(60 * DAY);

  const dbA = openDb(':memory:'); checkpoint(straight, dbA);
  const dbB = openDb(':memory:'); checkpoint(resumed, dbB);
  assert.equal(canonicalDump(dbB), canonicalDump(dbA));   // bit-identical recovery (spec §5.1)
});

test('checkpoint preserves conservation totals across load', () => {
  const k = new Kernel({ seed: 5, bounds: { x0: 0, y0: 0, w: 8, h: 8 } });
  spawnMeadow(k, { x0: 0, y0: 0, w: 8, h: 8 });
  k.runTo(10 * DAY);
  const db = openDb(':memory:');
  checkpoint(k, db);
  const k2 = loadKernel(db);
  assert.deepEqual(k2.ledger.totals, k.ledger.totals);
});

test('meta tick is absent until a full checkpoint completes (commit marker)', () => {
  const db = openDb(':memory:');
  const k = new Kernel({ seed: 2, bounds: { x0: 0, y0: 0, w: 4, h: 4 } });
  spawnMeadow(k, { x0: 0, y0: 0, w: 4, h: 4 });
  k.runTo(DAY);
  k.ledger.flush(db);
  k.graph.flush(db);                 // partial write: no scheduler, no meta tick
  assert.equal(db.prepare('SELECT value FROM meta WHERE key=?').get('tick'), undefined);
  checkpoint(k, db);
  assert.equal(Number(db.prepare('SELECT value FROM meta WHERE key=?').get('tick').value), k.tick);
});
