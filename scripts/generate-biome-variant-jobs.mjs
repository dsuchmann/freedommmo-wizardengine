import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const SYSTEM_PROMPT = 'assets/sorceress/SYSTEM_ART_DIRECTION_PROMPT.md';
const biomes = ['grassland', 'forest', 'dense_forest', 'tropical_forest', 'taiga', 'savanna', 'steppe', 'desert', 'swamp', 'tundra', 'arctic', 'hills', 'mountains', 'volcanic', 'mystic', 'beach', 'river', 'lake', 'shallow_water', 'ocean', 'deep_ocean'];
const families = ['trees', 'shrubs', 'flowers', 'ground_cover', 'stones', 'vines', 'canopy', 'insects'];
const variantsPerFamily = 256;
const variantsPerSheet = 64;
const jobs = [];

for (const biome of biomes) {
  for (const family of families) {
    for (let start = 0; start < variantsPerFamily; start += variantsPerSheet) {
      const end = start + variantsPerSheet - 1;
      addJob(`variants/${biome}/${family}_${pad(start)}_${pad(end)}.json`, {
        output: `assets/generated/variants/${biome}/${family}_${pad(start)}_${pad(end)}.png`,
        kind: 'create_map_object_variant_sheet',
        cellSize: family === 'trees' || family === 'canopy' ? [64, 96] : [32, 32],
        columns: 8,
        rows: 8,
        biome,
        family,
        variantRange: [start, end],
        prompt: variantPrompt(biome, family, start, end)
      });
    }
  }
}

writeFileSync('assets/sorceress/biome-variant-job-index.json', JSON.stringify({ schema: 'freedommmo.biome-variant-jobs.v1', variantsPerFamily, variantsPerBiome: variantsPerFamily * families.length, totalVariantTargets: biomes.length * families.length * variantsPerFamily, count: jobs.length, jobs }, null, 2));
console.log(`Wrote ${jobs.length} biome variant jobs for ${biomes.length * families.length * variantsPerFamily} variant targets`);

function variantPrompt(biome, family, start, end) {
  return `Generate ${end - start + 1} biome-unique ${family} variants for ${biome}, variants ${start}-${end}. These must not be generic shared assets. Every silhouette, palette accent, ornament, micro-detail, growth pattern, and magical/ecological identity must be specific to ${biome}. Target extremely high fantasy, lush, complicated, intricate, high-resolution pixel art compressed into the requested cells. Use organic asymmetry, dense detail clusters, natural imperfection, and strong gameplay readability. If ${biome} is mystic, include aether glow, impossible botany, rune-like growth scars, luminous pollen/motes, crystalline bark/leaf accents, and fae ecology. If ${biome} is forest, include rich moss, layered bark, fungi, leaf clusters, root complexity, animal/insect micro-life, seasonal variants, and deep woodland identity. Transparent background. No UI, text, watermark, square debug marks, or generic asset-pack look.`;
}

function addJob(path, job) {
  const full = `assets/sorceress/jobs/${path}`;
  mkdirSync(dirname(full), { recursive: true });
  const content = { tool: 'sorceress', systemPrompt: SYSTEM_PROMPT, style: 'Extreme high-variance biome-unique fantasy pixel art. Hundreds of variants per family per biome. Lush, intricate, high-resolution feel, modern, seamless, gameplay readable.', ...job };
  writeFileSync(full, JSON.stringify(content, null, 2));
  jobs.push(full);
}

function pad(value) {
  return String(value).padStart(3, '0');
}
