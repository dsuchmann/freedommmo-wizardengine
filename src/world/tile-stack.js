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
      [LAYERS.terrainForms]: { kind: 'terrainForms', form: 'plains', features: [] },
      [LAYERS.subterranean]: { kind: 'subterranean', entrance: false, depthHint: 0, connected: false },
      [LAYERS.entities]: { kind: 'entities', items: [] },
      [LAYERS.lighting]: { kind: 'lighting', ambient: 1, local: 0 }
    },
    climate,
    biome: id,
    material: definition.material,
    walkable: definition.walkable,
    movementCost: definition.movementCost,
    terrainForm: 'plains',
    features: []
  };
}

function chooseSurfaceDetail(biome, climate) {
  if (biome === 'ocean') return climate.elevation < 0.24 ? 'deep_water' : 'shallow_water';
  if (biome === 'beach') return climate.moisture > 0.5 ? 'wet_sand' : 'dry_sand';
  if (biome === 'mystic') return 'aether_bloom';
  if (biome === 'forest' || biome === 'dense_forest' || biome === 'taiga' || biome === 'tropical_forest') return 'leaf_litter';
  if (biome === 'mountains' || biome === 'hills' || biome === 'volcanic') return 'stone_scatter';
  if (biome === 'swamp') return 'mud_pools';
  if (biome === 'tundra' || biome === 'arctic') return 'snow_drift';
  return 'ground_cover';
}

export function addObjectToTile(tile, object) {
  tile.layers[LAYERS.objects].items.push(object);
}

export function applyTerrainForm(tile, terrainForm) {
  tile.terrainForm = terrainForm.form;
  tile.features = [];
  if (terrainForm.dryRiverbed) tile.features.push('dry_riverbed');
  if (terrainForm.caveEntrance) tile.features.push('cave_entrance');
  if (terrainForm.overhang) tile.features.push('overhang');
  if (terrainForm.naturalBridge) tile.features.push('natural_bridge');
  tile.layers[LAYERS.terrainForms] = { kind: 'terrainForms', ...terrainForm, features: tile.features };
  if (terrainForm.subterranean) tile.layers[LAYERS.subterranean] = { kind: 'subterranean', entrance: true, depthHint: terrainForm.subterranean.depthHint, connected: true };
}

export function projectTileForRender(tile, biomeDefinition) {
  return {
    color: biomeDefinition.color,
    elevation: tile.climate.elevation,
    biome: tile.biome,
    material: tile.material,
    surface: tile.layers[LAYERS.surface].detail,
    terrainForm: tile.terrainForm,
    features: tile.features,
    slope: tile.layers[LAYERS.terrainForms].slope ?? 0,
    walkable: tile.walkable
  };
}
