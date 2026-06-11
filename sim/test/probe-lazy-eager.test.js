import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { spawnMeadow } from '../world/spawn.js';
import { DAY } from '../time/metabolism.js';

function snapshot(k) {
  const map = new Map();
  for (const n of [...k.graph.nodes.values()].sort((a, b) => a.id - b.id)) {
    k.materialized(n.id);
    const v = n.type === 'corpse' ? n.attrs.E : n.R + n.attrs.body;
    map.set(n.id, { type: n.type, v });
  }
  return map;
}

test('PROBE 5: lazy and eager execution produce the same world', () => {
  const lazy = new Kernel({ seed: 9, phi: 4, bounds: { x0: 0, y0: 0, w: 8, h: 8 } });
  spawnMeadow(lazy, { x0: 0, y0: 0, w: 8, h: 8 });
  lazy.runTo(3 * DAY);

  const eager = new Kernel({ seed: 9, phi: 4, bounds: { x0: 0, y0: 0, w: 8, h: 8 } });
  spawnMeadow(eager, { x0: 0, y0: 0, w: 8, h: 8 });
  eager.runEagerTo(3 * DAY, 3600);   // force re-rate boundaries every sim-hour

  const a = snapshot(lazy);
  const b = snapshot(eager);
  assert.equal(a.size, b.size, 'same node count');
  for (const [id, sa] of a) {
    const sb = b.get(id);
    assert.ok(sb, `node ${id} exists in eager world`);
    assert.equal(sa.type, sb.type, `node ${id} same type`);
    // Float addition is non-associative: eager mode sums many small segments where
    // lazy sums one big one. Demand relative tolerance, not exact equality.
    const scale = Math.max(Math.abs(sa.v), Math.abs(sb.v), 1);
    assert.ok(Math.abs(sa.v - sb.v) / scale < 1e-6,
      `node ${id} value drift: lazy=${sa.v} eager=${sb.v}`);
  }
});
