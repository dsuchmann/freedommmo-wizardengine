// sim/world/buildings/footprints.js — World Compiler Phase A: complete footprint generator.
// Pure function: seed + typeId → full building description with walls, doors,
// floors, features, and bounding box.  No kernel state, no side effects.

import { rand, mix } from '../../kernel/rng.js';
import { typeById } from './taxonomy.js';
import { generatePattern } from './patterns.js';
import { generateInterior } from './interiors.js';
import { buildingNode } from './blueprint-node.js';

// ── tile math ─────────────────────────────────────────────────────────

/** Collect all (x, y) tiles covered by any section. */
function allTiles(sections) {
  const set = new Set();
  for (const s of sections) {
    for (let y = s.y0; y < s.y0 + s.h; y++) {
      for (let x = s.x0; x < s.x0 + s.w; x++) {
        set.add(`${x},${y}`);
      }
    }
  }
  return set;
}

/** Is (x, y) inside any section? */
function tileInSections(sections, x, y) {
  for (const s of sections) {
    if (x >= s.x0 && x < s.x0 + s.w && y >= s.y0 && y < s.y0 + s.h) return true;
  }
  return false;
}

/** Perimeter tiles — tiles with at least one 4-neighbour outside the footprint. */
function perimeterTiles(sections, tileSet) {
  const walls = [];
  for (const key of tileSet) {
    const [x, y] = key.split(',').map(Number);
    const up    = `${x},${y - 1}`;
    const down  = `${x},${y + 1}`;
    const left  = `${x - 1},${y}`;
    const right = `${x + 1},${y}`;
    if (!tileSet.has(up) || !tileSet.has(down) || !tileSet.has(left) || !tileSet.has(right)) {
      walls.push({ x, y });
    }
  }
  return walls;
}

/** Interior tiles — everything that is NOT on the perimeter. */
function interiorTiles(tileSet, wallSet) {
  const floors = [];
  for (const key of tileSet) {
    if (!wallSet.has(key)) {
      const [x, y] = key.split(',').map(Number);
      floors.push({ x, y });
    }
  }
  return floors;
}

/** Bounding box of sections. */
function boundingBox(sections) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of sections) {
    if (s.x0 < x0) x0 = s.x0;
    if (s.y0 < y0) y0 = s.y0;
    if (s.x0 + s.w > x1) x1 = s.x0 + s.w;
    if (s.y0 + s.h > y1) y1 = s.y0 + s.h;
  }
  return { x0, y0, w: x1 - x0, h: y1 - y0 };
}

// ── door placement ────────────────────────────────────────────────────

const MIN_DOOR_SPACING = 5;   // min tile distance between two doors (no clustering)
const DOOR_PER_TILES = 22;    // ~1 door per this many outer-perimeter tiles
const MAX_DOORS = 4;
// Minimum building dimension so even small buildings have a believable interior
// (5 => at least a 3x3 interior after the 1-tile wall ring).
const MIN_DIM = 5;

/** Tiles OUTSIDE the footprint, reachable from the bounding-box border by 4-way
 *  flood-fill over empty space. Enclosed courtyard holes are NOT reached, so this
 *  distinguishes the true outer edge from inner courtyard edges. */
function computeOutside(tileSet, bbox) {
  const minX = bbox.x0 - 1, minY = bbox.y0 - 1;
  const maxX = bbox.x0 + bbox.w, maxY = bbox.y0 + bbox.h; // inclusive ring
  const outside = new Set();
  const stack = [[minX, minY]];
  outside.add(`${minX},${minY}`);
  while (stack.length) {
    const [x, y] = stack.pop();
    const nbrs = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of nbrs) {
      if (nx < minX || ny < minY || nx > maxX || ny > maxY) continue;
      const key = `${nx},${ny}`;
      if (outside.has(key) || tileSet.has(key)) continue;
      outside.add(key);
      stack.push([nx, ny]);
    }
  }
  return outside;
}

/**
 * Place doors on the building's TRUE OUTER perimeter (never an inner courtyard
 * edge), preferring south-facing tiles, spaced at least MIN_DOOR_SPACING apart,
 * and capped by perimeter length — so no clusters of adjacent doors all opening
 * onto the same outdoor space. Returns array of { x, y }.
 */
function placeDoors(walls, wallSet, tileSet, seed, bbox) {
  const outside = computeOutside(tileSet, bbox);
  const isOuter = (w) =>
    outside.has(`${w.x},${w.y + 1}`) || outside.has(`${w.x},${w.y - 1}`) ||
    outside.has(`${w.x - 1},${w.y}`) || outside.has(`${w.x + 1},${w.y}`);
  const outerWalls = walls.filter(isOuter);
  if (outerWalls.length === 0) return [];

  const south = outerWalls.filter(w => outside.has(`${w.x},${w.y + 1}`));
  const pref = south.length ? south : outerWalls;

  // Deterministic order (seeded), then greedily place keeping spacing.
  const ordered = pref
    .map((w, i) => ({ w, k: rand(seed, 0xD001, w.x * 131 + w.y * 17 + i) }))
    .sort((a, b) => a.k - b.k)
    .map(o => o.w);

  const maxDoors = Math.max(1, Math.min(MAX_DOORS, Math.round(outerWalls.length / DOOR_PER_TILES)));
  const doors = [];
  for (const w of ordered) {
    if (doors.length >= maxDoors) break;
    if (doors.every(d => Math.abs(d.x - w.x) + Math.abs(d.y - w.y) >= MIN_DOOR_SPACING)) {
      doors.push({ x: w.x, y: w.y });
    }
  }
  if (doors.length === 0) doors.push({ x: ordered[0].x, y: ordered[0].y }); // always at least one
  return doors;
}

// ── feature placement ─────────────────────────────────────────────────

/**
 * Place features on available floor tiles.  Required features first.
 * Returns array of { type, x, y, required }.
 */
function placeFeatures(featureSpecs, floorTiles, seed) {
  if (floorTiles.length === 0 || featureSpecs.length === 0) return [];
  // sort: required first
  const sorted = [...featureSpecs].sort((a, b) => (b.required ? 1 : 0) - (a.required ? 1 : 0));
  const placed = [];
  const used = new Set();
  for (let i = 0; i < sorted.length; i++) {
    if (used.size >= floorTiles.length) break; // no more room
    let idx = Math.floor(rand(seed, 0xF001, i) * floorTiles.length);
    let attempts = 0;
    while (used.has(idx) && attempts < floorTiles.length) {
      idx = (idx + 1) % floorTiles.length;
      attempts++;
    }
    if (used.has(idx)) break;
    used.add(idx);
    const tile = floorTiles[idx];
    placed.push({ type: sorted[i].type, x: tile.x, y: tile.y, required: sorted[i].required });
  }
  return placed;
}

// ── main entry point ──────────────────────────────────────────────────

/**
 * Generate a complete building footprint.
 * @param {number} seed   Deterministic seed
 * @param {string} typeId Building type id from taxonomy
 * @param {string} [race] Optional race override
 * @param {string} [tier] Optional tier override
 * @returns {object|null}  Full footprint or null if typeId unknown
 */
export function generateFootprint(seed, typeId, race, tier) {
  const type = typeById(typeId);
  if (!type) return null;

  // 1. Determine size within type's range (scaled up 1.5× for visual presence on terrain)
  const SCALE = 1.5;
  const w = Math.max(MIN_DIM, Math.round((type.minW + Math.floor(rand(seed, 0x5001) * (type.maxW - type.minW + 1))) * SCALE));
  const h = Math.max(MIN_DIM, Math.round((type.minH + Math.floor(rand(seed, 0x5002) * (type.maxH - type.minH + 1))) * SCALE));

  // 2. Pick pattern from type's allowed patterns
  const patIdx = Math.floor(rand(seed, 0x5003) * type.patterns.length);
  const patternName = type.patterns[patIdx];

  // 3. Generate sections
  const patSeed = mix(seed, 0x5004);
  const { sections } = generatePattern(patternName, w, h, patSeed);

  // 4. Collect tiles
  const tileSet = allTiles(sections);

  // 5. Walls + floors
  let walls, wallKeySet, floors, doors;
  if (type.open) {
    // Open-air: no walls, all tiles are floors
    walls = [];
    wallKeySet = new Set();
    floors = [];
    for (const key of tileSet) {
      const [x, y] = key.split(',').map(Number);
      floors.push({ x, y });
    }
    // Open-air buildings still get a door marker at south edge
    const southEdge = floors.filter(f => !tileSet.has(`${f.x},${f.y + 1}`));
    doors = southEdge.length > 0
      ? [{ x: southEdge[Math.floor(rand(seed, 0x5010) * southEdge.length)].x,
           y: southEdge[Math.floor(rand(seed, 0x5010) * southEdge.length)].y }]
      : [];
  } else {
    walls = perimeterTiles(sections, tileSet);
    wallKeySet = new Set(walls.map(w => `${w.x},${w.y}`));
    floors = interiorTiles(tileSet, wallKeySet);

    // 6. Doors — on the true outer perimeter (not courtyard edges), spaced apart,
    //    count capped by perimeter length so they never cluster.
    doors = placeDoors(walls, wallKeySet, tileSet, seed, boundingBox(sections));

    // Remove door tiles from walls, add to floors
    const doorSet = new Set(doors.map(d => `${d.x},${d.y}`));
    walls = walls.filter(w => !doorSet.has(`${w.x},${w.y}`));
    floors = [...floors, ...doors.map(d => ({ x: d.x, y: d.y }))];
  }

  // 7. Place features on floor tiles
  const features = placeFeatures(type.features, floors, seed);

  // 8. Bounding box
  const bbox = boundingBox(sections);

  // 9. Generate interior (I0-I6 fields)
  const interior = generateInterior(mix(seed, 0x5050), typeId, race, tier, { sections, walls, doors, floors });

  const result = {
    typeId,
    typeName: type.name,
    category: type.category,
    race: race ?? type.race ?? null,
    tier: tier ?? type.tier,
    pattern: patternName,
    sections,
    walls,
    doors,
    floors,
    features,
    interior,
    boundingBox: bbox,
  };

  // S2.6: attach the lazy multi-floor BlueprintNode. NON-ENUMERABLE so every existing
  // field/snapshot stays byte-identical and structured-clone/JSON skip it (the node
  // carries functions). It hands the node the footprint we just built, so
  // node.payload.sections === sections. floorRange/stairCores are lazy by-products.
  Object.defineProperty(result, 'node', {
    enumerable: false, writable: false, configurable: true,
    value: buildingNode(seed, {
      bx: 0, by: 0, typeId, category: type.category, tier: tier ?? type.tier,
      centrality: 0.5, race: race ?? type.race ?? null, sections,
    }),
  });
  return result;
}
