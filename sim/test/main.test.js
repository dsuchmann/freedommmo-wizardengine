import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootWorld } from '../server/main.js';
import { openDb } from '../store/db.js';
import { checkpoint } from '../store/checkpoint.js';
import { DAY } from '../time/metabolism.js';

test('bootWorld spawns baseline into an empty db, resumes from a saved one', () => {
  const db = openDb(':memory:');
  const k1 = bootWorld(db, { seed: 21 });
  assert.ok(k1.graph.nodes.size > 0, 'fresh world spawned');
  k1.runTo(5 * DAY);
  checkpoint(k1, db);
  const k2 = bootWorld(db, { seed: 21 });
  assert.equal(k2.tick, 5 * DAY);                       // resumed, not respawned
  assert.equal(k2.graph.nodes.size, k1.graph.nodes.size);
});
