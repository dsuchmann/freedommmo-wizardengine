// sim/items/items.js — M5: pure item math. Tool power and durability are DERIVED
// from grain composition (physics-not-permission: no item-type tables, no "axe" checks).
// hp is not E: wear never touches the ledger (M2 precedent).
import { GRAINS } from '../matter/grains.js';

export const HP_SCALE = 100;      // maxHp = HP_SCALE × unit-weighted stability
export const WEAR_PER_USE = 10;   // hp lost per tool-assisted verb use

/** Unit-weighted mean of a grain property over a composition. 0 when empty. */
function weighted(composition, prop) {
  let units = 0, sum = 0;
  for (const [g, u] of Object.entries(composition ?? {})) {
    const def = GRAINS[g];
    if (!def || u <= 0) continue;
    units += u; sum += u * def[prop];
  }
  return units === 0 ? 0 : sum / units;
}

/** Tool power of an inventory item: unit-weighted hardness. 0 for no item / no grains. */
export function toolPowerOf(item) {
  return weighted(item?.grains, 'hardness');
}

/** Durability ceiling of an item: HP_SCALE × unit-weighted stability. */
export function maxHpOf(item) {
  return HP_SCALE * weighted(item?.grains, 'stability');
}
