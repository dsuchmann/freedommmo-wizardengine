// sim/society/suitability.js — P3: deterministic settlement-site scoring (world-compiler
// L11 recomputed over OUR climate oracle). Pure functions of (graph state, coords); no RNG.
// Every component is a REASON CODE with evidence — the founding event will carry this
// object verbatim. HONEST ABSENCES: no soil system exists — fertility is a declared
// climate-derived signal (moisture × heat band; L7 soil model = backlog). Trade centrality
// scores 0 with null evidence when no settlement is reachable (first founder has no
// neighbors — declared, not faked).
import { classifyBiome } from '../../src/world/biomes.js';
import { tileCost, planRoute } from '../world/routing.js';

export const WEIGHTS = { water: 0.35, fertility: 0.25, defensibility: 0.2, trade: 0.2 };
export const WATER_SCAN_R = 6;     // Chebyshev radius for water-access scan
const clamp01 = v => Math.max(0, Math.min(1, v));

/** Nearest water tile within WATER_SCAN_R (Chebyshev rings, deterministic order), or null. */
function nearestWater(x, y) {
  for (let r = 1; r <= WATER_SCAN_R; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;   // ring only
      if (tileCost(x + dx, y + dy) === Infinity) return { x: x + dx, y: y + dy, d: r };
    }
  }
  return null;
}

/** Score a candidate site. Returns {score, reasons} or null when the tile itself is water.
 *  reasons = { water:{score,nearest}, fertility:{score,moisture,heat},
 *              defensibility:{score,elevation}, trade:{score,via} }. */
export function scoreSite(kernel, x, y, bounds) {
  if (tileCost(x, y) === Infinity) return null;
  const { climate } = classifyBiome(x, y);
  const nw = nearestWater(x, y);
  const water = { score: nw ? clamp01((WATER_SCAN_R + 1 - nw.d) / WATER_SCAN_R) : 0, nearest: nw };
  // Declared fertility signal: wet and temperate is fertile (no soil system — see header).
  const fertility = {
    score: clamp01(climate.moisture * (1 - Math.abs(climate.heat - 0.55))),
    moisture: climate.moisture, heat: climate.heat,
  };
  const defensibility = { score: clamp01(climate.elevation), elevation: climate.elevation };
  // Trade centrality: reachable existing settlement (coarse: any land route inside bounds).
  // Graph insertion order is deterministic for a deterministic scenario — first reachable wins.
  let trade = { score: 0, via: null };
  for (const n of kernel.graph.nodes.values()) {
    if (n.type !== 'settlement') continue;
    const route = planRoute({ x, y }, { x: n.x, y: n.y }, bounds);
    if (route) { trade = { score: 1, via: n.id }; break; }
  }
  const score = WEIGHTS.water * water.score + WEIGHTS.fertility * fertility.score
    + WEIGHTS.defensibility * defensibility.score + WEIGHTS.trade * trade.score;
  return { score, reasons: { water, fertility, defensibility, trade } };
}

/** Best site in rect: argmax score, ties → lowest y then lowest x (scan order). Null if no land. */
export function findSettlementSite(kernel, rect) {
  let best = null;
  for (let y = rect.y0; y < rect.y0 + rect.h; y++) for (let x = rect.x0; x < rect.x0 + rect.w; x++) {
    const s = scoreSite(kernel, x, y, rect);
    if (!s) continue;
    if (!best || s.score > best.score + 1e-12) best = { x, y, ...s };
  }
  return best;
}
