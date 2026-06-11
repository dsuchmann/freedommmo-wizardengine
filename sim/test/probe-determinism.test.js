import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { spawnMeadow } from '../world/spawn.js';
import { openDb, canonicalDump } from '../store/db.js';
import { DAY } from '../time/metabolism.js';

function runWorld(seed) {
  const k = new Kernel({ seed, phi: 4, bounds: { x0: 0, y0: 0, w: 12, h: 12 } });
  spawnMeadow(k, { x0: 0, y0: 0, w: 12, h: 12 });
  k.runTo(60 * DAY);
  const db = openDb(':memory:');
  // ledger (events) must be flushed before graph (nodes) because nodes.created_by_event
  // is a FK → events(id); inserting nodes first violates the constraint.
  k.ledger.flush(db);
  k.graph.flush(db);
  k.scheduler.flush(db);
  const dump = canonicalDump(db);
  db.close();
  return dump;
}

test('PROBE 4: same seed twice — canonically identical worlds', () => {
  assert.equal(runWorld(42), runWorld(42));
});

test('PROBE 4b: different seeds — different worlds', () => {
  assert.notEqual(runWorld(42), runWorld(43));
});
