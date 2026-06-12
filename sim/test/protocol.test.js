// sim/test/protocol.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClientMsg, serializeEntity, serializeItem, snapshotMsg, tickDeltaMsg, eventsMsg, timeMsg } from '../server/protocol.js';
import { nameOf } from '../life/identity.js';

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

test('parseClientMsg: move intent needs integer dx,dy in {-1,0,1}, not both 0', () => {
  assert.deepEqual(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'move', dx: 1, dy: 0 })),
    { type: 'intent', verb: 'move', dx: 1, dy: 0 });
  assert.deepEqual(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'move', dx: -1, dy: 1 })),
    { type: 'intent', verb: 'move', dx: -1, dy: 1 });
  assert.equal(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'move', dx: 0, dy: 0 })), null);
  assert.equal(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'move', dx: 2, dy: 0 })), null);
  assert.equal(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'move', dx: 0.5, dy: 0 })), null);
  assert.equal(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'move', dx: 1 })), null);
});

test('serializeEntity: path nodes expose id/type/x/y/wear only (no suppressDeltaIds)', () => {
  const node = { id: 9, type: 'path', x: 5, y: 4,
    attrs: { wear: 23, suppressDeltaIds: [3, 4], noFlux: true } };
  assert.deepEqual(serializeEntity(node), { id: 9, type: 'path', x: 5, y: 4, wear: 23 });
});

test('serializeEntity: road segments ride the matter branch — condition/suppressDeltaIds never on the wire', () => {
  const node = { id: 12, type: 'matter', x: 940, y: 8,
    attrs: { archetype: 'road_segment', E: 28.5, condition: 73, suppressDeltaIds: [5], noFlux: true } };
  const out = serializeEntity(node);
  assert.equal(out.archetype, 'road_segment');
  assert.equal(out.E, 28.5);
  assert.ok(!('condition' in out), 'condition stays sim-side');
  assert.ok(!('suppressDeltaIds' in out), 'internals stay sim-side');
});

test('serializeEntity: settlement wire form carries structure geometry, not sim internals', () => {
  const node = { id: 9, type: 'settlement', x: 935, y: 4, attrs: {
    tier: 'village', founderGroup: 3,
    territory: { x0: 930, y0: 0, w: 12, h: 10 },
    districts: [{ kind: 'residential', rect: { x0: 935, y0: 0, w: 6, h: 10 }, reason: 'west half' }],
    reasons: [{ axis: 'water', score: 0.9 }],
    noFlux: true, growthEnabled: true, peakBuildings: 2,
  } };
  const e = serializeEntity(node, 50);
  assert.deepEqual(e, {
    id: 9, type: 'settlement', x: 935, y: 4, tier: 'village',
    territory: { x0: 930, y0: 0, w: 12, h: 10 },
    districts: [{ kind: 'residential', rect: { x0: 935, y0: 0, w: 6, h: 10 } }],
  });
  // sim internals stay private: no founderGroup, reasons, growthEnabled, peakBuildings, noFlux
  assert.equal('founderGroup' in e, false);
  assert.equal('growthEnabled' in e, false);
});

test('serializeEntity: plot wire form carries rect + owner + district', () => {
  const node = { id: 12, type: 'plot', x: 935, y: 4, attrs: {
    rect: { x0: 935, y0: 4, w: 5, h: 4 }, settlement: 9, district: 'residential',
    owner: 3, noFlux: true,
  } };
  const e = serializeEntity(node, 50);
  assert.deepEqual(e, {
    id: 12, type: 'plot', x: 935, y: 4,
    rect: { x0: 935, y0: 4, w: 5, h: 4 }, district: 'residential', owner: 3, settlement: 9,
  });
});

test('L1 wire: humanoid living entities carry name; traits/attributes NEVER cross', () => {
  const node = {
    id: 31, type: 'human', x: 3, y: 4, R: 50000, lastTick: 0,
    attrs: { species: 'human', body: 15000, birthTick: 0 },
  };
  const e = serializeEntity(node, 0, 7);
  assert.equal(e.name, nameOf(7, 31, 'human'));
  assert.equal(e.traits, undefined, 'minds are private');
  assert.equal(e.attributes, undefined, 'minds are private');
});

test('L1 wire: non-humanoid living entities and seedless calls carry no name', () => {
  const grass = {
    id: 32, type: 'grass', x: 1, y: 1, R: 500, lastTick: 0,
    attrs: { species: 'grass', body: 10, birthTick: 0 },
  };
  assert.equal(serializeEntity(grass, 0, 7).name, undefined);
  const human = {
    id: 33, type: 'human', x: 1, y: 1, R: 500, lastTick: 0,
    attrs: { species: 'human', body: 100, birthTick: 0 },
  };
  assert.equal(serializeEntity(human, 0).name, undefined, 'no seed, no name (back-compat)');
});
