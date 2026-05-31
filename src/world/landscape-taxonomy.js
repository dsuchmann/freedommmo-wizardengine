export const LANDSCAPE_LAYERS = Object.freeze([
  'bedrock', 'soil', 'ground_cover', 'flowers_herbs', 'stones_debris', 'shrubs_bushes_hedges',
  'vines_roots', 'trees_trunks_branches', 'canopy', 'insects_small_life', 'terrain_forms',
  'water_wetlands_shoreline', 'desert_dunes_drylands', 'mountains_cliffs_overhangs'
]);

export const LANDSCAPE_ASSET_FAMILIES = Object.freeze({
  bedrock: ['bedrock_base', 'strata', 'stone_plate', 'cracks', 'boulder_embedded', 'scree', 'gravel', 'ore_vein', 'basalt', 'granite', 'limestone', 'sandstone', 'shale', 'obsidian', 'glacial_stone', 'rune_stone'],
  soil: ['dry_dirt', 'damp_dirt', 'loam', 'clay_mud', 'cracked_mud', 'swamp_muck', 'peat', 'silt', 'alluvium', 'sand', 'ash_soil', 'permafrost', 'snow_earth', 'humus', 'root_soil', 'fungal_soil', 'aether_moss_soil'],
  ground_cover: ['short_grass', 'tall_grass', 'lush_grass', 'dry_grass', 'savanna_grass', 'steppe_tufts', 'moss', 'leaf_litter', 'pine_needles', 'reeds', 'cattails', 'marsh_grass', 'lichen', 'alpine_plants', 'dune_scrub', 'cactus_sprouts', 'fungal_mats', 'aether_moss', 'glow_grass', 'clover', 'fern_starts'],
  flowers_herbs: ['wildflowers', 'single_blossoms', 'herbs', 'medicinal_herbs', 'poison_flowers', 'desert_blooms', 'fungus_flowers', 'alpine_flowers', 'tundra_blooms', 'fae_flowers', 'pollen_plants', 'seed_heads', 'mushrooms', 'shelf_fungi', 'small_ferns'],
  stones_debris: ['pebbles', 'stones', 'boulder_chips', 'gravel_scatter', 'shells', 'driftwood', 'fallen_leaves', 'twigs', 'branches', 'exposed_roots', 'bones', 'ash_flakes', 'cinders', 'ice_shards', 'snow_clumps', 'pinecones', 'seed_pods', 'fruit_drops', 'anthills', 'termite_mounds'],
  shrubs_bushes_hedges: ['small_shrub', 'round_bush', 'bramble', 'berry_bush', 'thorn_bush', 'desert_scrub', 'sagebrush', 'swamp_bush', 'mangrove_shrub', 'hedge_straight', 'hedge_corner', 'hedge_endcap', 'hedge_gap', 'glow_shrub', 'flowering_bush', 'frozen_shrub', 'burnt_shrub'],
  vines_roots: ['ground_vines', 'hanging_vines', 'tree_vines', 'cliff_vines', 'root_tendrils', 'swamp_creepers', 'thorn_creepers', 'flowering_vines', 'ivy_wall', 'jungle_lianas', 'mystic_vines', 'frozen_vines', 'burnt_vines'],
  trees_trunks_branches: ['broadleaf_tree', 'ancient_tree', 'sapling', 'dead_tree', 'burnt_tree', 'fallen_log', 'hollow_log', 'conifer', 'snow_conifer', 'tropical_tree', 'palm', 'mangrove', 'swamp_cypress', 'acacia', 'cactus_tree', 'mystic_tree', 'fruit_tree', 'flowering_tree', 'giant_root_tree'],
  canopy: ['canopy_patch', 'canopy_edge', 'canopy_hole', 'dense_canopy', 'jungle_canopy', 'conifer_canopy', 'autumn_canopy', 'snow_canopy', 'swamp_canopy', 'mystic_canopy', 'hanging_moss', 'overhanging_branches'],
  insects_small_life: ['fireflies', 'butterflies', 'moths', 'bees', 'dragonflies', 'ants', 'beetles', 'flies', 'mosquitoes', 'crickets', 'glow_bugs', 'scarabs', 'snow_gnats', 'cave_bugs', 'mystic_sprites'],
  terrain_forms: ['low_slope', 'high_slope', 'hill_shoulder', 'ridge_crest', 'valley_floor', 'cliff_face', 'cliff_top', 'cliff_bottom', 'overhang_underside', 'cave_mouth', 'natural_bridge', 'ravine_edge', 'plateau_edge', 'mountain_slope', 'mountain_peak', 'scree_slope', 'dune_ridge', 'dune_slipface', 'canyon_wall', 'riverbank_cut', 'waterfall_edge', 'snow_cornice', 'lava_shelf', 'floating_ledge'],
  water_wetlands_shoreline: ['deep_water', 'ocean_waves', 'shallow_water', 'river_flow', 'lake_water', 'swamp_water', 'puddles', 'wet_mud', 'shore_foam', 'beach_wetline', 'riverbank_reeds', 'waterfall', 'rapids', 'ice_sheet', 'broken_ice', 'mystic_water'],
  desert_dunes_drylands: ['sand_base', 'ripple_sand', 'dune_crest', 'dune_shadow', 'dune_slipface', 'cracked_pan', 'salt_flat', 'desert_scrub', 'cactus', 'bleached_bones', 'mirage', 'wind_dust', 'sandstone_rocks'],
  mountains_cliffs_overhangs: ['cliff_wall', 'cliff_cap', 'cliff_foot', 'ledge', 'overhang_shadow', 'cave_entrance', 'ridge_rocks', 'snowline', 'alpine_grass', 'scree_field', 'strata', 'handholds', 'climb_vines', 'natural_bridge', 'ravine_wall']
});

export const LANDSCAPE_ANIMATIONS = Object.freeze(['ambient_idle', 'wind_sway', 'contact_bend', 'recovery', 'wet_shimmer', 'burn', 'smoke', 'freeze_shimmer', 'mystic_pulse', 'damage', 'harvest', 'growth', 'flow', 'foam', 'ripple', 'dust_trickle', 'pebble_fall', 'swarm', 'flee']);

export const LANDSCAPE_STATES = Object.freeze(['default', 'dry', 'damp', 'wet', 'waterlogged', 'muddy', 'frozen', 'frosted', 'snow_covered', 'burning', 'burnt', 'charred', 'scorched', 'ashen', 'poisoned', 'enchanted', 'glowing', 'rune_etched', 'trampled', 'cut', 'dug', 'harvested', 'flowering', 'fruiting', 'dead', 'diseased', 'collapsed', 'climbable']);
