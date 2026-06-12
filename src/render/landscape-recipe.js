import { LAYERS } from '../core/constants.js';

const WATER_BIOMES = new Set(['river', 'lake', 'ocean', 'deep_ocean', 'shallow_water', 'stream']);
const DRY_BIOMES = new Set(['savanna', 'steppe', 'desert', 'beach']);
const FOREST_BIOMES = new Set(['forest', 'dense_forest', 'tropical_forest', 'taiga', 'swamp']);
const COLD_BIOMES = new Set(['tundra', 'arctic']);
const ROCK_BIOMES = new Set(['hills', 'mountains', 'volcanic']);

export function landscapeRecipe(tile) {
  const biome = tile.biome;
  const climate = tile.climate ?? {};
  const terrain = tile.layers?.[LAYERS.terrain] ?? {};
  const surface = tile.layers?.[LAYERS.surface] ?? {};
  const micro = tile.layers?.[LAYERS.microLayers] ?? {};
  const form = tile.layers?.[LAYERS.terrainForms] ?? {};
  const microKinds = new Set(micro.layers?.map(layer => layer.kind) ?? []);

  const water = WATER_BIOMES.has(biome);
  const dry = DRY_BIOMES.has(biome) || (climate.heat ?? 0) > 0.64;
  const forest = FOREST_BIOMES.has(biome);
  const cold = COLD_BIOMES.has(biome);
  const rocky = ROCK_BIOMES.has(biome) || form.terrainForm === 'hillside' || form.terrainForm === 'mountain_slope' || (climate.elevation ?? 0.5) > 0.62;
  const wet = water || biome === 'swamp' || surface.detail?.includes('mud') || surface.detail?.includes('water') || (climate.moisture ?? 0.5) > 0.72;

  const baseFamily = baseFamilyFor(tile, { water, dry, forest, cold, rocky, wet });
  const surfaceOverlays = surfaceOverlaysFor(tile, { water, wet, cold, dry });
  const microLayers = microLayersFor(microKinds, tile, { water, dry, forest, cold, rocky, wet });
  const medium = mediumDressingFor(tile, { water, dry, forest, cold, rocky, wet });

  const structure = {
    elevationMarks: !water && ['step', 'cliff', 'mountain_slope', 'mountain_peak'].includes(tile.terrainForm),
    valleyMarks: !water && (tile.terrainForm === 'valley' || tile.features?.includes('dry_riverbed')),
    soilRockMarks: !water && (microKinds.has('soil') || rocky || dry || (micro.vegetationDensity ?? 0) < 0.35)
  };
  return {
    biome,
    material: terrain.material ?? tile.material,
    surface: surface.detail,
    form: tile.terrainForm,
    plateau: form.plateauLevel ?? 0,
    base: {
      family: baseFamily,
      wang: true,
      opaque: true,
      maskBasis: 'material+surface+biome'
    },
    structure,
    surfaceOverlays,
    micro: microLayers,
    medium,
    // Compatibility controls for the current painter. These are derived from
    // the formal recipe so rendering stays coherent while assets are audited.
    geology: rocky ? { threshold: 0.93, roll: 0.64 } : null,
    groundAccent: microKinds.has('ground_cover') ? { threshold: water ? 0.96 : 0.91, roll: water ? 0.78 : 0.62 } : null,
    detailAccent: (microKinds.has('flowers') || microKinds.has('foliage_blades')) && (micro.fertility ?? 0.5) > 0.42 && (climate.moisture ?? 0.5) > 0.28 ? { threshold: dry ? 0.94 : 0.91, roll: dry ? 0.78 : 0.68 } : null,
    bush: !water && (micro.vegetationDensity ?? 0.5) > 0.45 && (dry || forest || biome === 'grassland') ? { threshold: dry ? 0.965 : 0.955, roll: dry ? 0.72 : 0.80 } : null,
    canopy: forest && (micro.vegetationDensity ?? 0.5) > 0.58 ? { roll: biome === 'swamp' ? 0.93 : 0.96 } : null,
    density: {
      fertility: micro.fertility ?? 0.5,
      vegetation: micro.vegetationDensity ?? 0.5,
      moisture: climate.moisture ?? 0.5,
      heat: climate.heat ?? 0.5
    }
  };
}

function baseFamilyFor(tile, flags) {
  const surface = tile.layers?.[LAYERS.surface]?.detail ?? '';
  const material = tile.layers?.[LAYERS.terrain]?.material ?? tile.material ?? '';
  if (flags.water) return `water/${tile.biome}`;
  if (tile.biome === 'swamp') {
    // QA foundation: use the available PixelLab wet-mud base for every swamp
    // tile. Non-mud swamp dressing should come back as alpha overlays/decals;
    // falling through to the procedural swamp_ground base creates green holes.
    return 'swamp/wet_mud';
  }
  if (tile.biome === 'beach') return surface.includes('wet') ? 'beach/wet_sand' : 'beach/dry_sand';
  if (flags.cold) return tile.biome === 'arctic' ? 'cold/snow_ice' : 'cold/tundra_ground';
  if (flags.rocky) return `rock/${tile.biome}`;
  if (flags.dry) return `dry/${tile.biome || material}`;
  if (flags.forest) return `forest/${tile.biome}`;
  return `ground/${tile.biome || material}`;
}

function surfaceOverlaysFor(tile, flags) {
  const detail = tile.layers?.[LAYERS.surface]?.detail ?? '';
  const overlays = [];
  if (detail.includes('mud_pool') || detail.includes('mud')) overlays.push('wet_mud_shine');
  if (detail.includes('water') || flags.water) overlays.push('water_surface');
  if (detail.includes('snow') || flags.cold) overlays.push('snow_drift');
  if (detail.includes('leaf')) overlays.push('leaf_litter');
  if (detail.includes('stone')) overlays.push('stone_scatter');
  if (flags.dry && !flags.water) overlays.push('dry_dust');
  return [...new Set(overlays)];
}

function microLayersFor(microKinds, tile, flags) {
  const layers = [];
  if (microKinds.has('soil')) layers.push({ kind: 'soil', density: flags.wet ? 0.45 : 0.35 });
  if (microKinds.has('ground_cover')) layers.push({ kind: flags.wet ? 'moss_ground_cover' : 'ground_cover', density: flags.dry ? 0.28 : 0.42 });
  if (microKinds.has('foliage_blades')) layers.push({ kind: flags.wet ? 'reeds_grass_blades' : flags.dry ? 'dry_grass_blades' : 'foliage_blades', density: flags.dry ? 0.32 : 0.48 });
  if (microKinds.has('flowers')) layers.push({ kind: flags.dry ? 'sparse_flowers' : 'flowers', density: flags.dry ? 0.12 : 0.25 });
  if (microKinds.has('debris')) layers.push({ kind: flags.forest ? 'leaf_debris' : 'debris', density: 0.25 });
  if (flags.water) layers.push({ kind: 'water_noise', density: 0.35 });
  return layers;
}

function mediumDressingFor(tile, flags) {
  const veg = tile.layers?.[LAYERS.microLayers]?.vegetationDensity ?? 0.5;
  const items = [];
  if (flags.water || tile.biome === 'swamp') {
    if (veg > 0.25) items.push({ kind: 'reeds', density: 0.22 });
    if (tile.biome === 'swamp' && veg > 0.35) items.push({ kind: 'root_cluster', density: 0.12 });
  }
  if (flags.dry && veg > 0.35) items.push({ kind: 'dry_shrub', density: 0.13 });
  if (flags.forest && veg > 0.50) items.push({ kind: 'underbrush', density: 0.18 });
  if (flags.rocky) items.push({ kind: 'rock_scatter', density: 0.10 });
  return items;
}
