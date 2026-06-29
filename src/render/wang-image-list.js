// Wang tile image URL list — shared between main thread and workers.
// No DOM dependencies. Pure data.
import { SS_BIOME_OBJECTS, SS_BASE_PATH as SS_BASE_PATH_DC, SS_VARIANT_COUNT as SS_VARIANT_COUNT_DC, f3StateUrls, ssAllowedVariants } from '../world/decoration-claims.js';
import { SF_CATALOG } from '../world/sf-catalog.js';

var WANG_SUFFIX = '__v000.png';
var TRANSITIONS_BASE = '/assets/pixelab/landscape_v2/transitions/';
var WANG_VARIANTS = ['wang', 'wang_25', 'wang_50', 'wang_100'];
var WANG_VARIANT_TILE_COUNTS = { wang: 16, wang_25: 16, wang_50: 16, wang_100: 25 };

// Biomes with no dedicated Wang tileset that reuse another biome's art.
// 'stream' is the same river_water substance as 'river' — alias, not a fake.
// Applied ONLY when constructing asset dir names; biome ids stay real elsewhere.
var WANG_ASSET_ALIAS = { stream: 'river' };
export function wangAssetName(biome) {
  return WANG_ASSET_ALIAS[biome] || biome;
}

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
  stream:        { dir: 'beach_to_river',          mask: 15 },
};

var BIOME_CLIFF = {
  beach: 'beach_cliff', desert: 'sand_cliff', grassland: 'grass_cliff',
  forest: 'forest_cliff', dense_forest: 'forest_cliff', tropical_forest: 'forest_cliff',
  taiga: 'snow_cliff', savanna: 'savanna_cliff', steppe: 'steppe_cliff',
  swamp: 'swamp_cliff', tundra: 'tundra_cliff', arctic: 'snow_cliff',
  hills: 'hills_cliff', mountains: 'stone_cliff', volcanic: 'volcanic_cliff',
  mystic: 'mystic_cliff', ocean: 'cliff_overlay', deep_ocean: 'cliff_overlay',
  shallow_water: 'cliff_overlay', river: 'cliff_overlay', lake: 'cliff_overlay',
  stream: 'cliff_overlay',
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
  // Map through asset aliases (e.g. stream → river) so aliased biomes
  // preload the tilesets they actually draw from, then dedupe.
  biomes = Array.from(new Set(biomes.map(wangAssetName)));
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
  volcanic: 'ash_grass',
  tundra: 'frozen_earth',
  arctic: 'glacial_crust',
  mystic: 'aether_loam',
  ocean: 'ocean_surface',
  deep_ocean: 'deep_water',
  shallow_water: 'shallow_water',
  river: 'flowing_water',
  stream: 'flowing_water',
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

// Same as getSoilImageURLs but restricted to a given biome set — used for the
// critical first-paint gate so workers don't block on all 21 materials.
export function getSoilImageURLsForBiomes(biomes) {
  var urls = [];
  var seenMaterials = new Set();
  for (var b = 0; b < biomes.length; b++) {
    var mat = SOIL_MATERIALS[biomes[b]];
    if (!mat || seenMaterials.has(mat)) continue;
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

// Same as getGroundCoverImageURLs but restricted to a given biome set — used
// for the critical first-paint gate so workers don't block on all 21 biomes.
export function getGroundCoverImageURLsForBiomes(biomes) {
  var urls = [];
  for (var b = 0; b < biomes.length; b++) {
    var objects = GC_BIOME_OBJECTS_LIST[biomes[b]];
    if (!objects) continue;
    for (var oi = 0; oi < objects.length; oi++) {
      for (var v = 0; v < GC_VARIANT_COUNT; v++) {
        var idx = v < 10 ? '00' + v : (v < 100 ? '0' + v : '' + v);
        urls.push(GC_BASE_PATH + biomes[b] + '/' + objects[oi] + '/gc__' + biomes[b] + '__' + objects[oi] + '__v' + idx + '.png');
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
  hills: ['heather_sprig', 'hillside_grass', 'rock_flower_bud'],
  mountains: ['alpine_tuft', 'hardy_lichen', 'rock_cress'],
  mystic: ['glow_grass_blade', 'aether_fern', 'crystal_sprout'],
  savanna: ['dry_grass_spike', 'thorn_sprout', 'acacia_seedling'],
  steppe: ['sparse_weed', 'dry_tuft', 'wind_grass'],
  swamp: ['swamp_herb', 'bog_grass', 'cattail_base'],
  taiga: ['frost_grass', 'low_juniper', 'cold_moss_tuft'],
  tropical_forest: ['broad_fern', 'orchid_sprout', 'vine_tendril'],
  tundra: ['tundra_grass', 'low_berry_bush', 'ice_moss'],
  volcanic: ['heat_sprout', 'lava_fern', 'ash_grass'],
};
var SF_BASE_PATH = '/assets/pixelab/landscape_v2/micro/small_flora/';
var SF_VARIANT_COUNT = 64;

// Hand-curated variant whitelists ('biome/object' → allowed variant indices).
// Variants not listed have square tile shapes or other artifacts.
// Objects not listed here use all SF_VARIANT_COUNT variants.
var SF_VARIANT_WHITELIST = {
  'taiga/frost_grass': [0, 1, 2, 4, 7, 13, 16, 22, 26, 39, 40, 41, 47, 51, 55, 63],
  // steppe/sparse_weed: all 64 minus square-tile-shaped variants 6,14,21,26,42,45,51,55
  'steppe/sparse_weed': [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20, 22, 23, 24, 25, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 43, 44, 46, 47, 48, 49, 50, 52, 53, 54, 56, 57, 58, 59, 60, 61, 62, 63],
  'tundra/tundra_grass': [0, 1, 4, 7, 8, 15, 17, 18, 19, 20, 36, 40],
  'tundra/low_berry_bush': [0, 4, 6, 9, 23, 45, 47],
  // arctic/ice_needle: all 64 minus full-bleed square variants 21,25,30,35,40,45,50,55,60
  'arctic/ice_needle': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 23, 24, 26, 27, 28, 29, 31, 32, 33, 34, 36, 37, 38, 39, 41, 42, 43, 44, 46, 47, 48, 49, 51, 52, 53, 54, 56, 57, 58, 59, 61, 62, 63],
  // desert/sand_grass: all 64 minus 19 full-square cream/white box variants
  'desert/sand_grass': [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 24, 25, 26, 28, 31, 33, 34, 36, 39, 41, 42, 45, 48, 49, 50, 52, 53, 54, 55, 57, 58, 60, 61, 62, 63],
  // mountains/alpine_tuft: all 64 minus full-square variants 56,57
  'mountains/alpine_tuft': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 58, 59, 60, 61, 62, 63],
};

// Anim coverage map ('biome/object' → variant indices that HAVE wind_sway frames on disk).
// Generated from the asset tree — prevents 404 floods when preloading anim frames.
// Objects NOT listed here have complete coverage (all 64 variants animated).
// Empty array = no animations at all (static only).
var SF_ANIM_VARIANTS = {
  'beach/sea_oat': [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,39,40,41,42,43,44,45,46,47,48,49,51,52,53,54,55,56,57,59,60,61,62,63],
  'dense_forest/shade_fern': [0],
  'desert/sand_grass': [0],
  'forest/grass_blade_cluster': [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,43,44,45,46,47,48,49,51,52,53,54,55,56,57,58,59,60,61,62,63],
  'forest/small_fern': [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,23,24,25,26,28,29,30,31,32,33,34,35,36,37,38,39,40,41,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63],
  'forest/clover_bloom': [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,57,58,59,60,61,62,63],
  'grassland/tall_grass_blade': [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,20,23,24,27,28,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,59,60,61,62,63],
  'grassland/dandelion_stem': [0,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63],
  'grassland/wild_herb': [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63],
  'mountains/hardy_lichen': [0],
  'mystic/glow_grass_blade': [0],
  'mystic/crystal_sprout': [],
  'steppe/sparse_weed': [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63],
  'steppe/dry_tuft': [0],
  'taiga/low_juniper': [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63],
  'taiga/cold_moss_tuft': [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,46,48,49,50,51,52,53,54,55,56,57,59,60,61,62,63],
  'tropical_forest/broad_fern': [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63],
  'tropical_forest/orchid_sprout': [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63],
  'tundra/tundra_grass': [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,20],
  'tundra/low_berry_bush': [],
  'volcanic/heat_sprout': [0],
  'volcanic/lava_fern': [0],
  // Newly-wired F2 flora (base sprites complete; wind_sway coverage from disk).
  // FULL-coverage objects (all 64 variants animated) are intentionally omitted
  // here: desert/desert_thorn, swamp/cattail_base, hills/rock_flower_bud.
  'mountains/rock_cress': [0],
  'steppe/wind_grass': [0],
  'tundra/ice_moss': [0],
  'swamp/bog_grass': [0],
  'hills/hillside_grass': [0,1,2,3,4,5,6,7,8,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63],
};

// Returns the Set-like array of variant indices that have wind_sway anims,
// or null if the object has full coverage (no entry = all variants animated).
export function sfAnimVariantsFor(biome, objName) {
  var wl = SF_ANIM_VARIANTS[biome + '/' + objName];
  return wl !== undefined ? wl : null;
}

// Rare static decor objects mixed into Field 2 per biome (full sprite URLs).
var SF_EXTRA_OBJECTS = {
  tundra: [
    '/assets/pixelab/landscape_v2/objects/tundra_ground_cover/sprites/tundra_frozen_fish_pile__object__v108.png',
    '/assets/pixelab/landscape_v2/objects/tundra_ground_cover/sprites/tundra_snow_sculpture__object__v004.png',
    '/assets/pixelab/landscape_v2/objects/tundra_ground_cover/sprites/tundra_permafrost_crack__object__v003.png',
    '/assets/pixelab/landscape_v2/objects/tundra_ground_cover/sprites/tundra_permafrost_crack__object__v024.png',
  ],
};

export { SF_BIOME_OBJECTS_LIST, SF_BASE_PATH, SF_VARIANT_COUNT, SF_VARIANT_WHITELIST, SF_EXTRA_OBJECTS };

export function sfVariantsFor(biome, objName) {
  // Prefer catalog vmap (disk-derived, curation-filtered) over hand-curated whitelist.
  var catBiome = SF_CATALOG[biome];
  if (catBiome) {
    for (var ci = 0; ci < catBiome.length; ci++) {
      if (catBiome[ci].name === objName) return catBiome[ci].vmap;
    }
  }
  return SF_VARIANT_WHITELIST[biome + '/' + objName] || null;
}

function sfVariantIndices(biome, objName) {
  var wl = SF_VARIANT_WHITELIST[biome + '/' + objName];
  if (wl) return wl;
  var all = [];
  for (var v = 0; v < SF_VARIANT_COUNT; v++) all.push(v);
  return all;
}

export function getSmallFloraImageURLs() {
  var urls = [];
  for (var biome in SF_BIOME_OBJECTS_LIST) {
    var objects = SF_BIOME_OBJECTS_LIST[biome];
    for (var oi = 0; oi < objects.length; oi++) {
      var variants = sfVariantIndices(biome, objects[oi]);
      for (var v = 0; v < variants.length; v++) {
        var n = variants[v];
        var idx = n < 10 ? '00' + n : (n < 100 ? '0' + n : '' + n);
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
      var variants = sfVariantIndices(biomes[b], objects[oi]);
      for (var v = 0; v < variants.length; v++) {
        var n = variants[v];
        var idx = n < 10 ? '00' + n : (n < 100 ? '0' + n : '' + n);
        urls.push(SF_BASE_PATH + biomes[b] + '/' + objects[oi] + '/sf__' + biomes[b] + '__' + objects[oi] + '__v' + idx + '.png');
      }
    }
    var extras = SF_EXTRA_OBJECTS[biomes[b]];
    if (extras) for (var e = 0; e < extras.length; e++) urls.push(extras[e]);
  }
  return urls;
}

// Small scatter (Field 3) — sourced from decoration-claims.js (single source of truth).
// SS_BIOME_OBJECTS is the shared catalog; SS_BASE_PATH_DC / SS_VARIANT_COUNT_DC imported above.
export { SS_BIOME_OBJECTS as SS_BIOME_OBJECTS_LIST, SS_BASE_PATH_DC as SS_BASE_PATH, SS_VARIANT_COUNT_DC as SS_VARIANT_COUNT };

export function getSmallScatterImageURLs() {
  var biomes = Object.keys(SS_BIOME_OBJECTS);
  return getSmallScatterImageURLsForBiomes(biomes);
}

export function getSmallScatterImageURLsForBiomes(biomes) {
  var urls = [];
  for (var b = 0; b < biomes.length; b++) {
    var biome = biomes[b];
    var objects = SS_BIOME_OBJECTS[biome];
    if (!objects) continue;
    for (var oi = 0; oi < objects.length; oi++) {
      var name = objects[oi].name;
      var allowed = ssAllowedVariants(biome, name); // null = all 64
      var count = allowed ? allowed.length : SS_VARIANT_COUNT_DC;
      for (var v = 0; v < count; v++) {
        var n = allowed ? allowed[v] : v;
        var idx = n < 10 ? '00' + n : (n < 100 ? '0' + n : '' + n);
        urls.push(SS_BASE_PATH_DC + biome + '/' + name + '/ss__' + biome + '__' + name + '__v' + idx + '.png');
      }
    }
    // Also preload lifecycle-state sprites so they're in cache when drawn
    var stateUrls = f3StateUrls(biome);
    for (var si = 0; si < stateUrls.length; si++) {
      urls.push(stateUrls[si]);
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
