// sim/test/protocol.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClientMsg, serializeEntity, serializeItem, snapshotMsg, tickDeltaMsg, eventsMsg, timeMsg } from '../server/protocol.js';

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

test('parseClientMsg: combine intent parses and validates items', () => {
  // valid combine: 2 distinct integers
  const m = parseClientMsg(JSON.stringify({ type: 'intent', verb: 'combine', items: [3, 7] }));
  assert.ok(m, 'valid combine parsed');
  assert.equal(m.verb, 'combine');
  assert.deepEqual(m.items, [3, 7]);
  // valid combine: up to 8 items
  const big = parseClientMsg(JSON.stringify({ type: 'intent', verb: 'combine', items: [1, 2, 3, 4, 5, 6, 7, 8] }));
  assert.ok(big, '8-item combine accepted');
  // invalid: non-array items
  assert.equal(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'combine', items: 'abc' })), null, 'non-array rejected');
  // invalid: fewer than 2
  assert.equal(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'combine', items: [1] })), null, '<2 rejected');
  // invalid: more than 8
  assert.equal(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'combine', items: [1,2,3,4,5,6,7,8,9] })), null, '>8 rejected');
  // invalid: duplicates
  assert.equal(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'combine', items: [5, 5] })), null, 'duplicates rejected');
  // invalid: non-integers
  assert.equal(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'combine', items: [1.5, 2] })), null, 'non-integer rejected');
  assert.equal(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'combine', items: ['a', 2] })), null, 'string rejected');
});

test('serializeEntity handles recipe nodes without leaking knownBy', () => {
  const recipeNode = {
    id: 42, type: 'recipe', x: null, y: null, R: null,
    attrs: { signature: 'log+log', form: 'composite:cellulose+lignin', knownBy: [1, 2], noFlux: true },
  };
  const wire = serializeEntity(recipeNode, 0);
  assert.equal(wire.id, 42);
  assert.equal(wire.type, 'recipe');
  assert.equal(wire.signature, 'log+log');
  assert.equal(wire.form, 'composite:cellulose+lignin');
  assert.equal(wire.knownBy, undefined, 'knownBy must NOT be serialized to clients');
});

test('serializeEntity: building → id/type/x/y/template/footprint/stamps; npcSlots stay private', () => {
  const node = {
    id: 9, type: 'building', x: 4, y: 4,
    attrs: {
      template: 'hut', footprint: { x0: 4, y0: 4, w: 5, h: 4 },
      stamps: [{ x: 4, y: 4, piece: 'wall', material: 'wattle', walkable: false }],
      npcSlots: [{ role: 'resident', workplace: null, sleep: 'bedroll' }],
      noFlux: true,
    },
  };
  const s = serializeEntity(node, 0);
  assert.deepEqual(s, {
    id: 9, type: 'building', x: 4, y: 4, template: 'hut',
    footprint: { x0: 4, y0: 4, w: 5, h: 4 },
    stamps: [{ x: 4, y: 4, piece: 'wall', material: 'wattle', walkable: false }],
  });
  assert.equal(s.npcSlots, undefined, 'npc slots are sim-internal, not render-relevant');
});

test('parseClientMsg: equip intent needs positive int item + known-shaped slot string', () => {
  assert.deepEqual(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'equip', item: 3, slot: 'hand_main' })),
    { type: 'intent', verb: 'equip', item: 3, slot: 'hand_main' });
  assert.equal(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'equip', item: 0, slot: 'hand_main' })), null);
  assert.equal(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'equip', item: 1.5, slot: 'hand_main' })), null);
  assert.equal(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'equip', item: 3, slot: 42 })), null);
  assert.equal(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'equip', item: 3 })), null);
});

test('parseClientMsg: unequip intent needs slot string', () => {
  assert.deepEqual(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'unequip', slot: 'hand_main' })),
    { type: 'intent', verb: 'unequip', slot: 'hand_main' });
  assert.equal(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'unequip' })), null);
});

test('serializeItem: id/kind/archetype/E/stage only — grains stay sim-side', () => {
  // hp=30, maxHp=62: ratio ≈ 0.484, which is > 0.40 and ≤ 0.75 → 'cracked'
  const item = { id: 7, kind: 'composite', archetype: 'composite:cellulose+lignin',
                 E: 100, grains: { cellulose: 108, lignin: 72 }, tick: 3, hp: 30, maxHp: 62 };
  assert.deepEqual(serializeItem(item),
    { id: 7, kind: 'composite', archetype: 'composite:cellulose+lignin', E: 100, stage: 'cracked' });
  // undamaged item (no hp tracking yet): stage 'intact'
  const fresh = { id: 8, kind: 'matter', archetype: 'pebble', E: 200, grains: { stone: 2 }, tick: 0 };
  assert.equal(serializeItem(fresh).stage, 'intact');
});

test('message builders stamp type and tick', () => {
  assert.equal(snapshotMsg(5, 1, [], []).type, 'snapshot');
  assert.equal(tickDeltaMsg(5, [], [], { R: 0 }).type, 'tick-delta');
  assert.deepEqual(tickDeltaMsg(5, [], [], { R: 0 }, [{ id: 1 }]).deltas, [{ id: 1 }]);  // live scars ride tick-delta
  assert.equal(eventsMsg(5, []).type, 'events');
  assert.deepEqual(timeMsg(86400), { type: 'time', tick: 86400, day: 1 });
});
