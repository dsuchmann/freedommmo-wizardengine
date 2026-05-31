export const BIOME_NEIGHBORS = Object.freeze({
  deep_ocean: ['ocean'],
  ocean: ['deep_ocean', 'shallow_water'],
  shallow_water: ['ocean', 'beach', 'river', 'lake', 'swamp'],
  beach: ['shallow_water', 'grassland', 'desert', 'swamp'],
  river: ['shallow_water', 'lake', 'swamp', 'grassland', 'forest', 'hills'],
  lake: ['river', 'shallow_water', 'swamp', 'grassland', 'forest'],
  grassland: ['beach', 'forest', 'savanna', 'steppe', 'hills', 'river', 'lake', 'mystic'],
  forest: ['grassland', 'dense_forest', 'taiga', 'swamp', 'hills', 'river', 'mystic'],
  dense_forest: ['forest', 'tropical_forest', 'swamp', 'mystic'],
  tropical_forest: ['dense_forest', 'forest', 'swamp', 'mystic'],
  taiga: ['forest', 'tundra', 'hills', 'mountains'],
  savanna: ['grassland', 'steppe', 'desert', 'hills'],
  steppe: ['grassland', 'savanna', 'desert', 'tundra', 'hills'],
  desert: ['beach', 'savanna', 'steppe', 'hills', 'volcanic'],
  swamp: ['shallow_water', 'river', 'lake', 'forest', 'dense_forest', 'tropical_forest'],
  tundra: ['taiga', 'steppe', 'hills', 'mountains', 'arctic'],
  arctic: ['tundra', 'mountains'],
  hills: ['grassland', 'forest', 'savanna', 'steppe', 'desert', 'taiga', 'tundra', 'mountains', 'volcanic', 'mystic'],
  mountains: ['hills', 'taiga', 'tundra', 'arctic', 'volcanic', 'mystic'],
  volcanic: ['mountains', 'hills', 'desert'],
  mystic: ['grassland', 'forest', 'dense_forest', 'tropical_forest', 'hills', 'mountains']
});

export function areBiomeNeighbors(a, b) {
  return a === b || Boolean(BIOME_NEIGHBORS[a]?.includes(b));
}

export function transitionBiome(primary, candidate) {
  if (areBiomeNeighbors(primary, candidate)) return candidate;
  return primary;
}

export function biomeDistancePenalty(primary, candidate) {
  return areBiomeNeighbors(primary, candidate) ? 0 : 1;
}
