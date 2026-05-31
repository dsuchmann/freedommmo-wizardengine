const BIOMES = ['deep_ocean', 'ocean', 'shallow_water', 'beach', 'river', 'lake', 'grassland', 'forest', 'dense_forest', 'tropical_forest', 'taiga', 'savanna', 'steppe', 'desert', 'swamp', 'tundra', 'arctic', 'hills', 'mountains', 'volcanic', 'mystic'];
const MICRO_ROWS = ['soil', 'ground_cover', 'foliage_blades', 'flowers', 'debris', 'wet_overlay', 'climate_overlay', 'special'];
const NATURE_ROWS = ['tree', 'shrub', 'grass_cluster', 'rock', 'log_debris', 'flower_cluster', 'rare_resource', 'biome_special'];

export const libraryAtlasDefs = Object.freeze([
  ...BIOMES.map(biome => ({
    id: `${biome}_base_tiles`,
    src: `assets/generated/terrain/base/${biome}_base_tiles.png`,
    cell: 32,
    frames: 8,
    rows: Array.from({ length: 8 }, (_, row) => ({ id: `${biome}_base_${row}`, row, frames: 8 }))
  })),
  ...BIOMES.map(biome => ({
    id: `${biome}_micro_layers`,
    src: `assets/generated/terrain/micro/${biome}_micro_layers.png`,
    cell: 32,
    frames: 8,
    rows: MICRO_ROWS.map((name, row) => ({ id: `${biome}_${name}`, row, frames: 8 }))
  })),
  ...BIOMES.map(biome => ({
    id: `${biome}_nature_objects`,
    src: `assets/generated/objects/nature/${biome}_nature_objects.png`,
    cell: 32,
    frames: 8,
    rows: NATURE_ROWS.map((name, row) => ({ id: `${biome}_${name}`, row, frames: 8 }))
  }))
]);
