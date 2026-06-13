// sim/test/domestic.test.js — L4 domestication: tame verb + follow behavior.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { createPlayer, move, tame } from '../world/actions.js';

const BOUNDS = { x0: 0, y0: 0, w: 40, h: 40 };

function world() {
  const k = new Kernel({ seed: 7, bounds: BOUNDS });
  let rabbit, wolf;
  k.graph.boot(() => {
    rabbit = k.addLiving({ species: 'rabbit', x: 10, y: 10, R: 6000, body: 800, tick: 0 });
    wolf = k.addLiving({ species: 'wolf', x: 30, y: 30, R: 9000, body: 900, tick: 0 });   // far away: inert for these tests
  });
  const player = createPlayer(k, 0, { x: 11, y: 10 });
  player.R = 10000;
  return { k, player, rabbit, wolf };
}

test('tame: adjacency + sufficient offer creates a domestic edge and nurture transfer', () => {
  const { k, player, rabbit } = world();
  const beforeR = rabbit.R;
  assert.equal(tame(k, player.id, rabbit.id, 1000, 1), false, 'offer below minOffer refused');
  assert.ok(tame(k, player.id, rabbit.id, 2000, 2), 'sufficient offer accepted');
  assert.ok(player.R <= 10000 - 2000 + 1e-9, 'player paid');
  assert.ok(rabbit.R > beforeR, 'animal received nurture share');
  const ev = k.ledger.events.find(e => e.type === 'tame');
  assert.ok(ev && ev.actor === player.id && ev.targets.includes(rabbit.id));
  assert.equal(tame(k, player.id, rabbit.id, 2000, 3), false, 'already domestic: refused');
});

test('tame refusals: wrong species, not adjacent', () => {
  const { k, player, rabbit, wolf } = world();
  assert.equal(tame(k, player.id, wolf.id, 99999, 1), false, 'wolf is not tameable (also not adjacent)');
  // move player away from rabbit then try
  for (let i = 0; i < 3; i++) move(k, player.id, 1, 0, 1 + i);
  assert.equal(tame(k, player.id, rabbit.id, 2000, 5), false, 'not adjacent: refused');
});

test('follow: domestic rabbit drifts back toward a distant owner', () => {
  const { k, player, rabbit } = world();
  assert.ok(tame(k, player.id, rabbit.id, 2000, 1));
  for (let i = 0; i < 12; i++) move(k, player.id, 1, 0, 2 + i);   // player walks 12 east
  const before = Math.max(Math.abs(rabbit.x - player.x), Math.abs(rabbit.y - player.y));
  assert.ok(before > 6, 'owner out of follow radius');
  k.runTo(7 * 3600);   // one rabbit instinct decision
  const after = Math.max(Math.abs(rabbit.x - player.x), Math.abs(rabbit.y - player.y));
  assert.ok(after < before, `rabbit followed: ${before} -> ${after}`);
});
