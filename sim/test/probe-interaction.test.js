// sim/test/probe-interaction.test.js — Probe 6 (spec §6.2): the world answers to hands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { spawnMeadow } from '../world/spawn.js';
import { createPlayer, pick, chop } from '../world/actions.js';
import { DAY } from '../time/metabolism.js';

test('probe 6: pick gains time, chop fells, the stump-delta heals over weeks, conservation holds', () => {
  const bounds = { x0: 0, y0: 0, w: 20, h: 20 };
  const k = new Kernel({ seed: 77, bounds });
  spawnMeadow(k, bounds);
  k.runTo(30 * DAY);                       // let the meadow settle
  const player = createPlayer(k, k.tick);

  const start = k.stocks(k.tick);
  const startFlow = k.ledger.totals.captured - k.ledger.totals.burned
    - k.ledger.totals.decayed - k.ledger.totals.transferLoss;

  // pick the berry
  const bush = [...k.graph.nodes.values()].find(n => n.attrs.species === 'berry_bush');
  assert.ok(bush, 'meadow grew a bush');
  const gained = pick(k, player.id, bush.id, k.tick);
  assert.ok(gained > 0, 'picking gains time');

  // fell the tree
  const tree = [...k.graph.nodes.values()].find(n => n.attrs.species === 'tree');
  assert.ok(tree, 'meadow grew a tree');
  assert.ok(chop(k, player.id, tree.id, k.tick));
  const felled = k.deltas.list.find(d => d.kind === 'felled');
  assert.ok(felled, 'chop scarred the world');

  // weeks pass; the stump decays and the scar heals
  k.runTo(k.tick + 360 * DAY);
  assert.ok(!k.deltas.list.some(d => d.id === felled.id), 'felled delta healed');
  assert.ok(k.ledger.events.some(e => e.type === 'delta_healed'));

  // conservation across the whole interaction (probe 1 identity, spec §6.2.1)
  const end = k.stocks(k.tick);
  const endFlow = k.ledger.totals.captured - k.ledger.totals.burned
    - k.ledger.totals.decayed - k.ledger.totals.transferLoss;
  // Relative tolerance, same as probe 1: flows reach ~1e9 tu over 390 sim-days,
  // so an absolute epsilon would just measure float accumulation, not leaks.
  const scale = Math.max(Math.abs(k.ledger.totals.captured), 1);
  assert.ok(Math.abs((end - start) - (endFlow - startFlow)) / scale < 1e-9,
    `conservation: Δstocks=${end - start} Δflows=${endFlow - startFlow} (rel err ${Math.abs((end - start) - (endFlow - startFlow)) / scale})`);
});
