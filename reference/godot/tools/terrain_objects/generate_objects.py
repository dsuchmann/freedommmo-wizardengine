#!/usr/bin/env python3
"""
Generate ~180+ terrain object definition JSON files.
Output: data/terrain_objects/objects/{category_path}/{id}.json
"""

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_BASE = ROOT / "data" / "terrain_objects" / "objects"

PIXEL_SIZE = 32
TOTAL_WRITTEN = 0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def write_object(category_path: str, obj: dict):
    global TOTAL_WRITTEN
    parts = category_path.split("/")
    out_dir = OUT_BASE
    for p in parts:
        out_dir = out_dir / p
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{obj['id']}.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2)
    TOTAL_WRITTEN += 1


def _tree_phases(id: str) -> list:
    return [
        {
            "phase": "seedling",
            "duration_days": 14,
            "size": [1, 1],
            "sprite_set": f"{id}/seedling",
            "phase_interactions": ["idle", "walk_through", "wind", "rain", "regrow"]
        },
        {
            "phase": "sapling",
            "duration_days": 60,
            "size": [1, 1],
            "sprite_set": f"{id}/sapling",
            "phase_interactions": ["idle", "push_aside", "wind", "rain", "chop", "regrow"]
        },
        {
            "phase": "juvenile",
            "duration_days": 180,
            "size": [1, 2],
            "sprite_set": f"{id}/juvenile",
            "phase_interactions": ["idle", "wind", "rain", "chop", "climb", "regrow"]
        },
        {
            "phase": "mature",
            "duration_days": 730,
            "size": None,  # filled by caller
            "sprite_set": f"{id}/mature",
            "phase_interactions": [
                "idle", "idle_variant", "wind", "rain", "chop",
                "burn_ignite", "climb", "lightning_strike", "insect_swarm", "fruit"
            ]
        },
        {
            "phase": "old_growth",
            "duration_days": 1825,
            "size": None,
            "sprite_set": f"{id}/old_growth",
            "phase_interactions": [
                "idle", "idle_variant", "wind", "rain", "chop",
                "burn_ignite", "climb", "lightning_strike", "insect_swarm",
                "fungal_growth", "fruit"
            ]
        },
        {
            "phase": "dying",
            "duration_days": 180,
            "size": None,
            "sprite_set": f"{id}/dying",
            "phase_interactions": [
                "idle", "wind", "chop", "burn_ignite",
                "lightning_strike", "insect_swarm", "fungal_growth", "wilt"
            ]
        },
        {
            "phase": "dead",
            "duration_days": 365,
            "size": None,
            "sprite_set": f"{id}/dead",
            "phase_interactions": [
                "idle", "wind", "chop", "burn_ignite",
                "collapse", "fungal_growth", "decompose"
            ]
        },
        {
            "phase": "decomposing",
            "duration_days": 730,
            "size": [1, 1],
            "sprite_set": f"{id}/decomposing",
            "phase_interactions": ["idle", "dig", "fungal_growth", "decompose", "overgrowth"]
        },
    ]


def tree(id: str, category: str, size: list = None, override_phases: dict = None) -> dict:
    if size is None:
        size = [2, 3]
    phases = _tree_phases(id)
    for ph in phases:
        if ph["size"] is None:
            ph["size"] = size
    if override_phases:
        for ph in phases:
            if ph["phase"] in override_phases:
                ph.update(override_phases[ph["phase"]])
    return {
        "id": id,
        "category": category,
        "ontology": "animate",
        "blocking": True,
        "pixel_size": PIXEL_SIZE,
        "anchor": "bottom_center",
        "size": size,
        "lifecycle": {
            "phases": phases
        },
        "variance": {
            "branching_seed": {"type": "int", "range": [0, 9999]},
            "leaf_density": {"type": "float", "range": [0.4, 1.0]},
            "lean_angle": {"type": "float", "range": [-8.0, 8.0]},
            "color_shift": {"type": "float", "range": [-0.1, 0.1]},
            "scale_variance": {"type": "float", "range": [0.85, 1.15]}
        },
        "break_products": {
            "on_chop": [
                {"id": f"{id}_stump", "count": 1},
                {"id": "log", "count": [2, 4]},
                {"id": "branch", "count": [3, 6]},
                {"id": "leaf_pile", "count": [1, 3]}
            ],
            "on_burn": [
                {"id": "charred_trunk", "count": 1},
                {"id": "ash_pile", "count": [2, 4]}
            ]
        }
    }


def bush(id: str, category: str, size: list = None) -> dict:
    if size is None:
        size = [1, 1]
    phases = [
        {
            "phase": "seedling",
            "duration_days": 7,
            "size": [1, 1],
            "sprite_set": f"{id}/seedling",
            "phase_interactions": ["idle", "walk_through", "wind", "rain", "regrow"]
        },
        {
            "phase": "growing",
            "duration_days": 30,
            "size": size,
            "sprite_set": f"{id}/growing",
            "phase_interactions": ["idle", "push_aside", "wind", "rain", "regrow"]
        },
        {
            "phase": "mature",
            "duration_days": 365,
            "size": size,
            "sprite_set": f"{id}/mature",
            "phase_interactions": [
                "idle", "idle_variant", "wind", "rain",
                "chop", "burn_ignite", "pick", "fruit", "insect_swarm"
            ]
        },
        {
            "phase": "flowering",
            "duration_days": 30,
            "size": size,
            "sprite_set": f"{id}/flowering",
            "phase_interactions": [
                "idle", "idle_variant", "wind", "rain",
                "chop", "burn_ignite", "pick", "bloom"
            ]
        },
        {
            "phase": "dying",
            "duration_days": 60,
            "size": size,
            "sprite_set": f"{id}/dying",
            "phase_interactions": ["idle", "wind", "chop", "burn_ignite", "wilt", "decompose"]
        },
        {
            "phase": "dead",
            "duration_days": 90,
            "size": [1, 1],
            "sprite_set": f"{id}/dead",
            "phase_interactions": ["idle", "wind", "chop", "burn_ignite", "decompose"]
        },
    ]
    return {
        "id": id,
        "category": category,
        "ontology": "animate",
        "blocking": False,
        "pixel_size": PIXEL_SIZE,
        "anchor": "bottom_center",
        "size": size,
        "lifecycle": {"phases": phases},
        "variance": {
            "lean_angle": {"type": "float", "range": [-5.0, 5.0]},
            "color_shift": {"type": "float", "range": [-0.1, 0.1]},
            "scale_variance": {"type": "float", "range": [0.8, 1.2]}
        },
        "break_products": {
            "on_chop": [
                {"id": "twig", "count": [1, 3]},
                {"id": "leaf_pile", "count": 1}
            ],
            "on_burn": [
                {"id": "ash_pile", "count": 1}
            ]
        }
    }


def grass(id: str, category: str, size: list = None) -> dict:
    if size is None:
        size = [1, 1]
    phases = [
        {
            "phase": "sprout",
            "duration_days": 5,
            "size": [1, 1],
            "sprite_set": f"{id}/sprout",
            "phase_interactions": ["idle", "walk_through", "run_through", "wind", "rain", "regrow"]
        },
        {
            "phase": "growing",
            "duration_days": 14,
            "size": size,
            "sprite_set": f"{id}/growing",
            "phase_interactions": ["idle", "walk_through", "run_through", "wind", "rain", "regrow"]
        },
        {
            "phase": "mature",
            "duration_days": 90,
            "size": size,
            "sprite_set": f"{id}/mature",
            "phase_interactions": [
                "idle", "idle_variant", "walk_through", "run_through",
                "wind", "rain", "burn_ignite", "pick", "wilt"
            ]
        },
        {
            "phase": "dry",
            "duration_days": 30,
            "size": size,
            "sprite_set": f"{id}/dry",
            "phase_interactions": [
                "idle", "walk_through", "run_through",
                "wind", "burn_ignite", "wilt", "decompose"
            ]
        },
        {
            "phase": "dead",
            "duration_days": 30,
            "size": [1, 1],
            "sprite_set": f"{id}/dead",
            "phase_interactions": ["idle", "walk_through", "wind", "decompose"]
        },
    ]
    return {
        "id": id,
        "category": category,
        "ontology": "animate",
        "blocking": False,
        "pixel_size": PIXEL_SIZE,
        "anchor": "bottom_center",
        "size": size,
        "lifecycle": {"phases": phases},
        "variance": {
            "lean_angle": {"type": "float", "range": [-10.0, 10.0]},
            "color_shift": {"type": "float", "range": [-0.15, 0.15]},
            "scale_variance": {"type": "float", "range": [0.7, 1.3]}
        },
        "break_products": {
            "on_chop": [{"id": "twig", "count": 1}],
            "on_burn": [{"id": "ash_pile", "count": 1}]
        }
    }


def flower(id: str, category: str, size: list = None) -> dict:
    if size is None:
        size = [1, 1]
    phases = [
        {
            "phase": "bud",
            "duration_days": 7,
            "size": size,
            "sprite_set": f"{id}/bud",
            "phase_interactions": ["idle", "walk_through", "wind", "rain", "regrow"]
        },
        {
            "phase": "blooming",
            "duration_days": 21,
            "size": size,
            "sprite_set": f"{id}/blooming",
            "phase_interactions": [
                "idle", "idle_variant", "walk_through", "wind", "rain",
                "pick", "bloom", "insect_swarm"
            ]
        },
        {
            "phase": "wilting",
            "duration_days": 14,
            "size": size,
            "sprite_set": f"{id}/wilting",
            "phase_interactions": ["idle", "walk_through", "wind", "wilt", "pick"]
        },
        {
            "phase": "seed_head",
            "duration_days": 14,
            "size": size,
            "sprite_set": f"{id}/seed_head",
            "phase_interactions": ["idle", "walk_through", "wind", "pick", "decompose"]
        },
    ]
    return {
        "id": id,
        "category": category,
        "ontology": "animate",
        "blocking": False,
        "pixel_size": PIXEL_SIZE,
        "anchor": "bottom_center",
        "size": size,
        "lifecycle": {"phases": phases},
        "variance": {
            "lean_angle": {"type": "float", "range": [-8.0, 8.0]},
            "color_shift": {"type": "float", "range": [-0.2, 0.2]},
            "scale_variance": {"type": "float", "range": [0.8, 1.2]}
        },
        "break_products": {
            "on_chop": [{"id": "leaf_pile", "count": 1}],
            "on_burn": [{"id": "ash_pile", "count": 1}]
        }
    }


def rock(id: str, category: str, size: list = None, blocking: bool = True) -> dict:
    if size is None:
        size = [1, 1]
    stages = [
        {
            "stage": "intact",
            "hp_threshold": 100,
            "sprite_set": f"{id}/intact",
            "interactions": ["idle", "mine", "erosion", "freeze_cast"]
        },
        {
            "stage": "cracked",
            "hp_threshold": 67,
            "sprite_set": f"{id}/cracked",
            "interactions": ["idle", "mine", "erosion", "freeze_cast", "crack"]
        },
        {
            "stage": "fractured",
            "hp_threshold": 33,
            "sprite_set": f"{id}/fractured",
            "interactions": ["idle", "mine", "erosion", "crack", "collapse"]
        },
        {
            "stage": "shattered",
            "hp_threshold": 0,
            "sprite_set": f"{id}/shattered",
            "interactions": ["idle", "walk_through"]
        },
    ]
    return {
        "id": id,
        "category": category,
        "ontology": "inanimate",
        "blocking": blocking,
        "pixel_size": PIXEL_SIZE,
        "anchor": "bottom_center",
        "size": size,
        "durability": {
            "hp": 100,
            "resistances": {
                "blunt": 0.5,
                "sharp": 0.8,
                "fire": 0.95,
                "frost": 0.7
            },
            "stages": stages
        },
        "variance": {
            "scale_variance": {"type": "float", "range": [0.85, 1.15]},
            "color_shift": {"type": "float", "range": [-0.05, 0.05]}
        },
        "break_products": {
            "on_mine": [
                {"id": "rock_chunk", "count": [2, 4]},
                {"id": "pebble", "count": [1, 3]},
                {"id": "stone_dust", "count": [1, 2]}
            ]
        }
    }


def ground_cover(id: str, category: str, size: list = None) -> dict:
    if size is None:
        size = [1, 1]
    stages = [
        {
            "stage": "intact",
            "hp_threshold": 20,
            "sprite_set": f"{id}/intact",
            "interactions": ["idle", "walk_through", "run_through", "wind", "rain"]
        },
        {
            "stage": "disturbed",
            "hp_threshold": 0,
            "sprite_set": f"{id}/disturbed",
            "interactions": ["idle", "walk_through", "run_through", "decompose"]
        },
    ]
    return {
        "id": id,
        "category": category,
        "ontology": "inanimate",
        "blocking": False,
        "pixel_size": PIXEL_SIZE,
        "anchor": "center",
        "size": size,
        "durability": {
            "hp": 20,
            "resistances": {"blunt": 1.0, "sharp": 1.0, "fire": 0.5, "frost": 0.8},
            "stages": stages
        },
        "variance": {
            "scale_variance": {"type": "float", "range": [0.8, 1.2]},
            "color_shift": {"type": "float", "range": [-0.1, 0.1]}
        },
        "break_products": {
            "on_dig": [{"id": "pebble", "count": 1}]
        }
    }


def water_feature(id: str, category: str, size: list = None) -> dict:
    if size is None:
        size = [1, 1]
    return {
        "id": id,
        "category": category,
        "ontology": "inanimate",
        "blocking": False,
        "pixel_size": PIXEL_SIZE,
        "anchor": "center",
        "size": size,
        "durability": None,
        "variance": {
            "scale_variance": {"type": "float", "range": [0.9, 1.1]},
            "color_shift": {"type": "float", "range": [-0.05, 0.05]}
        },
        "interactions": ["idle", "swim_past", "wind", "rain"],
        "break_products": {}
    }


def structure_natural(id: str, category: str, size: list = None, blocking: bool = True) -> dict:
    if size is None:
        size = [1, 1]
    stages = [
        {
            "stage": "intact",
            "hp_threshold": 60,
            "sprite_set": f"{id}/intact",
            "interactions": ["idle", "chop", "burn_ignite", "erosion"]
        },
        {
            "stage": "damaged",
            "hp_threshold": 0,
            "sprite_set": f"{id}/damaged",
            "interactions": ["idle", "chop", "burn_ignite", "collapse", "decompose"]
        },
    ]
    return {
        "id": id,
        "category": category,
        "ontology": "inanimate",
        "blocking": blocking,
        "pixel_size": PIXEL_SIZE,
        "anchor": "bottom_center",
        "size": size,
        "durability": {
            "hp": 60,
            "resistances": {"blunt": 0.7, "sharp": 0.5, "fire": 0.3, "frost": 0.9},
            "stages": stages
        },
        "variance": {
            "scale_variance": {"type": "float", "range": [0.85, 1.15]},
            "color_shift": {"type": "float", "range": [-0.1, 0.1]}
        },
        "break_products": {
            "on_chop": [
                {"id": "log", "count": [1, 2]},
                {"id": "twig", "count": [2, 4]}
            ],
            "on_burn": [
                {"id": "ash_pile", "count": 1}
            ]
        }
    }


# ---------------------------------------------------------------------------
# Stump factory
# ---------------------------------------------------------------------------

def stump(id: str) -> dict:
    return {
        "id": id,
        "category": "structure_natural/log",
        "ontology": "inanimate",
        "blocking": False,
        "pixel_size": PIXEL_SIZE,
        "anchor": "bottom_center",
        "size": [1, 1],
        "durability": {
            "hp": 40,
            "resistances": {"blunt": 0.8, "sharp": 0.6, "fire": 0.4, "frost": 0.9},
            "stages": [
                {
                    "stage": "fresh",
                    "hp_threshold": 40,
                    "sprite_set": f"{id}/fresh",
                    "interactions": ["idle", "chop", "burn_ignite", "fungal_growth", "decompose"]
                },
                {
                    "stage": "rotting",
                    "hp_threshold": 0,
                    "sprite_set": f"{id}/rotting",
                    "interactions": ["idle", "fungal_growth", "decompose", "overgrowth"]
                }
            ]
        },
        "variance": {
            "scale_variance": {"type": "float", "range": [0.9, 1.1]},
            "color_shift": {"type": "float", "range": [-0.05, 0.05]}
        },
        "break_products": {
            "on_chop": [{"id": "wood_scrap", "count": [1, 2]}],
            "on_burn": [{"id": "ash_pile", "count": 1}]
        }
    }


# ---------------------------------------------------------------------------
# Break product definitions
# ---------------------------------------------------------------------------

def _break_products():
    products = []
    # log
    products.append({
        "id": "log",
        "category": "structure_natural/log",
        "ontology": "inanimate",
        "blocking": False,
        "pixel_size": PIXEL_SIZE,
        "anchor": "bottom_center",
        "size": [1, 1],
        "durability": {
            "hp": 30,
            "resistances": {"blunt": 0.9, "sharp": 0.5, "fire": 0.3, "frost": 0.9},
            "stages": [
                {
                    "stage": "fresh",
                    "hp_threshold": 30,
                    "sprite_set": "log/fresh",
                    "interactions": ["idle", "chop", "burn_ignite", "decompose", "fungal_growth"]
                },
                {
                    "stage": "rotting",
                    "hp_threshold": 0,
                    "sprite_set": "log/rotting",
                    "interactions": ["idle", "decompose", "fungal_growth", "overgrowth"]
                }
            ]
        },
        "variance": {
            "scale_variance": {"type": "float", "range": [0.9, 1.1]},
            "color_shift": {"type": "float", "range": [-0.05, 0.05]}
        },
        "break_products": {
            "on_chop": [{"id": "wood_scrap", "count": [2, 3]}],
            "on_burn": [{"id": "ash_pile", "count": 1}]
        }
    })
    # branch
    products.append(structure_natural("branch", "structure_natural/log", size=[1, 1], blocking=False))
    products[-1]["durability"]["hp"] = 15
    products[-1]["break_products"]["on_chop"] = [{"id": "twig", "count": [1, 3]}]
    # twig
    products.append({
        "id": "twig",
        "category": "structure_natural/log",
        "ontology": "inanimate",
        "blocking": False,
        "pixel_size": PIXEL_SIZE,
        "anchor": "bottom_center",
        "size": [1, 1],
        "durability": None,
        "variance": {"scale_variance": {"type": "float", "range": [0.8, 1.2]}},
        "interactions": ["idle", "walk_through", "decompose"],
        "break_products": {}
    })
    # wood_scrap
    products.append({
        "id": "wood_scrap",
        "category": "structure_natural/log",
        "ontology": "inanimate",
        "blocking": False,
        "pixel_size": PIXEL_SIZE,
        "anchor": "center",
        "size": [1, 1],
        "durability": None,
        "variance": {"scale_variance": {"type": "float", "range": [0.8, 1.2]}},
        "interactions": ["idle", "walk_through", "pick"],
        "break_products": {}
    })
    # leaf_pile
    products.append(ground_cover("leaf_pile", "ground_cover/leaf_litter"))
    # ash_pile
    products.append(ground_cover("ash_pile", "ground_cover/ash_layer"))
    # charred_trunk
    ct = structure_natural("charred_trunk", "structure_natural/log", size=[1, 2], blocking=True)
    ct["break_products"]["on_mine"] = [{"id": "ash_pile", "count": 1}]
    products.append(ct)
    # rock_chunk
    rc = rock("rock_chunk", "mineral/rock", size=[1, 1], blocking=False)
    rc["break_products"]["on_mine"] = [
        {"id": "pebble", "count": [1, 2]},
        {"id": "stone_dust", "count": 1}
    ]
    products.append(rc)
    # stone_dust (ground cover)
    products.append(ground_cover("stone_dust", "ground_cover/gravel"))
    return products


# ---------------------------------------------------------------------------
# Special objects
# ---------------------------------------------------------------------------

def _specials():
    objs = []

    # runic_stone
    r = rock("runic_stone", "mineral/rock/crystal", size=[1, 2], blocking=True)
    r["durability"]["resistances"]["magic"] = 0.1
    r["interactions_extra"] = ["idle", "mine", "freeze_cast"]
    objs.append(r)

    # mist_pool
    mp = water_feature("mist_pool", "water_feature/puddle", size=[2, 1])
    mp["interactions"] = ["idle", "swim_past", "wind", "rain", "walk_through"]
    objs.append(mp)

    # spirit_wisp — treat as flower-like animate
    sw = flower("spirit_wisp", "vegetation/flower", size=[1, 1])
    sw["ontology"] = "animate"
    sw["variance"]["color_shift"]["range"] = [-0.5, 0.5]
    objs.append(sw)

    return objs


# ---------------------------------------------------------------------------
# Main generation
# ---------------------------------------------------------------------------

def generate():
    # -----------------------------------------------------------------------
    # VEGETATION / TREE / DECIDUOUS
    # -----------------------------------------------------------------------
    deciduous = ["oak_tree", "birch_tree", "maple_tree", "elm_tree", "ash_tree", "beech_tree", "poplar_tree"]
    for id in deciduous:
        write_object("vegetation/tree/deciduous", tree(id, "vegetation/tree/deciduous"))

    # VEGETATION / TREE / WILLOW
    write_object("vegetation/tree/willow", tree("willow_tree", "vegetation/tree/willow", size=[2, 4]))
    write_object("vegetation/tree/willow", tree("weeping_willow", "vegetation/tree/willow", size=[3, 4]))

    # VEGETATION / TREE / CONIFER
    conifers = ["pine_tree", "spruce_tree", "fir_tree", "cedar_tree"]
    for id in conifers:
        write_object("vegetation/tree/conifer", tree(id, "vegetation/tree/conifer"))
    write_object("vegetation/tree/conifer", tree("juniper_tree", "vegetation/tree/conifer", size=[1, 2]))

    # VEGETATION / TREE / PALM
    write_object("vegetation/tree/palm", tree("palm_tree", "vegetation/tree/palm", size=[1, 3]))
    write_object("vegetation/tree/palm", tree("coconut_palm", "vegetation/tree/palm", size=[1, 3]))

    # VEGETATION / TREE / TROPICAL
    write_object("vegetation/tree/tropical", tree("banana_tree", "vegetation/tree/tropical", size=[1, 2]))
    write_object("vegetation/tree/tropical", tree("mangrove_tree", "vegetation/tree/tropical", size=[2, 2]))
    write_object("vegetation/tree/tropical", tree("jungle_tree", "vegetation/tree/tropical", size=[2, 4]))
    write_object("vegetation/tree/tropical", tree("kapok_tree", "vegetation/tree/tropical", size=[3, 5]))

    # VEGETATION / TREE / DEAD
    write_object("vegetation/tree/dead", tree("dead_tree", "vegetation/tree/dead", size=[1, 3]))
    write_object("vegetation/tree/dead", tree("charred_tree", "vegetation/tree/dead", size=[1, 3]))
    write_object("vegetation/tree/dead", tree("hollow_tree", "vegetation/tree/dead", size=[2, 3]))

    # -----------------------------------------------------------------------
    # VEGETATION / BUSH
    # -----------------------------------------------------------------------
    bushes = [
        "flowering_bush", "rose_bush", "berry_bush", "blueberry_bush",
        "thorny_bush", "bramble", "hedge_bush", "dry_bush",
        "desert_shrub", "scrub_brush", "tundra_shrub"
    ]
    for id in bushes:
        write_object("vegetation/bush", bush(id, "vegetation/bush"))

    # -----------------------------------------------------------------------
    # VEGETATION / GRASS
    # -----------------------------------------------------------------------
    grasses = [
        "tall_grass", "meadow_grass", "prairie_grass", "short_grass", "lawn_grass",
        "dry_grass", "frozen_grass", "reed", "cattail", "bulrush",
        "sea_grass", "river_weed", "kelp", "pampas_grass"
    ]
    for id in grasses:
        write_object("vegetation/grass", grass(id, "vegetation/grass"))

    # -----------------------------------------------------------------------
    # VEGETATION / FLOWER
    # -----------------------------------------------------------------------
    flowers = [
        "wildflower", "daisy", "poppy", "lavender", "sunflower", "dandelion",
        "orchid", "hibiscus", "lotus", "glowing_mushroom", "toadstool", "puffball",
        "bracket_fungus", "morel", "succulent", "cactus_flower",
        "arctic_poppy", "arcane_flower"
    ]
    for id in flowers:
        write_object("vegetation/flower", flower(id, "vegetation/flower"))

    # -----------------------------------------------------------------------
    # VEGETATION / VINE
    # -----------------------------------------------------------------------
    vines = ["climbing_vine", "hanging_vine", "ivy", "ground_vine", "ethereal_vine"]
    for id in vines:
        v = grass(id, "vegetation/vine")
        v["category"] = "vegetation/vine"
        write_object("vegetation/vine", v)

    # -----------------------------------------------------------------------
    # VEGETATION / MOSS
    # -----------------------------------------------------------------------
    mosses = ["rock_moss", "tree_moss", "ground_moss", "hanging_moss", "hardy_moss"]
    for id in mosses:
        m = ground_cover(id, "vegetation/moss")
        m["ontology"] = "animate"
        write_object("vegetation/moss", m)

    # -----------------------------------------------------------------------
    # VEGETATION / LICHEN
    # -----------------------------------------------------------------------
    write_object("vegetation/lichen", ground_cover("lichen_patch", "vegetation/lichen"))

    # -----------------------------------------------------------------------
    # VEGETATION / ALGAE
    # -----------------------------------------------------------------------
    algaes = ["freshwater_algae", "saltwater_algae", "algae_film"]
    for id in algaes:
        a = ground_cover(id, "vegetation/algae")
        a["ontology"] = "animate"
        write_object("vegetation/algae", a)

    # -----------------------------------------------------------------------
    # VEGETATION / FERN
    # -----------------------------------------------------------------------
    ferns = ["forest_fern", "tropical_fern", "giant_fern", "curled_fiddlehead"]
    for id in ferns:
        f = grass(id, "vegetation/fern")
        f["category"] = "vegetation/fern"
        write_object("vegetation/fern", f)

    # -----------------------------------------------------------------------
    # VEGETATION / CROP
    # -----------------------------------------------------------------------
    crops_grass = ["wheat", "barley", "corn", "potato_plant", "carrot_plant", "tomato_plant"]
    for id in crops_grass:
        c = grass(id, "vegetation/crop")
        c["category"] = "vegetation/crop"
        write_object("vegetation/crop", c)

    # crop trees
    write_object("vegetation/crop", tree("apple_tree", "vegetation/crop", size=[2, 2]))
    write_object("vegetation/crop", tree("cherry_tree", "vegetation/crop", size=[2, 2]))

    # -----------------------------------------------------------------------
    # MINERAL / ROCK
    # -----------------------------------------------------------------------
    boulders = [
        ("granite_boulder", [2, 2], True),
        ("sandstone_boulder", [2, 2], True),
        ("mossy_boulder", [2, 2], True),
        ("basalt_boulder", [2, 2], True),
        ("limestone_block", [1, 1], True),
        ("flat_rock", [1, 1], False),
        ("pebble", [1, 1], False),
        ("river_stone", [1, 1], False),
        ("gravel_pile", [1, 1], False),
        ("crystal_cluster", [1, 2], True),
        ("amethyst_geode", [1, 1], True),
        ("quartz_formation", [1, 2], True),
        ("mystic_crystal", [1, 2], True),
        ("volcanic_rock", [1, 1], True),
        ("obsidian_shard", [1, 1], True),
        ("pumice_stone", [1, 1], False),
        ("lava_rock", [1, 1], True),
        ("sandstone_slab", [1, 1], False),
        ("slate_slab", [1, 1], False),
        ("scree", [1, 1], False),
    ]
    for id, sz, blk in boulders:
        write_object("mineral/rock", rock(id, "mineral/rock", size=sz, blocking=blk))

    # -----------------------------------------------------------------------
    # MINERAL / ORE
    # -----------------------------------------------------------------------
    ores = ["iron_ore", "gold_vein", "gem_deposit", "coal_seam"]
    for id in ores:
        o = rock(id, "mineral/ore", size=[1, 1], blocking=True)
        o["durability"]["resistances"]["blunt"] = 0.3
        o["break_products"]["on_mine"].append({"id": "rock_chunk", "count": 1})
        write_object("mineral/ore", o)

    # -----------------------------------------------------------------------
    # MINERAL / CLIFF_FACE
    # -----------------------------------------------------------------------
    write_object("mineral/cliff_face", rock("cliff_face", "mineral/cliff_face", size=[2, 3], blocking=True))
    write_object("mineral/cliff_face", rock("rock_overhang", "mineral/cliff_face", size=[2, 2], blocking=True))

    # -----------------------------------------------------------------------
    # WATER FEATURE
    # -----------------------------------------------------------------------
    water_features = [
        ("ocean_wave", [1, 1]),
        ("lake_ripple", [1, 1]),
        ("river_current", [1, 1]),
        ("shore_foam", [1, 1]),
        ("rapid_foam", [1, 1]),
        ("whirlpool", [1, 1]),
        ("trickle", [1, 2]),
        ("footstep_splash", [1, 1]),
        ("impact_splash", [1, 1]),
        ("rain_puddle", [1, 1]),
        ("standing_water", [1, 1]),
        ("sheet_ice", [1, 1]),
        ("icicle", [1, 2]),
        ("frost_pattern", [1, 1]),
        ("tidal_pool", [1, 1]),
    ]
    for id, sz in water_features:
        write_object("water_feature", water_feature(id, "water_feature", size=sz))

    # waterfall special (larger)
    wf = water_feature("waterfall", "water_feature/waterfall", size=[2, 3])
    wf["interactions"] = ["idle", "idle_variant", "swim_past", "wind", "rain"]
    write_object("water_feature/waterfall", wf)

    # -----------------------------------------------------------------------
    # GROUND COVER
    # -----------------------------------------------------------------------
    ground_covers = [
        "autumn_leaves", "dry_leaves", "wet_leaves", "pine_needle_bed",
        "wind_sand_drift", "dune_ripple", "fresh_snow", "packed_snow", "melting_snow",
        "wet_mud", "drying_mud", "cracked_earth", "ice_patch", "permafrost_crack",
        "fresh_ash", "old_ash", "gravel_patch", "peat_bog", "sulfur_deposit"
    ]
    for id in ground_covers:
        # pick the most appropriate sub-category for path
        if "ash" in id:
            subcat = "ground_cover/ash_layer"
        elif "snow" in id:
            subcat = "ground_cover/snow_drift"
        elif "mud" in id or "earth" in id:
            subcat = "ground_cover/mud_patch"
        elif "ice" in id or "frost" in id or "permafrost" in id:
            subcat = "ground_cover/ice_sheet"
        elif "leaf" in id or "leaves" in id or "pine_needle" in id:
            subcat = "ground_cover/leaf_litter"
        elif "sand" in id or "dune" in id or "gravel" in id:
            subcat = "ground_cover/gravel"
        elif "peat" in id:
            subcat = "ground_cover/peat"
        elif "sulfur" in id:
            subcat = "ground_cover/ash_layer"
        else:
            subcat = "ground_cover"
        write_object(subcat, ground_cover(id, subcat))

    # -----------------------------------------------------------------------
    # STRUCTURE NATURAL
    # -----------------------------------------------------------------------
    # logs
    for id, sz, blk in [
        ("fallen_log", [2, 1], True),
        ("hollow_log", [2, 1], True),
        ("mossy_log", [2, 1], True),
        ("driftwood", [1, 1], False),
    ]:
        write_object("structure_natural/log", structure_natural(id, "structure_natural/log", size=sz, blocking=blk))

    # nests / dens
    write_object("structure_natural/nest", structure_natural("bird_nest", "structure_natural/nest", size=[1, 1], blocking=False))
    write_object("structure_natural/den", structure_natural("ant_mound", "structure_natural/den", size=[1, 1], blocking=True))
    write_object("structure_natural/den", structure_natural("termite_mound", "structure_natural/den", size=[1, 2], blocking=True))
    write_object("structure_natural/den", structure_natural("burrow_entrance", "structure_natural/den", size=[1, 1], blocking=False))
    write_object("structure_natural/den", structure_natural("cave_entrance", "structure_natural/den", size=[2, 2], blocking=True))
    write_object("structure_natural/den", structure_natural("bear_den", "structure_natural/den", size=[2, 2], blocking=True))
    write_object("structure_natural/den", structure_natural("crab_burrow", "structure_natural/den", size=[1, 1], blocking=False))

    # coral
    for id, sz, blk in [
        ("branching_coral", [1, 1], True),
        ("brain_coral", [1, 1], True),
        ("fan_coral", [1, 2], True),
    ]:
        c = structure_natural(id, "structure_natural/coral", size=sz, blocking=blk)
        c["durability"]["resistances"]["water"] = 0.0
        write_object("structure_natural/coral", c)

    # shells / bones
    shell_bone = [
        ("conch_shell", False), ("clam_shell", False), ("shell_scatter", False),
        ("bone_pile", False), ("skull", False), ("rib_cage", False)
    ]
    for id, blk in shell_bone:
        subcat = "structure_natural/shell" if "shell" in id else "structure_natural/bone"
        s = structure_natural(id, subcat, size=[1, 1], blocking=blk)
        write_object(subcat, s)

    # webs / cocoons
    write_object("structure_natural/web", structure_natural("spider_web", "structure_natural/web", size=[1, 1], blocking=False))
    write_object("structure_natural/web", structure_natural("cocoon", "structure_natural/web", size=[1, 1], blocking=False))

    # hives
    write_object("structure_natural/hive", structure_natural("beehive", "structure_natural/hive", size=[1, 1], blocking=True))
    write_object("structure_natural/hive", structure_natural("wasp_nest", "structure_natural/hive", size=[1, 1], blocking=True))
    write_object("structure_natural/nest", structure_natural("eagle_nest", "structure_natural/nest", size=[1, 1], blocking=False))

    # -----------------------------------------------------------------------
    # BREAK PRODUCTS
    # -----------------------------------------------------------------------
    for bp in _break_products():
        cat = bp["category"]
        write_object(cat, bp)

    # -----------------------------------------------------------------------
    # STUMP PRODUCTS
    # -----------------------------------------------------------------------
    stump_ids = [
        "oak_tree_stump", "birch_tree_stump", "maple_tree_stump",
        "pine_tree_stump", "spruce_tree_stump", "palm_tree_stump"
    ]
    for id in stump_ids:
        write_object("structure_natural/log", stump(id))

    # -----------------------------------------------------------------------
    # SPECIALS
    # -----------------------------------------------------------------------
    specials = _specials()
    special_cats = [
        "mineral/rock/crystal",
        "water_feature/puddle",
        "vegetation/flower"
    ]
    for obj, cat in zip(specials, special_cats):
        write_object(cat, obj)


if __name__ == "__main__":
    generate()
    print(f"Generated {TOTAL_WRITTEN} object definition files.")
    if TOTAL_WRITTEN < 180:
        print(f"WARNING: only {TOTAL_WRITTEN} objects — expected 180+")
    else:
        print("OK: 180+ threshold met.")
