// sim/world/buildings/footprints.js — World Compiler Phase A: complete footprint generator.
// Pure function: seed + typeId → full building description with walls, doors,
// floors, features, and bounding box.  No kernel state, no side effects.

import { rand, mix } from '../../kernel/rng.js';
import { typeById } from './taxonomy.js';
import { generatePattern } from './patterns.js';

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

/**
 * Pick door locations from wall tiles.  Prefer south-facing walls
 * (tiles whose southern neighbour is outside the footprint).
 * Returns array of { x, y } positions.
 */
function placeDoors(walls, wallSet, tileSet, seed, numDoors) {
  // south-facing: wall tile where (x, y+1) is outside
  const southFacing = walls.filter(w => !tileSet.has(`${w.x},${w.y + 1}`));
  // fallback: any wall tile on the edge
  const candidates = southFacing.length >= numDoors ? southFacing : walls;
  const doors = [];
  const used = new Set();
  for (let i = 0; i < numDoors && i < candidates.length; i++) {
    const idx = Math.floor(rand(seed, 0xD001, i) * candidates.length);
    let picked = candidates[idx];
    // avoid duplicates
    if (used.has(`${picked.x},${picked.y}`)) {
      picked = candidates[(idx + 1) % candidates.length];
    }
    doors.push({ x: picked.x, y: picked.y });
    used.add(`${picked.x},${picked.y}`);
  }
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

  // 1. Determine size within type's range
  const w = type.minW + Math.floor(rand(seed, 0x5001) * (type.maxW - type.minW + 1));
  const h = type.minH + Math.floor(rand(seed, 0x5002) * (type.maxH - type.minH + 1));

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

    // 6. Doors — at least 1; larger buildings (area >= 40) get 2
    const area = tileSet.size;
    const numDoors = area >= 40 ? 2 : 1;
    doors = placeDoors(walls, wallKeySet, tileSet, seed, numDoors);

    // Remove door tiles from walls, add to floors
    const doorSet = new Set(doors.map(d => `${d.x},${d.y}`));
    walls = walls.filter(w => !doorSet.has(`${w.x},${w.y}`));
    floors = [...floors, ...doors.map(d => ({ x: d.x, y: d.y }))];
  }

  // 7. Place features on floor tiles
  const features = placeFeatures(type.features, floors, seed);

  // 8. Bounding box
  const bbox = boundingBox(sections);

  return {
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
    boundingBox: bbox,
  };
}
