"""
generate_biome_data.py — generates 18 biome affinity files and ~30 biome transition files.

Outputs:
  data/terrain_objects/affinities/{biome_id}.json   (18 files)
  data/terrain_objects/transitions/{a}_{b}.json     (~30 files)
"""

import json
import os
import sys

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))
AFFINITIES_DIR = os.path.join(PROJECT_ROOT, "data", "terrain_objects", "affinities")
TRANSITIONS_DIR = os.path.join(PROJECT_ROOT, "data", "terrain_objects", "transitions")

os.makedirs(AFFINITIES_DIR, exist_ok=True)
os.makedirs(TRANSITIONS_DIR, exist_ok=True)

# ---------------------------------------------------------------------------
# Shared lifecycle distributions
# ---------------------------------------------------------------------------
TREE_DIST = {
    "seedling": 0.05, "sapling": 0.10, "juvenile": 0.15,
    "mature": 0.50, "old_growth": 0.15, "dying": 0.05
}
BUSH_DIST = {
    "seedling": 0.05, "growing": 0.15, "mature": 0.55,
    "flowering": 0.15, "dying": 0.10
}
GRASS_DIST = {
    "sprout": 0.05, "growing": 0.15, "mature": 0.65,
    "dry": 0.10, "dead": 0.05
}
FLOWER_DIST = {
    "bud": 0.15, "blooming": 0.50, "wilting": 0.20, "seed_head": 0.15
}
ROCK_DIST = {"intact": 0.70, "cracked": 0.20, "crumbled": 0.10}
MUSHROOM_DIST = {"pinhead": 0.10, "growing": 0.25, "mature": 0.50, "sporing": 0.15}
WATER_DIST = {"calm": 0.60, "rippling": 0.30, "churning": 0.10}
MINERAL_DIST = {"exposed": 0.50, "weathered": 0.35, "depleted": 0.15}
SNOW_DIST = {"fresh": 0.40, "packed": 0.40, "melting": 0.20}
ICE_DIST = {"forming": 0.20, "solid": 0.60, "cracking": 0.20}
ASH_DIST = {"fresh": 0.50, "settling": 0.35, "old": 0.15}


def pool_entry(
    object_id,
    density,
    cluster_mode="perlin",
    elevation_range=None,
    moisture_range=None,
    slope_max=None,
    distance_rules=None,
    lifecycle_distribution=None,
    variant_count=3,
):
    entry = {
        "object_id": object_id,
        "density": density,
        "cluster_mode": cluster_mode,
        "variant_count": variant_count,
    }
    if elevation_range is not None:
        entry["elevation_range"] = elevation_range
    if moisture_range is not None:
        entry["moisture_range"] = moisture_range
    if slope_max is not None:
        entry["slope_max"] = slope_max
    if distance_rules is not None:
        entry["distance_rules"] = distance_rules
    if lifecycle_distribution is not None:
        entry["lifecycle_distribution"] = lifecycle_distribution
    return entry


# ---------------------------------------------------------------------------
# 18 Biome Affinity Definitions
# ---------------------------------------------------------------------------
BIOMES = {}

BIOMES["ocean"] = {
    "biome_id": "ocean",
    "display_name": "Ocean",
    "ambient": {"wind": 0.4, "moisture": 1.0},
    "object_pools": [
        pool_entry("ocean_wave", 0.80, "perlin", lifecycle_distribution=WATER_DIST, variant_count=4),
        pool_entry("shore_foam", 0.40, "edge_follow", lifecycle_distribution=WATER_DIST),
        pool_entry("kelp", 0.15, "perlin", moisture_range=[0.8, 1.0], lifecycle_distribution=TREE_DIST),
        pool_entry("saltwater_algae", 0.10, "perlin", moisture_range=[0.8, 1.0], lifecycle_distribution=MUSHROOM_DIST),
        pool_entry("branching_coral", 0.05, "cluster", lifecycle_distribution={"young": 0.30, "mature": 0.50, "bleached": 0.20}),
        pool_entry("brain_coral", 0.03, "cluster", lifecycle_distribution={"young": 0.30, "mature": 0.50, "bleached": 0.20}),
        pool_entry("fan_coral", 0.02, "cluster", lifecycle_distribution={"young": 0.30, "mature": 0.50, "bleached": 0.20}),
        pool_entry("shell_scatter", 0.05, "scatter", lifecycle_distribution=ROCK_DIST),
        pool_entry("whirlpool", 0.01, "perlin", lifecycle_distribution=WATER_DIST, variant_count=2),
    ],
}

BIOMES["beach"] = {
    "biome_id": "beach",
    "display_name": "Beach",
    "ambient": {"wind": 0.35, "moisture": 0.6},
    "object_pools": [
        pool_entry("wind_sand_drift", 0.30, "perlin", lifecycle_distribution=ASH_DIST, variant_count=4),
        pool_entry("dune_ripple", 0.20, "perlin", lifecycle_distribution=ASH_DIST, variant_count=3),
        pool_entry("conch_shell", 0.08, "scatter", lifecycle_distribution=ROCK_DIST),
        pool_entry("clam_shell", 0.06, "scatter", lifecycle_distribution=ROCK_DIST),
        pool_entry("shell_scatter", 0.10, "scatter", lifecycle_distribution=ROCK_DIST),
        pool_entry("driftwood", 0.05, "scatter", lifecycle_distribution={"fresh": 0.30, "weathered": 0.50, "bleached": 0.20}),
        pool_entry("crab_burrow", 0.04, "scatter", distance_rules={"max_water_distance": 8}, lifecycle_distribution={"active": 0.60, "abandoned": 0.40}),
        pool_entry("sea_grass", 0.08, "water_follow", moisture_range=[0.5, 1.0], distance_rules={"max_water_distance": 3}, lifecycle_distribution=GRASS_DIST),
        pool_entry("coconut_palm", 0.03, "perlin", elevation_range=[0.05, 0.3], lifecycle_distribution=TREE_DIST),
        pool_entry("tidal_pool", 0.04, "scatter", distance_rules={"max_water_distance": 4}, lifecycle_distribution=WATER_DIST),
    ],
}

BIOMES["grassland"] = {
    "biome_id": "grassland",
    "display_name": "Grassland",
    "ambient": {"wind": 0.3, "moisture": 0.5},
    "object_pools": [
        pool_entry("tall_grass", 0.45, "perlin", elevation_range=[0.0, 0.5], moisture_range=[0.3, 0.8], lifecycle_distribution=GRASS_DIST, variant_count=4),
        pool_entry("short_grass", 0.35, "perlin", lifecycle_distribution=GRASS_DIST, variant_count=4),
        pool_entry("meadow_grass", 0.20, "perlin", moisture_range=[0.4, 0.9], lifecycle_distribution=GRASS_DIST),
        pool_entry("wildflower", 0.15, "scatter", lifecycle_distribution=FLOWER_DIST),
        pool_entry("daisy", 0.10, "cluster", lifecycle_distribution=FLOWER_DIST),
        pool_entry("poppy", 0.05, "cluster", lifecycle_distribution=FLOWER_DIST),
        pool_entry("dandelion", 0.08, "scatter", lifecycle_distribution=FLOWER_DIST),
        pool_entry("flowering_bush", 0.06, "cluster", lifecycle_distribution=BUSH_DIST),
        pool_entry("berry_bush", 0.03, "cluster", lifecycle_distribution=BUSH_DIST),
        pool_entry("flat_rock", 0.04, "scatter", slope_max=0.3, lifecycle_distribution=ROCK_DIST),
        pool_entry("pebble", 0.06, "scatter", lifecycle_distribution=ROCK_DIST),
        pool_entry("ant_mound", 0.02, "scatter", lifecycle_distribution={"active": 0.70, "dormant": 0.30}),
        pool_entry("bird_nest", 0.01, "scatter", lifecycle_distribution={"active": 0.50, "empty": 0.50}),
        pool_entry("oak_tree", 0.02, "perlin", lifecycle_distribution=TREE_DIST),
        pool_entry("birch_tree", 0.01, "perlin", lifecycle_distribution=TREE_DIST),
    ],
}

BIOMES["forest"] = {
    "biome_id": "forest",
    "display_name": "Forest",
    "ambient": {"wind": 0.15, "moisture": 0.6, "light_filter": "green_canopy"},
    "object_pools": [
        pool_entry("oak_tree", 0.25, "perlin", lifecycle_distribution=TREE_DIST, variant_count=4),
        pool_entry("birch_tree", 0.15, "perlin", lifecycle_distribution=TREE_DIST, variant_count=3),
        pool_entry("maple_tree", 0.10, "perlin", lifecycle_distribution=TREE_DIST, variant_count=3),
        pool_entry("elm_tree", 0.08, "perlin", lifecycle_distribution=TREE_DIST),
        pool_entry("beech_tree", 0.06, "perlin", lifecycle_distribution=TREE_DIST),
        pool_entry("flowering_bush", 0.12, "cluster", lifecycle_distribution=BUSH_DIST),
        pool_entry("berry_bush", 0.06, "cluster", lifecycle_distribution=BUSH_DIST),
        pool_entry("forest_fern", 0.15, "perlin", lifecycle_distribution=GRASS_DIST, variant_count=3),
        pool_entry("ground_moss", 0.20, "perlin", lifecycle_distribution={"growing": 0.30, "lush": 0.50, "dry": 0.20}),
        pool_entry("tree_moss", 0.10, "perlin", lifecycle_distribution={"growing": 0.30, "lush": 0.50, "dry": 0.20}),
        pool_entry("toadstool", 0.06, "cluster", lifecycle_distribution=MUSHROOM_DIST),
        pool_entry("morel", 0.03, "cluster", lifecycle_distribution=MUSHROOM_DIST),
        pool_entry("fallen_log", 0.05, "scatter", lifecycle_distribution={"fresh": 0.20, "mossy": 0.50, "rotting": 0.30}),
        pool_entry("hollow_log", 0.02, "scatter", lifecycle_distribution={"intact": 0.50, "rotting": 0.50}),
        pool_entry("mossy_boulder", 0.04, "scatter", lifecycle_distribution=ROCK_DIST),
        pool_entry("autumn_leaves", 0.15, "perlin", lifecycle_distribution={"fresh": 0.40, "dry": 0.40, "decomposing": 0.20}),
        pool_entry("bird_nest", 0.03, "scatter", lifecycle_distribution={"active": 0.50, "empty": 0.50}),
        pool_entry("spider_web", 0.02, "scatter", lifecycle_distribution={"intact": 0.60, "damaged": 0.40}),
        pool_entry("climbing_vine", 0.04, "perlin", lifecycle_distribution=BUSH_DIST),
        pool_entry("wildflower", 0.05, "scatter", lifecycle_distribution=FLOWER_DIST),
    ],
}

BIOMES["dense_forest"] = {
    "biome_id": "dense_forest",
    "display_name": "Dense Forest",
    "ambient": {"wind": 0.05, "moisture": 0.8, "light_filter": "deep_green_canopy"},
    "object_pools": [
        pool_entry("oak_tree", 0.30, "perlin", lifecycle_distribution=TREE_DIST, variant_count=4),
        pool_entry("beech_tree", 0.20, "perlin", lifecycle_distribution=TREE_DIST, variant_count=3),
        pool_entry("elm_tree", 0.10, "perlin", lifecycle_distribution=TREE_DIST),
        pool_entry("hollow_tree", 0.04, "scatter", lifecycle_distribution={"hollow": 0.70, "collapsing": 0.30}),
        pool_entry("giant_fern", 0.15, "perlin", lifecycle_distribution=GRASS_DIST),
        pool_entry("forest_fern", 0.20, "perlin", lifecycle_distribution=GRASS_DIST, variant_count=3),
        pool_entry("hanging_vine", 0.10, "perlin", lifecycle_distribution=BUSH_DIST),
        pool_entry("climbing_vine", 0.08, "perlin", lifecycle_distribution=BUSH_DIST),
        pool_entry("ground_moss", 0.30, "perlin", lifecycle_distribution={"growing": 0.30, "lush": 0.50, "dry": 0.20}),
        pool_entry("hanging_moss", 0.12, "perlin", lifecycle_distribution={"growing": 0.30, "lush": 0.50, "dry": 0.20}),
        pool_entry("tree_moss", 0.15, "perlin", lifecycle_distribution={"growing": 0.30, "lush": 0.50, "dry": 0.20}),
        pool_entry("bracket_fungus", 0.08, "scatter", lifecycle_distribution=MUSHROOM_DIST),
        pool_entry("toadstool", 0.10, "cluster", lifecycle_distribution=MUSHROOM_DIST),
        pool_entry("glowing_mushroom", 0.03, "cluster", lifecycle_distribution=MUSHROOM_DIST, variant_count=2),
        pool_entry("fallen_log", 0.08, "scatter", lifecycle_distribution={"fresh": 0.20, "mossy": 0.50, "rotting": 0.30}),
        pool_entry("mossy_log", 0.05, "scatter", lifecycle_distribution={"fresh": 0.20, "mossy": 0.60, "rotting": 0.20}),
        pool_entry("hollow_log", 0.04, "scatter", lifecycle_distribution={"intact": 0.50, "rotting": 0.50}),
        pool_entry("spider_web", 0.06, "scatter", lifecycle_distribution={"intact": 0.60, "damaged": 0.40}),
        pool_entry("cocoon", 0.02, "scatter", lifecycle_distribution={"forming": 0.30, "mature": 0.50, "empty": 0.20}),
        pool_entry("mossy_boulder", 0.03, "scatter", lifecycle_distribution=ROCK_DIST),
    ],
}

BIOMES["desert"] = {
    "biome_id": "desert",
    "display_name": "Desert",
    "ambient": {"wind": 0.4, "moisture": 0.05, "light_filter": "heat_haze"},
    "object_pools": [
        pool_entry("wind_sand_drift", 0.35, "perlin", lifecycle_distribution=ASH_DIST, variant_count=4),
        pool_entry("dune_ripple", 0.25, "perlin", lifecycle_distribution=ASH_DIST, variant_count=3),
        pool_entry("desert_shrub", 0.05, "scatter", lifecycle_distribution=BUSH_DIST),
        pool_entry("dry_bush", 0.04, "scatter", lifecycle_distribution={"alive": 0.30, "dry": 0.50, "dead": 0.20}),
        pool_entry("dry_grass", 0.06, "scatter", lifecycle_distribution=GRASS_DIST),
        pool_entry("cactus_flower", 0.02, "scatter", lifecycle_distribution=FLOWER_DIST),
        pool_entry("succulent", 0.03, "scatter", lifecycle_distribution=BUSH_DIST),
        pool_entry("sandstone_boulder", 0.03, "scatter", lifecycle_distribution=ROCK_DIST),
        pool_entry("sandstone_slab", 0.04, "scatter", lifecycle_distribution=ROCK_DIST),
        pool_entry("flat_rock", 0.03, "scatter", lifecycle_distribution=ROCK_DIST),
        pool_entry("skull", 0.01, "scatter", lifecycle_distribution={"intact": 0.60, "cracked": 0.40}),
        pool_entry("bone_pile", 0.01, "scatter", lifecycle_distribution={"intact": 0.50, "scattered": 0.50}),
        pool_entry("dead_tree", 0.02, "scatter", lifecycle_distribution={"standing": 0.60, "fallen": 0.40}),
    ],
}

BIOMES["savanna"] = {
    "biome_id": "savanna",
    "display_name": "Savanna",
    "ambient": {"wind": 0.3, "moisture": 0.2},
    "object_pools": [
        pool_entry("tall_grass", 0.35, "perlin", lifecycle_distribution=GRASS_DIST, variant_count=4),
        pool_entry("dry_grass", 0.25, "perlin", lifecycle_distribution=GRASS_DIST, variant_count=3),
        pool_entry("pampas_grass", 0.10, "cluster", lifecycle_distribution=GRASS_DIST),
        pool_entry("dry_bush", 0.06, "scatter", lifecycle_distribution={"alive": 0.30, "dry": 0.50, "dead": 0.20}),
        pool_entry("thorny_bush", 0.04, "scatter", lifecycle_distribution=BUSH_DIST),
        pool_entry("flat_rock", 0.05, "scatter", lifecycle_distribution=ROCK_DIST),
        pool_entry("granite_boulder", 0.02, "scatter", lifecycle_distribution=ROCK_DIST),
        pool_entry("termite_mound", 0.03, "scatter", lifecycle_distribution={"active": 0.70, "abandoned": 0.30}),
        pool_entry("ant_mound", 0.02, "scatter", lifecycle_distribution={"active": 0.70, "dormant": 0.30}),
        pool_entry("bone_pile", 0.01, "scatter", lifecycle_distribution={"intact": 0.50, "scattered": 0.50}),
        pool_entry("dead_tree", 0.03, "scatter", lifecycle_distribution={"standing": 0.60, "fallen": 0.40}),
        pool_entry("poplar_tree", 0.02, "perlin", lifecycle_distribution=TREE_DIST),
    ],
}

BIOMES["steppe"] = {
    "biome_id": "steppe",
    "display_name": "Steppe",
    "ambient": {"wind": 0.45, "moisture": 0.15},
    "object_pools": [
        pool_entry("short_grass", 0.30, "perlin", lifecycle_distribution=GRASS_DIST, variant_count=4),
        pool_entry("dry_grass", 0.25, "perlin", lifecycle_distribution=GRASS_DIST, variant_count=3),
        pool_entry("cracked_earth", 0.15, "perlin", lifecycle_distribution={"fresh": 0.40, "deep": 0.40, "healed": 0.20}),
        pool_entry("flat_rock", 0.08, "scatter", lifecycle_distribution=ROCK_DIST),
        pool_entry("slate_slab", 0.05, "scatter", lifecycle_distribution=ROCK_DIST),
        pool_entry("pebble", 0.10, "scatter", lifecycle_distribution=ROCK_DIST),
        pool_entry("scrub_brush", 0.04, "scatter", lifecycle_distribution=BUSH_DIST),
        pool_entry("gravel_patch", 0.08, "perlin", lifecycle_distribution=ROCK_DIST),
        pool_entry("tundra_shrub", 0.03, "scatter", lifecycle_distribution=BUSH_DIST),
    ],
}

BIOMES["tundra"] = {
    "biome_id": "tundra",
    "display_name": "Tundra",
    "ambient": {"wind": 0.5, "moisture": 0.3, "light_filter": "blue_cold"},
    "object_pools": [
        pool_entry("frozen_grass", 0.20, "perlin", lifecycle_distribution=GRASS_DIST, variant_count=3),
        pool_entry("hardy_moss", 0.15, "perlin", lifecycle_distribution={"growing": 0.40, "lush": 0.40, "frozen": 0.20}),
        pool_entry("lichen_patch", 0.12, "perlin", lifecycle_distribution={"growing": 0.40, "mature": 0.50, "dry": 0.10}),
        pool_entry("tundra_shrub", 0.05, "scatter", lifecycle_distribution=BUSH_DIST),
        pool_entry("ice_patch", 0.10, "perlin", lifecycle_distribution=ICE_DIST),
        pool_entry("permafrost_crack", 0.08, "perlin", lifecycle_distribution={"forming": 0.40, "deep": 0.40, "thawing": 0.20}),
        pool_entry("packed_snow", 0.15, "perlin", lifecycle_distribution=SNOW_DIST),
        pool_entry("fresh_snow", 0.10, "perlin", lifecycle_distribution=SNOW_DIST),
        pool_entry("flat_rock", 0.06, "scatter", lifecycle_distribution=ROCK_DIST),
        pool_entry("pebble", 0.08, "scatter", lifecycle_distribution=ROCK_DIST),
        pool_entry("arctic_poppy", 0.03, "scatter", lifecycle_distribution=FLOWER_DIST),
    ],
}

BIOMES["taiga"] = {
    "biome_id": "taiga",
    "display_name": "Taiga",
    "ambient": {"wind": 0.2, "moisture": 0.5, "light_filter": "pine_filter"},
    "object_pools": [
        pool_entry("pine_tree", 0.30, "perlin", lifecycle_distribution=TREE_DIST, variant_count=4),
        pool_entry("spruce_tree", 0.25, "perlin", lifecycle_distribution=TREE_DIST, variant_count=4),
        pool_entry("fir_tree", 0.10, "perlin", lifecycle_distribution=TREE_DIST, variant_count=3),
        pool_entry("cedar_tree", 0.05, "perlin", lifecycle_distribution=TREE_DIST),
        pool_entry("juniper_tree", 0.04, "perlin", lifecycle_distribution=TREE_DIST),
        pool_entry("pine_needle_bed", 0.25, "perlin", lifecycle_distribution={"fresh": 0.40, "settled": 0.40, "decomposing": 0.20}),
        pool_entry("ground_moss", 0.12, "perlin", lifecycle_distribution={"growing": 0.30, "lush": 0.50, "dry": 0.20}),
        pool_entry("hardy_moss", 0.08, "perlin", lifecycle_distribution={"growing": 0.40, "lush": 0.40, "frozen": 0.20}),
        pool_entry("packed_snow", 0.10, "perlin", lifecycle_distribution=SNOW_DIST),
        pool_entry("fresh_snow", 0.05, "perlin", lifecycle_distribution=SNOW_DIST),
        pool_entry("fallen_log", 0.04, "scatter", lifecycle_distribution={"fresh": 0.20, "mossy": 0.50, "rotting": 0.30}),
        pool_entry("bear_den", 0.01, "scatter", lifecycle_distribution={"active": 0.50, "dormant": 0.30, "empty": 0.20}, variant_count=1),
        pool_entry("mossy_boulder", 0.03, "scatter", lifecycle_distribution=ROCK_DIST),
    ],
}

BIOMES["mountains"] = {
    "biome_id": "mountains",
    "display_name": "Mountains",
    "ambient": {"wind": 0.6, "moisture": 0.3},
    "object_pools": [
        pool_entry("granite_boulder", 0.15, "perlin", lifecycle_distribution=ROCK_DIST, variant_count=4),
        pool_entry("basalt_boulder", 0.08, "scatter", lifecycle_distribution=ROCK_DIST),
        pool_entry("cliff_face", 0.05, "perlin", elevation_range=[0.6, 1.0], lifecycle_distribution=ROCK_DIST),
        pool_entry("rock_overhang", 0.03, "scatter", elevation_range=[0.5, 0.9], lifecycle_distribution=ROCK_DIST),
        pool_entry("scree", 0.15, "perlin", lifecycle_distribution={"loose": 0.50, "settled": 0.50}),
        pool_entry("pebble", 0.10, "scatter", lifecycle_distribution=ROCK_DIST),
        pool_entry("gravel_patch", 0.08, "perlin", lifecycle_distribution=ROCK_DIST),
        pool_entry("hardy_moss", 0.04, "perlin", lifecycle_distribution={"growing": 0.40, "lush": 0.40, "frozen": 0.20}),
        pool_entry("lichen_patch", 0.06, "perlin", lifecycle_distribution={"growing": 0.40, "mature": 0.50, "dry": 0.10}),
        pool_entry("wildflower", 0.03, "scatter", lifecycle_distribution=FLOWER_DIST),
        pool_entry("eagle_nest", 0.01, "scatter", elevation_range=[0.7, 1.0], lifecycle_distribution={"active": 0.60, "empty": 0.40}, variant_count=1),
        pool_entry("cave_entrance", 0.01, "scatter", elevation_range=[0.4, 0.8], lifecycle_distribution={"open": 0.70, "blocked": 0.30}, variant_count=1),
        pool_entry("iron_ore", 0.02, "perlin", elevation_range=[0.4, 0.9], lifecycle_distribution=MINERAL_DIST),
        pool_entry("gold_vein", 0.005, "scatter", elevation_range=[0.5, 1.0], lifecycle_distribution=MINERAL_DIST, variant_count=2),
        pool_entry("gem_deposit", 0.003, "scatter", elevation_range=[0.6, 1.0], lifecycle_distribution=MINERAL_DIST, variant_count=2),
        pool_entry("fresh_snow", 0.10, "perlin", elevation_range=[0.8, 1.0], lifecycle_distribution=SNOW_DIST),
        pool_entry("packed_snow", 0.08, "perlin", elevation_range=[0.7, 1.0], lifecycle_distribution=SNOW_DIST),
    ],
}

BIOMES["swamp"] = {
    "biome_id": "swamp",
    "display_name": "Swamp",
    "ambient": {"wind": 0.1, "moisture": 0.9, "light_filter": "murky_green"},
    "object_pools": [
        pool_entry("reed", 0.20, "perlin", lifecycle_distribution=GRASS_DIST, variant_count=3),
        pool_entry("cattail", 0.15, "water_follow", lifecycle_distribution=GRASS_DIST),
        pool_entry("bulrush", 0.08, "water_follow", lifecycle_distribution=GRASS_DIST),
        pool_entry("hanging_moss", 0.20, "perlin", lifecycle_distribution={"growing": 0.30, "lush": 0.50, "dry": 0.20}),
        pool_entry("algae_film", 0.15, "perlin", lifecycle_distribution={"sparse": 0.30, "dense": 0.50, "blooming": 0.20}),
        pool_entry("freshwater_algae", 0.10, "water_follow", lifecycle_distribution=MUSHROOM_DIST),
        pool_entry("willow_tree", 0.08, "perlin", lifecycle_distribution=TREE_DIST),
        pool_entry("mangrove_tree", 0.05, "water_follow", lifecycle_distribution=TREE_DIST),
        pool_entry("dead_tree", 0.06, "scatter", lifecycle_distribution={"standing": 0.60, "fallen": 0.40}),
        pool_entry("toadstool", 0.10, "cluster", lifecycle_distribution=MUSHROOM_DIST),
        pool_entry("glowing_mushroom", 0.04, "cluster", lifecycle_distribution=MUSHROOM_DIST, variant_count=2),
        pool_entry("puffball", 0.03, "scatter", lifecycle_distribution=MUSHROOM_DIST),
        pool_entry("wet_mud", 0.15, "perlin", lifecycle_distribution={"wet": 0.60, "drying": 0.30, "cracked": 0.10}),
        pool_entry("peat_bog", 0.10, "perlin", lifecycle_distribution={"fresh": 0.40, "settled": 0.40, "ancient": 0.20}),
        pool_entry("standing_water", 0.12, "perlin", lifecycle_distribution=WATER_DIST),
        pool_entry("fallen_log", 0.05, "scatter", lifecycle_distribution={"fresh": 0.20, "mossy": 0.50, "rotting": 0.30}),
        pool_entry("mossy_log", 0.04, "scatter", lifecycle_distribution={"fresh": 0.20, "mossy": 0.60, "rotting": 0.20}),
    ],
}

BIOMES["tropical_forest"] = {
    "biome_id": "tropical_forest",
    "display_name": "Tropical Forest",
    "ambient": {"wind": 0.1, "moisture": 0.9, "light_filter": "tropical_canopy"},
    "object_pools": [
        pool_entry("jungle_tree", 0.25, "perlin", lifecycle_distribution=TREE_DIST, variant_count=4),
        pool_entry("kapok_tree", 0.08, "perlin", lifecycle_distribution=TREE_DIST),
        pool_entry("palm_tree", 0.10, "perlin", lifecycle_distribution=TREE_DIST, variant_count=3),
        pool_entry("banana_tree", 0.06, "cluster", lifecycle_distribution=TREE_DIST),
        pool_entry("tropical_fern", 0.15, "perlin", lifecycle_distribution=GRASS_DIST, variant_count=3),
        pool_entry("giant_fern", 0.08, "perlin", lifecycle_distribution=GRASS_DIST),
        pool_entry("hanging_vine", 0.15, "perlin", lifecycle_distribution=BUSH_DIST),
        pool_entry("climbing_vine", 0.10, "perlin", lifecycle_distribution=BUSH_DIST),
        pool_entry("orchid", 0.06, "scatter", lifecycle_distribution=FLOWER_DIST),
        pool_entry("hibiscus", 0.05, "scatter", lifecycle_distribution=FLOWER_DIST),
        pool_entry("lotus", 0.03, "water_follow", lifecycle_distribution=FLOWER_DIST),
        pool_entry("ground_moss", 0.15, "perlin", lifecycle_distribution={"growing": 0.30, "lush": 0.50, "dry": 0.20}),
        pool_entry("tree_moss", 0.10, "perlin", lifecycle_distribution={"growing": 0.30, "lush": 0.50, "dry": 0.20}),
        pool_entry("wet_leaves", 0.10, "perlin", lifecycle_distribution={"fresh": 0.40, "decomposing": 0.60}),
        pool_entry("cocoon", 0.03, "scatter", lifecycle_distribution={"forming": 0.30, "mature": 0.50, "empty": 0.20}),
        pool_entry("bird_nest", 0.04, "scatter", lifecycle_distribution={"active": 0.50, "empty": 0.50}),
    ],
}

BIOMES["volcanic"] = {
    "biome_id": "volcanic",
    "display_name": "Volcanic",
    "ambient": {"wind": 0.2, "moisture": 0.1, "light_filter": "ember_glow"},
    "object_pools": [
        pool_entry("volcanic_rock", 0.20, "perlin", lifecycle_distribution=ROCK_DIST, variant_count=4),
        pool_entry("lava_rock", 0.15, "perlin", lifecycle_distribution=ROCK_DIST, variant_count=3),
        pool_entry("obsidian_shard", 0.08, "scatter", lifecycle_distribution=ROCK_DIST),
        pool_entry("pumice_stone", 0.06, "scatter", lifecycle_distribution=ROCK_DIST),
        pool_entry("fresh_ash", 0.20, "perlin", lifecycle_distribution=ASH_DIST, variant_count=3),
        pool_entry("old_ash", 0.10, "perlin", lifecycle_distribution=ASH_DIST),
        pool_entry("sulfur_deposit", 0.05, "scatter", lifecycle_distribution=MINERAL_DIST),
        pool_entry("charred_tree", 0.04, "scatter", lifecycle_distribution={"standing": 0.60, "fallen": 0.40}),
        pool_entry("cracked_earth", 0.10, "perlin", lifecycle_distribution={"fresh": 0.40, "deep": 0.40, "healed": 0.20}),
        pool_entry("basalt_boulder", 0.06, "scatter", lifecycle_distribution=ROCK_DIST),
        pool_entry("coal_seam", 0.02, "perlin", lifecycle_distribution=MINERAL_DIST),
    ],
}

BIOMES["arctic"] = {
    "biome_id": "arctic",
    "display_name": "Arctic",
    "ambient": {"wind": 0.7, "moisture": 0.2, "light_filter": "arctic_blue"},
    "object_pools": [
        pool_entry("sheet_ice", 0.25, "perlin", lifecycle_distribution=ICE_DIST, variant_count=4),
        pool_entry("fresh_snow", 0.30, "perlin", lifecycle_distribution=SNOW_DIST, variant_count=4),
        pool_entry("packed_snow", 0.20, "perlin", lifecycle_distribution=SNOW_DIST, variant_count=3),
        pool_entry("melting_snow", 0.05, "perlin", lifecycle_distribution=SNOW_DIST),
        pool_entry("frost_pattern", 0.10, "perlin", lifecycle_distribution={"forming": 0.40, "set": 0.50, "thawing": 0.10}),
        pool_entry("icicle", 0.05, "scatter", lifecycle_distribution={"forming": 0.30, "mature": 0.50, "melting": 0.20}),
        pool_entry("ice_patch", 0.12, "perlin", lifecycle_distribution=ICE_DIST),
        pool_entry("crystal_cluster", 0.02, "scatter", lifecycle_distribution=MINERAL_DIST, variant_count=2),
        pool_entry("amethyst_geode", 0.01, "scatter", lifecycle_distribution=MINERAL_DIST, variant_count=1),
    ],
}

BIOMES["lake"] = {
    "biome_id": "lake",
    "display_name": "Lake",
    "ambient": {"wind": 0.2, "moisture": 0.95},
    "object_pools": [
        pool_entry("lake_ripple", 0.60, "perlin", lifecycle_distribution=WATER_DIST, variant_count=4),
        pool_entry("reed", 0.10, "edge_follow", lifecycle_distribution=GRASS_DIST),
        pool_entry("cattail", 0.06, "edge_follow", lifecycle_distribution=GRASS_DIST),
        pool_entry("river_stone", 0.08, "scatter", lifecycle_distribution=ROCK_DIST),
        pool_entry("pebble", 0.10, "scatter", lifecycle_distribution=ROCK_DIST),
        pool_entry("freshwater_algae", 0.05, "perlin", lifecycle_distribution=MUSHROOM_DIST),
        pool_entry("lotus", 0.03, "perlin", lifecycle_distribution=FLOWER_DIST),
        pool_entry("standing_water", 0.10, "perlin", lifecycle_distribution=WATER_DIST),
        pool_entry("fallen_log", 0.02, "scatter", lifecycle_distribution={"fresh": 0.20, "mossy": 0.50, "rotting": 0.30}),
    ],
}

BIOMES["river"] = {
    "biome_id": "river",
    "display_name": "River",
    "ambient": {"wind": 0.15, "moisture": 1.0},
    "object_pools": [
        pool_entry("river_current", 0.70, "perlin", lifecycle_distribution=WATER_DIST, variant_count=4),
        pool_entry("river_stone", 0.10, "scatter", lifecycle_distribution=ROCK_DIST),
        pool_entry("river_weed", 0.08, "perlin", lifecycle_distribution=GRASS_DIST),
        pool_entry("reed", 0.06, "edge_follow", lifecycle_distribution=GRASS_DIST),
        pool_entry("rapid_foam", 0.05, "perlin", lifecycle_distribution=WATER_DIST),
        pool_entry("driftwood", 0.03, "scatter", lifecycle_distribution={"fresh": 0.30, "weathered": 0.50, "bleached": 0.20}),
        pool_entry("pebble", 0.08, "scatter", lifecycle_distribution=ROCK_DIST),
    ],
}

BIOMES["mystic"] = {
    "biome_id": "mystic",
    "display_name": "Mystic",
    "ambient": {"wind": 0.1, "moisture": 0.5, "light_filter": "mystic_glow"},
    "object_pools": [
        pool_entry("mystic_crystal", 0.15, "perlin", lifecycle_distribution={"dormant": 0.30, "pulsing": 0.50, "active": 0.20}, variant_count=3),
        pool_entry("crystal_cluster", 0.10, "cluster", lifecycle_distribution=MINERAL_DIST, variant_count=3),
        pool_entry("quartz_formation", 0.05, "scatter", lifecycle_distribution=MINERAL_DIST),
        pool_entry("runic_stone", 0.04, "scatter", lifecycle_distribution={"intact": 0.60, "weathered": 0.30, "crumbled": 0.10}, variant_count=2),
        pool_entry("glowing_mushroom", 0.12, "cluster", lifecycle_distribution=MUSHROOM_DIST, variant_count=3),
        pool_entry("spirit_wisp", 0.08, "perlin", lifecycle_distribution={"flickering": 0.40, "bright": 0.40, "fading": 0.20}, variant_count=2),
        pool_entry("arcane_flower", 0.06, "scatter", lifecycle_distribution=FLOWER_DIST),
        pool_entry("ethereal_vine", 0.08, "perlin", lifecycle_distribution=BUSH_DIST),
        pool_entry("ground_moss", 0.10, "perlin", lifecycle_distribution={"growing": 0.30, "lush": 0.50, "dry": 0.20}),
        pool_entry("mist_pool", 0.05, "perlin", lifecycle_distribution=WATER_DIST),
    ],
}

# ---------------------------------------------------------------------------
# Transition definitions
# ---------------------------------------------------------------------------

def transition(biome_a, biome_b, blend_width, edge_objects, gradient_a="linear_fadeout", gradient_b="linear_fadein"):
    return {
        "biome_a": biome_a,
        "biome_b": biome_b,
        "blend_width": blend_width,
        "edge_objects": edge_objects,
        "gradient": {
            "biome_a_objects": gradient_a,
            "biome_b_objects": gradient_b,
        },
    }


def eo(object_id, density):
    return {"object_id": object_id, "density": density}


TRANSITIONS = [
    # Beach transitions
    transition("beach", "ocean", 3,
        [eo("shore_foam", 0.40), eo("shell_scatter", 0.15), eo("tidal_pool", 0.08)]),
    transition("beach", "grassland", 4,
        [eo("sea_grass", 0.20), eo("driftwood", 0.10), eo("pebble", 0.12), eo("wildflower", 0.08)]),
    transition("beach", "tropical_forest", 3,
        [eo("coconut_palm", 0.10), eo("sea_grass", 0.15), eo("hibiscus", 0.06), eo("climbing_vine", 0.05)]),

    # Grassland transitions
    transition("grassland", "forest", 4,
        [eo("flowering_bush", 0.15), eo("berry_bush", 0.10), eo("tall_grass", 0.20), eo("wildflower", 0.08)]),
    transition("grassland", "savanna", 5,
        [eo("dry_grass", 0.25), eo("pampas_grass", 0.12), eo("flat_rock", 0.06)],
        "noise_blend", "noise_blend"),
    transition("grassland", "steppe", 5,
        [eo("short_grass", 0.25), eo("dry_grass", 0.15), eo("scrub_brush", 0.08), eo("pebble", 0.10)],
        "linear_fadeout", "linear_fadein"),
    transition("grassland", "lake", 3,
        [eo("reed", 0.20), eo("cattail", 0.12), eo("standing_water", 0.08), eo("wildflower", 0.06)]),
    transition("grassland", "river", 2,
        [eo("reed", 0.15), eo("pebble", 0.12), eo("river_weed", 0.08)]),
    transition("grassland", "mystic", 4,
        [eo("glowing_mushroom", 0.06), eo("wildflower", 0.12), eo("spirit_wisp", 0.04), eo("ground_moss", 0.10)]),

    # Forest transitions
    transition("forest", "dense_forest", 3,
        [eo("hanging_vine", 0.12), eo("ground_moss", 0.18), eo("toadstool", 0.08), eo("climbing_vine", 0.10)]),
    transition("forest", "swamp", 4,
        [eo("standing_water", 0.15), eo("hanging_moss", 0.12), eo("toadstool", 0.08), eo("reed", 0.10)]),
    transition("forest", "mountains", 4,
        [eo("mossy_boulder", 0.12), eo("lichen_patch", 0.10), eo("scree", 0.08), eo("hardy_moss", 0.08)]),
    transition("forest", "taiga", 4,
        [eo("pine_tree", 0.10), eo("spruce_tree", 0.08), eo("ground_moss", 0.15), eo("pine_needle_bed", 0.12)],
        "noise_blend", "noise_blend"),
    transition("forest", "lake", 3,
        [eo("reed", 0.18), eo("willow_tree", 0.06), eo("standing_water", 0.10), eo("mossy_boulder", 0.06)]),
    transition("forest", "river", 2,
        [eo("reed", 0.15), eo("willow_tree", 0.08), eo("river_weed", 0.06)]),
    transition("forest", "mystic", 4,
        [eo("glowing_mushroom", 0.08), eo("ethereal_vine", 0.06), eo("spirit_wisp", 0.04), eo("climbing_vine", 0.10)]),

    # Dry biome transitions
    transition("savanna", "desert", 5,
        [eo("dry_grass", 0.20), eo("dry_bush", 0.08), eo("sandstone_boulder", 0.04), eo("wind_sand_drift", 0.12)]),
    transition("steppe", "desert", 4,
        [eo("cracked_earth", 0.15), eo("dry_grass", 0.12), eo("sandstone_slab", 0.06), eo("pebble", 0.10)]),
    transition("steppe", "tundra", 4,
        [eo("hardy_moss", 0.10), eo("frozen_grass", 0.12), eo("permafrost_crack", 0.06), eo("pebble", 0.10)]),

    # Cold transitions
    transition("tundra", "arctic", 3,
        [eo("packed_snow", 0.20), eo("ice_patch", 0.15), eo("frozen_grass", 0.08), eo("permafrost_crack", 0.08)]),
    transition("tundra", "taiga", 4,
        [eo("hardy_moss", 0.12), eo("frozen_grass", 0.10), eo("pine_tree", 0.06), eo("packed_snow", 0.10)],
        "noise_blend", "noise_blend"),

    # Mountain transitions
    transition("taiga", "mountains", 3,
        [eo("mossy_boulder", 0.10), eo("scree", 0.12), eo("lichen_patch", 0.08), eo("packed_snow", 0.08)]),
    transition("mountains", "arctic", 3,
        [eo("sheet_ice", 0.15), eo("packed_snow", 0.20), eo("granite_boulder", 0.08), eo("scree", 0.10)]),
    transition("mountains", "volcanic", 3,
        [eo("basalt_boulder", 0.12), eo("volcanic_rock", 0.10), eo("lava_rock", 0.08), eo("scree", 0.08)]),

    # Wet/tropical transitions
    transition("swamp", "tropical_forest", 4,
        [eo("mangrove_tree", 0.08), eo("hanging_moss", 0.15), eo("standing_water", 0.10), eo("giant_fern", 0.10)],
        "noise_blend", "noise_blend"),
    transition("dense_forest", "swamp", 4,
        [eo("mossy_log", 0.08), eo("toadstool", 0.10), eo("wet_mud", 0.12), eo("hanging_moss", 0.12)],
        "noise_blend", "noise_blend"),

    # Desert volcano
    transition("desert", "volcanic", 3,
        [eo("volcanic_rock", 0.10), eo("basalt_boulder", 0.06), eo("fresh_ash", 0.08), eo("cracked_earth", 0.12)]),
    transition("desert", "mountains", 3,
        [eo("sandstone_boulder", 0.10), eo("scree", 0.12), eo("flat_rock", 0.08), eo("pebble", 0.10)]),

    # Ocean/water transitions
    transition("tropical_forest", "ocean", 2,
        [eo("shore_foam", 0.20), eo("sea_grass", 0.12), eo("coconut_palm", 0.05), eo("shell_scatter", 0.08)]),
    transition("lake", "river", 2,
        [eo("reed", 0.15), eo("river_stone", 0.12), eo("pebble", 0.10)],
        "noise_blend", "noise_blend"),
]


# ---------------------------------------------------------------------------
# Write files
# ---------------------------------------------------------------------------

def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def main():
    affinity_count = 0
    transition_count = 0
    errors = []

    print("=== Writing biome affinity files ===")
    for biome_id, data in BIOMES.items():
        path = os.path.join(AFFINITIES_DIR, f"{biome_id}.json")
        write_json(path, data)
        pool_size = len(data.get("object_pools", []))
        print(f"  {biome_id}.json  ({pool_size} pool entries)")
        affinity_count += 1

    print(f"\n=== Writing biome transition files ===")
    for t in TRANSITIONS:
        biome_a = t["biome_a"]
        biome_b = t["biome_b"]
        filename = f"{biome_a}_{biome_b}.json"
        path = os.path.join(TRANSITIONS_DIR, filename)
        write_json(path, t)
        edge_size = len(t.get("edge_objects", []))
        print(f"  {filename}  ({edge_size} edge objects)")
        transition_count += 1

    print(f"\n=== Summary ===")
    print(f"  Affinity files:   {affinity_count} / 18")
    print(f"  Transition files: {transition_count} / ~30")

    if affinity_count != 18:
        errors.append(f"Expected 18 affinity files, got {affinity_count}")

    # Verify all files exist and parse
    af_files = [f for f in os.listdir(AFFINITIES_DIR) if f.endswith(".json")]
    tr_files = [f for f in os.listdir(TRANSITIONS_DIR) if f.endswith(".json")]
    print(f"\n  Affinity dir has {len(af_files)} files")
    print(f"  Transition dir has {len(tr_files)} files")

    for fpath in [os.path.join(AFFINITIES_DIR, f) for f in af_files] + \
                 [os.path.join(TRANSITIONS_DIR, f) for f in tr_files]:
        try:
            with open(fpath, encoding="utf-8") as f:
                json.load(f)
        except Exception as e:
            errors.append(f"Parse error {fpath}: {e}")

    if errors:
        print("\n  ERRORS:")
        for e in errors:
            print(f"    {e}")
        sys.exit(1)
    else:
        print("\n  All files valid JSON. Done.")


if __name__ == "__main__":
    main()
