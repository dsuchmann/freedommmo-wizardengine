// sim/matter/composition.js — Lazily DERIVED grain composition (no stored state
// for baseline things — world = f(seed, deltas, ledger), spec §5.1).
// Living nodes: grains = yield[species] * body. Matter/corpse: yield * E.
// Stored composition exists only on inventory items (snapshot at transfer).
import { GRAINS } from './grains.js';

// grain units per tu of body (living nodes)
export const SPECIES_YIELD = {
  grass:      { fibre: 0.008, cellulose: 0.002 },
  berry_bush: { cellulose: 0.005, sugar: 0.003, fibre: 0.002 },
  tree:       { cellulose: 0.006, lignin: 0.004 },
  grazer:     { keratin: 0.005, bone: 0.003 },
};

// grain units per tu of E (matter nodes by archetype CLASS — prefix match,
// so 'boulder_small'/'boulder_mossy' → 'boulder'). Default: stone.
export const ARCHETYPE_YIELD = {
  boulder:    { stone: 0.01 },
  rock_chunk: { stone: 0.01 },
  rock:       { stone: 0.01 },
  stone_dust: { stone: 0.01 },
  stone:      { stone: 0.01 },
  pebble:     { stone: 0.01 },
  log:        { cellulose: 0.006, lignin: 0.004 },
  branch:     { cellulose: 0.008, lignin: 0.002 },
  wood_scrap: { cellulose: 0.006, lignin: 0.004 },
  stump:      { cellulose: 0.005, lignin: 0.005 },
  ore:        { ore: 0.008, stone: 0.004 },
  road_segment: {},  // labor-only: no grains conjured from time (material construction = backlog)
  ford:   {},        // labor-only: longest-prefix fallthrough would conjure stone — must be explicit
  bridge: {},        // labor-only: longest-prefix fallthrough would conjure stone — must be explicit
  default:    { stone: 0.01 },
};

/** Canonical archetype CLASS of an instance name ('boulder_small' → 'boulder').
 *  Same longest-prefix rule the yield tables use. Exported for recipe signatures. */
export function archetypeClassOf(archetype) {
  const candidates = Object.keys(ARCHETYPE_YIELD)
    .filter(k => k !== 'default')
    .sort((a, b) => b.length - a.length);
  return candidates.find(k => String(archetype ?? '').startsWith(k)) ?? String(archetype ?? 'unknown');
}

function archetypeYield(archetype) {
  return ARCHETYPE_YIELD[archetypeClassOf(archetype)] ?? ARCHETYPE_YIELD.default;
}

function scale(tbl, magnitude) {
  const out = {};
  for (const [g, perTu] of Object.entries(tbl)) out[g] = perTu * magnitude;
  return out;
}

/** Derived grain composition of any node. Pure; never mutates. */
export function compositionOf(node) {
  const a = node.attrs ?? {};
  if (node.type === 'matter') return scale(archetypeYield(a.archetype), a.E ?? 0);
  if (node.type === 'corpse') {
    const tbl = a.species ? SPECIES_YIELD[a.species] : archetypeYield(a.archetype);
    return scale(tbl ?? ARCHETYPE_YIELD.default, a.E ?? 0);
  }
  if (a.species && SPECIES_YIELD[a.species]) return scale(SPECIES_YIELD[a.species], a.body ?? 0);
  return {};
}

/** Grains leaving a living node when `bite` tu of body+R is taken (transfer point). */
export function grainsForBite(species, bite) {
  return scale(SPECIES_YIELD[species] ?? {}, bite);
}

/** Per-tu yield table for a node: species table if species known, else archetype prefix-match,
 *  else default. Used by metabolism.js to count grain:decayed:* sinks during corpse decay.
 *  NOTE: composition.js must NOT import metabolism.js (no cycle). */
export function yieldOf(node) {
  const a = node.attrs ?? {};
  if (a.species && SPECIES_YIELD[a.species]) return SPECIES_YIELD[a.species];
  return archetypeYield(a.archetype);
}

/** Composition-weighted emergent properties (M2 durability + M3 recipe math consume this). */
export function propertiesOf(composition) {
  let totalUnits = 0, energy = 0, purity = 0, resonance = 0, stability = 0;
  for (const [g, units] of Object.entries(composition)) {
    const def = GRAINS[g];
    if (!def || units <= 0) continue;
    totalUnits += units;
    energy += units * def.energyDensity;
    purity += units * def.purity;
    resonance += units * def.resonance;
    stability += units * def.stability;
  }
  if (totalUnits === 0) return { totalUnits: 0, energy: 0, purity: 0, resonance: 0, stability: 0 };
  return { totalUnits, energy, purity: purity / totalUnits, resonance: resonance / totalUnits, stability: stability / totalUnits };
}
