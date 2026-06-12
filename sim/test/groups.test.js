// sim/test/groups.test.js — P2: group nodes (society's first collective) + contribute.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { createPlayer } from '../world/actions.js';
import { createGroup, contribute } from '../society/groups.js';
import { CHANNEL_EFF } from '../time/metabolism.js';

function makeKernel(seed = 7) {
  return new Kernel({ seed, bounds: { x0: 0, y0: 0, w: 16, h: 16 } });
}

test('P2 createGroup: wallet-shaped node with provenance; counted by stocks()', () => {
  const k = makeKernel();
  const g = createGroup(k, 0, { x: 5, y: 5 });
  assert.equal(g.type, 'group');
  assert.equal(g.R, 0);
  assert.equal(g.attrs.body, 0);
  assert.deepEqual(g.attrs.members, []);
  assert.ok(g.attrs.noFlux, 'groups are noFlux');
  const ev = k.ledger.events.at(-1);
  assert.equal(ev.type, 'group_founded');
  // stocks() must count group R (wallet shape): give it R inside the identity
  const p = createPlayer(k, 0, { x: 5, y: 5 });
  p.R = 100;                       // test arrangement: not conserved, so compare deltas below
  const base = k.stocks(0);
  assert.equal(contribute(k, p.id, g.id, 100, 0), true);
  assert.ok(g.R > 0, 'group received contribution');
  assert.ok(Math.abs(g.R - 100 * CHANNEL_EFF.gift) < 1e-9, 'gift channel efficiency applied');
  assert.equal(p.R, 0, 'member debited fully');
  // stocks dropped by exactly the transfer loss (counted in ledger)
  const after = k.stocks(0);
  assert.ok(Math.abs((base - after) - 100 * (1 - CHANNEL_EFF.gift)) < 1e-9,
    'only the channel loss left the world, and it is ledger-counted');
  assert.ok(Math.abs(k.ledger.totals.transferLoss - 100 * (1 - CHANNEL_EFF.gift)) < 1e-9);
  assert.ok(g.attrs.members.includes(p.id), 'contributor recorded as member');
});

test('P2 contribute refusals: insufficient R, missing nodes, bad amount — side-effect-free', () => {
  const k = makeKernel();
  const g = createGroup(k, 0, { x: 5, y: 5 });
  const p = createPlayer(k, 0, { x: 5, y: 5 });
  p.R = 10;
  const evCount = k.ledger.events.length;
  assert.equal(contribute(k, p.id, g.id, 50, 0), false, 'insufficient R');
  assert.equal(contribute(k, p.id, 99999, 10, 0), false, 'missing group');
  assert.equal(contribute(k, 99999, g.id, 10, 0), false, 'missing member');
  assert.equal(contribute(k, p.id, g.id, 0, 0), false, 'non-positive amount');
  assert.equal(contribute(k, p.id, g.id, -5, 0), false, 'negative amount');
  assert.equal(p.R, 10, 'member untouched');
  assert.equal(g.R, 0, 'group untouched');
  assert.equal(k.ledger.events.length, evCount, 'no events on refusal');
});
