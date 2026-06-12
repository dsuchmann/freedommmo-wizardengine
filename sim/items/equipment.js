// sim/items/equipment.js — M5: equipment slots (atlas S3: 25+ slots, layering priority).
// SLOTS is authored data, like species — the no-mock rule forbids predefined RECIPES,
// not body topology. Worn items are positional state ONLY in M5 (no armor/warmth effects —
// honest absence until the systems that consume them exist). layer = draw/stack priority
// (low under high); future body rendering (Pass 4 L2) consumes it.
export const SLOTS = {
  head:           { layer: 30 },
  face:           { layer: 31 },
  ears:           { layer: 32 },
  eyes:           { layer: 33 },
  neck:           { layer: 25 },
  shoulders:      { layer: 24 },
  back:           { layer: 23 },
  chest:          { layer: 20 },
  torso_under:    { layer: 10 },
  arms:           { layer: 21 },
  wrist_left:     { layer: 26 },
  wrist_right:    { layer: 27 },
  hands:          { layer: 22 },
  finger_left_1:  { layer: 40 },
  finger_left_2:  { layer: 41 },
  finger_right_1: { layer: 42 },
  finger_right_2: { layer: 43 },
  waist:          { layer: 15 },
  legs:           { layer: 14 },
  legs_under:     { layer: 9 },
  ankle_left:     { layer: 12 },
  ankle_right:    { layer: 13 },
  feet:           { layer: 11 },
  hand_main:      { layer: 50 },   // wield slot: tools/weapons
  hand_off:       { layer: 51 },
  tattoo:         { layer: 1 },    // skin-layer adornments (SCI_FI archaeology)
  implant:        { layer: 0 },
};

/** Move an inventory item into an equipment slot. Fails honestly (false) on
 *  unknown slot, occupied slot, or missing item. Item E stays player-held
 *  (kernel.stocks counts equipment — conservation). */
export function equip(kernel, playerId, itemId, slot, tick) {
  const player = kernel.graph.nodes.get(playerId);
  if (!player || !SLOTS[slot]) return false;
  const eq = (player.attrs.equipment ??= {});
  if (eq[slot]) return false;
  const inv = player.attrs.inventory ?? [];
  const i = inv.findIndex(it => it.id === itemId);
  if (i < 0) return false;
  const [item] = inv.splice(i, 1);
  eq[slot] = item;
  kernel.ledger.emit({
    tick, type: 'equip', actor: playerId, targets: [],
    attrs: { itemId: item.id, slot, archetype: item.archetype ?? null },
  });
  return true;
}

/** Move an equipped item back to inventory. False if slot empty/unknown. */
export function unequip(kernel, playerId, slot, tick) {
  const player = kernel.graph.nodes.get(playerId);
  const eq = player?.attrs.equipment;
  if (!eq?.[slot]) return false;
  const item = eq[slot];
  delete eq[slot];
  (player.attrs.inventory ??= []).push(item);
  kernel.ledger.emit({
    tick, type: 'unequip', actor: playerId, targets: [],
    attrs: { itemId: item.id, slot, archetype: item.archetype ?? null },
  });
  return true;
}

/** The item in hand_main, or null. Verbs read this for tool modulation. */
export function wieldedItem(player) {
  return player?.attrs.equipment?.hand_main ?? null;
}
