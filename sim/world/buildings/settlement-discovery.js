// One pure, seed-respecting settlement discovery.
// Replaces the triplicated discover logic in sim-debug-overlay.js,
// building-renderer.js, and building-tile-query.js. Takes an EXPLICIT seed
// (never getWorldSeed) so it is pure and unit-testable. The building-generation
// policy (skip ruined/water-centred for DRAW) lives in resolved-buildings.js,
// not here — this layer answers only "what settlements exist".

import { TIER_NAMES } from './layout.js';
import { MACRO } from '../genesis.js';
import { REGION } from '../../lod/aggregate.js';
import { worldEpochs } from '../../chronicle/epochs.js';
import { macroCellPeoples } from '../../chronicle/races.js';
import { regionChronicle, settlementState, chronicleTier } from '../../chronicle/chronicle.js';
import { generateSettlementName } from './specializations.js';
import { classifyBiomeNoStream } from '../../../src/world/biomes.js';
import { rand } from '../../kernel/rng.js';

export const MACRO_TILES = MACRO * REGION; // 64

// Settlements centred on these biomes are not placed (overlay's water set).
const SITE_WATER = ['ocean', 'deep_ocean', 'lake', 'river', 'shallow_water'];

const TIER_RANK = {};
TIER_NAMES.forEach((t, i) => { TIER_RANK[t] = i; });
TIER_RANK.ruins = -1;

// Minimum tile distance between settlement centres by tier (larger suppresses smaller).
const MIN_SPACING = {
  homestead: 30, hamlet: 40, village: 50, township: 60,
  town: 80, borough: 100, city: 140, great_city: 180,
  capital: 220, metropolis: 280, megacity: 350, world_capital: 440,
  ruins: 30,
};

/** Deterministic site for a macro-cell — the single source of the offset formula
 *  (was duplicated in genesis, overlay, renderer and tile-query). */
export function siteForMacro(seed, mx, my) {
  const cx = mx * MACRO_TILES + Math.floor(MACRO_TILES / 2);
  const cy = my * MACRO_TILES + Math.floor(MACRO_TILES / 2);
  const ox = Math.floor((rand(seed, mx * 7 + 1, my * 13 + 2) - 0.5) * MACRO_TILES * 0.5);
  const oy = Math.floor((rand(seed, mx * 11 + 3, my * 17 + 4) - 0.5) * MACRO_TILES * 0.5);
  return { cx, cy, x: cx + ox, y: cy + oy };
}

// Per-macro-cell discovery is a pure f(seed, mx, my) — independent of the query range —
// so memoize it. A boundary crossing re-scans ~90% of the same macro-cells (only one
// row/column is new), and discovery's classify+chronicle pipeline is non-trivial, so a
// session-lifetime cache turns a full re-scan into O(new cells). Seed-keyed: reset on
// seed change (mirrors resolved-buildings.js's _layoutMemo). Stores null for wilderness/
// water cells so they aren't re-derived either.
let _discoveryMemo = new Map(); // 'mx,my' -> settlement | null
let _discoveryMemoSeed = null;
export function clearDiscoveryMemo() { _discoveryMemo = new Map(); _discoveryMemoSeed = null; }

/** Derive the single settlement (or null) at macro-cell (mx,my). Pure f(seed,mx,my). */
function deriveMacroCell(seed, mx, my, epochs) {
  const mk = `${mx},${my}`;
  const { cx, cy, x, y } = siteForMacro(seed, mx, my);
  // Stream-free: settlement placement never needs the hydrology stream layer — SITE_WATER
  // has no 'stream' and the chronicle reads only climate — so skip the cold streamAt trace.
  const biome = classifyBiomeNoStream(cx, cy);
  const peoples = macroCellPeoples(seed, mk, epochs, biome);
  const chronicle = regionChronicle(seed, mk, peoples, biome.climate);
  const state = settlementState(chronicle);
  if (state === 'wilderness') return null;

  const foundingEv = chronicle.find(e => e.type === 'ancient_founding' || e.type === 'founding');
  const race = foundingEv?.raceId ?? peoples[0]?.raceId ?? 'human';
  const chronicleAge = chronicle.length > 0 ? Math.max(...chronicle.map(e => e.age ?? 0)) : 0;
  const tier = state === 'ruined' ? 'ruins' : chronicleTier(chronicle, seed, mk);

  const siteBiome = classifyBiomeNoStream(x, y);
  if (SITE_WATER.includes(siteBiome.id)) return null;

  const name = generateSettlementName(seed, x, y);
  return { mx, my, x, y, tier, race, state, chronicleAge, biome: siteBiome.id, name };
}

/** All non-wilderness settlements whose macro-cell lies in [mx0..mx1]×[my0..my1].
 *  Pure f(seed, range). Reproduces the overlay's discovery exactly (plus mx,my). */
export function discoverSettlementsInMacroRange(seed, mx0, my0, mx1, my1) {
  if (seed !== _discoveryMemoSeed) { _discoveryMemo = new Map(); _discoveryMemoSeed = seed; }
  const epochs = worldEpochs(seed);
  const settlements = [];
  for (let my = my0; my <= my1; my++) {
    for (let mx = mx0; mx <= mx1; mx++) {
      const mk = `${mx},${my}`;
      let s = _discoveryMemo.get(mk);
      if (s === undefined) {
        s = deriveMacroCell(seed, mx, my, epochs);
        _discoveryMemo.set(mk, s); // may be null (wilderness/water) — cached so it isn't re-derived
      }
      if (s) settlements.push(s);
    }
  }
  return settlements;
}

/** Larger settlements suppress nearby smaller ones (overlay spacing rule).
 *  Returns a new array; input is not mutated. Deterministic. */
export function suppressBySpacing(settlements) {
  // Range-INDEPENDENT total order: larger tier first, then a deterministic
  // settlement-intrinsic key (never the macro-scan order, which depends on the
  // query range) so the survivor set is identical no matter how it was queried.
  const sorted = settlements.slice().sort((a, b) =>
    (TIER_RANK[b.tier] ?? 0) - (TIER_RANK[a.tier] ?? 0)
    || a.mx - b.mx || a.my - b.my || a.x - b.x || a.y - b.y);
  const kept = [];
  for (const s of sorted) {
    const spacing = MIN_SPACING[s.tier] ?? 50;
    let tooClose = false;
    for (const k of kept) {
      const dist = Math.abs(s.x - k.x) + Math.abs(s.y - k.y);
      const largerSpacing = MIN_SPACING[k.tier] ?? 50;
      if (dist < largerSpacing && (TIER_RANK[k.tier] ?? 0) >= (TIER_RANK[s.tier] ?? 0)) { tooClose = true; break; }
      if (dist < Math.min(spacing, largerSpacing) * 0.7) { tooClose = true; break; }
    }
    if (!tooClose) kept.push(s);
  }
  return kept;
}

export { TIER_RANK, MIN_SPACING };
