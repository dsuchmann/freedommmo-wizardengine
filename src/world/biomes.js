import { fbm } from '../core/random.js';

export const SPEC_BIOME_IDS = Object.freeze([
  'ocean', 'deep_ocean', 'shallow_water', 'beach', 'river', 'lake',
  'grassland', 'forest', 'dense_forest', 'tropical_forest', 'taiga',
  'savanna', 'steppe', 'desert', 'swamp', 'tundra', 'arctic',
  'hills', 'mountains', 'volcanic', 'mystic'
]);

export const BIOMES = Object.freeze({
  deep_ocean: { material: 'deep_ocean_water', color: '#123d68', walkable: false, movementCost: Infinity },
  ocean: { material: 'ocean_water', color: '#1c5d8f', walkable: false, movementCost: Infinity },
  shallow_water: { material: 'shallow_water', color: '#2f83a7', walkable: false, movementCost: Infinity },
  river: { material: 'river_water', color: '#287ca4', walkable: false, movementCost: Infinity },
  lake: { material: 'lake_water', color: '#236f93', walkable: false, movementCost: Infinity },
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

export function sampleClimate(wx, wy) {
  const continental = fbm(wx, wy, 10);
  const detail = fbm(wx, wy, 99);
  const elevation = clamp01(continental * 0.88 + detail * 0.30 - 0.06);
  const moisture = clamp01(fbm(wx + 9000, wy - 4000, 20) * 1.12);
  const latitudeCold = Math.min(0.55, Math.abs(wy) / 9000);
  const altitudeCold = Math.max(0, elevation - 0.58) * 0.55;
  const heat = clamp01(fbm(wx - 3000, wy + 7000, 30) * 1.12 - latitudeCold - altitudeCold + 0.08);
  const drainage = fbm(wx + 17000, wy - 11000, 40);
  const aether = fbm(wx - 52000, wy + 33000, 66, undefined, 1400, 4);
  return { elevation, moisture, heat, drainage, aether };
}

export function classifyBiome(wx, wy) {
  const climate = sampleClimate(wx, wy);
  const { elevation, moisture, heat, drainage, aether } = climate;
  let id;
  if (aether > 0.78 && elevation > 0.43 && elevation < 0.76) id = 'mystic';
  else if (elevation < 0.26) id = 'deep_ocean';
  else if (elevation < 0.36) id = 'ocean';
  else if (elevation < 0.40) id = 'shallow_water';
  else if (elevation < 0.42) id = moisture > 0.82 ? 'lake' : 'beach';
  else if (drainage > 0.73 && moisture > 0.58 && elevation < 0.62) id = 'river';
  else if (moisture > 0.86 && elevation < 0.58) id = 'lake';
  else if (elevation > 0.74 && heat > 0.36 && moisture < 0.56 && drainage > 0.58) id = 'volcanic';
  else if (elevation > 0.78) id = heat < 0.24 ? 'arctic' : 'mountains';
  else if (elevation > 0.66) id = heat < 0.30 ? 'tundra' : 'hills';
  else if (heat < 0.22) id = moisture > 0.45 ? 'taiga' : 'tundra';
  else if (moisture > 0.80 && heat > 0.58) id = 'tropical_forest';
  else if (moisture > 0.76 && heat > 0.32) id = 'swamp';
  else if (moisture > 0.66) id = heat > 0.48 ? 'dense_forest' : 'forest';
  else if (moisture < 0.25 && heat > 0.52) id = 'desert';
  else if (moisture < 0.34 && heat > 0.34) id = 'steppe';
  else if (moisture < 0.44 && heat > 0.48) id = 'savanna';
  else id = 'grassland';
  return { id, definition: BIOMES[id], climate };
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}
