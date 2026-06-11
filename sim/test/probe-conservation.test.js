import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { spawnMeadow } from '../world/spawn.js';
import { DAY } from '../time/metabolism.js';

test('PROBE 1: full meadow, 90 sim-days — economy neither mints nor leaks', () => {
  const k = new Kernel({ seed: 42, phi: 4, bounds: { x0: 0, y0: 0, w: 16, h: 16 } });
  spawnMeadow(k, { x0: 0, y0: 0, w: 16, h: 16 });
  const start = k.stocks(0);
  k.runTo(90 * DAY);
  const end = k.stocks(90 * DAY);
  const t = k.ledger.totals;
  const lhs = end - start;
  const rhs = t.captured - t.burned - t.decayed - t.transferLoss;
  const scale = Math.max(Math.abs(t.captured), 1);
  assert.ok(Math.abs(lhs - rhs) / scale < 1e-9,
    `conservation violated: Δstocks=${lhs} flows=${rhs} (rel err ${(Math.abs(lhs - rhs) / scale)})`);
});
