// sim/test/probe-wiring.test.js — Plan E probe: placements are entities; verbs are ledger events;
// deltas suppress baseline; inventory is embodied time; f(seed, deltas, ledger) is pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { DAY } from '../time/metabolism.js';
import { materializeRect } from '../world/wire.js';
import { createPlayer, harvest, take, eat } from '../world/actions.js';

// DEVIATION from plan text: plan used origin rect {0,0,16,16} which is ocean (zero placements).
// Relocated to known-good grassland rect per CONTEXT note and wire.test.js precedent.
const RECT = { x0: 938, y0: 0, w: 8, h: 8 };
const BOUNDS = { x0: 930, y0: 0, w: 24, h: 16 };
const makeKernel = () => new Kernel({ seed: 42, phi: 4, bounds: BOUNDS });

function boot(k) {
  k.graph.boot(() => materializeRect(k, RECT, 0));
  return createPlayer(k, 0);    // emits its own causal event — no boot scope
}
const wired = (k, pred) => [...k.graph.nodes.values()].filter(n => n.attrs?.placement && pred(n));

test('probe: harvest→eat conserves; take writes a suppressing delta; ledger explains everything', () => {
  const k = makeKernel();
  const player = boot(k);
  const start = k.stocks(0);
  const bush = wired(k, n => n.attrs.field === 'f4')[0];
  const pebble = wired(k, n => n.type === 'matter')[0];
  assert.ok(bush && pebble, 'rect must contain f3+f4 placements');
  const item = harvest(k, player.id, bush.id, 0);
  eat(k, player.id, item.id, 0);
  const taken = take(k, player.id, pebble.id, 0);
  assert.ok(taken);
  assert.ok(k.deltas.list.some(d => d.target === 'placement:' + pebble.attrs.placement));
  k.runTo(3 * DAY);
  const end = k.stocks(3 * DAY);
  const t = k.ledger.totals;
  const lhs = end - start;
  const rhs = t.captured - t.burned - t.decayed - t.transferLoss;
  const scale = Math.max(Math.abs(t.captured), 1);
  assert.ok(Math.abs(lhs - rhs) / scale < 1e-9,
    `conservation violated: Δstocks=${lhs} flows=${rhs}`);
});

test('probe: re-boot from same seed+deltas reproduces the world minus the taken placement', () => {
  const k1 = makeKernel();
  const p1 = boot(k1);
  const pebble = wired(k1, n => n.type === 'matter')[0];
  take(k1, p1.id, pebble.id, 0);
  const key = pebble.attrs.placement;
  // fresh kernel, replay the delta, boot again:
  const k2 = makeKernel();
  k2.deltas.push({ tick: 0, x: pebble.x, y: pebble.y, target: 'placement:' + key, kind: 'taken', attrs: {} });
  boot(k2);
  assert.equal(wired(k2, n => n.attrs.placement === key).length, 0);          // suppressed
  const keys = kk => new Set(wired(kk, () => true).map(n => n.attrs.placement));
  const k1keys = keys(k1); k1keys.delete(key);   // k1 already lost it to take()
  assert.deepEqual(keys(k2), k1keys);            // identical baseline otherwise
});
