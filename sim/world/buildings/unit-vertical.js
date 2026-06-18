// sim/world/buildings/unit-vertical.js — multi-floor unit decisions (spec 2026-06-18 §2 P1).
// A minority of large shop/apartment units become a 2-level mini-stack with a private
// internal stair. Pure f(unit seed). Depth is capped at one extra floor (2 sub-floors).
import { mix } from '../../kernel/rng.js';

const ELIGIBLE_KINDS = new Set(['shop', 'apartment']);
const MIN_TILES = 6;       // need room for the stair + content on each level
const MULTI_RATE = 0.28;   // share of eligible units that go multi-floor (a tasteful minority)

/** 1 = single-room unit (unchanged); 2 = multi-floor unit (one upstairs). Never > 2 (depth <= 1). */
export function unitSubFloorCount(seed, unitKind, tiles) {
  if (!ELIGIBLE_KINDS.has(unitKind) || !tiles || tiles.length < MIN_TILES) return 1;
  const r = (mix(seed >>> 0, 0x5f3a9c2b) >>> 0) / 0xffffffff;
  return r < MULTI_RATE ? 2 : 1;
}

/** Centroid-nearest tile of the unit (deterministic tie-break x then y). The private
 *  stair sits here on every sub-floor of the unit. Returns null for an empty unit. */
export function selectPrivateStair(tiles) {
  if (!tiles || tiles.length === 0) return null;
  let cx = 0, cy = 0;
  for (const t of tiles) { cx += t.x; cy += t.y; }
  cx /= tiles.length; cy /= tiles.length;
  let best = tiles[0], bestD = Infinity;
  for (const t of tiles) {
    const d = (t.x - cx) ** 2 + (t.y - cy) ** 2;
    if (d < bestD - 1e-9 ||
        (Math.abs(d - bestD) < 1e-9 && (t.x < best.x || (t.x === best.x && t.y < best.y)))) {
      bestD = d; best = t;
    }
  }
  return { x: best.x, y: best.y };
}

export { ELIGIBLE_KINDS, MIN_TILES, MULTI_RATE };
