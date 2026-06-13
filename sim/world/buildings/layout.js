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

// ── Building budgets per district ────────────────────────────────────

// How many buildings a district gets, by tier.
const BUDGET = {
  village: { residential: 6,  craft: 3 },
  town:    { residential: 12, market: 6, craft: 6, civic: 3, religious: 3 },
  city:    { residential: 20, market: 10, craft: 10, civic: 5, religious: 5,
             military: 4, agricultural: 4, entertainment: 3 },
};

// Category mapping: which taxonomy categories fill each district kind.
const DISTRICT_CATEGORIES = {
  residential:   ['residential'],
  market:        ['commercial'],
  craft:         ['craft'],
  civic:         ['civic'],
  religious:     ['religious'],
  military:      ['military'],
  agricultural:  ['agricultural'],
  entertainment: ['entertainment'],
  harbor:        ['infrastructure', 'commercial'],
};

// ── Building placement ───────────────────────────────────────────────

/**
 * Place buildings along road spines within districts.
 * Anchor buildings placed first at district center, then fill along spines.
 * Returns flat array of placed buildings with world-space positions.
 *
 * @param {number} seed
 * @param {{x,y}} site  Settlement center
 * @param {string} tier
 * @param {string} race
 * @param {Array} districts
 * @param {Array} spines
 * @returns {Array<{x, y, footprint, district, isAnchor}>}
 */
export function placeBuildings(seed, site, tier, race, districts, spines) {
  const ps = mix(seed, site.x, site.y, 0xB001);
  const budget = BUDGET[tier] ?? BUDGET.village;
  const placed = [];
  const occupiedTiles = new Set();  // "wx,wy" keys for collision detection

  /** Check if a footprint at (wx, wy) collides with already-placed buildings.
   *  Includes a 1-tile gap for breathing room. */
  function wouldCollide(wx, wy, fp) {
    const bb = fp.boundingBox;
    for (let dy = -1; dy <= bb.h; dy++) {
      for (let dx = -1; dx <= bb.w; dx++) {
        if (occupiedTiles.has(`${wx + dx},${wy + dy}`)) return true;
      }
    }
    return false;
  }

  /** Mark a footprint's tiles as occupied. */
  function markOccupied(wx, wy, fp) {
    const bb = fp.boundingBox;
    for (let dy = 0; dy < bb.h; dy++) {
      for (let dx = 0; dx < bb.w; dx++) {
        occupiedTiles.add(`${wx + dx},${wy + dy}`);
      }
    }
  }

  /** Pick a building type from the allowed categories for this district kind. */
  function pickType(districtKind, idx) {
    const cats = DISTRICT_CATEGORIES[districtKind] ?? ['residential'];
    const available = typesForTier(tier).filter(t => cats.includes(t.category));
    if (available.length === 0) return null;
    const ti = Math.floor(rand(ps, 0xBB01, idx, districtKind.length) * available.length);
    return available[ti];
  }

  // Phase 1: Place anchor buildings at district centers.
  for (const d of districts) {
    if (!d.anchor) continue;
    const midAngle = (d.angleStart + d.angleEnd) / 2;
    const midR = (d.innerRadius + d.radius) * 0.4;  // closer to center
    const ax = Math.round(site.x + Math.cos(midAngle) * midR);
    const ay = Math.round(site.y + Math.sin(midAngle) * midR);
    const fp = generateFootprint(mix(ps, 0xBA00, ax, ay), d.anchor, race);
    if (!wouldCollide(ax, ay, fp)) {
      markOccupied(ax, ay, fp);
      placed.push({ x: ax, y: ay, footprint: fp, district: d.kind, isAnchor: true });
    }
  }

  const maxR = Math.max(...districts.map(d => d.radius));

  // Phase 2: Fill along road spines.
  let globalIdx = 0;
  for (const d of districts) {
    const count = budget[d.kind] ?? 3;
    const districtSpines = spines.filter(s => s.district === d.kind || s.district === null);
    let placedInDistrict = placed.filter(b => b.district === d.kind).length;

    for (const spine of districtSpines) {
      if (placedInDistrict >= count) break;
      // Walk along spine waypoints, placing buildings at intervals
      for (let pi = 0; pi < spine.points.length - 1 && placedInDistrict < count; pi++) {
        const p0 = spine.points[pi], p1 = spine.points[pi + 1];
        const segLen = Math.sqrt((p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2);
        if (segLen < 2) continue;

        // Place buildings along this segment with seeded spacing (scale down for small settlements)
        const spacing = Math.max(3, Math.floor(maxR * 0.15) + Math.floor(rand(ps, 0xBC01, globalIdx) * 3));
        const numSlots = Math.max(1, Math.floor(segLen / spacing));

        for (let si = 0; si < numSlots && placedInDistrict < count; si++) {
          const t = (si + 0.5) / Math.max(1, numSlots);
          const bx = Math.round(p0.x + (p1.x - p0.x) * t);
          const by = Math.round(p0.y + (p1.y - p0.y) * t);

          // Setback from road: perpendicular offset (1-4 tiles)
          const perpAngle = Math.atan2(p1.y - p0.y, p1.x - p0.x) + Math.PI / 2;
          const setback = 2 + Math.floor(rand(ps, 0xBC02, globalIdx, si) * 3);
          const side = rand(ps, 0xBC03, globalIdx, si) > 0.5 ? 1 : -1;
          const wx = Math.round(bx + Math.cos(perpAngle) * setback * side);
          const wy = Math.round(by + Math.sin(perpAngle) * setback * side);

          const type = pickType(d.kind, globalIdx + si);
          if (!type) { globalIdx++; continue; }

          const fp = generateFootprint(mix(ps, 0xBF00, wx, wy, globalIdx), type.id, race);
          if (!wouldCollide(wx, wy, fp)) {
            markOccupied(wx, wy, fp);
            placed.push({ x: wx, y: wy, footprint: fp, district: d.kind, isAnchor: false });
            placedInDistrict++;
          }
          globalIdx++;
        }
      }
    }

    // Phase 3: Scatter fill -- if spine placement didn't reach budget, place buildings
    // radially within the district wedge at noise-displaced positions.
    placedInDistrict = placed.filter(b => b.district === d.kind).length;
    let scatterIdx = 0;
    while (placedInDistrict < count && scatterIdx < count * 4) {
      const midAngle = (d.angleStart + d.angleEnd) / 2;
      const span = d.angleEnd - d.angleStart;
      const scatterAngle = midAngle + (rand(ps, 0xBD01, scatterIdx, d.kind.length) - 0.5) * span * 0.8;
      const rFrac = 0.3 + rand(ps, 0xBD02, scatterIdx, d.kind.length) * 0.6;
      const r = d.innerRadius + (d.radius - d.innerRadius) * rFrac;
      const wx = Math.round(site.x + Math.cos(scatterAngle) * r);
      const wy = Math.round(site.y + Math.sin(scatterAngle) * r);

      const type = pickType(d.kind, globalIdx + scatterIdx);
      scatterIdx++;
      if (!type) continue;

      const fp = generateFootprint(mix(ps, 0xBD10, wx, wy, scatterIdx), type.id, race);
      if (!wouldCollide(wx, wy, fp)) {
        markOccupied(wx, wy, fp);
        placed.push({ x: wx, y: wy, footprint: fp, district: d.kind, isAnchor: false });
        placedInDistrict++;
      }
    }
  }

  return placed;
}

// ── Layout cache ─────────────────────────────────────────────────────

const _layoutCache = new Map();  // "seed,mx,my" -> layout

/**
 * The public entry point: generate a complete settlement layout.
 * Pure f(seed, site, tier, race, biome) -> {districts, buildings, spines, queryTile}.
 * Cached per call-signature (intended: one per macro-cell).
 *
 * @param {number} seed
 * @param {{x,y}} site
 * @param {string} tier  'village' | 'town' | 'city'
 * @param {string} race
 * @param {string} biome
 * @returns {{districts, buildings, spines, site, tier, race, queryTile(x,y)}}
 */
export function layoutSettlement(seed, site, tier, race, biome) {
  const cacheKey = `${seed},${site.x},${site.y},${tier}`;
  if (_layoutCache.has(cacheKey)) return _layoutCache.get(cacheKey);

  const districts = assignDistricts(seed, site, tier, race, biome);
  const spines = generateRoadSpines(seed, site, districts);
  const buildings = placeBuildings(seed, site, tier, race, districts, spines);

  // Build spatial index for tile queries: Map<"x,y" -> building>
  const tileIndex = new Map();
  for (const b of buildings) {
    const bb = b.footprint.boundingBox;
    for (let dy = 0; dy < bb.h; dy++) {
      for (let dx = 0; dx < bb.w; dx++) {
        tileIndex.set(`${b.x + dx},${b.y + dy}`, b);
      }
    }
  }

  // Road tile index: tiles within 1 tile of any spine segment
  const roadTiles = new Set();
  for (const spine of spines) {
    for (let i = 0; i < spine.points.length - 1; i++) {
      const p0 = spine.points[i], p1 = spine.points[i + 1];
      const steps = Math.ceil(Math.sqrt((p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2));
      for (let s = 0; s <= steps; s++) {
        const t = steps > 0 ? s / steps : 0;
        const rx = Math.round(p0.x + (p1.x - p0.x) * t);
        const ry = Math.round(p0.y + (p1.y - p0.y) * t);
        roadTiles.add(`${rx},${ry}`);
        // Width of 2 for streets
        if (spine.tier === 'street') {
          roadTiles.add(`${rx + 1},${ry}`);
          roadTiles.add(`${rx},${ry + 1}`);
        }
      }
    }
  }

  /** Query what's at a specific tile. Returns null if nothing. */
  function queryTile(x, y) {
    const key = `${x},${y}`;
    const building = tileIndex.get(key);
    if (building) {
      // Determine if this tile is a wall, door, or floor within the footprint
      const lx = x - building.x, ly = y - building.y;
      const isWall = building.footprint.walls.some(w => w.x === lx && w.y === ly);
      const isDoor = building.footprint.doors.some(d => d.x === lx && d.y === ly);
      return { type: 'building', building, tileKind: isDoor ? 'door' : isWall ? 'wall' : 'floor' };
    }
    if (roadTiles.has(key)) {
      return { type: 'road', tier: 'street' };
    }
    return null;
  }

  const layout = { districts, buildings, spines, site, tier, race, queryTile };

  _layoutCache.set(cacheKey, layout);
  if (_layoutCache.size > 200) _layoutCache.clear();

  return layout;
}

/** Clear the layout cache (for testing). */
export function clearLayoutCache() { _layoutCache.clear(); }
