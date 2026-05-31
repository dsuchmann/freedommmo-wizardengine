const BIOMES = ['grassland', 'forest', 'dense_forest', 'tropical_forest', 'taiga', 'savanna', 'steppe', 'desert', 'swamp', 'tundra', 'arctic', 'hills', 'mountains', 'volcanic', 'mystic', 'beach', 'river', 'lake', 'shallow_water', 'ocean', 'deep_ocean'];
const FAMILIES = ['trees', 'shrubs', 'flowers', 'ground_cover', 'stones', 'vines', 'canopy', 'insects'];
const VARIANTS_PER_FAMILY = 256;
const VARIANTS_PER_SHEET = 64;

export const biomeVariantAtlasDefs = Object.freeze(BIOMES.flatMap(biome =>
  FAMILIES.flatMap(family =>
    Array.from({ length: VARIANTS_PER_FAMILY / VARIANTS_PER_SHEET }, (_, sheetIndex) => {
      const start = sheetIndex * VARIANTS_PER_SHEET;
      const end = start + VARIANTS_PER_SHEET - 1;
      const cell = family === 'trees' || family === 'canopy' ? 64 : 32;
      const height = family === 'trees' || family === 'canopy' ? 96 : 32;
      return {
        id: `${biome}_${family}_${pad(start)}_${pad(end)}`,
        src: `assets/generated/variants/${biome}/${family}_${pad(start)}_${pad(end)}.png`,
        cell,
        frames: 8,
        rows: Array.from({ length: 8 }, (_, row) => ({ id: `${biome}_${family}_variant_${start + row * 8}`, row, frames: 8, cell, height }))
      };
    })
  )
));

function pad(value) {
  return String(value).padStart(3, '0');
}
