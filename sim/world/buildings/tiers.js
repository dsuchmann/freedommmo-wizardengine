// sim/world/buildings/tiers.js — the canonical settlement-tier names, as a dependency
// -free LEAF module. Extracted from layout.js so structural consumers (building-floors,
// shapes, …) can read the tier ladder WITHOUT importing layout.js — which would create a
// cycle (layout → footprints → blueprint-node → building-floors → layout). layout.js
// re-exports these for back-compat, so existing importers are unaffected.

export const TIER_NAMES = [
  'homestead', 'hamlet', 'village', 'township', 'town', 'borough',
  'city', 'great_city', 'capital', 'metropolis', 'megacity', 'world_capital',
];

/** Map tier name to 1-based tier number. */
export const TIER_INDEX = Object.fromEntries(TIER_NAMES.map((n, i) => [n, i + 1]));
