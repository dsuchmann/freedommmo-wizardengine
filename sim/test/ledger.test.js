import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ledger } from '../store/ledger.js';
import { openDb } from '../store/db.js';

test('emits events with sequential ids and cause chains', () => {
  const l = new Ledger();
  const e1 = l.emit({ tick: 10, type: 'death', actor: 5, targets: [5], magnitude: 1 });
  const e2 = l.emit({ tick: 11, type: 'decay_gone', actor: null, targets: [6], causeEventId: e1 });
  assert.equal(e2, e1 + 1);
  assert.equal(l.events[1].causeEventId, e1);
});

test('conservation counters accumulate', () => {
  const l = new Ledger();
  l.count('captured', 10);
  l.count('burned', 4);
  l.count('captured', 2.5);
  assert.equal(l.totals.captured, 12.5);
  assert.equal(l.totals.burned, 4);
  assert.equal(l.totals.decayed, 0);
  assert.throws(() => l.count('nonsense', 1));
});

test('flush writes events and counters to SQLite', () => {
  const l = new Ledger();
  l.emit({ tick: 1, type: 'birth', actor: 2, targets: [3, 4] });
  l.count('transferLoss', 7);
  const db = openDb(':memory:');
  l.flush(db);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM events').get().c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM event_targets').get().c, 2);
  assert.equal(
    JSON.parse(db.prepare("SELECT value FROM meta WHERE key='totals'").get().value).transferLoss, 7);
  db.close();
});
