import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { DAY, YEAR } from '../time/metabolism.js';

test('PROBE 3: overpopulated meadow self-limits via flux competition alone', () => {
  const k = new Kernel({ seed: 5, phi: 4, bounds: { x0: 0, y0: 0, w: 4, h: 4 } });
  // 4x4 tiles, 400 grass = 25/tile — beyond φ-supported density (φ/burn-demand ≈ 13/tile)
  k.graph.boot(() => {
    for (let i = 0; i < 400; i++) {
      k.addLiving({
        species: 'grass', x: (i % 20) * 0.2, y: Math.floor(i / 20) * 0.2, R: 400, body: 20,
        tick: 0, age: 16 * DAY,
      });
    }
  });
  // P1 unbounded world: seeds also disperse beyond the meadow, so the GLOBAL grass count
  // grows by expansion — the self-limiting claim is about the overcrowded meadow itself.
  // Count only the original 4x4 tiles, and use day-scale checkpoints (starvation rationing
  // resolves overcrowding within weeks; multi-year runs now grow an ever-expanding frontier).
  const count = () => [...k.graph.nodes.values()]
    .filter(n => n.type === 'grass' && n.x >= 0 && n.x < 4 && n.y >= 0 && n.y < 4).length;
  k.runTo(120 * DAY);
  const p1 = count();
  k.runTo(240 * DAY);
  const p2 = count();
  assert.ok(p1 < 400, `die-back happened (${p1})`);
  assert.ok(p2 > 20, `population survives (${p2}) — not extinction`);
  // stability: the second interval does not collapse or explode relative to the first
  assert.ok(p2 > p1 * 0.3 && p2 < p1 * 3, `stable band: t1=${p1} t2=${p2}`);
});
