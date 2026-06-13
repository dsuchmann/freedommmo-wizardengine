// sim/chronicle/races.js — P3 L1a: biome-anchored race table.
// Pure functions: no kernel state, no side-effects. Every biome has at least
// one race with weight >= 0.5. Names are original — no Tolkien species.
import { rand, mix } from '../kernel/rng.js';
import { classifyBiome } from '../../src/world/biomes.js';
import { REGION } from '../lod/aggregate.js';

// Must match genesis.js MACRO value.
const MACRO = 4;
const MACRO_TILES = MACRO * REGION;

export const RACES = {
  ignaar: {
    name: 'Ignaar',
    desc: 'Golem-kind born from volcanic crucibles, bodies of cooling basalt and ember.',
    affinities: [{ biome: 'volcanic', weight: 1.0 }],
  },
  veylith: {
    name: 'Veylith',
    desc: 'Crystal humanoids attuned to aether currents, translucent and sharp-edged.',
    affinities: [{ biome: 'mystic', weight: 1.0 }],
  },
  grotharn: {
    name: 'Grotharn',
    desc: 'Hulking swamp-dwellers with moss-threaded hide, patient and territorial.',
    affinities: [{ biome: 'swamp', weight: 1.0 }],
  },
  kaldreth: {
    name: 'Kaldreth',
    desc: 'Living stone people shaped by tectonic pressure, slow but unyielding.',
    affinities: [
      { biome: 'mountains', weight: 1.0 },
      { biome: 'hills', weight: 0.6 },
    ],
  },
  sylvari: {
    name: 'Sylvari',
    desc: 'Bark-skinned forest spirits whose roots drink deep from the canopy floor.',
    affinities: [
      { biome: 'forest', weight: 0.9 },
      { biome: 'dense_forest', weight: 0.9 },
      { biome: 'tropical_forest', weight: 0.7 },
    ],
  },
  ashren: {
    name: 'Ashren',
    desc: 'Nomadic desert-born who read the sand like scripture and endure any heat.',
    affinities: [
      { biome: 'desert', weight: 0.9 },
      { biome: 'savanna', weight: 0.5 },
      { biome: 'steppe', weight: 0.5 },
    ],
  },
  frostwyn: {
    name: 'Frostwyn',
    desc: 'Cold-adapted people with ice-threaded blood, thriving where others freeze.',
    affinities: [
      { biome: 'tundra', weight: 0.9 },
      { biome: 'taiga', weight: 0.9 },
      { biome: 'arctic', weight: 0.7 },
    ],
  },
  thalori: {
    name: 'Thalori',
    desc: 'Coastal seafarers with salt-weathered skin and deep knowledge of tides.',
    affinities: [
      { biome: 'beach', weight: 1.0 },
      { biome: 'shallow_water', weight: 0.7 },
      { biome: 'ocean', weight: 0.3 },
    ],
  },
  human: {
    name: 'Human',
    desc: 'Adaptable and ambitious, at home in any land that can grow food.',
    affinities: [
      { biome: 'grassland', weight: 0.5 },
      { biome: 'forest', weight: 0.3 },
      { biome: 'hills', weight: 0.3 },
      { biome: 'steppe', weight: 0.3 },
      { biome: 'savanna', weight: 0.3 },
      { biome: 'desert', weight: 0.2 },
      { biome: 'taiga', weight: 0.2 },
      { biome: 'tundra', weight: 0.15 },
      { biome: 'swamp', weight: 0.2 },
      { biome: 'beach', weight: 0.5 },
      { biome: 'shallow_water', weight: 0.2 },
      { biome: 'dense_forest', weight: 0.2 },
      { biome: 'tropical_forest', weight: 0.2 },
      { biome: 'mountains', weight: 0.1 },
      { biome: 'volcanic', weight: 0.05 },
      { biome: 'mystic', weight: 0.1 },
    ],
  },
};

// Index: biomeId → [{raceId, weight}] sorted by weight desc
const _biomeIndex = new Map();
for (const [raceId, race] of Object.entries(RACES)) {
  for (const aff of race.affinities) {
    let list = _biomeIndex.get(aff.biome);
    if (!list) { list = []; _biomeIndex.set(aff.biome, list); }
    list.push({ raceId, name: race.name, weight: aff.weight });
  }
}
for (const list of _biomeIndex.values()) list.sort((a, b) => b.weight - a.weight);

/** All races with affinity for `biomeId`, sorted by weight desc. */
export function biomeAffinities(biomeId) {
  return _biomeIndex.get(biomeId) ?? [];
}

/** Pure f(seed, macroKey, epochs). Samples the dominant biome at macro-cell center,
 *  rolls each race's affinity against a seeded threshold. Returns [{raceId, name, presence}]. */
export function macroCellPeoples(seed, macroKey, epochs) {
  const [mx, my] = macroKey.split(',').map(Number);
  const cx = mx * MACRO_TILES + Math.floor(MACRO_TILES / 2);
  const cy = my * MACRO_TILES + Math.floor(MACRO_TILES / 2);
  const biome = classifyBiome(cx, cy);
  const biomeId = biome.id;
  const affs = biomeAffinities(biomeId);

  // Also consider races with broad affinity that may not appear in the index
  const seen = new Set(affs.map(a => a.raceId));
  const allAffs = [...affs];
  for (const [raceId, race] of Object.entries(RACES)) {
    if (seen.has(raceId)) continue;
    for (const aff of race.affinities) {
      if (aff.biome === biomeId) {
        allAffs.push({ raceId, name: race.name, weight: aff.weight });
        break;
      }
    }
  }

  // Epoch severity modulates threshold slightly (harsher epochs → fewer peoples survive)
  const epochSeverity = epochs.reduce((s, e) => s + (e.severity ?? 0), 0) / Math.max(1, epochs.length);
  const threshold = 0.15 + epochSeverity * 0.1; // 0.15–0.25 range — generous, terrain gates the rest

  const result = [];
  const cellHash = mix(mx, my);
  for (let i = 0; i < allAffs.length; i++) {
    const { raceId, name, weight } = allAffs[i];
    const roll = rand(seed, 1, cellHash, i);
    if (roll < weight - threshold + 0.5) {
      // presence: how strongly established (0–1)
      const presence = Math.min(1, weight * (0.5 + rand(seed, 1, cellHash, i + 1000) * 0.5));
      result.push({ raceId, name, presence });
    }
  }

  return result;
}
