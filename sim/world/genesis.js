// sim/world/genesis.js — P2: deterministic settlement genesis over the climate oracle.
// Each "macro-cell" (4×4 regions = 64×64 tiles) is evaluated at most once: a pure
// function of (seed, macroKey, terrain oracle) decides whether a settlement spawns.
// The best candidate tile is refined with full scoreSite, a genesis group is created,
// and up to 3 nearest neighbors get roads. Exactly-once frontier: kernel.genesisSettlements.
import { rand } from '../kernel/rng.js';
import { tileCost } from './routing.js';
import { foundSettlement } from '../society/settlements.js';
import { buildRoad } from './roads.js';
import { REGION } from '../lod/aggregate.js';

export const MACRO = 4;                      // macro-cell = 4×4 regions
const MACRO_TILES = MACRO * REGION;          // 64 tiles per side
const STRIDE = 4;                            // sample every 4th tile in evaluateMacroCell
const SETTLE_PROB_SCALE = 0.85;              // probability scale against best score
const REFINE_R = 8;                          // ±8 tile scan around candidate
const MAX_NEIGHBOR_DIST = 96;                // Manhattan distance for road connections
const MAX_NEIGHBORS = 3;                     // connect to at most 3 nearest settlements
const GENESIS_GROUP_R = 50000;               // initial resource endowment
const ROAD_COST_PER_TILE = 30;               // (documentation; actual cost is in roads.js)

/** Map a region key to the macro-cell key that contains it. */
export function macroKeyOf(regionKey) {
  const [rx, ry] = regionKey.split(',').map(Number);
  const mx = Math.floor(rx / MACRO);
  const my = Math.floor(ry / MACRO);
  return `${mx},${my}`;
}

/** Water proximity score: count water tiles in a ring around (x,y). Pure. */
function waterProximity(x, y) {
  let bestDist = Infinity;
  for (let r = 1; r <= 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (tileCost(x + dx, y + dy) === Infinity) {
          bestDist = Math.min(bestDist, r);
        }
      }
    }
    if (bestDist < Infinity) break; // found water at this ring
  }
  return bestDist < Infinity ? (7 - bestDist) / 6 : 0;
}

/** Pure evaluation of a macro-cell. No kernel reads — only tileCost + rand.
 *  Returns {x, y} candidate or null. */
export function evaluateMacroCell(seed, macroKey) {
  const [mx, my] = macroKey.split(',').map(Number);
  const x0 = mx * MACRO_TILES;
  const y0 = my * MACRO_TILES;

  let bestScore = -1;
  let bestX = 0, bestY = 0;

  // Scan at stride, evaluate terrain quality (pure)
  for (let dy = 0; dy < MACRO_TILES; dy += STRIDE) {
    for (let dx = 0; dx < MACRO_TILES; dx += STRIDE) {
      const tx = x0 + dx;
      const ty = y0 + dy;
      if (tileCost(tx, ty) === Infinity) continue; // water
      // Quality = water proximity + terrain cost inverse
      const wp = waterProximity(tx, ty);
      const tc = tileCost(tx, ty);
      const terrainQuality = 1 / (1 + tc);
      const quality = wp * 0.6 + terrainQuality * 0.4;
      if (quality > bestScore) {
        bestScore = quality;
        bestX = tx;
        bestY = ty;
      }
    }
  }

  if (bestScore <= 0) return null; // no land tiles found

  // Roll against score × scale
  const roll = rand(seed, mx * 1000003, my * 1000033, 777);
  if (roll > bestScore * SETTLE_PROB_SCALE) return null;

  return { x: bestX, y: bestY };
}

/** Refine candidate position: pure ±REFINE_R scan using tileCost + waterProximity.
 *  No kernel reads, no A* routing — genesis refinement must be cheap. The full
 *  scoreSite (with trade centrality A*) runs inside foundSettlement anyway. */
function refineSite(candidate) {
  let best = null;
  let bestScore = -1;
  for (let dy = -REFINE_R; dy <= REFINE_R; dy++) {
    for (let dx = -REFINE_R; dx <= REFINE_R; dx++) {
      const x = candidate.x + dx;
      const y = candidate.y + dy;
      if (tileCost(x, y) === Infinity) continue;
      const wp = waterProximity(x, y);
      const tc = tileCost(x, y);
      const quality = wp * 0.6 + (1 / (1 + tc)) * 0.4;
      if (quality > bestScore) {
        bestScore = quality;
        best = { x, y };
      }
    }
  }
  return best;
}

/** Connect a settlement to up to MAX_NEIGHBORS nearest existing settlements within range. */
function connectToNeighbors(kernel, settlement, groupId, tick) {
  const candidates = [];
  for (const n of kernel.graph.nodes.values()) {
    if (n.type !== 'settlement' || n.id === settlement.id) continue;
    const dist = Math.abs(n.x - settlement.x) + Math.abs(n.y - settlement.y);
    if (dist <= MAX_NEIGHBOR_DIST) {
      candidates.push({ node: n, dist });
    }
  }
  // Sort by distance, take nearest
  candidates.sort((a, b) => a.dist - b.dist || a.node.id - b.node.id);
  for (let i = 0; i < Math.min(candidates.length, MAX_NEIGHBORS); i++) {
    const target = candidates[i].node;
    buildRoad(kernel, groupId, { x: settlement.x, y: settlement.y }, { x: target.x, y: target.y }, tick);
  }
}

/** Ensure genesis settlements are evaluated for the macro-cell containing `regionKey`.
 *  Exactly-once per macro-cell, tracked via kernel.genesisSettlements. */
export function ensureGenesisSettlements(kernel, regionKey, tick) {
  const mk = macroKeyOf(regionKey);
  if (kernel.genesisSettlements.has(mk)) return;
  kernel.genesisSettlements.add(mk);

  // Step 1: pure evaluation
  const candidate = evaluateMacroCell(kernel.seed, mk);
  if (!candidate) return;

  // Step 2: pure refinement (no kernel reads, no A* — must be cheap)
  const site = refineSite(candidate);
  if (!site) return;

  // Step 3: create genesis group (provenance: ledger event, not boot scope)
  const evId = kernel.ledger.emit({
    tick, type: 'genesis_group_founded',
    attrs: { macroCell: mk, x: site.x, y: site.y },
  });
  const group = kernel.graph.createNode({
    type: 'group', tick, x: site.x, y: site.y, R: GENESIS_GROUP_R, causeEventId: evId,
    attrs: { body: 0, cap: 0, burn: 0, noFlux: true, members: [], genesis: true },
  });
  kernel.ledger.events[evId - 1].targets.push(group.id);

  // Step 4: found settlement
  const settlement = foundSettlement(kernel, group.id, site, tick);
  if (!settlement) return; // territory overlap — skip

  // Step 5: connect to neighbors
  connectToNeighbors(kernel, settlement, group.id, tick);
}
