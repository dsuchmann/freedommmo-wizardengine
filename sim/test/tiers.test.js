import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { spawnMeadow, spawnWorld } from '../world/spawn.js';
import { aggregateOf, REGION, regionKeyOf } from '../lod/aggregate.js';
import { demoteRegion, promoteRegion } from '../lod/tiers.js';
import { createPlayer, pick } from '../world/actions.js';

const meadowKernel = (seed = 42) => {
  const k = new Kernel({ seed, bounds: { x0: 0, y0: 0, w: 16, h: 16 } });
  spawnMeadow(k, { x0: 0, y0: 0, w: 16, h: 16 });
  return k;
};

test('demotion folds individuals into an aggregate, conserving count and mass exactly', () => {
  const k = meadowKernel();
  k.runTo(30 * 86400);
  const living = [...k.graph.nodes.values()].filter(n => n.R != null);
  const expect = {};
  for (const n of living) {
    k.closeSegment(n, k.tick);
    const e = expect[n.attrs.species] ??= { count: 0, mass: 0 };
    e.count++; e.mass += Math.max(0, n.R) + n.attrs.body;
  }
  const before = k.stocks(k.tick);
  const agg = demoteRegion(k, '0,0', k.tick);
  assert.ok(agg, 'aggregate created');
  for (const [species, e] of Object.entries(expect)) {
    const p = agg.attrs.pops[species];
    assert.equal(p.count, e.count, species);
    assert.ok(Math.abs(p.sumR + p.sumBody - e.mass) < 1e-6, species);
  }
  assert.ok([...k.graph.nodes.values()].every(n => n.R == null || n.attrs.noFlux), 'no loose individuals');
  // demotion moves mass between tiers; it must not create or destroy any
  assert.ok(Math.abs(k.stocks(k.tick) - before) / Math.max(before, 1) < 1e-9);
  assert.ok(k.ledger.events.some(e => e.type === 'demote' && e.targets.includes(agg.id)));
});

test('pinned, player, group, and corpse nodes survive demotion individually', () => {
  const k = meadowKernel();
  k.runTo(10 * 86400);
  const player = createPlayer(k, k.tick);
  const bush = [...k.graph.nodes.values()].find(n => n.attrs.species === 'berry_bush');
  assert.ok(bush, 'meadow has a bush');
  pick(k, player.id, bush.id, k.tick);              // pick pins (named in a player ledger event)
  assert.equal(bush.attrs.pinned, true);
  let group;
  k.graph.boot(() => { group = k.graph.createNode({ type: 'group', tick: k.tick, x: 4, y: 4, attrs: {} }); });
  k.runTo(k.tick + 86400);
  demoteRegion(k, '0,0', k.tick);
  assert.ok(k.graph.nodes.get(bush.id), 'pinned bush still individual');
  assert.ok(k.graph.nodes.get(group.id), 'group node individual at every tier (spec 4.2)');
  assert.ok(k.graph.nodes.get(player.id), 'player untouched');
});

test('demoting an already-aggregated or empty region is a no-op', () => {
  const k = meadowKernel();
  demoteRegion(k, '0,0', 0);
  assert.equal(demoteRegion(k, '0,0', 0), null);    // nothing left to fold
  assert.equal(demoteRegion(k, '5,5', 0), null);    // empty region
});

test('promotion materializes exactly the aggregate truth (counts + mass), deterministically', () => {
  const k = new Kernel({ seed: 42, bounds: { x0: 0, y0: 0, w: 16, h: 16 } });
  spawnWorld(k, { x0: 0, y0: 0, w: 16, h: 16 }, { x0: 16, y0: 16, w: 0, h: 0 });  // all statistical
  k.runTo(100 * 86400);
  const agg = aggregateOf(k, '0,0');
  assert.ok(agg);
  // capture truth AFTER stepping to now (promotion steps internally; mirror it)
  const before = k.stocks(k.tick);
  const popsBefore = JSON.parse(JSON.stringify(agg.attrs.pops));
  const made = promoteRegion(k, '0,0', k.tick);
  assert.equal(aggregateOf(k, '0,0'), undefined, 'aggregate gone');
  for (const [species, p] of Object.entries(popsBefore)) {
    const kin = made.filter(n => n.attrs.species === species);
    assert.equal(kin.length, p.count, `${species} count honored`);
    const sumR = kin.reduce((s, n) => s + n.R, 0);
    const sumBody = kin.reduce((s, n) => s + n.attrs.body, 0);
    assert.ok(Math.abs(sumR - p.sumR) / Math.max(p.sumR, 1) < 1e-9, `${species} sumR exact`);
    assert.ok(Math.abs(sumBody - p.sumBody) / Math.max(p.sumBody, 1) < 1e-9, `${species} sumBody exact`);
    assert.ok(kin.every(n => regionKeyOf(n.x, n.y) === '0,0'), `${species} inside region`);
    assert.ok(kin.every(n => n.createdByEvent != null), 'provenance: caused by promote event');
  }
  assert.ok(Math.abs(k.stocks(k.tick) - before) / Math.max(before, 1) < 1e-9, 'promotion conserves');
  assert.ok(k.ledger.events.some(e => e.type === 'promote'));
});

test('promotion is deterministic: same world, same tick → identical individuals', () => {
  const run = () => {
    const k = new Kernel({ seed: 7, bounds: { x0: 0, y0: 0, w: 16, h: 16 } });
    spawnWorld(k, { x0: 0, y0: 0, w: 16, h: 16 }, { x0: 16, y0: 16, w: 0, h: 0 });
    k.runTo(50 * 86400);
    return JSON.stringify(promoteRegion(k, '0,0', k.tick)
      .map(n => [n.attrs.species, n.x, n.y, n.R, n.attrs.body, n.attrs.birthTick]));
  };
  assert.equal(run(), run());
});

test('demote → promote round trip conserves and repopulates', () => {
  const k = meadowKernel();
  k.runTo(30 * 86400);
  const before = k.stocks(k.tick);
  demoteRegion(k, '0,0', k.tick);
  const made = promoteRegion(k, '0,0', k.tick);
  assert.ok(made.length > 0);
  assert.ok(Math.abs(k.stocks(k.tick) - before) / Math.max(before, 1) < 1e-9);
  // promoted individuals live: they capture flux and survive further sim
  k.runTo(k.tick + 30 * 86400);
  assert.ok([...k.graph.nodes.values()].some(n => n.R != null));
});

test('promoting a region with no aggregate is a no-op', () => {
  const k = meadowKernel();
  assert.deepEqual(promoteRegion(k, '0,0', 0), []);
});
