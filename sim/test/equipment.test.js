// sim/test/equipment.test.js — M5: slots registry + equip/unequip + stocks conservation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { SLOTS, equip, unequip, wieldedItem } from '../items/equipment.js';
import { createPlayer } from '../world/actions.js';

function playerWithItem(itemOverrides = {}) {
  const k = new Kernel({ seed: 5, bounds: { x0: 0, y0: 0, w: 8, h: 8 } });
  const p = createPlayer(k, 0);
  const item = { id: 1, kind: 'matter', archetype: 'pebble', E: 200, grains: { stone: 2 }, tick: 0, ...itemOverrides };
  (p.attrs.inventory ??= []).push(item);
  return { k, p, item };
}

test('SLOTS: ≥25 slots, each with integer layer priority; hand_main and hand_off exist', () => {
  const names = Object.keys(SLOTS);
  assert.ok(names.length >= 25, `need ≥25 slots, got ${names.length}`);
  for (const [name, def] of Object.entries(SLOTS)) {
    assert.ok(Number.isInteger(def.layer), `slot ${name} has integer layer`);
  }
  assert.ok(SLOTS.hand_main && SLOTS.hand_off, 'wield slots exist');
});

test('equip moves item from inventory to equipment; emits equip event', () => {
  const { k, p, item } = playerWithItem();
  const ok = equip(k, p.id, item.id, 'hand_main', 0);
  assert.equal(ok, true);
  assert.equal(p.attrs.inventory.length, 0, 'item left inventory');
  assert.equal(p.attrs.equipment.hand_main.id, item.id, 'item in slot');
  const ev = k.ledger.events.at(-1);
  assert.equal(ev.type, 'equip');
  assert.equal(ev.actor, p.id);
  assert.deepEqual(ev.attrs, { itemId: item.id, slot: 'hand_main', archetype: 'pebble' });
});

test('equip fails honestly: unknown slot, occupied slot, missing item', () => {
  const { k, p, item } = playerWithItem();
  assert.equal(equip(k, p.id, item.id, 'third_arm', 0), false, 'unknown slot');
  assert.equal(equip(k, p.id, 999, 'hand_main', 0), false, 'missing item');
  assert.equal(equip(k, p.id, item.id, 'hand_main', 0), true);
  const item2 = { id: 2, kind: 'matter', archetype: 'pebble', E: 50, grains: { stone: 0.5 }, tick: 0 };
  p.attrs.inventory.push(item2);
  assert.equal(equip(k, p.id, item2.id, 'hand_main', 0), false, 'occupied slot');
  assert.equal(p.attrs.inventory.length, 1, 'failed equip leaves inventory intact');
});

test('unequip moves item back to inventory; emits unequip event; empty slot fails', () => {
  const { k, p, item } = playerWithItem();
  equip(k, p.id, item.id, 'hand_main', 0);
  assert.equal(unequip(k, p.id, 'hand_main', 1), true);
  assert.equal(p.attrs.inventory[0].id, item.id);
  assert.equal(p.attrs.equipment.hand_main, undefined);
  assert.equal(k.ledger.events.at(-1).type, 'unequip');
  assert.equal(unequip(k, p.id, 'hand_main', 2), false, 'empty slot');
});

test('wieldedItem returns hand_main item or null', () => {
  const { k, p, item } = playerWithItem();
  assert.equal(wieldedItem(p), null);
  equip(k, p.id, item.id, 'hand_main', 0);
  assert.equal(wieldedItem(p).id, item.id);
});

test('CONSERVATION: stocks unchanged across equip/unequip (equipped E still counted)', () => {
  const { k, p, item } = playerWithItem();
  const before = k.stocks(0);
  equip(k, p.id, item.id, 'hand_main', 0);
  assert.equal(k.stocks(0), before, 'equip must not change world stocks');
  unequip(k, p.id, 'hand_main', 1);
  assert.equal(k.stocks(0), before, 'unequip must not change world stocks');
});
