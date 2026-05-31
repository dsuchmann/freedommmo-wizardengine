import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const biomes = ['deep_ocean', 'ocean', 'shallow_water', 'beach', 'river', 'lake', 'grassland', 'forest', 'dense_forest', 'tropical_forest', 'taiga', 'savanna', 'steppe', 'desert', 'swamp', 'tundra', 'arctic', 'hills', 'mountains', 'volcanic', 'mystic'];
const materials = ['wood', 'leaf', 'stone', 'water', 'grass', 'sand'];
const elements = ['fire', 'water', 'ice', 'cold', 'mystic', 'rot', 'ash', 'poison', 'salt', 'wind', 'sun', 'ore'];
const directions = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'];

const jobs = [];

for (const biome of biomes) {
  addJob(`terrain/base/${biome}_base_tiles.json`, {
    output: `assets/generated/terrain/base/${biome}_base_tiles.png`,
    kind: 'create_tiles_pro',
    cellSize: [32, 32], columns: 8, rows: 8,
    prompt: `Generate 64 seamless 32x32 base terrain tiles for ${biome}. Rich top-down fantasy pixel art, organic non-square detail, more beautiful than CrossCode/Zelda/Octopath, transparent only where appropriate, no UI/text/watermark.`
  });
  addJob(`terrain/micro/${biome}_micro_layers.json`, {
    output: `assets/generated/terrain/micro/${biome}_micro_layers.png`,
    kind: 'create_tiles_pro', cellSize: [32, 32], columns: 8, rows: 8,
    rowsDescription: ['soil', 'ground_cover', 'foliage_blades', 'flowers', 'debris', 'wet_overlay', 'snow_or_heat_overlay', 'biome_magic_or_special'],
    prompt: `Generate layered transparent micro-detail overlays for ${biome}: soil, ground cover, animated foliage, flowers, debris, and biome-special details. 8 rows x 8 frames/variants.`
  });
  addJob(`objects/nature/${biome}_nature_objects.json`, {
    output: `assets/generated/objects/nature/${biome}_nature_objects.png`,
    kind: 'create_map_object', cellSize: [32, 32], columns: 8, rows: 8,
    rowsDescription: ['tree_or_large_plant', 'shrub', 'grass_cluster', 'rock', 'log_or_debris', 'flower_cluster', 'rare_resource', 'biome_special'],
    prompt: `Generate biome-appropriate nature objects for ${biome}. Each row is 8 animation/variant frames. Transparent background, organic silhouettes, root anchors at bottom center.`
  });
  addJob(`buildings/materials/${biome}_building_materials.json`, {
    output: `assets/generated/buildings/materials/${biome}_building_materials.png`,
    kind: 'create_tiles_pro', cellSize: [32, 32], columns: 8, rows: 8,
    rowsDescription: ['wall_stone', 'wall_wood', 'wall_thatch_or_local', 'floor_wood', 'floor_stone', 'roof_local', 'trim', 'damage_overlay'],
    prompt: `Generate biome-local building wall/floor/roof material tiles for ${biome}. 32x32, coherent fantasy settlement style, seamless where needed.`
  });
}

for (const material of materials) {
  addJob(`states/materials/${material}_element_reactions.json`, {
    output: `assets/generated/states/materials/${material}_element_reactions.png`,
    kind: 'create_state_overlays', cellSize: [32, 32], columns: 8, rows: elements.length,
    rowsDescription: elements,
    prompt: `Generate transparent state overlays for ${material} reacting to elements: ${elements.join(', ')}. Each row has 8 frames/variants. Include burning, waterlogged, frozen, enchanted, rotting, ash-dusted, tainted, salted, windblown, sunbaked, ore-infused as appropriate.`
  });
}

addJob('characters/humanoid_base_directional.json', {
  output: 'assets/generated/characters/humanoid_base_directional.png',
  kind: 'create_character', cellSize: [32, 48], columns: 8, rows: directions.length * 6,
  directions,
  animations: ['idle', 'walk', 'run', 'attack', 'cast', 'hurt'],
  prompt: 'Generate layered humanoid base character animation sheet. 8 directions, idle/walk/run/attack/cast/hurt, transparent background, high-fantasy pixel art, equipment overlay compatible.'
});

addJob('effects/elemental_effects_directional.json', {
  output: 'assets/generated/effects/elemental_effects_directional.png',
  kind: 'create_effects', cellSize: [32, 32], columns: 8, rows: elements.length,
  rowsDescription: elements,
  prompt: `Generate elemental effect animation rows for ${elements.join(', ')}. 8 frames per effect, transparent background, readable top-down RPG effects.`
});

writeFileSync('assets/sorceress/job-index.json', JSON.stringify({ schema: 'freedommmo.sorceress-job-index.v1', count: jobs.length, jobs }, null, 2));
console.log(`Wrote ${jobs.length} Sorceress jobs`);

function addJob(path, job) {
  const full = `assets/sorceress/jobs/${path}`;
  mkdirSync(dirname(full), { recursive: true });
  const content = { tool: 'sorceress', style: 'More beautiful than CrossCode, Zelda, and Octopath Traveler; highly opinionated robust elaborate fantasy pixel art; organic, layered, readable top-down three-quarter RPG; no UI, no text, no watermark.', ...job };
  writeFileSync(full, JSON.stringify(content, null, 2));
  jobs.push(full);
}
