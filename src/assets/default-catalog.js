import { AssetCatalog } from './asset-catalog.js';

const terrain = {
  domain: 'terrain',
  tileSize: [32, 32],
  assets: [
    { id: 'grassland_ground', category: 'terrain.ground', biomes: ['grassland', 'savanna', 'steppe'] },
    { id: 'forest_floor', category: 'terrain.ground', biomes: ['forest', 'dense_forest', 'taiga', 'tropical_forest'] },
    { id: 'sand_ground', category: 'terrain.ground', biomes: ['beach', 'desert'] },
    { id: 'stone_ground', category: 'terrain.ground', biomes: ['hills', 'mountains', 'volcanic', 'tundra', 'arctic'] },
    { id: 'water_surface', category: 'terrain.water', biomes: ['deep_ocean', 'ocean', 'shallow_water', 'river', 'lake', 'swamp'] },
    { id: 'cliff_wall', category: 'terrain.elevation', biomes: ['hills', 'mountains', 'volcanic', 'tundra', 'arctic', 'forest'] }
  ]
};

const vegetation = {
  domain: 'vegetation',
  assets: [
    { id: 'broadleaf_tree', category: 'vegetation.tree', biomes: ['forest', 'dense_forest', 'grassland', 'hills'] },
    { id: 'conifer_tree', category: 'vegetation.tree', biomes: ['taiga', 'tundra', 'mountains', 'forest'] },
    { id: 'underbrush_cluster', category: 'vegetation.underbrush', biomes: ['grassland', 'forest', 'dense_forest', 'tropical_forest', 'swamp', 'savanna', 'steppe'] }
  ]
};

const geology = {
  domain: 'geology',
  assets: [
    { id: 'boulder_cluster', category: 'geology.rock', biomes: ['hills', 'mountains', 'volcanic', 'tundra', 'arctic', 'desert', 'grassland'] },
    { id: 'cave_mouth', category: 'geology.cave', biomes: ['hills', 'mountains', 'volcanic', 'forest', 'tundra'] },
    { id: 'dry_riverbed', category: 'geology.pathway', biomes: ['grassland', 'savanna', 'steppe', 'desert', 'hills', 'forest'] }
  ]
};

export const defaultAssetCatalog = new AssetCatalog([terrain, vegetation, geology]);
