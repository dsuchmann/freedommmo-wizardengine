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

const MIN_DOOR_SPACING = 8;   // min tile distance between two doors (no clustering)
const DOOR_PER_TILES = 50;    // ~1 door per this many outer-perimeter tiles (most houses → just 1 front door)
const MAX_DOORS = 2;          // a building rarely needs more than 2 doors
// ── window placement (south-facing outer walls, clear of doors) ──
const MIN_WINDOW_SPACING = 4; // min tile distance between two windows (padding so they don't crowd)
const WINDOW_DOOR_CLEAR = 3;  // keep windows ≥ this (Manhattan) from any door (visual breathing room)
const WINDOW_PER_TILES = 3;   // ~1 window per this many south-facing outer wall tiles
const MAX_WINDOWS = 8;
// Apertures (windows now; doors below) stay this many tiles clear of the building's E/W edges so they
// never crowd the corner/quoin columns the renderer draws there. Deterministic → scales to every building.
const CORNER_CLEAR = 2;
// Minimum building dimension so even small buildings have a believable interior
// (5 => at least a 3x3 interior after the 1-tile wall ring).
export const MIN_DIM = 5;

// Footprints are drawn at SCALE× their taxonomy bounds for visual presence on terrain, then GROWN
// (up to FOOTPRINT_GROW_MAX) if the function's required features need more interior. So the actual
// bbox lives in [round(minW*SCALE) .. round(maxW*SCALE)+GROW], floored at MIN_DIM — NOT the raw
// taxonomy bounds. Exported so tests validate the real sizing model.
export const FOOTPRINT_SCALE = 1.5;
export const FOOTPRINT_GROW_MAX = 6;

// A building must contain its REQUIRED features with room to move — derive a minimum floor-tile
// count from them (each required feature needs ~3 tiles of clearance over a base interior). This
// is the per-function "square-peg minimum": a 7-feature manor needs more floor than a 2-feature hut.
function minFloorTilesFor(type) {
  const req = (type.features || []).filter(f => f.required).length;
  return Math.max(9, 4 + req * 3);
}

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
  const doors = [];

  // GUARANTEE a south-facing FRONT entrance: every building gets a clear door on its
  // SOUTHERNMOST outer row (the wall the player approaches from below), at the tile nearest
  // that row's centre (seeded tiebreak). This kills both the "no visible door" case (door
  // landing on a recessed/back south edge) and gives a consistent front door.
  if (south.length) {
    let maxY = -Infinity;
    for (const w of south) if (w.y > maxY) maxY = w.y;
    const frontRow = south.filter(w => w.y === maxY);
    let minx = Infinity, maxx = -Infinity;
    for (const w of frontRow) { if (w.x < minx) minx = w.x; if (w.x > maxx) maxx = w.x; }
    const cx = (minx + maxx) / 2;
    frontRow.sort((a, b) =>
      (Math.abs(a.x - cx) - Math.abs(b.x - cx)) ||
      (rand(seed, 0xD002, a.x * 7 + 1) - rand(seed, 0xD002, b.x * 7 + 1)));
    doors.push({ x: frontRow[0].x, y: frontRow[0].y });
  }

  // Additional doors: seeded order, south-preferred, each spaced ≥ MIN_DOOR_SPACING from every
  // already-placed door (incl. the guaranteed front door) — so no clusters of adjacent doors.
  // Additional SOUTH doors also stay CORNER_CLEAR tiles off the building's E/W edges so they never
  // land on the edge column the renderer caps with a corner tile (the edge is always capped, doors inside).
  const pref = south.length ? south : outerWalls;
  let sMinX = Infinity, sMaxX = -Infinity;
  for (const w of south) { if (w.x < sMinX) sMinX = w.x; if (w.x > sMaxX) sMaxX = w.x; }
  const doorClearOfCorner = (w) => !south.length || (w.x >= sMinX + CORNER_CLEAR && w.x <= sMaxX - CORNER_CLEAR);
  const ordered = pref
    .filter(doorClearOfCorner)
    .map((w, i) => ({ w, k: rand(seed, 0xD001, w.x * 131 + w.y * 17 + i) }))
    .sort((a, b) => a.k - b.k)
    .map(o => o.w);
  const maxDoors = Math.max(1, Math.min(MAX_DOORS, Math.round(outerWalls.length / DOOR_PER_TILES)));
  for (const w of ordered) {
    if (doors.length >= maxDoors) break;
    if (doors.every(d => Math.abs(d.x - w.x) + Math.abs(d.y - w.y) >= MIN_DOOR_SPACING)) {
      doors.push({ x: w.x, y: w.y });
    }
  }
  if (doors.length === 0) doors.push({ x: ordered[0].x, y: ordered[0].y }); // no south edge at all → fallback
  return doors;
}

/**
 * Place windows on the south-facing outer wall tiles, kept clear of doorways and spaced apart.
 * Windows stay WALL tiles (unlike doors, which become openings/floor) — the renderer overlays a
 * window sprite on the wall at these positions. Returns array of { x, y }.
 */
function placeWindows(walls, tileSet, seed, bbox, doors) {
  const outside = computeOutside(tileSet, bbox);
  const south = walls.filter(w => outside.has(`${w.x},${w.y + 1}`)); // south-facing outer walls
  if (south.length === 0) return [];
  // The building's E/W edges on the south row carry the corner/quoin columns — reserve them by keeping
  // windows ≥ CORNER_CLEAR tiles inboard of the leftmost/rightmost south-wall tile.
  let minX = Infinity, maxX = -Infinity;
  for (const w of south) { if (w.x < minX) minX = w.x; if (w.x > maxX) maxX = w.x; }
  const clearOfCorners = (w) => w.x >= minX + CORNER_CLEAR && w.x <= maxX - CORNER_CLEAR;
  const ordered = south
    .filter(w => clearOfCorners(w) && doors.every(d => Math.abs(d.x - w.x) + Math.abs(d.y - w.y) >= WINDOW_DOOR_CLEAR))
    .map((w, i) => ({ w, k: rand(seed, 0xD003, w.x * 137 + w.y * 19 + i) }))
    .sort((a, b) => a.k - b.k)
    .map(o => o.w);
  const maxWin = Math.max(0, Math.min(MAX_WINDOWS, Math.round(south.length / WINDOW_PER_TILES)));
  const windows = [];
  for (const w of ordered) {
    if (windows.length >= maxWin) break;
    if (windows.every(p => Math.abs(p.x - w.x) + Math.abs(p.y - w.y) >= MIN_WINDOW_SPACING)) windows.push({ x: w.x, y: w.y });
  }
  return windows;
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

  // 1–5. Determine size, pick pattern, generate sections, compute walls/floors/doors.
  //      Wrapped in a GROW LOOP: sparse patterns (L, courtyard) can leave fewer interior
  //      tiles than the building's required features need.  We expand w/h by +1 per
  //      iteration (up to 6 steps) until floor count meets the function minimum.
  const SCALE = FOOTPRINT_SCALE;
  const need = minFloorTilesFor(type);
  let w, h, patternName, sections, tileSet, walls, wallKeySet, floors, doors, windows;
  for (let grow = 0; grow <= FOOTPRINT_GROW_MAX; grow++) {
    w = Math.max(MIN_DIM, Math.round((type.minW + Math.floor(rand(seed, 0x5001) * (type.maxW - type.minW + 1))) * SCALE) + grow);
    h = Math.max(MIN_DIM, Math.round((type.minH + Math.floor(rand(seed, 0x5002) * (type.maxH - type.minH + 1))) * SCALE) + grow);
    const patIdx = Math.floor(rand(seed, 0x5003) * type.patterns.length);
    patternName = type.patterns[patIdx];
    sections = generatePattern(patternName, w, h, mix(seed, 0x5004)).sections;
    tileSet = allTiles(sections);
    if (type.open) {
      walls = []; wallKeySet = new Set();
      floors = []; for (const key of tileSet) { const [x, y] = key.split(',').map(Number); floors.push({ x, y }); }
      const southEdge = floors.filter(f => !tileSet.has(`${f.x},${f.y + 1}`));
      const di = Math.floor(rand(seed, 0x5010) * Math.max(1, southEdge.length));
      doors = southEdge.length ? [{ x: southEdge[di].x, y: southEdge[di].y }] : [];
      windows = [];   // open structures (stalls etc.) have no walls to hang windows on
    } else {
      walls = perimeterTiles(sections, tileSet);
      wallKeySet = new Set(walls.map(wl => `${wl.x},${wl.y}`));
      floors = interiorTiles(tileSet, wallKeySet);
      doors = placeDoors(walls, wallKeySet, tileSet, seed, boundingBox(sections));
      const doorSet = new Set(doors.map(d => `${d.x},${d.y}`));
      walls = walls.filter(wl => !doorSet.has(`${wl.x},${wl.y}`));
      floors = [...floors, ...doors.map(d => ({ x: d.x, y: d.y }))];
      windows = placeWindows(walls, tileSet, seed, boundingBox(sections), doors);
    }
    if (floors.length >= need) break; // coherent: enough interior for the function
  }

  // 7. Place features on floor tiles
  const features = placeFeatures(type.features, floors, seed);

  // 8. Bounding box
  const bbox = boundingBox(sections);

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
    windows,
    floors,
    features,
    boundingBox: bbox,
  };

  // 9. Interior (I0-I6 fields) is generated LAZILY. Settlement layout calls generateFootprint for
  // EVERY candidate slot — including the many rejected by collision/terrain — and the interior gen
  // was the dominant cold-layout cost (~tens of ms each) yet placement never reads it. The first real
  // reader (floor material during the cached building bake / walk-in detail / the '9' overlay) triggers
  // it once, then it's memoized on the instance. Enumerable so structuredClone + JSON snapshots still
  // capture it (they invoke the getter), preserving byte-identical output.
  let _interior;
  Object.defineProperty(result, 'interior', {
    enumerable: true, configurable: true,
    get() {
      if (_interior === undefined) {
        _interior = generateInterior(mix(seed, 0x5050), typeId, race, tier, { sections, walls, doors, floors });
      }
      return _interior;
    },
    set(v) { _interior = v; },
  });

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
  // The generation seed, stashed NON-enumerably so the sync path + snapshots stay byte-identical.
  // When the resolve runs in a Worker, `node` (functions) can't cross postMessage; the worker copies
  // this to an enumerable field so the main thread can rebuild an identical node lazily. See
  // docs/superpowers/specs/2026-06-29-building-resolve-worker-plan.md.
  Object.defineProperty(result, '_genSeed', { value: seed, enumerable: false, configurable: true });
  return result;
}
