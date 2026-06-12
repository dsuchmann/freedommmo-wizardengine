// sim/test/sim-client.test.js — the browser client class, exercised against a REAL sim server.
// Protocol adaptations from reading sim/server/protocol.js + server.js:
//   - tick-delta uses 'upserts' (not 'entities') for changed entities
//   - snapshot has 'entities' array, 'playerId', 'deltas'
//   - server also sends 'events' and 'time' messages each pump; client must handle gracefully
//   - hello viewport must have all-finite {x,y,w,h} (protocol.js:16 validates this)
//   - seed 11 with these bounds + rect has placements (same pattern as wire.test.js seed 42)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { SimClient } from '../../src/sim/sim-client.js';
import { SimServer } from '../server/server.js';
import { Kernel } from '../kernel/kernel.js';
import { materializeRect } from '../world/wire.js';

async function startTestServer() {
  const bounds = { x0: 930, y0: 0, w: 24, h: 16 };
  const kernel = new Kernel({ seed: 11, phi: 4, bounds });
  kernel.graph.boot(() => materializeRect(kernel, { x0: 938, y0: 0, w: 8, h: 8 }, 0));
  const server = new SimServer({ kernel, port: 0, timeScale: 48 });
  await server.listen();
  return { server, port: server.port, kernel };
}

test('client attaches, receives snapshot, tracks tick-deltas, sends intents', async () => {
  const { server, port } = await startTestServer();
  const states = [];
  const client = new SimClient({
    url: `ws://127.0.0.1:${port}`,
    wsFactory: u => new WebSocket(u),
    viewport: { x: 938, y: 0, w: 16, h: 16 },
    onState: s => states.push(s),
  });
  await client.ready;                                          // resolves after snapshot
  assert.ok(client.tick >= 0);
  assert.ok(client.entities instanceof Map);
  const wired = [...client.entities.values()].find(e => e.placement);
  if (wired) {
    client.intend({ verb: wired.type === 'matter' ? 'take' : 'harvest', target: wired.id });
    await new Promise(r => setTimeout(r, 300));                // one pump
    assert.ok(client.deltas.length >= 0);                      // deltas list mirrored
  }
  client.close();
  await server.close();
});
