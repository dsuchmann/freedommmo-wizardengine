const BIOME_SHEETS = Object.freeze({
  grassland: 'reference/godot/assets/tilesets/grassland.png',
  forest: 'reference/godot/assets/tilesets/forest.png',
  dense_forest: 'reference/godot/assets/tilesets/forest.png',
  tropical_forest: 'reference/godot/assets/tilesets/forest.png',
  taiga: 'reference/godot/assets/tilesets/forest.png',
  desert: 'reference/godot/assets/tilesets/desert.png',
  beach: 'reference/godot/assets/tilesets/ocean_beach.png',
  ocean: 'reference/godot/assets/tilesets/ocean_beach.png',
  deep_ocean: 'reference/godot/assets/tilesets/ocean_beach.png',
  shallow_water: 'reference/godot/assets/tilesets/ocean_beach.png',
  river: 'reference/godot/assets/tilesets/ocean_beach.png',
  lake: 'reference/godot/assets/tilesets/ocean_beach.png',
  mystic: 'reference/godot/assets/tilesets/grassland_lush.png'
});

const MASKS = [0, 1, 2, 3, 4, 5, 6, 7];

export const godotWangDefs = Object.freeze(Object.entries(BIOME_SHEETS).map(([biome, src]) => ({
  id: `godot_wang_${biome}`,
  src,
  cell: 32,
  frames: 1,
  rows: MASKS.map(mask => ({ id: `godot_wang_${biome}_${mask}`, row: 0, col: mask, frames: 1 }))
})));

export function godotWangFrameId(biome, mask) {
  const mapped = BIOME_SHEETS[biome] ? biome : fallbackBiome(biome);
  return `godot_wang_${mapped}_${mask & 15}`;
}

function fallbackBiome(biome) {
  if (biome?.includes('forest')) return 'forest';
  if (biome === 'savanna' || biome === 'steppe' || biome === 'hills') return 'grassland';
  if (biome === 'arctic' || biome === 'tundra' || biome === 'mountains' || biome === 'volcanic' || biome === 'swamp') return 'grassland';
  return 'grassland';
}
