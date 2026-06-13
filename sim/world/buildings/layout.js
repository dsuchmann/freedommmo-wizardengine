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

// ── Road spines ──────────────────────────────────────────────────────

/**
 * Generate road spines through districts.
 * A primary street runs through center; secondary streets branch into each district.
 * Each spine is a sequence of waypoints (not per-tile -- queried via distance check).
 *
 * @param {number} seed
 * @param {{x,y}} site  Settlement center
 * @param {Array} districts  From assignDistricts
 * @returns {Array<{tier, district, points: Array<{x,y}>}>}
 */
export function generateRoadSpines(seed, site, districts) {
  const rs = mix(seed, site.x, site.y, 0xAB01);
  const spines = [];
  const maxR = Math.max(...districts.map(d => d.radius));

  // Primary street: noise-displaced line through center, running at a seeded angle.
  const primaryAngle = rand(rs, 0xAB02) * Math.PI;  // 0..PI (a line, not a ray)
  const primaryLen = maxR * 0.9;
  const primaryPoints = [];
  const NUM_PRI_PTS = 9;  // odd count ensures one waypoint is exactly at center (t=0)
  for (let i = 0; i < NUM_PRI_PTS; i++) {
    const t = (i / (NUM_PRI_PTS - 1)) * 2 - 1;  // -1..+1 along the line
    const baseX = site.x + Math.cos(primaryAngle) * primaryLen * t;
    const baseY = site.y + Math.sin(primaryAngle) * primaryLen * t;
    // Noise displacement perpendicular to the line (skip at center for accuracy)
    const isCenter = Math.abs(t) < 0.01;
    const noiseAmp = isCenter ? 0 : maxR * 0.08;
    const nx = (rand(rs, 0xAB10, i) - 0.5) * noiseAmp;
    const ny = (rand(rs, 0xAB11, i) - 0.5) * noiseAmp;
    primaryPoints.push({ x: Math.round(baseX + nx), y: Math.round(baseY + ny) });
  }
  spines.push({ tier: 'street', district: null, points: primaryPoints });

  // Secondary streets: one per outer district, branching from center toward district midpoint.
  const outerDistricts = districts.filter(d => d.innerRadius > 0 || !districts.some(d2 => d2.kind === 'civic'));
  for (let i = 0; i < outerDistricts.length; i++) {
    const d = outerDistricts[i];
    const midAngle = (d.angleStart + d.angleEnd) / 2;
    const secPoints = [];
    const NUM_SEC_PTS = 5;
    for (let j = 0; j < NUM_SEC_PTS; j++) {
      const t = j / (NUM_SEC_PTS - 1);  // 0..1 from center outward
      const r = d.innerRadius + (d.radius - d.innerRadius) * t;
      const baseX = site.x + Math.cos(midAngle) * r;
      const baseY = site.y + Math.sin(midAngle) * r;
      const noiseAmp = maxR * 0.05;
      const nx = (rand(rs, 0xAB20, i, j) - 0.5) * noiseAmp;
      const ny = (rand(rs, 0xAB21, i, j) - 0.5) * noiseAmp;
      secPoints.push({ x: Math.round(baseX + nx), y: Math.round(baseY + ny) });
    }
    spines.push({ tier: 'alley', district: d.kind, points: secPoints });
  }

  return spines;
}
