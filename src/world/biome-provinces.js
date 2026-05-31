import { SPEC_BIOME_IDS } from './biome-definitions.js';

const PROVINCE_RADIUS = Object.freeze({
  deep_ocean: 22, ocean: 26, shallow_water: 18, beach: 14, river: 8, lake: 10,
  grassland: 26, forest: 22, dense_forest: 16, tropical_forest: 14, taiga: 18,
  savanna: 16, steppe: 16, desert: 14, swamp: 12, tundra: 18, arctic: 12,
  hills: 20, mountains: 16, volcanic: 10, mystic: 10
});

export function provinceBiomeAt(cx, cy) {
  let best = null;
  for (let i = 0; i < SPEC_BIOME_IDS.length; i++) {
    const id = SPEC_BIOME_IDS[i];
    const center = provinceCenter(i);
    const radius = PROVINCE_RADIUS[id] ?? 14;
    const dx = cx - center.x;
    const dy = cy - center.y;
    const d = Math.hypot(dx, dy);
    if (d <= radius && (!best || d / radius < best.score)) best = { id, score: d / radius, center, radius };
  }
  return best;
}

export function provinceCenter(index) {
  const ring = 220;
  const angle = index * 2.399963229728653;
  const radius = 36 + Math.sqrt(index + 1) * ring * 0.23;
  return {
    x: Math.round(Math.cos(angle) * radius + seededOffset(index, 0) * 24),
    y: Math.round(Math.sin(angle) * radius + seededOffset(index, 1) * 24)
  };
}

function seededOffset(index, salt) {
  const n = Math.sin((index + 1) * 127.1 + salt * 311.7) * 43758.5453;
  return (n - Math.floor(n)) * 2 - 1;
}
