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
  assert.deepEqual(parseClientMsg(JSON.stringify({ type: 'viewport', viewport: { x: 5, y: 6, w: 80, h: 80 } })),
    { type: 'viewport', viewport: { x: 5, y: 6, w: 80, h: 80 } });
  assert.equal(parseClientMsg(JSON.stringify({ type: 'viewport', viewport: { x: 'NaN', y: 0, w: 1, h: 1 } })), null);
});

test('parseClientMsg rejects junk', () => {
  assert.equal(parseClientMsg('not json'), null);
  assert.equal(parseClientMsg(JSON.stringify({ type: 'evil' })), null);
  assert.equal(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'rm -rf' })), null);
  assert.equal(parseClientMsg(JSON.stringify({ type: 'admin', op: 'drop' })), null);
});

test('admin ff days is clamped to [1, 365]', () => {
  assert.equal(parseClientMsg(JSON.stringify({ type: 'admin', op: 'ff', days: 1e12 })).days, 365);
  assert.equal(parseClientMsg(JSON.stringify({ type: 'admin', op: 'ff', days: -3 })).days, 1);
});

test('serializeEntity sends only render-relevant fields', () => {
  const node = { id: 4, type: 'grass', x: 1.5, y: 2.5, R: 100, attrs: { species: 'grass', body: 20, birthTick: 0 } };
  const e = serializeEntity(node, 10);
  assert.deepEqual(Object.keys(e).sort(), ['ageTicks', 'body', 'bufferDays', 'id', 'species', 'stage', 'type', 'x', 'y']);
  assert.equal(e.stage, 'seedling');
});

test('parseClientMsg: strike intent parses and clamps amount to 50', () => {
  // valid strike
  const m = parseClientMsg(JSON.stringify({ type: 'intent', verb: 'strike', target: 9, damageType: 'blunt', amount: 30 }));
  assert.ok(m, 'valid strike parsed');
  assert.equal(m.verb, 'strike');
  assert.equal(m.target, 9);
  assert.equal(m.damageType, 'blunt');
  assert.equal(m.amount, 30);
  // amount clamped to 50
  const clamped = parseClientMsg(JSON.stringify({ type: 'intent', verb: 'strike', target: 9, damageType: 'sharp', amount: 9999 }));
  assert.equal(clamped.amount, 50, 'amount clamped to 50');
  // all four damage types accepted
  for (const dt of ['blunt', 'sharp', 'fire', 'frost']) {
    assert.ok(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'strike', target: 1, damageType: dt, amount: 10 })), `${dt} accepted`);
  }
  // invalid: unknown damageType
  assert.equal(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'strike', target: 1, damageType: 'poison', amount: 10 })), null);
  // invalid: amount 0 or negative
  assert.equal(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'strike', target: 1, damageType: 'blunt', amount: 0 })), null);
  assert.equal(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'strike', target: 1, damageType: 'blunt', amount: -5 })), null);
  // invalid: non-integer target
  assert.equal(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'strike', target: 1.5, damageType: 'blunt', amount: 10 })), null);
});

test('message builders stamp type and tick', () => {
  assert.equal(snapshotMsg(5, 1, [], []).type, 'snapshot');
  assert.equal(tickDeltaMsg(5, [], [], { R: 0 }).type, 'tick-delta');
  assert.deepEqual(tickDeltaMsg(5, [], [], { R: 0 }, [{ id: 1 }]).deltas, [{ id: 1 }]);  // live scars ride tick-delta
  assert.equal(eventsMsg(5, []).type, 'events');
  assert.deepEqual(timeMsg(86400), { type: 'time', tick: 86400, day: 1 });
});
