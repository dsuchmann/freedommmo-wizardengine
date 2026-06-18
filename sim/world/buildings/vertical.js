// Vertical circulation for a multi-floor building: stair core(s) + lift reservation.
// Pure, deterministic, footprint-only. Part of the multi-floor building model
// (spec 2026-06-18 §6). A stair core is a fixed interior floor cell shared by every
// floor of its vertical column; a sprawling complex with disjoint wings gets one
// core per wing. A lift is reserved only above 3 above-ground floors.

const LIFT_THRESHOLD = 3; // above-ground floors

/** Union tile set + interior (non-perimeter) floor cells of a footprint. */
export function interiorCells(sections) {
  const tiles = new Set();
  for (const s of sections)
    for (let y = s.y0; y < s.y0 + s.h; y++)
      for (let x = s.x0; x < s.x0 + s.w; x++) tiles.add(`${x},${y}`);
  const interior = [];
  for (const key of tiles) {
    const [x, y] = key.split(',').map(Number);
    if (tiles.has(`${x},${y - 1}`) && tiles.has(`${x},${y + 1}`) &&
        tiles.has(`${x - 1},${y}`) && tiles.has(`${x + 1},${y}`)) {
      interior.push({ x, y });
    }
  }
  return { tiles, interior };
}

/** 4-connected components of a cell list. */
function components(cells) {
  const set = new Set(cells.map(c => `${c.x},${c.y}`));
  const seen = new Set();
  const comps = [];
  for (const c of cells) {
    const key = `${c.x},${c.y}`;
    if (seen.has(key)) continue;
    const comp = [];
    const stack = [c];
    seen.add(key);
    while (stack.length) {
      const t = stack.pop();
      comp.push(t);
      for (const [nx, ny] of [[t.x + 1, t.y], [t.x - 1, t.y], [t.x, t.y + 1], [t.x, t.y - 1]]) {
        const nk = `${nx},${ny}`;
        if (set.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push({ x: nx, y: ny }); }
      }
    }
    comps.push(comp);
  }
  return comps;
}

/** Centroid-nearest cell of a component; deterministic tie-break (x then y). */
function centroidNearest(comp) {
  let cx = 0, cy = 0;
  for (const c of comp) { cx += c.x; cy += c.y; }
  cx /= comp.length; cy /= comp.length;
  let best = comp[0], bestD = Infinity;
  for (const c of comp) {
    const d = (c.x - cx) ** 2 + (c.y - cy) ** 2;
    if (d < bestD - 1e-9 ||
        (Math.abs(d - bestD) < 1e-9 && (c.x < best.x || (c.x === best.x && c.y < best.y)))) {
      bestD = d; best = c;
    }
  }
  return best;
}

/**
 * One stair core per connected interior region (vertical column). Each core is an
 * interior floor cell — never a wall/door/exterior tile — shared by every floor of
 * that column (footprints are uniform across floors in this pass). Returns [{x,y}].
 */
export function selectStairCores(sections) {
  const { interior } = interiorCells(sections);
  if (interior.length === 0) return [];
  return components(interior).map(centroidNearest);
}

/**
 * Reserve an automated lift iff the building exceeds LIFT_THRESHOLD above-ground
 * floors. Mechanism is an OPAQUE id resolved by the separate lift subsystem (§9.4);
 * this model only reserves the shaft + a destination interface. Returns null or
 * { shaft:{x,y}, mechanismId }.
 */
export function reserveLift(aboveGroundFloors, stairCore, sections) {
  if (aboveGroundFloors <= LIFT_THRESHOLD || !stairCore) return null;
  return { shaft: liftShaftCell(stairCore, sections), mechanismId: 'generic-lift' };
}

/** Pick an interior floor cell adjacent to the stair core for the lift shaft (E,S,W,N
 *  order). Falls back to core.x+1 when sections are unavailable. */
function liftShaftCell(core, sections) {
  if (!sections) return { x: core.x + 1, y: core.y };
  const { interior } = interiorCells(sections);
  const iset = new Set(interior.map(c => `${c.x},${c.y}`));
  for (const [x, y] of [[core.x + 1, core.y], [core.x, core.y + 1], [core.x - 1, core.y], [core.x, core.y - 1]])
    if (iset.has(`${x},${y}`) && !(x === core.x && y === core.y)) return { x, y };
  return { x: core.x + 1, y: core.y };
}

export { LIFT_THRESHOLD };
