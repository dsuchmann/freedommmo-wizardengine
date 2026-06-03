export const SPEC_BIOME_IDS = Object.freeze([
  'ocean', 'deep_ocean', 'shallow_water', 'beach', 'river', 'lake',
  'grassland', 'forest', 'dense_forest', 'tropical_forest', 'taiga',
  'savanna', 'steppe', 'desert', 'swamp', 'tundra', 'arctic',
  'hills', 'mountains', 'volcanic', 'mystic'
]);

export const BIOMES = Object.freeze({
  deep_ocean: { material: 'deep_ocean_water', color: '#123d68', walkable: true, movementCost: 3 },
  ocean: { material: 'ocean_water', color: '#1c5d8f', walkable: true, movementCost: 3 },
  shallow_water: { material: 'shallow_water', color: '#2f83a7', walkable: true, movementCost: 2 },
  river: { material: 'river_water', color: '#287ca4', walkable: true, movementCost: 2 },
  lake: { material: 'lake_water', color: '#236f93', walkable: true, movementCost: 2 },
  beach: { material: 'golden_sand', color: '#d8bd75', walkable: true, movementCost: 1.15 },
  grassland: { material: 'lush_grass', color: '#5fa64b', walkable: true, movementCost: 1 },
  forest: { material: 'forest_floor', color: '#2f7137', walkable: true, movementCost: 1.35 },
  dense_forest: { material: 'dark_humus', color: '#1f4e2d', walkable: true, movementCost: 1.8 },
  tropical_forest: { material: 'tropical_humus', color: '#247b3d', walkable: true, movementCost: 1.7 },
  taiga: { material: 'needle_duff', color: '#315d4c', walkable: true, movementCost: 1.55 },
  savanna: { material: 'dry_grass', color: '#b3a24c', walkable: true, movementCost: 1.05 },
  steppe: { material: 'short_grass', color: '#8f9a54', walkable: true, movementCost: 1.05 },
  desert: { material: 'hot_sand', color: '#d7a94f', walkable: true, movementCost: 1.25 },
  hills: { material: 'stony_grass', color: '#827d55', walkable: true, movementCost: 1.6 },
  mountains: { material: 'grey_rock', color: '#777b82', walkable: true, movementCost: 2.2 },
  volcanic: { material: 'basalt', color: '#4a3f3c', walkable: true, movementCost: 2.4 },
  mystic: { material: 'aether_moss', color: '#8a5bd6', walkable: true, movementCost: 1.25 },
  tundra: { material: 'frozen_earth', color: '#9fb0aa', walkable: true, movementCost: 1.7 },
  arctic: { material: 'glacial_ice', color: '#c9e5ee', walkable: true, movementCost: 2.1 },
  swamp: { material: 'wet_mud', color: '#42694a', walkable: true, movementCost: 2 }
});
