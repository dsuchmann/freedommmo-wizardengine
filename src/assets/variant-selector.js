import { rand2 } from '../core/random.js';

const FAMILY_BY_OBJECT = Object.freeze({
  tree: 'trees',
  broadleaf_tree: 'trees',
  mystic_tree: 'trees',
  rock: 'stones',
  boulder: 'stones',
  crystal: 'stones',
  shrub: 'shrubs',
  bush: 'shrubs',
  flower: 'flowers',
  vines: 'vines'
});

export function biomeVariantFrameId(biome, objectKind, wx, wy) {
  const family = familyForObject(objectKind);
  if (!family) return null;
  const variant = Math.floor(rand2(wx, wy, 9301) * 256);
  const rowStart = Math.floor(variant / 8) * 8;
  return { id: `${biome}_${family}_variant_${rowStart}`, frame: variant % 8, family, variant };
}

function familyForObject(kind) {
  const lower = String(kind).toLowerCase();
  for (const [needle, family] of Object.entries(FAMILY_BY_OBJECT)) {
    if (lower.includes(needle)) return family;
  }
  return null;
}
