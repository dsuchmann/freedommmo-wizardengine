export const BIOME_ELEMENTS = Object.freeze({
  deep_ocean: ['water', 'pressure', 'salt'],
  ocean: ['water', 'salt', 'wind'],
  shallow_water: ['water', 'sun', 'silt'],
  river: ['water', 'flow', 'silt'],
  lake: ['water', 'stillness', 'silt'],
  beach: ['sand', 'salt', 'sun'],
  grassland: ['life', 'wind', 'sun'],
  forest: ['wood', 'life', 'shade'],
  dense_forest: ['wood', 'life', 'shadow'],
  tropical_forest: ['wood', 'life', 'humidity'],
  taiga: ['wood', 'cold', 'resin'],
  savanna: ['dry_grass', 'sun', 'fire'],
  steppe: ['dry_grass', 'wind', 'dust'],
  desert: ['sand', 'sun', 'heat'],
  swamp: ['water', 'rot', 'poison'],
  tundra: ['cold', 'lichen', 'wind'],
  arctic: ['ice', 'cold', 'snow'],
  hills: ['stone', 'wind', 'life'],
  mountains: ['stone', 'cold', 'ore'],
  volcanic: ['fire', 'ash', 'stone'],
  mystic: ['mystic', 'aether', 'dream']
});

export const MATERIAL_REACTIONS = Object.freeze({
  wood: {
    fire: 'burning', water: 'waterlogged', ice: 'frozen', cold: 'frosted', mystic: 'enchanted', rot: 'rotting', ash: 'charred'
  },
  leaf: {
    fire: 'scorched', water: 'dripping', ice: 'frozen', cold: 'frosted', mystic: 'glowing', rot: 'mildewed', ash: 'ash_dusted'
  },
  stone: {
    fire: 'heat_cracked', water: 'slick', ice: 'iced', cold: 'frosted', mystic: 'rune_etched', ash: 'ash_dusted', ore: 'ore_exposed'
  },
  water: {
    fire: 'steaming', ice: 'frozen', cold: 'thin_ice', mystic: 'shimmering', poison: 'tainted', ash: 'clouded'
  },
  grass: {
    fire: 'burnt', water: 'lush', ice: 'frozen', cold: 'frosted', mystic: 'fae_bloom', rot: 'mildewed', dust: 'dusty'
  },
  sand: {
    fire: 'glass_scorched', water: 'wet', ice: 'crusted', mystic: 'star_sand', ash: 'ash_mixed'
  }
});

export function elementsForBiome(biome) {
  return BIOME_ELEMENTS[biome] ?? ['life'];
}

export function reactionStatesForMaterial(material, sourceBiome, targetBiome = sourceBiome) {
  const source = elementsForBiome(sourceBiome);
  const target = elementsForBiome(targetBiome);
  const elements = [...new Set([...source, ...target])];
  const table = MATERIAL_REACTIONS[material] ?? MATERIAL_REACTIONS.grass;
  return [...new Set(elements.map(element => table[element]).filter(Boolean))];
}
