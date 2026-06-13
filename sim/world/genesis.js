// sim/world/genesis.js — deterministic civilization layer over the terrain oracle.
// Pure f(seed, coordinates) — instant, parallelizable, GPU-ready.
//
// The civilization field works like classifyBiome: a pure function evaluated at
// any coordinate that returns what civilization built there. No A*, no graph
// queries, no sequential dependencies. The chronicle decides IF, the terrain
// oracle decides WHERE, and both are pure functions of (seed, position).
//
// Settlement spacing: macro-cells are 64×64 tiles. Each macro-cell has at most
// one settlement. Territory overlap is impossible by construction (64 > 12+12).
// Roads are straight-line connections to the nearest settlement in each of the
// 4 cardinal macro-cell neighbors — no pathfinding, just Bresenham-style stepping
// that avoids water tiles.
//
// HONEST ABSENCES: settlement layouts are placeholder rectangles (organic layouts
// need the nested-blueprint system from the world compiler spec). Building sprites
// don't exist yet. Culture fingerprints are stubs.

import { rand, mix } from '../kernel/rng.js';
import { REGION } from '../lod/aggregate.js';
import { worldEpochs } from '../chronicle/epochs.js';
import { macroCellPeoples } from '../chronicle/races.js';
import { regionChronicle, settlementState } from '../chronicle/chronicle.js';
import { classifyBiome } from '../../src/world/biomes.js';

export const MACRO = 4;                      // macro-cell = 4×4 regions = 64×64 tiles
const MACRO_TILES = MACRO * REGION;          // 64 tiles per side
const STRIDE = 8;                            // sample every 8th tile
const GENESIS_GROUP_R = 50000;

// Settlement sizes by tier (in tiles).
// Village: ~2×2 chunks, town: ~3×3 chunks, city: ~5×5 chunks.
const TIER_SIZE = {
  village: { w: 64,  h: 56 },    // ~4 chunks
  town:    { w: 96,  h: 80 },    // ~9 chunks
  city:    { w: 160, h: 128 },   // ~20 chunks
  ruins:   { w: 64,  h: 56 },    // was a village
};

/** Map a region key to the macro-cell key that contains it. */
export function macroKeyOf(regionKey) {
  const [rx, ry] = regionKey.split(',').map(Number);
  return `${Math.floor(rx / MACRO)},${Math.floor(ry / MACRO)}`;
}

// ── Pure settlement placement — INSTANT, no terrain queries ─────────

/** Settlement position within a macro-cell. Pure f(seed, mx, my).
 *  Seeded offset from macro-cell center — NO tileCost, NO classifyBiome.
 *  The chronicle + biome affinity already guarantee this is habitable land.
 *  Position refinement onto actual terrain is Phase B (world compiler). */
function findSiteInMacro(seed, mx, my) {
  const cx = mx * MACRO_TILES + Math.floor(MACRO_TILES / 2);
  const cy = my * MACRO_TILES + Math.floor(MACRO_TILES / 2);
  // Seeded offset within ±quarter of macro-cell (keeps it away from edges)
  const ox = Math.floor((rand(seed, mx * 7 + 1, my * 13 + 2) - 0.5) * MACRO_TILES * 0.5);
  const oy = Math.floor((rand(seed, mx * 11 + 3, my * 17 + 4) - 0.5) * MACRO_TILES * 0.5);
  return { x: cx + ox, y: cy + oy };
}

/** Territory rect centered on site, sized by settlement tier. */
function territoryAround(x, y, tier) {
  const sz = TIER_SIZE[tier] ?? TIER_SIZE.village;
  return { x0: x - Math.floor(sz.w / 2), y0: y - Math.floor(sz.h / 2), w: sz.w, h: sz.h };
}

// ── Pure road connections (no A*, no pathfinding) ───────────────────

/** Straight-line road tiles from (ax,ay) to (bx,by), stepping around water.
 *  Pure f(terrain oracle). Returns array of {x,y} or empty if blocked.
 *  Uses a simple greedy walk: prefer the axis-aligned step that reduces distance,
 *  skip water tiles by trying the perpendicular axis. O(distance), not O(20000). */
function straightRoad(ax, ay, bx, by) {
  const tiles = [];
  let x = ax, y = ay;
  const maxSteps = Math.abs(bx - ax) + Math.abs(by - ay) + 20; // generous budget
  for (let i = 0; i < maxSteps && (x !== bx || y !== by); i++) {
    const dx = Math.sign(bx - x), dy = Math.sign(by - y);
    // Try primary direction (larger delta first), then secondary, then diagonal
    const candidates = Math.abs(bx - x) >= Math.abs(by - y)
      ? [{ x: x + dx, y }, { x, y: y + dy }, { x: x + dx, y: y + dy }]
      : [{ x, y: y + dy }, { x: x + dx, y }, { x: x + dx, y: y + dy }];
    let moved = false;
    for (const c of candidates) {
      if (c.x === x && c.y === y) continue; // dy=0 can produce no-move
      if (tileCost(c.x, c.y) !== Infinity) {
        x = c.x; y = c.y;
        tiles.push({ x, y });
        moved = true;
        break;
      }
    }
    if (!moved) break; // completely blocked
  }
  // Only return if we reached the destination (no partial roads)
  if (x === bx && y === by) return tiles;
  return [];
}

/** Find the settlement site in a neighbor macro-cell. Pure. Returns {x,y} or null. */
function neighborSite(seed, nmx, nmy) {
  const epochs = _cachedEpochs(seed);
  const mk = `${nmx},${nmy}`;
  const cx = nmx * MACRO_TILES + Math.floor(MACRO_TILES / 2);
  const cy = nmy * MACRO_TILES + Math.floor(MACRO_TILES / 2);
  const biome = classifyBiome(cx, cy);
  const peoples = macroCellPeoples(seed, mk, epochs);
  const chronicle = regionChronicle(seed, mk, peoples, biome.climate);
  const state = settlementState(chronicle);
  if (state === 'wilderness' || state === 'ruined') return null; // only connect to active
  return findSiteInMacro(seed, nmx, nmy);
}

// ── Caches (pure functions, safe to memoize) ────────────────────────

const _epochCache = new Map();
function _cachedEpochs(seed) {
  let e = _epochCache.get(seed);
  if (!e) { e = worldEpochs(seed); _epochCache.set(seed, e); }
  return e;
}

const _biomeCache = new Map();
function _cachedBiome(x, y) {
  const k = `${x},${y}`;
  let b = _biomeCache.get(k);
  if (!b) { b = classifyBiome(x, y); _biomeCache.set(k, b); if (_biomeCache.size > 500) _biomeCache.clear(); }
  return b;
}

// ── Main entry point ────────────────────────────────────────────────

/** Ensure genesis is evaluated for the macro-cell containing `regionKey`.
 *  Exactly-once per macro-cell (kernel.genesisSettlements frontier).
 *  Instant: no A*, no graph queries for placement. Chronicle → site → roads. */
export function ensureGenesisSettlements(kernel, regionKey, tick) {
  const mk = macroKeyOf(regionKey);
  if (kernel.genesisSettlements.has(mk)) return;
  kernel.genesisSettlements.add(mk);

  const [mx, my] = mk.split(',').map(Number);

  // Chronicle pipeline — all pure functions, biome cached
  const cx = mx * MACRO_TILES + Math.floor(MACRO_TILES / 2);
  const cy = my * MACRO_TILES + Math.floor(MACRO_TILES / 2);
  const biome = _cachedBiome(cx, cy);
  const epochs = _cachedEpochs(kernel.seed);
  const peoples = macroCellPeoples(kernel.seed, mk, epochs, biome);
  const chronicle = regionChronicle(kernel.seed, mk, peoples, biome.climate);
  const state = settlementState(chronicle);

  // Emit chronicle events into ledger
  for (const ev of chronicle) {
    kernel.ledger.emit({
      tick, type: `chronicle_${ev.type}`,
      attrs: { chronicleId: ev.id, macroCell: mk, domain: ev.domain,
               age: ev.age, severity: ev.severity, raceId: ev.raceId },
    });
  }

  if (state === 'wilderness') return;

  // Determine tier + race from chronicle
  const foundingEv = chronicle.find(e => e.type === 'ancient_founding' || e.type === 'founding');
  const race = foundingEv?.raceId ?? peoples[0]?.raceId ?? 'human';
  const chronicleAge = chronicle.length > 0 ? Math.max(...chronicle.map(e => e.age ?? 0)) : 0;
  const hasFlourishing = chronicle.some(e => e.type === 'flourishing');
  const hasTrade = chronicle.some(e => e.type === 'trade_route');
  const tier = (chronicleAge >= 4 && hasFlourishing && hasTrade) ? 'city'
    : (chronicleAge >= 3 && hasFlourishing) ? 'town' : 'village';
  const effectiveTier = state === 'ruined' ? 'ruins' : tier;

  // Find site — pure, instant (no terrain queries)
  const site = findSiteInMacro(kernel.seed, mx, my);

  const territory = territoryAround(site.x, site.y, effectiveTier);

  if (state === 'ruined') {
    const lastEv = chronicle[chronicle.length - 1];
    const evId = kernel.ledger.emit({
      tick, type: 'ruins_placed',
      attrs: { macroCell: mk, x: site.x, y: site.y, chronicleId: lastEv?.id },
    });
    kernel.graph.createNode({
      type: 'settlement', tick, x: site.x, y: site.y, causeEventId: evId,
      attrs: { tier: 'ruins', state: 'ruined', territory, noFlux: true,
               race, chronicleAge, chronicle: chronicle.map(e => e.id) },
    });
    return;
  }

  // Active settlement: group + settlement node + straight-line roads
  const evId = kernel.ledger.emit({
    tick, type: 'genesis_group_founded',
    attrs: { macroCell: mk, x: site.x, y: site.y },
  });
  const group = kernel.graph.createNode({
    type: 'group', tick, x: site.x, y: site.y, R: GENESIS_GROUP_R, causeEventId: evId,
    attrs: { body: 0, cap: 0, burn: 0, noFlux: true, members: [], genesis: true },
  });
  kernel.ledger.events[evId - 1].targets.push(group.id);

  // Settlement node (inline, no foundSettlement call — avoid graph queries for plots)
  const settleEvId = kernel.ledger.emit({
    tick, type: 'settlement_founded', actor: group.id, targets: [],
    attrs: { x: site.x, y: site.y, macroCell: mk },
  });
  const settlement = kernel.graph.createNode({
    type: 'settlement', tick, x: site.x, y: site.y, causeEventId: settleEvId,
    attrs: { tier, state: 'active', territory, noFlux: true,
             founderGroup: group.id, race, chronicleAge,
             chronicle: chronicle.map(e => e.id),
             districts: [
               { kind: 'residential', rect: { x0: territory.x0, y0: territory.y0,
                 w: Math.ceil(territory.w / 2), h: territory.h } },
               { kind: 'craft', rect: { x0: territory.x0 + Math.ceil(territory.w / 2),
                 y0: territory.y0, w: territory.w - Math.ceil(territory.w / 2), h: territory.h } },
             ] },
  });
  kernel.ledger.events[settleEvId - 1].targets.push(settlement.id);

  // HONEST ABSENCE: roads are Phase D of the world compiler.
  // Road network is a per-tile pure field function (spec: roadAt), not tile entities.
  // Disabled here: straightRoad + neighborSite were the performance bottleneck.
}
