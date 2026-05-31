import { rand2 } from '../core/random.js';
import { elementsForBiome, reactionStatesForMaterial } from './biome-elements.js';

export function createMicroLayers(tile) {
  const fertility = fertilityFor(tile);
  const moisture = tile.climate.moisture;
  const slope = tile.layers?.[7]?.slope ?? 0;
  const density = vegetationDensity(tile.biome, fertility, moisture, slope);
  const windPhase = rand2(tile.wx, tile.wy, 2001);
  const layers = [];

  if (isWater(tile.biome)) {
    layers.push(layer('water_body', waterMaterial(tile.biome), 1, { physics: { fluid: true, swimmable: false }, animation: { clip: 'water_flow', frames: 8, fps: 5, phase: windPhase, amplitude: 0.4 }, reactions: reactionStatesForMaterial('water', tile.biome), blend: 'normal' }));
    return { kind: 'microLayers', fertility, vegetationDensity: 0, layers };
  }

  layers.push(layer('soil', soilMaterial(tile.biome), 1, { physics: { softness: 0.5 + moisture * 0.4, absorbsWater: true }, reactions: reactionStatesForMaterial(soilReactionMaterial(tile.biome), tile.biome) }));
  layers.push(layer('ground_cover', groundCover(tile.biome), density, { physics: { crushable: true, footstep: 'rustle' }, animation: windAnim(windPhase, 0.25 + density * 0.4), reactions: reactionStatesForMaterial('grass', tile.biome) }));

  if (density > 0.28) layers.push(layer('foliage_blades', foliageKind(tile.biome), density, { physics: { bends: true, blocksMovement: false }, animation: windAnim(windPhase + 0.17, 0.5 + density), reactions: reactionStatesForMaterial('leaf', tile.biome) }));
  if (flowerChance(tile) > 0.72) layers.push(layer('flowers', flowerKind(tile.biome), rand2(tile.wx, tile.wy, 2102), { physics: { crushable: true }, animation: windAnim(windPhase + 0.31, 0.35), reactions: reactionStatesForMaterial('leaf', tile.biome) }));
  if (debrisChance(tile) > 0.70) layers.push(layer('debris', debrisKind(tile.biome), rand2(tile.wx, tile.wy, 2103), { physics: { kickable: true }, animation: null, reactions: reactionStatesForMaterial(debrisMaterial(tile.biome), tile.biome) }));
  if (elementsForBiome(tile.biome).includes('mystic')) layers.push(layer('aether_motes', 'glow_motes', 0.8, { physics: { intangible: true }, animation: { clip: 'pulse', frames: 12, fps: 6, phase: windPhase }, blend: 'screen', reactions: ['enchanted'] }));

  return { kind: 'microLayers', fertility, vegetationDensity: density, layers };
}

function layer(kind, material, coverage, extra) {
  return { kind, material, coverage: clamp01(coverage), ...extra };
}

function isWater(biome) {
  return biome.includes('ocean') || biome === 'shallow_water' || biome === 'river' || biome === 'lake';
}

function waterMaterial(biome) {
  if (biome === 'river') return 'flowing_water';
  if (biome === 'lake') return 'still_water';
  if (biome === 'deep_ocean') return 'deep_water';
  return 'water_surface';
}

function fertilityFor(tile) {
  let f = tile.climate.moisture * 0.55 + (1 - Math.abs(tile.climate.heat - 0.5) * 2) * 0.25 + (1 - tile.climate.elevation) * 0.20;
  if (tile.features?.includes('dry_riverbed')) f += 0.12;
  if (tile.terrainForm === 'valley') f += 0.10;
  if (tile.terrainForm === 'cliff' || tile.terrainForm === 'mountain_peak') f -= 0.35;
  if (tile.biome === 'desert' || tile.biome === 'beach') f -= 0.25;
  if (tile.biome === 'swamp' || tile.biome === 'tropical_forest') f += 0.18;
  return clamp01(f);
}

function vegetationDensity(biome, fertility, moisture, slope) {
  if (biome.includes('ocean') || biome === 'river' || biome === 'lake') return 0;
  if (biome === 'desert' || biome === 'beach' || biome === 'volcanic') return clamp01(fertility * 0.22);
  if (biome === 'tundra' || biome === 'arctic' || biome === 'mountains') return clamp01(fertility * 0.35);
  if (biome === 'forest' || biome === 'dense_forest' || biome === 'tropical_forest' || biome === 'swamp') return clamp01(fertility * 1.2 - slope * 2);
  return clamp01(fertility * (0.8 + moisture * 0.5) - slope * 1.2);
}

function soilMaterial(biome) {
  if (biome === 'beach' || biome === 'desert') return 'sand';
  if (biome === 'tundra' || biome === 'arctic') return 'frozen_soil';
  if (biome === 'mountains' || biome === 'hills' || biome === 'volcanic') return 'rocky_soil';
  if (biome === 'swamp') return 'peat_mud';
  if (biome === 'mystic') return 'aether_loam';
  return 'loam';
}

function soilReactionMaterial(biome) {
  if (biome === 'beach' || biome === 'desert') return 'sand';
  if (biome.includes('ocean') || biome === 'river' || biome === 'lake') return 'water';
  if (biome === 'mountains' || biome === 'hills' || biome === 'volcanic') return 'stone';
  return 'grass';
}

function groundCover(biome) {
  if (biome === 'forest' || biome === 'dense_forest' || biome === 'taiga' || biome === 'tropical_forest') return 'leaf_litter';
  if (biome === 'grassland' || biome === 'savanna' || biome === 'steppe') return 'grass_mat';
  if (biome === 'tundra' || biome === 'arctic') return 'lichen_snow';
  if (biome === 'mystic') return 'aether_grass';
  if (biome === 'swamp') return 'moss_reeds';
  return 'surface_grain';
}

function foliageKind(biome) {
  if (biome === 'swamp') return 'reeds';
  if (biome === 'tundra' || biome === 'arctic') return 'low_lichen';
  if (biome === 'mystic') return 'glow_grass';
  return 'grass_blades';
}

function flowerKind(biome) {
  if (biome === 'mystic') return 'aether_flower';
  if (biome === 'tundra' || biome === 'arctic') return 'tiny_alpine_bloom';
  return 'wildflower';
}

function debrisKind(biome) {
  if (biome === 'forest' || biome === 'dense_forest' || biome === 'taiga') return 'twigs_leaves';
  if (biome === 'mountains' || biome === 'hills' || biome === 'volcanic') return 'pebbles';
  if (biome === 'beach') return 'shells';
  return 'seed_heads';
}

function debrisMaterial(biome) {
  if (biome === 'mountains' || biome === 'hills' || biome === 'volcanic') return 'stone';
  return 'wood';
}

function flowerChance(tile) {
  return rand2(tile.wx, tile.wy, 2200) * (0.35 + fertilityFor(tile));
}

function debrisChance(tile) {
  return rand2(tile.wx, tile.wy, 2300) * (0.45 + tile.climate.moisture * 0.4);
}

function windAnim(phase, amplitude) {
  return { clip: 'wind_sway', frames: 8, fps: 4, phase, amplitude };
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}
