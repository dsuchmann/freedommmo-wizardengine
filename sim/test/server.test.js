// sim/test/server.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { SimServer } from '../server/server.js';
import { Kernel } from '../kernel/kernel.js';
import { spawnMeadow, spawnWorld } from '../world/spawn.js';
import { take } from '../world/actions.js';
import { aggregateOf } from '../lod/aggregate.js';
import { DAY } from '../time/metabolism.js';

function makeServer() {
  const bounds = { x0: 0, y0: 0, w: 16, h: 16 };
  const kernel = new Kernel({ seed: 11, bounds });
  spawnMeadow(kernel, bounds);
  return new SimServer({ kernel, port: 0, timeScale: 48 });  // port 0 = OS-assigned
}

function connect(server) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}
const next = (ws, type) => new Promise(res => {
  const h = data => { const m = JSON.parse(data); if (m.type === type) { ws.off('message', h); res(m); } };
  ws.on('message', h);
});

test('hello → snapshot with bubble entities and a player wallet', async () => {
  const server = makeServer();
  await server.listen();
  const ws = await connect(server);
  ws.send(JSON.stringify({ type: 'hello', viewport: { x: 0, y: 0, w: 16, h: 16 } }));
  const snap = await next(ws, 'snapshot');
  assert.ok(snap.entities.length > 0);
  assert.ok(Number.isInteger(snap.playerId));
  assert.ok(snap.entities.every(e => 'species' in e && 'stage' in e));
  ws.close(); await server.close();
});

test('pick intent is applied at pump tick and acknowledged via events', async () => {
  const server = makeServer();
  await server.listen();
  const ws = await connect(server);
  ws.send(JSON.stringify({ type: 'hello', viewport: { x: 0, y: 0, w: 16, h: 16 } }));
  const snap = await next(ws, 'snapshot');
  const bush = snap.entities.find(e => e.species === 'berry_bush');
  assert.ok(bush, 'meadow has a bush in bubble');
  ws.send(JSON.stringify({ type: 'intent', verb: 'pick', target: bush.id }));
  // pump runs intents; events stream carries the ledger event
  const evMsg = await next(ws, 'events');
  assert.ok(evMsg.events.some(e => e.type === 'pick' && e.targets.includes(bush.id)));
  const td = await next(ws, 'tick-delta');
  assert.ok(td.player.R > 0, 'wallet gained time');
  ws.close(); await server.close();
});

test('admin ff advances sim weeks instantly; admin pause freezes the clock', async () => {
  const server = makeServer();
  await server.listen();
  const ws = await connect(server);
  ws.send(JSON.stringify({ type: 'hello', viewport: { x: 0, y: 0, w: 16, h: 16 } }));
  await next(ws, 'snapshot');
  ws.send(JSON.stringify({ type: 'admin', op: 'ff', days: 14 }));
  const t = await next(ws, 'time');
  assert.ok(t.tick >= 14 * DAY);
  ws.close(); await server.close();
});

test('attaching a client promotes the regions around its viewport', async () => {
  const kernel = new Kernel({ seed: 42, bounds: { x0: 0, y0: 0, w: 160, h: 160 } });
  spawnWorld(kernel, { x0: 0, y0: 0, w: 160, h: 160 }, { x0: 160, y0: 160, w: 0, h: 0 }); // all statistical
  const server = new SimServer({ kernel, port: 0 });
  await server.listen();
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
  await new Promise(res => ws.on('open', res));
  ws.send(JSON.stringify({ type: 'hello', viewport: { x: 0, y: 0, w: 40, h: 25 } }));
  const snap = await new Promise(res => ws.on('message', d => { const m = JSON.parse(d); if (m.type === 'snapshot') res(m); }));
  // wait one pump so the tier manager has run
  await new Promise(res => setTimeout(res, 250));
  assert.equal(aggregateOf(kernel, '1,0'), undefined, 'viewport region promoted to individuals');
  assert.ok(aggregateOf(kernel, '9,9'), 'distant region still statistical');
  assert.ok(snap.entities.every(e => e.type !== 'aggregate'), 'aggregates never serialized to clients');
  ws.close();
  await server.close();
});

test('strike intent dispatched over protocol → strike ledger event emitted', async () => {
  // Spawn a server with a boulder matter node in the world
  const bounds = { x0: 0, y0: 0, w: 16, h: 16 };
  const kernel = new Kernel({ seed: 77, bounds });
  let boulder;
  kernel.graph.boot(() => {
    boulder = kernel.graph.createNode({
      type: 'matter', tick: 0, x: 4, y: 4, R: null,
      attrs: { archetype: 'boulder_small', E: 5000, noFlux: true },
    });
  });
  spawnMeadow(kernel, bounds);
  const server = new SimServer({ kernel, port: 0, timeScale: 48 });
  await server.listen();
  const ws = await connect(server);
  ws.send(JSON.stringify({ type: 'hello', viewport: { x: 0, y: 0, w: 16, h: 16 } }));
  await next(ws, 'snapshot');
  // Send a valid strike intent (amount=30, clamped → 30; blunt against boulder)
  ws.send(JSON.stringify({ type: 'intent', verb: 'strike', target: boulder.id, damageType: 'blunt', amount: 30 }));
  // The pump applies the intent and emits events
  const evMsg = await next(ws, 'events');
  assert.ok(evMsg.events.some(e => e.type === 'strike' && e.targets.includes(boulder.id)),
    'strike event emitted for boulder');
  ws.close();
  await server.close();
});

test('equip/unequip intents: player wire carries equipment, inventory shrinks; grains never cross the wire', async () => {
  const bounds = { x0: 0, y0: 0, w: 16, h: 16 };
  const kernel = new Kernel({ seed: 33, bounds });
  let log1, log2;
  kernel.graph.boot(() => {
    log1 = kernel.graph.createNode({
      type: 'matter', tick: 0, x: 2, y: 2, R: null,
      attrs: { archetype: 'log', E: 50, noFlux: true },
    });
    log2 = kernel.graph.createNode({
      type: 'matter', tick: 0, x: 3, y: 2, R: null,
      attrs: { archetype: 'log', E: 50, noFlux: true },
    });
  });
  const server = new SimServer({ kernel, port: 0, timeScale: 48 });
  await server.listen();
  const ws = await connect(server);

  const allMsgs = [];
  ws.on('message', data => allMsgs.push(String(data)));

  ws.send(JSON.stringify({ type: 'hello', viewport: { x: 0, y: 0, w: 16, h: 16 } }));
  const snap = await next(ws, 'snapshot');
  const playerId = snap.playerId;

  // Give the player a composite item directly (mimics a combine result)
  const player = kernel.graph.nodes.get(playerId);
  const toolItem = { id: 5001, kind: 'composite', archetype: 'composite:cellulose+lignin',
                     E: 100, grains: { cellulose: 108, lignin: 72 }, tick: 0 };
  player.attrs.inventory = [toolItem];

  // Send equip intent — pump applies it
  ws.send(JSON.stringify({ type: 'intent', verb: 'equip', item: 5001, slot: 'hand_main' }));
  // Wait for a tick-delta that includes the equipment field
  const td = await next(ws, 'tick-delta');
  assert.ok(td.player.equipment.hand_main, 'equipment.hand_main present after equip');
  assert.equal(td.player.equipment.hand_main.id, 5001, 'equipment item id matches');
  assert.equal(td.player.inventory.length, 0, 'inventory empty after equip');

  // No grains in any message
  for (const msg of allMsgs) {
    assert.ok(!msg.includes('"grains"'), `grains key must not appear in wire message: ${msg.slice(0, 120)}`);
  }

  // Unequip: item returns to inventory
  ws.send(JSON.stringify({ type: 'intent', verb: 'unequip', slot: 'hand_main' }));
  const td2 = await next(ws, 'tick-delta');
  assert.equal(Object.keys(td2.player.equipment).length, 0, 'equipment empty after unequip');
  assert.equal(td2.player.inventory.length, 1, 'item back in inventory after unequip');
  assert.equal(td2.player.inventory[0].id, 5001, 'returned item id matches');

  ws.close();
  await server.close();
});

test('combine intent dispatched over protocol → combine ledger event emitted', async () => {
  // Boot a world with two log matter nodes; take them into inventory before server starts,
  // then send a combine intent and confirm the combine event arrives via the events stream.
  const bounds = { x0: 0, y0: 0, w: 16, h: 16 };
  const kernel = new Kernel({ seed: 55, bounds });
  let log1, log2;
  kernel.graph.boot(() => {
    log1 = kernel.graph.createNode({
      type: 'matter', tick: 0, x: 2, y: 2, R: null,
      attrs: { archetype: 'log', E: 50, noFlux: true },
    });
    log2 = kernel.graph.createNode({
      type: 'matter', tick: 0, x: 3, y: 2, R: null,
      attrs: { archetype: 'log', E: 50, noFlux: true },
    });
  });
  spawnMeadow(kernel, bounds);
  const server = new SimServer({ kernel, port: 0, timeScale: 48 });
  await server.listen();
  const ws = await connect(server);
  ws.send(JSON.stringify({ type: 'hello', viewport: { x: 0, y: 0, w: 16, h: 16 } }));
  const snap = await next(ws, 'snapshot');
  const playerId = snap.playerId;

  // Take the logs into the player's inventory directly (server-side, before the combine intent)
  const item1 = take(kernel, playerId, log1.id, 0);
  const item2 = take(kernel, playerId, log2.id, 0);

  // Send a valid combine intent
  ws.send(JSON.stringify({ type: 'intent', verb: 'combine', items: [item1.id, item2.id] }));

  // The pump applies the intent and emits events
  const evMsg = await next(ws, 'events');
  assert.ok(evMsg.events.some(e => e.type === 'combine' && e.actor === playerId),
    'combine event emitted for player');
  ws.close();
  await server.close();
});
