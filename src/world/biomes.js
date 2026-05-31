import { fbm } from '../core/random.js';

export const BIOMES = Object.freeze({
  ocean: { material: 'ocean_water', color: '#1c5d8f', walkable: false, movementCost: Infinity },
  beach: { material: 'golden_sand', color: '#d8bd75', walkable: true, movementCost: 1.15 },
  grassland: { material: 'lush_grass', color: '#5fa64b', walkable: true, movementCost: 1 },
  forest: { material: 'forest_floor', color: '#2f7137', walkable: true, movementCost: 1.35 },
  dense_forest: { material: 'dark_humus', color: '#1f4e2d', walkable: true, movementCost: 1.8 },
  savanna: { material: 'dry_grass', color: '#b3a24c', walkable: true, movementCost: 1.05 },
  desert: { material: 'hot_sand', color: '#d7a94f', walkable: true, movementCost: 1.25 },
  hills: { material: 'stony_grass', color: '#827d55', walkable: true, movementCost: 1.6 },
  mountain: { material: 'grey_rock', color: '#777b82', walkable: true, movementCost: 2.2 },
  snow: { material: 'snow', color: '#d9e6eb', walkable: true, movementCost: 1.9 },
  swamp: { material: 'wet_mud', color: '#42694a', walkable: true, movementCost: 2 }
});

export function sampleClimate(wx, wy) {
  const elevation = fbm(wx, wy, 10) + fbm(wx, wy, 99) * 0.35 - 0.12;
  const moisture = fbm(wx + 9000, wy - 4000, 20);
  const heat = fbm(wx - 3000, wy + 7000, 30) - Math.abs(wy) / 9000;
  return { elevation, moisture, heat };
}

export function classifyBiome(wx, wy) {
  const climate = sampleClimate(wx, wy);
  const { elevation, moisture, heat } = climate;
  let id;
  if (elevation < 0.30) id = 'ocean';
  else if (elevation < 0.35) id = 'beach';
  else if (elevation > 0.77) id = heat < 0.35 ? 'snow' : 'mountain';
  else if (elevation > 0.67) id = 'hills';
  else if (moisture > 0.76 && heat > 0.35) id = 'swamp';
  else if (moisture > 0.68) id = heat > 0.52 ? 'dense_forest' : 'forest';
  else if (moisture < 0.28 && heat > 0.50) id = 'desert';
  else if (moisture < 0.40) id = 'savanna';
  else id = 'grassland';
  return { id, definition: BIOMES[id], climate };
}
