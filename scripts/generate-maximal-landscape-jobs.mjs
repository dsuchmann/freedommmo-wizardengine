import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const SYSTEM_PROMPT = 'assets/sorceress/SYSTEM_ART_DIRECTION_PROMPT.md';
const biomes = ['deep_ocean', 'ocean', 'shallow_water', 'beach', 'river', 'lake', 'grassland', 'forest', 'dense_forest', 'tropical_forest', 'taiga', 'savanna', 'steppe', 'desert', 'swamp', 'tundra', 'arctic', 'hills', 'mountains', 'volcanic', 'mystic'];
const layerFamilies = {
  bedrock: ['bedrock_base', 'strata', 'stone_plate', 'cracks', 'boulder_embedded', 'scree', 'gravel', 'ore_vein'],
  soil: ['dry_dirt', 'damp_dirt', 'loam', 'clay_mud', 'cracked_mud', 'swamp_muck', 'peat', 'silt'],
  ground_cover: ['short_grass', 'tall_grass', 'lush_grass', 'dry_grass', 'moss', 'leaf_litter', 'reeds', 'lichen'],
  flowers_herbs: ['wildflowers', 'herbs', 'poison_flowers', 'desert_blooms', 'alpine_flowers', 'fae_flowers', 'mushrooms', 'ferns'],
  stones_debris: ['pebbles', 'stones', 'shells', 'driftwood', 'fallen_leaves', 'twigs', 'bones', 'insect_mounds'],
  shrubs_bushes_hedges: ['small_shrub', 'round_bush', 'bramble', 'berry_bush', 'thorn_bush', 'hedge_straight', 'hedge_corner', 'glow_shrub'],
  vines_roots: ['ground_vines', 'hanging_vines', 'tree_vines', 'cliff_vines', 'root_tendrils', 'thorn_creepers', 'ivy_wall', 'mystic_vines'],
  trees_trunks_branches: ['sapling', 'broadleaf_tree', 'ancient_tree', 'dead_tree', 'fallen_log', 'conifer', 'tropical_tree', 'mystic_tree'],
  canopy: ['canopy_patch', 'canopy_edge', 'canopy_hole', 'dense_canopy', 'jungle_canopy', 'snow_canopy', 'mystic_canopy', 'overhanging_branches'],
  insects_small_life: ['fireflies', 'butterflies', 'bees', 'dragonflies', 'ants', 'beetles', 'crickets', 'mystic_sprites'],
  terrain_forms: ['low_slope', 'high_slope', 'cliff_face', 'cliff_top', 'cliff_bottom', 'overhang_underside', 'cave_mouth', 'natural_bridge'],
  water_wetlands_shoreline: ['water_surface', 'river_flow', 'lake_water', 'swamp_water', 'puddles', 'shore_foam', 'waterfall', 'ice_sheet'],
  desert_dunes_drylands: ['sand_base', 'ripple_sand', 'dune_crest', 'dune_shadow', 'dune_slipface', 'cracked_pan', 'mirage', 'wind_dust'],
  mountains_cliffs_overhangs: ['cliff_wall', 'cliff_cap', 'ledge', 'overhang_shadow', 'ridge_rocks', 'snowline', 'handholds', 'ravine_wall']
};
const states = ['default', 'wet', 'waterlogged', 'frozen', 'burning', 'burnt', 'enchanted', 'trampled'];
const jobs = [];

for (const biome of biomes) {
  for (const [layer, families] of Object.entries(layerFamilies)) {
    addJob(`landscape/${biome}/${layer}.json`, {
      output: `assets/generated/landscape/${biome}/${layer}.png`,
      kind: 'create_tiles_pro',
      cellSize: [32, 32], columns: 8, rows: families.length,
      rowsDescription: families,
      prompt: `Generate ${layer} landscape assets for ${biome}. Rows: ${families.join(', ')}. Each row has 8 variants/animation frames. Organic rich fantasy pixel art, transparent for overlays, seamless when terrain, strong readable silhouettes.`
    });
  }
  for (const state of states) {
    addJob(`landscape-states/${biome}/${state}_overlays.json`, {
      output: `assets/generated/landscape-states/${biome}/${state}_overlays.png`,
      kind: 'create_state_overlays', cellSize: [32, 32], columns: 8, rows: Object.keys(layerFamilies).length,
      rowsDescription: Object.keys(layerFamilies),
      prompt: `Generate transparent ${state} state overlays for every landscape layer in ${biome}. 8 frames/variants per row. Must stack cleanly over base assets.`
    });
  }
}

writeFileSync('assets/sorceress/maximal-landscape-job-index.json', JSON.stringify({ schema: 'freedommmo.maximal-landscape-jobs.v1', count: jobs.length, jobs }, null, 2));
console.log(`Wrote ${jobs.length} maximal landscape jobs`);

function addJob(path, job) {
  const full = `assets/sorceress/jobs/${path}`;
  mkdirSync(dirname(full), { recursive: true });
  const content = { tool: 'sorceress', systemPrompt: SYSTEM_PROMPT, style: 'Follow the canonical Sorceress system art direction prompt exactly: lush, beautiful, complex, unique, variant, dynamic, modern, seamless, maximalist real-landscape-influenced fantasy pixel art.', ...job };
  writeFileSync(full, JSON.stringify(content, null, 2));
  jobs.push(full);
}
