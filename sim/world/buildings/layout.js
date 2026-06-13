// sim/world/buildings/layout.js -- World Compiler Phase B: district layout + building placement.
// Pure functions: seed + site + tier -> complete building catalog with positions.
// No kernel state, no classifyBiome, no tileCost. All spatial decisions via seeded noise.

import { rand, mix } from '../../kernel/rng.js';
import { typesForTier, typesInCategory } from './taxonomy.js';
import { generateFootprint } from './footprints.js';

// ── District configurations by tier ──────────────────────────────────

export const DISTRICT_CONFIGS = {
  village: [
    { kind: 'residential', weight: 0.6, anchor: 'cottage' },
    { kind: 'craft',       weight: 0.4, anchor: 'blacksmith' },
  ],
  town: [
    { kind: 'residential', weight: 0.30, anchor: 'house' },
    { kind: 'market',      weight: 0.20, anchor: 'shop' },
    { kind: 'craft',       weight: 0.20, anchor: 'blacksmith' },
    { kind: 'civic',       weight: 0.15, anchor: 'town_hall' },
    { kind: 'religious',   weight: 0.15, anchor: 'chapel' },
  ],
  city: [
    { kind: 'residential',   weight: 0.20, anchor: 'house' },
    { kind: 'market',        weight: 0.15, anchor: 'bazaar' },
    { kind: 'craft',         weight: 0.15, anchor: 'blacksmith' },
    { kind: 'civic',         weight: 0.10, anchor: 'town_hall' },
    { kind: 'religious',     weight: 0.10, anchor: 'temple' },
    { kind: 'military',      weight: 0.10, anchor: 'barracks' },
    { kind: 'agricultural',  weight: 0.10, anchor: 'barn' },
    { kind: 'entertainment', weight: 0.10, anchor: 'garden' },
  ],
};

// Settlement radius by tier (in tiles from center).
const TIER_RADIUS = { village: 24, town: 40, city: 64 };

// ── District assignment ──────────────────────────────────────────────

/**
 * Assign districts as radial sectors from settlement center.
 * Civic is innermost (small radius, full circle at center).
 * Other districts are angular wedges with noise-displaced boundaries.
 *
 * @param {number} seed
 * @param {{x:number, y:number}} site  Settlement center
 * @param {string} tier  'village' | 'town' | 'city'
 * @param {string} race
 * @param {string} biome
 * @returns {Array<{kind, angleStart, angleEnd, radius, innerRadius, anchor}>}
 */
export function assignDistricts(seed, site, tier, race, biome) {
  const configs = DISTRICT_CONFIGS[tier] ?? DISTRICT_CONFIGS.village;
  const maxRadius = TIER_RADIUS[tier] ?? TIER_RADIUS.village;
  const ds = mix(seed, site.x, site.y, 0xD1);

  // Civic gets a central circle (innermost ring); others get radial wedges outside it.
  const civicIdx = configs.findIndex(c => c.kind === 'civic');
  const hasCivic = civicIdx >= 0;
  const civicRadius = hasCivic ? Math.floor(maxRadius * 0.25) : 0;

  const outerConfigs = hasCivic
    ? configs.filter(c => c.kind !== 'civic')
    : configs;

  // Divide 2*PI among outer districts, weighted by their weight field.
  // Noise-displace each boundary by +/- up to 15 degrees.
  const totalWeight = outerConfigs.reduce((s, c) => s + c.weight, 0);
  let angle = rand(ds, 0xA001) * Math.PI * 2; // seeded rotation offset
  const districts = [];

  if (hasCivic) {
    districts.push({
      kind: 'civic',
      angleStart: 0,
      angleEnd: Math.PI * 2,
      radius: civicRadius,
      innerRadius: 0,
      anchor: configs[civicIdx].anchor,
    });
  }

  for (let i = 0; i < outerConfigs.length; i++) {
    const c = outerConfigs[i];
    const span = (c.weight / totalWeight) * Math.PI * 2;
    // Noise displacement on boundary: +/- 0.26 rad (~15 degrees)
    const noise = (rand(ds, 0xA010, i) - 0.5) * 0.52;
    const start = angle + noise;
    const end = angle + span;
    districts.push({
      kind: c.kind,
      angleStart: start,
      angleEnd: end,
      radius: maxRadius,
      innerRadius: hasCivic ? civicRadius : 0,
      anchor: c.anchor,
    });
    angle += span;
  }

  return districts;
}
