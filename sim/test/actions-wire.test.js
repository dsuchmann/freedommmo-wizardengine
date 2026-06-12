// sim/test/actions-wire.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { createPlayer, harvest, take, eat } from '../world/actions.js';
import { materializeRect } from '../world/wire.js';

const makeKernel = () => new Kernel({ seed: 42, phi: 4, bounds: { x0: 930, y0: 0, w: 24, h: 16 } });

function bootWired(k) {
  k.graph.boot(() => materializeRect(k, { x0: 938, y0: 0, w: 8, h: 8 }, 0));
}
const findWired = (k, pred) => [...k.graph.nodes.values()].find(n => n.attrs?.placement && pred(n));

test('harvest moves embodied time into inventory, conserving through the transfer channel', () => {
  const k = makeKernel(); bootWired(k);
  const player = createPlayer(k, 0);          // createPlayer emits its own causal event — no boot scope needed (actions.js:8)
  const bush = findWired(k, n => n.attrs.field === 'f4');
  assert.ok(bush, 'wired rect contains f4');
  const before = bush.R + bush.attrs.body;
  const item = harvest(k, player.id, bush.id, 0);
  assert.ok(item && item.E > 0);
  assert.equal(player.attrs.inventory.length, 1);
  assert.ok(bush.R + bush.attrs.body < before);
  assert.equal(k.ledger.events.at(-1).type, 'harvest');   // ledger.events is a plain array (sim/store/ledger.js:7)
});

test('take removes the matter node, writes a placement delta, item holds its E', () => {
  const k = makeKernel(); bootWired(k);
  const player = createPlayer(k, 0);
  const pebble = findWired(k, n => n.type === 'matter');
  assert.ok(pebble, 'wired rect contains f3');
  const E = pebble.attrs.E, key = pebble.attrs.placement;
  const item = take(k, player.id, pebble.id, 0);
  assert.ok(item);
  assert.equal(k.graph.nodes.has(pebble.id), false);
  assert.ok(k.deltas.list.some(d => d.target === 'placement:' + key && d.kind === 'taken'));
  assert.ok(Math.abs(player.attrs.inventory[0].E - E) < 1e-9);       // take is lossless (no transfer channel: nothing metabolizes)
});

test('eat converts item E to player R through a lossy typed transfer', () => {
  const k = makeKernel();
  const player = createPlayer(k, 0);
  player.attrs.inventory ??= [];
  player.attrs.inventory.push({ id: 1, kind: 'harvest', E: 100, tick: 0 });
  const r0 = player.R;
  const gained = eat(k, player.id, 1, 0);
  assert.ok(gained > 0 && gained <= 100);
  assert.equal(player.R - r0, gained);
  assert.equal(player.attrs.inventory.length, 0);
});
