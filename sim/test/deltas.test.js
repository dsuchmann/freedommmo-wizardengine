import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../store/db.js';
import { Deltas } from '../store/deltas.js';

test('deltas push/remove/flush/load round-trip', () => {
  const d = new Deltas();
  const a = d.push({ tick: 5, x: 1, y: 2, target: 'node:9', kind: 'felled' });
  const b = d.push({ tick: 6, x: 3, y: 4, target: 'corpse:9', kind: 'gone' });
  assert.equal(a, 1); assert.equal(b, 2);
  d.remove(a);                              // healed
  assert.equal(d.list.length, 1);
  const db = openDb(':memory:');
  d.flush(db);
  const d2 = Deltas.load(db);
  assert.deepEqual(d2.list, d.list);
  assert.equal(d2.nextDeltaId, 3);          // ids never reused after heal
});

test('kernel owns a Deltas store, not a plain array', async () => {
  const { Kernel } = await import('../kernel/kernel.js');
  const k = new Kernel({ seed: 1 });
  assert.ok(k.deltas instanceof Deltas);
});
