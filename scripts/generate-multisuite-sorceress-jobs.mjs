import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const SYSTEM_PROMPT = 'assets/sorceress/SYSTEM_ART_DIRECTION_PROMPT.md';
const biomes = ['grassland', 'forest', 'dense_forest', 'tropical_forest', 'taiga', 'savanna', 'steppe', 'desert', 'swamp', 'tundra', 'arctic', 'hills', 'mountains', 'volcanic', 'mystic', 'beach', 'river', 'lake', 'shallow_water', 'ocean', 'deep_ocean'];
const jobs = [];

for (const biome of biomes) {
  add('environment_gen', `environment/${biome}_scene_reference.json`, `assets/generated/environment/${biome}_scene_reference.png`, `Generate a lush maximal biome scene reference for ${biome}: terrain layers, canopy, elevation, object density, lighting, atmosphere, and interaction affordances.`);
  add('tileset_forge', `tilesets/${biome}_autotile_wang.json`, `assets/generated/tilesets/${biome}_autotile_wang.png`, `Generate seamless autotile/wang terrain set for ${biome}, including inner tiles, edges, corners, diagonals, transition masks, and high-variance detail variants.`);
  add('material_forge', `materials/${biome}_landscape_materials.json`, `assets/generated/materials/${biome}_landscape_materials.png`, `Generate pixel material sheets for ${biome}: soil, mud, stone, foliage, water/snow/sand special surfaces, plus normal/depth/roughness style companion channels if supported.`);
  add('audio_suite', `audio/${biome}_ambience.json`, `assets/generated/audio/${biome}_ambience.ogg`, `Generate looping biome ambience for ${biome}: insects/air/water/trees/geology/mystic accents as appropriate. Seamless loop.`);
  add('voxel_studio', `voxel/${biome}_prop_blockouts.json`, `assets/generated/voxel/${biome}_prop_blockouts.vox`, `Generate voxel blockout references for ${biome} trees, rocks, shrubs, cliffs, and interactable resource nodes.`);
  add('three_d_procedural_work', `procedural3d/${biome}_generators.json`, `assets/generated/procedural3d/${biome}_generators.json`, `Generate procedural grammar parameters for ${biome} trees, rocks, cliffs, shrubs, hedges, dunes, overhangs, and canopy scatter.`);
}

add('sprite_suite', 'characters/modular_humanoid_parts.json', 'assets/generated/characters/modular_humanoid_parts.png', 'Generate modular humanoid body-part sprite sheets: legs, hips, torso, shoulders, arms, hands, neck, head, face, hair, clothing layers, equipment, 8 directions, idle/walk/sprint/jump/glide/roll/climb/attack/cast/hurt.');
add('sprite_suite', 'effects/interaction_reactions.json', 'assets/generated/effects/interaction_reactions.png', 'Generate effect sprites for grass bend, bush rustle, flower shake, water splash, mud squelch, sand puff, snow puff, insect scatter, leaf fall, canopy shake, climb dust, landing impact.');
add('video_suite', 'motion_reference/player_locomotion.json', 'assets/generated/video/player_locomotion_reference.mp4', 'Generate motion reference clips for modular player locomotion: sprint, standing jump, running jump, glide, dodge roll, climb, land, interact.');

writeFileSync('assets/sorceress/multisuite-job-index.json', JSON.stringify({ schema: 'freedommmo.multisuite-sorceress-jobs.v1', count: jobs.length, jobs }, null, 2));
console.log(`Wrote ${jobs.length} multisuite Sorceress jobs`);

function add(suite, path, output, prompt) {
  const full = `assets/sorceress/jobs/multisuite/${path}`;
  mkdirSync(dirname(full), { recursive: true });
  const job = { tool: 'sorceress', suite, systemPrompt: SYSTEM_PROMPT, output, prompt, style: 'Canonical maximalist lush high-fantasy art direction. Outputs must be production-oriented, coherent with manifests, and immediately importable by runtime or pipeline.' };
  writeFileSync(full, JSON.stringify(job, null, 2));
  jobs.push(full);
}
