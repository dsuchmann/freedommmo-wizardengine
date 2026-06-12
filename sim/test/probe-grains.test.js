// sim/test/probe-grains.test.js — M1 probe: grain conservation identity
// Scenario: spawn meadow, player interacts (pick×3, harvest×2, take matter node,
// eat one item, chop tree), advance days for corpse decay, then auditGrains.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { spawnMeadow } from '../world/spawn.js';
import { createPlayer, pick, harvest, take, eat, chop } from '../world/actions.js';
import { DAY } from '../time/metabolism.js';
import { auditGrains } from '../matter/audit.js';

function runScenario(seed) {
  const bounds = { x0: 0, y0: 0, w: 20, h: 20 };
  const k = new Kernel({ seed, bounds });
  spawnMeadow(k, bounds);
  k.runTo(30 * DAY);    // let the meadow settle

  const player = createPlayer(k, k.tick);

  // pick berry_bush 3×
  const bush = [...k.graph.nodes.values()].find(n => n.attrs.species === 'berry_bush');
  assert.ok(bush, 'meadow grew a berry_bush');
  pick(k, player.id, bush.id, k.tick);
  pick(k, player.id, bush.id, k.tick);
  pick(k, player.id, bush.id, k.tick);

  // harvest 2× (places items in inventory)
  const bush2 = [...k.graph.nodes.values()].find(
    n => n.attrs.species === 'berry_bush' && (n.attrs.body + (n.R ?? 0)) > 0
  );
  if (bush2) {
    harvest(k, player.id, bush2.id, k.tick);
    harvest(k, player.id, bush2.id, k.tick);
  }

  // take an F3 matter node — create one if meadow didn't spawn one
  let matterNode = [...k.graph.nodes.values()].find(n => n.type === 'matter');
  if (!matterNode) {
    k.graph.boot(() => {
      matterNode = k.graph.createNode({
        type: 'matter', tick: k.tick, x: 5, y: 5, R: null,
        attrs: { archetype: 'boulder_small', E: 1000, noFlux: true },
      });
    });
  }
  const takenItem = take(k, player.id, matterNode.id, k.tick);
  assert.ok(takenItem, 'take returned an item');

  // eat one inventory item
  const inv = player.attrs.inventory ?? [];
  if (inv.length > 0) {
    eat(k, player.id, inv[0].id, k.tick);
  }

  // chop a tree (creates a corpse that will decay)
  const tree = [...k.graph.nodes.values()].find(n => n.attrs.species === 'tree');
  assert.ok(tree, 'meadow grew a tree');
  chop(k, player.id, tree.id, k.tick);

  // advance more days so corpse decay accrues grain:decayed:* counters
  k.runTo(k.tick + 360 * DAY);

  return { k, player };
}

test('probe M1: grain conservation audit is ok', () => {
  const { k } = runScenario(77);
  const result = auditGrains(k);

  // Overall ok
  assert.ok(result.ok === true,
    `auditGrains ok should be true; perGrain=${JSON.stringify(result.perGrain, null, 2)}`);

  // At least 3 grain types have expected > 0
  const nonzeroExpected = Object.values(result.perGrain).filter(g => g.expected > 0);
  assert.ok(nonzeroExpected.length >= 3,
    `expected ≥3 grain types with nonzero expected; got ${nonzeroExpected.length}: ${JSON.stringify(result.perGrain)}`);

  // At least one grain:decayed:* counter is > 0 (chopped tree decayed)
  const decayedEntries = Object.entries(result.perGrain).filter(([, v]) => v.decayed > 0);
  assert.ok(decayedEntries.length >= 1,
    `expected ≥1 grain:decayed:* > 0 (tree corpse should have decayed)`);
});

test('probe M1: determinism — two identical seeds produce identical audits', () => {
  const { k: k1 } = runScenario(77);
  const { k: k2 } = runScenario(77);
  const a1 = auditGrains(k1);
  const a2 = auditGrains(k2);
  assert.deepEqual(a1, a2, 'audit must be bit-identical across same-seed runs');
});
