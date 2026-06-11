import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { spawnMeadow } from '../world/spawn.js';

test('spawn is deterministic for a given seed and differs across seeds', () => {
  const desc = k => [...k.graph.nodes.values()]
    .map(n => `${n.type}@${n.x},${n.y}:R${n.R?.toFixed(2)}`).join('|');
  const k1 = new Kernel({ seed: 42 }); spawnMeadow(k1, { x0: 0, y0: 0, w: 16, h: 16 });
  const k2 = new Kernel({ seed: 42 }); spawnMeadow(k2, { x0: 0, y0: 0, w: 16, h: 16 });
  const k3 = new Kernel({ seed: 43 }); spawnMeadow(k3, { x0: 0, y0: 0, w: 16, h: 16 });
  assert.equal(desc(k1), desc(k2));
  assert.notEqual(desc(k1), desc(k3));
});

test('spawn produces a mixed population with baseline provenance', () => {
  const k = new Kernel({ seed: 42 });
  spawnMeadow(k, { x0: 0, y0: 0, w: 16, h: 16 });
  const types = new Set([...k.graph.nodes.values()].map(n => n.type));
  assert.ok(types.has('grass') && types.has('berry_bush'), 'flora present');
  for (const n of k.graph.nodes.values()) assert.equal(n.createdByEvent, null, 'all baseline');
  assert.ok(k.graph.nodes.size > 50, 'meaningful population');
});
