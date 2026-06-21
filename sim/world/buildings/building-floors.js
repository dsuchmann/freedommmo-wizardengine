// Deterministic vertical structure for a building: how many floors it has and
// what each floor is for. Pure f(seed, building identity, category, tier, centrality).
// Part of the multi-floor building model (spec 2026-06-18). No sibling reads:
// a building's floors depend only on the world seed, its own position+type, and
// coarser ancestor values (settlement tier, lot centrality).

import { TIER_NAMES } from './tiers.js';
import { rand } from '../../kernel/rng.js';

const TIER_RANK = {};
TIER_NAMES.forEach((t, i) => { TIER_RANK[t] = i; });
TIER_RANK.ruins = -1;
const MAX_TIER = Math.max(1, TIER_NAMES.length - 1);

// Baseline above-ground floor range [min, max] per building category (village-ish, central).
const FLOOR_PROFILE = {
  apartment: [2, 5], residential: [1, 3], house: [1, 2],
  commercial: [1, 2], market: [1, 2], craft: [1, 2],
  civic: [1, 3], religious: [1, 2], military: [1, 3],
  agricultural: [1, 1], entertainment: [1, 2], harbor: [1, 1],
};
const DEFAULT_PROFILE = [1, 2];

// Per-TYPE floor range — a building's height is mostly a property of WHAT it is, not just its
// category. Single-family dwellings stay low; apartments/towers/landmarks rise. Types absent
// here fall back to the category profile above. (Coherence fix 2026-06-20: a "hut" was hitting
// 5+ floors because the category profile + a flat stretch ignored the type.)
const FLOOR_BY_TYPE = {
  hut: [1, 1], cottage: [1, 2], house: [1, 2], longhouse: [1, 2],
  manor: [2, 3], villa: [2, 3], apartment: [3, 6],
  market_stall: [1, 1], shop: [1, 2], warehouse: [1, 2], trading_post: [1, 2],
  bazaar: [1, 1], tavern: [1, 2], inn: [2, 4],
  shrine: [1, 1], chapel: [1, 2], temple: [2, 4], monastery: [2, 3],
  town_hall: [1, 3], courthouse: [2, 3], library: [1, 3], prison: [1, 3],
  watchtower: [3, 7], lighthouse: [5, 9], barracks: [1, 3],
  barn: [1, 1], stable: [1, 1], coop: [1, 1], greenhouse: [1, 1],
  silo: [3, 5], mill: [1, 2], granary: [1, 2],
  theater: [1, 2], arena: [1, 2], garden: [1, 1], park: [1, 1], feast_hall: [1, 2],
  // single-feature "buildings" — not multi-storey structures
  well: [1, 1], fountain: [1, 1], altar: [1, 1], monument: [1, 1], waystone: [1, 1],
  gate: [1, 1], dock: [1, 1], bridge: [1, 1], shrine_small: [1, 1],
};

// Categories that can have a basement (and max depth).
const BASEMENT_DEPTH = {
  apartment: 1, residential: 1, commercial: 1, market: 1, craft: 1,
  military: 2, religious: 2, civic: 1,
};

const MAX_FLOORS = 100; // rare great-city landmark cap

/** Above-ground floor count + full floor range (incl. basements).
 *  Returns { floorRange:[minFloor,maxFloor], aboveGroundFloors }.
 *  Ground (index 0) always exists; minFloor <= 0; aboveGroundFloors = count of indices >= 0. */
export function floorCount(seed, bx, by, category, tier, centrality, typeId) {
  const prof = (typeId && FLOOR_BY_TYPE[typeId]) || FLOOR_PROFILE[category] || DEFAULT_PROFILE;
  const tierBoost = Math.max(0, (TIER_RANK[tier] ?? 0)) / MAX_TIER; // 0..1
  const c = Math.max(0, Math.min(1, centrality ?? 0));

  // Stretch the type's OWN range by how big/central the lot is — no flat +N (that turned a hut
  // into a tower). A 1-floor type (span 0) never grows; tall types (apartment/tower) grow more.
  const stretch = Math.round((prof[1] - prof[0]) * (0.5 * tierBoost + 0.5 * c));
  const lo = prof[0], hi = prof[1] + stretch;
  const r0 = rand(seed, bx * 31 + 7, by * 17 + 3);
  let aboveGround = lo + Math.floor(r0 * (hi - lo + 1));

  // Rare landmark tower: only for types that can ALREADY be tall (prof max >= 3), large central lots.
  if (prof[1] >= 3 && tierBoost > 0.6 && c > 0.7 && rand(seed, bx * 53 + 11, by * 23 + 5) > 0.97) {
    const tall = 12 + Math.floor(rand(seed, bx * 71 + 13, by * 29 + 9) * (MAX_FLOORS - 12));
    aboveGround = Math.max(aboveGround, tall);
  }
  aboveGround = Math.max(1, Math.min(MAX_FLOORS, aboveGround));

  // Basement.
  let minFloor = 0;
  const bd = BASEMENT_DEPTH[category] || 0;
  if (bd > 0 && rand(seed, bx * 41 + 17, by * 19 + 13) > 0.5) {
    minFloor = -Math.min(bd + (tierBoost > 0.5 ? 1 : 0), 3);
  }

  return { floorRange: [minFloor, aboveGround - 1], aboveGroundFloors: aboveGround };
}

/** The per-index use plan, computed ONCE on the building so floors read their use
 *  by index (never consulting sibling floors). Returns [{ index, use }] over floorRange. */
export function floorStackPlan(seed, floorRange, category) {
  const [min, max] = floorRange;
  const plan = [];
  for (let i = min; i <= max; i++) {
    let use;
    if (i < 0) {
      use = (category === 'religious') ? 'crypt' : 'storage';
    } else if (i === 0) {
      if (category === 'religious') use = 'hall';
      else if (category === 'commercial' || category === 'market' || category === 'craft') use = 'shopfront';
      else use = 'lobby';
    } else if (category === 'residential' || category === 'apartment' || category === 'house') {
      use = 'residential';
    } else if (category === 'religious') {
      use = 'gallery';
    } else if (category === 'commercial' || category === 'market') {
      use = (i <= 1) ? 'commercial' : 'residential'; // mixed-use above the shop
    } else {
      use = category;
    }
    plan.push({ index: i, use });
  }
  return plan;
}

export { TIER_RANK, MAX_FLOORS };
