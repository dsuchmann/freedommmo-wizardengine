// sim/test/server.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { SimServer } from '../server/server.js';
import { Kernel } from '../kernel/kernel.js';
import { spawnMeadow } from '../world/spawn.js';
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
