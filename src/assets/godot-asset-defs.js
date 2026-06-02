export const godotTerrainDefs = Object.freeze([
  { id: 'godot_grass', src: 'reference/godot/assets/tiles/pro/grass.png', cell: 32, frames: 1, fullImage: true, rows: [{ id: 'godot_grass_base', row: 0, frames: 1 }] },
  { id: 'godot_forest', src: 'reference/godot/assets/tiles/pro/forest.png', cell: 32, frames: 1, fullImage: true, rows: [{ id: 'godot_forest_base', row: 0, frames: 1 }] },
  { id: 'godot_desert', src: 'reference/godot/assets/tiles/pro/desert.png', cell: 32, frames: 1, fullImage: true, rows: [{ id: 'godot_desert_base', row: 0, frames: 1 }] },
  { id: 'godot_swamp', src: 'reference/godot/assets/tiles/pro/swamp.png', cell: 32, frames: 1, fullImage: true, rows: [{ id: 'godot_swamp_base', row: 0, frames: 1 }] },
  { id: 'godot_snow', src: 'reference/godot/assets/tiles/pro/snow.png', cell: 32, frames: 1, fullImage: true, rows: [{ id: 'godot_snow_base', row: 0, frames: 1 }] },
  { id: 'godot_mountain', src: 'reference/godot/assets/tiles/pro/mountain.png', cell: 32, frames: 1, fullImage: true, rows: [{ id: 'godot_mountain_base', row: 0, frames: 1 }] },
  { id: 'godot_beach', src: 'reference/godot/assets/tiles/pro/beach.png', cell: 32, frames: 1, fullImage: true, rows: [{ id: 'godot_beach_base', row: 0, frames: 1 }] },
  { id: 'godot_deep_water', src: 'reference/godot/assets/tiles/pro/deep_water.png', cell: 32, frames: 1, fullImage: true, rows: [{ id: 'godot_deep_water_base', row: 0, frames: 1 }] },
  { id: 'godot_shallow_water', src: 'reference/godot/assets/tiles/pro/shallow_water.png', cell: 32, frames: 1, fullImage: true, rows: [{ id: 'godot_shallow_water_base', row: 0, frames: 1 }] },
  { id: 'godot_volcanic', src: 'reference/godot/assets/tiles/pro/volcanic.png', cell: 32, frames: 1, fullImage: true, rows: [{ id: 'godot_volcanic_base', row: 0, frames: 1 }] }
]);

export const godotObjectDefs = Object.freeze([
  { id: 'godot_oak_tree', src: 'reference/godot/assets/map_objects/nature/oak_tree.png', cell: 32, frames: 1, fullImage: true, rows: [{ id: 'godot_oak_tree', row: 0, frames: 1 }] },
  { id: 'godot_magic_tree', src: 'reference/godot/assets/map_objects/nature/magic_tree.png', cell: 32, frames: 1, fullImage: true, rows: [{ id: 'godot_magic_tree', row: 0, frames: 1 }] },
  { id: 'godot_pine_tree', src: 'reference/godot/assets/map_objects/nature/pine_tree.png', cell: 32, frames: 1, fullImage: true, rows: [{ id: 'godot_pine_tree', row: 0, frames: 1 }] },
  { id: 'godot_ancient_tree', src: 'reference/godot/assets/map_objects/nature/ancient_tree.png', cell: 32, frames: 1, fullImage: true, rows: [{ id: 'godot_ancient_tree', row: 0, frames: 1 }] },
  { id: 'godot_bush', src: 'reference/godot/assets/map_objects/nature/bush.png', cell: 32, frames: 1, fullImage: true, rows: [{ id: 'godot_bush', row: 0, frames: 1 }] },
  { id: 'godot_fern', src: 'reference/godot/assets/map_objects/nature/fern.png', cell: 32, frames: 1, fullImage: true, rows: [{ id: 'godot_fern', row: 0, frames: 1 }] },
  { id: 'godot_wildflowers', src: 'reference/godot/assets/map_objects/nature/wildflowers.png', cell: 32, frames: 1, fullImage: true, rows: [{ id: 'godot_wildflowers', row: 0, frames: 1 }] },
  { id: 'godot_pebbles', src: 'reference/godot/assets/map_objects/nature/pebbles.png', cell: 32, frames: 1, fullImage: true, rows: [{ id: 'godot_pebbles', row: 0, frames: 1 }] }
]);

export function godotTerrainFrameForBiome(biome) {
  if (biome.includes('ocean')) return 'godot_deep_water_base';
  if (biome.includes('water') || biome === 'river' || biome === 'lake') return 'godot_shallow_water_base';
  if (biome === 'beach') return 'godot_beach_base';
  if (biome === 'desert') return 'godot_desert_base';
  if (biome === 'swamp') return 'godot_swamp_base';
  if (biome === 'tundra' || biome === 'arctic') return 'godot_snow_base';
  if (biome === 'mountains' || biome === 'hills') return 'godot_mountain_base';
  if (biome === 'volcanic') return 'godot_volcanic_base';
  if (biome.includes('forest') || biome === 'taiga') return 'godot_forest_base';
  return 'godot_grass_base';
}
