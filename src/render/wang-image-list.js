// Wang tile image URL list — shared between main thread and workers.
// No DOM dependencies. Pure data.

var WANG_SUFFIX = '__v000.png';
var TRANSITIONS_BASE = '/assets/pixelab/landscape_v2/transitions/';
var WANG_VARIANTS = ['wang', 'wang_25', 'wang_50', 'wang_100'];
var WANG_VARIANT_TILE_COUNTS = { wang: 16, wang_25: 16, wang_50: 16, wang_100: 25 };

// PixelLab wang index: 0 = all lower biome, 15 = all upper biome.
// mask: 0 means this biome IS the lower terrain in the pair dir.
// mask: 15 means this biome IS the upper terrain in the pair dir.
var BIOME_INTERIOR = {
  beach:         { dir: 'beach_to_river',          mask: 0 },
  desert:        { dir: 'beach_to_desert',         mask: 15 },
  grassland:     { dir: 'forest_to_grassland',     mask: 15 },
  river:         { dir: 'beach_to_river',          mask: 15 },
  swamp:         { dir: 'forest_to_swamp',         mask: 15 },
  forest:        { dir: 'forest_to_grassland',     mask: 0 },
  dense_forest:  { dir: 'dense_forest_to_forest',  mask: 0 },
  tropical_forest:{ dir: 'forest_to_tropical_forest', mask: 15 },
  taiga:         { dir: 'forest_to_taiga',         mask: 15 },
  savanna:       { dir: 'grassland_to_savanna',    mask: 15 },
  steppe:        { dir: 'grassland_to_steppe',     mask: 15 },
  tundra:        { dir: 'arctic_to_tundra',         mask: 15 },
  arctic:        { dir: 'arctic_to_tundra',         mask: 0 },
  hills:         { dir: 'grassland_to_hills',      mask: 15 },
  mountains:     { dir: 'hills_to_mountains',      mask: 15 },
  volcanic:      { dir: 'desert_to_volcanic',      mask: 15 },
  mystic:        { dir: 'grassland_to_mystic',     mask: 15 },
  ocean:         { dir: 'deep_ocean_to_ocean',     mask: 15 },
  deep_ocean:    { dir: 'deep_ocean_to_ocean',     mask: 0 },
  shallow_water: { dir: 'ocean_to_shallow_water',  mask: 15 },
  lake:          { dir: 'lake_to_river',           mask: 0 },
};

var BIOME_CLIFF = {
  beach: 'beach_cliff', desert: 'sand_cliff', grassland: 'grass_cliff',
  forest: 'forest_cliff', dense_forest: 'forest_cliff', tropical_forest: 'forest_cliff',
  taiga: 'snow_cliff', savanna: 'savanna_cliff', steppe: 'steppe_cliff',
  swamp: 'swamp_cliff', tundra: 'tundra_cliff', arctic: 'snow_cliff',
  hills: 'hills_cliff', mountains: 'stone_cliff', volcanic: 'volcanic_cliff',
  mystic: 'mystic_cliff', ocean: 'cliff_overlay', deep_ocean: 'cliff_overlay',
  shallow_water: 'cliff_overlay', river: 'cliff_overlay', lake: 'cliff_overlay',
};

// All 21 biomes — used to generate all possible pair URLs dynamically
var ALL_BIOMES = [
  'arctic','beach','deep_ocean','dense_forest','desert','forest','grassland',
  'hills','lake','mountains','mystic','ocean','river','savanna',
  'shallow_water','steppe','swamp','taiga','tropical_forest','tundra','volcanic'
];

export { WANG_SUFFIX, TRANSITIONS_BASE, BIOME_INTERIOR, BIOME_CLIFF, ALL_BIOMES, WANG_VARIANTS, WANG_VARIANT_TILE_COUNTS };

// Build URLs for a specific set of biomes only (for prioritized preloading).
// biomes: array of biome IDs present nearby.
export function getWangImageURLsForBiomes(biomes) {
  var urls = [];
  var biomeSet = new Set(biomes);
  var seenDirs = new Set();

  // Interior tiles for each biome
  for (var b = 0; b < biomes.length; b++) {
    var info = BIOME_INTERIOR[biomes[b]];
    if (info && !seenDirs.has(info.dir)) {
      seenDirs.add(info.dir);
      for (var m = 0; m < 16; m++) {
        urls.push(TRANSITIONS_BASE + info.dir + '/wang/' + info.dir + '__wang_' + m + WANG_SUFFIX);
      }
      // Elevation variants
      var elevVariants = ['wang_25', 'wang_50', 'wang_100'];
      for (var vi = 0; vi < elevVariants.length; vi++) {
        var variant = elevVariants[vi];
        var tileCount = WANG_VARIANT_TILE_COUNTS[variant];
        for (var em = 0; em < tileCount; em++) {
          urls.push(TRANSITIONS_BASE + info.dir + '/' + variant + '/' + info.dir + '__wang_' + em + WANG_SUFFIX);
        }
      }
    }
  }

  // Self-transition elevation variants for each biome
  for (var sb = 0; sb < biomes.length; sb++) {
    var selfDir = biomes[sb] + '_to_' + biomes[sb];
    if (!seenDirs.has(selfDir)) {
      seenDirs.add(selfDir);
      var selfVariants = ['wang_25', 'wang_50', 'wang_100'];
      for (var svi = 0; svi < selfVariants.length; svi++) {
        var sv = selfVariants[svi];
        var stc = WANG_VARIANT_TILE_COUNTS[sv];
        for (var sm = 0; sm < stc; sm++) {
          urls.push(TRANSITIONS_BASE + selfDir + '/' + sv + '/' + selfDir + '__wang_' + sm + WANG_SUFFIX);
        }
      }
    }
  }

  // Transition pairs between nearby biomes (both directions)
  for (var i = 0; i < biomes.length; i++) {
    for (var j = i + 1; j < biomes.length; j++) {
      var a = biomes[i], bm = biomes[j];
      var dirs = [a < bm ? a + '_to_' + bm : bm + '_to_' + a];
      // Also add directed pairs for elevation variants
      dirs.push(a + '_to_' + bm, bm + '_to_' + a);
      for (var di = 0; di < dirs.length; di++) {
        var dir = dirs[di];
        if (seenDirs.has(dir)) continue;
        seenDirs.add(dir);
        var variants = di === 0 ? ['wang'] : ['wang_25', 'wang_50', 'wang_100'];
        for (var vk = 0; vk < variants.length; vk++) {
          var vr = variants[vk];
          var tc = WANG_VARIANT_TILE_COUNTS[vr];
          for (var mk = 0; mk < tc; mk++) {
            urls.push(TRANSITIONS_BASE + dir + '/' + vr + '/' + dir + '__wang_' + mk + WANG_SUFFIX);
          }
        }
      }
    }
  }

  // Cliff overlays for nearby biomes
  var cliffSeen = {};
  for (var bk = 0; bk < biomes.length; bk++) {
    var cd = BIOME_CLIFF[biomes[bk]];
    if (!cd || cliffSeen[cd]) continue;
    cliffSeen[cd] = true;
    for (var cm = 0; cm < 16; cm++) {
      urls.push(TRANSITIONS_BASE + cd + '/wang/' + cd + '__wang_' + cm + WANG_SUFFIX);
    }
  }
  return urls;
}

// Soil material → directory mapping. Each biome gets its own unique substrate.
var SOIL_MATERIALS = {
  forest: 'loam',
  dense_forest: 'dark_humus',
  tropical_forest: 'tropical_humus',
  taiga: 'needle_duff',
  grassland: 'dry_loam',
  savanna: 'sun_baked_earth',
  steppe: 'dusty_earth',
  desert: 'hot_sand',
  beach: 'wet_sand',
  swamp: 'peat_mud',
  hills: 'hillside_grass',
  mountains: 'grey_gravel',
  volcanic: 'basalt_ash',
  tundra: 'frozen_earth',
  arctic: 'glacial_crust',
  mystic: 'aether_loam',
  ocean: 'ocean_surface',
  deep_ocean: 'deep_water',
  shallow_water: 'shallow_water',
  river: 'flowing_water',
  lake: 'still_water'
};
var SOIL_BASE_PATH = '/assets/pixelab/landscape_v2/micro/soil/';
var SOIL_VARIANT_COUNT = 64;

export function getSoilImageURLs() {
  var urls = [];
  var seenMaterials = new Set();
  // Generate URLs for all 21 biome substrate materials
  for (var biome in SOIL_MATERIALS) {
    var mat = SOIL_MATERIALS[biome];
    if (seenMaterials.has(mat)) continue;
    seenMaterials.add(mat);
    for (var v = 0; v < SOIL_VARIANT_COUNT; v++) {
      var idx = v < 10 ? '00' + v : (v < 100 ? '0' + v : '' + v);
      urls.push(SOIL_BASE_PATH + mat + '/soil__' + mat + '__v' + idx + '.png');
    }
  }
  return urls;
}

export function soilMaterialForBiome(biome) {
  return SOIL_MATERIALS[biome] || 'loam';
}

// Ground cover objects per biome — must match GC_BIOME_OBJECTS in worker-chunk-renderer.js
var GC_BIOME_OBJECTS_LIST = {
  beach: ['wet_sand', 'sea_foam', 'tide_line'],
  forest: ['fallen_leaves', 'moss_patch', 'pine_needles'],
  dense_forest: ['dark_leaf_mat', 'dark_wet_moss', 'fungal_film'],
  tropical_forest: ['tropical_leaves', 'bright_green_moss', 'fern_fronds'],
  taiga: ['frost_pine_needles', 'frost_lichen', 'bark_chips'],
  grassland: ['grass_mat', 'clover_patch', 'golden_thatch'],
  savanna: ['golden_grass_tuft', 'cracked_earth', 'seed_husks'],
  steppe: ['pale_grass_wisps', 'dust_patch', 'dried_stems'],
  desert: ['sand_ripple', 'dust_drift', 'cracked_clay'],
  swamp: ['algae_film', 'sphagnum_moss', 'waterlogged_leaf'],
  hills: ['hillside_grass', 'flat_stone', 'brown_moss'],
  mountains: ['lichen_crust', 'frost_crystals', 'gravel_scatter'],
  volcanic: ['ash_film', 'char_crust', 'pumice_dust'],
  tundra: ['frozen_moss', 'ice_crust', 'dead_lichen'],
  arctic: ['snow_crust', 'ice_crystals', 'frost_pattern'],
  mystic: ['glowing_moss', 'aether_tendril', 'crystal_dust'],
  shallow_water: ['ripple_pattern', 'sand_shimmer', 'seaweed_strand'],
  ocean: ['wave_foam', 'light_caustic', 'floating_debris'],
  deep_ocean: ['dark_current', 'bioluminescence'],
  river: ['flow_streaks', 'bubble_trail', 'river_foam'],
  lake: ['soft_ripple', 'light_dapple', 'lily_pad'],
};
var GC_BASE_PATH = '/assets/pixelab/landscape_v2/micro/ground_cover/';
var GC_VARIANT_COUNT = 64;

export function getGroundCoverImageURLs() {
  var urls = [];
  for (var biome in GC_BIOME_OBJECTS_LIST) {
    var objects = GC_BIOME_OBJECTS_LIST[biome];
    for (var oi = 0; oi < objects.length; oi++) {
      for (var v = 0; v < GC_VARIANT_COUNT; v++) {
        var idx = v < 10 ? '00' + v : (v < 100 ? '0' + v : '' + v);
        urls.push(GC_BASE_PATH + biome + '/' + objects[oi] + '/gc__' + biome + '__' + objects[oi] + '__v' + idx + '.png');
      }
    }
  }
  return urls;
}

// Small flora objects per biome (Field 2) — grass, ferns, small flowers
var SF_BIOME_OBJECTS_LIST = {
  arctic: ['frost_flower', 'frozen_grass', 'ice_needle'],
  beach: ['beach_weed', 'dune_grass', 'sea_oat'],
  dense_forest: ['shade_fern', 'dark_herb', 'bracket_fungus'],
  desert: ['sand_grass', 'desert_thorn'],
  forest: ['grass_blade_cluster', 'small_fern', 'clover_bloom'],
  grassland: ['tall_grass_blade', 'dandelion_stem', 'wild_herb'],
  hills: ['heather_sprig'],
  mountains: ['alpine_tuft', 'alpine_grass', 'rock_cress', 'hardy_lichen'],
  mystic: ['glow_grass_blade', 'aether_fern', 'crystal_sprout'],
  savanna: ['dry_grass_spike', 'thorn_sprout', 'acacia_seedling'],
  steppe: ['wind_grass', 'sparse_weed', 'dry_tuft', 'dry_weed'],
  swamp: ['bog_grass', 'cattail_base', 'swamp_herb'],
  taiga: ['frost_grass', 'low_juniper', 'cold_moss_tuft'],
  tropical_forest: ['broad_fern', 'orchid_sprout', 'vine_tendril'],
  tundra: ['tundra_grass', 'low_berry_bush', 'ice_moss', 'arctic_berry'],
  volcanic: ['ash_grass', 'heat_sprout', 'lava_fern'],
};
var SF_BASE_PATH = '/assets/pixelab/landscape_v2/micro/small_flora/';
var SF_VARIANT_COUNT = 64;

export { SF_BIOME_OBJECTS_LIST, SF_BASE_PATH, SF_VARIANT_COUNT };

export function getSmallFloraImageURLs() {
  var urls = [];
  for (var biome in SF_BIOME_OBJECTS_LIST) {
    var objects = SF_BIOME_OBJECTS_LIST[biome];
    for (var oi = 0; oi < objects.length; oi++) {
      for (var v = 0; v < SF_VARIANT_COUNT; v++) {
        var idx = v < 10 ? '00' + v : (v < 100 ? '0' + v : '' + v);
        urls.push(SF_BASE_PATH + biome + '/' + objects[oi] + '/sf__' + biome + '__' + objects[oi] + '__v' + idx + '.png');
      }
    }
  }
  return urls;
}

export function getSmallFloraImageURLsForBiomes(biomes) {
  var urls = [];
  for (var b = 0; b < biomes.length; b++) {
    var objects = SF_BIOME_OBJECTS_LIST[biomes[b]];
    if (!objects) continue;
    for (var oi = 0; oi < objects.length; oi++) {
      for (var v = 0; v < SF_VARIANT_COUNT; v++) {
        var idx = v < 10 ? '00' + v : (v < 100 ? '0' + v : '' + v);
        urls.push(SF_BASE_PATH + biomes[b] + '/' + objects[oi] + '/sf__' + biomes[b] + '__' + objects[oi] + '__v' + idx + '.png');
      }
    }
  }
  return urls;
}

// Small scatter objects per biome (Field 3) — pebbles, bones, shells, mushrooms
var SS_BIOME_OBJECTS_LIST = {
  arctic: ['blue_ice_crystal_scatter', 'frost_crystal_scatter', 'sparkling_crystal_dust_hyperdetailed_rich', 'thin_ice_crust_hyperdetailed_rich', 'frost_stone', 'frozen_shell', 'ice_crystal_cluster', 'snow_clump'],
  beach: ['shell_scatter_scattered_seashells_on', 'small_crab_burrow_hole_in', 'wet_sand_grain_texture', 'dark_tide_line_mark', 'coral_fragment', 'driftwood_chip', 'sea_glass', 'seashell'],
  dense_forest: ['fallen_pinecone', 'moss_covered_small_stone', 'mushroom_cluster', 'rotting_branch_piece', 'moss_stone', 'rotting_branch'],
  desert: ['animal_skull_bleached_white_bone', 'cracked_dry_clay_hyperdetailed_rich', 'sunbaked_earth_patch_tan_ochre', 'hot_sand_patch_goldentan_fine', 'bleached_bone', 'dried_seed', 'polished_stone', 'scorpion_shell'],
  forest: ['acorn_cluster', 'brown_mushroom_morel_growing_from', 'small_forest_stone', 'small_twig_bundle', 'puffball_mushroom_round_white_puffy', 'bark_shard_piece', 'bark_shard', 'twig_bundle'],
  grassland: ['dried_wildflower', 'exposed_flat_stone_in_grass', 'seed_head_cluster', 'small_field_stone', 'dried_flower', 'field_stone', 'seed_head', 'snail_shell'],
  hills: ['rocky_soil_patch_brown_earth', 'slate_slab_flat_dark_grey_layered_rock', 'natural_quartz_crystal_formation_white', 'gem_deposit_colorful_crystals_embedded', 'iron_nugget', 'limestone_chip', 'quartz_pebble', 'slate_fragment'],
  mountains: ['fine_gravel_scatter_hyperdetailed_rich', 'grey_mountain_gravel_patch_stone', 'iron_ore_deposit', 'scree_loose_grey_angular_rock', 'crystal_fragment', 'ice_chunk', 'ore_glint', 'rock_shard'],
  mystic: ['glowing_arcane_flower_with_purple', 'mystic_crystal_glowing_purple_magical', 'runic_stone_ancient_carved_stone', 'spirit_wisp', 'aether_crystal', 'glowing_pebble', 'rune_shard', 'stardust_cluster'],
  savanna: ['bone_fragment', 'dried_seed_pod', 'dry_golden_thatch_hyperdetailed_rich', 'termite_mound_piece', 'bleached_stick', 'cracked_pod', 'dry_bone', 'termite_chip'],
  steppe: ['dried_brown_stem_scatter_hyperdetailed', 'dusty_earth_patch_pale_browngray', 'scattered_seed_husks_hyperdetailed_rich', 'windblown_dust_patch_hyperdetailed_rich', 'dust_clod', 'grass_ball', 'small_skull', 'wind_pebble'],
  swamp: ['algae_film_green_slimy_algae', 'thin_fungal_film_on_ground', 'waterlogged_dark_leaf', 'bog_iron', 'frog_eggs', 'leech', 'rotting_stick'],
  taiga: ['frozen_twig', 'ice_covered_pebble', 'pine_cone', 'pine_needle_duff_soil_patch', 'ice_pebble'],
  tropical_forest: ['bright_beetle_shell', 'exotic_seed_pod', 'small_palm_nut', 'vine_cutting_piece', 'beetle_shell', 'palm_nut', 'seed_pod', 'vine_cutting'],
  tundra: ['antler_shard', 'frozen_pebble_cluster', 'frozen_permafrost_earth_patch_graybrown', 'fossil_fragment', 'frozen_pebble', 'ice_shard', 'lichen_rock'],
  volcanic: ['dark_ash_film', 'grey_pumice_stone_lightweight_porous', 'lava_rock_glowing_redhot_rock', 'volcanic_rock_dark_black_ignite', 'yellow_sulfur_deposit_on_rock', 'charred_bone', 'lava_pebble', 'obsidian_shard', 'sulfur_crystal'],
};
var SS_BASE_PATH = '/assets/pixelab/landscape_v2/micro/small_scatter/';
var SS_VARIANT_COUNT = 64;

export { SS_BIOME_OBJECTS_LIST, SS_BASE_PATH, SS_VARIANT_COUNT };

export function getSmallScatterImageURLs() {
  var urls = [];
  for (var biome in SS_BIOME_OBJECTS_LIST) {
    var objects = SS_BIOME_OBJECTS_LIST[biome];
    for (var oi = 0; oi < objects.length; oi++) {
      for (var v = 0; v < SS_VARIANT_COUNT; v++) {
        var idx = v < 10 ? '00' + v : (v < 100 ? '0' + v : '' + v);
        urls.push(SS_BASE_PATH + biome + '/' + objects[oi] + '/ss__' + biome + '__' + objects[oi] + '__v' + idx + '.png');
      }
    }
  }
  return urls;
}

export function getSmallScatterImageURLsForBiomes(biomes) {
  var urls = [];
  for (var b = 0; b < biomes.length; b++) {
    var objects = SS_BIOME_OBJECTS_LIST[biomes[b]];
    if (!objects) continue;
    for (var oi = 0; oi < objects.length; oi++) {
      for (var v = 0; v < SS_VARIANT_COUNT; v++) {
        var idx = v < 10 ? '00' + v : (v < 100 ? '0' + v : '' + v);
        urls.push(SS_BASE_PATH + biomes[b] + '/' + objects[oi] + '/ss__' + biomes[b] + '__' + objects[oi] + '__v' + idx + '.png');
      }
    }
  }
  return urls;
}

// Large object types per biome (Field 6) — trees, boulders, structures
var LG_BIOME_OBJECTS_LIST = {
  arctic: ['frozen_tree', 'ice_crystal_spire', 'crystal_ice_tower'],
  beach: ['beach_palm', 'coastal_pine', 'driftwood'],
  dense_forest: ['ancient_oak', 'gnarled_elm', 'strangler_fig'],
  desert: ['date_palm', 'saguaro', 'sandstone_arch'],
  forest: ['birch', 'maple', 'oak'],
  grassland: ['apple_tree', 'cherry_blossom', 'meadow_oak'],
  hills: ['rowan', 'scots_pine', 'standing_stone'],
  mountains: ['cliff_pine', 'mountain_ash', 'rock_spire'],
  mystic: ['aether_pillar', 'crystal_tree', 'spirit_tree'],
  savanna: ['acacia', 'baobab', 'thorny_acacia'],
  steppe: ['dead_tree', 'stone_monolith', 'twisted_shrub'],
  swamp: ['cypress', 'dead_willow', 'mangrove'],
  taiga: ['frost_cedar', 'snow_pine', 'spruce'],
  tropical_forest: ['banyan', 'coconut_palm', 'jungle_tree'],
  tundra: ['frost_willow', 'ice_pillar', 'stunted_pine'],
  volcanic: ['charred_tree', 'magma_vent', 'obsidian_spike'],
};
var LG_BASE_PATH = '/assets/pixelab/landscape_v2/micro/large_objects/';
var LG_VARIANT_COUNT = 48; // PixelLab size=32 generates 48 candidates

export { LG_BIOME_OBJECTS_LIST, LG_BASE_PATH, LG_VARIANT_COUNT };

export function getLargeObjectImageURLs() {
  var urls = [];
  for (var biome in LG_BIOME_OBJECTS_LIST) {
    var objects = LG_BIOME_OBJECTS_LIST[biome];
    for (var oi = 0; oi < objects.length; oi++) {
      for (var v = 0; v < LG_VARIANT_COUNT; v++) {
        var idx = v < 10 ? '00' + v : (v < 100 ? '0' + v : '' + v);
        urls.push(LG_BASE_PATH + biome + '/' + objects[oi] + '/lg__' + biome + '__' + objects[oi] + '__v' + idx + '.png');
      }
    }
  }
  return urls;
}

export function getLargeObjectImageURLsForBiomes(biomes) {
  var urls = [];
  for (var b = 0; b < biomes.length; b++) {
    var objects = LG_BIOME_OBJECTS_LIST[biomes[b]];
    if (!objects) continue;
    for (var oi = 0; oi < objects.length; oi++) {
      for (var v = 0; v < LG_VARIANT_COUNT; v++) {
        var idx = v < 10 ? '00' + v : (v < 100 ? '0' + v : '' + v);
        urls.push(LG_BASE_PATH + biomes[b] + '/' + objects[oi] + '/lg__' + biomes[b] + '__' + objects[oi] + '__v' + idx + '.png');
      }
    }
  }
  return urls;
}

// Build the complete URL list for all wang tile images.
// Generates URLs for all 21×20 directed pairs × all variants.
// Workers preload these — missing files just 404 silently.
export function getAllWangImageURLs() {
  var urls = [];
  var seenDirs = new Set();

  // All 210 unordered pairs (A < B) for s0.0 (wang/)
  for (var i = 0; i < ALL_BIOMES.length; i++) {
    for (var j = i + 1; j < ALL_BIOMES.length; j++) {
      var dir = ALL_BIOMES[i] + '_to_' + ALL_BIOMES[j];
      for (var m = 0; m < 16; m++) {
        urls.push(TRANSITIONS_BASE + dir + '/wang/' + dir + '__wang_' + m + WANG_SUFFIX);
      }
      seenDirs.add(dir);
    }
  }

  // All 441 directed pairs (including self-transitions) for s0.25, s0.5, s1.0
  for (var ai = 0; ai < ALL_BIOMES.length; ai++) {
    for (var bi = 0; bi < ALL_BIOMES.length; bi++) {
      var ddir = ALL_BIOMES[ai] + '_to_' + ALL_BIOMES[bi];
      var elevVariants = ['wang_25', 'wang_50', 'wang_100'];
      for (var vi = 0; vi < elevVariants.length; vi++) {
        var variant = elevVariants[vi];
        var tileCount = WANG_VARIANT_TILE_COUNTS[variant];
        for (var em = 0; em < tileCount; em++) {
          urls.push(TRANSITIONS_BASE + ddir + '/' + variant + '/' + ddir + '__wang_' + em + WANG_SUFFIX);
        }
      }
    }
  }

  // Cliff overlays (only wang/)
  var cliffSeen = {};
  for (var bk in BIOME_CLIFF) {
    var cd = BIOME_CLIFF[bk];
    if (cliffSeen[cd]) continue;
    cliffSeen[cd] = true;
    for (var cm = 0; cm < 16; cm++) {
      urls.push(TRANSITIONS_BASE + cd + '/wang/' + cd + '__wang_' + cm + WANG_SUFFIX);
    }
  }
  return urls;
}
