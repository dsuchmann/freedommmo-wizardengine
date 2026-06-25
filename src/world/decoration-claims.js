// src/world/decoration-claims.js
// Single source of truth for Field 3+ decoration placement and the
// cross-field claim masks that stop lower fields (F2 flora) from spawning
// inside higher-field objects' base footprints. Pure + deterministic:
// worker and main thread compute identical results independently.
import { rand2, pickIndex } from '../core/random.js';
import { MF_CATALOG } from './mf-catalog.js';
import { MO_CATALOG } from './mo-catalog.js';
import { LG_CATALOG } from './lg-catalog.js';
import { tuneSize, tuneBiomeDensity, tuneObjDensity, tuneStateWeights, rollWeighted,
  F4_STATE_ORDER, F4_STATE_DEFAULTS, F5_STATE_ORDER, f5StateDefaults,
  F6_STATE_ORDER, F6_STATE_DEFAULTS, maxSizeMul } from './field-tuning.js';

var MF_BASE_PATH = '/assets/pixelab/landscape_v2/micro/medium_flora/';
// Per-tile chance of one medium-flora plant (master plan: 3-12% density)
var F4_TILE_CHANCE = {
  grassland: 0.10, forest: 0.12, dense_forest: 0.12, tropical_forest: 0.12,
  taiga: 0.09, swamp: 0.09, mystic: 0.10, savanna: 0.07, hills: 0.07,
  steppe: 0.06, beach: 0.05, tundra: 0.05, desert: 0.04, arctic: 0.03,
  mountains: 0.04, volcanic: 0.04,
};
var _f4Cache = new Map();   // 'wx,wy,biome' -> placements

// Runtime-tunable F4 size multiplier per biome — applied to BOTH the sprite
// draw size and the claim footprint. Tuned live via the unified field tuner
// panel (backtick key, src/dev/field-tuner.js). 1.0 = native sprite size
// (64px = 2 tiles). Hand-tuned in-game — final values 2026-06-11
export var F4_BIOME_SCALE = {
  grassland: 0.35, forest: 0.4, dense_forest: 0.4, tropical_forest: 0.65,
  taiga: 0.4, swamp: 0.35, mystic: 0.55, savanna: 0.4, hills: 0.5,
  steppe: 0.6, beach: 0.5, tundra: 0.55, desert: 0.45, arctic: 0.65,
  mountains: 0.5, volcanic: 0.5,
};

var MO_BASE_PATH = '/assets/pixelab/landscape_v2/micro/medium_objects/';
// Per-tile chance of one medium object — rarer than F4 (spec: ~1-3%)
var F5_TILE_CHANCE = {
  grassland: 0.020, forest: 0.025, dense_forest: 0.025, tropical_forest: 0.022,
  taiga: 0.020, swamp: 0.022, mystic: 0.030, savanna: 0.018, hills: 0.025,
  steppe: 0.015, beach: 0.012, tundra: 0.012, desert: 0.010, arctic: 0.010,
  mountains: 0.028, volcanic: 0.022,
};
var _f5Cache = new Map();     // 'wx,wy,res' -> resolved (post-exclusion) placements
var _f5CandCache = new Map(); // 'wx,wy,biome' -> candidate placements (no neighbor knowledge)
// Epoch counter: bumped every time a query returns a provisional result (one
// that could change when more tiles load). Consumers snapshot this before
// computing derived results; if it changed they skip caching — preventing
// stale EMPTY or false-survivor entries from surviving a tile-load event.
var _provisionalEpoch = 0;
// Live-tunable per-biome F5 scale (96px native = 3 tiles at 1.0). The user
// calibrates in-game; bake final values here afterwards (F4 precedent).
export var F5_BIOME_SCALE = {
  grassland: 1.0, forest: 1.0, dense_forest: 1.0, tropical_forest: 1.0,
  taiga: 1.0, swamp: 1.0, mystic: 1.0, savanna: 1.0, hills: 1.0,
  steppe: 1.0, beach: 1.0, tundra: 1.0, desert: 1.0, arctic: 1.0,
  mountains: 1.0, volcanic: 1.0,
};

var LG_BASE_PATH = '/assets/pixelab/landscape_v2/micro/large_flora/';
// Per-tile chance of one tree — F6 is the rarest field (192px sprites).
var F6_TILE_CHANCE = {
  grassland: 0.006, forest: 0.030, dense_forest: 0.050, tropical_forest: 0.035,
  taiga: 0.025, swamp: 0.018, mystic: 0.020, savanna: 0.008, hills: 0.010,
  steppe: 0.004, beach: 0.003, tundra: 0.003, desert: 0.002, arctic: 0.001,
  mountains: 0.008, volcanic: 0.004,
};
var _f6Cache = new Map();   // 'wx,wy,biome' -> placements
// Live-tunable per-biome F6 scale (192px native = 6 tiles at 1.0). The user
// calibrates in-game; bake final values here afterwards (F4/F5 precedent).
export var F6_BIOME_SCALE = {
  grassland: 1.0, forest: 1.0, dense_forest: 1.0, tropical_forest: 1.0,
  taiga: 1.0, swamp: 1.0, mystic: 1.0, savanna: 1.0, hills: 1.0,
  steppe: 1.0, beach: 1.0, tundra: 1.0, desert: 1.0, arctic: 1.0,
  mountains: 1.0, volcanic: 1.0,
};

export var SS_BASE_PATH = '/assets/pixelab/landscape_v2/micro/small_scatter/';
export var SS_VARIANT_COUNT = 64;

// MOVED VERBATIM from worker-chunk-renderer.js lines ~881-1035 — do not edit entries.
export var SS_BIOME_OBJECTS = {
  arctic: [
    { name: 'blue_ice_crystal_scatter', sparsity: 0.93, scale: 0.35 },
    { name: 'frost_crystal_scatter', sparsity: 0.95, scale: 0.30 },
    { name: 'sparkling_crystal_dust_hyperdetailed_rich', sparsity: 0.94, scale: 0.28 },
    { name: 'thin_ice_crust_hyperdetailed_rich', sparsity: 0.96, scale: 0.32 },
    { name: 'frost_stone', sparsity: 0.94, scale: 0.30 },
    { name: 'frozen_shell', sparsity: 0.95, scale: 0.28 },
    { name: 'ice_crystal_cluster', sparsity: 0.93, scale: 0.32 },
    { name: 'snow_clump', sparsity: 0.92, scale: 0.35 },
  ],
  beach: [
    { name: 'shell_scatter_scattered_seashells_on', sparsity: 0.90, scale: 0.35 },
    { name: 'small_crab_burrow_hole_in', sparsity: 0.95, scale: 0.30 },
    { name: 'wet_sand_grain_texture', sparsity: 0.94, scale: 0.28 },
    { name: 'dark_tide_line_mark', sparsity: 0.96, scale: 0.32 },
    { name: 'coral_fragment', sparsity: 0.93, scale: 0.30 },
    { name: 'driftwood_chip', sparsity: 0.94, scale: 0.35 },
    { name: 'sea_glass', sparsity: 0.95, scale: 0.28 },
    { name: 'seashell', sparsity: 0.92, scale: 0.32 },
  ],
  dense_forest: [
    { name: 'fallen_pinecone', sparsity: 0.92, scale: 0.30 },
    { name: 'moss_covered_small_stone', sparsity: 0.93, scale: 0.35 },
    { name: 'mushroom_cluster', sparsity: 0.94, scale: 0.32 },
    { name: 'rotting_branch_piece', sparsity: 0.91, scale: 0.38 },
    { name: 'moss_stone', sparsity: 0.93, scale: 0.32 },
    { name: 'rotting_branch', sparsity: 0.92, scale: 0.35 },
  ],
  desert: [
    { name: 'animal_skull_bleached_white_bone', sparsity: 0.97, scale: 0.35 },
    { name: 'cracked_dry_clay_hyperdetailed_rich', sparsity: 0.93, scale: 0.32 },
    { name: 'sunbaked_earth_patch_tan_ochre', sparsity: 0.95, scale: 0.30 },
    { name: 'hot_sand_patch_goldentan_fine', sparsity: 0.94, scale: 0.28 },
    { name: 'bleached_bone', sparsity: 0.96, scale: 0.32 },
    { name: 'dried_seed', sparsity: 0.94, scale: 0.28 },
    { name: 'polished_stone', sparsity: 0.95, scale: 0.30 },
    { name: 'scorpion_shell', sparsity: 0.96, scale: 0.30 },
  ],
  forest: [
    { name: 'acorn_cluster', sparsity: 0.92, scale: 0.30 },
    { name: 'brown_mushroom_morel_growing_from', sparsity: 0.94, scale: 0.32 },
    { name: 'small_forest_stone', sparsity: 0.93, scale: 0.35 },
    { name: 'small_twig_bundle', sparsity: 0.91, scale: 0.35 },
    { name: 'puffball_mushroom_round_white_puffy', sparsity: 0.95, scale: 0.28 },
    { name: 'bark_shard_piece', sparsity: 0.94, scale: 0.30 },
    { name: 'bark_shard', sparsity: 0.93, scale: 0.30 },
    { name: 'twig_bundle', sparsity: 0.92, scale: 0.35 },
  ],
  grassland: [
    { name: 'dried_wildflower', sparsity: 0.92, scale: 0.32 },
    { name: 'exposed_flat_stone_in_grass', sparsity: 0.94, scale: 0.35 },
    { name: 'seed_head_cluster', sparsity: 0.93, scale: 0.30 },
    { name: 'small_field_stone', sparsity: 0.95, scale: 0.32 },
    { name: 'dried_flower', sparsity: 0.93, scale: 0.30 },
    { name: 'field_stone', sparsity: 0.94, scale: 0.35 },
    { name: 'seed_head', sparsity: 0.95, scale: 0.28 },
    { name: 'snail_shell', sparsity: 0.96, scale: 0.28 },
  ],
  hills: [
    { name: 'rocky_soil_patch_brown_earth', sparsity: 0.92, scale: 0.35 },
    { name: 'slate_slab_flat_dark_grey_layered_rock', sparsity: 0.94, scale: 0.38 },
    { name: 'natural_quartz_crystal_formation_white', sparsity: 0.96, scale: 0.30 },
    { name: 'gem_deposit_colorful_crystals_embedded', sparsity: 0.97, scale: 0.28 },
    { name: 'iron_nugget', sparsity: 0.95, scale: 0.28 },
    { name: 'limestone_chip', sparsity: 0.93, scale: 0.32 },
    { name: 'quartz_pebble', sparsity: 0.94, scale: 0.30 },
    { name: 'slate_fragment', sparsity: 0.93, scale: 0.35 },
  ],
  mountains: [
    { name: 'fine_gravel_scatter_hyperdetailed_rich', sparsity: 0.91, scale: 0.32 },
    { name: 'grey_mountain_gravel_patch_stone', sparsity: 0.93, scale: 0.35 },
    { name: 'iron_ore_deposit', sparsity: 0.96, scale: 0.30 },
    { name: 'scree_loose_grey_angular_rock', sparsity: 0.92, scale: 0.38 },
    { name: 'crystal_fragment', sparsity: 0.95, scale: 0.28 },
    { name: 'ice_chunk', sparsity: 0.94, scale: 0.32 },
    { name: 'ore_glint', sparsity: 0.96, scale: 0.25 },
    { name: 'rock_shard', sparsity: 0.93, scale: 0.35 },
  ],
  mystic: [
    { name: 'glowing_arcane_flower_with_purple', sparsity: 0.93, scale: 0.32 },
    { name: 'mystic_crystal_glowing_purple_magical', sparsity: 0.94, scale: 0.30 },
    { name: 'runic_stone_ancient_carved_stone', sparsity: 0.95, scale: 0.35 },
    { name: 'spirit_wisp', sparsity: 0.96, scale: 0.28 },
    { name: 'aether_crystal', sparsity: 0.94, scale: 0.28 },
    { name: 'glowing_pebble', sparsity: 0.93, scale: 0.30 },
    { name: 'rune_shard', sparsity: 0.95, scale: 0.32 },
    { name: 'stardust_cluster', sparsity: 0.94, scale: 0.28 },
  ],
  savanna: [
    { name: 'bone_fragment', sparsity: 0.94, scale: 0.30 },
    { name: 'dried_seed_pod', sparsity: 0.93, scale: 0.28 },
    { name: 'dry_golden_thatch_hyperdetailed_rich', sparsity: 0.92, scale: 0.35 },
    { name: 'termite_mound_piece', sparsity: 0.95, scale: 0.32 },
    { name: 'bleached_stick', sparsity: 0.94, scale: 0.35 },
    { name: 'cracked_pod', sparsity: 0.93, scale: 0.28 },
    { name: 'dry_bone', sparsity: 0.96, scale: 0.30 },
    { name: 'termite_chip', sparsity: 0.95, scale: 0.25 },
  ],
  steppe: [
    { name: 'dried_brown_stem_scatter_hyperdetailed', sparsity: 0.93, scale: 0.30 },
    { name: 'dusty_earth_patch_pale_browngray', sparsity: 0.94, scale: 0.32 },
    { name: 'scattered_seed_husks_hyperdetailed_rich', sparsity: 0.95, scale: 0.28 },
    { name: 'windblown_dust_patch_hyperdetailed_rich', sparsity: 0.92, scale: 0.35 },
    { name: 'dust_clod', sparsity: 0.94, scale: 0.30 },
    { name: 'grass_ball', sparsity: 0.93, scale: 0.32 },
    { name: 'small_skull', sparsity: 0.96, scale: 0.30 },
    { name: 'wind_pebble', sparsity: 0.95, scale: 0.28 },
  ],
  swamp: [
    { name: 'algae_film_green_slimy_algae', sparsity: 0.91, scale: 0.35 },
    { name: 'thin_fungal_film_on_ground', sparsity: 0.93, scale: 0.32 },
    { name: 'waterlogged_dark_leaf', sparsity: 0.92, scale: 0.30 },
    { name: 'bog_iron', sparsity: 0.94, scale: 0.30 },
    { name: 'frog_eggs', sparsity: 0.95, scale: 0.28 },
    { name: 'leech', sparsity: 0.96, scale: 0.25 },
    { name: 'rotting_stick', sparsity: 0.93, scale: 0.35 },
  ],
  taiga: [
    { name: 'frozen_twig', sparsity: 0.92, scale: 0.32 },
    { name: 'ice_covered_pebble', sparsity: 0.94, scale: 0.28 },
    { name: 'pine_cone', sparsity: 0.93, scale: 0.30 },
    { name: 'pine_needle_duff_soil_patch', sparsity: 0.91, scale: 0.35 },
    { name: 'ice_pebble', sparsity: 0.94, scale: 0.28 },
  ],
  tropical_forest: [
    { name: 'bright_beetle_shell', sparsity: 0.94, scale: 0.28 },
    { name: 'exotic_seed_pod', sparsity: 0.93, scale: 0.30 },
    { name: 'small_palm_nut', sparsity: 0.92, scale: 0.32 },
    { name: 'vine_cutting_piece', sparsity: 0.91, scale: 0.35 },
    { name: 'beetle_shell', sparsity: 0.94, scale: 0.28 },
    { name: 'palm_nut', sparsity: 0.93, scale: 0.30 },
    { name: 'seed_pod', sparsity: 0.95, scale: 0.28 },
    { name: 'vine_cutting', sparsity: 0.92, scale: 0.35 },
  ],
  tundra: [
    { name: 'antler_shard', sparsity: 0.95, scale: 0.32 },
    { name: 'frozen_pebble_cluster', sparsity: 0.93, scale: 0.30 },
    { name: 'frozen_permafrost_earth_patch_graybrown', sparsity: 0.92, scale: 0.35 },
    { name: 'fossil_fragment', sparsity: 0.95, scale: 0.30 },
    { name: 'frozen_pebble', sparsity: 0.94, scale: 0.28 },
    { name: 'ice_shard', sparsity: 0.93, scale: 0.32 },
    { name: 'lichen_rock', sparsity: 0.94, scale: 0.35 },
  ],
  volcanic: [
    { name: 'dark_ash_film', sparsity: 0.92, scale: 0.32 },
    { name: 'grey_pumice_stone_lightweight_porous', sparsity: 0.94, scale: 0.30 },
    { name: 'lava_rock_glowing_redhot_rock', sparsity: 0.95, scale: 0.35 },
    { name: 'volcanic_rock_dark_black_ignite', sparsity: 0.93, scale: 0.32 },
    { name: 'yellow_sulfur_deposit_on_rock', sparsity: 0.96, scale: 0.28 },
    { name: 'charred_bone', sparsity: 0.95, scale: 0.30 },
    { name: 'lava_pebble', sparsity: 0.94, scale: 0.28 },
    { name: 'obsidian_shard', sparsity: 0.93, scale: 0.32 },
    { name: 'sulfur_crystal', sparsity: 0.96, scale: 0.25 },
  ],
};

// Variant indices pulled from rotation ('biome/object' -> excluded indices).
// Found by border-opacity scan (>50% of border pixels alpha>200). Two failure modes:
//  - "boxy" variants: full-square texture patches with a baked background (no
//    isolated object — background removal not viable, must be excluded)
//  - ALL64 dirs: every PNG is a ~94-byte JSON error body saved as .png
//    (failed generation downloads) — the whole object is disabled until regenerated
var ALL64 = [];
for (var _v = 0; _v < 64; _v++) ALL64.push(_v);
export var SS_VARIANT_EXCLUDE = {
  'arctic/ice_crystal_cluster': [2, 4, 12, 42],
  'arctic/sparkling_crystal_dust_hyperdetailed_rich': [60],
  'beach/shell_scatter_scattered_seashells_on': [51],
  'beach/wet_sand_grain_texture': [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 20, 21, 24, 26, 27, 29, 30, 31, 32, 34, 36, 37, 38, 39, 40, 42, 43, 45, 48, 51, 53, 54, 55, 57, 58, 59, 61, 62, 63],
  'dense_forest/fallen_pinecone': [32, 37, 43, 44, 53, 58],
  'dense_forest/moss_covered_small_stone': ALL64,
  'dense_forest/mushroom_cluster': ALL64,
  'dense_forest/rotting_branch_piece': ALL64,
  'desert/cracked_dry_clay_hyperdetailed_rich': [0],
  'forest/acorn_cluster': ALL64,
  'forest/puffball_mushroom_round_white_puffy': [4, 28, 29, 39, 40, 45],
  'forest/small_twig_bundle': ALL64,
  'forest/twig_bundle': [6, 7, 8, 13, 17, 19, 20, 42, 48],
  'grassland/exposed_flat_stone_in_grass': [26, 28, 29, 30, 31, 45, 56, 57, 58, 59, 60, 61],
  'hills/rocky_soil_patch_brown_earth': [16],
  'hills/slate_fragment': ALL64,
  'hills/slate_slab_flat_dark_grey_layered_rock': [0, 1, 2, 3, 4, 7, 8, 9, 11, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 30, 32, 33, 34, 35, 36, 38, 40, 41, 42, 43, 44, 45, 46, 56, 59, 63],
  'mountains/fine_gravel_scatter_hyperdetailed_rich': [0, 33, 59, 60],
  'mountains/grey_mountain_gravel_patch_stone': [22, 38, 42],
  'mountains/ice_chunk': [0, 6, 15, 31, 32, 33],
  'mountains/rock_shard': [47],
  'mountains/scree_loose_grey_angular_rock': [0, 1, 2, 5, 7, 8, 11, 12, 14, 16, 18, 20, 22, 25, 26, 29, 34, 35, 37, 39, 40, 41, 46, 48, 49, 50, 52, 53, 55, 56, 58, 59, 63],
  'mystic/glowing_pebble': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 58, 59, 60, 61, 62, 63],
  'mystic/mystic_crystal_glowing_purple_magical': [60],
  'mystic/rune_shard': [0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 13, 16, 18, 27, 30, 31, 34, 35, 36, 37, 38, 39, 40, 43, 44, 46, 47, 50, 52, 54, 56, 57, 60, 61, 63],
  'mystic/stardust_cluster': [13, 39, 47],
  'savanna/bleached_stick': [0, 62],
  'savanna/bone_fragment': [1, 12, 14, 23, 24, 27, 28, 30, 34, 37, 46, 48, 51],
  'savanna/cracked_pod': [12, 23, 59],
  'savanna/dried_seed_pod': [1, 4, 7, 9, 19, 20, 23, 24, 25, 26, 29, 30, 31, 34, 35, 36, 38, 39, 40, 41, 43, 44, 45, 46, 48, 49, 50, 53, 56, 59, 60, 61],
  'savanna/dry_golden_thatch_hyperdetailed_rich': [38],
  'steppe/dust_clod': [47],
  'steppe/grass_ball': [15, 25, 30, 62],
  'swamp/frog_eggs': ALL64,
  'swamp/thin_fungal_film_on_ground': [42, 52, 53, 54, 55, 59, 62],
  'swamp/waterlogged_dark_leaf': [13],
  'taiga/frozen_twig': [21, 23, 36],
  'taiga/ice_covered_pebble': [0, 2, 3, 7, 12, 13, 14, 16, 17, 19, 20, 21, 23, 25, 26, 27, 30, 31, 32, 33, 35, 36, 37, 39, 40, 42, 43, 48, 51, 54, 57, 58, 59, 60, 63],
  'taiga/ice_pebble': [4, 5, 15, 22, 24, 27, 28, 40, 41, 44, 53],
  'taiga/pine_cone': [0, 2, 3, 5, 8, 9, 10, 11, 12, 14, 15, 19, 20, 22, 23, 27, 31, 32, 36, 37, 40, 41, 42, 44, 46, 49, 50, 51, 54, 56, 62],
  'taiga/pine_needle_duff_soil_patch': [34],
  'tropical_forest/bright_beetle_shell': ALL64,
  'tropical_forest/exotic_seed_pod': ALL64,
  'tropical_forest/seed_pod': [3, 6, 15, 22, 26, 27, 41, 45, 47, 49, 57, 58],
  'tropical_forest/small_palm_nut': ALL64,
  'tropical_forest/vine_cutting': [46],
  'tropical_forest/vine_cutting_piece': [0, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21, 22, 23, 25, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63],
  'tundra/frozen_pebble': [17, 19, 27, 37],
  'volcanic/charred_bone': [56],
  'volcanic/dark_ash_film': [51],
  'volcanic/obsidian_shard': [0, 1, 2, 3, 4, 6, 9, 10, 12, 14, 16, 17, 18, 20, 21, 22, 23, 25, 26, 27, 28, 29, 30, 31, 35, 37, 39, 40, 41, 45, 46, 48, 51, 52, 54, 55, 58, 60, 62, 63],
};

// Precomputed allowed-variant arrays for objects with exclusions.
var _ssAllowed = {};
for (var _k in SS_VARIANT_EXCLUDE) {
  var _ex = {};
  for (var _i = 0; _i < SS_VARIANT_EXCLUDE[_k].length; _i++) _ex[SS_VARIANT_EXCLUDE[_k][_i]] = 1;
  var _al = [];
  for (var _w = 0; _w < SS_VARIANT_COUNT; _w++) if (!_ex[_w]) _al.push(_w);
  _ssAllowed[_k] = _al;
}

// Allowed variant indices for an object, or null when all 64 are usable.
// Empty array = object fully disabled (corrupt assets).
export function ssAllowedVariants(biome, name) {
  var a = _ssAllowed[biome + '/' + name];
  return a !== undefined ? a : null;
}

// Generated from assets/_states: 'biome/object' -> available states.
// Only objects with known state PNGs are listed. 'unknown' biome excluded.
var SS_STATES = {
  'arctic/frost_stone': ['cracked', 'destroyed', 'enchanted', 'frozen'],
  'arctic/frozen_shell': ['burned', 'cracked', 'destroyed', 'enchanted', 'frozen'],
  'arctic/ice_crystal_cluster': ['cracked', 'destroyed', 'enchanted', 'frozen'],
  'arctic/snow_clump': ['cracked', 'destroyed', 'enchanted', 'frozen'],
  'beach/coral_fragment': ['burned', 'cracked', 'destroyed', 'enchanted', 'frozen'],
  'beach/driftwood_chip': ['burned', 'decayed', 'destroyed', 'enchanted', 'frozen'],
  'beach/sea_glass': ['cracked', 'destroyed', 'enchanted', 'frozen'],
  'beach/seashell': ['burned', 'cracked', 'destroyed', 'enchanted', 'frozen'],
  'dense_forest/fallen_pinecone': ['burned', 'decayed', 'destroyed', 'enchanted', 'frozen'],
  'dense_forest/moss_stone': ['cracked', 'destroyed', 'enchanted', 'frozen'],
  'dense_forest/mushroom_cluster': ['burned', 'decayed', 'destroyed', 'enchanted', 'frozen'],
  'dense_forest/rotting_branch': ['burned', 'decayed', 'destroyed', 'enchanted', 'frozen'],
  'desert/bleached_bone': ['burned', 'cracked', 'destroyed', 'enchanted', 'frozen'],
  'desert/dried_seed': ['burned', 'decayed', 'destroyed', 'enchanted', 'frozen'],
  'desert/polished_stone': ['cracked', 'destroyed', 'enchanted', 'frozen'],
  'desert/scorpion_shell': ['burned', 'cracked', 'destroyed', 'enchanted', 'frozen'],
  'forest/acorn_cluster': ['burned', 'decayed', 'destroyed', 'enchanted', 'frozen'],
  'forest/bark_shard': ['burned', 'destroyed', 'enchanted', 'frozen'],
  'forest/small_forest_stone': ['cracked', 'destroyed', 'enchanted', 'frozen'],
  'forest/twig_bundle': ['burned', 'decayed', 'destroyed', 'enchanted', 'frozen'],
  'grassland/dried_flower': ['burned', 'decayed', 'destroyed', 'enchanted', 'frozen'],
  'grassland/field_stone': ['cracked', 'destroyed', 'enchanted', 'frozen'],
  'grassland/seed_head': ['burned', 'decayed', 'destroyed', 'enchanted', 'frozen'],
  'grassland/snail_shell': ['burned', 'cracked', 'destroyed', 'enchanted', 'frozen'],
  'hills/iron_nugget': ['cracked', 'destroyed', 'enchanted', 'frozen'],
  'hills/limestone_chip': ['cracked', 'destroyed', 'enchanted', 'frozen'],
  'hills/quartz_pebble': ['cracked', 'destroyed', 'enchanted', 'frozen'],
  'hills/slate_fragment': ['cracked', 'destroyed', 'enchanted', 'frozen'],
  'mountains/crystal_fragment': ['cracked', 'destroyed', 'enchanted', 'frozen'],
  'mountains/ice_chunk': ['cracked', 'destroyed', 'enchanted', 'frozen'],
  'mountains/ore_glint': ['cracked', 'destroyed', 'enchanted', 'frozen'],
  'mountains/rock_shard': ['cracked', 'destroyed', 'enchanted', 'frozen'],
  'mystic/aether_crystal': ['cracked', 'destroyed', 'enchanted', 'frozen'],
  'mystic/glowing_pebble': ['cracked', 'destroyed', 'enchanted', 'frozen'],
  'mystic/rune_shard': ['cracked', 'destroyed', 'enchanted', 'frozen'],
  'mystic/stardust_cluster': ['cracked', 'destroyed', 'enchanted', 'frozen'],
  'savanna/bleached_stick': ['burned', 'decayed', 'destroyed', 'enchanted', 'frozen'],
  'savanna/cracked_pod': ['burned', 'decayed', 'destroyed', 'enchanted', 'frozen'],
  'savanna/dry_bone': ['burned', 'cracked', 'destroyed', 'enchanted', 'frozen'],
  'savanna/termite_chip': ['burned', 'decayed', 'destroyed', 'enchanted', 'frozen'],
  'steppe/dust_clod': ['cracked', 'destroyed', 'enchanted', 'frozen'],
  'steppe/grass_ball': ['burned', 'decayed', 'destroyed', 'enchanted', 'frozen'],
  'steppe/small_skull': ['burned', 'cracked', 'destroyed', 'enchanted', 'frozen'],
  'steppe/wind_pebble': ['cracked', 'destroyed', 'enchanted', 'frozen'],
  'swamp/bog_iron': ['cracked', 'destroyed', 'enchanted', 'frozen'],
  'swamp/frog_eggs': ['burned', 'decayed', 'destroyed', 'enchanted', 'frozen'],
  'swamp/leech': ['burned', 'decayed', 'destroyed', 'enchanted', 'frozen'],
  'swamp/rotting_stick': ['burned', 'decayed', 'destroyed', 'enchanted', 'frozen'],
  'taiga/frozen_twig': ['burned', 'decayed', 'destroyed', 'enchanted', 'frozen'],
  'taiga/ice_pebble': ['cracked', 'destroyed', 'enchanted', 'frozen'],
  'taiga/pine_cone': ['burned', 'decayed', 'destroyed', 'enchanted', 'frozen'],
  'taiga/resin_drop': ['burned', 'decayed', 'destroyed', 'enchanted', 'frozen'],
  'tropical_forest/beetle_shell': ['burned', 'cracked', 'destroyed', 'enchanted', 'frozen'],
  'tropical_forest/palm_nut': ['burned', 'decayed', 'destroyed', 'enchanted', 'frozen'],
  'tropical_forest/seed_pod': ['burned', 'decayed', 'destroyed', 'enchanted', 'frozen'],
  'tropical_forest/vine_cutting': ['burned', 'decayed', 'destroyed', 'enchanted', 'frozen'],
  'tundra/fossil_fragment': ['burned', 'cracked', 'destroyed', 'enchanted', 'frozen'],
  'tundra/frozen_pebble': ['cracked', 'destroyed', 'enchanted', 'frozen'],
  'tundra/ice_shard': ['cracked', 'destroyed', 'frozen'],
  'tundra/lichen_rock': ['destroyed', 'enchanted', 'frozen'],
  'volcanic/charred_bone': ['burned', 'cracked', 'destroyed', 'enchanted', 'frozen'],
  'volcanic/lava_pebble': ['cracked', 'destroyed', 'enchanted', 'frozen'],
  'volcanic/obsidian_shard': ['cracked', 'destroyed', 'enchanted', 'frozen'],
  'volcanic/sulfur_crystal': ['cracked', 'destroyed', 'enchanted', 'frozen'],
};

var STATE_CHANCE = 0.22;        // share of placements that use a state sprite
var MAX_PER_TILE = 2;
var TILE_ART_PX = 32;           // art px per tile (claim space)
var CELLS = 8;                  // 8x8 claim cells per tile
var CELL_PX = TILE_ART_PX / CELLS;

var EMPTY = [];
var _placeCache = new Map();    // 'wx,wy,biome' -> placements
// _maskCache uses 'wx,wy' (no biome) because masks derive from biome-keyed placements and tileInfo is deterministic, so the result is implicitly biome-correct.
var _maskCache = new Map();     // 'wx,wy' -> Uint8Array(8) row bitmasks
var MAX_CACHE = 20000;

// Claim-scan radius (tiles). ±3 covers default scales; the tuner's
// multiplicative sliders can push footprints further, so the radius is
// derived from the tuning tree's worst case. Recomputed lazily after
// clearClaimCaches() (every tuning apply calls it). Capped at 8 — beyond
// that the mask loop cost outweighs fidelity at absurd slider combos.
var _scanR = 3;
var _scanRDirty = true;

function maxFieldReachTiles(field, basePx, scaleTable, fwK, dropK, fhK) {
  var maxBiome = 1;
  for (var k in scaleTable) maxBiome = Math.max(maxBiome, scaleTable[k]);
  var drawPx = basePx * maxBiome * maxSizeMul(field);
  // horizontal reach: ux offset (≤0.25 tile) + fw half-width;
  // vertical reach: uy offset + base drop + fh half-height (the larger wins)
  var reachPx = drawPx * Math.max(fwK, dropK + fhK);
  return 0.25 + reachPx / TILE_ART_PX;
}

function recomputeScanRadius() {
  _scanRDirty = false;
  var r = Math.max(
    maxFieldReachTiles('f3', TILE_ART_PX, { _: 0.5 }, 0.55, 0.32, 0.30),
    maxFieldReachTiles('f4', 64, F4_BIOME_SCALE, 0.30, 0.30, 0.16),
    maxFieldReachTiles('f5', 96, F5_BIOME_SCALE, 0.42, 0.30, 0.22),
    maxFieldReachTiles('f6', 192, F6_BIOME_SCALE, 0.30, 0.30, 0.16));
  _scanR = Math.min(8, Math.max(3, Math.ceil(r)));
}

export function claimScanRadius() {
  if (_scanRDirty) recomputeScanRadius();
  return _scanR;
}

function cachePut(map, key, val) {
  if (map.size >= MAX_CACHE) map.clear(); // deterministic — safe to drop wholesale
  map.set(key, val);
  return val;
}

// tileInfo(wx, wy) -> { biome, transition } | null  (caller-supplied lookup)
export function f3Placements(wx, wy, tileInfo) {
  var t = tileInfo(wx, wy);
  if (!t || t.transition) return EMPTY; // don't cache null/transition tiles (may load later)
  var key = wx + ',' + wy + ',' + t.biome;
  var hit = _placeCache.get(key);
  if (hit) return hit;
  var objs = SS_BIOME_OBJECTS[t.biome];
  if (!objs) return cachePut(_placeCache, key, EMPTY);
  var out = [];
  for (var oi = 0; oi < objs.length && out.length < MAX_PER_TILE; oi++) {
    var obj = objs[oi];
    var allowed = _ssAllowed[t.biome + '/' + obj.name];
    if (allowed && allowed.length === 0) continue; // all variants corrupt/boxy
    var sparsity = obj.sparsity || 0.93;
    // Density tuning scales the acceptance probability (same roll/seed as today)
    var dMul = tuneBiomeDensity('f3', t.biome) * tuneObjDensity('f3', t.biome, obj.name);
    if (rand2(wx, wy, 9500 + oi) > (1.0 - sparsity) * dMul) continue; // SAME seeds as today
    // Variant must be known before size (per-variant tuning) — same roll as before
    var variant = allowed
      ? allowed[pickIndex(rand2(wx, wy, 9510 + oi), allowed.length)]
      : pickIndex(rand2(wx, wy, 9510 + oi), SS_VARIANT_COUNT);
    var scale = (obj.scale || 0.32) *
      tuneSize('f3', t.biome, obj.name, variant, wx, wy, 9570 + oi * 4);
    var ux = 0.5 + (rand2(wx, wy, 9520 + oi) - 0.5) * 0.6;     // tile units
    var uy = 0.5 + (rand2(wx, wy, 9530 + oi) - 0.5) * 0.6;
    var drawPx = TILE_ART_PX * scale;
    var p = {
      name: obj.name, biome: t.biome,
      variant: variant,
      ux: ux, uy: uy, scale: scale,
      angle: (rand2(wx, wy, 9540 + oi) - 0.5) * 0.5,
      alpha: 0.85 + rand2(wx, wy, 9550 + oi) * 0.15,
      state: null,
      // base footprint ellipse, world art px, centered at the sprite base
      bx: (wx + ux) * TILE_ART_PX,
      by: (wy + uy) * TILE_ART_PX + drawPx * 0.32,
      fw: drawPx * 0.55, fh: drawPx * 0.30,
    };
    var states = SS_STATES[t.biome + '/' + obj.name];
    if (states && states.length && rand2(wx, wy, 9560 + oi) < STATE_CHANCE) {
      p.state = states[pickIndex(rand2(wx, wy, 9561 + oi), states.length)];
    }
    // self-spacing within the tile: reject if base centers closer than the
    // sum of half-widths (looser than ellipse-touch — debris may abut)
    var ok = true;
    for (var pi = 0; pi < out.length; pi++) {
      var q = out[pi];
      var dx = p.bx - q.bx, dy = p.by - q.by;
      if (dx * dx + dy * dy < (p.fw + q.fw) * (p.fw + q.fw) * 0.36) { ok = false; break; }
    }
    if (ok) out.push(p);
  }
  return cachePut(_placeCache, key, out.length ? out : EMPTY);
}

export function f3SpriteUrl(p) {
  if (p.state) {
    return SS_BASE_PATH + '_states/' + p.biome + '/' + p.name +
      '/ss__' + p.biome + '__' + p.name + '__state__' + p.state + '.png';
  }
  var v = p.variant;
  var idx = v < 10 ? '00' + v : (v < 100 ? '0' + v : '' + v);
  return SS_BASE_PATH + p.biome + '/' + p.name +
    '/ss__' + p.biome + '__' + p.name + '__v' + idx + '.png';
}

// 8x8 bitmask of claimed cells for tile (wx,wy). Row r bit c = cell claimed.
// Scans this tile + neighbors out to claimScanRadius() (≥3): radius is
// derived from the tuning tree's worst-case size multipliers (incl. F6
// 192px trees) so tuner scales can't push a footprint beyond the scan.
export function getClaimMask(wx, wy, tileInfo) {
  var key = wx + ',' + wy;
  var hit = _maskCache.get(key);
  if (hit) return hit;
  var mask = new Uint8Array(CELLS);
  var ox = wx * TILE_ART_PX, oy = wy * TILE_ART_PX;
  var complete = true; // any null (unloaded) neighbor -> don't cache the mask
  var R = claimScanRadius();
  // Epoch guard: if any f4/f5 call inside returns a provisional result (bumps
  // _provisionalEpoch), skip caching the mask — it may change when tiles load.
  var ep = _provisionalEpoch;
  for (var ny = -R; ny <= R; ny++) {
    for (var nx = -R; nx <= R; nx++) {
      if (!tileInfo(wx + nx, wy + ny)) { complete = false; continue; }
      var pls = f3Placements(wx + nx, wy + ny, tileInfo)
        .concat(f4Placements(wx + nx, wy + ny, tileInfo),
                f5Placements(wx + nx, wy + ny, tileInfo),
                f6Placements(wx + nx, wy + ny, tileInfo));
      for (var i = 0; i < pls.length; i++) {
        var p = pls[i];
        // Rasterize the base ellipse into this tile's cells. The ellipse is
        // inflated by half a cell so a cell is claimed if ANY part of it can
        // touch the footprint (a center-only test left up to half a cell of
        // edge unclaimed — F2 blade roots landed there and clipped sprites).
        var iw = p.fw + CELL_PX * 0.5, ih = p.fh + CELL_PX * 0.5;
        var c0 = Math.max(0, Math.floor((p.bx - iw - ox) / CELL_PX));
        var c1 = Math.min(CELLS - 1, Math.floor((p.bx + iw - ox) / CELL_PX));
        var r0 = Math.max(0, Math.floor((p.by - ih - oy) / CELL_PX));
        var r1 = Math.min(CELLS - 1, Math.floor((p.by + ih - oy) / CELL_PX));
        for (var r = r0; r <= r1; r++) {
          for (var c = c0; c <= c1; c++) {
            var px = ox + (c + 0.5) * CELL_PX, py = oy + (r + 0.5) * CELL_PX;
            var ex = (px - p.bx) / iw, ey = (py - p.by) / ih;
            if (ex * ex + ey * ey < 1.0) mask[r] |= (1 << c);
          }
        }
      }
    }
  }
  return (complete && _provisionalEpoch === ep) ? cachePut(_maskCache, key, mask) : mask;
}

// Point test in world art px — used by F2 to cull blades.
// Architecture claim — the highest-priority claimant (buildings/roads), above F6.
// A PURE predicate set by the resolved-building producer (renderer on the main
// thread, building-tile-query in the worker). Replaces the old renderer-mutated
// `buildingClaimTiles` Set so flora suppression is deterministic, not visit-order
// dependent. Any tile the predicate claims fully suppresses F2+ flora.
var _archClaim = function () { return false; };
// Exported so present-time render passes (e.g. the water-wave overlay) can suppress
// themselves over a building's tall screen silhouette — the claim now includes the
// height-aware north band, so a water tile a tall roof rises over reads as claimed.
export function architectureClaimAt(wx, wy) { return _archClaim(wx, wy); }
export function setArchitectureClaim(predicate) {
  var next = (typeof predicate === 'function') ? predicate : function () { return false; };
  if (next !== _archClaim) { _archClaim = next; clearClaimCaches(); } // f4/f5/f6 caches don't key on arch state
}

export function isClaimedAt(px, py, tileInfo) {
  var wx = Math.floor(px / TILE_ART_PX), wy = Math.floor(py / TILE_ART_PX);
  // Architecture (building) claim: entire tile suppressed.
  if (architectureClaimAt(wx, wy)) return true;
  var mask = getClaimMask(wx, wy, tileInfo);
  var c = Math.floor((px - wx * TILE_ART_PX) / CELL_PX);
  var r = Math.floor((py - wy * TILE_ART_PX) / CELL_PX);
  if (c < 0) c = 0; else if (c > 7) c = 7;
  if (r < 0) r = 0; else if (r > 7) r = 7;
  return (mask[r] & (1 << c)) !== 0;
}

export function clearClaimCaches() { _placeCache.clear(); _maskCache.clear(); _f4Cache.clear(); _f5Cache.clear(); _f5CandCache.clear(); _f6Cache.clear(); _scanRDirty = true; _provisionalEpoch = 0; }

// Footprint ellipses a,b (bx,by,fw,fh) intersect? Conservative sum-of-radii
// test on each axis — exact for circles, slightly loose for ellipses (good:
// large objects should never visually kiss).
function footprintsOverlap(a, b) {
  var nx = (a.bx - b.bx) / (a.fw + b.fw);
  var ny = (a.by - b.by) / (a.fh + b.fh);
  return nx * nx + ny * ny < 1;
}

function pad3(v) { return v < 10 ? '00' + v : (v < 100 ? '0' + v : '' + v); }

// Claim footprint from the alpha trim: ellipse hugging the visible base of
// the sprite. cx/cy = sprite draw centre in world art px; size = file px;
// drawPx = size*scale; trim = [x,y,w,h] in file px or null.
// wFrac/hFrac shape the ellipse relative to the visible extents.
function trimFoot(cx, cy, size, drawPx, trim, wFrac, hFrac, legacyW, legacyH) {
  if (!trim) {           // no trim data -> legacy file-edge footprint
    return { bx: cx, by: cy + drawPx * 0.30, fw: drawPx * legacyW, fh: drawPx * legacyH };
  }
  var s = drawPx / size; // file px -> world art px
  var visW = trim[2] * s, visH = trim[3] * s;
  var bottom = cy + (trim[1] + trim[3] - size / 2) * s; // visible bottom edge
  var fh = Math.max(2, visH * hFrac);
  return { bx: cx + (trim[0] + trim[2] / 2 - size / 2) * s, // visible centre x
           by: bottom - fh, fw: Math.max(2, visW * wFrac), fh: fh };
}

// One medium-flora plant per tile max. Deterministic (seed roots 9700-9713).
// Placement: { name, biome, size, variant, state, ux, uy, sizeTiles,
//              hasAnim, bx, by, fw, fh } — bx/by/fw/fh = base footprint
// ellipse in world art px, same contract as f3 placements.
export function f4Placements(wx, wy, tileInfo) {
  if (architectureClaimAt(wx, wy)) return EMPTY;
  var t = tileInfo(wx, wy);
  if (!t || t.transition) return EMPTY;
  var key = wx + ',' + wy + ',' + t.biome;
  var hit = _f4Cache.get(key);
  if (hit) return hit;
  var objs = MF_CATALOG[t.biome];
  var chance = (F4_TILE_CHANCE[t.biome] || 0) * tuneBiomeDensity('f4', t.biome);
  if (!objs || !objs.length || chance === 0) return cachePut(_f4Cache, key, EMPTY);
  if (rand2(wx, wy, 9700) > chance) return cachePut(_f4Cache, key, EMPTY);
  // Larger objects claim first: a tile F6 claimed never hosts F4. F6 is
  // own-tile deterministic (no neighbor dependence) — safe to cache.
  if (f6Placements(wx, wy, tileInfo).length) return cachePut(_f4Cache, key, EMPTY);
  // Cheap early-out: a tile hosting a final F5 never hosts F4. Uncached —
  // the authoritative neighbor-aware footprint check below owns caching
  // (an own-tile F5 may be uncached-provisional while neighbors load).
  if (f5Placements(wx, wy, tileInfo).length) return EMPTY;

  var obj = objs[pickIndex(rand2(wx, wy, 9701), objs.length)];
  // Object-level density: <1 rejects this tile's pick (1 placement/tile max,
  // so >1 cannot add more — clamped by construction). NEW salt 9714.
  var objD = tuneObjDensity('f4', t.biome, obj.name);
  if (objD < 1 && rand2(wx, wy, 9714) > objD) return cachePut(_f4Cache, key, EMPTY);
  // Lifecycle roll via the tunable state-weight resolver. Defaults reproduce
  // the historical 15/55/20/8/2 split exactly (same salt, same thresholds).
  var st = rollWeighted(
    tuneStateWeights('f4', t.biome, obj.name, F4_STATE_DEFAULTS),
    F4_STATE_ORDER, rand2(wx, wy, 9705));
  if (st === 'base') st = null;
  var variant;
  if (st && obj.statePool.length) {
    variant = obj.statePool[pickIndex(rand2(wx, wy, 9706), obj.statePool.length)];
  } else {
    st = null; // no pool -> render base
    variant = pickIndex(rand2(wx, wy, 9702), obj.variants);
  }
  var ux = 0.5 + (rand2(wx, wy, 9703) - 0.5) * 0.5;
  var uy = 0.5 + (rand2(wx, wy, 9704) - 0.5) * 0.5;
  var scale = (F4_BIOME_SCALE[t.biome] || 1.0) *
    tuneSize('f4', t.biome, obj.name, variant, wx, wy, 9720);
  var sizeTiles = obj.size * scale / TILE_ART_PX; // 64px @ 1.0 -> 2 tiles
  var drawPx = obj.size * scale;                  // world art px at 1 tile = 32px
  var p = {
    name: obj.name, biome: t.biome, size: obj.size, variant: variant, state: st,
    ux: ux, uy: uy, sizeTiles: sizeTiles,
    hasAnim: obj.anims.indexOf(variant) !== -1,
    // base footprint: bottom-centre of the sprite (plants are bottom-weighted)
    bx: (wx + ux) * TILE_ART_PX,
    by: (wy + uy) * TILE_ART_PX + drawPx * 0.30,
    fw: drawPx * 0.30, fh: drawPx * 0.16,
  };
  // Larger objects claim first (locked decision #7): an F4 whose footprint
  // intersects ANY nearby F5 footprint never existed. Checks final (post-
  // exclusion) F5 placements — F5 never consults F4, so no recursion. The
  // own tile (nx5=ny5=0) is covered too (early-out above already handles it).
  // Epoch guard: if any f5Placements call returns provisional (bumps
  // _provisionalEpoch), the derived F4 result must not be cached — a later
  // tile load could promote or kill a provisional F5, invalidating the result.
  var R5 = claimScanRadius();
  var ep = _provisionalEpoch; // snapshot before the F5-yield loop
  for (var ny5 = -R5; ny5 <= R5; ny5++) {
    for (var nx5 = -R5; nx5 <= R5; nx5++) {
      var f5n = f5Placements(wx + nx5, wy + ny5, tileInfo);
      if (f5n.length && footprintsOverlap(p, f5n[0])) {
        // Neighbor F5 wins — cache only if no provisional answers were seen.
        // If epoch changed the EMPTY result might later flip to [p], so skip
        // caching and let the next call re-evaluate when tiles are loaded.
        return _provisionalEpoch === ep ? cachePut(_f4Cache, key, EMPTY) : EMPTY;
      }
    }
  }
  return _provisionalEpoch === ep ? cachePut(_f4Cache, key, [p]) : [p];
}

export function f4SpriteUrl(p) {
  if (p.state) {
    return MF_BASE_PATH + p.biome + '/' + p.name + '/_states/' + p.state +
      '/mf__' + p.biome + '__' + p.name + '__' + p.state + '__v' + pad3(p.variant) + '.png';
  }
  return MF_BASE_PATH + p.biome + '/' + p.name +
    '/mf__' + p.biome + '__' + p.name + '__v' + pad3(p.variant) + '.png';
}

export function f4AnimUrlBase(p) {
  return MF_BASE_PATH + p.biome + '/' + p.name + '/anim/wind_sway/v' + pad3(p.variant) + '/';
}

// One medium object per tile max. Deterministic. Salt registry 9800-9820:
// 9800 tile chance, 9801 obj pick, 9802 variant, 9803/9804 jitter,
// 9805 state roll, 9806 neighbor-exclusion priority (f5Placements),
// 9814 obj density, 9820 tuneSize (consumes 9820-9822).
// Same placement contract as f4: { name, biome, size, variant, state,
// stateOnDisk, ux, uy, sizeTiles, hasAnim, bx, by, fw, fh }.
// States roll from day one (spec: honest roll); a state whose PNG hasn't
// landed renders the base variant — f5SpriteUrl checks stateOnDisk.
//
// f5Candidate = the raw per-tile roll, NO neighbor knowledge. Public
// f5Placements resolves footprint conflicts between candidates (below).
function f5Candidate(wx, wy, tileInfo) {
  var t = tileInfo(wx, wy);
  if (!t) { _provisionalEpoch++; return EMPTY; } // unloaded — provisional (may load later)
  if (t.transition) return EMPTY; // transition tiles are PERMANENT no-F5 — final, no epoch bump
  var key = wx + ',' + wy + ',' + t.biome;
  var hit = _f5CandCache.get(key);
  if (hit) return hit;
  var objs = MO_CATALOG[t.biome];
  var chance = (F5_TILE_CHANCE[t.biome] || 0) * tuneBiomeDensity('f5', t.biome);
  if (!objs || !objs.length || chance === 0) return cachePut(_f5CandCache, key, EMPTY);
  if (rand2(wx, wy, 9800) > chance) return cachePut(_f5CandCache, key, EMPTY);
  // Larger objects claim first: a tile F6 claimed never hosts F5. F6 is
  // own-tile deterministic (no neighbor dependence) — safe to cache.
  if (f6Placements(wx, wy, tileInfo).length) return cachePut(_f5CandCache, key, EMPTY);

  var obj = objs[pickIndex(rand2(wx, wy, 9801), objs.length)];
  var objD = tuneObjDensity('f5', t.biome, obj.name);
  if (objD < 1 && rand2(wx, wy, 9814) > objD) return cachePut(_f5CandCache, key, EMPTY);

  var weights = tuneStateWeights('f5', t.biome, obj.name, f5StateDefaults(t.biome));
  var st = rollWeighted(weights, F5_STATE_ORDER, rand2(wx, wy, 9805));
  if (st === 'base') st = null;
  var variant = pickIndex(rand2(wx, wy, 9802), obj.variants);
  var stateOnDisk = !!(st && obj.states[st] && obj.states[st].indexOf(variant) !== -1);

  var ux = 0.5 + (rand2(wx, wy, 9803) - 0.5) * 0.5;
  var uy = 0.5 + (rand2(wx, wy, 9804) - 0.5) * 0.5;
  var scale = (F5_BIOME_SCALE[t.biome] || 1.0) *
    tuneSize('f5', t.biome, obj.name, variant, wx, wy, 9820);
  var sizeTiles = obj.size * scale / TILE_ART_PX; // 96px @ 1.0 -> 3 tiles
  var drawPx = obj.size * scale;
  // base footprint from the alpha trim (visible extents), not the file edge:
  // transparent padding goes back to smaller fields. Legacy fractions kept
  // for trimless art (~2x F4's absolute claim — objects are ground-heavy).
  var cx = (wx + ux) * TILE_ART_PX, cy = (wy + uy) * TILE_ART_PX;
  var foot = trimFoot(cx, cy, obj.size, drawPx,
    (obj.trims && obj.trims[variant]) || null, 0.42, 0.22, 0.42, 0.22);
  var p = {
    name: obj.name, biome: t.biome, size: obj.size, variant: variant,
    state: st, stateOnDisk: stateOnDisk,
    ux: ux, uy: uy, sizeTiles: sizeTiles,
    hasAnim: obj.anims.indexOf(variant) !== -1,
    trim: (obj.trims && obj.trims[variant]) || null,
    sil: (obj.sil && obj.sil[variant]) || null,
    bx: foot.bx, by: foot.by, fw: foot.fw, fh: foot.fh,
  };
  return cachePut(_f5CandCache, key, [p]);
}

// Public F5 placements: a candidate survives unless a HIGHER-priority
// overlapping neighbor candidate exists (F5 beats F5 — at most one of any
// overlapping pair renders; a pair can both die to third parties). Priority =
// rand2(wx, wy, 9806), ties broken by (wy, wx) lexicographic so two tiles can
// never both survive. Candidates are pure per-tile rolls, so this terminates
// (no recursion through neighbors).
export function f5Placements(wx, wy, tileInfo) {
  if (architectureClaimAt(wx, wy)) return EMPTY;
  var cand = f5Candidate(wx, wy, tileInfo);
  if (!cand.length) return cand;
  var key = wx + ',' + wy + ',res';
  var hit = _f5Cache.get(key);
  if (hit) return hit;
  var p = cand[0];
  var myPri = rand2(wx, wy, 9806);
  // Neighbor radius: footprints reach ~1.3 tiles at default scale; use the
  // claim scan radius so extreme tuner scales stay covered.
  var R = claimScanRadius();
  var complete = true; // any null (unloaded) neighbor -> don't cache survival
  for (var ny = -R; ny <= R; ny++) {
    for (var nx = -R; nx <= R; nx++) {
      if (!nx && !ny) continue;
      if (!tileInfo(wx + nx, wy + ny)) { complete = false; continue; }
      var nc = f5Candidate(wx + nx, wy + ny, tileInfo);
      if (!nc.length || !footprintsOverlap(p, nc[0])) continue;
      var nPri = rand2(wx + nx, wy + ny, 9806);
      if (nPri > myPri || (nPri === myPri && (ny < 0 || (ny === 0 && nx < 0))))
        // neighbor wins — this object never existed. Candidates are pure, so
        // a found winner can never be retracted: safe to cache even when
        // other neighbors are still unloaded.
        return cachePut(_f5Cache, key, EMPTY);
    }
  }
  // Survival can be retracted by an unloaded neighbor's candidate, so only
  // cache when the whole scan ring was loaded (getClaimMask's rule).
  if (!complete) { _provisionalEpoch++; return cand; }
  return cachePut(_f5Cache, key, cand);
}

export function f5SpriteUrl(p) {
  if (p.state && p.stateOnDisk) {
    return MO_BASE_PATH + p.biome + '/' + p.name + '/_states/' + p.state +
      '/mo__' + p.biome + '__' + p.name + '__' + p.state + '__v' + pad3(p.variant) + '.png';
  }
  return MO_BASE_PATH + p.biome + '/' + p.name +
    '/mo__' + p.biome + '__' + p.name + '__v' + pad3(p.variant) + '.png';
}

export function f5AnimUrlBase(p) {
  return MO_BASE_PATH + p.biome + '/' + p.name + '/anim/wind_sway/v' + pad3(p.variant) + '/';
}

// Map a [0,1) roll to a pool POSITION, then through the species vmap to the real on-disk filename index.
// vmap decouples pool position from filename so omitted (culled) variants are simply absent from vmap.
// obj.variants >= 1 is a catalog invariant (an object with no usable variants is never cataloged).
export function pickF6Variant(obj, r) {
  var n = obj.variants;
  var pos = Math.floor(r * n);
  if (pos >= n) pos = n - 1;
  if (pos < 0) pos = 0;
  var variant = obj.vmap ? obj.vmap[pos] : pos;
  return { pos: pos, variant: variant };
}

// One tree per tile max. Deterministic (seed roots 9830-9840). Same contract
// as f4/f5 placements, plus `trim` ([x,y,w,h] file px) for claims + the
// future traversal system (Plan B). Claim = trunk base, not canopy: F2/F4
// may grow under the canopy, just not through the trunk.
export function f6Placements(wx, wy, tileInfo) {
  if (architectureClaimAt(wx, wy)) return EMPTY;
  var t = tileInfo(wx, wy);
  if (!t || t.transition) return EMPTY;
  var key = wx + ',' + wy + ',' + t.biome;
  var hit = _f6Cache.get(key);
  if (hit) return hit;
  var objs = LG_CATALOG[t.biome];
  var chance = (F6_TILE_CHANCE[t.biome] || 0) * tuneBiomeDensity('f6', t.biome);
  if (!objs || !objs.length || chance === 0) return cachePut(_f6Cache, key, EMPTY);
  if (rand2(wx, wy, 9830) > chance) return cachePut(_f6Cache, key, EMPTY);

  var obj = objs[Math.floor(rand2(wx, wy, 9831) * objs.length)];
  var objD = tuneObjDensity('f6', t.biome, obj.name);
  if (objD < 1 && rand2(wx, wy, 9834) > objD) return cachePut(_f6Cache, key, EMPTY);

  var st = rollWeighted(
    tuneStateWeights('f6', t.biome, obj.name, F6_STATE_DEFAULTS),
    F6_STATE_ORDER, rand2(wx, wy, 9835));
  if (st === 'base') st = null;
  var pick = pickF6Variant(obj, rand2(wx, wy, 9832));
  var variant = pick.variant;
  var stateOnDisk = !!(st && obj.states[st] && obj.states[st].indexOf(variant) !== -1);

  var ux = 0.5 + (rand2(wx, wy, 9833) - 0.5) * 0.5;
  var uy = 0.5 + (rand2(wx, wy, 9836) - 0.5) * 0.5;
  var scale = (F6_BIOME_SCALE[t.biome] || 1.0) *
    tuneSize('f6', t.biome, obj.name, variant, wx, wy, 9840);
  var sizeTiles = obj.size * scale / TILE_ART_PX; // 192px @ 1.0 -> 6 tiles
  var drawPx = obj.size * scale;
  var trim = (obj.trims && obj.trims[pick.pos]) || null;
  var cx = (wx + ux) * TILE_ART_PX, cy = (wy + uy) * TILE_ART_PX;
  var foot = trimFoot(cx, cy, obj.size, drawPx, trim, 0.30, 0.10, 0.30, 0.16);
  var p = {
    name: obj.name, biome: t.biome, size: obj.size, variant: variant,
    state: st, stateOnDisk: stateOnDisk, trim: trim,
    sil: (obj.sil && obj.sil[pick.pos]) || null,
    ux: ux, uy: uy, sizeTiles: sizeTiles,
    hasAnim: obj.anims.indexOf(variant) !== -1,
    bx: foot.bx, by: foot.by, fw: foot.fw, fh: foot.fh,
  };
  return cachePut(_f6Cache, key, [p]);
}

export function f6SpriteUrl(p) {
  if (p.state && p.stateOnDisk) {
    return LG_BASE_PATH + p.biome + '/' + p.name + '/_states/' + p.state +
      '/v' + pad3(p.variant) + '.png';
  }
  return LG_BASE_PATH + p.biome + '/' + p.name + '/v' + pad3(p.variant) + '.png';
}

export function f6AnimUrlBase(p) {
  return LG_BASE_PATH + p.biome + '/' + p.name + '/anim/wind_sway/v' + pad3(p.variant) + '/';
}

// Returns all state sprite URLs for objects in `biome` that have known states.
// Used by preloaders to warm the image cache for lifecycle-state sprites.
export function f3StateUrls(biome) {
  var urls = [];
  var prefix = biome + '/';
  for (var key in SS_STATES) {
    if (key.indexOf(prefix) !== 0) continue;
    var name = key.slice(prefix.length);
    var states = SS_STATES[key];
    for (var si = 0; si < states.length; si++) {
      urls.push(SS_BASE_PATH + '_states/' + biome + '/' + name +
        '/ss__' + biome + '__' + name + '__state__' + states[si] + '.png');
    }
  }
  return urls;
}
