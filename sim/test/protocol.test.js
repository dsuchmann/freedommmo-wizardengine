// sim/test/protocol.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClientMsg, serializeEntity, snapshotMsg, tickDeltaMsg, eventsMsg, timeMsg } from '../server/protocol.js';

test('parseClientMsg accepts the four client message types', () => {
  assert.deepEqual(parseClientMsg(JSON.stringify({ type: 'hello', viewport: { x: 0, y: 0, w: 40, h: 25 } })),
    { type: 'hello', viewport: { x: 0, y: 0, w: 40, h: 25 } });
  assert.equal(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'pick', target: 7 })).verb, 'pick');
  assert.equal(parseClientMsg(JSON.stringify({ type: 'query', id: 3 })).id, 3);
  assert.equal(parseClientMsg(JSON.stringify({ type: 'admin', op: 'ff', days: 14 })).days, 14);
});

test('parseClientMsg rejects junk', () => {
  assert.equal(parseClientMsg('not json'), null);
  assert.equal(parseClientMsg(JSON.stringify({ type: 'evil' })), null);
  assert.equal(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'rm -rf' })), null);
  assert.equal(parseClientMsg(JSON.stringify({ type: 'admin', op: 'drop' })), null);
});

test('serializeEntity sends only render-relevant fields', () => {
  const node = { id: 4, type: 'grass', x: 1.5, y: 2.5, R: 100, attrs: { species: 'grass', body: 20, birthTick: 0 } };
  const e = serializeEntity(node, 10);
  assert.deepEqual(Object.keys(e).sort(), ['body', 'id', 'species', 'stage', 'type', 'x', 'y']);
  assert.equal(e.stage, 'seedling');
});

test('message builders stamp type and tick', () => {
  assert.equal(snapshotMsg(5, 1, [], []).type, 'snapshot');
  assert.equal(tickDeltaMsg(5, [], [], { R: 0 }).type, 'tick-delta');
  assert.equal(eventsMsg(5, []).type, 'events');
  assert.deepEqual(timeMsg(86400), { type: 'time', tick: 86400, day: 1 });
});
