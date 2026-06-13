// sim/world/genesis.js — P3: chronicle-driven settlement genesis.
// Each macro-cell (4×4 regions = 64×64 tiles) is evaluated at most once.
// The chronicle (world epochs → peoples → regional history → state) decides
// whether the cell becomes active settlement, ruins, or wilderness.
// Active settlements get a genesis group + roads. Ruins get a bare node.
import { rand } from '../kernel/rng.js';
import { tileCost } from './routing.js';
import { foundSettlement, territoryAround } from '../society/settlements.js';
import { buildRoad } from './roads.js';
import { REGION } from '../lod/aggregate.js';
import { worldEpochs } from '../chronicle/epochs.js';
import { macroCellPeoples } from '../chronicle/races.js';
import { regionChronicle, settlementState } from '../chronicle/chronicle.js';
import { classifyBiome } from '../../src/world/biomes.js';

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
    if (bestDist < Infinity) break;
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

  for (let dy = 0; dy < MACRO_TILES; dy += STRIDE) {
    for (let dx = 0; dx < MACRO_TILES; dx += STRIDE) {
      const tx = x0 + dx;
      const ty = y0 + dy;
      if (tileCost(tx, ty) === Infinity) continue;
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

  if (bestScore <= 0) return null;

  const roll = rand(seed, mx * 1000003, my * 1000033, 777);
  if (roll > bestScore * SETTLE_PROB_SCALE) return null;

  return { x: bestX, y: bestY };
}

/** Find the best site in a macro-cell. Pure f(seed, mx, my, terrain oracle).
 *  Scans the full 64×64 area at STRIDE, scores by water proximity + terrain.
 *  No suitability roll — the chronicle already decided a settlement exists here. */
function findBestSiteInMacro(seed, mx, my) {
  const x0 = mx * MACRO_TILES, y0 = my * MACRO_TILES;
  let bestScore = -1, bestX = 0, bestY = 0;
  for (let dy = 0; dy < MACRO_TILES; dy += STRIDE) {
    for (let dx = 0; dx < MACRO_TILES; dx += STRIDE) {
      const tx = x0 + dx, ty = y0 + dy;
      if (tileCost(tx, ty) === Infinity) continue;
      const wp = waterProximity(tx, ty);
      const quality = wp * 0.6 + (1 / (1 + tileCost(tx, ty))) * 0.4;
      if (quality > bestScore) { bestScore = quality; bestX = tx; bestY = ty; }
    }
  }
  if (bestScore <= 0) return null;
  // Refine: ±REFINE_R around the best sampled tile
  let best = { x: bestX, y: bestY };
  let refinedScore = bestScore;
  for (let dy = -REFINE_R; dy <= REFINE_R; dy++) {
    for (let dx = -REFINE_R; dx <= REFINE_R; dx++) {
      const x = bestX + dx, y = bestY + dy;
      if (tileCost(x, y) === Infinity) continue;
      const q = waterProximity(x, y) * 0.6 + (1 / (1 + tileCost(x, y))) * 0.4;
      if (q > refinedScore) { refinedScore = q; best = { x, y }; }
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
  candidates.sort((a, b) => a.dist - b.dist || a.node.id - b.node.id);
  for (let i = 0; i < Math.min(candidates.length, MAX_NEIGHBORS); i++) {
    const target = candidates[i].node;
    buildRoad(kernel, groupId, { x: settlement.x, y: settlement.y }, { x: target.x, y: target.y }, tick);
  }
}

// Cache world epochs per seed (pure, never changes)
const _epochCache = new Map();
function cachedEpochs(seed) {
  let e = _epochCache.get(seed);
  if (!e) { e = worldEpochs(seed); _epochCache.set(seed, e); }
  return e;
}

/** Ensure genesis settlements are evaluated for the macro-cell containing `regionKey`.
 *  Exactly-once per macro-cell, tracked via kernel.genesisSettlements.
 *  Chronicle-driven: epochs → peoples → regional chronicle → state. */
export function ensureGenesisSettlements(kernel, regionKey, tick) {
  const mk = macroKeyOf(regionKey);
  if (kernel.genesisSettlements.has(mk)) return;
  kernel.genesisSettlements.add(mk);

  const [mx, my] = mk.split(',').map(Number);

  // Step 1: Sample biome at macro-cell center for climate
  const cx = mx * MACRO_TILES + Math.floor(MACRO_TILES / 2);
  const cy = my * MACRO_TILES + Math.floor(MACRO_TILES / 2);
  const biome = classifyBiome(cx, cy);
  const climate = biome.climate;

  // Step 2: Chronicle pipeline — pure
  const epochs = cachedEpochs(kernel.seed);
  const peoples = macroCellPeoples(kernel.seed, mk, epochs);
  const chronicle = regionChronicle(kernel.seed, mk, peoples, climate);
  const state = settlementState(chronicle);

  // Step 3: Emit chronicle events into kernel ledger
  for (const ev of chronicle) {
    kernel.ledger.emit({
      tick, type: `chronicle_${ev.type}`,
      attrs: { chronicleId: ev.id, macroCell: mk, domain: ev.domain,
               age: ev.age, severity: ev.severity, raceId: ev.raceId },
    });
  }

  // Step 4: Act on state
  if (state === 'wilderness') return;

  // The chronicle has spoken — a settlement exists here. Find the best site.
  // evaluateMacroCell's suitability roll is skipped: the chronicle is the authority.
  // We only need to find WHERE in the macro-cell to place it.
  const site = findBestSiteInMacro(kernel.seed, mx, my);
  if (!site) return;  // entire macro-cell is water — chronicle was wrong (shouldn't happen)

  if (state === 'ruined') {
    // Ruins: no group, no roads — just a settlement node with ruined state
    const lastEvent = chronicle[chronicle.length - 1];
    const evId = kernel.ledger.emit({
      tick, type: 'ruins_placed',
      attrs: { macroCell: mk, x: site.x, y: site.y, chronicleId: lastEvent?.id },
    });
    const territory = territoryAround(site.x, site.y);
    // Check overlap
    for (const n of kernel.graph.nodes.values()) {
      if (n.type === 'settlement' && _overlaps(territory, n.attrs.territory)) return;
    }
    kernel.graph.createNode({
      type: 'settlement', tick, x: site.x, y: site.y, causeEventId: evId,
      attrs: { tier: 'ruins', state: 'ruined', territory, noFlux: true,
               chronicle: chronicle.map(e => e.id) },
    });
    return;
  }

  // Active settlement: genesis group + foundSettlement + roads (P2 logic)
  const evId = kernel.ledger.emit({
    tick, type: 'genesis_group_founded',
    attrs: { macroCell: mk, x: site.x, y: site.y },
  });
  const group = kernel.graph.createNode({
    type: 'group', tick, x: site.x, y: site.y, R: GENESIS_GROUP_R, causeEventId: evId,
    attrs: { body: 0, cap: 0, burn: 0, noFlux: true, members: [], genesis: true },
  });
  kernel.ledger.events[evId - 1].targets.push(group.id);

  const settlement = foundSettlement(kernel, group.id, site, tick);
  if (!settlement) return;

  // Tag settlement with chronicle
  settlement.attrs.state = 'active';
  settlement.attrs.chronicle = chronicle.map(e => e.id);

  connectToNeighbors(kernel, settlement, group.id, tick);
}

function _overlaps(a, b) {
  if (!a || !b) return false;
  return a.x0 < b.x0 + b.w && b.x0 < a.x0 + a.w && a.y0 < b.y0 + b.h && b.y0 < a.y0 + a.h;
}
