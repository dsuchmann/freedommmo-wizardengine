import { LAYERS } from '../core/constants.js';

export function createTileStack({ wx, wy, biomeSample }) {
  const { id, definition, climate } = biomeSample;
  return {
    wx,
    wy,
    layers: {
      [LAYERS.bedrock]: { kind: 'bedrock', material: climate.elevation > 0.67 ? 'granite' : 'sedimentary' },
      [LAYERS.substrate]: { kind: 'substrate', moisture: climate.moisture, heat: climate.heat },
      [LAYERS.terrain]: { kind: 'terrain', biome: id, material: definition.material, walkable: definition.walkable, movementCost: definition.movementCost },
      [LAYERS.surface]: { kind: 'surface', detail: chooseSurfaceDetail(id, climate) },
      [LAYERS.objects]: { kind: 'objects', items: [] },
      [LAYERS.structures]: { kind: 'structures', items: [] },
      [LAYERS.entities]: { kind: 'entities', items: [] },
      [LAYERS.lighting]: { kind: 'lighting', ambient: 1, local: 0 }
    },
    climate,
    biome: id,
    material: definition.material,
    walkable: definition.walkable,
    movementCost: definition.movementCost
  };
}

function chooseSurfaceDetail(biome, climate) {
  if (biome === 'ocean') return climate.elevation < 0.24 ? 'deep_water' : 'shallow_water';
  if (biome === 'beach') return climate.moisture > 0.5 ? 'wet_sand' : 'dry_sand';
  if (biome === 'forest' || biome === 'dense_forest') return 'leaf_litter';
  if (biome === 'mountain' || biome === 'hills') return 'stone_scatter';
  if (biome === 'swamp') return 'mud_pools';
  if (biome === 'snow') return 'snow_drift';
  return 'ground_cover';
}

export function addObjectToTile(tile, object) {
  tile.layers[LAYERS.objects].items.push(object);
}

export function projectTileForRender(tile, biomeDefinition) {
  return {
    color: biomeDefinition.color,
    elevation: tile.climate.elevation,
    biome: tile.biome,
    material: tile.material,
    surface: tile.layers[LAYERS.surface].detail,
    walkable: tile.walkable
  };
}
