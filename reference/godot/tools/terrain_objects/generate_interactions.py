"""
generate_interactions.py
Generates ~35 terrain object interaction JSON files from an embedded data table.
Output: data/terrain_objects/interactions/{category}/{id}.json

Run from the project root:
    python tools/terrain_objects/generate_interactions.py
"""

import json
import pathlib

# ---------------------------------------------------------------------------
# Root paths
# ---------------------------------------------------------------------------
REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT_ROOT = REPO_ROOT / "data" / "terrain_objects" / "interactions"


# ---------------------------------------------------------------------------
# Interaction table
# Every entry produces one JSON file.  Keys map directly to the
# interaction_schema.json structure.
# ---------------------------------------------------------------------------
INTERACTIONS = [

    # -----------------------------------------------------------------------
    # TRAVERSAL (6)
    # -----------------------------------------------------------------------
    {
        "id": "walk_through",
        "category": "traversal",
        "trigger": {
            "type": "entity_action",
            "requires_target": {"blocking": False},
        },
        "animation": {
            "frames": [2, 4],
            "duration_ms": [200, 400],
            "loop": False,
            "directional": True,
            "blend_mode": "overlay",
        },
        "effects": {
            "particle": "grass_rustle",
            "sound": "rustle_soft",
        },
    },
    {
        "id": "run_through",
        "category": "traversal",
        "trigger": {
            "type": "entity_action",
            "requires_target": {"blocking": False},
        },
        "animation": {
            "frames": [2, 3],
            "duration_ms": [100, 200],
            "loop": False,
            "directional": True,
            "blend_mode": "overlay",
        },
        "effects": {
            "particle": "grass_rustle_fast",
            "sound": "rustle_fast",
        },
    },
    {
        "id": "swim_past",
        "category": "traversal",
        "trigger": {
            "type": "entity_action",
            "requires_target": {"blocking": False},
        },
        "animation": {
            "frames": [4, 6],
            "duration_ms": [400, 700],
            "loop": False,
            "directional": True,
            "blend_mode": "overlay",
        },
        "effects": {
            "particle": "water_ripple",
            "sound": "water_splash_soft",
        },
    },
    {
        "id": "fly_over",
        "category": "traversal",
        "trigger": {
            "type": "entity_action",
        },
        "animation": {
            "frames": [1, 2],
            "duration_ms": [100, 200],
            "loop": False,
            "directional": True,
            "blend_mode": "overlay",
        },
    },
    {
        "id": "land_on",
        "category": "traversal",
        "trigger": {
            "type": "entity_action",
            "requires_target": {"blocking": False},
        },
        "animation": {
            "frames": [2, 4],
            "duration_ms": [150, 300],
            "loop": False,
            "directional": False,
            "blend_mode": "overlay",
        },
        "effects": {
            "particle": "dust_puff",
            "sound": "land_soft",
        },
    },
    {
        "id": "push_aside",
        "category": "traversal",
        "trigger": {
            "type": "entity_action",
            "requires_target": {"blocking": False},
        },
        "animation": {
            "frames": [3, 5],
            "duration_ms": [200, 350],
            "loop": False,
            "directional": True,
            "blend_mode": "overlay",
        },
        "effects": {
            "particle": "leaf_scatter",
            "sound": "rustle_medium",
        },
    },

    # -----------------------------------------------------------------------
    # PLAYER_ACTION (9)
    # -----------------------------------------------------------------------
    {
        "id": "chop",
        "category": "player_action",
        "trigger": {
            "type": "entity_action",
            "requires_tool": "axe",
            "requires_target": {
                "ontology": "animate",
                "category_prefix": "vegetation",
                "min_phase": "sapling",
            },
        },
        "animation": {
            "frames": [4, 6],
            "duration_ms": [400, 600],
            "loop": False,
            "directional": True,
            "blend_mode": "replace",
        },
        "effects": {
            "damage": {"amount": 25, "type": "sharp"},
            "particle": "wood_chips",
            "sound": "chop_wood",
        },
    },
    {
        "id": "mine",
        "category": "player_action",
        "trigger": {
            "type": "entity_action",
            "requires_tool": "pickaxe",
            "requires_target": {
                "ontology": "inanimate",
                "category_prefix": "mineral",
            },
        },
        "animation": {
            "frames": [4, 6],
            "duration_ms": [500, 700],
            "loop": False,
            "directional": True,
            "blend_mode": "replace",
        },
        "effects": {
            "damage": {"amount": 20, "type": "blunt"},
            "particle": "rock_chips",
            "sound": "mine_rock",
        },
    },
    {
        "id": "dig",
        "category": "player_action",
        "trigger": {
            "type": "entity_action",
            "requires_tool": "shovel",
            "requires_target": {
                "ontology": "inanimate",
                "category_prefix": "ground",
            },
        },
        "animation": {
            "frames": [5, 7],
            "duration_ms": [500, 800],
            "loop": False,
            "directional": True,
            "blend_mode": "replace",
        },
        "effects": {
            "damage": {"amount": 10, "type": "blunt"},
            "particle": "dirt_scatter",
            "sound": "dig_earth",
            "state_transition": "disturbed",
        },
    },
    {
        "id": "pick",
        "category": "player_action",
        "trigger": {
            "type": "entity_action",
            "requires_target": {
                "ontology": "animate",
                "category_prefix": "vegetation",
                "min_phase": "fruit",
            },
        },
        "animation": {
            "frames": [3, 4],
            "duration_ms": [250, 400],
            "loop": False,
            "directional": True,
            "blend_mode": "replace",
        },
        "effects": {
            "particle": "leaf_burst",
            "sound": "pick_fruit",
            "state_transition": "harvested",
        },
    },
    {
        "id": "burn_ignite",
        "category": "player_action",
        "trigger": {
            "type": "entity_action",
            "requires_tool": "torch",
        },
        "animation": {
            "frames": [6, 10],
            "duration_ms": [600, 1200],
            "loop": True,
            "directional": False,
            "blend_mode": "additive",
        },
        "effects": {
            "damage": {"amount": [5, 15], "type": "fire"},
            "particle": "fire_medium",
            "sound": "fire_crackle",
            "state_transition": "burning",
        },
    },
    {
        "id": "freeze_cast",
        "category": "player_action",
        "trigger": {
            "type": "entity_action",
        },
        "animation": {
            "frames": [4, 6],
            "duration_ms": [400, 600],
            "loop": False,
            "directional": False,
            "blend_mode": "overlay",
        },
        "effects": {
            "damage": {"amount": [8, 20], "type": "cold"},
            "particle": "ice_shards",
            "sound": "freeze_crack",
            "state_transition": "frozen",
        },
    },
    {
        "id": "plant",
        "category": "player_action",
        "trigger": {
            "type": "entity_action",
            "requires_target": {
                "ontology": "inanimate",
                "category_prefix": "ground",
            },
        },
        "animation": {
            "frames": [3, 5],
            "duration_ms": [400, 600],
            "loop": False,
            "directional": True,
            "blend_mode": "replace",
        },
        "effects": {
            "particle": "dirt_scatter",
            "sound": "dig_earth",
            "state_transition": "seeded",
        },
    },
    {
        "id": "water_plant",
        "category": "player_action",
        "trigger": {
            "type": "entity_action",
            "requires_tool": "watering_can",
            "requires_target": {
                "ontology": "animate",
                "category_prefix": "vegetation",
            },
        },
        "animation": {
            "frames": [4, 6],
            "duration_ms": [350, 550],
            "loop": False,
            "directional": True,
            "blend_mode": "overlay",
        },
        "effects": {
            "particle": "water_droplets",
            "sound": "pour_water",
        },
    },
    {
        "id": "climb",
        "category": "player_action",
        "trigger": {
            "type": "entity_action",
            "requires_target": {
                "ontology": "animate",
                "category_prefix": "vegetation/tree",
                "min_phase": "mature",
            },
        },
        "animation": {
            "frames": [6, 10],
            "duration_ms": [800, 1400],
            "loop": False,
            "directional": True,
            "blend_mode": "replace",
        },
        "effects": {
            "sound": "climb_wood",
        },
    },

    # -----------------------------------------------------------------------
    # ENVIRONMENTAL (6)
    # -----------------------------------------------------------------------
    {
        "id": "wind",
        "category": "environmental",
        "trigger": {
            "type": "environmental",
            "weather_field": "wind_speed",
            "threshold": 0.1,
        },
        "animation": {
            "frames": [4, 8],
            "duration_ms": [400, 1200],
            "loop": True,
            "intensity_variable": True,
            "blend_mode": "overlay",
            "can_composite_with": ["rain", "idle"],
        },
    },
    {
        "id": "rain",
        "category": "environmental",
        "trigger": {
            "type": "environmental",
            "weather_field": "precipitation",
            "threshold": 0.1,
        },
        "animation": {
            "frames": [3, 5],
            "duration_ms": [300, 600],
            "loop": True,
            "intensity_variable": True,
            "blend_mode": "overlay",
            "can_composite_with": ["wind", "idle"],
        },
        "effects": {
            "particle": "rain_drip",
            "sound": "rain_on_leaves",
        },
    },
    {
        "id": "lightning_strike",
        "category": "environmental",
        "trigger": {
            "type": "environmental",
            "weather_field": "lightning",
            "threshold": 0.8,
        },
        "animation": {
            "frames": [4, 6],
            "duration_ms": [100, 200],
            "loop": False,
            "blend_mode": "additive",
        },
        "effects": {
            "damage": {"amount": [40, 80], "type": "lightning"},
            "particle": "lightning_flash",
            "sound": "thunder_crack",
            "state_transition": "scorched",
        },
    },
    {
        "id": "flood",
        "category": "environmental",
        "trigger": {
            "type": "environmental",
            "weather_field": "water_level",
            "threshold": 0.6,
        },
        "animation": {
            "frames": [4, 8],
            "duration_ms": [800, 2000],
            "loop": True,
            "intensity_variable": True,
            "blend_mode": "overlay",
        },
        "effects": {
            "particle": "water_surge",
            "sound": "water_rushing",
            "state_transition": "submerged",
        },
    },
    {
        "id": "fire_spread",
        "category": "environmental",
        "trigger": {
            "type": "environmental",
            "weather_field": "fire_proximity",
            "threshold": 1.0,
        },
        "animation": {
            "frames": [6, 10],
            "duration_ms": [600, 1000],
            "loop": True,
            "intensity_variable": True,
            "blend_mode": "additive",
        },
        "effects": {
            "damage": {"amount": [3, 8], "type": "fire"},
            "particle": "fire_large",
            "sound": "fire_roar",
            "state_transition": "burning",
        },
    },
    {
        "id": "erosion",
        "category": "environmental",
        "trigger": {
            "type": "environmental",
            "weather_field": "erosion_index",
            "threshold": 0.3,
        },
        "animation": {
            "frames": [2, 4],
            "duration_ms": [1000, 3000],
            "loop": True,
            "intensity_variable": True,
            "blend_mode": "overlay",
        },
        "effects": {
            "damage": {"amount": [1, 3], "type": "blunt"},
            "particle": "dirt_trickle",
        },
    },

    # -----------------------------------------------------------------------
    # AMBIENT (5)
    # -----------------------------------------------------------------------
    {
        "id": "idle",
        "category": "ambient",
        "trigger": {
            "type": "always",
        },
        "animation": {
            "frames": [4, 8],
            "duration_ms": [600, 1200],
            "loop": True,
            "blend_mode": "replace",
        },
    },
    {
        "id": "idle_variant",
        "category": "ambient",
        "trigger": {
            "type": "timer",
        },
        "animation": {
            "frames": [3, 6],
            "duration_ms": [300, 800],
            "loop": False,
            "blend_mode": "replace",
        },
    },
    {
        "id": "day_shift",
        "category": "ambient",
        "trigger": {
            "type": "time_of_day",
        },
        "animation": {
            "frames": [4, 6],
            "duration_ms": [1000, 2000],
            "loop": False,
            "blend_mode": "overlay",
        },
    },
    {
        "id": "night_shift",
        "category": "ambient",
        "trigger": {
            "type": "time_of_day",
        },
        "animation": {
            "frames": [4, 6],
            "duration_ms": [1000, 2000],
            "loop": False,
            "blend_mode": "overlay",
        },
    },
    {
        "id": "seasonal_change",
        "category": "ambient",
        "trigger": {
            "type": "season",
        },
        "animation": {
            "frames": [6, 12],
            "duration_ms": [2000, 4000],
            "loop": False,
            "blend_mode": "replace",
        },
        "effects": {
            "particle": "leaf_fall",
            "sound": "leaves_rustle",
        },
    },

    # -----------------------------------------------------------------------
    # STATE_REACTIVE (9)
    # -----------------------------------------------------------------------
    {
        "id": "crack",
        "category": "state_reactive",
        "trigger": {
            "type": "state_change",
        },
        "animation": {
            "frames": [3, 5],
            "duration_ms": [200, 400],
            "loop": False,
            "blend_mode": "overlay",
        },
        "effects": {
            "particle": "rock_chips",
            "sound": "crack_stone",
            "state_transition": "cracked",
        },
    },
    {
        "id": "wilt",
        "category": "state_reactive",
        "trigger": {
            "type": "state_change",
        },
        "animation": {
            "frames": [4, 8],
            "duration_ms": [800, 2000],
            "loop": False,
            "blend_mode": "replace",
        },
        "effects": {
            "particle": "leaf_droop",
            "state_transition": "wilted",
        },
    },
    {
        "id": "bloom",
        "category": "state_reactive",
        "trigger": {
            "type": "state_change",
        },
        "animation": {
            "frames": [6, 10],
            "duration_ms": [1000, 2000],
            "loop": False,
            "blend_mode": "overlay",
        },
        "effects": {
            "particle": "petal_burst",
            "sound": "bloom_soft",
            "state_transition": "flowering",
        },
    },
    {
        "id": "fruit",
        "category": "state_reactive",
        "trigger": {
            "type": "state_change",
        },
        "animation": {
            "frames": [4, 6],
            "duration_ms": [800, 1500],
            "loop": False,
            "blend_mode": "overlay",
        },
        "effects": {
            "state_transition": "fruiting",
        },
    },
    {
        "id": "regrow",
        "category": "state_reactive",
        "trigger": {
            "type": "timer",
        },
        "animation": {
            "frames": [6, 12],
            "duration_ms": [2000, 5000],
            "loop": False,
            "blend_mode": "replace",
        },
        "effects": {
            "particle": "sprout_burst",
            "sound": "grow_soft",
            "state_transition": "sapling",
        },
    },
    {
        "id": "collapse",
        "category": "state_reactive",
        "trigger": {
            "type": "state_change",
        },
        "animation": {
            "frames": [8, 12],
            "duration_ms": [400, 800],
            "loop": False,
            "directional": True,
            "blend_mode": "replace",
        },
        "effects": {
            "damage": {"amount": [10, 30], "type": "blunt"},
            "particle": "debris_shower",
            "sound": "collapse_heavy",
            "state_transition": "rubble",
        },
    },
    {
        "id": "decompose",
        "category": "state_reactive",
        "trigger": {
            "type": "timer",
        },
        "animation": {
            "frames": [4, 8],
            "duration_ms": [3000, 8000],
            "loop": True,
            "blend_mode": "overlay",
        },
        "effects": {
            "particle": "decay_mist",
            "state_transition": "decomposed",
        },
    },
    {
        "id": "fungal_growth",
        "category": "state_reactive",
        "trigger": {
            "type": "timer",
        },
        "animation": {
            "frames": [4, 8],
            "duration_ms": [2000, 6000],
            "loop": False,
            "blend_mode": "overlay",
        },
        "effects": {
            "particle": "spore_cloud",
            "state_transition": "fungal",
        },
    },
    {
        "id": "insect_swarm",
        "category": "state_reactive",
        "trigger": {
            "type": "proximity",
            "threshold": 2.0,
        },
        "animation": {
            "frames": [6, 10],
            "duration_ms": [600, 1000],
            "loop": True,
            "blend_mode": "overlay",
        },
        "effects": {
            "damage": {"amount": [1, 3], "type": "pierce"},
            "particle": "insect_swarm",
            "sound": "buzzing",
        },
    },

    # -----------------------------------------------------------------------
    # BIOME_BLENDING (3)
    # -----------------------------------------------------------------------
    {
        "id": "edge_fade",
        "category": "biome_blending",
        "trigger": {
            "type": "always",
        },
        "animation": {
            "frames": [1, 1],
            "duration_ms": [0, 0],
            "loop": True,
            "blend_mode": "overlay",
        },
    },
    {
        "id": "submersion",
        "category": "biome_blending",
        "trigger": {
            "type": "environmental",
            "weather_field": "water_level",
            "threshold": 0.2,
        },
        "animation": {
            "frames": [4, 8],
            "duration_ms": [600, 1200],
            "loop": True,
            "intensity_variable": True,
            "blend_mode": "overlay",
        },
        "effects": {
            "particle": "water_shimmer",
        },
    },
    {
        "id": "overgrowth",
        "category": "biome_blending",
        "trigger": {
            "type": "timer",
        },
        "animation": {
            "frames": [4, 8],
            "duration_ms": [4000, 10000],
            "loop": False,
            "blend_mode": "overlay",
        },
        "effects": {
            "particle": "vine_creep",
            "state_transition": "overgrown",
        },
    },
]


# ---------------------------------------------------------------------------
# Write files
# ---------------------------------------------------------------------------
def main():
    written = 0
    category_counts = {}

    for interaction in INTERACTIONS:
        cat = interaction["category"]
        iid = interaction["id"]
        out_dir = OUT_ROOT / cat
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"{iid}.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(interaction, f, indent=2)
            f.write("\n")
        category_counts[cat] = category_counts.get(cat, 0) + 1
        written += 1

    print(f"Generated {written} interaction files:")
    for cat, count in sorted(category_counts.items()):
        print(f"  {cat}: {count}")


if __name__ == "__main__":
    main()
