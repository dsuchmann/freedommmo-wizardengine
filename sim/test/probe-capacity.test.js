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
  const count = () => [...k.graph.nodes.values()].filter(n => n.type === 'grass').length;
  k.runTo(1 * YEAR);
  const p1 = count();
  k.runTo(2 * YEAR);
  const p2 = count();
  assert.ok(p1 < 400, `die-back happened (${p1})`);
  assert.ok(p2 > 20, `population survives (${p2}) — not extinction`);
  // stability: second year does not collapse or explode relative to first
  assert.ok(p2 > p1 * 0.3 && p2 < p1 * 3, `stable band: year1=${p1} year2=${p2}`);
});
