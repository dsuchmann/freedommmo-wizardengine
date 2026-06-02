import { landscapeArtInventory } from './landscape-art-inventory.js';
import { pixelLabCatalogIndex } from './pixellab-catalog-index.js';

const MAX_PER_CATEGORY = 256;
const CATEGORY_ALIASES = Object.freeze({ bush: 'shrub', shrub: 'shrub', dirt: 'path', moss: 'leaves', fern: 'leaves' });
const combinedLandscapeArtInventory = Object.freeze(Object.fromEntries(
  [...new Set([...Object.keys(landscapeArtInventory), ...Object.keys(pixelLabCatalogIndex)])]
    .map(category => [category, [...(pixelLabCatalogIndex[category] ?? []), ...(landscapeArtInventory[category] ?? [])]])
));

export const landscapeArtDefs = Object.freeze(Object.entries(combinedLandscapeArtInventory).flatMap(([category, entries]) =>
  entries.slice(0, MAX_PER_CATEGORY).map((entry, index) => ({
    id: `landscape_${category}_${index}`,
    src: entry.path,
    fullImage: true,
    rows: [{ id: `landscape_${category}_${index}`, fullImage: true, frames: 1 }]
  }))
));

export function landscapeArtId(category, biome, salt = 0) {
  category = CATEGORY_ALIASES[category] ?? category;
  const entries = combinedLandscapeArtInventory[category] ?? [];
  const candidates = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry, index }) => index < MAX_PER_CATEGORY && (entry.biomes.includes(biome) || entry.biomes.includes('any')));
  const pool = candidates.length ? candidates : entries.slice(0, MAX_PER_CATEGORY).map((entry, index) => ({ entry, index }));
  if (!pool.length) return null;
  const pick = pool[Math.abs(Math.floor(salt)) % pool.length];
  return `landscape_${category}_${pick.index}`;
}
