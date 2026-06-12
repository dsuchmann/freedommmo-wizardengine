// sim/test/server.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { SimServer } from '../server/server.js';
import { Kernel } from '../kernel/kernel.js';
import { spawnMeadow, spawnWorld } from '../world/spawn.js';
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
