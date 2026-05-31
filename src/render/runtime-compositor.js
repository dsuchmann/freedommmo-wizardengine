import { rand2 } from '../core/random.js';

export class RuntimeCompositor {
  constructor(catalog) {
    this.catalog = catalog;
  }

  terrainSignature(tile) {
    const water = ['deep_ocean', 'ocean', 'shallow_water', 'river', 'lake', 'swamp'].includes(tile.biome);
    const asset = water ? this.catalog.waterForBiome(tile.biome) : this.catalog.terrainForBiome(tile.biome);
    return {
      assetId: asset?.id ?? 'unknown_ground',
      variant: Math.floor(rand2(tile.wx, tile.wy, 6100) * 100000),
      layers: terrainLayersFor(tile),
      states: terrainStatesFor(tile)
    };
  }

  objectSignature(kind, biome, wx, wy) {
    const asset = this.catalog.objectForKind(kind, biome);
    return {
      assetId: asset?.id ?? kind,
      variant: Math.floor(rand2(wx, wy, 6200) * 100000),
      layers: asset?.layers ?? ['shadow', 'base', 'detail', 'lighting_mask'],
      states: ['default']
    };
  }
}

function terrainLayersFor(tile) {
  const layers = ['base'];
  if (tile.biome.includes('ocean') || tile.biome === 'river' || tile.biome === 'lake') layers.push('flow', 'sparkle', 'foam');
  else if (tile.biome === 'forest' || tile.biome === 'dense_forest' || tile.biome === 'taiga' || tile.biome === 'tropical_forest') layers.push('leaf_litter', 'roots', 'moss');
  else if (tile.biome === 'beach' || tile.biome === 'desert') layers.push('grain', 'ripple', 'pebbles');
  else if (tile.biome === 'hills' || tile.biome === 'mountains' || tile.biome === 'volcanic') layers.push('strata', 'cracks', 'pebbles');
  else layers.push('micro_grass', 'flowers', 'dirt_scars');
  if (tile.features?.includes('dry_riverbed')) layers.push('silt', 'cracked_mud');
  if (tile.terrainForm === 'cliff') layers.push('cliff_wall', 'overhang_shadow');
  layers.push('shadow_mask');
  return layers;
}

function terrainStatesFor(tile) {
  const states = [];
  if (tile.climate.moisture > 0.72) states.push('wet');
  if (tile.climate.heat < 0.25) states.push('cold');
  if (tile.climate.heat > 0.70) states.push('dry');
  if (tile.features?.includes('overhang')) states.push('overhang');
  if (tile.features?.includes('cave_entrance')) states.push('cave');
  return states.length ? states : ['default'];
}
